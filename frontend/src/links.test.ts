// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import { GapCursor } from "prosemirror-gapcursor";
import { schema, TEXT_STYLES } from "./schema";
import { linkTarget } from "./links";

const link = schema.marks.link;
const href = (h: string) => link.create({ href: h });

// "aa " + link("bbbb") + " cc"; text positions: a=1..3, link=4..8, c=9..11
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [
    schema.text("aa "),
    schema.text("bbbb", [href("https://a.example")]),
    schema.text(" cc"),
  ]),
]);

const at = (from: number, to = from) =>
  EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });

describe("linkTarget", () => {
  it("is null for a cursor outside any link", () => {
    expect(linkTarget(at(2), link)).toBeNull();
  });

  it("covers the whole link for a cursor inside it", () => {
    const t = linkTarget(at(6), link)!;
    expect([t.from, t.to, t.mark?.attrs.href]).toEqual([4, 8, "https://a.example"]);
  });

  it("covers the whole link when only part of it is selected", () => {
    const t = linkTarget(at(5, 6), link)!;
    expect([t.from, t.to]).toEqual([4, 8]);
  });

  it("extends to a selection that reaches beyond the link", () => {
    const t = linkTarget(at(2, 7), link)!;
    expect([t.from, t.to, !!t.mark]).toEqual([2, 8, true]);
  });

  it("offers a plain selection for adding a link", () => {
    expect(linkTarget(at(1, 3), link)).toEqual({ from: 1, to: 3, mark: null });
  });
});

describe("TEXT_STYLES", () => {
  it("names headings 'Heading n'", () => {
    expect(TEXT_STYLES.map((t) => t.label)).toEqual([
      "Plain text", "Code block", "Lua block", "Heading 1", "Heading 2", "Heading 3",
    ]);
  });

  it("knows the active style and what is possible", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [schema.node("heading", { level: 2 }, [schema.text("x")])]),
    });
    const active = TEXT_STYLES.filter((t) => t.active(state)).map((t) => t.label);
    expect(active).toEqual(["Heading 2"]);
    expect(TEXT_STYLES.find((t) => t.label === "Plain text")!.command(state)).toBe(true);
    expect(TEXT_STYLES.find((t) => t.label === "Heading 2")!.command(state)).toBe(false);
  });

  it("merges multi-paragraph selections into one lua_block, splits multi-line lua_block, and handles GapCursor", () => {
    const style = (label: string) => TEXT_STYLES.find((t) => t.label === label)!;
    const p1 = schema.node("paragraph", null, [schema.text("local a = 1")]);
    const p2 = schema.node("paragraph", null, [schema.text("return a")]);
    const multiDoc = schema.node("doc", null, [p1, p2]);
    const multiState = EditorState.create({ doc: multiDoc, selection: new AllSelection(multiDoc) });
    expect(style("Plain text").active(multiState)).toBe(true);

    let toLua!: EditorState;
    expect(style("Lua block").command(multiState, (tr) => (toLua = multiState.apply(tr)))).toBe(true);
    expect(toLua.doc.childCount).toBe(1);
    expect(toLua.doc.firstChild!.type.name).toBe("lua_block");
    expect(toLua.doc.firstChild!.textContent).toBe("local a = 1\nreturn a");
    expect(style("Lua block").active(toLua)).toBe(true);

    let toPlain!: EditorState;
    expect(style("Plain text").command(toLua, (tr) => (toPlain = toLua.apply(tr)))).toBe(true);
    expect(toPlain.doc.childCount).toBe(2);
    expect(toPlain.doc.child(0).textContent).toBe("local a = 1");
    expect(toPlain.doc.child(1).textContent).toBe("return a");

    const gapDoc = schema.node("doc", null, [schema.node("lua_block", null, [schema.text("1")])]);
    const gapState = EditorState.create({ doc: gapDoc, selection: new GapCursor(gapDoc.resolve(gapDoc.content.size)) });
    expect(TEXT_STYLES.some((t) => t.active(gapState))).toBe(false);
    let fromGap!: EditorState;
    expect(style("Plain text").command(gapState, (tr) => (fromGap = gapState.apply(tr)))).toBe(true);
    expect(fromGap.doc.childCount).toBe(2);
    expect(fromGap.doc.child(1).type.name).toBe("paragraph");
  });
});
