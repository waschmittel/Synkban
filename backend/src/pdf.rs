//! Card → PDF/A-2u renderer.
//!
//! Layout is a small hand-rolled flow engine: block content (headings,
//! paragraphs, lists, quotes, code, tables) is laid out top-down into
//! per-page lists of drawing ops, then the ops are replayed onto krilla
//! pages. Two passes because the footer needs the final page count.
//!
//! PDF/A: krilla's `Archival::A2_U` validator embeds an ICC-based colour
//! space, XMP metadata and an output intent, and fails the export if the
//! document breaks the standard. Every font is embedded (subsetted) — the
//! DejaVu family is compiled into the binary, so output doesn't depend on
//! what's installed. Characters without a glyph are replaced by `?` before
//! drawing, because PDF/A forbids `.notdef` glyphs.

use krilla::action::LinkAction;
use krilla::annotation::{Annotation, LinkAnnotation, Target};
use krilla::color::rgb;
use krilla::configure::{Archival, ConfigurationBuilder};
use krilla::geom::{PathBuilder, Point, Rect};
use krilla::image::Image;
use krilla::metadata::{DateTime, Metadata};
use krilla::page::PageSettings;
use krilla::paint::Fill;
use krilla::text::{Font, Tag, TextDirection};
use krilla::{Document, SerializeSettings};
use std::collections::HashMap;

use serde_json::Value;

use crate::errors::AppError;
use crate::models::{Attachment, Card, Label};

/// Everything the renderer needs about one card, gathered by the store.
pub struct CardExport {
    pub card: Card,
    pub board_title: String,
    /// The card's labels, in the board's display order.
    pub labels: Vec<Label>,
    /// Attachment record plus its JPEG thumbnail (images only).
    pub attachments: Vec<(Attachment, Option<Vec<u8>>)>,
    /// Original files of the images the description shows inline, by
    /// attachment id (embedded instead of the thumbnail).
    pub originals: HashMap<String, Vec<u8>>,
    /// `YYYY-MM-DD HH:MM:SS` UTC, stamped into the PDF metadata.
    pub exported_at: String,
}

const PAGE_W: f32 = 595.0;
const PAGE_H: f32 = 842.0;
const MARGIN: f32 = 50.0;
const TOP: f32 = 50.0;
const BOTTOM: f32 = PAGE_H - 62.0;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN;
/// Longest side of an embedded picture: ~300 dpi on a full-width line, which
/// keeps the PDF small while staying sharp in print.
const PICTURE_MAX_PX: u32 = 2000;

/// A picture file (PNG, JPEG, GIF, WebP…) as JPEG bytes for the PDF: scaled
/// down to `PICTURE_MAX_PX`, transparency flattened onto white. `None` when it
/// cannot be decoded.
fn prepare_picture(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut img = image::load_from_memory(bytes).ok()?;
    if img.width().max(img.height()) > PICTURE_MAX_PX {
        img = img.resize(
            PICTURE_MAX_PX,
            PICTURE_MAX_PX,
            image::imageops::FilterType::Lanczos3,
        );
    }
    let mut rgba = img.to_rgba8();
    for px in rgba.pixels_mut() {
        let a = u16::from(px[3]);
        for c in &mut px.0[..3] {
            *c = ((u16::from(*c) * a + 255 * (255 - a)) / 255) as u8;
        }
    }
    let rgb = image::DynamicImage::ImageRgba8(rgba).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
        .encode_image(&rgb)
        .ok()?;
    Some(out)
}

/// Blocks up to this tall (half the text area of a page) are kept whole on one
/// page; bigger ones split. Inline pictures are at most this high.
const KEEP_MAX: f32 = (BOTTOM - TOP) / 2.0;
const MAX_IMAGE_H: f32 = KEEP_MAX;
/// Space a section heading takes: gap, 12pt line, rule, gap.
const HEADING_H: f32 = 36.0;

type Rgb = [u8; 3];
const INK: Rgb = [0x1f, 0x23, 0x28];
const MUTED: Rgb = [0x6b, 0x72, 0x80];
const LINK: Rgb = [0x00, 0x55, 0xaa];
const RULE: Rgb = [0xd0, 0xd4, 0xda];
const CODE_BG: Rgb = [0xf1, 0xf3, 0xf5];
const HEAD_BG: Rgb = [0xe9, 0xec, 0xef];

// ── fonts ────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Face {
    Regular = 0,
    Bold = 1,
    Italic = 2,
    BoldItalic = 3,
    Mono = 4,
    Emoji = 5,
    Arabic = 6,
    Hebrew = 7,
    Devanagari = 8,
    Thai = 9,
}

static FONT_DATA: [&[u8]; 10] = [
    include_bytes!("../fonts/DejaVuSans.ttf"),
    include_bytes!("../fonts/DejaVuSans-Bold.ttf"),
    include_bytes!("../fonts/DejaVuSans-Oblique.ttf"),
    include_bytes!("../fonts/DejaVuSans-BoldOblique.ttf"),
    include_bytes!("../fonts/DejaVuSansMono.ttf"),
    include_bytes!("../fonts/NotoEmoji.ttf"),
    include_bytes!("../fonts/NotoSansArabic.ttf"),
    include_bytes!("../fonts/NotoSansHebrew.ttf"),
    include_bytes!("../fonts/NotoSansDevanagari.ttf"),
    include_bytes!("../fonts/NotoSansThai.ttf"),
];

/// Tried in this order for a character the style's own face lacks.
const FALLBACKS: [Face; 6] = [
    Face::Regular,
    Face::Emoji,
    Face::Arabic,
    Face::Hebrew,
    Face::Devanagari,
    Face::Thai,
];

impl Face {
    fn rtl(self) -> bool {
        matches!(self, Face::Arabic | Face::Hebrew)
    }

    fn is_script(self) -> bool {
        matches!(
            self,
            Face::Arabic | Face::Hebrew | Face::Devanagari | Face::Thai
        )
    }

    /// The face a character belongs to by script, regardless of style.
    fn of_script(c: char) -> Option<Face> {
        match c as u32 {
            0x0590..=0x05FF | 0xFB1D..=0xFB4F => Some(Face::Hebrew),
            0x0600..=0x06FF
            | 0x0750..=0x077F
            | 0x08A0..=0x08FF
            | 0xFB50..=0xFDFF
            | 0xFE70..=0xFEFF => Some(Face::Arabic),
            0x0900..=0x097F | 0xA8E0..=0xA8FF => Some(Face::Devanagari),
            0x0E00..=0x0E7F => Some(Face::Thai),
            0x1F000..=0x1FAFF => Some(Face::Emoji),
            _ => None,
        }
    }
}

const REGULAR_INSTANCE: [(&[u8; 4], f32); 2] = [(b"wght", 400.0), (b"wdth", 100.0)];

struct Fonts {
    kr: Vec<Font>,
    bz: Vec<rustybuzz::Face<'static>>,
}

