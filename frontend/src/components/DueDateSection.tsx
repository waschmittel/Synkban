import { Show } from "solid-js";

interface Props {
  value: string;
  onChange: (value: string) => void;
  inputRef?: (el: HTMLInputElement) => void;
  /// Exposes a function that opens the native date picker. The picker lives on
  /// the hidden `type="date"` input (text inputs have no showPicker), so the
  /// parent's Ctrl/Cmd+U shortcut must go through this rather than the visible
  /// input it focuses.
  openPickerRef?: (open: () => void) => void;
}

/// ISO-text date input (`YYYY-MM-DD`) with a calendar button that opens
/// the native picker via `showPicker()` and a clear button. Two inputs:
/// a visible text one (monospace, pattern-validated) and a hidden native
/// date input that the calendar button targets.
export default function DueDateSection(props: Props) {
  let pickerRef!: HTMLInputElement;

  return (
    <div class="due-date-area">
      <div class="modal-section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span class="modal-label">Due Date</span>
      </div>
      <div class="due-date-input-row">
        <input
          ref={props.inputRef}
          type="text"
          class="due-date-input"
          placeholder="YYYY-MM-DD"
          pattern="\d{4}-\d{2}-\d{2}"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
        <input
          ref={(el) => {
            pickerRef = el;
            props.openPickerRef?.(() => {
              try {
                el.showPicker?.();
              } catch {
                // showPicker throws without a user gesture in some browsers;
                // the focused text input is then the fallback.
              }
            });
          }}
          type="date"
          class="due-date-picker-hidden"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
        <button
          class="due-date-calendar-btn"
          onClick={() => pickerRef?.showPicker?.()}
          title="Open date picker"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <Show when={props.value}>
          <button
            class="due-date-clear"
            onClick={() => props.onChange("")}
            title="Clear due date"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Show>
      </div>
    </div>
  );
}
