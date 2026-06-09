/// Centered confirmation dialog with Confirm/Cancel buttons.
/// Confirm button auto-focuses; Enter activates the focused button and
/// Escape cancels. Used for archive-card and delete-list flows.

interface Props {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: Props) {
  return (
    <div
      class="unsaved-overlay archive-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.click();
        }
      }}
    >
      <div class="unsaved-dialog">
        <p>{props.message}</p>
        <div class="unsaved-dialog-actions">
          <button
            ref={(el) => requestAnimationFrame(() => el.focus())}
            class="btn btn-primary"
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
          <button class="btn btn-cancel" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
