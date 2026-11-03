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

use krilla::annotation::{Annotation, LinkAnnotation, Target};
use krilla::configure::{Archival, ConfigurationBuilder};
use krilla::action::LinkAction;
use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point, Rect};
use krilla::image::Image;
use krilla::metadata::{DateTime, Metadata};
use krilla::page::PageSettings;
use krilla::paint::Fill;
use krilla::text::{Font, Tag, TextDirection};
use krilla::{Document, SerializeSettings};
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
    /// `YYYY-MM-DD HH:MM:SS` UTC, stamped into the PDF metadata.
    pub exported_at: String,
}

const PAGE_W: f32 = 595.0;
const PAGE_H: f32 = 842.0;
const MARGIN: f32 = 50.0;
const TOP: f32 = 50.0;
const BOTTOM: f32 = PAGE_H - 62.0;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN;
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
const FALLBACKS: [Face; 6] =
    [Face::Regular, Face::Emoji, Face::Arabic, Face::Hebrew, Face::Devanagari, Face::Thai];

impl Face {
    fn rtl(self) -> bool {
        matches!(self, Face::Arabic | Face::Hebrew)
    }

    fn is_script(self) -> bool {
        matches!(self, Face::Arabic | Face::Hebrew | Face::Devanagari | Face::Thai)
    }

    /// The face a character belongs to by script, regardless of style.
    fn of_script(c: char) -> Option<Face> {
        match c as u32 {
            0x0590..=0x05FF | 0xFB1D..=0xFB4F => Some(Face::Hebrew),
            0x0600..=0x06FF | 0x0750..=0x077F | 0x08A0..=0x08FF | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF => {
                Some(Face::Arabic)
            }
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
                REGULAR_INSTANCE.iter().map(|(t, v)| (Tag::new(t), *v)).collect()
            } else {
                Vec::new()
            };
            kr.push(Font::new_variable(data.into(), 0, &coords).ok_or_else(|| internal("font load failed"))?);
            let mut face = rustybuzz::Face::from_slice(data, 0).ok_or_else(|| internal("font parse failed"))?;
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
            .filter(|c| !matches!(c, '\u{200B}'..='\u{200F}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}'))
            .filter(|c| *c == '\n' || !c.is_control())
            .map(|c| if c == '\n' || self.has(face, c) { c } else { '?' })
            .collect()
    }

    /// Shaped advance width, so kerning and contextual forms are counted.
    fn width(&self, face: Face, text: &str, size: f32) -> f32 {
        let f = &self.bz[face as usize];
        let mut buf = rustybuzz::UnicodeBuffer::new();
        buf.push_str(text);
        buf.guess_segment_properties();
        let shaped = rustybuzz::shape(f, &[], buf);
        let units: f32 = shaped.glyph_positions().iter().map(|p| p.x_advance as f32).sum();
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
        self.runs(primary, text).iter().map(|(f, t)| self.width(*f, t, size)).sum()
    }
}

fn internal(msg: &str) -> AppError {
    AppError::Io(std::io::Error::other(format!("PDF export: {msg}")))
}

// ── ops ──────────────────────────────────────────────────────────────────

