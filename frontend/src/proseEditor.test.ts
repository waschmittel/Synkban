// @vitest-environment jsdom
import { DOMParser } from "prosemirror-model";
import { describe, it, expect } from "vitest";
import { docFromDescription, schema, sanitizeLinkHref } from "./proseEditor";

describe("sanitizeLinkHref", () => {
  it("allows http, https and mailto", () => {
    expect(sanitizeLinkHref("http://example.com")).toBe("http://example.com");
    expect(sanitizeLinkHref("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(sanitizeLinkHref("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("prefixes www. with https://", () => {
    expect(sanitizeLinkHref("www.example.com")).toBe("https://www.example.com");
  });

  it("rejects javascript: and data: URIs", () => {
    expect(sanitizeLinkHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeLinkHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects obfuscated schemes", () => {
    expect(sanitizeLinkHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(sanitizeLinkHref(" javascript:alert(1)")).toBeNull();
    expect(sanitizeLinkHref("\tjavascript:alert(1)")).toBeNull();
  });

  it("rejects relative URLs and other schemes", () => {
    expect(sanitizeLinkHref("/boards/123")).toBeNull();
    expect(sanitizeLinkHref("example.com")).toBeNull();
    expect(sanitizeLinkHref("file:///etc/passwd")).toBeNull();
    expect(sanitizeLinkHref("vbscript:msgbox(1)")).toBeNull();
  });
});

describe("image nodes", () => {
  const json = {
    type: "doc",
    content: [{ type: "paragraph", content: [
      { type: "text", text: "a" },
      { type: "image", attrs: { att: "att-1", alt: "x.png" } },
    ] }],
  };

  it("round-trips through JSON", () => {
    const doc = docFromDescription(JSON.stringify(json));
    expect(doc.toJSON()).toEqual(json);
  });

  it("only parses attachment references from HTML, never foreign images", () => {
    const parse = (html: string) => {
      const el = document.createElement("div");
      el.innerHTML = html;
      return DOMParser.fromSchema(schema).parse(el).textContent + "|" + JSON.stringify(
        DOMParser.fromSchema(schema).parse(el).toJSON()).includes('"image"');
    };
    expect(parse('<p><img src="https://evil/x.png"></p>')).toBe("|false");
    expect(parse('<p><img data-att="a1" alt="n"></p>')).toBe("|true");
  });
});
