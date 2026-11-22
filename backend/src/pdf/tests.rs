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
            Label {
                id: "a".into(),
                name: "**Urgent**".into(),
                color: "#f5c6cb".into(),
            },
            Label {
                id: "b".into(),
                name: "Backend".into(),
                color: "#c6e0f5".into(),
            },
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
        originals: HashMap::new(),
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
    format!(
        r#"{{"type":"doc","content":[{{"type":"table","content":[{}]}}]}}"#,
        all.join(",")
    )
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
        .filter_map(|op| {
            if let Op::Text { text, .. } = op {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        first_page.contains("Status: 2026-11-03 12:00 UTC"),
        "{first_page}"
    );
}

fn page_texts(l: &Layout, page: usize) -> Vec<&str> {
    l.pages[page]
        .iter()
        .filter_map(|op| {
            if let Op::Text { text, .. } = op {
                Some(text.as_str())
            } else {
                None
            }
        })
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
    let doc = format!(
        r#"{{"type":"doc","content":[{},{}]}}"#,
        filler.join(","),
        table_node
    );
    let l = layout_card(&export(&doc)).unwrap();
    let in_page = |p: usize| page_texts(&l, p).iter().filter(|t| **t == "item").count();
    assert_eq!(in_page(0) + in_page(1), 6);
    assert!(
        in_page(0) == 0 || in_page(0) == 6,
        "table split: {} on page 1",
        in_page(0)
    );
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
        .map(|i| {
            format!(r#"{{"type":"paragraph","content":[{{"type":"text","text":"Filler {i}"}}]}}"#)
        })
        .collect();
    e.card.description = format!(r#"{{"type":"doc","content":[{}]}}"#, filler.join(","));
    let l = layout_card(&e).unwrap();
    for p in 0..l.pages.len() {
        let texts = page_texts(&l, p);
        let header = texts.iter().any(|t| t.starts_with("Checklist"));
        let items = texts.iter().any(|t| t.starts_with("write it"));
        assert_eq!(
            header, items,
            "page {p}: checklist header and items must share a page"
        );
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
            let kind = if ri == 0 {
                "table_header"
            } else {
                "table_cell"
            };
            let cells: Vec<Value> = cells
                .iter()
                .map(|t| {
                    let content = if t.is_empty() {
                        json!([])
                    } else {
                        json!([para(t)])
                    };
                    json!({"type": kind, "attrs": {"align": null}, "content": content})
                })
                .collect();
            json!({"type": "table_row", "content": cells})
        })
        .collect();
    json!({"type": "table", "content": rows})
}

fn list_node(kind: &str, items: Vec<Vec<Value>>) -> Value {
    let items: Vec<Value> = items
        .into_iter()
        .map(|c| json!({"type": "list_item", "content": c}))
        .collect();
    json!({"type": kind, "content": items})
}

fn jpeg(w: u32, h: u32) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        w,
        h,
        image::Rgb([30, 120, 200]),
    ))
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
    lopdf::Document::load_mem(pdf)
        .expect("parses")
        .get_pages()
        .len()
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
    let meta = catalog
        .get(b"Metadata")
        .and_then(Object::as_reference)
        .expect("XMP metadata");
    let stream = doc.get_object(meta).unwrap().as_stream().unwrap();
    let xmp = String::from_utf8_lossy(
        &stream
            .decompressed_content()
            .unwrap_or_else(|_| stream.content.clone()),
    )
    .to_string();
    assert!(xmp.contains("<pdfaid:part>2</pdfaid:part>"), "xmp: {xmp}");
    assert!(
        xmp.contains("<pdfaid:conformance>U</pdfaid:conformance>"),
        "xmp: {xmp}"
    );
}

/// Nothing may poke out of the margins (or off the page).
fn assert_in_bounds(l: &Layout, check_height: bool) {
    let (left, right) = (MARGIN - 0.6, PAGE_W - MARGIN + 0.6);
    for (pi, ops) in l.pages.iter().enumerate() {
        for op in ops {
            match op {
                Op::Text {
                    x,
                    y,
                    face,
                    size,
                    text,
                    ..
                } => {
                    let w = l.fonts.width(*face, text, *size);
                    assert!(
                        *x >= left && x + w <= right,
                        "page {pi}: text {text:?} spans {x}..{} outside margins",
                        x + w
                    );
                    if check_height {
                        assert!(
                            *y >= TOP && *y <= PAGE_H - 30.0,
                            "page {pi}: text {text:?} at y={y}"
                        );
                    }
                }
                Op::Rect { x, y, w, h, .. } => {
                    assert!(
                        *x >= left && x + w <= right,
                        "page {pi}: rect {x}..{} outside margins",
                        x + w
                    );
                    if check_height {
                        assert!(
                            *y >= TOP - 0.6 && y + h <= PAGE_H,
                            "page {pi}: rect y {y}+{h}"
                        );
                    }
                }
                Op::Image { x, y, w, h, .. } => {
                    assert!(
                        *x >= left && x + w <= right,
                        "page {pi}: image outside margins"
                    );
                    if check_height {
                        assert!(y + h <= BOTTOM + 0.6, "page {pi}: image bottom {}", y + h);
                    }
                }
                Op::Link { .. } => {}
                Op::AlertIcon { x, y, size, .. } => {
                    assert!(
                        *x >= left && x + size <= right,
                        "page {pi}: alert icon {x}..{} outside margins",
                        x + size
                    );
                    if check_height {
                        assert!(
                            *y >= TOP - 0.6 && y + size <= PAGE_H,
                            "page {pi}: alert icon y {y}+{size}"
                        );
                    }
                }
            }
        }
    }
}

fn texts(l: &Layout, page: usize) -> Vec<&str> {
    l.pages[page]
        .iter()
        .filter_map(|op| {
            if let Op::Text { text, .. } = op {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect()
}

fn all_text(l: &Layout) -> String {
    (0..l.pages.len())
        .flat_map(|p| texts(l, p))
        .collect::<Vec<_>>()
        .join(" ")
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
                Op::Text {
                    x,
                    y,
                    face,
                    size,
                    color,
                    text,
                } => writeln!(
                    out,
                    "T {x:.1} {y:.1} f{} {size} {} {text:?}",
                    *face as u8,
                    hex(color)
                )
                .unwrap(),
                Op::Rect { x, y, w, h, color } => {
                    writeln!(out, "R {x:.1} {y:.1} {w:.1} {h:.1} {}", hex(color)).unwrap()
                }
                Op::Image { idx, x, y, w, h } => {
                    writeln!(out, "I {idx} {x:.1} {y:.1} {w:.1} {h:.1}").unwrap()
                }
                Op::Link { x, y, w, h, url } => {
                    writeln!(out, "L {x:.1} {y:.1} {w:.1} {h:.1} {url}").unwrap()
                }
                Op::AlertIcon {
                    kind,
                    x,
                    y,
                    size,
                    color,
                } => writeln!(
                    out,
                    "A {} {x:.1} {y:.1} {size:.1} {}",
                    kind.label(),
                    hex(color)
                )
                .unwrap(),
            }
        }
    }
    out
}

