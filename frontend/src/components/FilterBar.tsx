import { createSignal, For, Show } from "solid-js";
import type { Label } from "../types";
import { renderTitle } from "./Card";
import DuePicker from "./DuePicker";
import { parseIso } from "../dueDate";

interface Props {
  text: string;
  labelIds: string[];
  /// `DueFilter`: "overdue", "week", until a `YYYY-MM-DD` day, or null.
  due: string | null;
  onDueChange: (due: string | null) => void;
  boardLabels: Label[];
  onTextChange: (text: string) => void;
  onToggleLabel: (labelId: string) => void;
  onClear: () => void;
  onClose: () => void;
  /// False when re-mounted by view restoration (ADR-0021): keep focus where it is.
  autofocus?: boolean;
}

/// Text, due-date and label-chip filter. Autofocuses the input on mount.
/// Escape clears active filters (or closes the bar if already empty).
export default function FilterBar(props: Props) {
  const isFiltering = () => !!props.text || props.labelIds.length > 0 || !!props.due;
  const [picking, setPicking] = createSignal(false);
  let dateChip!: HTMLButtonElement;
  const day = () => (props.due ? parseIso(props.due) : null);
  const toggle = (d: "overdue" | "week") => props.onDueChange(props.due === d ? null : d);

  return (
    <div class="filter-bar">
      <div class="filter-input-wrapper">
        <input
          ref={(el) => {
            if (props.autofocus !== false) requestAnimationFrame(() => el.focus());
          }}
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
      <div class="filter-due" role="group" aria-label="Due date">
        <button
          class="filter-due-chip"
          classList={{ "filter-due-chip--active": props.due === "overdue" }}
          aria-pressed={props.due === "overdue"}
          onClick={() => toggle("overdue")}
          title="Cards due before today"
        >
          Overdue
        </button>
        <button
          class="filter-due-chip"
          classList={{ "filter-due-chip--active": props.due === "week" }}
          aria-pressed={props.due === "week"}
          onClick={() => toggle("week")}
          title="Cards due this calendar week"
        >
          This week
        </button>
        <button
          ref={dateChip}
          class="filter-due-chip filter-due-date"
          classList={{ "filter-due-chip--active": !!day() }}
          aria-pressed={!!day()}
          aria-haspopup="dialog"
          onClick={() => setPicking((v) => !v)}
          title="Cards due on or before a day"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {day() ? `Until ${day()!.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "Until…"}
        </button>
        <Show when={picking()}>
          <DuePicker
            value={day() ? props.due! : ""}
            anchor={dateChip}
            onPick={(iso) => props.onDueChange(iso || null)}
            onClose={() => setPicking(false)}
          />
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
