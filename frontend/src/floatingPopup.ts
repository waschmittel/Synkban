import { dialogKeys } from "./dialogKeys";
import { onOverlayOpen } from "./overlayLayers";

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  right?: number;
}

export type AnchorTarget = HTMLElement | (() => AnchorRect);

export interface PositionOptions {
  gap?: number;
  margin?: number;
  minHeight?: number;
}

/// Calls `showPopover()` when supported and not already open (safe in jsdom).
export function showPopoverSafe(el: HTMLElement): void {
  if (typeof el.showPopover !== "function") return;
  try {
    if (!el.matches(":popover-open")) el.showPopover();
  } catch {
    // Already open or disconnected.
  }
}

/// Calls `hidePopover()` when supported and currently open (safe in jsdom).
export function hidePopoverSafe(el: HTMLElement): void {
  if (typeof el.hidePopover !== "function") return;
  try {
    if (el.matches(":popover-open")) el.hidePopover();
  } catch {
    // Already closed or disconnected.
  }
}

/// Positions a `position: fixed` floating element relative to `anchor`,
/// clamped to the viewport: prefers below, flips above when taller than the
/// space below, and scrolls inside `maxHeight` on the roomier side when
/// taller than both.
export function positionFloating(
  el: HTMLElement,
  anchor: AnchorTarget,
  opts: PositionOptions = {},
): void {
  const margin = opts.margin ?? 8;
  const gap = opts.gap ?? 6;
  const minHeight = opts.minHeight ?? 120;

  const rect: AnchorRect =
    typeof anchor === "function" ? anchor() : anchor.getBoundingClientRect();

  el.style.maxHeight = "";
  const r = el.getBoundingClientRect();
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - r.width - margin));
  const below = rect.bottom + gap;
  const spaceBelow = window.innerHeight - margin - below;
  const spaceAbove = rect.top - gap - margin;

  let top: number;
  if (r.height <= spaceBelow) {
    top = below;
  } else if (r.height <= spaceAbove) {
    top = rect.top - r.height - gap;
  } else if (spaceBelow >= spaceAbove) {
    top = below;
    el.style.maxHeight = `${Math.max(minHeight, spaceBelow)}px`;
  } else {
    top = margin;
    el.style.maxHeight = `${Math.max(minHeight, spaceAbove)}px`;
  }

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export interface FloatingPopupOptions extends PositionOptions {
  el: HTMLElement;
  /// Owning DOM container (stays inside any enclosing `<dialog>` so it is never
  /// made `inert` by `showModal()`).
  container: HTMLElement;
  anchor: AnchorTarget;
  /// When true (default), opening this popup closes any previously open
  /// exclusive floating popup.
  exclusive?: boolean;
  /// Return true for pointerdown targets that should NOT dismiss the popup
  /// (e.g. its own toggle button).
  ignoreOutside?: (target: Element | null) => boolean;
  /// Optional keyboard handler wired via `dialogKeys`.
  onKey?: (e: KeyboardEvent) => void;
  /// Called once when the popup is disposed.
  onClose?: () => void;
}

export interface FloatingPopupHandle {
  reposition: () => void;
  dispose: () => void;
}

let activeClose: (() => void) | null = null;

/// Closes whichever exclusive floating popup is currently open, if any.
export function closeActiveFloatingPopup(): void {
  activeClose?.();
}

/// Mounts `el` inside `container` as a top-layer `popover="manual"`, clamps it
/// to the viewport around `anchor`, and wires single-open coordination,
/// `overlayLayers` dismissal, scroll/resize repositioning, outside pointerdown,
/// and optional `dialogKeys`.
export function openFloatingPopup(opts: FloatingPopupOptions): FloatingPopupHandle {
  const exclusive = opts.exclusive !== false;
  if (exclusive && activeClose) activeClose();

  const { el, container } = opts;
  el.setAttribute("popover", "manual");
  if (el.parentElement !== container) container.appendChild(el);
  showPopoverSafe(el);

  let disposed = false;

  const reposition = () => {
    if (disposed || !el.isConnected) return;
    positionFloating(el, opts.anchor, opts);
  };

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (target && (el.contains(target) || opts.ignoreOutside?.(target))) return;
    dispose();
  };

  const releaseKeys = opts.onKey ? dialogKeys(opts.onKey) : null;
  const releaseOverlay = onOverlayOpen((overlayEl) => {
    if (overlayEl !== el) dispose();
  });

  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  function dispose() {
    if (disposed) return;
    disposed = true;
    releaseKeys?.();
    releaseOverlay();
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
    hidePopoverSafe(el);
    el.remove();
    if (activeClose === dispose) activeClose = null;
    opts.onClose?.();
  }

  if (exclusive) activeClose = dispose;
  reposition();

  return { reposition, dispose };
}