/// Compares against `tests/golden/<name>.txt`. Regenerate after an intended
/// layout change with `UPDATE_GOLDEN=1 cargo test --lib pdf`.
fn assert_golden(name: &str, actual: &str) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(format!("{name}.txt"));
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing golden {path:?}; run with UPDATE_GOLDEN=1"));
    if expected != actual {
        let line = expected
            .lines()
            .zip(actual.lines())
            .position(|(a, b)| a != b)
            .unwrap_or(0);
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
    let rows: Vec<Vec<String>> = (0..46)
        .map(|i| vec![format!("row {i}"), format!("{}", i * 7)])
        .collect();
    let mut all: Vec<Vec<&str>> = vec![vec!["Name", "Value"]];
    all.extend(rows.iter().map(|r| r.iter().map(String::as_str).collect()));
    let e = with_description(vec![table_node(&all)]);
    assert_golden("table_split", &dump(&layout_card(&e).unwrap()));
}

#[test]
fn golden_kitchen_sink() {
    let mut e = export_with(|e| {
        e.labels = (0..14)
            .map(|i| Label {
                id: i.to_string(),
                name: format!("Label number {i}"),
                color: format!("#{:02x}c0d8", 0x60 + i * 8),
            })
            .collect();
        e.attachments = vec![
            (
                attachment("report \u{00e4}\u{00f6}\u{00fc}.pdf", 1_500_000),
                None,
            ),
            (attachment("pic.jpg", 4096), Some(jpeg(120, 80))),
            (attachment("tall.jpg", 4096), Some(jpeg(30, 500))),
        ];
        e.card.checklist = (0..6)
            .map(|i| ChecklistItem {
                id: i.to_string(),
                text: format!("step {i}"),
                done: i % 2 == 0,
            })
            .collect();
    });
    e.card.description = doc(vec![
        json!({"type": "heading", "attrs": {"level": 2}, "content": [text_node("Plan")]}),
        list_node(
            "ordered_list",
            vec![
                vec![para("first")],
                vec![
                    para("second"),
                    list_node("bullet_list", vec![vec![para("nested")]]),
                ],
            ],
        ),
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
            "Ship PDF export",
            "Board: Roadmap",
            "Status: 2026-11-03 12:00 UTC",
            "Urgent",
            "Backend",
            "Due:",
            "2026-12-24",
            "Description",
            "Heading",
            "bold",
            "italic",
            "a link",
            "one",
            "nested",
            "two",
            "quoted text",
            "println!",
            "Checklist (1/2)",
            "write it",
            "test it",
            "Attachments (1)",
            "notes.txt",
            "2.0 KB",
            "Page 1 / 1",
        ],
    );
}

#[test]
fn pdf_metadata_and_structure() {
    let pdf = render(&export(RICH));
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    assert_eq!(doc.get_pages().len(), 1);
    let info = doc
        .trailer
        .get(b"Info")
        .and_then(lopdf::Object::as_reference)
        .unwrap();
    let info = doc.get_object(info).unwrap().as_dict().unwrap();
    let title = info.get(b"Title").unwrap();
    assert!(
        format!("{title:?}").contains("0053006800690070"),
        "title not UTF-16 'Ship': {title:?}"
    );
    let producer = format!("{:?}", info.get(b"Producer").unwrap());
    assert!(producer.contains("Synkban"));
}

#[test]
fn only_http_https_and_mailto_links_are_clickable() {
    let link = |href: &str, t: &str| json!({"type": "text", "text": t, "marks": [{"type": "link", "attrs": {"href": href}}]});
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
        .filter_map(|op| {
            if let Op::Link { url, .. } = op {
                Some(url.as_str())
            } else {
                None
            }
        })
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
        .filter(|o| {
            o.as_stream()
                .ok()
                .and_then(|s| s.dict.get(b"Subtype").ok())
                .and_then(|t| t.as_name().ok())
                == Some(b"Image")
        })
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
    let info = doc
        .trailer
        .get(b"Info")
        .and_then(lopdf::Object::as_reference)
        .unwrap();
    let title = format!(
        "{:?}",
        doc.get_object(info)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Title")
            .unwrap()
    );
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
    assert!(
        texts(&l, 0).iter().filter(|t| t.starts_with('W')).count() > 3,
        "must wrap over several lines"
    );
}

#[test]
fn long_title_with_spaces_pushes_content_down_not_off_page() {
    let e = export_with(|e| e.card.title = "lorem ipsum dolor sit amet ".repeat(80));
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(!l.pages.is_empty());
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
        e.card.title =
            "\u{645}\u{631}\u{62d}\u{628}\u{627} \u{628}\u{627}\u{644}\u{639}\u{627}\u{644}\u{645}"
                .into();
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
            .map(|i| Label {
                id: i.to_string(),
                name: format!("label {i}"),
                color: "#c6e0f5".into(),
            })
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
            Label {
                id: "1".into(),
                name: "x".repeat(400),
                color: "#c6e0f5".into(),
            },
            Label {
                id: "2".into(),
                name: "bad colour".into(),
                color: "red".into(),
            },
            Label {
                id: "3".into(),
                name: "short hex".into(),
                color: "#12".into(),
            },
            Label {
                id: "4".into(),
                name: "".into(),
                color: "#ffffff".into(),
            },
            Label {
                id: "5".into(),
                name: "**bold** \u{1F525}".into(),
                color: "#ff0000".into(),
            },
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
        "",
        "null",
        "42",
        "\"just a string\"",
        "[]",
        "{}",
        "{\"type\":\"doc\"}",
        "{\"type\":\"doc\",\"content\":[]}",
        "{\"type\":\"doc\",\"content\":[null,5,\"x\",{\"foo\":1},{\"type\":\"mystery\"}]}",
        "{broken json",
        "plain text\n\nsecond paragraph",
    ] {
        let e = export_with(|e| e.card.description = d.into());
        let (l, pdf) = build(&e);
        assert_pdfa(&pdf);
        assert_in_bounds(&l, true);
    }
}

#[test]
fn unknown_wrapper_nodes_still_show_their_content() {
    let e = with_description(vec![
        json!({"type": "mystery", "content": [para("inside mystery")]}),
    ]);
    assert!(pdf_text(&render(&e)).contains("inside mystery"));
}

#[test]
fn plain_text_description_keeps_paragraphs() {
    let e = export_with(|e| e.card.description = "first para\n\nsecond para".into());
    assert_in_order(
        &pdf_text(&render(&e)),
        &["Description", "first para", "second para"],
    );
}