impl Fonts {
    fn load() -> Result<Self, AppError> {
        let mut kr = Vec::new();
        let mut bz = Vec::new();
        for (i, data) in FONT_DATA.into_iter().enumerate() {
            let variable = i >= Face::Emoji as usize;
            // The Noto fonts are variable and some default to Thin: pin the
            // regular instance, for drawing and for measuring alike.
            let coords: Vec<(Tag, f32)> = if variable {
                REGULAR_INSTANCE
                    .iter()
                    .map(|(t, v)| (Tag::new(t), *v))
                    .collect()
            } else {
                Vec::new()
            };
            kr.push(
                Font::new_variable(data.into(), 0, &coords)
                    .ok_or_else(|| internal("font load failed"))?,
            );
            let mut face = rustybuzz::Face::from_slice(data, 0)
                .ok_or_else(|| internal("font parse failed"))?;
            if variable {
                let vars: Vec<rustybuzz::Variation> = REGULAR_INSTANCE
                    .iter()
                    .map(|(tag, value)| rustybuzz::Variation {
                        tag: rustybuzz::ttf_parser::Tag::from_bytes(tag),
                        value: *value,
                    })
                    .collect();
                face.set_variations(&vars);
            }
            bz.push(face);
        }
        Ok(Fonts { kr, bz })
    }

    fn has(&self, face: Face, c: char) -> bool {
        self.bz[face as usize].glyph_index(c).is_some()
    }

    /// Splits text into runs that each use one face: the style's own face,
    /// or a script/emoji/fallback face for characters it lacks. Control and
    /// zero-width characters (and emoji skin-tone/variation selectors, which
    /// a monochrome font can't show) are dropped; a character no face has
    /// becomes `?`, because PDF/A forbids `.notdef` glyphs. `\n` is kept.
    fn runs(&self, primary: Face, s: &str) -> Vec<(Face, String)> {
        let mut out: Vec<(Face, String)> = Vec::new();
        for c in s.chars() {
            let c = match c {
                '\n' => '\n',
                '\t' => ' ',
                '\u{200B}'..='\u{200F}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}' => continue,
                '\u{FE00}'..='\u{FE0F}' | '\u{1F3FB}'..='\u{1F3FF}' => continue,
                c if c.is_control() => continue,
                c => c,
            };
            let (face, c) = match self.pick(primary, c, out.last().map(|r| r.0)) {
                Some(face) => (face, c),
                None => (primary, '?'),
            };
            match out.last_mut() {
                Some((f, t)) if *f == face => t.push(c),
                _ => out.push((face, c.to_string())),
            }
        }
        out
    }

    fn pick(&self, primary: Face, c: char, prev: Option<Face>) -> Option<Face> {
        if let Some(f) = Face::of_script(c) {
            if self.has(f, c) {
                return Some(f);
            }
        } else if let Some(p) = prev.filter(|p| p.is_script()) {
            // Neutral characters (digits, punctuation) inside a script run
            // stay in it, so the run is shaped as one piece.
            if !c.is_alphabetic() && c != '\n' && self.has(p, c) {
                return Some(p);
            }
        }
        if self.has(primary, c) {
            return Some(primary);
        }
        FALLBACKS.into_iter().find(|f| self.has(*f, c))
    }

    /// Like `runs` for text that must stay in one face (code keeps its
    /// column alignment): characters the face lacks become `?`.
    fn sanitize(&self, face: Face, s: &str) -> String {
        s.chars()
            .filter(|c| {
                !matches!(
                    c,
                    '\u{200B}'..='\u{200F}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}'
                )
            })
            .filter(|c| *c == '\n' || !c.is_control())
            .map(|c| {
                if c == '\n' || self.has(face, c) {
                    c
                } else {
                    '?'
                }
            })
            .collect()
    }

    /// Shaped advance width, so kerning and contextual forms are counted.
    fn width(&self, face: Face, text: &str, size: f32) -> f32 {
        let f = &self.bz[face as usize];
        let mut buf = rustybuzz::UnicodeBuffer::new();
        buf.push_str(text);
        buf.guess_segment_properties();
        let shaped = rustybuzz::shape(f, &[], buf);
        let units: f32 = shaped
            .glyph_positions()
            .iter()
            .map(|p| p.x_advance as f32)
            .sum();
        units / f.units_per_em() as f32 * size
    }

    /// Shortens single-line text with an ellipsis so it fits `max` points.
    fn truncate(&self, primary: Face, text: &str, size: f32, max: f32) -> String {
        let text = text.replace('\n', " ");
        if self.runs_width(primary, &text, size) <= max {
            return text;
        }
        let mut out = String::new();
        for c in text.chars() {
            if self.runs_width(primary, &format!("{out}{c}\u{2026}"), size) > max {
                break;
            }
            out.push(c);
        }
        out.push('\u{2026}');
        out
    }

    fn runs_width(&self, primary: Face, text: &str, size: f32) -> f32 {
        self.runs(primary, text)
            .iter()
            .map(|(f, t)| self.width(*f, t, size))
            .sum()
    }
}

fn internal(msg: &str) -> AppError {
    AppError::Io(std::io::Error::other(format!("PDF export: {msg}")))
}

// ── ops ──────────────────────────────────────────────────────────────────

enum Op {
    Text {
        x: f32,
        y: f32,
        face: Face,
        size: f32,
        color: Rgb,
        text: String,
    },
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        color: Rgb,
    },
    Image {
        idx: usize,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    },
    Link {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        url: String,
    },
}

// ── inline text ──────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct Span {
    text: String,
    bold: bool,
    italic: bool,
    code: bool,
    link: Option<String>,
}

impl Span {
    fn face(&self) -> Face {
        match (self.code, self.bold, self.italic) {
            (true, _, _) => Face::Mono,
            (_, true, true) => Face::BoldItalic,
            (_, true, false) => Face::Bold,
            (_, false, true) => Face::Italic,
            _ => Face::Regular,
        }
    }
}

/// `**bold**` / `*italic*` markdown as used by card titles and labels. An
/// unmatched marker stays literal.
fn parse_md(s: &str, bold: bool, italic: bool, out: &mut Vec<Span>) {
    let mut plain = String::new();
    let mut rest = s;
    'scan: while let Some(c) = rest.chars().next() {
        for (marker, b, i) in [("***", true, true), ("**", true, false), ("*", false, true)] {
            let Some(after) = rest.strip_prefix(marker) else {
                continue;
            };
            let Some(end) = after.find(marker).filter(|&e| e > 0) else {
                continue;
            };
            push_plain(&mut plain, bold, italic, out);
            parse_md(&after[..end], bold || b, italic || i, out);
            rest = &after[end + marker.len()..];
            continue 'scan;
        }
        plain.push(c);
        rest = &rest[c.len_utf8()..];
    }
    push_plain(&mut plain, bold, italic, out);
}

fn push_plain(plain: &mut String, bold: bool, italic: bool, out: &mut Vec<Span>) {
    if !plain.is_empty() {
        out.push(Span {
            text: std::mem::take(plain),
            bold,
            italic,
            ..Span::default()
        });
    }
}

fn plain_md(s: &str) -> String {
    let mut spans = Vec::new();
    parse_md(s, false, false, &mut spans);
    spans.into_iter().map(|s| s.text).collect()
}

