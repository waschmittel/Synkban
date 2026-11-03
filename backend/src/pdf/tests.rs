use super::*;
use crate::models::ChecklistItem;

fn sample_card(description: &str) -> Card {
    Card {
        id: "c1".into(),
        list_id: "l1".into(),
        title: "Ship **PDF** export \u{2014} *now* \u{1F680}".into(),
        description: description.into(),
        description_text: String::new(),
        position: 1.0,
        created_at: "2026-01-01 00:00:00".into(),
        label_ids: vec![],
        archived: false,
        archived_at: None,
        attachments: vec![],
        due_date: Some("2026-12-24".into()),
        checklist: vec![
            ChecklistItem { id: "1".into(), text: "write it".into(), done: true },
            ChecklistItem { id: "2".into(), text: "test it, with a rather long line that has to wrap around the page edge at least once or twice".into(), done: false },
        ],
        history: vec![],
    }
}

fn export(description: &str) -> CardExport {
    CardExport {
        card: sample_card(description),
        board_title: "Roadmap".into(),
        labels: vec![
            Label { id: "a".into(), name: "**Urgent**".into(), color: "#f5c6cb".into() },
            Label { id: "b".into(), name: "Backend".into(), color: "#c6e0f5".into() },
        ],
        attachments: vec![(
            Attachment {
                id: "x".into(),
                filename: "notes.txt".into(),
                size: 2048,
                content_type: "text/plain".into(),
                created_at: "2026-01-01 00:00:00".into(),
            },
            None,
        )],
        exported_at: "2026-11-03 12:00:00".into(),
    }
}

const RICH: &str = r##"{"type":"doc","content":[
  {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Heading"}]},
  {"type":"paragraph","content":[{"type":"text","text":"Plain "},{"type":"text","marks":[{"type":"strong"}],"text":"bold"},{"type":"text","text":" and "},{"type":"text","marks":[{"type":"em"}],"text":"italic"},{"type":"text","text":" and "},{"type":"text","marks":[{"type":"code"}],"text":"code"},{"type":"text","text":" and "},{"type":"text","marks":[{"type":"link","attrs":{"href":"https://example.com"}}],"text":"a link"},{"type":"text","text":" plus unicode äöü € and emoji 🚀 and Averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongwordthatcannotwrapnormally."}]},
  {"type":"bullet_list","content":[
    {"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]},{"type":"ordered_list","attrs":{"order":1},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"nested"}]}]}]}]},
    {"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"two"}]}]}]},
  {"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"quoted text"}]}]},
  {"type":"code_block","content":[{"type":"text","text":"fn main() {\n    println!(\"hi\");\n}"}]},
  {"type":"table","content":[
    {"type":"table_row","content":[{"type":"table_header","attrs":{"align":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"table_header","attrs":{"align":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}]},
    {"type":"table_row","content":[{"type":"table_cell","attrs":{"align":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"1"}]}]},{"type":"table_cell","attrs":{"align":"right"},"content":[{"type":"paragraph","content":[{"type":"text","text":"2"}]}]}]}]}
]}"##;

#[test]
fn renders_pdfa_with_rich_content() {
    let pdf = render_card(&export(RICH)).expect("renders");
    assert!(pdf.starts_with(b"%PDF-"));
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.contains("pdfaid"), "XMP must declare the PDF/A part");
    assert!(text.contains("FontFile"), "fonts must be embedded");
    if let Ok(out) = std::env::var("PDF_TEST_OUT") {
        std::fs::write(out, &pdf).unwrap();
    }
}

const INTL: &str = r##"{"type":"doc","content":[
  {"type":"paragraph","content":[{"type":"text","text":"Emoji: 🚀 🎉 ❤ ✅ 🔥 😀 👍 and flags 🇩🇪 and a ZWJ family 👨‍👩‍👧 with tone 👍🏽."}]},
  {"type":"paragraph","content":[{"type":"text","text":"Deutsch: Größe, Straße, Übung. Français: déjà vu, œuvre. Español: ¿Qué pasó? Русский: Привет, мир. Ελληνικά: Γειά σου κόσμε."}]},
  {"type":"paragraph","content":[{"type":"text","text":"العربية: مرحبا بالعالم 123 وهذا نص أطول قليلا للتحقق من التفاف الأسطر في المستند."}]},
  {"type":"paragraph","content":[{"type":"text","text":"עברית: שלום עולם, זהו טקסט בעברית."}]},
  {"type":"paragraph","content":[{"type":"text","text":"हिन्दी: नमस्ते दुनिया, यह एक परीक्षण है।"}]},
  {"type":"paragraph","content":[{"type":"text","text":"ไทย: สวัสดีชาวโลก นี่คือข้อความทดสอบภาษาไทยที่ยาวพอสมควรเพื่อทดสอบการตัดบรรทัด"}]},
  {"type":"paragraph","content":[{"type":"text","text":"CJK (no font): 你好世界 こんにちは 안녕하세요"}]}
]}"##;

