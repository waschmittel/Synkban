import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { schema, validateDescription } from "./schema";
import {
  HIGHLIGHT_COLORS,
  activeHighlight,
  canHighlight,
  clearHighlight,
  getLastHighlightColor,
  hasAnyHighlight,
  setHighlight,
  setLastHighlightColor,
  toggleDefaultHighlight,
} from "./highlights";

function stateWith(text: string, from = 1, to = text.length + 1) {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

describe("highlights", () => {
  it("applies, switches, toggles off, and clears highlight colors", () => {
    let state = stateWith("hello world", 1, 6); // "hello"
    expect(canHighlight(state)).toBe(true);
    expect(activeHighlight(state)).toBeNull();
    expect(hasAnyHighlight(state)).toBe(false);

    // Apply yellow
    setHighlight("yellow")(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBe("yellow");
    expect(hasAnyHighlight(state)).toBe(true);

    // Switch to blue (replaces yellow, does not stack)
    setHighlight("blue")(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBe("blue");
    const marks = state.doc.nodeAt(1)!.marks;
    expect(marks.filter((m) => m.type === schema.marks.highlight)).toHaveLength(1);

    // Clicking the active color again toggles it off
    setHighlight("blue")(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBeNull();
    expect(hasAnyHighlight(state)).toBe(false);

    // Re-apply and clear explicitly
    setHighlight("green")(state, (tr) => (state = state.apply(tr)));
    expect(clearHighlight(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(hasAnyHighlight(state)).toBe(false);
    expect(clearHighlight(state)).toBe(false);
  });

  it("sets and clears stored mark on an empty selection", () => {
    let state = stateWith("abc", 2, 2);
    setHighlight("pink")(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBe("pink");
    clearHighlight(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBeNull();
  });

  it("toggleDefaultHighlight uses last-used color and removes highlight under cursor or selection", () => {
    setLastHighlightColor("yellow");
    let state = stateWith("hello world", 1, 6); // "hello"
    toggleDefaultHighlight(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBe("yellow");

    // Pick green -> updates last used color
    setHighlight("green")(state, (tr) => (state = state.apply(tr)));
    expect(getLastHighlightColor()).toBe("green");
    expect(activeHighlight(state)).toBe("green");

    // Collapse caret inside "hello" (pos 3) -> default toggle removes the entire highlighted run
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(hasAnyHighlight(state)).toBe(true);
    toggleDefaultHighlight(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.rangeHasMark(1, 6, schema.marks.highlight)).toBe(false);

    // Select "world" (7..12) -> default toggle applies last used color ("green")
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7, 12)));
    toggleDefaultHighlight(state, (tr) => (state = state.apply(tr)));
    expect(activeHighlight(state)).toBe("green");
    setLastHighlightColor("yellow");
  });

  it("is disabled inside code blocks and validates all 8 palette colors", () => {
    const codeDoc = schema.node("doc", null, [schema.node("code_block", null, [schema.text("x = 1")])]);
    const codeState = EditorState.create({
      doc: codeDoc,
      selection: TextSelection.create(codeDoc, 1, 4),
    });
    expect(canHighlight(codeState)).toBe(false);
    expect(setHighlight("yellow")(codeState)).toBe(false);

    expect(HIGHLIGHT_COLORS).toHaveLength(8);
    for (const h of HIGHLIGHT_COLORS) {
      let s = stateWith("sample");
      setHighlight(h.id)(s, (tr) => (s = s.apply(tr)));
      expect(() => validateDescription(JSON.stringify(s.doc.toJSON()))).not.toThrow();
    }
  });
});
