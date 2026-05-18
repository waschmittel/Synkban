import { For, Show } from "solid-js";
import type { Label } from "../types";
import { renderTitle } from "./Card";

interface Props {
  text: string;
  labelIds: string[];
  boardLabels: Label[];
  onTextChange: (text: string) => void;
  onToggleLabel: (labelId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/// Text + label-chip filter. Autofocuses the input on mount. Escape clears
/// active filters (or closes the bar if already empty).
export default function FilterBar(props: Props) {
  const isFiltering = () => !!props.text || props.labelIds.length > 0;

  return (
    <div class="filter-bar">
      <div class="filter-input-wrapper">
        <input
          ref={(el) => requestAnimationFrame(() => el.focus())}
          class="filter-text-input"
          type="text"
          placeholder="Filter cards..."
          value={props.text}
          onInput={(e) => props.onTextChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (!isFiltering()) {
                props.onClose();
              } else {
                props.onClear();
              }
            }
          }}
        />
        <Show when={isFiltering()}>
          <button
            class="filter-input-clear"
            onClick={props.onClear}
            title="Clear all filters"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Show>
      </div>
      <Show when={props.boardLabels.length > 0}>
        <div class="filter-labels">
          <For each={props.boardLabels}>
            {(label) => {
              const active = () => props.labelIds.includes(label.id);
              return (
                <button
                  class="filter-label-chip"
                  classList={{ "filter-label-chip--active": active() }}
                  style={{ "--label-color": label.color }}
                  onClick={() => props.onToggleLabel(label.id)}
                >
                  <span class="filter-label-dot" style={{ "background-color": label.color }} />
                  <span innerHTML={renderTitle(label.name)} />
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
