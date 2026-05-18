/// Markdown-shortcut helper for plain `<input>` elements. Ctrl/Cmd+B and
/// Ctrl/Cmd+I wrap the current selection in `**...**` / `*...*` (and toggle
/// off when already wrapped). Used in label drawer inputs and the
/// CardDetail title; the ProseMirror editor has its own toggle commands.

export function wrapMarkdownSelection(input: HTMLInputElement, marker: string) {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const val = input.value;
  const sel = val.slice(start, end);
  if (!sel) return;
  const mlen = marker.length;
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length > mlen * 2) {
    const unwrapped = sel.slice(mlen, -mlen);
    input.value = val.slice(0, start) + unwrapped + val.slice(end);
    input.setSelectionRange(start, start + unwrapped.length);
  } else {
    const wrapped = marker + sel + marker;
    input.value = val.slice(0, start) + wrapped + val.slice(end);
    input.setSelectionRange(start + mlen, start + mlen + sel.length);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/// Intercepts Ctrl/Cmd+B and Ctrl/Cmd+I on an `<input>` and applies the
/// markdown wrap. Returns true if it handled the event.
export function handleMarkdownShortcut(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (e.key === "b") {
    e.preventDefault();
    wrapMarkdownSelection(e.currentTarget as HTMLInputElement, "**");
    return true;
  }
  if (e.key === "i") {
    e.preventDefault();
    wrapMarkdownSelection(e.currentTarget as HTMLInputElement, "*");
    return true;
  }
  return false;
}
