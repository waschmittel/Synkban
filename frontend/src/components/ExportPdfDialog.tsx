import { onCleanup } from "solid-js";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";
import { tip } from "../platform";

interface Props {
  onSaveAndExport: () => void;
  onExportSaved: () => void;
  onCancel: () => void;
}

/// Shown when exporting a dirty card to PDF: the PDF always renders the saved
/// card, so ask whether to save first. Same key ownership as UnsavedDialog —
/// the default button takes focus a frame late, so Enter/Escape go through
/// dialogKeys.
export default function ExportPdfDialog(props: Props) {
  onCleanup(
    dialogKeys((e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const active = document.activeElement as HTMLElement;
        if (active?.tagName === "BUTTON" && active.closest(".unsaved-dialog")) {
          active.click();
        } else {
          props.onSaveAndExport();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onCancel();
      }
    })
  );

  return (
    <div class="unsaved-overlay export-pdf-overlay" ref={(el) => onCleanup(focusTrap(el))}>
      <div class="unsaved-dialog">
        <p>You have unsaved changes. The PDF contains the saved card.</p>
        <div class="unsaved-dialog-actions">
          <button
            ref={(el) => requestAnimationFrame(() => el.focus())}
            class="btn btn-primary"
            onClick={props.onSaveAndExport}
          >
            Save &amp; export
          </button>
          <button class="btn btn-cancel" onClick={props.onExportSaved}>
            Export saved version
          </button>
          <button class="btn btn-cancel" onClick={props.onCancel} title={tip("Cancel", "Esc")}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
