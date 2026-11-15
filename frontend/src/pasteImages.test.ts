// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { pastedImageFiles } from "./pasteImages";

const data = (files: File[], text = ""): DataTransfer =>
  ({ files, getData: (t: string) => (t === "text/plain" ? text : "") }) as unknown as DataTransfer;
const png = () => new File(["x"], "image.png", { type: "image/png" });

describe("pastedImageFiles", () => {
  it("renames clipboard images uniquely and keeps their type", () => {
    const out = pastedImageFiles(data([png(), new File(["y"], "image.png", { type: "image/jpeg" })]), 42);
    expect(out.map((f) => [f.name, f.type])).toEqual([
      ["pasted-42-1.png", "image/png"],
      ["pasted-42-2.jpeg", "image/jpeg"],
    ]);
  });

  it("strips mime suffixes from the extension", () => {
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    expect(pastedImageFiles(data([svg]), 1)[0].name).toBe("pasted-1-1.svg");
  });

  it("ignores non-image files", () => {
    expect(pastedImageFiles(data([new File(["x"], "a.pdf", { type: "application/pdf" })]))).toEqual([]);
  });

  it("leaves pastes that carry text to the normal text paste", () => {
    expect(pastedImageFiles(data([png()], "some text"))).toEqual([]);
  });

  it("handles a missing clipboard", () => {
    expect(pastedImageFiles(null)).toEqual([]);
  });
});
