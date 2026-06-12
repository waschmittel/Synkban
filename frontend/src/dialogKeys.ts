/// Document-level keyboard ownership for modal dialogs.
///
/// Element-level keydown handlers only fire while focus is *inside* the
/// dialog, but a just-mounted dialog moves focus to its default button on the
/// next animation frame — leaving a window where a fast keypress (e.g. a
/// second Escape) still targets the element behind the overlay and gets
/// swallowed by the parent's "dialog is open, ignore keys" guard. A
/// document-capture listener closes that window: the dialog owns its keys
/// from the moment it mounts, independent of where focus currently is.
///
/// Handlers form a stack so nested dialogs compose — only the topmost open
/// dialog receives events. A handler must act only on the keys it owns and
/// call preventDefault()/stopPropagation() on those; all other keys propagate
/// normally (focusTrap's Tab wrapping, button Enter activation, typing).
///
/// Returns a dispose function — call it when the dialog closes.

type Handler = (e: KeyboardEvent) => void;

const stack: Handler[] = [];

const listener = (e: KeyboardEvent) => {
  stack[stack.length - 1]?.(e);
};

export function dialogKeys(handler: Handler): () => void {
  if (stack.length === 0) document.addEventListener("keydown", listener, true);
  stack.push(handler);
  return () => {
    const i = stack.indexOf(handler);
    if (i !== -1) stack.splice(i, 1);
    if (stack.length === 0) document.removeEventListener("keydown", listener, true);
  };
}
