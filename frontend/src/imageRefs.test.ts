import { describe, it, expect } from "vitest";
import { imageRefIds, stripImageRefs } from "./imageRefs";

const img = (att: string) => ({ type: "image", attrs: { att, alt: `${att}.png` } });
const doc = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "a" }, img("x")] },
    { type: "bullet_list", content: [{ type: "list_item", content: [{ type: "paragraph", content: [img("y"), img("x")] }] }] },
  ],
});

describe("imageRefs", () => {
  it("lists referenced attachment ids at any depth", () => {
    expect([...imageRefIds(doc)].sort()).toEqual(["x", "y"]);
  });

  it("is empty for empty, plain-text and malformed descriptions", () => {
    expect(imageRefIds("").size).toBe(0);
    expect(imageRefIds("just text").size).toBe(0);
    expect(imageRefIds('{"image": broken').size).toBe(0);
  });

  it("strips every reference to one attachment and keeps the rest", () => {
    const out = stripImageRefs(doc, "x");
    expect([...imageRefIds(out)]).toEqual(["y"]);
    expect(out).toContain('"text":"a"');
  });

  it("leaves descriptions without images untouched", () => {
    expect(stripImageRefs("", "x")).toBe("");
    expect(stripImageRefs("plain", "x")).toBe("plain");
  });
});