/// One styled run on a laid-out line. `lead` is the gap before it (a space
/// when it follows another run on the same line).
struct Seg {
    text: String,
    face: Face,
    w: f32,
    lead: f32,
    link: Option<String>,
    color: Rgb,
}

#[derive(Clone, Copy, PartialEq)]
enum Align {
    Left,
    Center,
    Right,
}

// ── layout ───────────────────────────────────────────────────────────────

/// A point in the layout to roll back to (see `Layout::keep_together_up_to`).
struct Mark {
    pages: usize,
    page_len: usize,
    images: usize,
    y: f32,
    marker: Option<(String, f32)>,
}

struct Layout {
    fonts: Fonts,
    pages: Vec<Vec<Op>>,
    images: Vec<Image>,
    /// JPEG thumbnails by attachment id, for inline image references.
    thumbs: HashMap<String, Vec<u8>>,
    /// Index into `images` per attachment id (an image used twice is stored once).
    thumb_idx: HashMap<String, usize>,
    y: f32,
    /// List marker waiting for the next line emitted: (text, x).
    marker: Option<(String, f32)>,
}

impl Layout {
    fn new(fonts: Fonts) -> Self {
        Layout {
            fonts,
            pages: vec![Vec::new()],
            images: Vec::new(),
            thumbs: HashMap::new(),
            thumb_idx: HashMap::new(),
            y: TOP,
            marker: None,
        }
    }

    fn page(&mut self) -> &mut Vec<Op> {
        self.pages.last_mut().expect("at least one page")
    }

    fn new_page(&mut self) {
        self.pages.push(Vec::new());
        self.y = TOP;
    }

    fn ensure(&mut self, h: f32) {
        if self.y + h > BOTTOM && self.y > TOP {
            self.new_page();
        }
    }

    fn mark(&self) -> Mark {
        Mark {
            pages: self.pages.len(),
            page_len: self.pages.last().map_or(0, Vec::len),
            images: self.images.len(),
            y: self.y,
            marker: self.marker.clone(),
        }
    }

    fn rollback(&mut self, m: &Mark) {
        self.pages.truncate(m.pages);
        self.page().truncate(m.page_len);
        self.images.truncate(m.images);
        self.thumb_idx.retain(|_, i| *i < m.images);
        self.y = m.y;
        self.marker = m.marker.clone();
    }