#[test]
fn empty_paragraphs_only_add_space() {
    let e = with_description(vec![
        para(""),
        json!({"type": "paragraph"}),
        para("   "),
        para("after"),
    ]);
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
            Op::Text { text, y, .. } if ["one", "two", "three"].contains(&text.as_str()) => {
                Some(*y)
            }
            _ => None,
        })
        .collect();
    assert_eq!(ys.len(), 3);
    assert!(ys[0] < ys[1] && ys[1] < ys[2]);
    assert!(
        ys[2] - ys[1] > ys[1] - ys[0] + 5.0,
        "double break leaves a blank line"
    );
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
    let e = with_description(vec![
        json!({"type": "ordered_list", "attrs": {"order": 7}, "content": [
            {"type": "list_item", "content": [para(&long)]},
            {"type": "list_item", "content": [para("second")]},
            {"type": "list_item", "content": []},
        ]}),
    ]);
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
    assert!(
        all_text(&l).contains("    indented"),
        "leading spaces survive"
    );
    assert!(pdf_text(&pdf).contains("end"));
}

#[test]
fn lua_blocks_render_header_code_output_outdated_and_errors() {
    let fresh_code = "return 1 + 2";
    let fresh_hash = fnv1a_32_hex(fresh_code);
    let e = with_description(vec![
        json!({
            "type": "lua_block",
            "attrs": { "output": "=> 3", "error": null, "ran_hash": fresh_hash },
            "content": [text_node(fresh_code)]
        }),
        json!({
            "type": "lua_block",
            "attrs": { "output": "=> 3", "error": null, "ran_hash": "00000000" },
            "content": [text_node("return 2 + 2")]
        }),
        json!({
            "type": "lua_block",
            "attrs": { "output": null, "error": "boom", "ran_hash": "ffffffff" },
            "content": [text_node("error('boom')")]
        }),
        json!({ "type": "lua_block" }),
    ]);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let txt = pdf_text(&pdf);
    assert!(txt.contains("Lua"), "{txt}");
    assert!(txt.contains("return 1 + 2"), "{txt}");
    assert!(txt.contains("=> 3"), "{txt}");
    assert!(txt.contains("Lua (outdated)"), "{txt}");
    assert!(txt.contains("! boom"), "{txt}");
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
            Op::Text { text, size, .. } if ["H1", "H6", "no level"].contains(&text.as_str()) => {
                Some(*size)
            }
            _ => None,
        })
        .collect();
    assert_eq!(sizes, [18.0, 13.0, 18.0]);
}

// ── corner cases: characters ─────────────────────────────────────────────

