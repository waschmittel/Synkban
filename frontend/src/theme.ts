// Dark-mode theming. The persisted preference lives server-side in
// synkban.toml (see settings.ts / config.rs) as one of "system" | "light" |
// "dark". "system" follows the OS via `prefers-color-scheme`.
//
// The whole dark palette hangs off a single `html.theme-dark` class so the
// stylesheet stays DRY (one dark block, no duplicated media queries). We
// resolve "system" to a concrete class here in JS and, while in system mode,
// track OS changes live so the app flips without a reload.

import type { Theme } from "./types";

const MEDIA = "(prefers-color-scheme: dark)";

// Live OS listener, attached only while the effective theme follows the OS.
let mql: MediaQueryList | null = null;
let onSystemChange: ((e: MediaQueryListEvent) => void) | null = null;

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA).matches
  );
}

/** Whether the given theme setting resolves to dark right now. */
export function isDark(theme: Theme): boolean {
  return theme === "dark" || (theme !== "light" && prefersDark());
}

/**
 * Apply a theme setting to <html>. "light"/"dark" pin the class and drop the
 * OS listener; "system" reflects the OS and stays subscribed so a device
 * appearance change flips the app immediately.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("theme-dark", isDark(theme));

  // Detach any listener from a previous applyTheme() call.
  if (mql && onSystemChange) {
    mql.removeEventListener("change", onSystemChange);
    mql = null;
    onSystemChange = null;
  }
  if (theme === "system" && typeof window.matchMedia === "function") {
    mql = window.matchMedia(MEDIA);
    onSystemChange = (e) => root.classList.toggle("theme-dark", e.matches);
    mql.addEventListener("change", onSystemChange);
  }
}