    /// Runs `build` so that its output starts on a fresh page if it would
    /// otherwise be split but fits one page (and is at most `max` tall);
    /// anything bigger just flows. Output that fits the rest of the page
    /// stays put. (Same rule as the terminal app's export.)
    fn keep_together_up_to(&mut self, max: f32, build: &dyn Fn(&mut Layout)) {
        let m = self.mark();
        build(self);
        if self.pages.len() == m.pages {
            return;
        }
        self.rollback(&m);
        if self.y > TOP {
            self.new_page();
            let fresh = self.mark();
            build(self);
            if self.pages.len() == fresh.pages && self.y - TOP <= max {
                return;
            }
            self.rollback(&m);
        }
        build(self);
    }

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Rgb) {
        self.page().push(Op::Rect { x, y, w, h, color });
    }

    /// Breaks `spans` into lines no wider than `width`.
    fn wrap(&self, spans: &[Span], size: f32, width: f32, color: Rgb) -> Vec<Vec<Seg>> {
        let mut toks = Vec::new();
        let mut space = false;
        for span in spans {
            let primary = span.face();
            for (li, line) in span.text.split('\n').enumerate() {
                if li > 0 {
                    toks.push(Tok::Break);
                    space = false;
                }
                for (i, word) in line.split(' ').enumerate() {
                    if i > 0 {
                        space = true;
                    }
                    for (ri, (face, text)) in self.fonts.runs(primary, word).into_iter().enumerate()
                    {
                        toks.push(Tok::Word(Word {
                            text,
                            face,
                            lead_face: primary,
                            link: span.link.clone(),
                            space: space && ri == 0,
                        }));
                    }
                    if !word.is_empty() {
                        space = false;
                    }
                }
            }
        }

        let mut buf = LineBuf::default();
        for tok in toks {
            let w = match tok {
                Tok::Break => {
                    buf.break_line();
                    continue;
                }
                Tok::Word(w) => w,
            };
            let ww = self.fonts.width(w.face, &w.text, size);
            // Words of one style run share a segment, with a real space glyph
            // from that run's face in between (copy/paste, correct shaping).
            let merge = w.space
                && self.fonts.has(w.face, ' ')
                && buf
                    .cur
                    .last()
                    .is_some_and(|l| l.face == w.face && l.link == w.link);
            let mut lead = match (w.space && !buf.cur.is_empty(), merge) {
                (false, _) => 0.0,
                (true, true) => self.fonts.width(w.face, " ", size),
                (true, false) => self.fonts.width(w.lead_face, " ", size),
            };
            let mut merge = merge;
            if buf.cur_w + lead + ww > width && !buf.cur.is_empty() {
                buf.break_line();
                lead = 0.0;
                merge = false;
            }
            if ww > width {
                self.split_long(&w, size, width, color, &mut buf);
            } else {
                buf.push_word(w, lead, ww, color, merge);
            }
        }
        if !buf.cur.is_empty() || buf.lines.is_empty() {
            buf.lines.push(buf.cur);
        }
        buf.lines
    }

    /// A single word wider than the line: hard-wrap it by characters. The
    /// last chunk stays open as the current line.
    fn split_long(&self, word: &Word, size: f32, width: f32, color: Rgb, buf: &mut LineBuf) {
        let color = if word.link.is_some() { LINK } else { color };
        let seg = |text: String, w: f32| Seg {
            text,
            face: word.face,
            w,
            lead: 0.0,
            link: word.link.clone(),
            color,
        };
        if !buf.cur.is_empty() {
            buf.lines.push(std::mem::take(&mut buf.cur));
        }
        let mut chunk = String::new();
        let mut cw = 0.0;
        for c in word.text.chars() {
            let w1 = self.fonts.width(word.face, &c.to_string(), size);
            if cw + w1 > width && !chunk.is_empty() && w1 > 0.0 {
                buf.lines.push(vec![seg(std::mem::take(&mut chunk), cw)]);
                cw = 0.0;
            }
            chunk.push(c);
            cw += w1;
        }
        buf.cur = vec![seg(chunk, cw)];
        buf.cur_w = cw;
    }

    /// Draws one wrapped line with its top at `top`.
    fn emit_line_at(
        &mut self,
        line: &[Seg],
        x: f32,
        top: f32,
        width: f32,
        size: f32,
        align: Align,
    ) {
        let total: f32 = line.iter().map(|s| s.lead + s.w).sum();
        let mut cx = x + match align {
            Align::Left => 0.0,
            Align::Center => ((width - total) / 2.0).max(0.0),
            Align::Right => (width - total).max(0.0),
        };
        let base = top + size * 1.05;
        let line_h = size * 1.4;
        if let Some((m, mx)) = self.marker.take() {
            self.page().push(Op::Text {
                x: mx,
                y: base,
                face: Face::Regular,
                size,
                color: INK,
                text: m,
            });
        }
        for seg in line {
            cx += seg.lead;
            self.page().push(Op::Text {
                x: cx,
                y: base,
                face: seg.face,
                size,
                color: seg.color,
                text: seg.text.clone(),
            });
            if let Some(url) = &seg.link {
                self.rect(cx, base + 1.6, seg.w, 0.6, LINK);
                self.page().push(Op::Link {
                    x: cx,
                    y: top,
                    w: seg.w,
                    h: line_h,
                    url: url.clone(),
                });
            }
            cx += seg.w;
        }
    }

    /// Flows wrapped lines down the page, breaking pages as needed.
    /// With `keep`, the block moves to the next page as a whole when it
    /// would otherwise be split — unless it is taller than a page.
    fn flow(
        &mut self,
        spans: &[Span],
        x: f32,
        width: f32,
        TextStyle { size, color }: TextStyle,
        align: Align,
        keep: bool,
    ) {
        let lines = self.wrap(spans, size, width, color);
        let line_h = size * 1.4;
        let total = lines.len() as f32 * line_h;
        if keep && total <= KEEP_MAX {
            self.ensure(total);
        }
        // A paragraph that starts in a right-to-left script is right-aligned.
        let rtl = lines
            .first()
            .and_then(|l| l.first())
            .is_some_and(|s| s.face.rtl());
        let align = if rtl && align == Align::Left {
            Align::Right
        } else {
            align
        };
        for (i, line) in lines.iter().enumerate() {
            self.ensure(lines_to_keep(i, lines.len()) as f32 * line_h);
            let y = self.y;
            self.emit_line_at(line, x, y, width, size, align);
            self.y += line_h;
        }
    }

    /// Draws single-line text at a baseline, switching faces per run;
    /// returns its width.
    fn text_runs(
        &mut self,
        x: f32,
        y: f32,
        primary: Face,
        size: f32,
        color: Rgb,
        text: &str,
    ) -> f32 {
        let mut cx = x;
        for (face, t) in self.fonts.runs(primary, text) {
            let w = self.fonts.width(face, &t, size);
            self.page().push(Op::Text {
                x: cx,
                y,
                face,
                size,
                color,
                text: t,
            });
            cx += w;
        }
        cx - x
    }

    fn gap(&mut self, h: f32) {
        self.y += h;
    }

    /// Section heading. `keep_h` is the height of the content that must stay
    /// on the same page as the heading (capped at a page).
    fn heading_rule(&mut self, title: &str, keep_h: f32) {
        let room = BOTTOM - TOP - HEADING_H;
        self.ensure(HEADING_H + keep_h.clamp(30.0, room));
        self.gap(10.0);
        let spans = [Span {
            text: title.to_string(),
            bold: true,
            ..Span::default()
        }];
        self.flow(
            &spans,
            MARGIN,
            CONTENT_W,
            TextStyle {
                size: 12.0,
                color: MUTED,
            },
            Align::Left,
            false,
        );
        self.rect(MARGIN, self.y, CONTENT_W, 0.6, RULE);
        self.gap(8.0);
    }

    // ── ProseMirror ──────────────────────────────────────────────────────

    fn blocks(&mut self, nodes: &[Value], x: f32, w: f32, size: f32, color: Rgb) {
        self.blocks_inner(nodes, x, w, size, color, false);
    }

    /// Page breaks are planned hierarchically: a heading's whole section
    /// starts on a fresh page if it would otherwise be split and fits one
    /// page; longer sections flow, but their sub-sections get the same
    /// treatment. Every other block (paragraph, list, quote, code, table) is
    /// kept whole up to half a page. With `title_above` the first heading's
    /// section is already positioned by the caller.
    fn blocks_inner(
        &mut self,
        nodes: &[Value],
        x: f32,
        w: f32,
        size: f32,
        color: Rgb,
        title_above: bool,
    ) {
        let mut i = 0;
        while i < nodes.len() {
            if heading_level(&nodes[i]).is_some() {
                if title_above && i == 0 {
                    self.block(&nodes[i], x, w, size, color);
                    i += 1;
                } else {
                    let section = &nodes[i..section_end(nodes, i)];
                    self.keep_together_up_to(f32::MAX, &|l| {
                        l.blocks_inner(section, x, w, size, color, true)
                    });
                    i += section.len();
                }
            } else {
                let n = &nodes[i];
                self.keep_together_up_to(KEEP_MAX, &|l| l.block(n, x, w, size, color));
                i += 1;
            }
        }
    }

    fn block(&mut self, node: &Value, x: f32, w: f32, size: f32, color: Rgb) {
        let kind = node.get("type").and_then(Value::as_str).unwrap_or("");
        let content: &[Value] = node
            .get("content")
            .and_then(Value::as_array)
            .map_or(&[], Vec::as_slice);
        match kind {
            "paragraph" => {
                // Images split the paragraph: text before, the image on its
                // own line(s), text after.
                let mut parts: Vec<(&[Value], Option<usize>)> = Vec::new();
                let mut start = 0;
                for (i, n) in content.iter().enumerate() {
                    if let Some(idx) = self.inline_image(n) {
                        parts.push((&content[start..i], Some(idx)));
                        start = i + 1;
                    }
                }
                parts.push((&content[start..], None));
                let had_image = parts.len() > 1;
                for (nodes, img) in parts {
                    self.paragraph_text(nodes, x, w, size, color, had_image);
                    if let Some(idx) = img {
                        self.place_inline_image(idx, x, w, size);
                    }
                }
            }
            "heading" => {
                let level = node
                    .pointer("/attrs/level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                let hs = match level {
                    1 => 18.0,
                    2 => 15.0,
                    _ => 13.0,
                };
                let mut spans = Vec::new();
                inline(content, &mut spans, true);
                self.ensure(hs * 1.4 + 9.0 + 2.0 * size * 1.4);
                self.gap(4.0);
                self.flow(
                    &spans,
                    x,
                    w,
                    TextStyle { size: hs, color },
                    Align::Left,
                    true,
                );
                self.gap(5.0);
            }
            "code_block" => self.code_block(content, x, w),
            "bullet_list" | "ordered_list" => {
                let ordered = kind == "ordered_list";
                let start = node
                    .pointer("/attrs/order")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                let indent = indent_for(w, 20.0);
                for (i, item) in content.iter().enumerate() {
                    let marker = if ordered {
                        format!("{}.", start + i as u64)
                    } else {
                        "\u{2022}".to_string()
                    };
                    self.marker = Some((marker, x + 2.0));
                    let children = item
                        .get("content")
                        .and_then(Value::as_array)
                        .map_or(&[][..], Vec::as_slice);
                    self.blocks(children, x + indent, w - indent, size, color);
                    self.marker = None;
                }
                self.gap(2.0);
            }
            "blockquote" => {
                let start = (self.pages.len() - 1, self.y);
                let indent = indent_for(w, 14.0);
                self.blocks(content, x + indent, w - indent, size, MUTED);
                let end = (self.pages.len() - 1, self.y);
                for p in start.0..=end.0 {
                    let y0 = if p == start.0 { start.1 } else { TOP };
                    let y1 = if p == end.0 { end.1 } else { BOTTOM };
                    if y1 > y0 {
                        self.pages[p].push(Op::Rect {
                            x: x + 2.0,
                            y: y0,
                            w: 2.5,
                            h: y1 - y0 - 3.0,
                            color: RULE,
                        });
                    }
                }
            }
            "table" => self.table(content, x, w, size),
            _ => {
                if !content.is_empty() {
                    self.blocks(content, x, w, size, color);
                } else if node.get("text").is_some() {
                    let mut spans = Vec::new();
                    inline(std::slice::from_ref(node), &mut spans, false);
                    self.flow(&spans, x, w, TextStyle { size, color }, Align::Left, true);
                }
            }
        }
    }

    /// A run of inline nodes as wrapped text; a blank one is a gap, unless it
    /// only sits next to an image (`skip_blank`).
    fn paragraph_text(
        &mut self,
        nodes: &[Value],
        x: f32,
        w: f32,
        size: f32,
        color: Rgb,
        skip_blank: bool,
    ) {
        let mut spans = Vec::new();
        inline(nodes, &mut spans, false);
        if spans.iter().all(|s| s.text.trim().is_empty()) {
            if !skip_blank {
                self.gap(size * 0.7);
            }
        } else {
            self.flow(&spans, x, w, TextStyle { size, color }, Align::Left, true);
            self.gap(5.0);
        }
    }

    /// Index of the embedded picture for an `image` node whose attachment has
    /// a decodable thumbnail; other nodes (and dangling references) fall back
    /// to their text placeholder.
    fn inline_image(&mut self, node: &Value) -> Option<usize> {
        if node.get("type").and_then(Value::as_str) != Some("image") {
            return None;
        }
        let att = node.pointer("/attrs/att").and_then(Value::as_str)?;
        if let Some(&idx) = self.thumb_idx.get(att) {
            return Some(idx);
        }
        let img = Image::from_jpeg(self.thumbs.get(att)?.clone().into(), false).ok()?;
        let (iw, ih) = img.size();
        if iw == 0 || ih == 0 {
            return None;
        }
        self.images.push(img);
        self.thumb_idx
            .insert(att.to_string(), self.images.len() - 1);
        Some(self.images.len() - 1)
    }

    /// Size of picture `idx` on a line `w` wide: natural size (1px = 1pt),
    /// scaled down so it is neither wider than `w` nor higher than half the
    /// text area of a page.
    fn inline_image_size(&self, idx: usize, w: f32) -> (f32, f32) {
        let (iw, ih) = self.images[idx].size();
        let scale = (w / iw as f32).min(MAX_IMAGE_H / ih as f32).min(1.0);
        (iw as f32 * scale, ih as f32 * scale)
    }

    /// Draws a picture at its natural size (1px = 1pt), scaled down to fit
    /// within a full text line's width in both directions.
    fn place_inline_image(&mut self, idx: usize, x: f32, w: f32, size: f32) {
        let (iw, ih) = self.inline_image_size(idx, w);
        self.ensure(ih);
        let y = self.y;
        if let Some((m, mx)) = self.marker.take() {
            self.page().push(Op::Text {
                x: mx,
                y: y + size * 1.05,
                face: Face::Regular,
                size,
                color: INK,
                text: m,
            });
        }
        self.page().push(Op::Image {
            idx,
            x,
            y,
            w: iw,
            h: ih,
        });
        self.y += ih + 5.0;
    }

    fn code_block(&mut self, content: &[Value], x: f32, w: f32) {
        let size = 9.0;
        let line_h = size * 1.4;
        let text: String = content
            .iter()
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .collect();
        let text = self.fonts.sanitize(Face::Mono, &text);
        let span = [Span {
            text,
            code: true,
            ..Span::default()
        }];
        let lines = self.wrap_code(&span, size, w - 10.0);
        self.gap(2.0);
        for (i, line) in lines.iter().enumerate() {
            self.ensure(lines_to_keep(i, lines.len()) as f32 * line_h);
            let y = self.y;
            self.rect(x, y, w, line_h, CODE_BG);
            self.emit_line_at(line, x + 5.0, y, w - 10.0, size, Align::Left);
            self.y += line_h;
        }
        self.gap(7.0);
    }

    /// Code keeps its spaces: every character run is its own unbreakable
    /// line segment, wrapped by width.
    fn wrap_code(&self, spans: &[Span], size: f32, width: f32) -> Vec<Vec<Seg>> {
        let mut lines = Vec::new();
        for raw in spans.iter().flat_map(|s| s.text.split('\n')) {
            let mut chunk = String::new();
            let mut cw = 0.0;
            for c in raw.chars() {
                let w1 = self.fonts.width(Face::Mono, &c.to_string(), size);
                if cw + w1 > width && !chunk.is_empty() && w1 > 0.0 {
                    lines.push(vec![Seg {
                        text: std::mem::take(&mut chunk),
                        face: Face::Mono,
                        w: cw,
                        lead: 0.0,
                        link: None,
                        color: INK,
                    }]);
                    cw = 0.0;
                }
                chunk.push(c);
                cw += w1;
            }
            lines.push(if chunk.is_empty() {
                Vec::new()
            } else {
                vec![Seg {
                    text: chunk,
                    face: Face::Mono,
                    w: cw,
                    lead: 0.0,
                    link: None,
                    color: INK,
                }]
            });
        }
        lines
    }

    /// Tables are centred at their natural width (capped at the available
    /// width, widest columns shrinking first) and kept on one page when they
    /// fit; a longer table splits between rows and repeats its header.
    fn table(&mut self, rows: &[Value], x: f32, w: f32, size: f32) {
        let size = size - 1.0;
        let line_h = size * 1.4;
        let pad = 4.0;
        let grid: Vec<Vec<Cell>> = rows
            .iter()
            .enumerate()
            .map(|(ri, r)| table_cells(r, ri == 0))
            .collect();
        let ncols = grid.iter().map(Vec::len).max().unwrap_or(0);
        if ncols == 0 {
            return;
        }
        let mut natural = vec![MIN_COL_W; ncols];
        for row in &grid {
            for (ci, cell) in row.iter().enumerate() {
                let widest = self
                    .wrap(&cell.spans, size, f32::MAX, INK)
                    .iter()
                    .map(|l| l.iter().map(|s| s.lead + s.w).sum::<f32>())
                    .fold(0.0, f32::max);
                natural[ci] = natural[ci].max(widest + 2.0 * pad);
            }
        }
        let cols = fit_columns(&natural, w);
        let x0 = x + (w - cols.iter().sum::<f32>()) / 2.0;
        let wrapped: Vec<Vec<Vec<Vec<Seg>>>> = grid
            .iter()
            .map(|row| {
                row.iter()
                    .enumerate()
                    .map(|(ci, c)| self.wrap(&c.spans, size, cols[ci] - 2.0 * pad, INK))
                    .collect()
            })
            .collect();
        let heights: Vec<f32> = wrapped
            .iter()
            .map(|row| {
                row.iter().map(Vec::len).max().unwrap_or(1).max(1) as f32 * line_h + 2.0 * pad
            })
            .collect();

        let geom = Grid {
            cols: &cols,
            x0,
            pad,
        };
        self.gap(3.0);
        for ri in 0..grid.len() {
            // No single row alone at a page's top or bottom; the header
            // keeps two rows company.
            let keep = if ri == 0 {
                3
            } else {
                lines_to_keep(ri, grid.len())
            };
            let need: f32 = heights[ri..(ri + keep).min(grid.len())].iter().sum();
            if self.y + need > BOTTOM && self.y > TOP {
                self.new_page();
                if ri > 0 && heights[0] + heights[ri] <= BOTTOM - TOP {
                    self.table_row(&grid[0], &wrapped[0], &geom, heights[0], size);
                }
            }
            self.table_row(&grid[ri], &wrapped[ri], &geom, heights[ri], size);
        }
        self.gap(8.0);
    }

    fn table_row(
        &mut self,
        cells: &[Cell],
        wrapped: &[Vec<Vec<Seg>>],
        grid: &Grid,
        h: f32,
        size: f32,
    ) {
        let Grid { cols, x0, pad } = *grid;
        let top = self.y;
        let total_w: f32 = cols.iter().sum();
        let mut cx = x0;
        for (ci, lines) in wrapped.iter().enumerate() {
            let cell = &cells[ci];
            if cell.header {
                self.rect(cx, top, cols[ci], h, HEAD_BG);
            }
            for (li, line) in lines.iter().enumerate() {
                self.emit_line_at(
                    line,
                    cx + pad,
                    top + pad + li as f32 * size * 1.4,
                    cols[ci] - 2.0 * pad,
                    size,
                    cell.align,
                );
            }
            self.rect(cx, top, 0.6, h, RULE);
            cx += cols[ci];
        }
        self.rect(cx, top, 0.6, h, RULE);
        self.rect(x0, top, total_w, 0.6, RULE);
        self.rect(x0, top + h, total_w, 0.6, RULE);
        self.y = top + h;
    }
}

