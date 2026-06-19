/// Shared stack of open overlay layers (modals, dialogs, portaled popups).
///
/// A focus trap must not steal focus from an overlay stacked *above* it — even
/// one rendered outside its DOM subtree (e.g. the link dialog, which portals to
/// document.body). Every focus-trapping root and every portaled overlay
/// registers here in open order; a lower trap yields while a higher layer holds
/// focus. This is the layering invariant that lets focusTrap compose with
/// overlays it doesn't contain.

const layers: HTMLElement[] = [];

/// Register an overlay element. Returns a dispose fn to pop it off the stack.
export function registerOverlay(el: HTMLElement): () => void {
  layers.push(el);
  return () => {
    const i = layers.indexOf(el);
    if (i !== -1) layers.splice(i, 1);
  };
}

/// True when `node` lives inside an overlay stacked strictly above `root`.
/// Unregistered roots are treated as the bottom layer (index -1), so anything
/// in a registered overlay counts as higher.
export function focusInHigherLayer(root: HTMLElement, node: Node | null): boolean {
  if (!node) return false;
  const rootIdx = layers.indexOf(root);
  for (let i = layers.length - 1; i > rootIdx; i--) {
    if (layers[i].contains(node)) return true;
  }
  return false;
}
