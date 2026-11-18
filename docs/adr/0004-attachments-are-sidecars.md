# Attachments are file trios with a sidecar, not part of the card JSON

Each attachment is `data/boards/{bid}/attachments/{cid}/{att-id}` (binary, no extension), an optional `{att-id}_thumb` (JPEG ≤400px, images only) and `{att-id}.json` (the `Attachment` record). **The sidecar is the source of truth.** `attachments::load_attachments` fills `Card.attachments` in responses; `write_card` strips the field before writing.

## Why

Persistence is decoupled from the card record: additive uploads never conflict with concurrent card edits or sync, and the directory travels with the card on a cross-board move (`move_card_attachments` renames `{cid}/`).

## Rules

- Upload is `POST /api/cards/:id/attachments?filename=…` with the raw body (no multipart), max 50 MB (`TooLarge` → 413). `filename` is stripped to its basename with control characters removed (empty rejected with 400); downloads serve RFC 5987 `Content-Disposition` with a sanitized ASCII fallback. Order: binary, thumbnail, **sidecar last** as the completeness marker.
- **Startup GC** (`store/gc.rs::reconcile`, from both server entry points before serving): migrate pre-sidecar metadata out of card JSON; delete attachment dirs whose card is gone; delete partial files (binary without sidecar, sidecar without binary, orphan thumb). The last two only touch files older than a 5-minute `GRACE` window so an in-flight sync isn't mistaken for garbage.
- Attachments appear in card history by filename only (ADR-0005); `create_/delete_attachment` snapshot content before and record after.
- UI: dropping files anywhere on the open card modal uploads them (`dragCounter` on `.modal-overlay`); image thumbnails preview in `ImagePreviewOverlay`, which owns Escape while open.
- Images can be referenced inline in the description (ADR-0020): pasting an image with the card open attaches it, deleting an attachment also removes its references, and `copy` duplicates an attachment onto another card.