/// Lines that must fit before line `i` of `n` may be drawn: no single line is
/// left alone at the top or bottom of a page.
fn lines_to_keep(i: usize, n: usize) -> usize {
    if i == 0 || (n >= 4 && i + 2 == n) {
        n.min(2)
    } else {
        1
    }
}

fn heading_level(node: &Value) -> Option<u64> {
    (node.get("type").and_then(Value::as_str) == Some("heading")).then(|| {
        node.pointer("/attrs/level")
            .and_then(Value::as_u64)
            .unwrap_or(1)
    })
}

/// End of the section starting at `nodes[i]`: a heading's section runs to the
/// next heading of the same or a higher level, other content to the next heading.
fn section_end(nodes: &[Value], i: usize) -> usize {
    let level = heading_level(&nodes[i]);
    (i + 1..nodes.len())
        .find(|&j| heading_level(&nodes[j]).is_some_and(|l| level.is_none_or(|k| l <= k)))
        .unwrap_or(nodes.len())
}

#[derive(Clone, Copy)]
struct TextStyle {
    size: f32,
    color: Rgb,
}

/// Column layout of a table: widths, left edge, cell padding.
#[derive(Clone, Copy)]
struct Grid<'a> {
    cols: &'a [f32],
    x0: f32,
    pad: f32,
}

