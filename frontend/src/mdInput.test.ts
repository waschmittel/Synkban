// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { wrapMarkdownSelection } from "./mdInput";

function makeInput(value: string, start: number, end: number): HTMLInputElement {
  const input = document.createElement("input");
  input.value = value;
  input.setSelectionRange(start, end);
  return input;
}

describe("wrapMarkdownSelection", () => {
  it("wraps a plain selection in the marker", () => {
    const input = makeInput("hello world", 0, 5);
    wrapMarkdownSelection(input, "**");
    expect(input.value).toBe("**hello** world");
  });

  it("uses single asterisk for italic", () => {
    const input = makeInput("hello world", 6, 11);
    wrapMarkdownSelection(input, "*");
    expect(input.value).toBe("hello *world*");
  });

  it("unwraps an already-wrapped selection", () => {
    const input = makeInput("**hello** world", 0, 9);
    wrapMarkdownSelection(input, "**");
    expect(input.value).toBe("hello world");
  });

  it("unwraps italic when re-applied", () => {
    const input = makeInput("*hi*", 0, 4);
    wrapMarkdownSelection(input, "*");
    expect(input.value).toBe("hi");
  });

  it("does nothing on empty selection", () => {
    const input = makeInput("hello", 2, 2);
    wrapMarkdownSelection(input, "**");
    expect(input.value).toBe("hello");
  });

  it("preserves text outside the selection", () => {
    const input = makeInput("a b c d", 2, 3);
    wrapMarkdownSelection(input, "**");
    expect(input.value).toBe("a **b** c d");
  });

  it("places caret correctly after wrapping", () => {
    const input = makeInput("abc", 0, 3);
    wrapMarkdownSelection(input, "**");
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
  });

  it("places caret correctly after unwrapping", () => {
    const input = makeInput("**abc**", 0, 7);
    wrapMarkdownSelection(input, "**");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);
  });

  it("dispatches an input event so reactive bindings update", () => {
    const input = makeInput("x", 0, 1);
    let fired = false;
    input.addEventListener("input", () => { fired = true; });
    wrapMarkdownSelection(input, "**");
    expect(fired).toBe(true);
  });

  it("treats a too-short selection as a wrap (no unwrap)", () => {
    // "****" has length 4, marker length 2 → 2*mlen = 4 → length > 4 is false →
    // wraps instead of unwrapping → "**" + "****" + "**" = "********"
    const input = makeInput("****", 0, 4);
    wrapMarkdownSelection(input, "**");
    expect(input.value).toBe("********");
  });
});
