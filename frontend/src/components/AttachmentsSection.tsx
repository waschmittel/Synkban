import { For, Show } from "solid-js";
import type { Attachment } from "../types";
import { api } from "../api";
import { accel, tip } from "../platform";
import DetailRow from "./DetailRow";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/// Upper-case extension for a file tile ("PDF"), or "FILE".
export function fileExt(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1].toUpperCase() : "FILE";
}

interface Props {
  cardId: string;
  attachments: Attachment[];
  uploading: boolean;
  /// Opens the file chooser.
  onAdd: () => void;
  /// Ids of attachments the description shows inline.
  referenced: Set<string>;
  onDelete: (att: Attachment) => void;
  onPreview: (att: Attachment) => void;
  onInsert: (att: Attachment) => void;
}

/// Attachments as a grid of tiles plus a dashed "add" tile. Images show a
/// thumbnail and open `onPreview` (click/Enter); other files show their
/// extension and download. Actions appear on hover/focus. The preview overlay
/// lives in the parent (its Escape closes the preview before the card).
export default function AttachmentsSection(props: Props) {
  const download = (att: Attachment) => {
    const a = document.createElement("a");
    a.href = api.getAttachmentUrl(props.cardId, att.id);
    a.download = att.filename;
    a.click();
  };
  const open = (att: Attachment) => (isImageType(att.content_type) ? props.onPreview(att) : download(att));

  return (
    <DetailRow
      class="attachments-area"
      title={tip("Attachments", accel("O"))}
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      }
    >
      <div class="attachments-list">
        <For each={props.attachments}>
          {(att) => (
            <div
              class="attachment-item"
              classList={{ "attachment-item--image": isImageType(att.content_type) }}
              tabindex="0"
              title={`${att.filename} · ${formatSize(att.size)}`}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  props.onDelete(att);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  open(att);
                }
              }}
            >
              <div class="attachment-thumb-box" onClick={() => open(att)}>
                <Show when={isImageType(att.content_type)} fallback={<span class="attachment-ext">{fileExt(att.filename)}</span>}>
                  <img
                    class="attachment-thumb"
                    src={api.getAttachmentThumbUrl(props.cardId, att.id)}
                    alt={att.filename}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = api.getAttachmentUrl(props.cardId, att.id);
                    }}
                  />
                </Show>
                <Show when={props.referenced.has(att.id)}>
                  <span class="attachment-ref" title="Shown in the description">in text</span>
                </Show>
              </div>
              <div class="attachment-info">
                <span class="attachment-filename" onClick={() => open(att)}>
                  {att.filename}
                </span>
                <span class="attachment-size">{formatSize(att.size)}</span>
              </div>
              <div class="attachment-actions">
                <Show when={isImageType(att.content_type)}>
                  <button class="attachment-insert" tabindex="-1" title="Insert into description" onClick={() => props.onInsert(att)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </Show>
                <button class="attachment-delete" tabindex="-1" title={tip("Remove attachment", "Del")} onClick={() => props.onDelete(att)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </For>
        <button
          type="button"
          class="attachment-upload"
          classList={{ "attachment-upload--busy": props.uploading }}
          disabled={props.uploading}
          title={tip("Add attachment", accel("O"))}
          onClick={props.onAdd}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {props.uploading ? "Uploading…" : "Add"}
        </button>
      </div>
    </DetailRow>
  );
}