struct Cell {
    spans: Vec<Span>,
    align: Align,
    header: bool,
}

const MIN_COL_W: f32 = 30.0;

/// Nesting indent that never squeezes the text below a readable width, so a
/// pathologically deep list or quote stops indenting instead of leaving the page.
fn indent_for(width: f32, indent: f32) -> f32 {
    if width - indent >= MIN_TEXT_W {
        indent
    } else {
        0.0
    }
}

const MIN_TEXT_W: f32 = 120.0;

fn table_cells(row: &Value, header: bool) -> Vec<Cell> {
    let cells = row
        .get("content")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    cells
        .iter()
        .map(|cell| {
            let paras = cell
                .get("content")
                .and_then(Value::as_array)
                .map_or(&[][..], Vec::as_slice);
            let mut spans = Vec::new();
            for (pi, p) in paras.iter().enumerate() {
                if pi > 0 {
                    spans.push(Span {
                        text: "\n".into(),
                        ..Span::default()
                    });
                }
                inline(
                    p.get("content")
                        .and_then(Value::as_array)
                        .map_or(&[][..], Vec::as_slice),
                    &mut spans,
                    header,
                );
            }
            let align = match cell.pointer("/attrs/align").and_then(Value::as_str) {
                _ if header => Align::Center,
                Some("center") => Align::Center,
                Some("right") => Align::Right,
                _ => Align::Left,
            };
            Cell {
                spans,
                align,
                header,
            }
        })
        .collect()
}

/// Column widths: natural widths when they fit, otherwise the widest
/// columns are capped at a common limit so everything adds up to `w`.
fn fit_columns(natural: &[f32], w: f32) -> Vec<f32> {
    if natural.iter().sum::<f32>() <= w {
        return natural.to_vec();
    }
    let mut sorted = natural.to_vec();
    sorted.sort_by(f32::total_cmp);
    let (mut taken, mut cap) = (0.0, w / natural.len() as f32);
    for (i, v) in sorted.iter().enumerate() {
        let share = (w - taken) / (sorted.len() - i) as f32;
        if *v > share {
            cap = share;
            break;
        }
        taken += v;
    }
    natural.iter().map(|v| v.min(cap)).collect()
}

struct Word {
    text: String,
    face: Face,
    /// Style face of the surrounding span; measures the space before the word.
    lead_face: Face,
    link: Option<String>,
    space: bool,
}

enum Tok {
    Word(Word),
    Break,
}

/// Wrapped lines so far plus the line being built and its width.
#[derive(Default)]
struct LineBuf {
    lines: Vec<Vec<Seg>>,
    cur: Vec<Seg>,
    cur_w: f32,
}

impl LineBuf {
    fn break_line(&mut self) {
        self.lines.push(std::mem::take(&mut self.cur));
        self.cur_w = 0.0;
    }

    /// Appends a word to the line, merging it into the previous run when the
    /// style matches so the real space ends up in the text (copy/paste).
    fn push_word(&mut self, w: Word, lead: f32, ww: f32, color: Rgb, merge: bool) {
        let color = if w.link.is_some() { LINK } else { color };
        match self.cur.last_mut() {
            Some(last) if merge => {
                last.text.push(' ');
                last.text.push_str(&w.text);
                last.w += lead + ww;
            }
            _ => self.cur.push(Seg {
                text: w.text,
                face: w.face,
                w: ww,
                lead,
                link: w.link,
                color,
            }),
        }
        self.cur_w += lead + ww;
    }
}

fn inline(nodes: &[Value], out: &mut Vec<Span>, bold: bool) {
    for n in nodes {
        match n.get("type").and_then(Value::as_str) {
            Some("hard_break") => out.push(Span {
                text: "\n".into(),
                ..Span::default()
            }),
            // Image attachments aren't embedded; their file name stands in.
            Some("image") => out.push(Span {
                text: format!(
                    "[image: {}]",
                    n.pointer("/attrs/alt")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                ),
                bold,
                italic: true,
                ..Span::default()
            }),
            _ => {
                let Some(text) = n.get("text").and_then(Value::as_str) else {
                    continue;
                };
                let mut span = Span {
                    text: text.to_string(),
                    bold,
                    ..Span::default()
                };
                for m in n
                    .get("marks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    match m.get("type").and_then(Value::as_str) {
                        Some("strong") => span.bold = true,
                        Some("em") => span.italic = true,
                        Some("code") => span.code = true,
                        Some("link") => {
                            span.link = m
                                .pointer("/attrs/href")
                                .and_then(Value::as_str)
                                .filter(|u| is_safe_url(u))
                                .map(str::to_string)
                        }
                        _ => {}
                    }
                }
                out.push(span);
            }
        }
    }
}

