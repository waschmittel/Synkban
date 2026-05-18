// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isInInput } from "./boardInput";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isInInput", () => {
  it("returns false for null", () => {
    expect(isInInput(null)).toBe(false);
  });

  it("returns true for an <input> element", () => {
    const el = document.createElement("input");
    expect(isInInput(el)).toBe(true);
  });

  it("returns true for a <textarea> element", () => {
    const el = document.createElement("textarea");
    expect(isInInput(el)).toBe(true);
  });

  it("returns true for a contenteditable element", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    expect(isInInput(el)).toBe(true);
  });

  it("returns false for a plain <div>", () => {
    const el = document.createElement("div");
    expect(isInInput(el)).toBe(false);
  });

  it("returns true for a descendant inside .modal-overlay", () => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const child = document.createElement("button");
    overlay.appendChild(child);
    document.body.appendChild(overlay);
    expect(isInInput(child)).toBe(true);
  });

  it("returns true for a descendant inside .label-drawer", () => {
    const drawer = document.createElement("div");
    drawer.className = "label-drawer";
    const child = document.createElement("span");
    drawer.appendChild(child);
    document.body.appendChild(drawer);
    expect(isInInput(child)).toBe(true);
  });

  it("returns true for a descendant inside .shortcut-help-overlay", () => {
    const help = document.createElement("div");
    help.className = "shortcut-help-overlay";
    const child = document.createElement("kbd");
    help.appendChild(child);
    document.body.appendChild(help);
    expect(isInInput(child)).toBe(true);
  });

  it("returns true for a descendant inside .archive-overlay", () => {
    const arch = document.createElement("div");
    arch.className = "archive-overlay";
    const child = document.createElement("button");
    arch.appendChild(child);
    document.body.appendChild(arch);
    expect(isInInput(child)).toBe(true);
  });

  it("returns true for a descendant inside .filter-bar", () => {
    const bar = document.createElement("div");
    bar.className = "filter-bar";
    const child = document.createElement("input");
    bar.appendChild(child);
    document.body.appendChild(bar);
    expect(isInInput(child)).toBe(true);
  });

  it("returns false for a button on the page outside any guarded surface", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    expect(isInInput(btn)).toBe(false);
  });
});
