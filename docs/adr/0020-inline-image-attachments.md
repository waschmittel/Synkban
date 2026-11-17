# Images in the description reference image attachments

The description schema has an inline `image` node `{att, alt}`: `att` is the id of an image attachment of the same card (ADR-0004), `alt` its file name. Stored JSON: `{"type":"image","attrs":{"att":"…","alt":"shot.png"}}`.

## Why

Attachments already hold the bytes (sidecars, thumbnails, GC, sync). A reference keeps the description small and URL-free (no host/token in stored data, ADR-0003), and avoids a second image store.

## Invariant: references are always valid

Every stored reference names an existing attachment of its card. Kept by:

- **Server, on card update:** `store/image_refs.rs::prune_image_refs` drops references to unknown attachments.
- **Server, on attachment delete:** the references to it are removed from the stored description (one history entry with the deletion).
- **Client, on delete:** an attachment shown in the description asks first ("also removes it from the description"); then the open editor and the saved baseline lose the references (no spurious "unsaved").
- **Client, on paste:** see below.
- Manually edited/corrupt data that still gets through renders a "image missing" placeholder (`editor-image--missing`, no preview on click) instead of a broken image.

## Rules

- **Rendering:** a NodeView shows `…/attachments/:id/thumb` (≤120px high), falling back once to the original (e.g. GIF). Click opens `ImagePreviewOverlay`.
- **Creating:** (1) paste an image (no `text/plain` on the clipboard): uploaded as `pasted-<ts>-<n>.<ext>`; in the editor also inserted at the caret, anywhere else in the card modal only attached. (2) The toolbar image button and the editor menu (Accel+K, `M`) open the **image picker** (`imagePicker.ts`): the card's image attachments (`1`–`9`/arrows+Enter) or "Upload image…" (`U`, attaches and inserts). (3) "Insert into description" on an image attachment. Insertion is card content (dirty until Save); the upload itself persists immediately (ADR-0004).
- **Attachment list:** shows "in description" for referenced attachments (live from the editor).
- **Copy/paste across cards:** the editor's clipboard HTML tags references `<card>/<attachment>`. On paste (`pastedRefs.ts`) own attachments stay, other cards' attachments are copied (`POST /api/cards/:id/attachments/copy`) and the reference re-pointed, unknown ones are dropped. Only `img[data-att]` parses from HTML; foreign images are dropped.
- **Diff/history:** `[image: name]` (`diff.ts`).
- **PDF (`pdf.rs`):** the original (or thumbnail) is embedded at the reference's position: the paragraph is split, the picture gets its own line, natural size (1px = 1pt) scaled down so that it is neither wider than the available line (narrower inside lists/quotes) nor higher than half the text area of a page, never upscaled; moves to the next page when it doesn't fit. Images shown inline in the description are omitted from the Attachments list (and its thumbnails). In **table cells**, for dangling references and non-decodable images the text `[image: name]` stands in (and unshown attachments stay in the Attachments list). `description_text` ignores images.

## Considered and rejected

- **Data/URL images in the description:** bloats card JSON and history, leaks the server URL, bypasses attachment GC.
- **Embedding images in table cells (PDF):** needs per-cell row heights with images; placeholder for now.
- **Arrow keys as table move shortcuts and menu navigation:** conflict; moving rows/columns is `W`/`S`/`A`/`D` now (ADR-0016).
