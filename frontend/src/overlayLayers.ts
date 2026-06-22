/// Shared stack of open overlay layers (modals, dialogs, portaled popups).
///
/// A focus trap must not steal focus from an overlay stacked *above* it — even
/// one rendered outside its DOM subtree (e.g. the link dialog, which portals to
/// document.body). Every focus-trapping root and every portaled overlay
/// registers here in open order; a lower trap yields while a higher layer holds
/// focus. This is the layering invariant that lets focusTrap compose with
/// overlays it doesn't contain.

interface Layer {
  el: HTMLElement;
  /// Called when this layer becomes the topmost again because a layer stacked
  /// above it closed — lets a lower focus trap reclaim focus that orphaned on
  /// <body> when the higher overlay (possibly outside its DOM subtree) was
  /// removed without notifying it.
  onResume?: () => void;
}

const layers: Layer[] = [];

/// Register an overlay element. Returns a dispose fn to pop it off the stack.
/// `onResume` fires when a higher layer closes and this becomes topmost again.
export function registerOverlay(el: HTMLElement, onResume?: () => void): () => void {
  layers.push({ el, onResume });
  return () => {
    const i = layers.findIndex((l) => l.el === el);
    if (i === -1) return;
    const wasTop = i === layers.length - 1;
    layers.splice(i, 1);
    // A higher layer just closed — the new topmost layer reclaims focus.
    if (wasTop && layers.length > 0) layers[layers.length - 1].onResume?.();
  };
}

/// True when `node` lives inside an overlay stacked strictly above `root`.
/// Unregistered roots are treated as the bottom layer (index -1), so anything
/// in a registered overlay counts as higher.
export function focusInHigherLayer(root: HTMLElement, node: Node | null): boolean {
  if (!node) return false;
  const rootIdx = layers.findIndex((l) => l.el === root);
  for (let i = layers.length - 1; i > rootIdx; i--) {
    if (layers[i].el.contains(node)) return true;
  }
  return false;
}
