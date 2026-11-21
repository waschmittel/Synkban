// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { exampleSetup } from "prosemirror-example-setup";
import { undoItem } from "prosemirror-menu";
import { schema } from "./schema";
import {
  closeSearch,
  compileSearchRegex,
  computeReplacement,
  editorSearchPlugin,
  findMatches,
  getSearchState,
  openSearch,
  replaceActive,
  replaceAllMatches,
  stepSearch,
  updateSearch,
} from "./editorSearch";

function makeView(doc: ReturnType<typeof schema.node>) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const state = EditorState.create({
    doc,
    plugins: [editorSearchPlugin(), ...exampleSetup({ schema, menuBar: false })],
  });
  const view = new EditorView(el, { state });
  return {
    view,
    cleanup: () => {
      view.destroy();
      el.remove();
    },
  };
}

const p = (...children: any[]) => schema.node("paragraph", null, children);
const t = (text: string, marks?: any[]) => schema.text(text, marks);

describe("compileSearchRegex & computeReplacement", () => {
  it("escapes regex metacharacters in literal mode", () => {
    const { re, error } = compileSearchRegex("a+b (1.0)", false, false);
    expect(error).toBeNull();
    expect(re).not.toBeNull();
    expect("A+B (1.0)".match(re!)).toHaveLength(1);
    expect("aaab 100".match(re!)).toBeNull();
  });

  it("reports invalid regex syntax without throwing", () => {
    const { re, error } = compileSearchRegex("[unclosed", false, true);
    expect(re).toBeNull();
    expect(error).toBeTruthy();
  });

  it("preserves literal $ in plain mode and expands capture groups in regex mode", () => {
    expect(computeReplacement("price", "price", "$100 $&", false, false)).toBe("$100 $&");
    expect(computeReplacement("TODO(api)", "TODO\\(([^)]+)\\)", "DONE($1)", false, true)).toBe(
      "DONE(api)",
    );
  });
});

describe("findMatches", () => {
  it("matches across inline marks but never across blocks or inline images", () => {
    const doc = schema.node("doc", null, [
      p(t("foo"), t("bar", [schema.marks.strong.create()]), t(" baz")),
      p(t("foo"), schema.node("image", { att: "img-1", alt: "pic" }), t("bar")),
      p(t("bar")),
    ]);

    const { re } = compileSearchRegex("foobar", false, false);
    const matches = findMatches(doc, re!);
    expect(matches).toHaveLength(1);
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe("foobar");

    // Never spans across paragraph boundary ("baz" + "foo")
    const cross = compileSearchRegex("bazfoo", false, false);
    expect(findMatches(doc, cross.re!)).toHaveLength(0);
  });

  it("guards against zero-length regex matches without looping", () => {
    const doc = schema.node("doc", null, [p(t("abc"))]);
    for (const pattern of ["^", "$", "a*", "(?=b)"]) {
      const { re } = compileSearchRegex(pattern, false, true);
      const matches = findMatches(doc, re!);
      // Only non-empty matches are returned (e.g. "a" for "a*", none for "^"/"$"/"(?=b)")
      expect(matches.every((m) => m.to > m.from)).toBe(true);
    }
  });

  it("searches inside tables and lua_block nodes", () => {
    const cell = (text: string) => schema.node("table_cell", null, [p(t(text))]);
    const doc = schema.node("doc", null, [
      schema.node("table", { matrix: false }, [
        schema.node("table_row", null, [cell("sync cell"), cell("other")]),
      ]),
      schema.node("lua_block", null, [t("local sync = 1")]),
    ]);
    const { re } = compileSearchRegex("sync", false, false);
    const matches = findMatches(doc, re!);
    expect(matches).toHaveLength(2);
  });
});

describe("editorSearchPlugin commands", () => {
  it("respects case sensitivity, steps with wrap-around, and closes cleanly", () => {
    const doc = schema.node("doc", null, [p(t("API and api and API"))]);
    const { view, cleanup } = makeView(doc);
    try {
      openSearch(view);
      updateSearch(view, { query: "API" });
      expect(getSearchState(view.state).matches).toHaveLength(3);
      expect(getSearchState(view.state).activeIndex).toBe(0);

      stepSearch(view, 1);
      expect(getSearchState(view.state).activeIndex).toBe(1);
      stepSearch(view, -1);
      expect(getSearchState(view.state).activeIndex).toBe(0);
      stepSearch(view, -1);
      expect(getSearchState(view.state).activeIndex).toBe(2);

      updateSearch(view, { caseSensitive: true });
      expect(getSearchState(view.state).matches).toHaveLength(2);

      closeSearch(view, false);
      expect(getSearchState(view.state).open).toBe(false);
      expect(getSearchState(view.state).matches).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("pre-fills single-line selection on open and ignores multi-line selection", () => {
    const doc = schema.node("doc", null, [p(t("hello world")), p(t("second line"))]);
    const { view, cleanup } = makeView(doc);
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
      openSearch(view);
      expect(getSearchState(view.state).query).toBe("hello");

      closeSearch(view, false);
      // Select across paragraphs
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 20)));
      openSearch(view);
      // Keeps previous query rather than filling multi-line text
      expect(getSearchState(view.state).query).toBe("hello");
    } finally {
      cleanup();
    }
  });

  it("replaces active match while preserving marks and advancing past self-matching replacements", () => {
    const doc = schema.node("doc", null, [
      p(t("foo", [schema.marks.strong.create()]), t(" and foo")),
    ]);
    const { view, cleanup } = makeView(doc);
    try {
      openSearch(view, { replace: true });
      updateSearch(view, { query: "foo" });
      expect(getSearchState(view.state).matches).toHaveLength(2);

      // Replace "foo" with "foobar" — should not get stuck on the first match!
      expect(replaceActive(view, "foobar")).toBe(true);
      expect(view.state.doc.textContent).toBe("foobar and foo");
      // Active match should now point to the second "foo"
      const s = getSearchState(view.state);
      expect(s.matches).toHaveLength(2);
      expect(s.activeIndex).toBe(1);
      // Bold mark preserved on "foobar"
      const firstChild = view.state.doc.firstChild!.firstChild!;
      expect(firstChild.text).toBe("foobar");
      expect(firstChild.marks.some((m) => m.type === schema.marks.strong)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("replaces all matches in regex mode as a single undoable transaction", () => {
    const doc = schema.node("doc", null, [p(t("TODO(a) and TODO(b)"))]);
    const { view, cleanup } = makeView(doc);
    try {
      openSearch(view, { replace: true });
      updateSearch(view, { query: "TODO\\(([^)]+)\\)", regex: true });
      expect(replaceAllMatches(view, "DONE($1)")).toBe(2);
      expect(view.state.doc.textContent).toBe("DONE(a) and DONE(b)");

      // Single undo restores both replacements at once
      undoItem.spec.run(view.state, view.dispatch, view, new Event("click"));
      expect(view.state.doc.textContent).toBe("TODO(a) and TODO(b)");
    } finally {
      cleanup();
    }
  });
});
