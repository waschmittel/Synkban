// @vitest-environment jsdom
import { DOMParser } from "prosemirror-model";
import { describe, it, expect } from "vitest";
import { docFromDescription, schema, sanitizeLinkHref, validateDescription } from "./proseEditor";
import { schemaSpec } from "./schema";

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

describe("lua_block nodes", () => {
  it("round-trips through JSON and <pre data-lua> HTML", () => {
    const json = {
      type: "doc",
      content: [{
        type: "lua_block",
        attrs: { output: "=> 3", error: null, ran_hash: "deadbeef" },
        content: [{ type: "text", text: "return 1 + 2" }],
      }],
    };
    const doc = docFromDescription(JSON.stringify(json));
    expect(doc.toJSON()).toEqual(json);

    const el = document.createElement("div");
    el.innerHTML = '<pre data-lua="" data-output="=> 3" data-ran-hash="deadbeef"><code>return 1 + 2</code></pre>';
    const parsed = DOMParser.fromSchema(schema).parse(el);
    expect(parsed.toJSON()).toEqual(json);
  });
});

describe("shared schema.json parity and validation", () => {
  it("compiled ProseMirror schema matches schema.json 1-to-1", () => {
    expect(schema.topNodeType.name).toBe(schemaSpec.topNode);
    expect(Object.keys(schema.nodes)).toEqual(Object.keys(schemaSpec.nodes));
    expect(Object.keys(schema.marks)).toEqual(Object.keys(schemaSpec.marks));

    for (const [name, expected] of Object.entries(schemaSpec.nodes) as [string, any][]) {
      const nodeType = schema.nodes[name];
      expect(nodeType.spec.content).toBe(expected.content);
      expect(nodeType.spec.group).toBe(expected.group);
      expect(!!nodeType.spec.inline).toBe(!!expected.inline);
      expect(nodeType.spec.marks).toBe(expected.marks);
      expect(!!nodeType.spec.code).toBe(!!expected.code);
      expect(Object.keys((nodeType as any).attrs)).toEqual(Object.keys(expected.attrs ?? {}));
    }

    for (const [name, expected] of Object.entries(schemaSpec.marks) as [string, any][]) {
      const markType = schema.marks[name];
      expect(markType.spec.excludes).toBe(expected.excludes);
      expect(Object.keys((markType as any).attrs)).toEqual(Object.keys(expected.attrs ?? {}));
    }
  });

  it("validates valid documents and rejects schema violations", () => {
    expect(validateDescription("")).toBeNull();
    expect(
      validateDescription(
        JSON.stringify({
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                  text: "ok",
                },
                { type: "image", attrs: { att: "a1", alt: "x.png" } },
              ],
            },
          ],
        }),
      ),
    ).not.toBeNull();

    for (const bad of [
      "plain text",
      "{}",
      JSON.stringify({ type: "paragraph" }),
      JSON.stringify({ type: "doc", content: [] }),
      JSON.stringify({ type: "doc", content: [{ type: "horizontal_rule" }] }),
      JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: { extra: 1 } }] }),
      JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }], text: "x" }],
        }],
      }),
      JSON.stringify({
        type: "doc",
        content: [{ type: "code_block", content: [{ type: "text", marks: [{ type: "strong" }], text: "x" }] }],
      }),
      JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "image", attrs: { att: "" } }] }],
      }),
    ]) {
      expect(() => validateDescription(bad), bad).toThrow();
    }
  });
});
