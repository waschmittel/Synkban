/// Link helpers: URL allow-list, locating the whole link around the selection,
/// and the edit dialog (used by the toolbar, Cmd/Ctrl+click, right-click and
/// the Accel+K menu).

import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Mark as PmMark, MarkType } from "prosemirror-model";
import { registerOverlay } from "./overlayLayers";

export function markActive(state: EditorState, type: MarkType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

const ALLOWED_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];

/// Returns a normalized safe href, or null if the URL is relative or uses a
/// disallowed scheme (e.g. javascript:, data:). The URL constructor strips
/// surrounding whitespace and lowercases the protocol, so obfuscated schemes
/// like " JaVaScRiPt:" are caught too.
export function sanitizeLinkHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return ALLOWED_LINK_PROTOCOLS.includes(url.protocol) ? candidate : null;
}

/// Finds the contiguous range of `markType` (a link) surrounding document
/// position `pos`, plus the mark itself, or null if `pos` isn't inside one.
/// Used to turn a click on a link into a full-link selection for editing.
export function linkRangeAt(
  state: EditorState,
  pos: number,
  markType: MarkType,
): { mark: PmMark; from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  let mark =
    markType.isInSet($pos.marks()) ||
    ($pos.nodeBefore && markType.isInSet($pos.nodeBefore.marks)) ||
    ($pos.nodeAfter && markType.isInSet($pos.nodeAfter.marks)) ||
    null;
  if (!mark) return null;

  let startIndex = $pos.index();
  let endIndex = $pos.indexAfter();
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) startIndex--;
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) endIndex++;

  let from = $pos.start();
  let to = from;
  for (let i = 0; i < endIndex; i++) {
    const size = parent.child(i).nodeSize;
    if (i < startIndex) from += size;
    to += size;
  }
  return { mark, from, to };
}

export interface LinkDialogOptions {
  prefillUrl: string;
  /// Apply a (sanitized) href — caller dispatches the mark change.
  apply: (href: string) => void;
  /// When set, the dialog shows a "Remove link" button wired to this.
  remove?: () => void;
}

export function showLinkDialog(view: EditorView, opts: LinkDialogOptions) {
  const overlay = document.createElement("div");
  overlay.className = "link-dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "link-dialog";

  const label = document.createElement("label");
  label.className = "link-dialog-label";
  label.textContent = "URL";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "link-dialog-input";
  input.placeholder = "https://…";
  input.value = opts.prefillUrl;

  const errorMsg = document.createElement("div");
  errorMsg.className = "link-dialog-error";
  errorMsg.style.display = "none";
  errorMsg.textContent = "Only http, https and mailto links are allowed.";

  const actions = document.createElement("div");
  actions.className = "link-dialog-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary btn-sm";
  saveBtn.textContent = "Apply";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-cancel btn-sm";
  cancelBtn.textContent = "Cancel";

  // Remove sits on the left (margin-auto pushes Apply/Cancel right) so the
  // destructive action is visually separated from the confirm pair.
  let removeBtn: HTMLButtonElement | null = null;
  if (opts.remove) {
    removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-cancel btn-sm link-dialog-remove";
    removeBtn.textContent = "Remove link";
    actions.appendChild(removeBtn);
  }
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  dialog.appendChild(label);
  dialog.appendChild(input);
  dialog.appendChild(errorMsg);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const unregister = registerOverlay(overlay);

  requestAnimationFrame(() => {
    input.focus();
    if (opts.prefillUrl) input.select();
  });

  const close = () => { unregister(); overlay.remove(); };

  const submit = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const href = sanitizeLinkHref(raw);
    if (!href) {
      errorMsg.style.display = "";
      return;
    }
    close();
    opts.apply(href);
    view.focus();
  };

  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", () => { close(); view.focus(); });
  removeBtn?.addEventListener("click", () => { close(); opts.remove!(); view.focus(); });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { close(); view.focus(); }
  });
  input.addEventListener("input", () => { errorMsg.style.display = "none"; });
  input.addEventListener("keydown", (e) => {
    // Keys are the dialog's: Escape must not also close the card modal.
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); view.focus(); }
  });
}

export interface LinkTarget {
  from: number;
  to: number;
  /// The existing link, or null when the selection has none yet.
  mark: PmMark | null;
}

/// What a link edit applies to: the whole link when the cursor is inside one
/// or the selection touches one (extended to cover the selection too); a plain
/// non-empty selection (to add a link); otherwise null.
export function linkTarget(state: EditorState, markType: MarkType): LinkTarget | null {
  const { from, to, empty } = state.selection;
  if (empty) return linkRangeAt(state, from, markType);
  let hit = -1;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (hit < 0 && node.isText && markType.isInSet(node.marks)) hit = pos;
    return hit < 0;
  });
  if (hit < 0) return { from, to, mark: null };
  const r = linkRangeAt(state, Math.min(Math.max(hit, from), to), markType);
  if (!r) return { from, to, mark: null };
  return { from: Math.min(from, r.from), to: Math.max(to, r.to), mark: r.mark };
}

export function removeLink(view: EditorView, markType: MarkType): boolean {
  const t = linkTarget(view.state, markType);
  if (!t?.mark) return false;
  view.dispatch(view.state.tr.removeMark(t.from, t.to, markType));
  return true;
}

/// Opens the link dialog for the link at / around the selection (editing it,
/// with "Remove link"), or for adding one to a plain selection.
export function openLinkEditor(view: EditorView, markType: MarkType): boolean {
  const t = linkTarget(view.state, markType);
  if (!t) return false;
  const { from, to, mark } = t;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  const text = view.state.doc.textBetween(from, to, " ").trim();
  const looksLikeUrl = /^https?:\/\//.test(text) || /^www\./.test(text);
  showLinkDialog(view, {
    prefillUrl: mark ? mark.attrs.href : looksLikeUrl ? text : "",
    apply: (href) =>
      view.dispatch(
        view.state.tr.removeMark(from, to, markType).addMark(from, to, markType.create({ href })),
      ),
    remove: mark ? () => view.dispatch(view.state.tr.removeMark(from, to, markType)) : undefined,
  });
  return true;
}
