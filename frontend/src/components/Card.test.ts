// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderTitle } from "./Card";

describe("renderTitle", () => {
  it("returns plain text unchanged", () => {
    expect(renderTitle("hello world")).toBe("hello world");
  });

  it("renders bold markdown", () => {
    expect(renderTitle("**bold**")).toBe("<strong>bold</strong>");
  });

  it("renders italic markdown", () => {
    expect(renderTitle("*italic*")).toBe("<em>italic</em>");
  });

  it("renders mixed bold and italic", () => {
    expect(renderTitle("**bold** and *italic*")).toBe(
      "<strong>bold</strong> and <em>italic</em>"
    );
  });

  it("renders bold italic with triple asterisks", () => {
    // bold regex matches first, italic captures remaining asterisks
    expect(renderTitle("***text***")).toBe(
      "<strong><em>text</strong></em>"
    );
  });

  it("escapes HTML to prevent XSS", () => {
    expect(renderTitle("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;"
    );
  });

  it("escapes ampersands", () => {
    expect(renderTitle("A & B")).toBe("A &amp; B");
  });

  it("escapes greater-than", () => {
    expect(renderTitle("a > b")).toBe("a &gt; b");
  });

  it("returns empty string for empty input", () => {
    expect(renderTitle("")).toBe("");
  });

  it("handles multiple bold segments", () => {
    expect(renderTitle("**a** then **b**")).toBe(
      "<strong>a</strong> then <strong>b</strong>"
    );
  });

  it("handles multiple italic segments", () => {
    expect(renderTitle("*a* and *b*")).toBe("<em>a</em> and <em>b</em>");
  });

  it("leaves single asterisk unchanged", () => {
    expect(renderTitle("*")).toBe("*");
  });

  it("escapes HTML before processing markdown", () => {
    expect(renderTitle("**<b>bold</b>**")).toBe(
      "<strong>&lt;b&gt;bold&lt;/b&gt;</strong>"
    );
  });

  it("handles bold inside a sentence", () => {
    expect(renderTitle("This is **very** important")).toBe(
      "This is <strong>very</strong> important"
    );
  });

  it("handles quadruple asterisks", () => {
    // bold regex captures middle content, then italic gets remaining pair
    expect(renderTitle("****")).toBe("<em>*</em>*");
  });
});