/// Only links a PDF viewer may open without surprises stay links; the rest
/// (`javascript:`, `file:`, relative paths…) print as plain text.
fn is_safe_url(u: &str) -> bool {
    ["http://", "https://", "mailto:"]
        .iter()
        .any(|p| u.len() > p.len() && u[..p.len()].eq_ignore_ascii_case(p))
}

fn hex_color(s: &str) -> Rgb {
    let h = s.trim_start_matches('#');
    if h.len() == 6 {
        if let Ok(v) = u32::from_str_radix(h, 16) {
            return [(v >> 16) as u8, (v >> 8) as u8, v as u8];
        }
    }
    [0xdd, 0xdd, 0xdd]
}

fn human_size(n: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = n as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", UNITS[u])
    }
}

// ── entry point ──────────────────────────────────────────────────────────

pub fn render_card(export: &CardExport) -> Result<Vec<u8>, AppError> {
    replay(&layout_card(export)?, export)
}

fn layout_card(export: &CardExport) -> Result<Layout, AppError> {
    let card = &export.card;
    let mut l = Layout::new(Fonts::load()?);
    l.thumbs = export
        .attachments
        .iter()
        .filter_map(|(a, t)| Some((a.id.clone(), t.clone()?)))
        .collect();
    for (id, bytes) in &export.originals {
        if let Some(jpeg) = prepare_picture(bytes) {
            l.thumbs.insert(id.clone(), jpeg);
        }
    }

    // Title.
    let mut title = Vec::new();
    parse_md(&card.title, true, false, &mut title);
    l.flow(
        &title,
        MARGIN,
        CONTENT_W,
        TextStyle {
            size: 20.0,
            color: INK,
        },
        Align::Left,
        false,
    );
    l.gap(4.0);
    let status = export.exported_at.get(..16).unwrap_or(&export.exported_at);
    let board = [Span {
        text: format!(
            "Board: {}   \u{b7}   Status: {status} UTC",
            plain_md(&export.board_title)
        ),
        ..Span::default()
    }];
    l.flow(
        &board,
        MARGIN,
        CONTENT_W,
        TextStyle {
            size: 9.0,
            color: MUTED,
        },
        Align::Left,
        false,
    );
    l.gap(8.0);

    // Label chips.
    if !export.labels.is_empty() {
        let (size, pad_x, chip_h) = (9.0, 6.0, 15.0);
        let mut cx = 0.0;
        l.ensure(chip_h);
        for label in &export.labels {
            let name = l.fonts.truncate(
                Face::Regular,
                &plain_md(&label.name),
                size,
                CONTENT_W - 2.0 * pad_x,
            );
            let cw = l.fonts.runs_width(Face::Regular, &name, size) + 2.0 * pad_x;
            if cx > 0.0 && cx + cw > CONTENT_W {
                cx = 0.0;
                l.gap(chip_h + 4.0);
                l.ensure(chip_h);
            }
            let y = l.y;
            l.rect(MARGIN + cx, y, cw, chip_h, hex_color(&label.color));
            l.text_runs(
                MARGIN + cx + pad_x,
                y + 10.5,
                Face::Regular,
                size,
                INK,
                &name,
            );
            cx += cw + 5.0;
        }
        l.gap(chip_h + 8.0);
    }

    if let Some(due) = &card.due_date {
        let spans = [
            Span {
                text: "Due: ".into(),
                bold: true,
                ..Span::default()
            },
            Span {
                text: due.clone(),
                ..Span::default()
            },
        ];
        l.flow(
            &spans,
            MARGIN,
            CONTENT_W,
            TextStyle {
                size: 10.5,
                color: INK,
            },
            Align::Left,
            false,
        );
        l.gap(4.0);
    }

    // Description.
    let doc: Option<Value> = serde_json::from_str(&card.description).ok();
    let has_doc = doc.as_ref().is_some_and(|d| {
        d.get("content")
            .and_then(Value::as_array)
            .is_some_and(|c| !c.is_empty())
    });
    let plain_desc = doc.is_none() && !card.description.trim().is_empty();
    if has_doc || plain_desc {
        if let Some(d) = doc.filter(|_| has_doc) {
            let content = d
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            // The title is kept with the first heading's section, or else with
            // the first block only (a big first block must not drag it away).
            let by_heading = heading_level(&content[0]).is_some();
            let first = &content[..if by_heading {
                section_end(&content, 0)
            } else {
                1
            }];
            // A first block over half a page (e.g. a paragraph of big images)
            // flows from where the title is instead of moving as a whole.
            let max = if by_heading { f32::MAX } else { KEEP_MAX };
            l.keep_together_up_to(max, &|l| {
                l.heading_rule("Description", 0.0);
                l.blocks_inner(first, MARGIN, CONTENT_W, 10.5, INK, true);
            });
            l.blocks(&content[first.len()..], MARGIN, CONTENT_W, 10.5, INK);
        } else {
            l.heading_rule("Description", 0.0);
            for para in card.description.split("\n\n") {
                let spans = [Span {
                    text: para.to_string(),
                    ..Span::default()
                }];
                l.flow(
                    &spans,
                    MARGIN,
                    CONTENT_W,
                    TextStyle {
                        size: 10.5,
                        color: INK,
                    },
                    Align::Left,
                    true,
                );
                l.gap(5.0);
            }
        }
    }

    // Checklist: header and items move to a fresh page as a unit when they fit one.
    if !card.checklist.is_empty() {
        let (size, x, w) = (10.5, MARGIN + 20.0, CONTENT_W - 20.0);
        let done = card.checklist.iter().filter(|i| i.done).count();
        l.keep_together_up_to(f32::MAX, &|l| {
            l.heading_rule(&format!("Checklist ({done}/{})", card.checklist.len()), 0.0);
            for item in &card.checklist {
                let mark = if item.done { "\u{2611}" } else { "\u{2610}" };
                l.marker = Some((mark.to_string(), MARGIN));
                let spans = [Span {
                    text: item.text.clone(),
                    ..Span::default()
                }];
                let color = if item.done { MUTED } else { INK };
                l.flow(&spans, x, w, TextStyle { size, color }, Align::Left, false);
                l.marker = None;
                l.gap(2.0);
            }
        });
    }

    // Attachments: header and file list stay together; images follow.
    // Images already shown inline in the description aren't repeated here.
    let attachments: Vec<_> = export
        .attachments
        .iter()
        .filter(|(att, _)| !l.thumb_idx.contains_key(&att.id))
        .collect();
    if !attachments.is_empty() {
        let (size, x, w) = (10.0, MARGIN + 20.0, CONTENT_W - 20.0);
        let attachment_spans = |att: &Attachment| {
            vec![
                Span {
                    text: att.filename.clone(),
                    ..Span::default()
                },
                Span {
                    text: format!("  {} \u{b7} {}", human_size(att.size), att.content_type),
                    ..Span::default()
                },
            ]
        };
        let list_h: f32 = attachments
            .iter()
            .map(|(att, _)| {
                l.wrap(&attachment_spans(att), size, w, INK).len() as f32 * size * 1.4 + 2.0
            })
            .sum();
        l.heading_rule(&format!("Attachments ({})", attachments.len()), list_h);
        for (att, _) in &attachments {
            l.marker = Some(("\u{2022}".to_string(), MARGIN + 2.0));
            l.flow(
                &attachment_spans(att),
                x,
                w,
                TextStyle { size, color: INK },
                Align::Left,
                false,
            );
            l.marker = None;
            l.gap(2.0);
        }
        l.gap(6.0);
        place_images(&mut l, &attachments);
    }

    // Footer on every page.
    let total = l.pages.len();
    let footer_title =
        l.fonts
            .truncate(Face::Regular, &plain_md(&card.title), 8.0, CONTENT_W - 90.0);
    let mut footer_runs = Vec::new();
    let mut fx = MARGIN;
    for (face, text) in l.fonts.runs(Face::Regular, &footer_title) {
        let w = l.fonts.width(face, &text, 8.0);
        footer_runs.push((face, text, fx));
        fx += w;
    }
    for (i, ops) in l.pages.iter_mut().enumerate() {
        let n = format!("Page {} / {total}", i + 1);
        let nw = l.fonts.width(Face::Regular, &n, 8.0);
        let y = PAGE_H - 36.0;
        ops.push(Op::Rect {
            x: MARGIN,
            y: y - 12.0,
            w: CONTENT_W,
            h: 0.6,
            color: RULE,
        });
        for (face, text, x) in &footer_runs {
            ops.push(Op::Text {
                x: *x,
                y,
                face: *face,
                size: 8.0,
                color: MUTED,
                text: text.clone(),
            });
        }
        ops.push(Op::Text {
            x: PAGE_W - MARGIN - nw,
            y,
            face: Face::Regular,
            size: 8.0,
            color: MUTED,
            text: n,
        });
    }

    Ok(l)
}

