import { onCleanup } from "solid-js";
import type { Attachment } from "../types";
import { api } from "../api";
import { modalDialog } from "../modalDialog";
import { dialogKeys } from "../dialogKeys";
import { tip } from "../platform";

interface Props {
  cardId: string;
  attachment: Attachment;
  onClose: () => void;
}

/// Fullscreen image preview overlay with filename, Download link, and
/// Close button. Clicking the backdrop or pressing Escape closes.
export default function ImagePreviewOverlay(props: Props) {
  onCleanup(
    dialogKeys((e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
      }
    }),
  );

  return (
    <dialog
      class="image-preview-overlay"
      ref={(el) => onCleanup(modalDialog(el))}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div class="image-preview-container">
        <div class="image-preview-header">
          <span class="image-preview-filename">{props.attachment.filename}</span>
          <div class="image-preview-actions">
            <a
              class="btn btn-sm image-preview-download"
              href={api.getAttachmentUrl(props.cardId, props.attachment.id)}
              download={props.attachment.filename}
              title="Download"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
            <button class="image-preview-close" onClick={props.onClose} title={tip("Close", "Esc")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <img
          class="image-preview-img"
          src={api.getAttachmentUrl(props.cardId, props.attachment.id)}
          alt={props.attachment.filename}
        />
      </div>
    </dialog>
  );
}
