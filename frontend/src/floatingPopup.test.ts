// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openFloatingPopup, positionFloating } from "./floatingPopup";
import { registerOverlay } from "./overlayLayers";

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
}

describe("positionFloating", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  it("places below the anchor when it fits", () => {
    const el = document.createElement("div");
    mockRect(el, { width: 180, height: 200 });
    positionFloating(el, () => ({ left: 100, top: 80, bottom: 110 }));
    expect(el.style.left).toBe("100px");
    expect(el.style.top).toBe("116px");
    expect(el.style.maxHeight).toBe("");
  });

  it("flips above the anchor when taller than the space below", () => {
    const el = document.createElement("div");
    mockRect(el, { width: 180, height: 200 });
    positionFloating(el, () => ({ left: 100, top: 450, bottom: 480 }));
    expect(el.style.top).toBe("244px");
    expect(el.style.maxHeight).toBe("");
  });

  it("picks the roomier side and sets maxHeight when taller than both sides", () => {
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });
    const el = document.createElement("div");
    mockRect(el, { width: 180, height: 400 });
    positionFloating(el, () => ({ left: 100, top: 90, bottom: 120 }));
    // Below: 300 - 8 - 126 = 166; Above: 90 - 6 - 8 = 76 → stays below with maxHeight
    expect(el.style.top).toBe("126px");
    expect(el.style.maxHeight).toBe("166px");
  });

  it("clamps horizontally within viewport margins", () => {
    const el = document.createElement("div");
    mockRect(el, { width: 200, height: 100 });
    positionFloating(el, () => ({ left: 750, top: 50, bottom: 80 }));
    expect(el.style.left).toBe("592px"); // 800 - 200 - 8
  });
});

describe("openFloatingPopup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts inside its owning container with popover=manual", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const el = document.createElement("div");

    const h = openFloatingPopup({
      el,
      container,
      anchor: () => ({ left: 10, top: 10, bottom: 30 }),
    });

    expect(el.parentElement).toBe(container);
    expect(el.getAttribute("popover")).toBe("manual");
    h.dispose();
    expect(el.isConnected).toBe(false);
  });

  it("closes a previously open exclusive popup when a new one opens", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onClose1 = vi.fn();
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");

    openFloatingPopup({
      el: el1,
      container,
      anchor: () => ({ left: 10, top: 10, bottom: 30 }),
      onClose: onClose1,
    });
    const h2 = openFloatingPopup({
      el: el2,
      container,
      anchor: () => ({ left: 20, top: 10, bottom: 30 }),
    });

    expect(onClose1).toHaveBeenCalledTimes(1);
    expect(el1.isConnected).toBe(false);
    expect(el2.isConnected).toBe(true);
    h2.dispose();
  });

  it("dismisses when a higher overlay registers in overlayLayers", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onClose = vi.fn();
    const el = document.createElement("div");

    openFloatingPopup({
      el,
      container,
      anchor: () => ({ left: 10, top: 10, bottom: 30 }),
      onClose,
    });

    const modal = document.createElement("dialog");
    const unregister = registerOverlay(modal);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(el.isConnected).toBe(false);
    unregister();
  });

  it("dismisses on outside pointerdown unless ignored", () => {
    const container = document.createElement("div");
    const trigger = document.createElement("button");
    const outside = document.createElement("div");
    container.append(trigger, outside);
    document.body.appendChild(container);

    const onClose = vi.fn();
    const el = document.createElement("div");

    const h = openFloatingPopup({
      el,
      container,
      anchor: trigger,
      ignoreOutside: (t) => !!t && trigger.contains(t),
      onClose,
    });

    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    h.dispose();
  });
});
