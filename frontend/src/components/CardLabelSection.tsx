import { For, Show } from "solid-js";
import type { Label } from "../types";
import { renderTitle } from "./Card";

interface Props {
  boardLabels: Label[];
  selectedIds: string[];
  pickerOpen: boolean;
  onToggleLabel: (labelId: string) => void;
  onTogglePicker: () => void;
}

/// Renders the assigned-label chips above the title and (when open) the
/// label-picker grid below them. Always rendered (even with zero board
/// labels) so the "+ Add label" button stays reachable.
export default function CardLabelSection(props: Props) {
  const assignedLabels = () =>
    props.boardLabels.filter((l) => props.selectedIds.includes(l.id));
  const hasLabels = () => props.boardLabels.length > 0;

  return (
    <>
      <div class="modal-section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        <span class="modal-label">Labels</span>
      </div>
      <div class="label-assigned-area">
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
            onClick={props.onTogglePicker}
            title={props.pickerOpen ? "Hide label picker (L)" : "Add/remove labels (L)"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {props.pickerOpen ? "Done" : "Add label"}
          </button>
        </div>
        <Show when={props.pickerOpen}>
          <Show
            when={hasLabels()}
            fallback={
              <div class="label-picker-empty">
                No labels on this board yet. Press <kbd>G</kbd> to open the label drawer and create some.
              </div>
            }
          >
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
        </Show>
      </div>
    </>
  );
}