enum Op {
    Text { x: f32, y: f32, face: Face, size: f32, color: Rgb, text: String },
    Rect { x: f32, y: f32, w: f32, h: f32, color: Rgb },
    Image { idx: usize, x: f32, y: f32, w: f32, h: f32 },
    Link { x: f32, y: f32, w: f32, h: f32, url: String },
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
            let Some(after) = rest.strip_prefix(marker) else { continue };
            let Some(end) = after.find(marker).filter(|&e| e > 0) else { continue };
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
        out.push(Span { text: std::mem::take(plain), bold, italic, ..Span::default() });
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

struct Layout {
    fonts: Fonts,
    pages: Vec<Vec<Op>>,
    images: Vec<Image>,
    y: f32,
    /// List marker waiting for the next line emitted: (text, x).
    marker: Option<(String, f32)>,
}

impl Layout {
    fn new(fonts: Fonts) -> Self {
        Layout { fonts, pages: vec![Vec::new()], images: Vec::new(), y: TOP, marker: None }
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
                    for (ri, (face, text)) in self.fonts.runs(primary, word).into_iter().enumerate() {
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

        let mut lines: Vec<Vec<Seg>> = Vec::new();
        let mut cur: Vec<Seg> = Vec::new();
        let mut cur_w = 0.0f32;
        for tok in toks {
            let w = match tok {
                Tok::Break => {
                    lines.push(std::mem::take(&mut cur));
                    cur_w = 0.0;
                    continue;
                }
                Tok::Word(w) => w,
            };
            let ww = self.fonts.width(w.face, &w.text, size);
            // Words of one style run share a segment, with a real space glyph
            // from that run's face in between (copy/paste, correct shaping).
            let merge = w.space
                && self.fonts.has(w.face, ' ')
                && cur.last().is_some_and(|l| l.face == w.face && l.link == w.link);
            let mut lead = match (w.space && !cur.is_empty(), merge) {
                (false, _) => 0.0,
                (true, true) => self.fonts.width(w.face, " ", size),
                (true, false) => self.fonts.width(w.lead_face, " ", size),
            };
            let mut merge = merge;
            if cur_w + lead + ww > width && !cur.is_empty() {
                lines.push(std::mem::take(&mut cur));
                cur_w = 0.0;
                lead = 0.0;
                merge = false;
            }
            if ww > width {
                self.split_long(&w, size, width, color, &mut lines, &mut cur, &mut cur_w);
            } else {
                add_word(&mut cur, &mut cur_w, w, lead, ww, color, merge);
            }
        }
        if !cur.is_empty() || lines.is_empty() {
            lines.push(cur);
        }
        lines
    }

    /// A single word wider than the line: hard-wrap it by characters. The
    /// last chunk stays open as the current line.
    #[allow(clippy::too_many_arguments)]
    fn split_long(
        &self,
        word: &Word,
        size: f32,
        width: f32,
        color: Rgb,
        lines: &mut Vec<Vec<Seg>>,
        cur: &mut Vec<Seg>,
        cur_w: &mut f32,
    ) {
        let color = if word.link.is_some() { LINK } else { color };
        let seg = |text: String, w: f32| Seg { text, face: word.face, w, lead: 0.0, link: word.link.clone(), color };
        if !cur.is_empty() {
            lines.push(std::mem::take(cur));
        }
        let mut chunk = String::new();
        let mut cw = 0.0;
        for c in word.text.chars() {
            let w1 = self.fonts.width(word.face, &c.to_string(), size);
            if cw + w1 > width && !chunk.is_empty() && w1 > 0.0 {
                lines.push(vec![seg(std::mem::take(&mut chunk), cw)]);
                cw = 0.0;
            }
            chunk.push(c);
            cw += w1;
        }
        *cur = vec![seg(chunk, cw)];
        *cur_w = cw;
    }

    /// Draws one wrapped line with its top at `top`.
    #[allow(clippy::too_many_arguments)]
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
            self.page().push(Op::Text { x: mx, y: base, face: Face::Regular, size, color: INK, text: m });
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
                self.page().push(Op::Link { x: cx, y: top, w: seg.w, h: line_h, url: url.clone() });
            }
            cx += seg.w;
        }
    }

    /// Flows wrapped lines down the page, breaking pages as needed.
    /// With `keep`, the block moves to the next page as a whole when it
    /// would otherwise be split — unless it is taller than a page.
    #[allow(clippy::too_many_arguments)]
    fn flow(&mut self, spans: &[Span], x: f32, width: f32, size: f32, color: Rgb, align: Align, keep: bool) {
        let lines = self.wrap(spans, size, width, color);
        let line_h = size * 1.4;
        let total = lines.len() as f32 * line_h;
        if keep && total <= BOTTOM - TOP {
            self.ensure(total);
        }
        // A paragraph that starts in a right-to-left script is right-aligned.
        let rtl = lines.first().and_then(|l| l.first()).is_some_and(|s| s.face.rtl());
        let align = if rtl && align == Align::Left { Align::Right } else { align };
        for line in &lines {
            self.ensure(line_h);
            let y = self.y;
            self.emit_line_at(line, x, y, width, size, align);
            self.y += line_h;
        }
    }

    /// Draws single-line text at a baseline, switching faces per run;
    /// returns its width.
    fn text_runs(&mut self, x: f32, y: f32, primary: Face, size: f32, color: Rgb, text: &str) -> f32 {
        let mut cx = x;
        for (face, t) in self.fonts.runs(primary, text) {
            let w = self.fonts.width(face, &t, size);
            self.page().push(Op::Text { x: cx, y, face, size, color, text: t });
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
        let spans = [Span { text: title.to_string(), bold: true, ..Span::default() }];
        self.flow(&spans, MARGIN, CONTENT_W, 12.0, MUTED, Align::Left, false);
        self.rect(MARGIN, self.y, CONTENT_W, 0.6, RULE);
        self.gap(8.0);
    }

    // ── ProseMirror ──────────────────────────────────────────────────────

    fn blocks(&mut self, nodes: &[Value], x: f32, w: f32, size: f32, color: Rgb) {
        for n in nodes {
            self.block(n, x, w, size, color);
        }
    }

    fn block(&mut self, node: &Value, x: f32, w: f32, size: f32, color: Rgb) {
        let kind = node.get("type").and_then(Value::as_str).unwrap_or("");
        let content: &[Value] = node.get("content").and_then(Value::as_array).map_or(&[], Vec::as_slice);
        match kind {
            "paragraph" => {
                let mut spans = Vec::new();
                inline(content, &mut spans, false);
                if spans.iter().all(|s| s.text.trim().is_empty()) {
                    self.gap(size * 0.7);
                } else {
                    self.flow(&spans, x, w, size, color, Align::Left, true);
                    self.gap(5.0);
                }
            }
            "heading" => {
                let level = node.pointer("/attrs/level").and_then(Value::as_u64).unwrap_or(1);
                let hs = match level {
                    1 => 18.0,
                    2 => 15.0,
                    _ => 13.0,
                };
                let mut spans = Vec::new();
                inline(content, &mut spans, true);
                self.ensure(hs * 1.4 + 9.0 + 2.0 * size * 1.4);
                self.gap(4.0);
                self.flow(&spans, x, w, hs, color, Align::Left, true);
                self.gap(5.0);
            }
            "code_block" => self.code_block(content, x, w),
            "bullet_list" | "ordered_list" => {
                let ordered = kind == "ordered_list";
                let start = node.pointer("/attrs/order").and_then(Value::as_u64).unwrap_or(1);
                let indent = indent_for(w, 20.0);
                for (i, item) in content.iter().enumerate() {
                    let marker = if ordered { format!("{}.", start + i as u64) } else { "\u{2022}".to_string() };
                    self.marker = Some((marker, x + 2.0));
                    let children = item.get("content").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
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
                        self.pages[p].push(Op::Rect { x: x + 2.0, y: y0, w: 2.5, h: y1 - y0 - 3.0, color: RULE });
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
                    self.flow(&spans, x, w, size, color, Align::Left, true);
                }
            }
        }
    }

    fn code_block(&mut self, content: &[Value], x: f32, w: f32) {
        let size = 9.0;
        let line_h = size * 1.4;
        let text: String = content.iter().filter_map(|c| c.get("text").and_then(Value::as_str)).collect();
        let text = self.fonts.sanitize(Face::Mono, &text);
        let span = [Span { text, code: true, ..Span::default() }];
        let lines = self.wrap_code(&span, size, w - 10.0);
        self.gap(2.0);
        if lines.len() as f32 * line_h <= BOTTOM - TOP {
            self.ensure(lines.len() as f32 * line_h);
        }
        for line in &lines {
            self.ensure(line_h);
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
                    lines.push(vec![Seg { text: std::mem::take(&mut chunk), face: Face::Mono, w: cw, lead: 0.0, link: None, color: INK }]);
                    cw = 0.0;
                }
                chunk.push(c);
                cw += w1;
            }
            lines.push(if chunk.is_empty() {
                Vec::new()
            } else {
                vec![Seg { text: chunk, face: Face::Mono, w: cw, lead: 0.0, link: None, color: INK }]
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
        let grid: Vec<Vec<Cell>> = rows.iter().enumerate().map(|(ri, r)| table_cells(r, ri == 0)).collect();
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
            .map(|row| row.iter().map(Vec::len).max().unwrap_or(1).max(1) as f32 * line_h + 2.0 * pad)
            .collect();

        self.gap(3.0);
        let total: f32 = heights.iter().sum();
        if total <= BOTTOM - TOP {
            self.ensure(total);
        }
        for ri in 0..grid.len() {
            // Keep the header company: never leave it alone at a page end.
            let need = heights[ri] + if ri == 0 { heights.get(1).copied().unwrap_or(0.0) } else { 0.0 };
            if self.y + need > BOTTOM && self.y > TOP {
                self.new_page();
                if ri > 0 && heights[0] + heights[ri] <= BOTTOM - TOP {
                    self.table_row(&grid[0], &wrapped[0], &cols, x0, heights[0], size, pad);
                }
            }
            self.table_row(&grid[ri], &wrapped[ri], &cols, x0, heights[ri], size, pad);
        }
        self.gap(8.0);
    }

    #[allow(clippy::too_many_arguments)]
    fn table_row(
        &mut self,
        cells: &[Cell],
        wrapped: &[Vec<Vec<Seg>>],
        cols: &[f32],
        x0: f32,
        h: f32,
        size: f32,
        pad: f32,
    ) {
        let top = self.y;
        let total_w: f32 = cols.iter().sum();
        let mut cx = x0;
        for (ci, lines) in wrapped.iter().enumerate() {
            let cell = &cells[ci];
            if cell.header {
                self.rect(cx, top, cols[ci], h, HEAD_BG);
            }
            for (li, line) in lines.iter().enumerate() {
                self.emit_line_at(line, cx + pad, top + pad + li as f32 * size * 1.4, cols[ci] - 2.0 * pad, size, cell.align);
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

struct Cell {
    spans: Vec<Span>,
    align: Align,
    header: bool,
}

const MIN_COL_W: f32 = 30.0;

/// Nesting indent that never squeezes the text below a readable width, so a
/// pathologically deep list or quote stops indenting instead of leaving the page.
fn indent_for(width: f32, indent: f32) -> f32 {
    if width - indent >= MIN_TEXT_W { indent } else { 0.0 }
}

const MIN_TEXT_W: f32 = 120.0;

fn table_cells(row: &Value, header: bool) -> Vec<Cell> {
    let cells = row.get("content").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    cells
        .iter()
        .map(|cell| {
            let paras = cell.get("content").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
            let mut spans = Vec::new();
            for (pi, p) in paras.iter().enumerate() {
                if pi > 0 {
                    spans.push(Span { text: "\n".into(), ..Span::default() });
                }
                inline(p.get("content").and_then(Value::as_array).map_or(&[][..], Vec::as_slice), &mut spans, header);
            }
            let align = match cell.pointer("/attrs/align").and_then(Value::as_str) {
                _ if header => Align::Center,
                Some("center") => Align::Center,
                Some("right") => Align::Right,
                _ => Align::Left,
            };
            Cell { spans, align, header }
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

/// Appends a word to the line, merging it into the previous run when the
/// style matches so the real space ends up in the text (copy/paste).
fn add_word(cur: &mut Vec<Seg>, cur_w: &mut f32, w: Word, lead: f32, ww: f32, color: Rgb, merge: bool) {
    let color = if w.link.is_some() { LINK } else { color };
    match cur.last_mut() {
        Some(last) if merge => {
            last.text.push(' ');
            last.text.push_str(&w.text);
            last.w += lead + ww;
        }
        _ => cur.push(Seg { text: w.text, face: w.face, w: ww, lead, link: w.link, color }),
    }
    *cur_w += lead + ww;
}

fn inline(nodes: &[Value], out: &mut Vec<Span>, bold: bool) {
    for n in nodes {
        match n.get("type").and_then(Value::as_str) {
            Some("hard_break") => out.push(Span { text: "\n".into(), ..Span::default() }),
            _ => {
                let Some(text) = n.get("text").and_then(Value::as_str) else { continue };
                let mut span = Span { text: text.to_string(), bold, ..Span::default() };
                for m in n.get("marks").and_then(Value::as_array).into_iter().flatten() {
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
    ["http://", "https://", "mailto:"].iter().any(|p| u.len() > p.len() && u[..p.len()].eq_ignore_ascii_case(p))
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
    if u == 0 { format!("{n} B") } else { format!("{v:.1} {}", UNITS[u]) }
}

// ── entry point ──────────────────────────────────────────────────────────

pub fn render_card(export: &CardExport) -> Result<Vec<u8>, AppError> {
    replay(&layout_card(export)?, export)
}

fn layout_card(export: &CardExport) -> Result<Layout, AppError> {
    let card = &export.card;
    let mut l = Layout::new(Fonts::load()?);

    // Title.
    let mut title = Vec::new();
    parse_md(&card.title, true, false, &mut title);
    l.flow(&title, MARGIN, CONTENT_W, 20.0, INK, Align::Left, false);
    l.gap(4.0);
    let status = export.exported_at.get(..16).unwrap_or(&export.exported_at);
    let board = [Span {
        text: format!("Board: {}   \u{b7}   Status: {status} UTC", plain_md(&export.board_title)),
        ..Span::default()
    }];
    l.flow(&board, MARGIN, CONTENT_W, 9.0, MUTED, Align::Left, false);
    l.gap(8.0);

    // Label chips.
    if !export.labels.is_empty() {
        let (size, pad_x, chip_h) = (9.0, 6.0, 15.0);
        let mut cx = 0.0;
        l.ensure(chip_h);
        for label in &export.labels {
            let name = l.fonts.truncate(Face::Regular, &plain_md(&label.name), size, CONTENT_W - 2.0 * pad_x);
            let cw = l.fonts.runs_width(Face::Regular, &name, size) + 2.0 * pad_x;
            if cx > 0.0 && cx + cw > CONTENT_W {
                cx = 0.0;
                l.gap(chip_h + 4.0);
                l.ensure(chip_h);
            }
            let y = l.y;
            l.rect(MARGIN + cx, y, cw, chip_h, hex_color(&label.color));
            l.text_runs(MARGIN + cx + pad_x, y + 10.5, Face::Regular, size, INK, &name);
            cx += cw + 5.0;
        }
        l.gap(chip_h + 8.0);
    }

    if let Some(due) = &card.due_date {
        let spans = [
            Span { text: "Due: ".into(), bold: true, ..Span::default() },
            Span { text: due.clone(), ..Span::default() },
        ];
        l.flow(&spans, MARGIN, CONTENT_W, 10.5, INK, Align::Left, false);
        l.gap(4.0);
    }

    // Description.
    let doc: Option<Value> = serde_json::from_str(&card.description).ok();
    let has_doc = doc
        .as_ref()
        .is_some_and(|d| d.get("content").and_then(Value::as_array).is_some_and(|c| !c.is_empty()));
    let plain_desc = doc.is_none() && !card.description.trim().is_empty();
    if has_doc || plain_desc {
        l.heading_rule("Description", 0.0);
        if let Some(d) = doc.filter(|_| has_doc) {
            let content = d.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
            l.blocks(&content, MARGIN, CONTENT_W, 10.5, INK);
        } else {
            for para in card.description.split("\n\n") {
                let spans = [Span { text: para.to_string(), ..Span::default() }];
                l.flow(&spans, MARGIN, CONTENT_W, 10.5, INK, Align::Left, true);
                l.gap(5.0);
            }
        }
    }

    // Checklist: header and items stay together when they fit on a page.
    if !card.checklist.is_empty() {
        let (size, x, w) = (10.5, MARGIN + 20.0, CONTENT_W - 20.0);
        let items_h: f32 = card
            .checklist
            .iter()
            .map(|i| {
                let spans = [Span { text: i.text.clone(), ..Span::default() }];
                l.wrap(&spans, size, w, INK).len() as f32 * size * 1.4 + 2.0
            })
            .sum();
        let done = card.checklist.iter().filter(|i| i.done).count();
        l.heading_rule(&format!("Checklist ({done}/{})", card.checklist.len()), items_h);
        for item in &card.checklist {
            let mark = if item.done { "\u{2611}" } else { "\u{2610}" };
            l.marker = Some((mark.to_string(), MARGIN));
            let spans = [Span { text: item.text.clone(), ..Span::default() }];
            let color = if item.done { MUTED } else { INK };
            l.flow(&spans, x, w, size, color, Align::Left, false);
            l.marker = None;
            l.gap(2.0);
        }
    }

    // Attachments: header and file list stay together; images follow.
    if !export.attachments.is_empty() {
        let (size, x, w) = (10.0, MARGIN + 20.0, CONTENT_W - 20.0);
        let attachment_spans = |att: &Attachment| {
            vec![
                Span { text: att.filename.clone(), ..Span::default() },
                Span { text: format!("  {} \u{b7} {}", human_size(att.size), att.content_type), ..Span::default() },
            ]
        };
        let list_h: f32 = export
            .attachments
            .iter()
            .map(|(att, _)| l.wrap(&attachment_spans(att), size, w, INK).len() as f32 * size * 1.4 + 2.0)
            .sum();
        l.heading_rule(&format!("Attachments ({})", export.attachments.len()), list_h);
        for (att, _) in &export.attachments {
            l.marker = Some(("\u{2022}".to_string(), MARGIN + 2.0));
            l.flow(&attachment_spans(att), x, w, size, INK, Align::Left, false);
            l.marker = None;
            l.gap(2.0);
        }
        l.gap(6.0);
        place_images(&mut l, &export.attachments);
    }

    // Footer on every page.
    let total = l.pages.len();
    let footer_title = l.fonts.truncate(Face::Regular, &plain_md(&card.title), 8.0, CONTENT_W - 90.0);
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
        ops.push(Op::Rect { x: MARGIN, y: y - 12.0, w: CONTENT_W, h: 0.6, color: RULE });
        for (face, text, x) in &footer_runs {
            ops.push(Op::Text { x: *x, y, face: *face, size: 8.0, color: MUTED, text: text.clone() });
        }
        ops.push(Op::Text { x: PAGE_W - MARGIN - nw, y, face: Face::Regular, size: 8.0, color: MUTED, text: n });
    }

    Ok(l)
}

/// Image thumbnails, packed left to right and wrapped.
fn place_images(l: &mut Layout, atts: &[(Attachment, Option<Vec<u8>>)]) {
    const MAX: f32 = 230.0;
    let (mut cx, mut row_h) = (0.0f32, 0.0f32);
    for (_, thumb) in atts {
        let Some(bytes) = thumb else { continue };
        let Ok(img) = Image::from_jpeg(bytes.clone().into(), false) else { continue };
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
        l.page().push(Op::Image { idx, x: MARGIN + cx, y, w, h });
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
    let mut doc = Document::new_with(SerializeSettings { configuration, ..Default::default() });

    let title = plain_md(&export.card.title);
    let mut meta = Metadata::new()
        .title(if title.trim().is_empty() { "Untitled card".into() } else { title })
        .creator("Synkban".into())
        .producer("Synkban".into());
    if let Some(dt) = parse_timestamp(&export.exported_at) {
        meta = meta.creation_date(dt);
    }
    doc.set_metadata(meta);

    for ops in &l.pages {
        let mut page = doc.start_page_with(PageSettings::from_wh(PAGE_W, PAGE_H).ok_or_else(|| internal("page size"))?);
        let mut links: Vec<Annotation> = Vec::new();
        {
            let mut s = page.surface();
            for op in ops {
                match op {
                    Op::Text { x, y, face, size, color, text } => {
                        s.set_fill(Some(fill(*color)));
                        s.draw_text(
                            Point::from_xy(*x, *y),
                            l.fonts.kr[*face as usize].clone(),
                            *size,
                            text,
                            false,
                            if face.rtl() { TextDirection::RightToLeft } else { TextDirection::Auto },
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
                                LinkAnnotation::new(r, Target::Action(LinkAction::new(url.clone()).into())),
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
    Fill { paint: rgb::Color::new(c[0], c[1], c[2]).into(), ..Default::default() }
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
