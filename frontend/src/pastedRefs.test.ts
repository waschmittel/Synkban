// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Fragment, Slice } from "prosemirror-model";
import { schema } from "./schema";
import { resolvePastedImages } from "./pastedRefs";

const img = (att: string) => schema.nodes.image.create({ att, alt: "p.png" });
const slice = (...atts: string[]) =>
  new Slice(Fragment.from(schema.node("paragraph", null, [schema.text("a"), ...atts.map(img)])), 0, 0);
const atts = (s: Slice) => {
  const out: string[] = [];
  s.content.descendants((n) => void (n.type === schema.nodes.image && out.push(n.attrs.att)));
  return out;
};

describe("resolvePastedImages", () => {
  it("keeps references to this card's attachments", async () => {
    const copy = vi.fn();
    const out = await resolvePastedImages(slice("c1/a", "a"), "c1", new Set(["a"]), copy);
    expect(atts(out)).toEqual(["a", "a"]);
    expect(copy).not.toHaveBeenCalled();
  });

  it("copies attachments of other cards and points the reference at the copy", async () => {
    const copy = vi.fn(async (_from: string, id: string) => `new-${id}`);
    const out = await resolvePastedImages(slice("c2/a"), "c1", new Set(), copy);
    expect(copy).toHaveBeenCalledWith("c2", "a");
    expect(atts(out)).toEqual(["new-a"]);
    expect(out.content.textBetween(0, out.content.size)).toBe("a");
  });

  it("drops references that cannot be made valid", async () => {
    const out = await resolvePastedImages(slice("c2/a", "c1/gone", "unknown"), "c1", new Set(), async () => undefined);
    expect(atts(out)).toEqual([]);
    expect(out.content.textBetween(0, out.content.size)).toBe("a");
  });
});
