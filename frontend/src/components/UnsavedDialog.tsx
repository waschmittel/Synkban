import { onCleanup } from "solid-js";
import { modalDialog } from "../modalDialog";
import { dialogKeys } from "../dialogKeys";
import { tip } from "../platform";

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/// Centered Save/Discard/Cancel dialog shown when closing a dirty
/// CardDetail. Save button is focused by default; Enter activates the
/// focused button; Escape cancels. Keys are owned via dialogKeys so they
/// work even before the default-button focus lands (next animation frame).
export default function UnsavedDialog(props: Props) {
  onCleanup(
    dialogKeys((e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
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
    })
  );

  return (
    <dialog class="dialog-overlay unsaved-overlay" ref={(el) => onCleanup(modalDialog(el))}>
      <div class="dialog-surface unsaved-dialog">
        <p>You have unsaved changes.</p>
        <div class="unsaved-dialog-actions">
          <button
            ref={(el) => requestAnimationFrame(() => el.focus())}
            class="btn btn-primary"
            onClick={props.onSave}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save
          </button>
          <button class="btn btn-danger" onClick={props.onDiscard}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Discard
          </button>
          <button class="btn btn-cancel" onClick={props.onCancel} title={tip("Cancel", "Esc")}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