fn wide_table(rows: usize) -> String {
    let row = |kind: &str, cells: &[&str]| {
        let cs: Vec<String> = cells
            .iter()
            .map(|t| format!(r#"{{"type":"{kind}","attrs":{{"align":null}},"content":[{{"type":"paragraph","content":[{{"type":"text","text":"{t}"}}]}}]}}"#))
            .collect();
        format!(r#"{{"type":"table_row","content":[{}]}}"#, cs.join(","))
    };
    let mut all = vec![row("table_header", &["Name", "Qty", "Notes"])];
    for i in 0..rows {
        all.push(row("table_cell", &["item", &i.to_string(), "short note"]));
    }
    format!(r#"{{"type":"doc","content":[{{"type":"table","content":[{}]}}]}}"#, all.join(","))
}

#[test]
fn international_text_and_emoji_render() {
    let pdf = render_card(&export(INTL)).expect("renders");
    if let Ok(out) = std::env::var("PDF_TEST_OUT_INTL") {
        std::fs::write(out, &pdf).unwrap();
    }
}

#[test]
fn status_line_carries_creation_date() {
    let l = layout_card(&export("")).unwrap();
    let first_page: String = l.pages[0]
        .iter()
        .filter_map(|op| if let Op::Text { text, .. } = op { Some(text.as_str()) } else { None })
        .collect::<Vec<_>>()
        .join(" ");
    assert!(first_page.contains("Status: 2026-11-03 12:00 UTC"), "{first_page}");
}

fn page_texts(l: &Layout, page: usize) -> Vec<&str> {
    l.pages[page]
        .iter()
        .filter_map(|op| if let Op::Text { text, .. } = op { Some(text.as_str()) } else { None })
        .collect()
}

#[test]
fn short_table_is_kept_whole_and_centered() {
    // Fill most of page one so the table would straddle the break.
    let filler: Vec<String> = (0..44)
        .map(|i| format!(r#"{{"type":"paragraph","content":[{{"type":"text","text":"Filler paragraph {i}"}}]}}"#))
        .collect();
    let table = wide_table(6);
    let table_node = &table[table.find(r#"{"type":"table""#).unwrap()..table.len() - 2];
    let doc = format!(r#"{{"type":"doc","content":[{},{}]}}"#, filler.join(","), table_node);
    let l = layout_card(&export(&doc)).unwrap();
    let in_page = |p: usize| page_texts(&l, p).iter().filter(|t| **t == "item").count();
    assert_eq!(in_page(0) + in_page(1), 6);
    assert!(in_page(0) == 0 || in_page(0) == 6, "table split: {} on page 1", in_page(0));
    let left = l.pages.iter().flatten().filter_map(|op| match op {
        Op::Rect { x, w, h, .. } if *h < 1.0 && *w > 100.0 && *w < CONTENT_W - 1.0 => Some(*x),
        _ => None,
    });
    // A table narrower than the page starts right of the margin.
    assert!(left.clone().count() > 0 && left.into_iter().all(|x| x > MARGIN));
}

#[test]
fn long_table_splits_and_repeats_header() {
    let l = layout_card(&export(&wide_table(120))).unwrap();
    if let Ok(out) = std::env::var("PDF_TEST_OUT_TABLE") {
        std::fs::write(out, render_card(&export(&wide_table(120))).unwrap()).unwrap();
    }
    assert!(l.pages.len() >= 2);
    for p in 0..l.pages.len() - 1 {
        let headers = page_texts(&l, p).iter().filter(|t| **t == "Name").count();
        assert_eq!(headers, 1, "page {p} must start with the header");
    }
}

#[test]
fn checklist_stays_with_its_header() {
    let mut e = export("");
    let filler: Vec<String> = (0..47)
        .map(|i| format!(r#"{{"type":"paragraph","content":[{{"type":"text","text":"Filler {i}"}}]}}"#))
        .collect();
    e.card.description = format!(r#"{{"type":"doc","content":[{}]}}"#, filler.join(","));
    let l = layout_card(&e).unwrap();
    for p in 0..l.pages.len() {
        let texts = page_texts(&l, p);
        let header = texts.iter().any(|t| t.starts_with("Checklist"));
        let items = texts.iter().any(|t| t.starts_with("write it"));
        assert_eq!(header, items, "page {p}: checklist header and items must share a page");
    }
}

#[test]
fn long_description_paginates() {
    let paras: Vec<String> = (0..120)
        .map(|i| format!(r#"{{"type":"paragraph","content":[{{"type":"text","text":"Paragraph {i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor."}}]}}"#))
        .collect();
    let doc = format!(r#"{{"type":"doc","content":[{}]}}"#, paras.join(","));
    let pages = layout_card(&export(&doc)).expect("lays out").pages.len();
    render_card(&export(&doc)).expect("renders");
    assert!(pages >= 3, "got {pages} pages");
}

#[test]
fn empty_and_plain_descriptions() {
    render_card(&export("")).expect("empty");
    render_card(&export("not json at all")).expect("plain text");
}

#[test]
fn markdown_titles_parse() {
    let mut spans = Vec::new();
    parse_md("a **b** *c* d*", false, false, &mut spans);
    let flat: String = spans.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(flat, "a b c d*");
    assert!(spans.iter().any(|s| s.bold && s.text == "b"));
    assert!(spans.iter().any(|s| s.italic && s.text == "c"));
}

// ── helpers ──────────────────────────────────────────────────────────────

use serde_json::json;

fn text_node(t: &str) -> Value {
    json!({"type": "text", "text": t})
}

fn para(t: &str) -> Value {
    json!({"type": "paragraph", "content": [text_node(t)]})
}

fn doc(nodes: Vec<Value>) -> String {
    json!({"type": "doc", "content": nodes}).to_string()
}

fn table_node(rows: &[Vec<&str>]) -> Value {
    let rows: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(ri, cells)| {
            let kind = if ri == 0 { "table_header" } else { "table_cell" };
            let cells: Vec<Value> = cells
                .iter()
                .map(|t| {
                    let content = if t.is_empty() { json!([]) } else { json!([para(t)]) };
                    json!({"type": kind, "attrs": {"align": null}, "content": content})
                })
                .collect();
            json!({"type": "table_row", "content": cells})
        })
        .collect();
    json!({"type": "table", "content": rows})
}

fn list_node(kind: &str, items: Vec<Vec<Value>>) -> Value {
    let items: Vec<Value> = items.into_iter().map(|c| json!({"type": "list_item", "content": c})).collect();
    json!({"type": kind, "content": items})
}

fn jpeg(w: u32, h: u32) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(w, h, image::Rgb([30, 120, 200])))
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .unwrap();
    buf.into_inner()
}

fn attachment(name: &str, size: u64) -> Attachment {
    Attachment {
        id: name.into(),
        filename: name.into(),
        size,
        content_type: "application/octet-stream".into(),
        created_at: "2026-01-01 00:00:00".into(),
    }
}

/// Lays out and renders; the render itself runs krilla's PDF/A validation.
fn build(e: &CardExport) -> (Layout, Vec<u8>) {
    let l = layout_card(e).expect("layout");
    let pdf = replay(&l, e).expect("render (includes PDF/A validation)");
    (l, pdf)
}

fn render(e: &CardExport) -> Vec<u8> {
    let pdf = build(e).1;
    assert_pdfa(&pdf);
    pdf
}

fn export_with(f: impl FnOnce(&mut CardExport)) -> CardExport {
    let mut e = export("");
    f(&mut e);
    e
}

fn with_description(nodes: Vec<Value>) -> CardExport {
    export_with(|e| e.card.description = doc(nodes))
}

/// Single-line text of all pages, whitespace collapsed.
fn pdf_text(pdf: &[u8]) -> String {
    let doc = lopdf::Document::load_mem(pdf).expect("parses");
    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    let text = doc.extract_text(&pages).expect("text extracts");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn page_count(pdf: &[u8]) -> usize {
    lopdf::Document::load_mem(pdf).expect("parses").get_pages().len()
}

fn assert_in_order(text: &str, needles: &[&str]) {
    let mut from = 0;
    for n in needles {
        match text[from..].find(n) {
            Some(i) => from += i + n.len(),
            None => panic!("{n:?} missing or out of order in: {text}"),
        }
    }
}

/// Structural PDF/A checks that don't need an external validator: every font
/// is embedded, XMP declares PDF/A-2u, nothing encrypted or attached.
fn assert_pdfa(pdf: &[u8]) {
    use lopdf::Object;
    let doc = lopdf::Document::load_mem(pdf).expect("parses");
    assert!(!doc.is_encrypted(), "PDF/A forbids encryption");
    let mut descriptors = 0;
    for obj in doc.objects.values() {
        let Object::Dictionary(d) = obj else { continue };
        if d.get(b"Type").ok().and_then(|t| t.as_name().ok()) == Some(b"FontDescriptor") {
            descriptors += 1;
            assert!(
                d.has(b"FontFile") || d.has(b"FontFile2") || d.has(b"FontFile3"),
                "font descriptor without embedded font program: {d:?}"
            );
        }
        if let Ok(t) = d.get(b"Type").and_then(Object::as_name) {
            assert_ne!(t, b"EmbeddedFile", "PDF/A-2 forbids embedded files");
        }
    }
    assert!(descriptors > 0, "no fonts at all");
    let catalog = doc.catalog().expect("catalog");
    let meta = catalog.get(b"Metadata").and_then(Object::as_reference).expect("XMP metadata");
    let stream = doc.get_object(meta).unwrap().as_stream().unwrap();
    let xmp = String::from_utf8_lossy(&stream.decompressed_content().unwrap_or_else(|_| stream.content.clone())).to_string();
    assert!(xmp.contains("<pdfaid:part>2</pdfaid:part>"), "xmp: {xmp}");
    assert!(xmp.contains("<pdfaid:conformance>U</pdfaid:conformance>"), "xmp: {xmp}");
}

/// Nothing may poke out of the margins (or off the page).
fn assert_in_bounds(l: &Layout, check_height: bool) {
    let (left, right) = (MARGIN - 0.6, PAGE_W - MARGIN + 0.6);
    for (pi, ops) in l.pages.iter().enumerate() {
        for op in ops {
            match op {
                Op::Text { x, y, face, size, text, .. } => {
                    let w = l.fonts.width(*face, text, *size);
                    assert!(*x >= left && x + w <= right, "page {pi}: text {text:?} spans {x}..{} outside margins", x + w);
                    if check_height {
                        assert!(*y >= TOP && *y <= PAGE_H - 30.0, "page {pi}: text {text:?} at y={y}");
                    }
                }
                Op::Rect { x, y, w, h, .. } => {
                    assert!(*x >= left && x + w <= right, "page {pi}: rect {x}..{} outside margins", x + w);
                    if check_height {
                        assert!(*y >= TOP - 0.6 && y + h <= PAGE_H, "page {pi}: rect y {y}+{h}");
                    }
                }
                Op::Image { x, y, w, h, .. } => {
                    assert!(*x >= left && x + w <= right, "page {pi}: image outside margins");
                    if check_height {
                        assert!(y + h <= BOTTOM + 0.6, "page {pi}: image bottom {}", y + h);
                    }
                }
                Op::Link { .. } => {}
            }
        }
    }
}

fn texts(l: &Layout, page: usize) -> Vec<&str> {
    l.pages[page]
        .iter()
        .filter_map(|op| if let Op::Text { text, .. } = op { Some(text.as_str()) } else { None })
        .collect()
}

fn all_text(l: &Layout) -> String {
    (0..l.pages.len()).flat_map(|p| texts(l, p)).collect::<Vec<_>>().join(" ")
}

// ── golden layouts ───────────────────────────────────────────────────────

fn dump(l: &Layout) -> String {
    use std::fmt::Write;
    let hex = |c: &Rgb| format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]);
    let mut out = String::new();
    for (i, ops) in l.pages.iter().enumerate() {
        writeln!(out, "== page {} ==", i + 1).unwrap();
        for op in ops {
            match op {
                Op::Text { x, y, face, size, color, text } => {
                    writeln!(out, "T {x:.1} {y:.1} f{} {size} {} {text:?}", *face as u8, hex(color)).unwrap()
                }
                Op::Rect { x, y, w, h, color } => writeln!(out, "R {x:.1} {y:.1} {w:.1} {h:.1} {}", hex(color)).unwrap(),
                Op::Image { idx, x, y, w, h } => writeln!(out, "I {idx} {x:.1} {y:.1} {w:.1} {h:.1}").unwrap(),
                Op::Link { x, y, w, h, url } => writeln!(out, "L {x:.1} {y:.1} {w:.1} {h:.1} {url}").unwrap(),
            }
        }
    }
    out
}

/// Compares against `tests/golden/<name>.txt`. Regenerate after an intended
/// layout change with `UPDATE_GOLDEN=1 cargo test --lib pdf`.
fn assert_golden(name: &str, actual: &str) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden").join(format!("{name}.txt"));
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing golden {path:?}; run with UPDATE_GOLDEN=1"));
    if expected != actual {
        let line = expected.lines().zip(actual.lines()).position(|(a, b)| a != b).unwrap_or(0);
        panic!(
            "layout differs from {path:?} at line {}:\n  expected: {}\n  actual:   {}\n(UPDATE_GOLDEN=1 to accept)",
            line + 1,
            expected.lines().nth(line).unwrap_or("<eof>"),
            actual.lines().nth(line).unwrap_or("<eof>")
        );
    }
}

#[test]
fn golden_rich_card() {
    let e = export(RICH);
    assert_golden("rich", &dump(&layout_card(&e).unwrap()));
}

#[test]
fn golden_international_card() {
    assert_golden("intl", &dump(&layout_card(&export(INTL)).unwrap()));
}

#[test]
fn golden_table_shrinks_wide_columns() {
    let long = "words ".repeat(40);
    let e = with_description(vec![table_node(&[
        vec!["Id", "Description", "Owner"],
        vec!["1", &long, "ann"],
        vec!["2", "short", "bob"],
    ])]);
    assert_golden("table_wide", &dump(&layout_card(&e).unwrap()));
}

#[test]
fn golden_long_table_with_repeated_header() {
    let rows: Vec<Vec<String>> = (0..46).map(|i| vec![format!("row {i}"), format!("{}", i * 7)]).collect();
    let mut all: Vec<Vec<&str>> = vec![vec!["Name", "Value"]];
    all.extend(rows.iter().map(|r| r.iter().map(String::as_str).collect()));
    let e = with_description(vec![table_node(&all)]);
    assert_golden("table_split", &dump(&layout_card(&e).unwrap()));
}

#[test]
fn golden_kitchen_sink() {
    let mut e = export_with(|e| {
        e.labels = (0..14)
            .map(|i| Label { id: i.to_string(), name: format!("Label number {i}"), color: format!("#{:02x}c0d8", 0x60 + i * 8) })
            .collect();
        e.attachments = vec![
            (attachment("report \u{00e4}\u{00f6}\u{00fc}.pdf", 1_500_000), None),
            (attachment("pic.jpg", 4096), Some(jpeg(120, 80))),
            (attachment("tall.jpg", 4096), Some(jpeg(30, 500))),
        ];
        e.card.checklist = (0..6)
            .map(|i| ChecklistItem { id: i.to_string(), text: format!("step {i}"), done: i % 2 == 0 })
            .collect();
    });
    e.card.description = doc(vec![
        json!({"type": "heading", "attrs": {"level": 2}, "content": [text_node("Plan")]}),
        list_node("ordered_list", vec![vec![para("first")], vec![para("second"), list_node("bullet_list", vec![vec![para("nested")]])]]),
        json!({"type": "blockquote", "content": [para("quote")]}),
        json!({"type": "code_block", "content": [text_node("let x = 1;\n\tlet y = 2;")]}),
    ]);
    assert_golden("kitchen_sink", &dump(&layout_card(&e).unwrap()));
}

#[test]
fn layout_is_deterministic() {
    let a = dump(&layout_card(&export(RICH)).unwrap());
    let b = dump(&layout_card(&export(RICH)).unwrap());
    assert_eq!(a, b);
}

// ── expected PDF content ─────────────────────────────────────────────────

#[test]
fn pdf_text_has_expected_content_in_order() {
    let pdf = render(&export(RICH));
    let text = pdf_text(&pdf);
    assert_in_order(
        &text,
        &[
            "Ship PDF export", "Board: Roadmap", "Status: 2026-11-03 12:00 UTC", "Urgent", "Backend", "Due:",
            "2026-12-24", "Description", "Heading", "bold", "italic", "a link", "one", "nested", "two",
            "quoted text", "println!", "Checklist (1/2)", "write it", "test it", "Attachments (1)",
            "notes.txt", "2.0 KB", "Page 1 / 1",
        ],
    );
}

#[test]
fn pdf_metadata_and_structure() {
    let pdf = render(&export(RICH));
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    assert_eq!(doc.get_pages().len(), 1);
    let info = doc.trailer.get(b"Info").and_then(lopdf::Object::as_reference).unwrap();
    let info = doc.get_object(info).unwrap().as_dict().unwrap();
    let title = info.get(b"Title").unwrap();
    assert!(format!("{title:?}").contains("0053006800690070"), "title not UTF-16 'Ship': {title:?}");
    let producer = format!("{:?}", info.get(b"Producer").unwrap());
    assert!(producer.contains("Synkban"));
}

#[test]
fn only_http_https_and_mailto_links_are_clickable() {
    let link = |href: &str, t: &str| {
        json!({"type": "text", "text": t, "marks": [{"type": "link", "attrs": {"href": href}}]})
    };
    let e = with_description(vec![json!({"type": "paragraph", "content": [
        link("https://example.com/a?b=c", "web"), text_node(" "),
        link("mailto:me@example.com", "mail"), text_node(" "),
        link("javascript:alert(1)", "evil"), text_node(" "),
        link("data:text/html,x", "data"), text_node(" "),
        link("file:///etc/passwd", "file"), text_node(" "),
        link("/relative", "rel"),
    ]})]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    let urls: Vec<&str> = l.pages[0]
        .iter()
        .filter_map(|op| if let Op::Link { url, .. } = op { Some(url.as_str()) } else { None })
        .collect();
    assert_eq!(urls, ["https://example.com/a?b=c", "mailto:me@example.com"]);
    // Refused links print as plain text: no link colour, no underline.
    let plain_colored = l.pages[0].iter().any(|op| {
        matches!(op, Op::Text { text, color, .. } if (text == "evil" || text == "data" || text == "file" || text == "rel") && *color == LINK)
    });
    assert!(!plain_colored, "unsafe links must not look like links");
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let annots: usize = doc
        .get_pages()
        .values()
        .map(|id| doc.get_page_annotations(*id).map_or(0, |a| a.len()))
        .sum();
    assert_eq!(annots, 2);
}

#[test]
fn image_thumbnails_become_image_objects() {
    let e = export_with(|e| {
        e.attachments = vec![
            (attachment("a.jpg", 1), Some(jpeg(64, 48))),
            (attachment("b.jpg", 1), Some(jpeg(48, 64))),
            (attachment("broken.jpg", 1), Some(b"not a jpeg".to_vec())),
            (attachment("doc.txt", 1), None),
        ];
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_eq!(l.images.len(), 2, "undecodable thumbnails are skipped");
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let images = doc
        .objects
        .values()
        .filter(|o| o.as_stream().ok().and_then(|s| s.dict.get(b"Subtype").ok()).and_then(|t| t.as_name().ok()) == Some(b"Image"))
        .count();
    assert_eq!(images, 2);
    assert_in_bounds(&l, true);
    let text = pdf_text(&pdf);
    assert_in_order(&text, &["a.jpg", "b.jpg", "broken.jpg", "doc.txt"]);
}

// ── corner cases: card fields ────────────────────────────────────────────

#[test]
fn empty_card_still_renders() {
    let e = export_with(|e| {
        e.card.title = String::new();
        e.card.due_date = None;
        e.card.checklist.clear();
        e.labels.clear();
        e.attachments.clear();
        e.board_title = String::new();
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_eq!(l.pages.len(), 1);
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let info = doc.trailer.get(b"Info").and_then(lopdf::Object::as_reference).unwrap();
    let title = format!("{:?}", doc.get_object(info).unwrap().as_dict().unwrap().get(b"Title").unwrap());
    assert!(title.contains("Untitled card"), "{title}");
    assert!(pdf_text(&pdf).contains("Status: 2026-11-03 12:00 UTC"));
}

#[test]
fn whitespace_and_control_only_title() {
    for title in ["   ", "\n\n", "\u{0}\u{1}\u{7}", "\u{200B}\u{200D}\u{FEFF}"] {
        let e = export_with(|e| e.card.title = title.into());
        let (l, pdf) = build(&e);
        assert_pdfa(&pdf);
        assert_in_bounds(&l, true);
    }
}

#[test]
fn very_long_unbreakable_title_wraps_inside_margins() {
    let e = export_with(|e| e.card.title = "W".repeat(600));
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(texts(&l, 0).iter().filter(|t| t.starts_with('W')).count() > 3, "must wrap over several lines");
}

#[test]
fn long_title_with_spaces_pushes_content_down_not_off_page() {
    let e = export_with(|e| e.card.title = "lorem ipsum dolor sit amet ".repeat(80));
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(l.pages.len() >= 1);
}

#[test]
fn markdown_edge_cases_in_titles() {
    let cases: [(&str, &str); 9] = [
        ("**", "**"),
        ("*", "*"),
        ("****", "****"),
        ("***a***", "a"),
        ("a*b*c**d", "abc**d"),
        ("**unclosed", "**unclosed"),
        ("**bold *and italic* mix**", "bold and italic mix"),
        ("* spaced *", " spaced "),
        ("2 * 3 * 4", "2  3  4"),
    ];
    for (input, plain) in cases {
        assert_eq!(plain_md(input), plain, "input {input:?}");
        let e = export_with(|e| e.card.title = input.into());
        assert_pdfa(&render(&e));
    }
}

#[test]
fn right_to_left_title_and_board() {
    let e = export_with(|e| {
        e.card.title = "\u{645}\u{631}\u{62d}\u{628}\u{627} \u{628}\u{627}\u{644}\u{639}\u{627}\u{644}\u{645}".into();
        e.board_title = "\u{5e9}\u{5dc}\u{5d5}\u{5dd}".into();
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn due_date_is_printed_verbatim_even_if_odd() {
    for d in ["not a date", "2026-13-45", "", "\u{1F680}"] {
        let e = export_with(|e| e.card.due_date = Some(d.into()));
        assert_pdfa(&render(&e));
    }
}

#[test]
fn labels_wrap_into_rows_and_never_leave_the_page() {
    let e = export_with(|e| {
        e.labels = (0..70)
            .map(|i| Label { id: i.to_string(), name: format!("label {i}"), color: "#c6e0f5".into() })
            .collect();
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let text = pdf_text(&pdf);
    assert_in_order(&text, &["label 0", "label 35", "label 69"]);
}

#[test]
fn oversized_and_malformed_labels() {
    let e = export_with(|e| {
        e.labels = vec![
            Label { id: "1".into(), name: "x".repeat(400), color: "#c6e0f5".into() },
            Label { id: "2".into(), name: "bad colour".into(), color: "red".into() },
            Label { id: "3".into(), name: "short hex".into(), color: "#12".into() },
            Label { id: "4".into(), name: "".into(), color: "#ffffff".into() },
            Label { id: "5".into(), name: "**bold** \u{1F525}".into(), color: "#ff0000".into() },
        ];
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

// ── corner cases: description structure ──────────────────────────────────

#[test]
fn garbage_descriptions_do_not_fail() {
    for d in [
        "", "null", "42", "\"just a string\"", "[]", "{}", "{\"type\":\"doc\"}", "{\"type\":\"doc\",\"content\":[]}",
        "{\"type\":\"doc\",\"content\":[null,5,\"x\",{\"foo\":1},{\"type\":\"mystery\"}]}", "{broken json", "plain text\n\nsecond paragraph",
    ] {
        let e = export_with(|e| e.card.description = d.into());
        let (l, pdf) = build(&e);
        assert_pdfa(&pdf);
        assert_in_bounds(&l, true);
    }
}

#[test]
fn unknown_wrapper_nodes_still_show_their_content() {
    let e = with_description(vec![json!({"type": "mystery", "content": [para("inside mystery")]})]);
    assert!(pdf_text(&render(&e)).contains("inside mystery"));
}

#[test]
fn plain_text_description_keeps_paragraphs() {
    let e = export_with(|e| e.card.description = "first para\n\nsecond para".into());
    assert_in_order(&pdf_text(&render(&e)), &["Description", "first para", "second para"]);
}

#[test]
fn empty_paragraphs_only_add_space() {
    let e = with_description(vec![para(""), json!({"type": "paragraph"}), para("   "), para("after")]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert!(all_text(&l).contains("after"));
}

#[test]
fn hard_breaks_split_lines() {
    let e = with_description(vec![json!({"type": "paragraph", "content": [
        text_node("one"), {"type": "hard_break"}, text_node("two"), {"type": "hard_break"}, {"type": "hard_break"}, text_node("three"),
    ]})]);
    let (l, _) = build(&e);
    let ys: Vec<f32> = l.pages[0]
        .iter()
        .filter_map(|op| match op {
            Op::Text { text, y, .. } if ["one", "two", "three"].contains(&text.as_str()) => Some(*y),
            _ => None,
        })
        .collect();
    assert_eq!(ys.len(), 3);
    assert!(ys[0] < ys[1] && ys[1] < ys[2]);
    assert!(ys[2] - ys[1] > ys[1] - ys[0] + 5.0, "double break leaves a blank line");
}

#[test]
fn deeply_nested_lists_stay_inside_the_page() {
    let mut node = para("deepest");
    for i in 0..40 {
        node = list_node("bullet_list", vec![vec![para(&format!("level {i}")), node]]);
    }
    let e = with_description(vec![node]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(pdf_text(&pdf).contains("deepest"));
}

#[test]
fn deeply_nested_quotes_stay_inside_the_page() {
    let mut node = para("quote core");
    for _ in 0..40 {
        node = json!({"type": "blockquote", "content": [node]});
    }
    let (l, pdf) = build(&with_description(vec![node]));
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn ordered_list_honours_start_number_and_long_items_wrap() {
    let long = "word ".repeat(120);
    let e = with_description(vec![json!({"type": "ordered_list", "attrs": {"order": 7}, "content": [
        {"type": "list_item", "content": [para(&long)]},
        {"type": "list_item", "content": [para("second")]},
        {"type": "list_item", "content": []},
    ]})]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let all = all_text(&l);
    assert!(all.contains("7.") && all.contains("8."), "{all}");
}

#[test]
fn code_blocks_preserve_indentation_and_wrap_long_lines() {
    let long = "x".repeat(900);
    let e = with_description(vec![
        json!({"type": "code_block", "content": [text_node(&format!("    indented\n\ttab\n{long}\n\n\nend"))]}),
        json!({"type": "code_block"}),
        json!({"type": "code_block", "content": [text_node("")]}),
        json!({"type": "code_block", "content": [text_node("\u{4f60}\u{597d} \u{1F680} \u{0}nul")]}),
    ]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(all_text(&l).contains("    indented"), "leading spaces survive");
    assert!(pdf_text(&pdf).contains("end"));
}

#[test]
fn heading_levels_and_empty_headings() {
    let e = with_description(vec![
        json!({"type": "heading", "attrs": {"level": 1}, "content": [text_node("H1")]}),
        json!({"type": "heading", "attrs": {"level": 6}, "content": [text_node("H6")]}),
        json!({"type": "heading", "content": [text_node("no level")]}),
        json!({"type": "heading", "attrs": {"level": 2}}),
    ]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    let sizes: Vec<f32> = l.pages[0]
        .iter()
        .filter_map(|op| match op {
            Op::Text { text, size, .. } if ["H1", "H6", "no level"].contains(&text.as_str()) => Some(*size),
            _ => None,
        })
        .collect();
    assert_eq!(sizes, [18.0, 13.0, 18.0]);
}

// ── corner cases: characters ─────────────────────────────────────────────

#[test]
fn unsupported_characters_become_question_marks_not_notdef() {
    let e = with_description(vec![para("cjk \u{4f60}\u{597d} \u{3053}\u{3093}\u{306b}\u{3061}\u{306f} \u{c548}\u{b155} end")]);
    let (_, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert!(pdf_text(&pdf).contains("cjk ?? ????? ?? end"), "{}", pdf_text(&pdf));
}

#[test]
fn invisible_and_control_characters_are_dropped() {
    let e = with_description(vec![para("a\u{200B}b\u{200D}c\u{FEFF}d\u{00AD}e\u{0}f\u{7}g\u{FE0F}h\u{1F3FD}i")]);
    let (_, pdf) = build(&e);
    assert!(pdf_text(&pdf).contains("abcdefghi"), "{}", pdf_text(&pdf));
}

#[test]
fn emoji_walls_wrap_inside_margins() {
    let e = with_description(vec![para(&"\u{1F680}\u{1F389}\u{1F525}".repeat(200))]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn long_thai_and_arabic_runs_without_spaces_wrap() {
    let thai = "\u{e2a}\u{e27}\u{e31}\u{e2a}\u{e14}\u{e35}".repeat(80);
    let arabic = "\u{645}\u{631}\u{62d}\u{628}\u{627}".repeat(80);
    let e = with_description(vec![para(&thai), para(&arabic)]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    // Combining marks are never separated from their base letter at a wrap.
    let combining = |c: char| matches!(c as u32, 0xE31 | 0xE34..=0xE3A | 0xE47..=0xE4E);
    for page in 0..l.pages.len() {
        for t in texts(&l, page) {
            assert!(!t.chars().next().is_some_and(combining), "line starts with a combining mark: {t:?}");
        }
    }
}

#[test]
fn mixed_script_line_uses_each_font() {
    let e = with_description(vec![para("Latin \u{3b5}\u{3bb}\u{3bb}\u{3b7}\u{3bd}\u{3b9}\u{3ba}\u{3ac} \u{43f}\u{440}\u{438}\u{432}\u{435}\u{442} \u{5e9}\u{5dc}\u{5d5}\u{5dd} \u{645}\u{631}\u{62d}\u{628}\u{627} \u{928}\u{92e}\u{938}\u{94d}\u{924}\u{947} \u{e2a}\u{e27}\u{e31}\u{e2a}\u{e14}\u{e35} \u{1F680}")]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    let faces: std::collections::BTreeSet<u8> = l.pages[0]
        .iter()
        .filter_map(|op| if let Op::Text { face, text, .. } = op { (text.chars().any(|c| !c.is_ascii())).then_some(*face as u8) } else { None })
        .collect();
    for f in [Face::Hebrew, Face::Arabic, Face::Devanagari, Face::Thai, Face::Emoji] {
        assert!(faces.contains(&(f as u8)), "face {} unused", f as u8);
    }
}

// ── corner cases: tables ─────────────────────────────────────────────────

#[test]
fn degenerate_tables_do_not_fail() {
    let cases: Vec<Value> = vec![
        json!({"type": "table"}),
        json!({"type": "table", "content": []}),
        json!({"type": "table", "content": [{"type": "table_row"}]}),
        json!({"type": "table", "content": [{"type": "table_row", "content": []}, {"type": "table_row", "content": []}]}),
        table_node(&[vec![""]]),
        table_node(&[vec!["", "", ""], vec!["", "", ""]]),
        table_node(&[vec!["only header"]]),
        table_node(&[vec!["a", "b", "c"], vec!["only one"], vec!["x", "y", "z", "extra", "cells"]]),
        json!({"type": "table", "content": [{"type": "table_row", "content": [{"type": "table_cell"}, {"type": "table_cell", "content": [{"type": "paragraph"}]}]}]}),
    ];
    for t in cases {
        let (l, pdf) = build(&with_description(vec![t.clone(), para("after table")]));
        assert_pdfa(&pdf);
        assert_in_bounds(&l, true);
        assert!(all_text(&l).contains("after table"), "{t}");
    }
}

#[test]
fn many_columns_fit_the_page() {
    let header: Vec<String> = (0..30).map(|i| format!("c{i}")).collect();
    let row: Vec<String> = (0..30).map(|i| format!("v{i}")).collect();
    let rows = vec![header.iter().map(String::as_str).collect::<Vec<_>>(), row.iter().map(String::as_str).collect()];
    let (l, pdf) = build(&with_description(vec![table_node(&rows)]));
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn unbreakable_cell_content_is_hard_wrapped() {
    let long = "A".repeat(300);
    let (l, pdf) = build(&with_description(vec![table_node(&[vec!["h1", "h2"], vec![&long, "ok"]])]));
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn table_columns_are_centred_and_use_natural_width() {
    let (l, _) = build(&with_description(vec![table_node(&[vec!["A", "B"], vec!["1", "2"]])]));
    let rules: Vec<(f32, f32)> = l.pages[0]
        .iter()
        .filter_map(|op| match op {
            Op::Rect { x, w, h, .. } if *h < 1.0 && *w > 20.0 && *w < CONTENT_W - 1.0 => Some((*x, *w)),
            _ => None,
        })
        .collect();
    assert!(!rules.is_empty());
    for (x, w) in rules {
        let left = x - MARGIN;
        let right = (PAGE_W - MARGIN) - (x + w);
        assert!((left - right).abs() < 0.6, "not centred: {left} vs {right}");
        assert!(w < 120.0, "natural width, not full width: {w}");
    }
}

#[test]
fn full_width_table_is_not_centred_off_page() {
    let long = "lorem ipsum ".repeat(60);
    let (l, _) = build(&with_description(vec![table_node(&[vec!["a", "b"], vec![&long, &long]])]));
    assert_in_bounds(&l, true);
}

#[test]
fn table_alignment_is_honoured() {
    let cell = |kind: &str, align: Value, t: &str| json!({"type": kind, "attrs": {"align": align}, "content": [para(t)]});
    let t = json!({"type": "table", "content": [
        {"type": "table_row", "content": [cell("table_header", Value::Null, "H1"), cell("table_header", Value::Null, "H2"), cell("table_header", Value::Null, "H3")]},
        {"type": "table_row", "content": [cell("table_cell", json!("left"), "L"), cell("table_cell", json!("center"), "C"), cell("table_cell", json!("right"), "R")]},
        {"type": "table_row", "content": [cell("table_cell", Value::Null, "long left text"), cell("table_cell", Value::Null, "long centre text"), cell("table_cell", Value::Null, "long right text")]},
    ]});
    let (l, _) = build(&with_description(vec![t]));
    let x = |s: &str| l.pages[0].iter().find_map(|op| match op { Op::Text { x, text, .. } if text == s => Some(*x), _ => None }).unwrap();
    // Within a column the single letters sit at the edge their alignment names.
    assert!(x("L") < x("C") && x("C") < x("R"));
    let w = |s: &str, size: f32| l.fonts.width(Face::Regular, s, size);
    let col2_left = x("long centre text");
    let col2_width = w("long centre text", 9.5) + 0.0;
    assert!((x("C") - (col2_left + (col2_width - w("C", 9.5)) / 2.0)).abs() < 1.5, "centre cell off-centre");
    let col3_right = x("long right text") + w("long right text", 9.5);
    assert!((x("R") + w("R", 9.5) - col3_right).abs() < 1.5, "right cell not flush right");
}

#[test]
fn tables_inside_lists_and_quotes_stay_in_bounds() {
    let t = table_node(&[vec!["a", "b"], vec!["1", "2"]]);
    let e = with_description(vec![
        list_node("bullet_list", vec![vec![para("item"), t.clone()]]),
        json!({"type": "blockquote", "content": [t]}),
    ]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn table_that_just_fits_stays_whole_and_one_row_over_moves_on() {
    // Rows are 9pt*1.4 + 8 = 20.6pt tall; find the largest table that fits a page
    // and check it is not split, then that one more row does not stay on the page.
    let rows = |n: usize| -> Vec<Vec<String>> { (0..n).map(|i| vec![format!("r{i}"), "x".into()]).collect() };
    let build_rows = |n: usize| {
        let data = rows(n);
        let mut all: Vec<Vec<&str>> = vec![vec!["H", "V"]];
        all.extend(data.iter().map(|r| r.iter().map(String::as_str).collect()));
        let mut e = with_description(vec![table_node(&all)]);
        e.card.checklist.clear();
        e.attachments.clear();
        build(&e).0
    };
    let fits = (1..60).rev().find(|n| build_rows(*n).pages.len() == 1).expect("some table fits");
    let l = build_rows(fits);
    assert_eq!(l.pages.len(), 1);
    let l2 = build_rows(fits + 1);
    assert_eq!(l2.pages.len(), 2);
    assert!(texts(&l2, 1).contains(&"H"), "table moved whole, header included");
}

#[test]
fn header_row_is_never_stranded_alone() {
    for filler in 30..60 {
        let mut nodes: Vec<Value> = (0..filler).map(|i| para(&format!("filler {i}"))).collect();
        let big: Vec<Vec<String>> = (0..70).map(|i| vec![format!("r{i}"), "v".into()]).collect();
        let mut all: Vec<Vec<&str>> = vec![vec!["HEAD", "V"]];
        all.extend(big.iter().map(|r| r.iter().map(String::as_str).collect()));
        nodes.push(table_node(&all));
        let (l, _) = build(&with_description(nodes));
        for p in 0..l.pages.len() {
            let t = texts(&l, p);
            if let Some(i) = t.iter().position(|x| *x == "HEAD") {
                assert!(t[i..].iter().any(|x| x.starts_with('r') && x[1..].chars().all(|c| c.is_ascii_digit())), "filler {filler}: header alone on page {p}");
            }
        }
    }
}

#[test]
fn a_row_taller_than_a_page_terminates() {
    let huge = "paragraph words ".repeat(1500);
    let (l, pdf) = build(&with_description(vec![table_node(&[vec!["h"], vec![&huge]]), para("after")]));
    assert_pdfa(&pdf);
    assert!(all_text(&l).contains("after"));
    // Known limitation: such a row is not split, so height is not asserted.
    assert_in_bounds(&l, false);
}

// ── corner cases: pagination ─────────────────────────────────────────────

#[test]
fn page_footers_number_every_page() {
    let paras: Vec<Value> = (0..260).map(|i| para(&format!("Paragraph number {i} with a little bit of text to fill space."))).collect();
    let (l, pdf) = build(&with_description(paras));
    assert_pdfa(&pdf);
    let n = l.pages.len();
    assert!(n >= 4, "got {n} pages");
    assert_eq!(page_count(&pdf), n);
    for p in 0..n {
        assert!(texts(&l, p).contains(&format!("Page {} / {n}", p + 1).as_str()), "page {p} footer");
    }
    assert_in_bounds(&l, true);
}

#[test]
fn paragraphs_that_fit_are_never_split_across_pages() {
    let paras: Vec<Value> = (0..120)
        .map(|i| para(&format!("P{i}: {}", "wrapping sentence for the paragraph. ".repeat(6))))
        .collect();
    let (l, _) = build(&with_description(paras));
    // Each paragraph starts with "P<i>:"; every page must contain whole paragraphs, so a
    // page's last body line must end a paragraph (its text ends in ".").
    for p in 0..l.pages.len() {
        let body: Vec<&str> = l.pages[p]
            .iter()
            .filter_map(|op| match op {
                Op::Text { text, y, .. } if *y <= BOTTOM => Some(text.as_str()),
                _ => None,
            })
            .collect();
        if p + 1 < l.pages.len() {
            let last = body.last().copied().unwrap_or("");
            assert!(last.trim_end().ends_with('.') || last.contains("paragraph."), "page {p} ends mid-paragraph: {last:?}");
        }
        if p > 0 {
            let first = body.first().copied().unwrap_or("");
            assert!(first.starts_with('P'), "page {p} starts mid-paragraph: {first:?}");
        }
    }
}

#[test]
fn a_paragraph_longer_than_a_page_is_split_not_dropped() {
    let words: Vec<String> = (0..4000).map(|i| format!("w{i}")).collect();
    let (l, pdf) = build(&with_description(vec![para(&words.join(" "))]));
    assert_pdfa(&pdf);
    assert!(l.pages.len() >= 3);
    let text = pdf_text(&pdf);
    assert_in_order(&text, &["w0 ", "w1999 ", "w3999"]);
    assert_in_bounds(&l, true);
}

#[test]
fn heading_is_not_left_alone_at_page_bottom() {
    for filler in 40..52 {
        let mut nodes: Vec<Value> = (0..filler).map(|i| para(&format!("filler {i}"))).collect();
        nodes.push(json!({"type": "heading", "attrs": {"level": 1}, "content": [text_node("KEEPHEAD")]}));
        nodes.push(para("following text"));
        let (l, _) = build(&with_description(nodes));
        for p in 0..l.pages.len() {
            let t = texts(&l, p);
            if t.contains(&"KEEPHEAD") {
                assert!(t.iter().any(|x| x.starts_with("following")), "filler {filler}: heading stranded on page {p}");
            }
        }
    }
}

#[test]
fn checklist_header_stays_with_its_items_at_every_offset() {
    for filler in 36..54 {
        let e = export_with(|e| {
            e.card.description = doc((0..filler).map(|i| para(&format!("filler {i}"))).collect());
            e.card.checklist = (0..8).map(|i| ChecklistItem { id: i.to_string(), text: format!("task {i}"), done: false }).collect();
        });
        let (l, _) = build(&e);
        let page_of = |needle: &str| (0..l.pages.len()).find(|p| texts(&l, *p).iter().any(|t| t.starts_with(needle))).unwrap();
        assert_eq!(page_of("Checklist ("), page_of("task"), "filler {filler}: header separated from first item");
        assert_eq!(page_of("task"), (0..l.pages.len()).rev().find(|p| texts(&l, *p).iter().any(|t| t.starts_with("task"))).unwrap(), "filler {filler}: items split although they fit");
    }
}

#[test]
fn attachment_header_stays_with_its_list_at_every_offset() {
    for filler in 36..54 {
        let e = export_with(|e| {
            e.card.description = doc((0..filler).map(|i| para(&format!("filler {i}"))).collect());
            e.card.checklist.clear();
            e.attachments = (0..6).map(|i| (attachment(&format!("file{i}.bin"), 10), None)).collect();
        });
        let (l, _) = build(&e);
        let page_of = |needle: &str| (0..l.pages.len()).find(|p| texts(&l, *p).iter().any(|t| t.contains(needle))).unwrap();
        assert_eq!(page_of("Attachments ("), page_of("file0.bin"), "filler {filler}");
        assert_eq!(page_of("file0.bin"), page_of("file5.bin"), "filler {filler}: list split although it fits");
    }
}

#[test]
fn huge_checklist_keeps_header_with_first_items_and_loses_nothing() {
    let e = export_with(|e| {
        e.card.checklist = (0..400).map(|i| ChecklistItem { id: i.to_string(), text: format!("item {i}"), done: i % 3 == 0 }).collect();
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let page_of = |needle: &str| (0..l.pages.len()).find(|p| texts(&l, *p).iter().any(|t| t.contains(needle))).unwrap();
    assert_eq!(page_of("Checklist ("), page_of("item 0"));
    let text = pdf_text(&pdf);
    assert!(text.contains("Checklist (134/400)"), "{}", &text[..200.min(text.len())]);
    assert_in_order(&text, &["item 0", "item 200", "item 399"]);
}

#[test]
fn empty_and_giant_checklist_items() {
    let e = export_with(|e| {
        e.card.checklist = vec![
            ChecklistItem { id: "1".into(), text: String::new(), done: true },
            ChecklistItem { id: "2".into(), text: "x".repeat(2000), done: false },
            ChecklistItem { id: "3".into(), text: "word ".repeat(3000), done: false },
        ];
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn many_attachments_with_awkward_names() {
    let e = export_with(|e| {
        let mut v: Vec<(Attachment, Option<Vec<u8>>)> = (0..150)
            .map(|i| (attachment(&format!("\u{00e4}\u{00f6}\u{00fc} file {i} \u{1F4CE}.bin"), i * 1000), None))
            .collect();
        v.push((attachment(&"n".repeat(400), 0), None));
        v.push((attachment("", u64::MAX), None));
        v.push((attachment("\u{4f60}\u{597d}.txt", 1), None));
        e.attachments = v;
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(l.pages.len() >= 3);
}

#[test]
fn image_extremes_and_many_images_paginate() {
    let e = export_with(|e| {
        let mut v: Vec<(Attachment, Option<Vec<u8>>)> = vec![
            (attachment("tall.jpg", 1), Some(jpeg(8, 3000))),
            (attachment("wide.jpg", 1), Some(jpeg(3000, 8))),
            (attachment("dot.jpg", 1), Some(jpeg(1, 1))),
        ];
        v.extend((0..40).map(|i| (attachment(&format!("p{i}.jpg"), 1), Some(jpeg(400, 300)))));
        e.attachments = v;
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert_eq!(l.images.len(), 43);
    assert!(l.pages.len() >= 4, "got {}", l.pages.len());
}

#[test]
fn everything_at_once_still_valid() {
    let mut nodes: Vec<Value> = vec![
        json!({"type": "heading", "attrs": {"level": 1}, "content": [text_node("All of it")]}),
        table_node(&[vec!["a", "b"], vec!["1", "2"]]),
        list_node("bullet_list", vec![vec![para("x"), list_node("ordered_list", vec![vec![para("y")]])]]),
        json!({"type": "code_block", "content": [text_node("code")]}),
    ];
    nodes.extend((0..80).map(|i| para(&format!("para {i} \u{1F680} \u{645}\u{631}\u{62d}\u{628}\u{627}"))));
    let mut e = with_description(nodes);
    e.attachments = vec![(attachment("a.jpg", 1), Some(jpeg(200, 100)))];
    e.card.checklist = (0..30).map(|i| ChecklistItem { id: i.to_string(), text: format!("t{i}"), done: false }).collect();
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert_eq!(page_count(&pdf), l.pages.len());
}
