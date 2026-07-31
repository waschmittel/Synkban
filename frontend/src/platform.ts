/// Platform accelerator helpers.
///
/// Keyboard chords must bind exactly one "command" modifier: Cmd on macOS,
/// Ctrl everywhere else. Accepting `metaKey || ctrlKey` on all platforms (the
/// old CardDetail behaviour) silently steals macOS's Ctrl-based text bindings
/// inside every input — Ctrl+A/E (line start/end), Ctrl+D (delete forward),
/// Ctrl+K (kill line), Ctrl+O, Ctrl+T (transpose).

const platformString = (): string => {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform || navigator.platform || navigator.userAgent || "";
};

export const isMac = /mac|iphone|ipad/i.test(platformString());

export const accelLabel = isMac ? "⌘" : "Ctrl";

/// True when the platform accelerator — and only it — is held. Shift/Alt
/// variants are excluded so `Cmd+Shift+X` never fires a plain `Cmd+X` binding.
export function hasAccel(e: KeyboardEvent): boolean {
  if (e.shiftKey || e.altKey) return false;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
