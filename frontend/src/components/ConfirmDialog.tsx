/// Centered confirmation dialog with Confirm/Cancel buttons.
/// Confirm button auto-focuses; Enter activates the focused button and
/// Escape cancels. Used for archive-card and delete-list flows.
/// Enter/Escape are owned via dialogKeys so they work even before the
/// auto-focus lands (next animation frame).

import { onCleanup } from "solid-js";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";

interface Props {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: Props) {
  onCleanup(
    dialogKeys((e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const active = document.activeElement as HTMLElement | null;
        if (active?.tagName === "BUTTON" && active.closest(".unsaved-dialog")) {
          active.click();
        } else {
          props.onConfirm();
        }
      }
    })
  );

  return (
    <div
      class="unsaved-overlay archive-overlay"
      ref={(el) => onCleanup(focusTrap(el))}
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}
      onKeyDown={(e) => e.stopPropagation()}
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
