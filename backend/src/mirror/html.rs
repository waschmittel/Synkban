//! Semantic HTML rendering for individual cards (`card.html`) and the
//! standalone master-detail explorer (`index.html`), compatible with both
//! `file://` and `http(s)://`.

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;

use serde_json::Value;

use crate::models::{Attachment, Card, Label};
use crate::store::{MirrorArchivedCard, MirrorBoard, MirrorSnapshot};

pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// Renders card/label inline `**bold**` and `*italic*` markdown to semantic HTML
/// matching `Card.tsx::renderTitle`. Escapes HTML entities first.
pub fn render_title_html(title: &str) -> String {
    let escaped = escape_html(title);
    let with_bold = replace_delimited(&escaped, "**", "<strong>", "</strong>");
    replace_delimited(&with_bold, "*", "<em>", "</em>")
}

/// Strips inline `**bold**` and `*italic*` delimiters for plain-text contexts
/// such as `<title>` and `data-search`.
pub fn strip_title_markdown(title: &str) -> String {
    let no_bold = replace_delimited(title, "**", "", "");
    replace_delimited(&no_bold, "*", "", "")
}

fn replace_delimited(input: &str, delim: &str, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find(delim) {
        let after_open = &rest[start + delim.len()..];
        // Non-greedy match on the same line without crossing newlines.
        if let Some(end) = after_open.find(delim) {
            if end > 0 && !after_open[..end].contains('\n') {
                out.push_str(&rest[..start]);
                out.push_str(open);
                out.push_str(&after_open[..end]);
                out.push_str(close);
                rest = &after_open[end + delim.len()..];
                continue;
            }
        }
        out.push_str(&rest[..start + delim.len()]);
        rest = after_open;
    }
    out.push_str(rest);
    out
}

/// Percent-encodes a single URI path segment, leaving ASCII `[A-Za-z0-9._-]` literal.
pub fn encode_path_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

