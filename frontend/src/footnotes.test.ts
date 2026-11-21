import { describe, expect, it } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { schema, validateDescription } from "./schema";
import {
  canInsertFootnote,
  computeFootnotes,
  footnoteDefAt,
  footnotePlugins,
  insertFootnote,
  jumpFootnote,
} from "./footnotes";

function makeState(doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Hello world")])])) {
  return EditorState.create({ doc, plugins: footnotePlugins() });
}

function applyCmd(state: EditorState, cmd: typeof insertFootnote): EditorState {
  let next = state;
  cmd(state, (tr) => {
    next = next.apply(tr);
  });
  return next;
}

describe("footnotes", () => {
  it("inserts a footnote at the bottom and jumps caret into its definition", () => {
    let s = makeState();
    // Put caret after "Hello" (pos 6)
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 6)));
    expect(canInsertFootnote(s)).toBe(true);

    s = applyCmd(s, insertFootnote);
    expect(s.doc.lastChild?.type.name).toBe("footnote_list");
    expect(s.doc.lastChild?.childCount).toBe(1);
    const def = footnoteDefAt(s);
    expect(def).not.toBeNull();
    expect(canInsertFootnote(s)).toBe(false);

    const info = computeFootnotes(s.doc);
    expect(info.numbers.get(def!.id)).toBe(1);
  });

  it("preserves highlighted text and inserts the reference behind it", () => {
    let s = makeState();
    // Select "Hello" (1..6)
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 6)));
    s = applyCmd(s, insertFootnote);
    expect(s.doc.firstChild?.textContent).toBe("Hello world");
    expect(s.doc.firstChild?.child(1).type.name).toBe("footnote_ref");
  });

  it("orders numbering and footnote_list by order of first reference", () => {
    let s = makeState();
    // Insert footnote B after "world" (pos 12)
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 12)));
    s = applyCmd(s, insertFootnote);
    const idB = footnoteDefAt(s)!.id;
    s = s.apply(s.tr.insertText("Second note"));

    // Jump back, then insert footnote A after "Hello" (pos 6)
    s = applyCmd(s, jumpFootnote);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 6)));
    s = applyCmd(s, insertFootnote);
    const idA = footnoteDefAt(s)!.id;
    s = s.apply(s.tr.insertText("First note"));

    const info = computeFootnotes(s.doc);
    expect(info.numbers.get(idA)).toBe(1);
    expect(info.numbers.get(idB)).toBe(2);
    // footnote_list itself is reordered so [1] comes before [2]
    const list = s.doc.lastChild!;
    expect(list.child(0).attrs.id).toBe(idA);
    expect(list.child(1).attrs.id).toBe(idB);
  });

  it("jumps from reference to definition and returns to the exact reference jumped from", () => {
    // Build a doc where the same footnote is referenced twice
    const p1 = schema.node("paragraph", null, [
      schema.text("Alpha"),
      schema.nodes.footnote_ref.create({ id: "fn-1" }),
      schema.text(" and Beta"),
      schema.nodes.footnote_ref.create({ id: "fn-1" }),
    ]);
    const list = schema.node("footnote_list", null, [
      schema.node("footnote_def", { id: "fn-1" }, [
        schema.node("footnote_paragraph", null, [schema.text("Shared note")]),
      ]),
    ]);
    let s = makeState(schema.node("doc", null, [p1, list]));
    const refs = computeFootnotes(s.doc).refs.get("fn-1")!;
    expect(refs).toHaveLength(2);

    // Select the SECOND reference and jump
    s = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, refs[1])));
    s = applyCmd(s, jumpFootnote);
    expect(footnoteDefAt(s)?.id).toBe("fn-1");

    // Jump back -> lands right after the SECOND reference (not the first!)
    s = applyCmd(s, jumpFootnote);
    expect(footnoteDefAt(s)).toBeNull();
    expect(s.selection.from).toBe(refs[1] + 1);
  });

  it("keeps non-empty orphaned definitions and auto-deletes empty ones", () => {
    const p1 = schema.node("paragraph", null, [
      schema.text("A"),
      schema.nodes.footnote_ref.create({ id: "fn-keep" }),
      schema.text(" B"),
      schema.nodes.footnote_ref.create({ id: "fn-empty" }),
    ]);
    const list = schema.node("footnote_list", null, [
      schema.node("footnote_def", { id: "fn-keep" }, [
        schema.node("footnote_paragraph", null, [schema.text("Important note")]),
      ]),
      schema.node("footnote_def", { id: "fn-empty" }, [
        schema.node("footnote_paragraph"),
      ]),
    ]);
    let s = makeState(schema.node("doc", null, [p1, list]));

    // Delete ref to fn-empty -> empty def is auto-removed
    const emptyRefPos = computeFootnotes(s.doc).refs.get("fn-empty")![0];
    s = s.apply(s.tr.delete(emptyRefPos, emptyRefPos + 1));
    expect(computeFootnotes(s.doc).defs.has("fn-empty")).toBe(false);
    expect(computeFootnotes(s.doc).defs.has("fn-keep")).toBe(true);

    // Delete ref to fn-keep -> non-empty def stays as orphan (no number)
    const keepRefPos = computeFootnotes(s.doc).refs.get("fn-keep")![0];
    s = s.apply(s.tr.delete(keepRefPos, keepRefPos + 1));
    const info = computeFootnotes(s.doc);
    expect(info.defs.has("fn-keep")).toBe(true);
    expect(info.numbers.has("fn-keep")).toBe(false);
  });

  it("validates footnote structure via shared schema", () => {
    const valid = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi" },
            { type: "footnote_ref", attrs: { id: "f1" } },
          ],
        },
        {
          type: "footnote_list",
          content: [
            {
              type: "footnote_def",
              attrs: { id: "f1" },
              content: [
                { type: "footnote_paragraph", content: [{ type: "text", text: "Note" }] },
              ],
            },
          ],
        },
      ],
    });
    expect(() => validateDescription(valid)).not.toThrow();

    // footnote_list cannot appear before a body paragraph
    const wrongOrder = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "footnote_list",
          content: [
            {
              type: "footnote_def",
              attrs: { id: "f1" },
              content: [{ type: "footnote_paragraph" }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    });
    expect(() => validateDescription(wrongOrder)).toThrow();

    // Nested footnote_ref inside footnote_def is rejected
    const nestedRef = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        {
          type: "footnote_list",
          content: [
            {
              type: "footnote_def",
              attrs: { id: "f1" },
              content: [
                {
                  type: "footnote_paragraph",
                  content: [{ type: "footnote_ref", attrs: { id: "f1" } }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => validateDescription(nestedRef)).toThrow();
  });
});
