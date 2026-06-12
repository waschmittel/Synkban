import { isTypingIn, isInUiOverlay } from "./boardInput";

/// A single keyboard shortcut binding.
///
/// The router matches `key`, optional modifier flags, and an optional
/// `canFire` predicate (use it to gate on page state — e.g. "only when no
/// modal is open"). The first matching binding wins; its handler runs and
/// the event is not passed to later bindings.
///
/// Modifier flags are tri-state: `undefined` means "don't care", `true`
/// means "must be held", `false` means "must NOT be held". This lets you
/// write `{ key: "?", shift: undefined }` to accept `?` from any keyboard
/// layout, or `{ key: "ArrowLeft", shift: true, alt: true }` to require the
/// chord.
export interface ShortcutDef {
  key: string;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  canFire?: (e: KeyboardEvent) => boolean;
  handler: (e: KeyboardEvent) => void;
}

export interface ShortcutOptions {
  /// Predicate run before any binding is considered. Default suppresses
  /// shortcuts while typing or inside a UI overlay. Pass your own to widen
  /// or narrow the scope.
  baseCanFire?: (e: KeyboardEvent) => boolean;
}

/// Defaults: shortcuts don't fire while the user is typing or inside any
/// modal/drawer/help/archive/filter overlay.
const defaultBaseCanFire = (e: KeyboardEvent) =>
  !isTypingIn(e.target) && !isInUiOverlay(e.target);

function modifierMatches(want: boolean | undefined, has: boolean): boolean {
  return want === undefined || want === has;
}

/// Installs a `keydown` listener that routes events to the first matching
/// binding. Returns a disposer that removes the listener. Use in `onMount`
/// and call the disposer in `onCleanup`.
export function registerShortcuts(
  defs: ShortcutDef[],
  options: ShortcutOptions = {},
): () => void {
  const baseCanFire = options.baseCanFire ?? defaultBaseCanFire;
  const listener = (e: KeyboardEvent) => {
    // SolidJS delegates keydown handlers to the document, so a component's
    // stopPropagation() can't prevent this document-level listener from
    // running — but it does set cancelBubble, which we honor here. Without
    // this, e.g. Card's ArrowRight handler focuses an empty list's
    // add-trigger and then navigateArrow fires again and skips past it.
    if (e.cancelBubble) return;
    if (!baseCanFire(e)) return;
    for (const def of defs) {
      if (def.key !== e.key) continue;
      if (!modifierMatches(def.shift, e.shiftKey)) continue;
      if (!modifierMatches(def.alt, e.altKey)) continue;
      if (!modifierMatches(def.ctrl, e.ctrlKey)) continue;
      if (!modifierMatches(def.meta, e.metaKey)) continue;
      if (def.canFire && !def.canFire(e)) continue;
      def.handler(e);
      return;
    }
  };
  document.addEventListener("keydown", listener);
  return () => document.removeEventListener("keydown", listener);
}
