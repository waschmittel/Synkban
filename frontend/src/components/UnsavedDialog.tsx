interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/// Centered Save/Discard/Cancel dialog shown when closing a dirty
/// CardDetail. Save button is focused by default; Enter activates the
/// focused button; Escape cancels.
export default function UnsavedDialog(props: Props) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const active = document.activeElement as HTMLElement;
      if (active?.tagName === "BUTTON" && active.closest(".unsaved-dialog")) {
        active.click();
      } else {
        props.onSave();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    }
  };

  return (
    <div class="unsaved-overlay" onKeyDown={onKeyDown}>
      <div class="unsaved-dialog">
        <p>You have unsaved changes.</p>
        <div class="unsaved-dialog-actions">
          <button
            ref={(el) => requestAnimationFrame(() => el.focus())}
            class="btn btn-primary"
            onClick={props.onSave}
          >
            Save
          </button>
          <button class="btn btn-danger" onClick={props.onDiscard}>
            Discard
          </button>
          <button class="btn btn-cancel" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