#[test]
fn unsupported_characters_become_question_marks_not_notdef() {
    let e = with_description(vec![para(
        "cjk \u{4f60}\u{597d} \u{3053}\u{3093}\u{306b}\u{3061}\u{306f} \u{c548}\u{b155} end",
    )]);
    let (_, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert!(
        pdf_text(&pdf).contains("cjk ?? ????? ?? end"),
        "{}",
        pdf_text(&pdf)
    );
}

#[test]
fn invisible_and_control_characters_are_dropped() {
    let e = with_description(vec![para(
        "a\u{200B}b\u{200D}c\u{FEFF}d\u{00AD}e\u{0}f\u{7}g\u{FE0F}h\u{1F3FD}i",
    )]);
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
            assert!(
                !t.chars().next().is_some_and(combining),
                "line starts with a combining mark: {t:?}"
            );
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
        .filter_map(|op| {
            if let Op::Text { face, text, .. } = op {
                (!text.is_ascii()).then_some(*face as u8)
            } else {
                None
            }
        })
        .collect();
    for f in [
        Face::Hebrew,
        Face::Arabic,
        Face::Devanagari,
        Face::Thai,
        Face::Emoji,
    ] {
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
        table_node(&[
            vec!["a", "b", "c"],
            vec!["only one"],
            vec!["x", "y", "z", "extra", "cells"],
        ]),
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
    let rows = vec![
        header.iter().map(String::as_str).collect::<Vec<_>>(),
        row.iter().map(String::as_str).collect(),
    ];
    let (l, pdf) = build(&with_description(vec![table_node(&rows)]));
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn unbreakable_cell_content_is_hard_wrapped() {
    let long = "A".repeat(300);
    let (l, pdf) = build(&with_description(vec![table_node(&[
        vec!["h1", "h2"],
        vec![&long, "ok"],
    ])]));
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
}

#[test]
fn table_columns_are_centred_and_use_natural_width() {
    let (l, _) = build(&with_description(vec![table_node(&[
        vec!["A", "B"],
        vec!["1", "2"],
    ])]));
    let rules: Vec<(f32, f32)> = l.pages[0]
        .iter()
        .filter_map(|op| match op {
            Op::Rect { x, w, h, .. } if *h < 1.0 && *w > 20.0 && *w < CONTENT_W - 1.0 => {
                Some((*x, *w))
            }
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
    let (l, _) = build(&with_description(vec![table_node(&[
        vec!["a", "b"],
        vec![&long, &long],
    ])]));
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
    let x = |s: &str| {
        l.pages[0]
            .iter()
            .find_map(|op| match op {
                Op::Text { x, text, .. } if text == s => Some(*x),
                _ => None,
            })
            .unwrap()
    };
    // Within a column the single letters sit at the edge their alignment names.
    assert!(x("L") < x("C") && x("C") < x("R"));
    let w = |s: &str, size: f32| l.fonts.width(Face::Regular, s, size);
    let col2_left = x("long centre text");
    let col2_width = w("long centre text", 9.5) + 0.0;
    assert!(
        (x("C") - (col2_left + (col2_width - w("C", 9.5)) / 2.0)).abs() < 1.5,
        "centre cell off-centre"
    );
    let col3_right = x("long right text") + w("long right text", 9.5);
    assert!(
        (x("R") + w("R", 9.5) - col3_right).abs() < 1.5,
        "right cell not flush right"
    );
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
    let rows = |n: usize| -> Vec<Vec<String>> {
        (0..n).map(|i| vec![format!("r{i}"), "x".into()]).collect()
    };
    let build_rows = |n: usize| {
        let data = rows(n);
        let mut all: Vec<Vec<&str>> = vec![vec!["H", "V"]];
        all.extend(data.iter().map(|r| r.iter().map(String::as_str).collect()));
        let mut e = with_description(vec![table_node(&all)]);
        e.card.checklist.clear();
        e.attachments.clear();
        build(&e).0
    };
    let fits = (1..60)
        .rev()
        .find(|n| build_rows(*n).pages.len() == 1)
        .expect("some table fits");
    let l = build_rows(fits);
    assert_eq!(l.pages.len(), 1);
    let l2 = build_rows(fits + 1);
    assert_eq!(l2.pages.len(), 2);
    assert!(
        texts(&l2, 1).contains(&"H"),
        "table moved whole, header included"
    );
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
                assert!(
                    t[i..]
                        .iter()
                        .any(|x| x.starts_with('r') && x[1..].chars().all(|c| c.is_ascii_digit())),
                    "filler {filler}: header alone on page {p}"
                );
            }
        }
    }
}

#[test]
fn a_row_taller_than_a_page_terminates() {
    let huge = "paragraph words ".repeat(1500);
    let (l, pdf) = build(&with_description(vec![
        table_node(&[vec!["h"], vec![&huge]]),
        para("after"),
    ]));
    assert_pdfa(&pdf);
    assert!(all_text(&l).contains("after"));
    // Known limitation: such a row is not split, so height is not asserted.
    assert_in_bounds(&l, false);
}

#[test]
fn matrix_leaves_corner_open_centers_headers_and_honours_per_cell_alignment() {
    let cell = |kind: &str, align: Option<&str>, t: &str| {
        let content = if t.is_empty() {
            json!([])
        } else {
            json!([para(t)])
        };
        json!({"type": kind, "attrs": {"align": align}, "content": content})
    };
    let matrix = json!({
        "type": "table",
        "attrs": {"matrix": true},
        "content": [
            {"type": "table_row", "content": [
                cell("table_cell", None, "IGNORED"),
                cell("table_header", Some("right"), "ColA"),
                cell("table_header", None, "ColB"),
            ]},
            {"type": "table_row", "content": [
                cell("table_header", Some("right"), "Row1"),
                cell("table_cell", Some("left"), "L"),
                cell("table_cell", Some("right"), "R"),
            ]},
            {"type": "table_row", "content": [
                cell("table_header", None, "Row2LongLabel"),
                cell("table_cell", Some("center"), "C"),
                cell("table_cell", Some("left"), "WideBodyValue"),
            ]},
        ]
    });
    let (l, pdf) = build(&with_description(vec![matrix]));
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let ops = &l.pages[0];

    // Corner text is ignored; row 0 and col 0 headers use Face::Bold; body uses Regular.
    let find_text = |s: &str| {
        ops.iter().find_map(|op| match op {
            Op::Text {
                x, y, face, text, ..
            } if text == s => Some((*x, *y, *face)),
            _ => None,
        })
    };
    assert!(
        find_text("IGNORED").is_none(),
        "corner cell must stay empty"
    );
    let (_, _, f_cola) = find_text("ColA").unwrap();
    let (x_row1, y_row1, f_row1) = find_text("Row1").unwrap();
    let (x_row2, _, f_row2) = find_text("Row2LongLabel").unwrap();
    let (x_l, _, f_l) = find_text("L").unwrap();
    let (x_c, _, _) = find_text("C").unwrap();
    let (x_r, _, _) = find_text("R").unwrap();
    let (x_wide, _, _) = find_text("WideBodyValue").unwrap();
    assert!(f_cola == Face::Bold && f_row1 == Face::Bold && f_row2 == Face::Bold);
    assert!(f_l == Face::Regular);

    // Row1 (shorter than Row2LongLabel) is centred in col 0.
    assert!(
        x_row1 > x_row2 + 10.0,
        "row header not centred: {x_row1} vs {x_row2}"
    );
    // Body cells keep per-cell alignment in the same column: L < C in col 1, R > WideBodyValue in col 2.
    assert!(
        x_l < x_c,
        "col 1 per-cell alignment failed: L={x_l} C={x_c}"
    );
    assert!(
        x_r > x_wide,
        "col 2 per-cell alignment failed: R={x_r} wide={x_wide}"
    );

    // Header background: 4 header cells (ColA, ColB, Row1, Row2LongLabel), NOT the corner.
    let head_bgs: Vec<(f32, f32, f32, f32)> = ops
        .iter()
        .filter_map(|op| match op {
            Op::Rect { x, y, w, h, color } if *color == HEAD_BG => Some((*x, *y, *w, *h)),
            _ => None,
        })
        .collect();
    assert_eq!(head_bgs.len(), 4);
    assert!(
        !head_bgs
            .iter()
            .any(|(x, y, _, h)| *x < x_row2 && *y + *h < y_row1),
        "corner cell must not have header background"
    );

    // Top rule of row 0 skips col 0; left vertical rule of (0,0) is omitted.
    let col0_left = head_bgs
        .iter()
        .find(|(_, y, _, _)| *y > y_row1 - 20.0)
        .unwrap()
        .0;
    let col1_left = head_bgs
        .iter()
        .find(|(x, y, _, _)| *x > col0_left + 10.0 && *y < y_row1 - 10.0)
        .unwrap()
        .0;
    let row0_top = head_bgs
        .iter()
        .map(|(_, y, _, _)| *y)
        .fold(f32::MAX, f32::min);
    assert!(
        !ops.iter().any(|op| matches!(
            op,
            Op::Rect { x, y, w, h, color }
                if *color == RULE && *h < 1.0 && (*y - row0_top).abs() < 0.5 && *x < col0_left + 1.0 && *w > 1.0
        )),
        "top rule must skip the open corner"
    );
    assert!(
        !ops.iter().any(|op| matches!(
            op,
            Op::Rect { x, y, w, h, color }
                if *color == RULE && *w < 1.0 && (*x - col0_left).abs() < 0.5 && *y < row0_top + 1.0 && *h > 1.0
        )),
        "left rule must skip the open corner"
    );
    let _ = col1_left;
}

#[test]
fn degenerate_matrices_stay_valid_and_in_bounds() {
    let cell = |kind: &str, t: &str| {
        let content = if t.is_empty() {
            json!([])
        } else {
            json!([para(t)])
        };
        json!({"type": kind, "attrs": {"align": null}, "content": content})
    };
    let cases = vec![
        json!({"type": "table", "attrs": {"matrix": true}, "content": [
            {"type": "table_row", "content": [cell("table_cell", "")]},
        ]}),
        json!({"type": "table", "attrs": {"matrix": true}, "content": [
            {"type": "table_row", "content": [cell("table_cell", ""), cell("table_header", "OnlyCol")]},
        ]}),
        json!({"type": "table", "attrs": {"matrix": true}, "content": [
            {"type": "table_row", "content": [cell("table_cell", "")]},
            {"type": "table_row", "content": [cell("table_header", "OnlyRow")]},
        ]}),
    ];
    for m in cases {
        let (l, pdf) = build(&with_description(vec![m.clone(), para("after matrix")]));
        assert_pdfa(&pdf);
        assert_in_bounds(&l, true);
        assert!(all_text(&l).contains("after matrix"), "{m}");
    }
}

// ── corner cases: pagination ─────────────────────────────────────────────

#[test]
fn page_footers_number_every_page() {
    let paras: Vec<Value> = (0..260)
        .map(|i| {
            para(&format!(
                "Paragraph number {i} with a little bit of text to fill space."
            ))
        })
        .collect();
    let (l, pdf) = build(&with_description(paras));
    assert_pdfa(&pdf);
    let n = l.pages.len();
    assert!(n >= 4, "got {n} pages");
    assert_eq!(page_count(&pdf), n);
    for p in 0..n {
        assert!(
            texts(&l, p).contains(&format!("Page {} / {n}", p + 1).as_str()),
            "page {p} footer"
        );
    }
    assert_in_bounds(&l, true);
}

#[test]
fn paragraphs_that_fit_are_never_split_across_pages() {
    let paras: Vec<Value> = (0..120)
        .map(|i| {
            para(&format!(
                "P{i}: {}",
                "wrapping sentence for the paragraph. ".repeat(6)
            ))
        })
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
            assert!(
                last.trim_end().ends_with('.') || last.contains("paragraph."),
                "page {p} ends mid-paragraph: {last:?}"
            );
        }
        if p > 0 {
            let first = body.first().copied().unwrap_or("");
            assert!(
                first.starts_with('P'),
                "page {p} starts mid-paragraph: {first:?}"
            );
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
        nodes.push(
            json!({"type": "heading", "attrs": {"level": 1}, "content": [text_node("KEEPHEAD")]}),
        );
        nodes.push(para("following text"));
        let (l, _) = build(&with_description(nodes));
        for p in 0..l.pages.len() {
            let t = texts(&l, p);
            if t.contains(&"KEEPHEAD") {
                assert!(
                    t.iter().any(|x| x.starts_with("following")),
                    "filler {filler}: heading stranded on page {p}"
                );
            }
        }
    }
}

#[test]
fn checklist_header_stays_with_its_items_at_every_offset() {
    for filler in 36..54 {
        let e = export_with(|e| {
            e.card.description = doc((0..filler).map(|i| para(&format!("filler {i}"))).collect());
            e.card.checklist = (0..8)
                .map(|i| ChecklistItem {
                    id: i.to_string(),
                    text: format!("task {i}"),
                    done: false,
                })
                .collect();
        });
        let (l, _) = build(&e);
        let page_of = |needle: &str| {
            (0..l.pages.len())
                .find(|p| texts(&l, *p).iter().any(|t| t.starts_with(needle)))
                .unwrap()
        };
        assert_eq!(
            page_of("Checklist ("),
            page_of("task"),
            "filler {filler}: header separated from first item"
        );
        assert_eq!(
            page_of("task"),
            (0..l.pages.len())
                .rev()
                .find(|p| texts(&l, *p).iter().any(|t| t.starts_with("task")))
                .unwrap(),
            "filler {filler}: items split although they fit"
        );
    }
}

#[test]
fn attachment_header_stays_with_its_list_at_every_offset() {
    for filler in 36..54 {
        let e = export_with(|e| {
            e.card.description = doc((0..filler).map(|i| para(&format!("filler {i}"))).collect());
            e.card.checklist.clear();
            e.attachments = (0..6)
                .map(|i| (attachment(&format!("file{i}.bin"), 10), None))
                .collect();
        });
        let (l, _) = build(&e);
        let page_of = |needle: &str| {
            (0..l.pages.len())
                .find(|p| texts(&l, *p).iter().any(|t| t.contains(needle)))
                .unwrap()
        };
        assert_eq!(
            page_of("Attachments ("),
            page_of("file0.bin"),
            "filler {filler}"
        );
        assert_eq!(
            page_of("file0.bin"),
            page_of("file5.bin"),
            "filler {filler}: list split although it fits"
        );
    }
}

#[test]
fn huge_checklist_keeps_header_with_first_items_and_loses_nothing() {
    let e = export_with(|e| {
        e.card.checklist = (0..400)
            .map(|i| ChecklistItem {
                id: i.to_string(),
                text: format!("item {i}"),
                done: i % 3 == 0,
            })
            .collect();
    });
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let page_of = |needle: &str| {
        (0..l.pages.len())
            .find(|p| texts(&l, *p).iter().any(|t| t.contains(needle)))
            .unwrap()
    };
    assert_eq!(page_of("Checklist ("), page_of("item 0"));
    let text = pdf_text(&pdf);
    assert!(
        text.contains("Checklist (134/400)"),
        "{}",
        &text[..200.min(text.len())]
    );
    assert_in_order(&text, &["item 0", "item 200", "item 399"]);
}

#[test]
fn empty_and_giant_checklist_items() {
    let e = export_with(|e| {
        e.card.checklist = vec![
            ChecklistItem {
                id: "1".into(),
                text: String::new(),
                done: true,
            },
            ChecklistItem {
                id: "2".into(),
                text: "x".repeat(2000),
                done: false,
            },
            ChecklistItem {
                id: "3".into(),
                text: "word ".repeat(3000),
                done: false,
            },
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
            .map(|i| {
                (
                    attachment(
                        &format!("\u{00e4}\u{00f6}\u{00fc} file {i} \u{1F4CE}.bin"),
                        i * 1000,
                    ),
                    None,
                )
            })
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
        list_node(
            "bullet_list",
            vec![vec![
                para("x"),
                list_node("ordered_list", vec![vec![para("y")]]),
            ]],
        ),
        json!({"type": "code_block", "content": [text_node("code")]}),
    ];
    nodes.extend((0..80).map(|i| {
        para(&format!(
            "para {i} \u{1F680} \u{645}\u{631}\u{62d}\u{628}\u{627}"
        ))
    }));
    let mut e = with_description(nodes);
    e.attachments = vec![(attachment("a.jpg", 1), Some(jpeg(200, 100)))];
    e.card.checklist = (0..30)
        .map(|i| ChecklistItem {
            id: i.to_string(),
            text: format!("t{i}"),
            done: false,
        })
        .collect();
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert_eq!(page_count(&pdf), l.pages.len());
}

fn img_node(att: &str, alt: &str) -> Value {
    json!({"type": "image", "attrs": {"att": att, "alt": alt}})
}

fn with_thumbs(nodes: Vec<Value>, thumbs: &[(&str, Vec<u8>)]) -> CardExport {
    let mut e = with_description(nodes);
    e.card.checklist.clear();
    e.attachments = thumbs
        .iter()
        .map(|(id, bytes)| (attachment(id, bytes.len() as u64), Some(bytes.clone())))
        .collect();
    e
}

/// Inline pictures (the ones before the attachments section), as (x, y, w, h).
fn inline_pictures(l: &Layout, n: usize) -> Vec<(f32, f32, f32, f32)> {
    l.pages
        .iter()
        .flatten()
        .filter_map(|op| match op {
            Op::Image { x, y, w, h, .. } => Some((*x, *y, *w, *h)),
            _ => None,
        })
        .take(n)
        .collect()
}

#[test]
fn inline_images_are_embedded_and_never_exceed_the_line_width() {
    let e = with_thumbs(
        vec![
            json!({"type": "paragraph", "content": [text_node("before "), img_node("wide", "w.png"), text_node(" after")]}),
            json!({"type": "paragraph", "content": [img_node("tall", "t.png")]}),
            json!({"type": "paragraph", "content": [img_node("small", "s.png")]}),
            json!({"type": "bullet_list", "content": [{"type": "list_item", "content": [
                {"type": "paragraph", "content": [img_node("wide", "w.png")]}]}]}),
        ],
        &[
            ("wide", jpeg(1200, 300)),
            ("tall", jpeg(100, 900)),
            ("small", jpeg(40, 20)),
        ],
    );
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    let pics = inline_pictures(&l, 4);
    assert_eq!(pics.len(), 4);
    // Wide: scaled to the full line, aspect kept.
    assert!((pics[0].2 - CONTENT_W).abs() < 0.01 && (pics[0].3 - CONTENT_W / 4.0).abs() < 0.01);
    // Tall: limited to half the text area of a page.
    assert!((pics[1].3 - MAX_IMAGE_H).abs() < 0.01 && pics[1].2 < CONTENT_W);
    // Small: never upscaled.
    assert_eq!((pics[2].2, pics[2].3), (40.0, 20.0));
    // Nested in a list: the narrower line width is the limit.
    let indent = indent_for(CONTENT_W, 20.0);
    assert!((pics[3].2 - (CONTENT_W - indent)).abs() < 0.01);
    assert!(pics[3].0 >= MARGIN + indent - 0.01);
    // Text around the image is still there, in order; no placeholder.
    let text = pdf_text(&pdf);
    assert_in_order(&text, &["before", "after"]);
    assert!(!text.contains("[image:"));
    assert_in_bounds(&l, true);
}

#[test]
fn inline_images_move_to_the_next_page_instead_of_overflowing() {
    let mut nodes: Vec<Value> = (0..3)
        .map(|_| json!({"type": "paragraph", "content": [img_node("a", "a.png")]}))
        .collect();
    nodes.push(para("done"));
    let e = with_thumbs(nodes, &[("a", jpeg(500, 400))]);
    let (l, _) = build(&e);
    assert!(l.pages.len() >= 2);
    assert_in_bounds(&l, true);
}

fn png(w: u32, h: u32, alpha: u8) -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(w, h, image::Rgba([200, 30, 30, alpha]));
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
    buf.into_inner()
}

#[test]
fn inline_images_use_the_original_not_the_thumbnail() {
    // Thumbnail 400px, original 1500px: the page must carry the sharper one.
    let mut e = with_thumbs(
        vec![json!({"type": "paragraph", "content": [img_node("a", "a.png")]})],
        &[("a", jpeg(400, 267))],
    );
    e.originals.insert("a".into(), png(1500, 1000, 255));
    let l = layout_card(&e).unwrap();
    assert_eq!(l.images[0].size(), (1500, 1000));
    // Large originals are scaled down; transparent ones flatten onto white.
    e.originals.insert("a".into(), png(5000, 2500, 0));
    let l = layout_card(&e).unwrap();
    assert_eq!(l.images[0].size(), (PICTURE_MAX_PX, PICTURE_MAX_PX / 2));
    assert!(replay(&l, &e).is_ok());
    let flat = image::load_from_memory(&prepare_picture(&png(8, 8, 0)).unwrap()).unwrap();
    assert!(flat
        .to_rgb8()
        .pixels()
        .all(|p| p[0] > 245 && p[1] > 245 && p[2] > 245));
    // An undecodable original falls back to the thumbnail.
    e.originals.insert("a".into(), b"garbage".to_vec());
    assert_eq!(layout_card(&e).unwrap().images[0].size(), (400, 267));
}

#[test]
fn a_paragraph_with_an_image_moves_to_the_next_page_as_a_whole() {
    // Filler leaves too little room for the image: the text before it must not
    // stay behind alone (same keep-together rule as a text paragraph).
    let e = with_thumbs(
        vec![
            para(&"Filler text. ".repeat(190)),
            json!({"type": "paragraph", "content": [text_node("Caption before the picture"), img_node("a", "a.png")]}),
        ],
        &[("a", jpeg(300, 300))],
    );
    let l = layout_card(&e).unwrap();
    let page_of = |needle: &str| {
        (0..l.pages.len())
            .find(|&p| texts(&l, p).iter().any(|t| t.contains(needle)))
            .unwrap()
    };
    let pic_page = l
        .pages
        .iter()
        .position(|ops| ops.iter().any(|o| matches!(o, Op::Image { .. })))
        .unwrap();
    assert_eq!(page_of("Caption"), pic_page);
    assert!(pic_page >= 1);
    assert_in_bounds(&l, true);
}

#[test]
fn a_description_of_two_big_images_starts_on_the_first_page() {
    // Both pictures fit a page together, but not what is left of page 1: the
    // title and the first picture stay, only the second moves on.
    for height in [320, 360] {
        for nodes in [
            vec![
                json!({"type": "paragraph", "content": [img_node("a", "a.png")]}),
                json!({"type": "paragraph", "content": [img_node("a", "a.png")]}),
            ],
            vec![
                json!({"type": "paragraph", "content": [img_node("a", "a.png"), img_node("a", "a.png")]}),
            ],
        ] {
            let mut e = with_thumbs(nodes, &[("a", jpeg(480, height))]);
            e.card.due_date = None;
            let l = layout_card(&e).unwrap();
            let pics: Vec<usize> = (0..l.pages.len())
                .flat_map(|p| {
                    l.pages[p]
                        .iter()
                        .filter(|o| matches!(o, Op::Image { .. }))
                        .map(move |_| p)
                })
                .take(2)
                .collect();
            assert_eq!(pics, [0, 1], "height {height}");
            assert_eq!(page_with(&l, "Description"), 0, "height {height}");
        }
    }
}

#[test]
fn dangling_or_undecodable_image_references_fall_back_to_text() {
    let e = with_thumbs(
        vec![json!({"type": "paragraph", "content": [
            img_node("gone", "gone.png"), text_node(" "), img_node("bad", "bad.png"), text_node(" "),
            json!({"type": "image", "attrs": {}})]})],
        &[("bad", b"not a jpeg".to_vec())],
    );
    let (l, pdf) = build(&e);
    assert_in_order(
        &pdf_text(&pdf),
        &["[image: gone.png]", "[image: bad.png]", "[image: ]"],
    );
    assert!(inline_pictures(&l, 1).is_empty());
}

#[test]
fn inline_image_reference_prints_its_file_name() {
    let img = json!({"type": "image", "attrs": {"att": "a1", "alt": "shot ü.png"}});
    let bare = json!({"type": "image", "attrs": {"att": "a2"}});
    let e = with_description(vec![
        json!({"type": "paragraph", "content": [text_node("before "), img, text_node(" after")]}),
        json!({"type": "paragraph", "content": [bare]}),
    ]);
    let text = pdf_text(&render(&e));
    assert_in_order(
        &text,
        &["before", "[image: shot ü.png]", "after", "[image: ]"],
    );
    assert_in_bounds(&layout_card(&e).unwrap(), true);
}

#[test]
fn inline_shown_images_are_omitted_from_the_attachment_list() {
    let mut e = with_thumbs(
        vec![
            json!({"type": "paragraph", "content": [img_node("shown.png", "shown.png")]}),
            json!({"type": "paragraph", "content": [img_node("bad.png", "bad.png")]}),
            json!({"type": "table", "content": [{"type": "table_row", "content": [
                {"type": "table_cell", "attrs": {"align": null}, "content": [
                    {"type": "paragraph", "content": [img_node("in_table.png", "in_table.png")]}
                ]}
            ]}]}),
        ],
        &[
            ("shown.png", jpeg(120, 80)),
            ("extra.png", jpeg(90, 60)),
            ("in_table.png", jpeg(70, 50)),
            ("bad.png", b"not a jpeg".to_vec()),
        ],
    );
    e.attachments.push((attachment("notes.txt", 42), None));

    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);

    let text = pdf_text(&pdf);
    assert!(text.contains("Attachments (4)"), "got:\n{text}");
    assert!(
        !text.contains("shown.png"),
        "shown.png should be omitted:\n{text}"
    );
    for expected in ["extra.png", "in_table.png", "bad.png", "notes.txt"] {
        assert!(text.contains(expected), "missing {expected}:\n{text}");
    }
    let image_ops = l
        .pages
        .iter()
        .flatten()
        .filter(|op| matches!(op, Op::Image { .. }))
        .count();
    assert_eq!(image_ops, 3, "1 inline + 2 unshown attachment thumbnails");
}

#[test]
fn attachments_section_is_omitted_when_every_attachment_is_shown_inline() {
    let e = with_thumbs(
        vec![json!({"type": "paragraph", "content": [
            img_node("a.png", "a.png"),
            img_node("b.png", "b.png"),
        ]})],
        &[("a.png", jpeg(80, 60)), ("b.png", jpeg(60, 80))],
    );
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let text = pdf_text(&pdf);
    assert!(!text.contains("Attachments"), "unexpected section:\n{text}");
    let image_ops = l
        .pages
        .iter()
        .flatten()
        .filter(|op| matches!(op, Op::Image { .. }))
        .count();
    assert_eq!(image_ops, 2);
}

// ── page-break rules (as in the terminal app's export) ───────────────────

/// `n` one-line paragraphs, to push what follows to every possible page offset.
fn filler(n: usize) -> Vec<Value> {
    (0..n).map(|_| para("filler")).collect()
}

/// How many text items containing `pat` each page holds.
fn per_page(l: &Layout, pat: &str) -> Vec<usize> {
    (0..l.pages.len())
        .map(|p| texts(l, p).iter().filter(|t| t.contains(pat)).count())
        .collect()
}

fn page_with(l: &Layout, pat: &str) -> usize {
    per_page(l, pat)
        .iter()
        .position(|&c| c > 0)
        .unwrap_or(usize::MAX)
}

#[test]
fn a_section_that_fits_a_page_is_never_split_and_subsections_follow_suit() {
    for n in 0..45 {
        let mut nodes = filler(n);
        nodes.push(json!({"type": "heading", "attrs": {"level": 2}, "content": [text_node("Section head")]}));
        nodes.extend((0..7).map(|i| para(&format!("section body {i}"))));
        nodes.push(
            json!({"type": "heading", "attrs": {"level": 3}, "content": [text_node("Sub head")]}),
        );
        nodes.extend((0..5).map(|i| para(&format!("sub body {i}"))));
        let l = layout_card(&with_description(nodes)).unwrap();
        assert_eq!(
            page_with(&l, "Section head"),
            page_with(&l, "sub body 4"),
            "filler {n}"
        );
    }
}

#[test]
fn a_section_longer_than_a_page_flows_but_its_subsections_are_kept() {
    for n in 0..45 {
        let mut nodes = filler(n);
        nodes.push(
            json!({"type": "heading", "attrs": {"level": 1}, "content": [text_node("Big head")]}),
        );
        nodes.extend((0..70).map(|i| para(&format!("big body {i}"))));
        nodes.push(
            json!({"type": "heading", "attrs": {"level": 2}, "content": [text_node("Sub head")]}),
        );
        nodes.extend((0..6).map(|i| para(&format!("sub body {i}"))));
        let l = layout_card(&with_description(nodes)).unwrap();
        assert!(l.pages.len() >= 2);
        assert_eq!(
            page_with(&l, "Sub head"),
            page_with(&l, "sub body 5"),
            "filler {n}"
        );
    }
}

#[test]
fn the_description_title_stays_with_its_first_section() {
    for n in 0..30 {
        let mut e = with_description(vec![
            json!({"type": "heading", "attrs": {"level": 2}, "content": [text_node("First head")]}),
            para("first body 1"),
            para("first body 2"),
        ]);
        e.labels = labels(n);
        e.card.checklist.clear();
        let l = layout_card(&e).unwrap();
        assert_eq!(
            page_with(&l, "Description"),
            page_with(&l, "first body 2"),
            "labels {n}"
        );
    }
}

#[test]
fn blocks_up_to_half_a_page_are_kept_whole_bigger_ones_split() {
    let lines = |k: usize| {
        (0..k)
            .map(|i| format!("w{i}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let mut saw_split = false;
    for n in 0..45 {
        let code = |k: usize| {
            let mut nodes = filler(n);
            nodes.push(code_node(&lines(k)));
            layout_card(&with_description(nodes)).unwrap()
        };
        // ~15 lines of 12.6pt: well under half a page.
        let small = code(15);
        assert_eq!(
            page_with(&small, "w0"),
            page_with(&small, "w14"),
            "filler {n}"
        );
        // ~45 lines: more than half a page, so it may start early and split.
        let big = code(45);
        saw_split |= page_with(&big, "w0") != page_with(&big, "w44");
    }
    assert!(saw_split, "big blocks must flow instead of leaving gaps");
}

#[test]
fn no_single_line_or_row_is_left_alone_on_a_page() {
    let words = |tag: &str| format!("{tag} ").repeat(1);
    for n in 0..45 {
        // A long paragraph (more than half a page: it splits).
        let mut nodes = filler(n);
        nodes.push(para(&(0..400).map(|_| words("zeta")).collect::<String>()));
        let l = layout_card(&with_description(nodes)).unwrap();
        for c in per_page(&l, "zeta") {
            assert_ne!(c, 1, "paragraph, filler {n}");
        }
        // Code.
        let mut nodes = filler(n);
        nodes.push(code_node(
            &(0..60)
                .map(|i| format!("cc{i}"))
                .collect::<Vec<_>>()
                .join("\n"),
        ));
        let l = layout_card(&with_description(nodes)).unwrap();
        for c in per_page(&l, "cc") {
            assert_ne!(c, 1, "code, filler {n}");
        }
        // Table body rows.
        let rows: Vec<Vec<String>> = (0..60)
            .map(|i| vec![format!("rw{i}"), "x".into()])
            .collect();
        let mut all: Vec<Vec<&str>> = vec![vec!["H1", "H2"]];
        all.extend(rows.iter().map(|r| r.iter().map(String::as_str).collect()));
        let mut nodes = filler(n);
        nodes.push(table_node(&all));
        let l = layout_card(&with_description(nodes)).unwrap();
        for c in per_page(&l, "rw") {
            assert_ne!(c, 1, "table, filler {n}");
        }
    }
}

fn code_node(t: &str) -> Value {
    json!({"type": "code_block", "content": [text_node(t)]})
}

fn labels(n: usize) -> Vec<Label> {
    (0..n)
        .map(|i| Label {
            id: i.to_string(),
            name: format!("Label number {i} with some more words"),
            color: "#c6e0f5".into(),
        })
        .collect()
}

#[test]
fn footnotes_render_on_same_page_restart_numbering_per_page_and_omit_orphans() {
    let fn_ref = |id: &str| json!({"type": "footnote_ref", "attrs": {"id": id}});
    let fn_def = |id: &str, text: &str| {
        json!({
            "type": "footnote_def",
            "attrs": {"id": id},
            "content": [{"type": "footnote_paragraph", "content": [text_node(text)]}]
        })
    };
    let mut nodes = vec![json!({
        "type": "paragraph",
        "content": [
            text_node("Page one A"),
            fn_ref("a"),
            text_node(" and B"),
            fn_ref("b"),
            text_node(".")
        ]
    })];
    for i in 0..32 {
        nodes.push(para(&format!("Filler line {i} to force page two.")));
    }
    nodes.push(json!({
        "type": "paragraph",
        "content": [
            text_node("Page two C"),
            fn_ref("c"),
            text_node(" and A again"),
            fn_ref("a"),
            text_node(".")
        ]
    }));
    nodes.push(json!({
        "type": "footnote_list",
        "content": [
            fn_def("a", "NOTE_ALPHA"),
            fn_def("b", "NOTE_BETA"),
            fn_def("c", "NOTE_GAMMA"),
            fn_def("orphan", "NOTE_ORPHAN_SECRET"),
        ]
    }));
    let e = with_description(nodes);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(l.pages.len() >= 2, "expected at least 2 pages");

    let page_texts = |page: &[Op]| -> Vec<String> {
        page.iter()
            .filter_map(|op| match op {
                Op::Text { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    };

    let p0 = page_texts(&l.pages[0]).join(" ");
    let p1 = page_texts(&l.pages[1]).join(" ");
    assert!(p0.contains("NOTE_ALPHA") && p0.contains("NOTE_BETA"));
    assert!(!p0.contains("NOTE_GAMMA"));
    assert!(p1.contains("NOTE_GAMMA") && p1.contains("NOTE_ALPHA"));
    assert!(!p1.contains("NOTE_BETA"));
    assert!(!p0.contains("NOTE_ORPHAN_SECRET") && !p1.contains("NOTE_ORPHAN_SECRET"));
    // Per-page numbering restarts at [1] on page 2 (no [3] anywhere).
    assert!(p0.contains("[1]") && p0.contains("[2]"));
    assert!(p1.contains("[1]") && p1.contains("[2]"));
    assert!(!p1.contains("[3]"));
}

#[test]
fn giant_footnote_splits_across_pages_without_exceeding_bounds() {
    let huge = "long footnote sentence ".repeat(140);
    let nodes = vec![
        json!({
            "type": "paragraph",
            "content": [
                text_node("Body with huge footnote"),
                {"type": "footnote_ref", "attrs": {"id": "big"}},
                text_node(".")
            ]
        }),
        json!({
            "type": "footnote_list",
            "content": [{
                "type": "footnote_def",
                "attrs": {"id": "big"},
                "content": [{"type": "footnote_paragraph", "content": [text_node(&huge)]}]
            }]
        }),
    ];
    let e = with_description(nodes);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    assert!(
        l.pages.len() >= 2,
        "expected carried footnote overflow page"
    );
}

#[test]
fn highlights_emit_colored_background_rects_in_pdf() {
    let nodes = vec![json!({
        "type": "paragraph",
        "content": [
            { "type": "text", "text": "Plain " },
            { "type": "text", "marks": [{ "type": "highlight", "attrs": { "color": "yellow" } }], "text": "sunny words" },
            { "type": "text", "text": " and " },
            { "type": "text", "marks": [{ "type": "highlight", "attrs": { "color": "blue" } }, { "type": "strong" }], "text": "bold blue" },
        ]
    })];
    let e = with_description(nodes);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let yellow = highlight_rgb("yellow").unwrap();
    let blue = highlight_rgb("blue").unwrap();
    let has_yellow = l.pages[0]
        .iter()
        .any(|op| matches!(op, Op::Rect { color, .. } if *color == yellow));
    let has_blue = l.pages[0]
        .iter()
        .any(|op| matches!(op, Op::Rect { color, .. } if *color == blue));
    assert!(has_yellow, "expected yellow highlight rect");
    assert!(has_blue, "expected blue highlight rect");
}

#[test]
fn alerts_render_all_kinds_and_darker_inline_code_background() {
    let mut nodes = Vec::new();
    for kind in ["note", "tip", "important", "warning", "caution"] {
        nodes.push(json!({
            "type": "alert",
            "attrs": { "kind": kind },
            "content": [{
                "type": "paragraph",
                "content": [
                    { "type": "text", "text": format!("Body for {kind} with ") },
                    { "type": "text", "marks": [{ "type": "code" }], "text": "inline_code()" },
                    { "type": "text", "text": "." }
                ]
            }]
        }));
    }
    let e = with_description(nodes);
    let (l, pdf) = build(&e);
    assert_pdfa(&pdf);
    assert_in_bounds(&l, true);
    let text = all_text(&l);
    for label in ["Note", "Tip", "Important", "Warning", "Caution"] {
        assert!(text.contains(label), "missing alert header {label}");
    }
    let icon_count = l
        .pages
        .iter()
        .flatten()
        .filter(|op| matches!(op, Op::AlertIcon { .. }))
        .count();
    assert_eq!(icon_count, 5);
    let code_bg_count = l
        .pages
        .iter()
        .flatten()
        .filter(|op| matches!(op, Op::Rect { color, .. } if *color == ALERT_CODE_BG))
        .count();
    assert_eq!(
        code_bg_count, 5,
        "expected darker inline code background inside each alert"
    );
}

mod examples;
