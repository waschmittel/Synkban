# Descriptions are ProseMirror JSON with a restricted schema; links are allow-listed and edited whole

The card description is rich text in ProseMirror (`schema.ts`): basic nodes, nested lists and tables, and an inline `image` that references an *attachment* (ADR-0020, never a URL); **no `horizontal_rule`**; marks bold, italic, inline code, link. It is stored as `JSON.stringify(doc)` in `description` (empty string = empty); never HTML. A description that fails to parse as a node is shown as plain text.

## Why

A tight schema keeps the stored format, the server-side text extraction (`description_text` for filtering), the PDF export and the history diff small. Safety: no raw HTML, no script URLs.

## Document rules

- `list_item` is `paragraph block*` (arbitrary nesting); table cells are `paragraph+`.
- New node types are a data-format change: update backend text extraction, `pdf.rs` (+ corner cases), `diff.ts`, and the compatibility note in ADR-0017.
- The sticky-note tint (`#fffbe6`, dark variant in ADR-0013) distinguishes the description from the rest of the modal.
- `Tab`/`Shift+Tab` indent/outdent list items (`Mod-]`/`Mod-[` also work). Inside a list they always belong to the editor: an item that can't move (the first has nothing to nest under) is a no-op, never a focus jump out of the description; outside lists and tables `Tab` moves focus on. Ctrl/Cmd+B/I toggle marks.

## Links

- **Allow-list:** `http:`, `https:`, `mailto:`; `www.` becomes `https://`. Relative URLs and everything else (`javascript:`, `data:`, `file:`, obfuscated casing/whitespace) are rejected (`sanitizeLinkHref`), in the dialog, while typing and on paste.
- Anchors render with `target="_blank" rel="noopener noreferrer"`. A plain click **opens** the link (`window.open` with `noopener`; Electron routes it to the OS browser). Opening never edits. Only the **primary button** acts (ProseMirror also reports a right-click's mouseup to `handleClick`); Accel+click edits, where Accel on macOS is Cmd only because Ctrl+click is a right-click.
- **Editing always targets the whole link** (`links.ts::linkTarget`): cursor inside a link, or any part of the selection touching one, edits the entire link (the range widens to also cover the selection). A plain non-empty selection adds a link.
- **One dialog, four entry points:** toolbar button ("Add or edit link"), Cmd/Ctrl+click, right-click (editor menu) (`L`/`U`, ADR-0016). Single URL field, pre-filled from the href or from selected URL-like text; **Remove link** when editing.
- **Right-click** anywhere in the editor opens the editor menu (ADR-0016) at the pointer; the native menu is suppressed there.
- **Autolink:** a typed URL followed by whitespace becomes a link (trailing punctuation and the space stay unlinked); pasting a bare URL wraps the selection or inserts a linked text node.
- The dialog portals to `<body>`, registers as an overlay layer (ADR-0009) and owns Enter/Escape (`stopPropagation`) so they don't close the card modal.

## Considered and rejected

- **Editing only the selected part of a link.** Leaves fragmented marks; never what users mean.
