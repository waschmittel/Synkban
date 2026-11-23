/// Arrow-key highlight for the popup menus (editor menu, image picker): Up/Down
/// (wrapping) and Home/End move a highlight over the enabled items; `activate`
/// clicks it. Focus stays in the editor, so the highlight is a class.

const ITEM = ".table-menu-item:not(:disabled)";

export function menuNav(menu: HTMLElement, itemSelector = ITEM) {
  let idx = -1;
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>(itemSelector)];
  /// Re-applies the highlight (after the menu was re-rendered).
  const apply = () => {
    const all = items();
    if (idx >= all.length) idx = -1;
    all.forEach((b, i) => b.classList.toggle("table-menu-item--hi", i === idx));
    all[idx]?.scrollIntoView({ block: "nearest" });
  };
  return {
    apply,
    move(delta: 1 | -1) {
      const n = items().length;
      if (!n) return;
      idx = idx < 0 ? (delta > 0 ? 0 : n - 1) : (idx + delta + n) % n;
      apply();
    },
    edge(end: boolean) {
      idx = end ? items().length - 1 : 0;
      apply();
    },
    /// Clicks the highlighted item; false when nothing is highlighted.
    activate(): boolean {
      const b = items()[idx];
      b?.click();
      return !!b;
    },
  };
}

/// Maps a navigation key to a menu move; true when it was one (and handled).
export function navKey(nav: ReturnType<typeof menuNav>, e: KeyboardEvent): boolean {
  if (e.shiftKey) return false;
  switch (e.key) {
    case "ArrowDown": nav.move(1); return true;
    case "ArrowUp": nav.move(-1); return true;
    case "Home": nav.edge(false); return true;
    case "End": nav.edge(true); return true;
    default: return false;
  }
}
