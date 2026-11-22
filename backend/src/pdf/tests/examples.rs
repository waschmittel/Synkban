//! Corner cases and the example PDFs in `docs/export-examples/`. Every case is
//! rendered (PDF/A validation included) and checked for layout invariants;
//! the files are compared byte for byte, so they must be regenerated with
//! `UPDATE_EXAMPLES=1 cargo test --lib examples` whenever PDF output changes.

use super::*;
use std::path::PathBuf;

/// A picture that is recognisable in a PDF: diagonal gradient with a frame.
fn picture(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbImage::from_fn(w, h, |x, y| {
        let edge = x < 3 || y < 3 || x + 3 >= w || y + 3 >= h;
        if edge {
            image::Rgb([30, 40, 60])
        } else {
            image::Rgb([
                (x * 255 / w) as u8,
                (y * 255 / h) as u8,
                (255 - (x + y) * 255 / (w + h)) as u8,
            ])
        }
    });
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .unwrap();
    buf.into_inner()
}

fn img(att: &str) -> Value {
    json!({"type": "image", "attrs": {"att": att, "alt": format!("{att}.png")}})
}

fn p(nodes: Vec<Value>) -> Value {
    json!({"type": "paragraph", "content": nodes})
}

fn h(level: u8, t: &str) -> Value {
    json!({"type": "heading", "attrs": {"level": level}, "content": [text_node(t)]})
}

fn code(t: &str) -> Value {
    json!({"type": "code_block", "content": [text_node(t)]})
}

fn quote(nodes: Vec<Value>) -> Value {
    json!({"type": "blockquote", "content": nodes})
}

fn checklist(n: usize) -> Vec<ChecklistItem> {
    (0..n)
        .map(|i| ChecklistItem {
            id: i.to_string(),
            text: format!("step {i}"),
            done: i % 3 == 0,
        })
        .collect()
}

fn with_pictures(nodes: Vec<Value>, pics: &[(&str, u32, u32)]) -> CardExport {
    let mut e = with_description(nodes);
    let mut e_originals = HashMap::new();
    e.card.checklist.clear();
    e.attachments = pics
        .iter()
        .map(|(id, w, h)| {
            let mut a = attachment(&format!("{id}.png"), 4096);
            a.id = id.to_string();
            a.content_type = "image/png".into();
            // Thumbnail for the attachment list, a sharper original for inline use.
            e_originals.insert(id.to_string(), picture(*w * 2, *h * 2));
            (a, Some(picture((*w).min(400), (*h).min(400))))
        })
        .collect();
    e.originals = e_originals;
    e
}

fn titled(mut e: CardExport, title: &str) -> CardExport {
    e.card.title = title.into();
    e
}

