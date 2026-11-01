import { For, Show, createMemo, createSignal } from "solid-js";
import type { Label } from "../types";
import { renderTitle } from "./Card";
import { handleMarkdownShortcut } from "../mdInput";

interface Props {
  boardLabels: Label[];
  selectedIds: string[];
  onToggleLabel: (labelId: string) => void;
  onCreateLabel: (name: string) => void | Promise<void>;
  /// Receives a function that moves keyboard focus into the row (first label,
  /// or the "New label" chip when the board has none) — drives `Accel+G`.
  focusRef?: (focus: () => void) => void;
}

/// One toggle row: board labels as chips, filled with a ✓ when assigned,
/// outlined when not. Click toggles. A dashed "New label" chip at the end
/// becomes an inline name input; the created label is auto-assigned. Always
/// rendered (even with zero board labels) so creating one stays reachable.
///
/// Many labels: assigned ones come first (board order), then the first
/// `max(12 - assigned, 2)` unassigned ones; the rest hide behind "+N more".
/// While the pointer or focus is in the row the order is frozen (a toggled chip
/// must not jump away under the cursor); it re-sorts once both have left.
const VISIBLE_TARGET = 12;
const MIN_UNASSIGNED = 2;
const visibleCount = (assigned: number) =>
  assigned + Math.max(VISIBLE_TARGET - assigned, MIN_UNASSIGNED);

export default function CardLabelSection(props: Props) {
  const [newName, setNewName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [showCreate, setShowCreate] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  // Frozen view: label ids in display order + how many of them are visible.
  const [snapshot, setSnapshot] = createSignal<{ ids: string[]; cut: number } | null>(null);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  let rowRef: HTMLDivElement | undefined;
  let newChipRef: HTMLButtonElement | undefined;
  let createInputRef: HTMLInputElement | undefined;

  const sortedIds = createMemo(() => {
    const assigned = props.boardLabels.filter((l) => props.selectedIds.includes(l.id));
    const rest = props.boardLabels.filter((l) => !props.selectedIds.includes(l.id));
    return { ids: [...assigned, ...rest].map((l) => l.id), cut: visibleCount(assigned.length) };
  });

  // Labels in display order plus how many are hidden behind "+N more".
  const view = createMemo(() => {
    const byId = new Map(props.boardLabels.map((l) => [l.id, l]));
    const snap = snapshot();
    const { ids, cut } = snap ?? sortedIds();
    const ordered = ids.filter((id) => byId.has(id));
    // Labels the snapshot never saw (just created / synced in) always show.
    const extra = snap ? props.boardLabels.filter((l) => !ids.includes(l.id)).map((l) => l.id) : [];
    const all = [...ordered, ...extra];
    const shown = expanded() ? all : all.filter((id, i) => i < cut || i >= ordered.length);
    return { items: shown.map((id) => byId.get(id)!), hidden: all.length - shown.length, canCollapse: all.length > cut };
  });

  const freeze = () => {
    if (!snapshot()) setSnapshot(sortedIds());
  };
  const release = () => {
    if (!hovered() && !focused()) setSnapshot(null);
  };
  const handleFocusOut = () =>
    queueMicrotask(() => {
      if (!rowRef?.contains(document.activeElement)) {
        setFocused(false);
        release();
      }
    });

  const showMore = () => {
    const firstHidden = view().items.length;
    setExpanded(true);
    rowRef?.querySelectorAll<HTMLElement>(".label-toggle")[firstHidden]?.focus();
  };
  const showFewer = () => {
    setExpanded(false);
    rowRef?.querySelector<HTMLElement>(".label-more-chip")?.focus();
  };

  props.focusRef?.(() =>
    (rowRef?.querySelector<HTMLElement>(".label-toggle, .label-new-chip, .label-create-input"))?.focus(),
  );

  // Focus the input synchronously: the chip this click removes leaves the DOM
  // in the same flush, and a deferred focus would lose the race with the form's
  // focusout-collapse microtask.
  const openCreate = () => {
    setShowCreate(true);
    createInputRef?.focus();
  };

  const closeCreate = (refocus: boolean) => {
    setShowCreate(false);
    setNewName("");
    if (refocus) queueMicrotask(() => newChipRef?.focus());
  };

  const submitNew = async () => {
    const name = newName().trim();
    if (!name || creating()) return;
    setCreating(true);
    try {
      await props.onCreateLabel(name);
      closeCreate(true);
    } finally {
      setCreating(false);
    }
  };

  // Collapse back to the chip when focus leaves the form (e.g. clicking a label).
  const handleCreateFocusOut = (e: FocusEvent) => {
    const form = e.currentTarget as HTMLElement;
    const next = e.relatedTarget as Node | null;
    if (next && form.contains(next)) return;
    queueMicrotask(() => {
      if (showCreate() && !form.contains(document.activeElement)) closeCreate(false);
    });
  };

  return (
    <>
      <div class="modal-section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        <span class="modal-label">Labels</span>
      </div>
      <div
        class="label-toggle-row"
        ref={rowRef}
        onMouseEnter={() => {
          setHovered(true);
          freeze();
        }}
        onMouseLeave={() => {
          setHovered(false);
          release();
        }}
        onFocusIn={() => {
          setFocused(true);
          freeze();
        }}
        onFocusOut={handleFocusOut}
      >
        <For each={view().items}>
          {(label) => {
            const selected = () => props.selectedIds.includes(label.id);
            return (
              <button
                type="button"
                class="label-toggle"
                classList={{ "label-toggle--selected": selected() }}
                style={{ "--label-color": label.color }}
                aria-pressed={selected()}
                onClick={() => props.onToggleLabel(label.id)}
                title={selected() ? `Remove "${label.name}"` : `Add "${label.name}"`}
              >
                <span class="label-toggle-dot" style={{ "background-color": label.color }} />
                <span class="label-toggle-name" innerHTML={renderTitle(label.name)} />
                <Show when={selected()}>
                  <svg class="label-toggle-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </button>
            );
          }}
        </For>
        <Show when={view().hidden > 0}>
          <button type="button" class="label-more-chip" onClick={showMore}>
            +{view().hidden} more
          </button>
        </Show>
        <Show when={expanded() && view().canCollapse}>
          <button type="button" class="label-more-chip" onClick={showFewer}>
            Show fewer
          </button>
        </Show>
        <Show
          when={showCreate()}
          fallback={
            <button
              class="label-new-chip"
              type="button"
              ref={(el) => (newChipRef = el)}
              onClick={openCreate}
              title="Create a new label for this board"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New label
            </button>
          }
        >
          <form
            class="label-create"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNew();
            }}
            onFocusOut={handleCreateFocusOut}
          >
            <input
              class="label-create-input"
              placeholder="New label name…"
              value={newName()}
              disabled={creating()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                handleMarkdownShortcut(e);
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeCreate(true);
                }
              }}
              ref={(el) => (createInputRef = el)}
            />
            <button
              type="submit"
              class="label-create-btn"
              disabled={!newName().trim() || creating()}
            >
              Create
            </button>
          </form>
        </Show>
      </div>
    </>
  );
}
