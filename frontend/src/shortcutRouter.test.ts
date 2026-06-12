// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { registerShortcuts } from "./shortcutRouter";

let disposers: Array<() => void> = [];

afterEach(() => {
  disposers.forEach((d) => d());
  disposers = [];
  document.body.innerHTML = "";
});

function dispatch(target: EventTarget, init: KeyboardEventInit) {
  const e = new KeyboardEvent("keydown", { ...init, bubbles: true });
  target.dispatchEvent(e);
  return e;
}

describe("registerShortcuts", () => {
  it("fires the matching binding", () => {
    const handler = vi.fn();
    disposers.push(registerShortcuts([{ key: "a", handler }]));
    dispatch(document.body, { key: "a" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("first match wins (later defs do not fire)", () => {
    const first = vi.fn();
    const second = vi.fn();
    disposers.push(
      registerShortcuts([
        { key: "x", handler: first },
        { key: "x", handler: second },
      ]),
    );
    dispatch(document.body, { key: "x" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("canFire gates a binding", () => {
    const handler = vi.fn();
    let allowed = false;
    disposers.push(
      registerShortcuts([{ key: "g", canFire: () => allowed, handler }]),
    );
    dispatch(document.body, { key: "g" });
    expect(handler).not.toHaveBeenCalled();
    allowed = true;
    dispatch(document.body, { key: "g" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("modifier flags are tri-state: false means must NOT be held", () => {
    const handler = vi.fn();
    disposers.push(
      registerShortcuts([{ key: "n", ctrl: false, handler }]),
    );
    dispatch(document.body, { key: "n", ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
    dispatch(document.body, { key: "n" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("modifier flag undefined matches either state", () => {
    const handler = vi.fn();
    disposers.push(registerShortcuts([{ key: "n", handler }]));
    dispatch(document.body, { key: "n" });
    dispatch(document.body, { key: "n", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("baseCanFire suppresses everything when false", () => {
    const handler = vi.fn();
    disposers.push(
      registerShortcuts(
        [{ key: "a", handler }],
        { baseCanFire: () => false },
      ),
    );
    dispatch(document.body, { key: "a" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("default baseCanFire suppresses shortcuts while inside an input", () => {
    const handler = vi.fn();
    disposers.push(registerShortcuts([{ key: "a", handler }]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatch(input, { key: "a" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispose removes the listener", () => {
    const handler = vi.fn();
    const dispose = registerShortcuts([{ key: "a", handler }]);
    dispose();
    dispatch(document.body, { key: "a" });
    expect(handler).not.toHaveBeenCalled();
  });
});
