import { For, Show } from "solid-js";
import type { Attachment } from "../types";
import { api } from "../api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

interface Props {
  cardId: string;
  attachments: Attachment[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (attId: string) => void;
  onPreview: (att: Attachment) => void;
  fileInputRef?: (el: HTMLInputElement) => void;
}

/// Attachments list + "Add attachment" file picker. Image attachments
/// show a thumbnail and invoke `onPreview` on click/Enter; non-image
/// attachments are direct download links. The image preview overlay is
/// rendered by the parent so it can coordinate with modal-level Escape
/// handling (Escape closes the preview before closing the card modal).
export default function AttachmentsSection(props: Props) {
  const handleFileInput = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    props.onUpload(file);
  };

  return (
    <>
      <div class="modal-section-header" style={{ "margin-top": "16px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span class="modal-label">Attachments</span>
      </div>
      <div class="attachments-list">
        <For each={props.attachments}>
          {(att) => (
            <div
              class="attachment-item"
              classList={{ "attachment-item--image": isImageType(att.content_type) }}
              tabindex="0"
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  props.onDelete(att.id);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (isImageType(att.content_type)) {
                    props.onPreview(att);
                  } else {
                    const a = document.createElement("a");
                    a.href = api.getAttachmentUrl(props.cardId, att.id);
                    a.download = att.filename;
                    a.click();
                  }
                }
              }}
            >
              <Show when={isImageType(att.content_type)}>
                <img
                  class="attachment-thumb"
                  src={api.getAttachmentThumbUrl(props.cardId, att.id)}
                  alt={att.filename}
                  onClick={() => props.onPreview(att)}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = api.getAttachmentUrl(props.cardId, att.id);
                  }}
                />
              </Show>
              <div class="attachment-info">
                <Show
                  when={isImageType(att.content_type)}
                  fallback={
                    <a
                      class="attachment-filename"
                      href={api.getAttachmentUrl(props.cardId, att.id)}
                      download={att.filename}
                      title={att.filename}
                    >
                      {att.filename}
                    </a>
                  }
                >
                  <span
                    class="attachment-filename attachment-filename--clickable"
                    title={att.filename}
                    onClick={() => props.onPreview(att)}
                  >
                    {att.filename}
                  </span>
                </Show>
                <span class="attachment-size">{formatSize(att.size)}</span>
              </div>
              <button
                class="attachment-delete"
                title="Remove attachment"
                onClick={() => props.onDelete(att.id)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </For>
      </div>
      <label class="attachment-upload" classList={{ "attachment-upload--busy": props.uploading }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        {props.uploading ? "Uploading…" : "Add attachment"}
        <input
          type="file"
          style={{ display: "none" }}
          onChange={handleFileInput}
          disabled={props.uploading}
          ref={(el) => props.fileInputRef?.(el)}
        />
      </label>
    </>
  );
}
