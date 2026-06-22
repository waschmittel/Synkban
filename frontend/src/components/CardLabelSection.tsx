import { For, Show, createEffect, createSignal } from "solid-js";
import type { Label } from "../types";
import { renderTitle } from "./Card";
import { handleMarkdownShortcut } from "../mdInput";

interface Props {
  boardLabels: Label[];
  selectedIds: string[];
  pickerOpen: boolean;
  onToggleLabel: (labelId: string) => void;
  onTogglePicker: () => void;
  onClosePicker: () => void;
  onCreateLabel: (name: string) => void | Promise<void>;
  addBtnRef?: (el: HTMLButtonElement) => void;
}

/// Renders the assigned-label chips above the title and (when open) the
/// label-picker grid below them. Always rendered (even with zero board
/// labels) so the "+ Add label" button stays reachable.
export default function CardLabelSection(props: Props) {
  const assignedLabels = () =>
    props.boardLabels.filter((l) => props.selectedIds.includes(l.id));
  const hasLabels = () => props.boardLabels.length > 0;

  const [newName, setNewName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  // The inline create form is hidden until the user clicks "Create label";
  // opening the picker only reveals the existing-label grid, not a text input.
  const [showCreate, setShowCreate] = createSignal(false);
  let areaRef: HTMLDivElement | undefined;
  let addBtnRef: HTMLButtonElement | undefined;
  let createInputRef: HTMLInputElement | undefined;

  // Reveal the inline create form and focus its input synchronously. Solid
  // mounts the input during this signal write, so focusing it now (rather than
  // on the next animation frame) wins the race against the focusout microtask
  // fired when the toggle button this click removes leaves the DOM — otherwise
  // that handler sees an empty activeElement and closes the whole picker.
  const openCreate = () => {
    setShowCreate(true);
    createInputRef?.focus();
  };

  // Collapse the create form whenever the picker closes so the next open
  // (this card or another) starts from the existing-label grid.
  createEffect(() => {
    if (!props.pickerOpen) setShowCreate(false);
  });

  const submitNew = async () => {
    const name = newName().trim();
    if (!name || creating()) return;
    setCreating(true);
    try {
      await props.onCreateLabel(name);
      setNewName("");
      props.onClosePicker();
      addBtnRef?.focus();
    } finally {
      setCreating(false);
    }
  };

  // Close the picker (and thus the inline create form) when focus leaves the
  // whole label area. relatedTarget is unreliable for clicks on non-focusable
  // regions, so confirm via document.activeElement on the next microtask.
  const handleFocusOut = (e: FocusEvent) => {
    if (!props.pickerOpen) return;
    const next = e.relatedTarget as Node | null;
    if (next && areaRef?.contains(next)) return;
    queueMicrotask(() => {
      if (props.pickerOpen && !areaRef?.contains(document.activeElement)) {
        props.onClosePicker();
      }
    });
  };

  // Collapse just the create form (back to the "Create label" toggle) when
  // focus leaves the form but stays elsewhere in the picker — e.g. clicking a
  // label in the grid. Same microtask/activeElement guard as handleFocusOut.
  const handleCreateFocusOut = (e: FocusEvent) => {
    const form = e.currentTarget as HTMLElement;
    const next = e.relatedTarget as Node | null;
    if (next && form.contains(next)) return;
    queueMicrotask(() => {
      if (showCreate() && !form.contains(document.activeElement)) {
        setShowCreate(false);
        setNewName("");
      }
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
      <div class="label-assigned-area" ref={areaRef} onFocusOut={handleFocusOut}>
        <div class="label-assigned-chips">
          <For each={assignedLabels()}>
            {(label) => (
              <span class="label-assigned-chip" style={{ "background-color": label.color }}>
                <span innerHTML={renderTitle(label.name)} />
                <button
                  class="label-chip-remove"
                  title={`Remove "${label.name}"`}
                  onClick={() => props.onToggleLabel(label.id)}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            )}
          </For>
          <button
            class="label-add-btn"
            ref={(el) => { addBtnRef = el; props.addBtnRef?.(el); }}
            onClick={props.onTogglePicker}
            title={props.pickerOpen ? "Hide label picker (Ctrl+L)" : "Add/remove labels (Ctrl+L)"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {props.pickerOpen ? "Done" : "Add label"}
          </button>
        </div>
        <Show when={props.pickerOpen}>
          <Show when={hasLabels()}>
            <div class="label-picker">
              <For each={props.boardLabels}>
                {(label) => {
                  const selected = () => props.selectedIds.includes(label.id);
                  return (
                    <button
                      class="label-picker-item"
                      classList={{ "label-picker-item--selected": selected() }}
                      style={{ "--label-color": label.color }}
                      onClick={() => props.onToggleLabel(label.id)}
                      title={selected() ? `Remove "${label.name}"` : `Add "${label.name}"`}
                    >
                      <span class="label-picker-dot" style={{ "background-color": label.color }} />
                      <span class="label-picker-name" innerHTML={renderTitle(label.name)} />
                      <Show when={selected()}>
                        <svg class="label-picker-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show
            when={showCreate()}
            fallback={
              <button
                class="label-create-toggle"
                type="button"
                onClick={openCreate}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create label
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
                onKeyDown={(e) => handleMarkdownShortcut(e)}
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
        </Show>
      </div>
    </>
  );
}
