# Drag and drop uses the native HTML5 API with fractional positions

Cards, lists, boards, labels and checklist items reorder by native drag & drop; no drag library. Position is the midpoint between neighbours (ADR-0001). Touch is handled by the global `touchDrag.ts` shim (long-press then drag; ghost z-index above drawers).

## Rules

- The **`requestAnimationFrame` trick**: the browser captures the full-opacity ghost synchronously in `dragstart`; the next frame sets the drag class (`display:none`) to hide the source. Cards use `.dragging`, lists `.list-dragging`.
- Card `dragstart` calls `stopPropagation()` so the list doesn't also enter drag state.
- A `.drop-placeholder` line (cards) or a dashed `.list-drop-placeholder` (lists) shows the insertion point; both clean up on `dragend` and `drop`. Labels and checklist items use `--drop-before/--drop-after` lines.
- A checklist item drop must bubble to the modal overlay so its file-drop counter resets (the overlay ignores non-file drops).
- Every drag has a keyboard equivalent (`Shift+arrows`); covered by `e2e/reorder.spec.ts`, `labelorder.spec.ts`, `touch.spec.ts`.