/// Image thumbnails, packed left to right and wrapped.
fn place_images(l: &mut Layout, atts: &[&(Attachment, Option<Vec<u8>>)]) {
    const MAX: f32 = 230.0;
    let (mut cx, mut row_h) = (0.0f32, 0.0f32);
    for (_, thumb) in atts {
        let Some(bytes) = thumb else { continue };
        let Ok(img) = Image::from_jpeg(bytes.clone().into(), false) else {
            continue;
        };
        let (iw, ih) = img.size();
        if iw == 0 || ih == 0 {
            continue;
        }
        let scale = (MAX / iw as f32).min(MAX / ih as f32).min(1.0);
        let (w, h) = (iw as f32 * scale, ih as f32 * scale);
        if cx > 0.0 && cx + w > CONTENT_W {
            l.y += row_h + 8.0;
            cx = 0.0;
            row_h = 0.0;
        }
        if l.y + h > BOTTOM && l.y > TOP {
            l.new_page();
            cx = 0.0;
            row_h = 0.0;
        }
        l.images.push(img);
        let idx = l.images.len() - 1;
        let y = l.y;
        l.page().push(Op::Image {
            idx,
            x: MARGIN + cx,
            y,
            w,
            h,
        });
        cx += w + 10.0;
        row_h = row_h.max(h);
    }
    l.y += row_h;
}

fn replay(l: &Layout, export: &CardExport) -> Result<Vec<u8>, AppError> {
    let configuration = ConfigurationBuilder::new()
        .with_archival_validator(Archival::A2_U)
        .finish()
        .map_err(|e| internal(&format!("{e:?}")))?;
    let mut doc = Document::new_with(SerializeSettings {
        configuration,
        ..Default::default()
    });

    let title = plain_md(&export.card.title);
    let mut meta = Metadata::new()
        .title(if title.trim().is_empty() {
            "Untitled card".into()
        } else {
            title
        })
        .creator("Synkban".into())
        .producer("Synkban".into());
    if let Some(dt) = parse_timestamp(&export.exported_at) {
        meta = meta.creation_date(dt);
    }
    doc.set_metadata(meta);

    for ops in &l.pages {
        let mut page = doc.start_page_with(
            PageSettings::from_wh(PAGE_W, PAGE_H).ok_or_else(|| internal("page size"))?,
        );
        let mut links: Vec<Annotation> = Vec::new();
        {
            let mut s = page.surface();
            for op in ops {
                match op {
                    Op::Text {
                        x,
                        y,
                        face,
                        size,
                        color,
                        text,
                    } => {
                        s.set_fill(Some(fill(*color)));
                        s.draw_text(
                            Point::from_xy(*x, *y),
                            l.fonts.kr[*face as usize].clone(),
                            *size,
                            text,
                            false,
                            if face.rtl() {
                                TextDirection::RightToLeft
                            } else {
                                TextDirection::Auto
                            },
                        );
                    }
                    Op::Rect { x, y, w, h, color } => {
                        if let Some(r) = Rect::from_xywh(*x, *y, *w, *h) {
                            let mut pb = PathBuilder::new();
                            pb.push_rect(r);
                            if let Some(path) = pb.finish() {
                                s.set_fill(Some(fill(*color)));
                                s.draw_path(&path);
                            }
                        }
                    }
                    Op::Image { idx, x, y, w, h } => {
                        if let Some(size) = krilla::geom::Size::from_wh(*w, *h) {
                            s.push_transform(&krilla::geom::Transform::from_translate(*x, *y));
                            s.draw_image(l.images[*idx].clone(), size);
                            s.pop();
                        }
                    }
                    Op::Link { x, y, w, h, url } => {
                        if let Some(r) = Rect::from_xywh(*x, *y, *w, *h) {
                            links.push(Annotation::new_link(
                                LinkAnnotation::new(
                                    r,
                                    Target::Action(LinkAction::new(url.clone()).into()),
                                ),
                                Some(url.clone()),
                            ));
                        }
                    }
                }
            }
            s.finish();
        }
        for a in links {
            page.add_annotation(a);
        }
        page.finish();
    }
    doc.finish().map_err(|e| internal(&format!("{e:?}")))
}

fn fill(c: Rgb) -> Fill {
    Fill {
        paint: rgb::Color::new(c[0], c[1], c[2]).into(),
        ..Default::default()
    }
}

fn parse_timestamp(ts: &str) -> Option<DateTime> {
    let n = |r: std::ops::Range<usize>| ts.get(r)?.parse::<u32>().ok();
    Some(
        DateTime::new(n(0..4)? as u16)
            .month(n(5..7)? as u8)
            .day(n(8..10)? as u8)
            .hour(n(11..13)? as u8)
            .minute(n(14..16)? as u8)
            .second(n(17..19)? as u8),
    )
}

#[cfg(test)]
mod tests;