fn hex_to_rgb(s: &str) -> Option<[u8; 3]> {
    let h = s.trim().strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

fn relative_luminance([r, g, b]: [u8; 3]) -> f64 {
    let lin = |c: u8| {
        let s = f64::from(c) / 255.0;
        if s <= 0.04045 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

pub fn label_fg_hex(bg_hex: &str) -> &'static str {
    let Some(bg) = hex_to_rgb(bg_hex) else {
        return "#000000";
    };
    let l_bg = relative_luminance(bg);
    let contrast_white = (1.0 + 0.05) / (l_bg + 0.05);
    let contrast_black = (l_bg + 0.05) / (0.0 + 0.05);
    if contrast_white > contrast_black {
        "#ffffff"
    } else {
        "#000000"
    }
}

fn is_safe_url(u: &str) -> bool {
    ["http://", "https://", "mailto:"]
        .iter()
        .any(|p| u.len() > p.len() && u[..p.len()].eq_ignore_ascii_case(p))
}

fn fnv1a_32_hex(s: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for c in s.encode_utf16() {
        h ^= u32::from(c);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{h:08x}")
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

struct FootnoteCtx<'a> {
    defs: HashMap<&'a str, &'a Value>,
    order: Vec<(String, usize)>,
    ref_counts: HashMap<String, usize>,
    ref_ids: Vec<(String, String)>, // (id, back_anchor_id)
}

impl<'a> FootnoteCtx<'a> {
    fn from_doc(doc: &'a Value) -> Self {
        let mut defs = HashMap::new();
        if let Some(content) = doc.get("content").and_then(Value::as_array) {
            for node in content {
                if node.get("type").and_then(Value::as_str) == Some("footnote_list") {
                    if let Some(items) = node.get("content").and_then(Value::as_array) {
                        for def in items {
                            if def.get("type").and_then(Value::as_str) == Some("footnote_def") {
                                if let Some(id) = def.pointer("/attrs/id").and_then(Value::as_str) {
                                    defs.insert(id, def);
                                }
                            }
                        }
                    }
                }
            }
        }
        Self {
            defs,
            order: Vec::new(),
            ref_counts: HashMap::new(),
            ref_ids: Vec::new(),
        }
    }

    fn register_ref(&mut self, id: &str) -> Option<(usize, String)> {
        if !self.defs.contains_key(id) {
            return None;
        }
        let num = if let Some((_, n)) = self.order.iter().find(|(k, _)| k == id) {
            *n
        } else {
            let n = self.order.len() + 1;
            self.order.push((id.to_string(), n));
            n
        };
        let occ = self.ref_counts.entry(id.to_string()).or_insert(0);
        *occ += 1;
        let anchor = format!("fnref-{num}-{}", *occ);
        if *occ == 1 {
            self.ref_ids.push((id.to_string(), anchor.clone()));
        }
        Some((num, anchor))
    }
}

struct CardRenderCtx<'a> {
    attachments: &'a BTreeMap<String, String>,
    att_by_id: HashMap<&'a str, &'a Attachment>,
    footnotes: FootnoteCtx<'a>,
}

/// Renders one saved card into standalone semantic HTML linking `../../../../style.css`.
pub fn render_card_html(
    board: &MirrorBoard,
    list_label: &str,
    card: &Card,
    is_archived: bool,
    att_filenames: &BTreeMap<String, String>,
) -> String {
    let mut out = String::with_capacity(4096);
    let plain_title = strip_title_markdown(&card.title);
    let board_color = board.color.as_deref().unwrap_or("#0079bf");

    let label_map: HashMap<&str, &Label> =
        board.labels.iter().map(|l| (l.id.as_str(), l)).collect();
    let ordered_labels: Vec<&Label> = board
        .labels
        .iter()
        .filter(|l| card.label_ids.contains(&l.id))
        .collect();
    let _ = label_map;

    let _ = writeln!(
        out,
        "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>{} — {}</title>\n  <link rel=\"stylesheet\" href=\"../../../../style.css\">\n</head>\n<body class=\"card-page\">\n<article class=\"card-doc\">",
        escape_html(&plain_title),
        escape_html(&board.title)
    );

    out.push_str("  <header class=\"card-header\">\n");
    let _ = writeln!(
        out,
        "    <div class=\"card-breadcrumb\"><span class=\"board-dot\" style=\"--board-color:{}\"></span><span>{}</span><span aria-hidden=\"true\">›</span><span>{}</span>{}</div>",
        escape_html(board_color),
        escape_html(&board.title),
        escape_html(list_label),
        if is_archived || board.archived {
            " <span class=\"badge-archived\">Archived</span>"
        } else {
            ""
        }
    );
    let _ = writeln!(
        out,
        "    <h1 class=\"card-title\">{}</h1>",
        render_title_html(&card.title)
    );

    if !ordered_labels.is_empty() {
        out.push_str("    <ul class=\"card-labels\" aria-label=\"Labels\">\n");
        for lbl in ordered_labels {
            let fg = label_fg_hex(&lbl.color);
            let _ = writeln!(
                out,
                "      <li class=\"label\" style=\"--label-bg:{};--label-fg:{}\">{}</li>",
                escape_html(&lbl.color),
                fg,
                render_title_html(&lbl.name)
            );
        }
        out.push_str("    </ul>\n");
    }

    out.push_str("    <dl class=\"card-meta\">\n");
    let _ = writeln!(
        out,
        "      <div><dt>Created:</dt><dd>{} UTC</dd></div>",
        escape_html(&card.created_at)
    );
    if let Some(due) = card.due_date.as_deref() {
        let _ = writeln!(
            out,
            "      <div><dt>Due:</dt><dd><time datetime=\"{}\">{}</time></dd></div>",
            escape_html(due),
            escape_html(due)
        );
    }
    if let Some(arch) = card.archived_at.as_deref().filter(|_| card.archived) {
        let _ = writeln!(
            out,
            "      <div><dt>Archived:</dt><dd>{} UTC</dd></div>",
            escape_html(arch)
        );
    }
    out.push_str("    </dl>\n  </header>\n");

    // Description
    if !card.description.trim().is_empty() {
        if let Ok(doc) = serde_json::from_str::<Value>(&card.description) {
            let att_by_id = card
                .attachments
                .iter()
                .map(|a| (a.id.as_str(), a))
                .collect();
            let mut ctx = CardRenderCtx {
                attachments: att_filenames,
                att_by_id,
                footnotes: FootnoteCtx::from_doc(&doc),
            };
            let mut body_html = String::new();
            if let Some(nodes) = doc.get("content").and_then(Value::as_array) {
                render_blocks(nodes, &mut body_html, &mut ctx);
            }
            let footnotes_html = render_footnotes(&ctx.footnotes);
            if !body_html.trim().is_empty() || !footnotes_html.is_empty() {
                out.push_str(
                    "  <section class=\"card-section card-description\">\n    <h2>Description</h2>\n",
                );
                out.push_str(&body_html);
                out.push_str(&footnotes_html);
                out.push_str("  </section>\n");
            }
        }
    }

    // Checklist
    if !card.checklist.is_empty() {
        let done_count = card.checklist.iter().filter(|i| i.done).count();
        let _ = writeln!(
            out,
            "  <section class=\"card-section\">\n    <h2>Checklist ({done_count}/{})</h2>\n    <ul class=\"checklist\">",
            card.checklist.len()
        );
        for item in &card.checklist {
            let checked = if item.done { " checked" } else { "" };
            let _ = writeln!(
                out,
                "      <li data-done=\"{}\"><label><input type=\"checkbox\" disabled{checked}><span>{}</span></label></li>",
                item.done,
                escape_html(&item.text)
            );
        }
        out.push_str("    </ul>\n  </section>\n");
    }

    // Attachments
    if !card.attachments.is_empty() {
        let mut ordered_atts: Vec<&Attachment> = card.attachments.iter().collect();
        ordered_atts.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        out.push_str(
            "  <section class=\"card-section\">\n    <h2>Attachments</h2>\n    <ul class=\"attachment-list\">\n",
        );
        for att in ordered_atts {
            let disk_name = att_filenames
                .get(&att.id)
                .map(String::as_str)
                .unwrap_or(&att.id);
            let href = format!("./attachments/{}", encode_path_segment(disk_name));
            let _ = writeln!(
                out,
                "      <li><a href=\"{}\" target=\"_blank\" rel=\"noopener\">{}</a><span class=\"attachment-meta\">{} · {}</span></li>",
                escape_html(&href),
                escape_html(&att.filename),
                escape_html(&human_size(att.size)),
                escape_html(&att.content_type)
            );
        }
        out.push_str("    </ul>\n  </section>\n");
    }

    out.push_str("</article>\n</body>\n</html>\n");
    out
}

fn render_blocks(nodes: &[Value], out: &mut String, ctx: &mut CardRenderCtx<'_>) {
    for node in nodes {
        let kind = node.get("type").and_then(Value::as_str).unwrap_or("");
        let content = node
            .get("content")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        match kind {
            "paragraph" => {
                out.push_str("<p>");
                render_inline(content, out, ctx);
                out.push_str("</p>\n");
            }
            "heading" => {
                let level = node
                    .pointer("/attrs/level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 3);
                // Card title is h1, section headers are h2; map description h1..h3 -> h2..h4
                let tag = match level {
                    1 => "h2",
                    2 => "h3",
                    _ => "h4",
                };
                let _ = write!(out, "<{tag}>");
                render_inline(content, out, ctx);
                let _ = writeln!(out, "</{tag}>");
            }
            "blockquote" => {
                out.push_str("<blockquote>\n");
                render_blocks(content, out, ctx);
                out.push_str("</blockquote>\n");
            }
            "alert" => {
                let raw_kind = node
                    .pointer("/attrs/kind")
                    .and_then(Value::as_str)
                    .unwrap_or("note");
                let (cls, title) = match raw_kind {
                    "tip" => ("tip", "Tip"),
                    "important" => ("important", "Important"),
                    "warning" => ("warning", "Warning"),
                    "caution" => ("caution", "Caution"),
                    _ => ("note", "Note"),
                };
                let _ = writeln!(
                    out,
                    "<aside class=\"alert alert--{cls}\">\n<strong class=\"alert-title\">{title}</strong>"
                );
                render_blocks(content, out, ctx);
                out.push_str("</aside>\n");
            }
            "code_block" => {
                let code_text: String = content
                    .iter()
                    .filter_map(|n| n.get("text").and_then(Value::as_str))
                    .collect();
                let _ = writeln!(out, "<pre><code>{}</code></pre>", escape_html(&code_text));
            }
            "lua_block" => {
                let code_text: String = content
                    .iter()
                    .filter_map(|n| n.get("text").and_then(Value::as_str))
                    .collect();
                let output = node.pointer("/attrs/output").and_then(Value::as_str);
                let error = node.pointer("/attrs/error").and_then(Value::as_str);
                let ran_hash = node.pointer("/attrs/ran_hash").and_then(Value::as_str);
                let has_result = output.is_some() || error.is_some();
                let stale = has_result && ran_hash != Some(fnv1a_32_hex(&code_text).as_str());
                let header = if stale { "Lua (outdated)" } else { "Lua" };

                out.push_str("<div class=\"lua-block\">\n");
                let _ = writeln!(out, "<div class=\"lua-header\">{header}</div>");
                let _ = writeln!(
                    out,
                    "<pre><code class=\"language-lua\">{}</code></pre>",
                    escape_html(&code_text)
                );
                if has_result {
                    out.push_str("<div class=\"lua-result\">");
                    if let Some(out_str) = output.filter(|s| !s.is_empty() || error.is_none()) {
                        let rendered = if out_str.is_empty() {
                            "→ (no output)".to_string()
                        } else {
                            out_str
                                .split('\n')
                                .map(|l| format!("→ {l}"))
                                .collect::<Vec<_>>()
                                .join("\n")
                        };
                        let _ = write!(out, "<samp>{}</samp>", escape_html(&rendered));
                    }
                    if let Some(err_str) = error {
                        if output.is_some() {
                            out.push('\n');
                        }
                        let rendered = err_str
                            .split('\n')
                            .map(|l| format!("! {l}"))
                            .collect::<Vec<_>>()
                            .join("\n");
                        let _ = write!(
                            out,
                            "<samp class=\"lua-error\">{}</samp>",
                            escape_html(&rendered)
                        );
                    }
                    out.push_str("</div>\n");
                }
                out.push_str("</div>\n");
            }
            "bullet_list" => {
                out.push_str("<ul>\n");
                render_list_items(content, out, ctx);
                out.push_str("</ul>\n");
            }
            "ordered_list" => {
                let order = node
                    .pointer("/attrs/order")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                if order != 1 {
                    let _ = writeln!(out, "<ol start=\"{order}\">");
                } else {
                    out.push_str("<ol>\n");
                }
                render_list_items(content, out, ctx);
                out.push_str("</ol>\n");
            }
            "table" => {
                let matrix = node
                    .pointer("/attrs/matrix")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                render_table(content, matrix, out, ctx);
            }
            "footnote_list" => {}
            _ => {
                if !content.is_empty() {
                    render_blocks(content, out, ctx);
                } else if node.get("text").is_some() {
                    render_inline(std::slice::from_ref(node), out, ctx);
                }
            }
        }
    }
}

fn render_list_items(items: &[Value], out: &mut String, ctx: &mut CardRenderCtx<'_>) {
    for item in items {
        out.push_str("<li>");
        if let Some(blocks) = item.get("content").and_then(Value::as_array) {
            render_blocks(blocks, out, ctx);
        }
        out.push_str("</li>\n");
    }
}

fn render_table(rows: &[Value], matrix: bool, out: &mut String, ctx: &mut CardRenderCtx<'_>) {
    if rows.is_empty() {
        return;
    }
    let class = if matrix {
        "doc-table doc-table--matrix"
    } else {
        "doc-table"
    };
    out.push_str("<div class=\"table-wrap\">\n<table class=\"");
    out.push_str(class);
    out.push_str("\">\n");
    for (ri, row) in rows.iter().enumerate() {
        let cells = row
            .get("content")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        out.push_str("<tr>");
        for (ci, cell) in cells.iter().enumerate() {
            let corner = matrix && ri == 0 && ci == 0;
            let cell_type = cell.get("type").and_then(Value::as_str).unwrap_or("");
            let is_header = if matrix {
                !corner && ((ri == 0) || (ci == 0) || cell_type == "table_header")
            } else {
                ri == 0 || cell_type == "table_header"
            };
            let tag = if is_header { "th" } else { "td" };
            let align = cell
                .pointer("/attrs/align")
                .and_then(Value::as_str)
                .filter(|a| matches!(*a, "left" | "center" | "right"));
            let colspan = cell
                .pointer("/attrs/colspan")
                .and_then(Value::as_u64)
                .unwrap_or(1);
            let rowspan = cell
                .pointer("/attrs/rowspan")
                .and_then(Value::as_u64)
                .unwrap_or(1);

            let _ = write!(out, "<{tag}");
            if corner {
                out.push_str(" class=\"matrix-corner\"");
            }
            if colspan > 1 {
                let _ = write!(out, " colspan=\"{colspan}\"");
            }
            if rowspan > 1 {
                let _ = write!(out, " rowspan=\"{rowspan}\"");
            }
            if let Some(a) = align {
                let _ = write!(out, " data-align=\"{a}\"");
            }
            out.push('>');
            if !corner {
                if let Some(paras) = cell.get("content").and_then(Value::as_array) {
                    if paras.len() == 1
                        && paras[0].get("type").and_then(Value::as_str) == Some("paragraph")
                    {
                        let inner = paras[0]
                            .get("content")
                            .and_then(Value::as_array)
                            .map_or(&[][..], Vec::as_slice);
                        render_inline(inner, out, ctx);
                    } else {
                        render_blocks(paras, out, ctx);
                    }
                }
            }
            let _ = write!(out, "</{tag}>");
        }
        out.push_str("</tr>\n");
    }
    out.push_str("</table>\n</div>\n");
}

fn render_inline(nodes: &[Value], out: &mut String, ctx: &mut CardRenderCtx<'_>) {
    for n in nodes {
        match n.get("type").and_then(Value::as_str) {
            Some("hard_break") => out.push_str("<br>"),
            Some("footnote_ref") => {
                if let Some(id) = n.pointer("/attrs/id").and_then(Value::as_str) {
                    if let Some((num, anchor)) = ctx.footnotes.register_ref(id) {
                        let _ = write!(
                            out,
                            "<sup id=\"{anchor}\"><a href=\"#fn-{num}\">[{num}]</a></sup>"
                        );
                    }
                }
            }
            Some("image") => {
                let att_id = n
                    .pointer("/attrs/att")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let alt = n
                    .pointer("/attrs/alt")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if let Some(disk_name) = ctx.attachments.get(att_id) {
                    let src = format!("./attachments/{}", encode_path_segment(disk_name));
                    let label = if alt.is_empty() {
                        ctx.att_by_id
                            .get(att_id)
                            .map(|a| a.filename.as_str())
                            .unwrap_or("")
                    } else {
                        alt
                    };
                    let _ = write!(
                        out,
                        "<img class=\"inline-image\" src=\"{}\" alt=\"{}\">",
                        escape_html(&src),
                        escape_html(label)
                    );
                } else {
                    let label = if alt.is_empty() { "image" } else { alt };
                    let _ = write!(
                        out,
                        "<span class=\"inline-image-missing\">[missing image: {}]</span>",
                        escape_html(label)
                    );
                }
            }
            _ => {
                let Some(text) = n.get("text").and_then(Value::as_str) else {
                    continue;
                };
                let mut bold = false;
                let mut italic = false;
                let mut code = false;
                let mut highlight: Option<&str> = None;
                let mut link_href: Option<&str> = None;
                let mut link_title: Option<&str> = None;

                if let Some(marks) = n.get("marks").and_then(Value::as_array) {
                    for m in marks {
                        match m.get("type").and_then(Value::as_str) {
                            Some("strong") => bold = true,
                            Some("em") => italic = true,
                            Some("code") => code = true,
                            Some("highlight") => {
                                highlight = m
                                    .pointer("/attrs/color")
                                    .and_then(Value::as_str)
                                    .filter(|c| {
                                        matches!(
                                            *c,
                                            "yellow"
                                                | "orange"
                                                | "red"
                                                | "pink"
                                                | "purple"
                                                | "blue"
                                                | "green"
                                                | "gray"
                                        )
                                    });
                            }
                            Some("link") => {
                                link_href = m
                                    .pointer("/attrs/href")
                                    .and_then(Value::as_str)
                                    .filter(|u| is_safe_url(u));
                                link_title = m.pointer("/attrs/title").and_then(Value::as_str);
                            }
                            _ => {}
                        }
                    }
                }

                let mut seg = escape_html(text);
                if code {
                    seg = format!("<code>{seg}</code>");
                }
                if italic {
                    seg = format!("<em>{seg}</em>");
                }
                if bold {
                    seg = format!("<strong>{seg}</strong>");
                }
                if let Some(color) = highlight {
                    seg = format!("<mark data-color=\"{color}\">{seg}</mark>");
                }
                if let Some(href) = link_href {
                    let title_attr = link_title
                        .filter(|t| !t.is_empty())
                        .map(|t| format!(" title=\"{}\"", escape_html(t)))
                        .unwrap_or_default();
                    seg = format!(
                        "<a href=\"{}\"{title_attr} target=\"_blank\" rel=\"noopener noreferrer\">{seg}</a>",
                        escape_html(href)
                    );
                }
                out.push_str(&seg);
            }
        }
    }
}

fn render_footnotes(footnotes: &FootnoteCtx<'_>) -> String {
    if footnotes.order.is_empty() {
        return String::new();
    }
    let mut out = String::from("<section class=\"footnotes\" aria-label=\"Footnotes\">\n<ol>\n");
    for (id, num) in &footnotes.order {
        let Some(def) = footnotes.defs.get(id.as_str()) else {
            continue;
        };
        let back_id = footnotes
            .ref_ids
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, a)| a.as_str())
            .unwrap_or("");
        let _ = write!(out, "<li id=\"fn-{num}\">");
        if let Some(paras) = def.get("content").and_then(Value::as_array) {
            for (pi, p) in paras.iter().enumerate() {
                if pi > 0 {
                    out.push_str("<br>");
                }
                if let Some(inline_nodes) = p.get("content").and_then(Value::as_array) {
                    for n in inline_nodes {
                        match n.get("type").and_then(Value::as_str) {
                            Some("hard_break") => out.push_str("<br>"),
                            _ => {
                                if let Some(t) = n.get("text").and_then(Value::as_str) {
                                    out.push_str(&escape_html(t));
                                }
                            }
                        }
                    }
                }
            }
        }
        if !back_id.is_empty() {
            let _ = write!(
                out,
                " <a class=\"footnote-back\" href=\"#{back_id}\" aria-label=\"Back to reference\">↩</a>"
            );
        }
        out.push_str("</li>\n");
    }
    out.push_str("</ol>\n</section>\n");
    out
}

/// Renders the standalone root `index.html` master-detail explorer.
pub fn render_index_html(snapshot: &MirrorSnapshot) -> String {
    let mut out = String::with_capacity(8192);
    let first_card = find_first_card(snapshot);

    out.push_str(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Synkban Readable Mirror</title>\n  <link rel=\"stylesheet\" href=\"style.css\">\n</head>\n<body class=\"mirror-index\">\n<div class=\"mirror-shell\">\n  <aside class=\"mirror-sidebar\">\n    <div class=\"mirror-sidebar-header\">\n      <h1 class=\"mirror-title\">Synkban Mirror</h1>\n      <input type=\"search\" id=\"mirror-search\" class=\"mirror-search\" placeholder=\"Filter boards, lists, cards, labels…\" aria-label=\"Filter cards\" autocomplete=\"off\">\n    </div>\n    <nav class=\"mirror-tree\" id=\"mirror-tree\" aria-label=\"Boards and cards\">\n",
    );

    if snapshot.active_boards.is_empty() && snapshot.archived_boards.is_empty() {
        out.push_str("      <p class=\"mirror-empty\">No boards in this mirror yet.</p>\n");
    } else {
        for board in &snapshot.active_boards {
            render_board_tree(board, first_card.as_ref(), &mut out);
        }
        if !snapshot.archived_boards.is_empty() {
            let _ = writeln!(
                out,
                "      <details class=\"archived-boards-group\">\n        <summary class=\"archived-boards-summary\">Archived boards <span class=\"group-count\">{}</span></summary>",
                snapshot.archived_boards.len()
            );
            for board in &snapshot.archived_boards {
                render_board_tree(board, first_card.as_ref(), &mut out);
            }
            out.push_str("      </details>\n");
        }
    }

    out.push_str(
        "      <p class=\"mirror-empty\" id=\"mirror-no-match\" hidden>No matching cards.</p>\n",
    );
    out.push_str("    </nav>\n  </aside>\n  <main class=\"mirror-main\">\n");

    if let Some((href, path_label)) = first_card {
        let _ = writeln!(
            out,
            "    <div class=\"mirror-toolbar\">\n      <span class=\"mirror-breadcrumb\" id=\"detail-breadcrumb\">{}</span>\n      <a class=\"mirror-open-link\" id=\"detail-open-standalone\" href=\"{}\" target=\"_blank\" rel=\"noopener\">Open standalone ↗</a>\n    </div>\n    <iframe class=\"detail-frame\" name=\"detail\" id=\"detail-frame\" src=\"{}\" title=\"Card detail\"></iframe>",
            escape_html(&path_label),
            escape_html(&href),
            escape_html(&href),
        );
    } else {
        out.push_str("    <div class=\"mirror-main-empty\">No cards found in any board.</div>\n");
    }

    out.push_str("  </main>\n</div>\n");
    out.push_str(INDEX_SCRIPT);
    out.push_str("</body>\n</html>\n");
    out
}

fn card_rel_href(board_id: &str, card_id: &str) -> String {
    format!(
        "boards/{}/cards/{}/card.html",
        encode_path_segment(board_id),
        encode_path_segment(card_id)
    )
}

fn find_first_card(snapshot: &MirrorSnapshot) -> Option<(String, String)> {
    for b in snapshot
        .active_boards
        .iter()
        .chain(snapshot.archived_boards.iter())
    {
        for l in &b.lists {
            if let Some(c) = l.cards.first() {
                return Some((
                    card_rel_href(&b.id, &c.id),
                    format!(
                        "{} › {} › {}",
                        b.title,
                        l.title,
                        strip_title_markdown(&c.title)
                    ),
                ));
            }
        }
        if let Some(ac) = b.archived_cards.first() {
            return Some((
                card_rel_href(&b.id, &ac.card.id),
                format!(
                    "{} › Archived › {}",
                    b.title,
                    strip_title_markdown(&ac.card.title)
                ),
            ));
        }
    }
    None
}

fn render_board_tree(board: &MirrorBoard, first_card: Option<&(String, String)>, out: &mut String) {
    let total_active: usize = board.lists.iter().map(|l| l.cards.len()).sum();
    let total_cards = total_active + board.archived_cards.len();
    let color = board.color.as_deref().unwrap_or("#0079bf");
    let _ = writeln!(
        out,
        "      <details class=\"board-group\">\n        <summary class=\"board-summary\"><span class=\"board-dot\" style=\"--board-color:{}\"></span><span>{}</span><span class=\"group-count\">{total_cards}</span></summary>",
        escape_html(color),
        escape_html(&board.title),
    );

    let label_names: HashMap<&str, String> = board
        .labels
        .iter()
        .map(|l| (l.id.as_str(), strip_title_markdown(&l.name)))
        .collect();

    for list in &board.lists {
        let _ = writeln!(
            out,
            "        <details class=\"list-group\">\n          <summary class=\"list-summary\"><span>{}</span><span class=\"group-count\">{}</span></summary>\n          <ul class=\"card-list\">",
            escape_html(&list.title),
            list.cards.len()
        );
        for card in &list.cards {
            render_card_nav_item(
                board,
                &list.title,
                card,
                false,
                &label_names,
                first_card,
                out,
            );
        }
        out.push_str("          </ul>\n        </details>\n");
    }

    if !board.archived_cards.is_empty() {
        let _ = writeln!(
            out,
            "        <details class=\"list-group list-group--archived\">\n          <summary class=\"list-summary\"><span>Archived cards</span><span class=\"group-count\">{}</span></summary>\n          <ul class=\"card-list\">",
            board.archived_cards.len()
        );
        for MirrorArchivedCard {
            card,
            origin_list_title,
        } in &board.archived_cards
        {
            let list_label = origin_list_title
                .as_deref()
                .map(|t| format!("Archived (from {t})"))
                .unwrap_or_else(|| "Archived (orphaned)".to_string());
            render_card_nav_item(
                board,
                &list_label,
                card,
                true,
                &label_names,
                first_card,
                out,
            );
        }
        out.push_str("          </ul>\n        </details>\n");
    }

    out.push_str("      </details>\n");
}

fn render_card_nav_item(
    board: &MirrorBoard,
    list_label: &str,
    card: &Card,
    is_archived: bool,
    label_names: &HashMap<&str, String>,
    first_card: Option<&(String, String)>,
    out: &mut String,
) {
    let href = card_rel_href(&board.id, &card.id);
    let active_cls = if first_card.is_some_and(|(h, _)| h == &href) {
        " is-active"
    } else {
        ""
    };
    let plain_title = strip_title_markdown(&card.title);
    let breadcrumb = format!("{} › {} › {}", board.title, list_label, plain_title);
    let mut search_parts = vec![
        board.title.clone(),
        list_label.to_string(),
        plain_title,
        card.description_text.clone(),
    ];
    for lid in &card.label_ids {
        if let Some(name) = label_names.get(lid.as_str()) {
            search_parts.push(name.clone());
        }
    }
    if let Some(due) = &card.due_date {
        search_parts.push(due.clone());
    }
    let search_haystack = search_parts.join(" ").to_lowercase();

    let meta = if is_archived {
        Some("archived".to_string())
    } else {
        card.due_date.clone()
    };
    let meta_html = meta
        .map(|m| format!("<span class=\"card-link-meta\">{}</span>", escape_html(&m)))
        .unwrap_or_default();

    let _ = writeln!(
        out,
        "            <li class=\"card-item\"><a class=\"card-link{active_cls}\" href=\"{}\" target=\"detail\" data-board=\"{}\" data-card=\"{}\" data-path=\"{}\" data-search=\"{}\"><span>{}</span>{meta_html}</a></li>",
        escape_html(&href),
        escape_html(&board.id),
        escape_html(&card.id),
        escape_html(&breadcrumb),
        escape_html(&search_haystack),
        render_title_html(&card.title),
    );
}

const INDEX_SCRIPT: &str = r##"<script>
(() => {
  const tree = document.getElementById("mirror-tree");
  const search = document.getElementById("mirror-search");
  const frame = document.getElementById("detail-frame");
  const breadcrumb = document.getElementById("detail-breadcrumb");
  const openLink = document.getElementById("detail-open-standalone");
  const noMatch = document.getElementById("mirror-no-match");
  if (!tree) return;

  const links = Array.from(tree.querySelectorAll("a.card-link"));

  function activate(link, options = {}) {
    if (!link) return;
    for (const l of links) l.classList.toggle("is-active", l === link);
    let p = link.parentElement;
    while (p && p !== tree) {
      if (p.tagName === "DETAILS") p.open = true;
      p = p.parentElement;
    }
    const href = link.getAttribute("href");
    if (frame && href && options.loadFrame !== false) {
      if (frame.getAttribute("src") !== href) frame.setAttribute("src", href);
    }
    if (breadcrumb) breadcrumb.textContent = link.dataset.path || "";
    if (openLink && href) openLink.setAttribute("href", href);
    if (options.updateHash !== false && link.dataset.board && link.dataset.card) {
      try {
        history.replaceState(null, "", "#" + link.dataset.board + "/" + link.dataset.card);
      } catch {}
    }
    if (options.scrollIntoView) {
      link.scrollIntoView({ block: "nearest" });
    }
  }

  function applyHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const parts = raw.split("/");
    if (parts.length !== 2) return;
    const match = links.find(
      (l) => l.dataset.board === parts[0] && l.dataset.card === parts[1]
    );
    if (match) activate(match, { updateHash: false, scrollIntoView: true });
  }

  tree.addEventListener("click", (e) => {
    const link = e.target.closest("a.card-link");
    if (!link) return;
    e.preventDefault();
    activate(link);
  });

  tree.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const active = document.activeElement?.closest?.("a.card-link");
    if (!active) return;
    const visible = links.filter((l) => !l.closest(".card-item")?.hidden);
    const idx = visible.indexOf(active);
    if (idx < 0) return;
    const next = visible[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    activate(next);
  });

  if (search) {
    const applyFilter = () => {
      const q = search.value.trim().toLowerCase();
      let anyVisible = false;
      for (const link of links) {
        const item = link.closest(".card-item");
        const hit = !q || (link.dataset.search || "").includes(q);
        item.hidden = !hit;
        if (hit) anyVisible = true;
      }
      const hasHash = !!location.hash.replace(/^#/, "");
      for (const lg of tree.querySelectorAll(".list-group")) {
        const hasCard = !!lg.querySelector(".card-item:not([hidden])");
        lg.hidden = !hasCard;
        if (q && hasCard) lg.open = true;
        else if (!q) lg.open = hasHash && !!lg.querySelector("a.card-link.is-active");
      }
      for (const bg of tree.querySelectorAll(".board-group")) {
        const hasList = !!bg.querySelector(".list-group:not([hidden])");
        bg.hidden = !hasList;
        if (q && hasList) bg.open = true;
        else if (!q) bg.open = hasHash && !!bg.querySelector("a.card-link.is-active");
      }
      const archGroup = tree.querySelector(".archived-boards-group");
      if (archGroup) {
        const hasBoard = !!archGroup.querySelector(".board-group:not([hidden])");
        archGroup.hidden = !hasBoard;
        if (q && hasBoard) archGroup.open = true;
        else if (!q) archGroup.open = hasHash && !!archGroup.querySelector("a.card-link.is-active");
      }
      if (noMatch) noMatch.hidden = anyVisible || links.length === 0;
    };
    search.addEventListener("input", applyFilter);
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && search.value) {
        search.value = "";
        applyFilter();
      }
    });
  }

  window.addEventListener("hashchange", applyHash);
  applyHash();
})();
</script>
"##;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BoardMode, ChecklistItem};

    #[test]
    fn title_markdown_and_escaping() {
        assert_eq!(
            render_title_html("Fix **<script>** & *italic*"),
            "Fix <strong>&lt;script&gt;</strong> &amp; <em>italic</em>"
        );
        assert_eq!(strip_title_markdown("**Bold** & *Italic*"), "Bold & Italic");
    }

    #[test]
    fn card_html_renders_rich_elements_and_footnotes() {
        let board = MirrorBoard {
            id: "b1".into(),
            title: "Roadmap".into(),
            created_at: "2026-01-01 00:00:00".into(),
            color: Some("#1f2937".into()),
            archived: false,
            archived_at: None,
            position: 1.0,
            mode: BoardMode::Kanban,
            labels: vec![Label {
                id: "l1".into(),
                name: "**Urgent**".into(),
                color: "#111111".into(),
            }],
            lists: vec![],
            archived_cards: vec![],
        };
        let mut att_names = BTreeMap::new();
        att_names.insert("att1".into(), "shot.png".into());
        att_names.insert("att2".into(), "att2.tar.gz".into());

        let lua_code = "return 1 + 1";
        let lua_hash = fnv1a_32_hex(lua_code);
        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Summary" }] },
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "Note", "marks": [{ "type": "highlight", "attrs": { "color": "blue" } }] },
                    { "type": "text", "text": " " },
                    { "type": "text", "text": "docs", "marks": [{ "type": "link", "attrs": { "href": "https://example.com", "title": null } }] },
                    { "type": "text", "text": " " },
                    { "type": "text", "text": "bad", "marks": [{ "type": "link", "attrs": { "href": "javascript:alert(1)", "title": null } }] },
                    { "type": "footnote_ref", "attrs": { "id": "f1" } },
                    { "type": "image", "attrs": { "att": "att1", "alt": "shot" } }
                ]},
                { "type": "alert", "attrs": { "kind": "warning" }, "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Watch out" }] }
                ]},
                { "type": "lua_block", "attrs": { "output": "2", "error": null, "ran_hash": lua_hash }, "content": [
                    { "type": "text", "text": lua_code }
                ]},
                { "type": "table", "attrs": { "matrix": true }, "content": [
                    { "type": "table_row", "content": [
                        { "type": "table_cell", "attrs": {}, "content": [{ "type": "paragraph" }] },
                        { "type": "table_header", "attrs": {}, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Col" }] }] }
                    ]},
                    { "type": "table_row", "content": [
                        { "type": "table_header", "attrs": {}, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Row" }] }] },
                        { "type": "table_cell", "attrs": { "align": "right" }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "42" }] }] }
                    ]}
                ]},
                { "type": "footnote_list", "content": [
                    { "type": "footnote_def", "attrs": { "id": "f1" }, "content": [
                        { "type": "footnote_paragraph", "content": [{ "type": "text", "text": "First note" }] }
                    ]},
                    { "type": "footnote_def", "attrs": { "id": "orphan" }, "content": [
                        { "type": "footnote_paragraph", "content": [{ "type": "text", "text": "Ignored" }] }
                    ]}
                ]}
            ]
        });

        let card = Card {
            id: "c1".into(),
            list_id: "list1".into(),
            title: "Ship *v1*".into(),
            description: doc.to_string(),
            description_text: "Note docs".into(),
            position: 1.0,
            created_at: "2026-01-01 10:00:00".into(),
            label_ids: vec!["l1".into()],
            archived: false,
            archived_at: None,
            attachments: vec![
                Attachment {
                    id: "att1".into(),
                    filename: "shot.png".into(),
                    size: 1200,
                    content_type: "image/png".into(),
                    created_at: "2026-01-01 10:01:00".into(),
                },
                Attachment {
                    id: "att2".into(),
                    filename: "Backup (1).tar.gz".into(),
                    size: 2048,
                    content_type: "application/gzip".into(),
                    created_at: "2026-01-01 10:02:00".into(),
                },
            ],
            due_date: Some("2026-12-01".into()),
            checklist: vec![ChecklistItem {
                id: "ck1".into(),
                text: "Verify".into(),
                done: true,
            }],
            history: vec![],
        };

        let html = render_card_html(&board, "Todo", &card, false, &att_names);
        assert!(html.contains("../../../../style.css"));
        assert!(html.contains("<h1 class=\"card-title\">Ship <em>v1</em></h1>"));
        assert!(html.contains("--label-bg:#111111;--label-fg:#ffffff"));
        assert!(html.contains("<mark data-color=\"blue\">Note</mark>"));
        assert!(html.contains("href=\"https://example.com\" target=\"_blank\""));
        assert!(!html.contains("javascript:alert(1)"));
        assert!(html.contains("href=\"#fn-1\""));
        assert!(html.contains("First note"));
        assert!(!html.contains("Ignored"));
        assert!(html.contains("class=\"alert alert--warning\""));
        assert!(html.contains("<div class=\"lua-header\">Lua</div>"));
        assert!(html.contains("→ 2"));
        assert!(html.contains("class=\"matrix-corner\""));
        assert!(html.contains("data-align=\"right\""));
        assert!(html.contains("src=\"./attachments/shot.png\""));
        assert!(html.contains("href=\"./attachments/att2.tar.gz\""));
        assert!(html.contains("Backup (1).tar.gz"));
        assert!(html.contains("data-done=\"true\""));
    }

    #[test]
    fn index_html_collapses_tree_groups_by_default() {
        let snapshot = MirrorSnapshot {
            active_boards: vec![MirrorBoard {
                id: "b1".into(),
                title: "Roadmap".into(),
                created_at: "2026-01-01 00:00:00".into(),
                color: None,
                archived: false,
                archived_at: None,
                position: 1.0,
                mode: BoardMode::Kanban,
                labels: vec![],
                lists: vec![crate::store::MirrorList {
                    id: "l1".into(),
                    title: "Todo".into(),
                    position: 1.0,
                    created_at: "2026-01-01 00:00:00".into(),
                    cards: vec![Card {
                        id: "c1".into(),
                        list_id: "l1".into(),
                        title: "Card".into(),
                        description: String::new(),
                        description_text: String::new(),
                        position: 1.0,
                        created_at: "2026-01-01 00:00:00".into(),
                        label_ids: vec![],
                        archived: false,
                        archived_at: None,
                        attachments: vec![],
                        due_date: None,
                        checklist: vec![],
                        history: vec![],
                    }],
                }],
                archived_cards: vec![],
            }],
            archived_boards: vec![],
            warnings: vec![],
        };
        let html = render_index_html(&snapshot);
        assert!(html.contains("<details class=\"board-group\">"));
        assert!(html.contains("<details class=\"list-group\">"));
        assert!(!html.contains("<details class=\"board-group\" open>"));
        assert!(!html.contains("<details class=\"list-group\" open>"));
    }
}
