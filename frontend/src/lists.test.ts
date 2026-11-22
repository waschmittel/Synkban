// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { schema } from "./schema";
import {
  convertList,
  convertListLabel,
  enclosingList,
  setListType,
  toggleListType,
} from "./lists";

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const li = (...blocks: PmNode[]) => schema.node("list_item", null, blocks);
const ul = (...items: PmNode[]) => schema.node("bullet_list", null, items);
const ol = (items: PmNode[], order = 1) => schema.node("ordered_list", { order }, items);
const doc = (...blocks: PmNode[]) => schema.node("doc", null, blocks);

/// Finds the document position of the start of `needle` in `d`.
function posOf(d: PmNode, needle: string): number {
  let found = -1;
  d.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text?.includes(needle)) {
      found = pos + node.text.indexOf(needle);
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`Text not found: ${needle}`);
  return found;
}

function stateAt(d: PmNode, fromText: string, toText?: string): EditorState {
  const from = posOf(d, fromText);
  const to = toText ? posOf(d, toText) + toText.length : from;
  return EditorState.create({
    doc: d,
    selection: TextSelection.create(d, from, to),
  });
}

function run(state: EditorState, cmd: (s: EditorState, d?: (tr: any) => void) => boolean): EditorState | null {
  let next: EditorState | null = null;
  const ok = cmd(state, (tr) => {
    next = state.apply(tr);
  });
  return ok ? next : null;
}

describe("enclosingList", () => {
  it("returns null outside a list", () => {
    const s = stateAt(doc(p("hello")), "hello");
    expect(enclosingList(s)).toBeNull();
  });

  it("finds the innermost enclosing list for nested lists", () => {
    const d = doc(
      ol([
        li(p("outer"), ul(li(p("inner")))),
        li(p("second")),
      ]),
    );
    expect(enclosingList(stateAt(d, "inner"))?.node.type).toBe(schema.nodes.bullet_list);
    expect(enclosingList(stateAt(d, "outer"))?.node.type).toBe(schema.nodes.ordered_list);
    // Selection spanning from outer item into nested sublist resolves to outer list.
    expect(enclosingList(stateAt(d, "outer", "inner"))?.node.type).toBe(schema.nodes.ordered_list);
  });

  it("returns null when selection spans outside a list or across two sibling lists", () => {
    const d1 = doc(ul(li(p("one"))), p("outside"));
    expect(enclosingList(stateAt(d1, "one", "outside"))).toBeNull();

    const d2 = doc(ul(li(p("one"))), ol([li(p("two"))]));
    expect(enclosingList(stateAt(d2, "one", "two"))).toBeNull();
  });
});

describe("convertList & toggleListType", () => {
  it("converts a whole bullet list to an ordered list and back", () => {
    const d = doc(ul(li(p("first")), li(p("second")), li(p("third"))));
    const s1 = stateAt(d, "second");
    expect(convertListLabel(s1)).toBe("Convert to ordered list");

    const s2 = run(s1, toggleListType)!;
    expect(s2).not.toBeNull();
    expect(s2.doc.firstChild!.type).toBe(schema.nodes.ordered_list);
    expect(s2.doc.firstChild!.attrs.order).toBe(1);
    expect(s2.doc.firstChild!.childCount).toBe(3);
    expect(s2.selection.$from.parent.textContent).toBe("second");
    expect(convertListLabel(s2)).toBe("Convert to bullet list");

    const s3 = run(s2, toggleListType)!;
    expect(s3.doc.firstChild!.type).toBe(schema.nodes.bullet_list);
    expect(s3.doc.firstChild!.childCount).toBe(3);
  });

  it("converts only the innermost list when nested, leaving outer/inner lists untouched", () => {
    const d = doc(
      ol([
        li(p("outer"), ul(li(p("inner1")), li(p("inner2")))),
        li(p("outer2")),
      ]),
    );

    // Converting inside inner bullet list changes only the inner list.
    const innerChanged = run(stateAt(d, "inner1"), toggleListType)!;
    expect(innerChanged.doc.firstChild!.type).toBe(schema.nodes.ordered_list);
    const firstItem = innerChanged.doc.firstChild!.firstChild!;
    expect(firstItem.child(1).type).toBe(schema.nodes.ordered_list);

    // Converting inside outer ordered list changes only the outer list; inner stays bullet_list.
    const outerChanged = run(stateAt(d, "outer2"), toggleListType)!;
    expect(outerChanged.doc.firstChild!.type).toBe(schema.nodes.bullet_list);
    expect(outerChanged.doc.firstChild!.firstChild!.child(1).type).toBe(schema.nodes.bullet_list);
  });

  it("converts the whole enclosing list even on a partial multi-item selection", () => {
    const d = doc(ul(li(p("a")), li(p("b")), li(p("c")), li(p("d"))));
    const next = run(stateAt(d, "b", "c"), toggleListType)!;
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild!.type).toBe(schema.nodes.ordered_list);
    expect(next.doc.firstChild!.childCount).toBe(4);
  });

  it("keeps adjacent lists separate when converted to the same type", () => {
    const d = doc(ul(li(p("one"))), ol([li(p("two"))], 3));
    const next = run(stateAt(d, "two"), convertList(schema.nodes.bullet_list))!;
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).type).toBe(schema.nodes.bullet_list);
    expect(next.doc.child(1).type).toBe(schema.nodes.bullet_list);
  });

  it("returns false outside a list", () => {
    const s = stateAt(doc(p("plain")), "plain");
    expect(toggleListType(s)).toBe(false);
    expect(convertList(schema.nodes.ordered_list)(s)).toBe(false);
  });
});

describe("setListType", () => {
  it("wraps a paragraph when outside a list", () => {
    const s = stateAt(doc(p("hello")), "hello");
    const bullet = run(s, setListType(schema.nodes.bullet_list))!;
    expect(bullet.doc.firstChild!.type).toBe(schema.nodes.bullet_list);

    const ordered = run(s, setListType(schema.nodes.ordered_list))!;
    expect(ordered.doc.firstChild!.type).toBe(schema.nodes.ordered_list);
  });

  it("converts when inside the other list type instead of nesting", () => {
    const d = doc(ul(li(p("one")), li(p("two"))));
    const next = run(stateAt(d, "one"), setListType(schema.nodes.ordered_list))!;
    expect(next.doc.firstChild!.type).toBe(schema.nodes.ordered_list);
    expect(next.doc.firstChild!.childCount).toBe(2);
    // No nested list inside the first item.
    expect(next.doc.firstChild!.firstChild!.childCount).toBe(1);
  });

  it("does nothing when already inside the same list type", () => {
    const d = doc(ul(li(p("one")), li(p("two"))));
    const s = stateAt(d, "one");
    expect(setListType(schema.nodes.bullet_list)(s)).toBe(false);
    expect(run(s, setListType(schema.nodes.bullet_list))).toBeNull();

    const d2 = doc(ol([li(p("one")), li(p("two"))]));
    const s2 = stateAt(d2, "one");
    expect(setListType(schema.nodes.ordered_list)(s2)).toBe(false);
    expect(run(s2, setListType(schema.nodes.ordered_list))).toBeNull();
  });
});