/// `(file stem, export)`; the order is the numbering of the example files.
fn corner_cases() -> Vec<(&'static str, CardExport)> {
    let long_word =
        "Averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongword".repeat(2);
    let wide: Vec<Vec<String>> = (0..4)
        .map(|r| (0..10).map(|c| format!("cell {r}.{c} with text")).collect())
        .collect();
    let wide_refs: Vec<Vec<&str>> = wide
        .iter()
        .map(|r| r.iter().map(String::as_str).collect())
        .collect();
    let long_rows: Vec<Vec<String>> = (0..150)
        .map(|i| vec![format!("row {i}"), format!("{}", i * 7), "some text".into()])
        .collect();
    let mut long_table: Vec<Vec<&str>> = vec![vec!["Name", "Value", "Note"]];
    long_table.extend(
        long_rows
            .iter()
            .map(|r| r.iter().map(String::as_str).collect()),
    );
    let many_lines = (0..120)
        .map(|i| format!("line {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let wide_pic = ("wide", 1200, 300);
    let tall_pic = ("tall", 100, 900);

    let cases = vec![
        ("00-showcase", showcase()),
        ("01-empty-card", {
            let mut e = with_description(vec![]);
            e.card.title.clear();
            e.card.due_date = None;
            e.card.checklist.clear();
            e.labels.clear();
            e.attachments.clear();
            e
        }),
        (
            "02-very-long-title",
            titled(with_description(vec![para("Body")]), &"A title that just keeps going and going ".repeat(12)),
        ),
        (
            "03-unicode-and-missing-glyphs",
            with_description(vec![
                para("Umlauts äöüß ÄÖÜ, euro € and arrows → ⇒, emoji 🚀, CJK 日本語, Arabic مرحبا, a tab\there."),
                para("Control \u{1}\u{7} characters and a zero width\u{200b}space."),
            ]),
        ),
        (
            "04-unbreakable-words",
            with_description(vec![
                para(&long_word),
                list_node("bullet_list", vec![vec![para(&long_word)]]),
                quote(vec![para(&long_word)]),
                json!({"type": "paragraph", "content": [{"type": "text", "marks": [{"type": "code"}], "text": long_word}]}),
            ]),
        ),
        ("05-wide-table", with_description(vec![table_node(&wide_refs)])),
        ("06-long-table-repeats-header", with_description(vec![table_node(&long_table)])),
        (
            "07-heading-hierarchy",
            with_description(vec![
                h(1, "Level one"),
                para("Intro."),
                h(2, "Level two"),
                para(&"Text for the section. ".repeat(60)),
                h(3, "Level three"),
                para("Deep."),
                h(2, "Another level two"),
                para("End."),
            ]),
        ),
        (
            "08-lists-and-quotes",
            with_description(vec![
                list_node(
                    "ordered_list",
                    vec![
                        vec![para("first"), list_node("bullet_list", vec![vec![para("nested")], vec![para("nested too")]])],
                        vec![para("second")],
                    ],
                ),
                quote(vec![para("quoted"), quote(vec![para("quoted twice")])]),
            ]),
        ),
        (
            "09-code-blocks",
            with_description(vec![
                code(&format!("let long = \"{}\";", "x".repeat(300))),
                code(&many_lines),
                code("tabs\tand   spaces\n    indented"),
            ]),
        ),
        ("10-checklist-page-break", {
            let mut e = with_description(vec![para(&"Filler text. ".repeat(300))]);
            e.card.checklist = checklist(14);
            e
        }),
        ("11-many-labels", {
            let mut e = with_description(vec![para("Many labels wrap over rows.")]);
            e.labels = labels(30);
            e
        }),
        (
            "12-inline-images",
            with_pictures(
                vec![
                    h(2, "Inline images"),
                    p(vec![text_node("Text before, "), img("wide"), text_node(" and text after.")]),
                    p(vec![img("tall")]),
                    p(vec![img("small")]),
                    list_node("bullet_list", vec![vec![p(vec![text_node("in a list "), img("wide")])]]),
                    quote(vec![p(vec![img("tall")])]),
                    p(vec![img("wide"), img("small")]),
                    p(vec![text_node("A missing attachment: "), img("gone"), text_node(" stays readable.")]),
                    table_node(&[vec!["Header"], vec!["cell"]]),
                    json!({"type": "table", "content": [{"type": "table_row", "content": [
                        {"type": "table_cell", "attrs": {"align": null}, "content": [p(vec![text_node("in a cell "), img("small")])]}]}]}),
                ],
                &[wide_pic, tall_pic, ("small", 40, 20), ("unreferenced", 120, 80)],
            ),
        ),
        (
            "13-inline-images-page-break",
            with_pictures(
                (0..8).map(|_| p(vec![img("wide")])).chain([para("done")]).collect(),
                &[wide_pic],
            ),
        ),
        (
            "13b-description-of-only-big-images",
            with_pictures(
                vec![p(vec![img("big")]), p(vec![img("big")])],
                &[("big", 480, 320)],
            ),
        ),
        ("14-section-page-breaks", {
            let mut nodes = vec![para(&"Intro text. ".repeat(110))];
            for (lvl, name) in [(1, "Part one"), (2, "Chapter A"), (2, "Chapter B")] {
                nodes.push(h(lvl, name));
                nodes.extend((0..9).map(|i| para(&format!("{name}, paragraph {i}: {}", "words ".repeat(14)))));
            }
            nodes.push(h(1, "A part longer than a page"));
            nodes.extend((0..40).map(|i| para(&format!("Long part, paragraph {i}: {}", "words ".repeat(30)))));
            nodes.push(h(2, "Its subsection"));
            nodes.extend((0..8).map(|i| para(&format!("Subsection paragraph {i}: {}", "words ".repeat(14)))));
            with_description(nodes)
        }),
        ("15-orphans-and-widows", {
            let mut rows = vec![vec!["Name".to_string(), "Value".to_string()]];
            rows.extend((0..60).map(|i| vec![format!("row {i}"), (i * 3).to_string()]));
            let table_rows: Vec<Vec<&str>> = rows.iter().map(|r| r.iter().map(String::as_str).collect()).collect();
            with_description(vec![
            para(&"Filler paragraph. ".repeat(40)),
            para(&"A long paragraph never leaves a single line alone at a page edge. ".repeat(40)),
            code(&(0..70).map(|i| format!("let line_{i} = {i};")).collect::<Vec<_>>().join("\n")),
            table_node(&table_rows),
        ])}),
        ("16-attachments", {
            let mut e = with_pictures(vec![para("Attachments listed, pictures below.")], &[wide_pic, tall_pic, ("small", 40, 20)]);
            e.attachments.push((attachment("a rather long file name that has to wrap around the page edge.tar.gz", 123_456_789), None));
            e.attachments.push((attachment("report \u{e4}\u{f6}\u{fc}.pdf", 1_500_000), None));
            e
        }),
        ("17-matrix", {
            let mcell = |kind: &str, align: Option<&str>, t: &str| {
                let content = if t.is_empty() { json!([]) } else { json!([para(t)]) };
                json!({"type": kind, "attrs": {"align": align}, "content": content})
            };
            let mut nodes = vec![
                para("A matrix leaves the top-left corner open, centres both header row and header column, and aligns body cells individually."),
                json!({
                    "type": "table",
                    "attrs": {"matrix": true},
                    "content": [
                        {"type": "table_row", "content": [
                            mcell("table_cell", None, ""),
                            mcell("table_header", None, "North"),
                            mcell("table_header", None, "South"),
                            mcell("table_header", None, "East"),
                        ]},
                        {"type": "table_row", "content": [
                            mcell("table_header", None, "Q1"),
                            mcell("table_cell", Some("left"), "10"),
                            mcell("table_cell", Some("center"), "20"),
                            mcell("table_cell", Some("right"), "30"),
                        ]},
                        {"type": "table_row", "content": [
                            mcell("table_header", None, "Q2 (summary)"),
                            mcell("table_cell", Some("right"), "400"),
                            mcell("table_cell", Some("left"), "500"),
                            mcell("table_cell", Some("center"), "600"),
                        ]},
                    ]
                }),
            ];
            let mut long_matrix = vec![json!({
                "type": "table_row",
                "content": [
                    mcell("table_cell", None, ""),
                    mcell("table_header", None, "Alpha"),
                    mcell("table_header", None, "Beta"),
                ]
            })];
            for i in 0..60 {
                long_matrix.push(json!({
                    "type": "table_row",
                    "content": [
                        mcell("table_header", None, &format!("Item {i}")),
                        mcell("table_cell", Some("right"), &format!("{}", i * 3)),
                        mcell("table_cell", Some("center"), if i % 2 == 0 { "yes" } else { "no" }),
                    ]
                }));
            }
            nodes.push(para("A long matrix repeats its top header across page breaks:"));
            nodes.push(json!({"type": "table", "attrs": {"matrix": true}, "content": long_matrix}));
            with_description(nodes)
        }),
        ("18-lua-blocks", {
            let calc = "local seats = 8\nlocal months = 3\nlocal total = seats * 19 * months\nprint(string.format(\"Q3: $%d\", total))\nreturn total";
            let calc_hash = fnv1a_32_hex(calc);
            let stale_code = "return 42";
            let err_code = "error(\"missing rate\")";
            let err_hash = fnv1a_32_hex(err_code);
            with_description(vec![
                para("Evaluated Lua calculation:"),
                json!({
                    "type": "lua_block",
                    "attrs": { "output": "Q3: $456\n=> 456", "error": null, "ran_hash": calc_hash },
                    "content": [text_node(calc)]
                }),
                para("Edited after last run (marked outdated):"),
                json!({
                    "type": "lua_block",
                    "attrs": { "output": "=> 10", "error": null, "ran_hash": "00000000" },
                    "content": [text_node(stale_code)]
                }),
                para("Block with saved runtime error:"),
                json!({
                    "type": "lua_block",
                    "attrs": { "output": null, "error": "=[lua_block]:1: missing rate", "ran_hash": err_hash },
                    "content": [text_node(err_code)]
                }),
            ])
        }),
        ("19-footnotes", {
            let fn_ref = |id: &str| json!({"type": "footnote_ref", "attrs": {"id": id}});
            let fn_def = |id: &str, text: &str| {
                json!({
                    "type": "footnote_def",
                    "attrs": {"id": id},
                    "content": [{"type": "footnote_paragraph", "content": [text_node(text)]}]
                })
            };
            let mut nodes = vec![
                h(1, "Storage & Sync"),
                p(vec![
                    text_node("Cards are stored as atomic JSON files"),
                    fn_ref("fn-a"),
                    text_node(" and attachments live as sidecars"),
                    fn_ref("fn-b"),
                    text_node(" alongside the card directory."),
                ]),
            ];
            for i in 1..=26 {
                nodes.push(para(&format!(
                    "Filler paragraph {i} pushing the next section onto page two so per-page footnote numbering restarts."
                )));
            }
            nodes.push(h(2, "Second Page"));
            nodes.push(p(vec![
                text_node("On page two, a new note"),
                fn_ref("fn-c"),
                text_node(" restarts at [1], and referencing the first note again"),
                fn_ref("fn-a"),
                text_node(" prints it on this page too as [2]."),
            ]));
            nodes.push(json!({
                "type": "footnote_list",
                "content": [
                    fn_def("fn-a", "Writes go to a temporary file and atomically rename over the target."),
                    fn_def("fn-b", "Stored under attachments/{card-id}/{att-id} with a companion JSON metadata sidecar."),
                    fn_def("fn-c", "Numbering restarts at [1] on every page of the exported PDF."),
                    fn_def("fn-orphan", "Unreferenced orphaned definitions are omitted from the PDF."),
                ]
            }));
            with_description(nodes)
        }),
        ("20-highlights-and-alerts", {
            let hl = |color: &str, text: &str| {
                json!({
                    "type": "text",
                    "marks": [{ "type": "highlight", "attrs": { "color": color } }],
                    "text": text
                })
            };
            let ic = |text: &str| {
                json!({
                    "type": "text",
                    "marks": [{ "type": "code" }],
                    "text": text
                })
            };
            let alert = |kind: &str, content: Vec<Value>| {
                json!({
                    "type": "alert",
                    "attrs": { "kind": kind },
                    "content": content
                })
            };
            with_description(vec![
                h(1, "Highlights"),
                p(vec![
                    text_node("Palette: "),
                    hl("yellow", "yellow"),
                    text_node(" "),
                    hl("orange", "orange"),
                    text_node(" "),
                    hl("red", "red"),
                    text_node(" "),
                    hl("pink", "pink"),
                    text_node(" "),
                    hl("purple", "purple"),
                    text_node(" "),
                    hl("blue", "blue"),
                    text_node(" "),
                    hl("green", "green"),
                    text_node(" "),
                    hl("gray", "gray"),
                    text_node("."),
                ]),
                p(vec![
                    text_node("Combined with formatting: "),
                    json!({
                        "type": "text",
                        "marks": [
                            { "type": "highlight", "attrs": { "color": "yellow" } },
                            { "type": "strong" }
                        ],
                        "text": "bold yellow phrase"
                    }),
                    text_node(" and "),
                    json!({
                        "type": "text",
                        "marks": [
                            { "type": "highlight", "attrs": { "color": "blue" } },
                            { "type": "link", "attrs": { "href": "https://example.com" } }
                        ],
                        "text": "highlighted link"
                    }),
                    text_node("."),
                ]),
                h(1, "Alerts"),
                alert("note", vec![p(vec![
                    text_node("Highlights store semantic names ("),
                    ic("yellow"),
                    text_node(", "),
                    ic("blue"),
                    text_node(") so Light, Dark, and PDF exports all stay legible."),
                ])]),
                alert("tip", vec![p(vec![
                    text_node("Press "),
                    ic("Accel+K"),
                    text_node(" then "),
                    ic("A"),
                    text_node(" to insert or change an alert without leaving the keyboard."),
                ])]),
                alert("important", vec![p(vec![
                    text_node("Keep "),
                    ic("schema.json"),
                    text_node(" and "),
                    ic("backend/src/schema.rs"),
                    text_node(" in sync."),
                ])]),
                alert("warning", vec![p(vec![
                    text_node("Alerts support "),
                    hl("purple", "highlighted text"),
                    text_node(" and nested blocks, but cannot go inside table cells."),
                ])]),
                alert("caution", vec![p(vec![
                    text_node("Deleting an archived board removes all cards and attachments permanently."),
                ])]),
            ])
        }),
    ];
    // Unless a case sets its own title, the file name is the title.
    cases
        .into_iter()
        .map(|(name, mut e)| {
            if e.card.title.starts_with("Ship **PDF**") {
                let t = name[3..].replace('-', " ");
                e.card.title = t[..1].to_uppercase() + &t[1..];
            }
            (name, e)
        })
        .collect()
}

fn showcase() -> CardExport {
    let mut e = with_pictures(
        vec![
            h(1, "Release 2.0"),
            p(vec![
                text_node("Everything for the next release in one place, with a "),
                json!({"type": "text", "marks": [{"type": "strong"}], "text": "bold"}),
                text_node(", an "),
                json!({"type": "text", "marks": [{"type": "em"}], "text": "italic"}),
                text_node(" and a "),
                json!({"type": "text", "marks": [{"type": "link", "attrs": {"href": "https://example.com"}}], "text": "link"}),
                text_node("."),
            ]),
            p(vec![img("wide")]),
            h(2, "Plan"),
            list_node(
                "ordered_list",
                vec![
                    vec![para("Freeze the branch")],
                    vec![
                        para("Test"),
                        list_node(
                            "bullet_list",
                            vec![vec![para("backend")], vec![para("frontend")]],
                        ),
                    ],
                    vec![para("Ship it")],
                ],
            ),
            quote(vec![para("Done is better than perfect.")]),
            table_node(&[
                vec!["Area", "Owner", "State"],
                vec!["Backend", "Ann", "done"],
                vec!["Frontend", "Bob", "open"],
            ]),
            code("cargo build --release\n./build.sh"),
            p(vec![text_node("Screenshot: "), img("small")]),
        ],
        &[("wide", 900, 300), ("small", 160, 100)],
    );
    e.card.title = "Ship **Release 2.0** *this week*".into();
    e.card.checklist = vec![
        ChecklistItem {
            id: "1".into(),
            text: "write the changelog".into(),
            done: true,
        },
        ChecklistItem {
            id: "2".into(),
            text: "tag and publish".into(),
            done: false,
        },
    ];
    e.labels = labels(3);
    e
}

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docs/export-examples")
}

#[test]
fn corner_cases_render_as_valid_pdf_a_inside_the_page() {
    for (name, e) in corner_cases() {
        let (l, pdf) = build(&e);
        assert_pdfa(&pdf);
        assert_in_bounds(&l, true);
        // No page is left (nearly) empty: each has more than the footer.
        for (i, page) in l.pages.iter().enumerate() {
            assert!(!page.is_empty(), "{name}: page {i} has no content");
        }
        assert_eq!(page_count(&pdf), l.pages.len(), "{name}");
    }
}

#[test]
fn rendering_is_deterministic() {
    for (name, e) in corner_cases() {
        assert_eq!(render(&e), render(&e), "{name} differs between renders");
    }
}

#[test]
fn inline_images_never_exceed_line_width_or_half_a_page_in_any_case() {
    for (name, e) in corner_cases() {
        let l = layout_card(&e).unwrap();
        for op in l.pages.iter().flatten() {
            if let Op::Image { w, h, .. } = op {
                // Attachment-section pictures are capped at 230; inline ones at the line.
                assert!(
                    *w <= CONTENT_W + 0.01 && *h <= CONTENT_W + 0.01,
                    "{name}: {w}x{h}"
                );
            }
        }
    }
}

#[test]
fn image_cases_have_the_expected_page_counts() {
    let cases = corner_cases();
    let pages = |n: &str| {
        let (_, e) = cases.iter().find(|(name, _)| *name == n).unwrap();
        layout_card(e).unwrap().pages.len()
    };
    assert!(pages("13-inline-images-page-break") >= 2);
    assert!(pages("06-long-table-repeats-header") >= 3);
    assert_eq!(pages("01-empty-card"), 1);
}

#[test]
fn inline_images_example_keeps_only_unreferenced_attachments() {
    let (_, e) = corner_cases()
        .into_iter()
        .find(|(name, _)| *name == "12-inline-images")
        .unwrap();
    let text = pdf_text(&render(&e));
    assert!(text.contains("Attachments (1)"), "got:\n{text}");
    assert!(text.contains("unreferenced.png"), "got:\n{text}");
    assert!(!text.contains("wide.png"), "got:\n{text}");
    assert!(!text.contains("tall.png"), "got:\n{text}");
}

#[test]
fn example_pdfs_are_up_to_date() {
    let update = std::env::var_os("UPDATE_EXAMPLES").is_some();
    let dir = dir();
    std::fs::create_dir_all(&dir).unwrap();
    let mut stale = Vec::new();
    for (name, e) in corner_cases() {
        let path = dir.join(format!("{name}.pdf"));
        let pdf = render(&e);
        if update {
            std::fs::write(&path, &pdf).unwrap();
        } else if std::fs::read(&path).ok().as_deref() != Some(&pdf[..]) {
            stale.push(name);
        }
    }
    assert!(
        stale.is_empty(),
        "stale example PDFs (run `UPDATE_EXAMPLES=1 cargo test --lib examples`): {stale:?}"
    );
}
