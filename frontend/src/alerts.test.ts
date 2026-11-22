import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { GapCursor } from "prosemirror-gapcursor";
import { schema, validateDescription } from "./schema";
import { ALERT_KINDS, alertAt, canInsertAlert, removeAlert, setAlertKind } from "./alerts";
import { inEscapableBlock, insertParagraphBelow } from "./blockEscape";

function stateWithPara(text: string) {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
  });
}

describe("alerts", () => {
  it("wraps a paragraph in an alert, switches kind, and removes it", () => {
    let state = stateWithPara("Heads up");
    expect(alertAt(state)).toBeNull();
    expect(canInsertAlert(state)).toBe(true);

    // Wrap into a warning alert
    expect(setAlertKind("warning")(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(alertAt(state)?.node.attrs.kind).toBe("warning");
    expect(inEscapableBlock(state)).toBe(true);

    // Switch kind to caution without losing text
    expect(setAlertKind("caution")(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(alertAt(state)?.node.attrs.kind).toBe("caution");
    expect(state.doc.textContent).toBe("Heads up");

    // Validate against shared schema
    expect(() => validateDescription(JSON.stringify(state.doc.toJSON()))).not.toThrow();

    // Insert paragraph below via blockEscape
    expect(insertParagraphBelow(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).type.name).toBe("paragraph");

    // Jump back inside alert and remove it
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(removeAlert(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(alertAt(state)).toBeNull();
    expect(state.doc.child(0).type.name).toBe("paragraph");
    expect(state.doc.child(0).textContent).toBe("Heads up");
  });

  it("supports all 5 alert kinds and gap cursor insertion", () => {
    expect(ALERT_KINDS.map((a) => a.id)).toEqual(["note", "tip", "important", "warning", "caution"]);

    const doc = schema.node("doc", null, [
      schema.node("alert", { kind: "note" }, [schema.node("paragraph", null, [schema.text("first")])]),
    ]);
    let state = EditorState.create({
      doc,
      selection: new GapCursor(doc.resolve(doc.content.size)),
    });
    expect(canInsertAlert(state)).toBe(true);
    expect(setAlertKind("tip")(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).type.name).toBe("alert");
    expect(state.doc.child(1).attrs.kind).toBe("tip");
  });

  it("is disallowed inside table cells", () => {
    const cell = schema.node("table_cell", null, [schema.node("paragraph", null, [schema.text("cell")])]);
    const row = schema.node("table_row", null, [cell]);
    const doc = schema.node("doc", null, [schema.node("table", null, [row])]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 4),
    });
    expect(canInsertAlert(state)).toBe(false);
    expect(setAlertKind("note")(state)).toBe(false);
  });
});
