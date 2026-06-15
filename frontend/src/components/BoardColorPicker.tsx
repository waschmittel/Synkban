import { Show } from "solid-js";

const DEFAULT_COLOR = "#0079bf";

interface Props {
  open: boolean;
  currentColor?: string;
  onToggle: () => void;
  onSelect: (color: string | null) => void;
  onPreview: (color: string) => void;
}

/// Board color button + dropdown with a free color picker. Open state lives in
/// the parent so it can close the dropdown from its own outside-click handler.
export default function BoardColorPicker(props: Props) {
  return (
    <div class="board-color-area" onClick={(e) => e.stopPropagation()}>
      <button
        class="board-color-btn"
        classList={{ "board-color-btn--active": props.open }}
        onClick={props.onToggle}
        title="Board color"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.236 2.636 7.855 6.356 9.312C9.203 21.088 10 20.018 10 18.773v-1.12c-1.988.398-2.773-.506-3.084-1.154C6.664 15.956 6.232 15.665 5.8 15.4c-.388-.235-.04-.379.072-.367.574.08 1.028.558 1.39 1.086.27.397.566.784 1.004.784.452 0 .706-.123.852-.25.25-2.11 2.43-2.703 2.43-2.703s-1.548-.552-1.548-3v-.53C10 8.72 11.28 7 12 7s2 1.72 2 3.42v.53c0 2.448-1.548 3-1.548 3s2.18.592 2.43 2.703c.146.127.4.25.852.25.438 0 .734-.387 1.004-.784.362-.528.816-1.006 1.39-1.086.112-.012.46.132.072.367-.432.265-.864.556-1.116 1.099C16.773 17.147 15.988 18.051 14 17.653v1.12c0 1.245.797 2.315 1.644 2.539C19.364 19.855 22 16.236 22 12c0-5.523-4.477-10-10-10z" />
        </svg>
      </button>
      <Show when={props.open}>
        <div class="board-color-dropdown">
          <label class="board-color-field">
            <span>Color</span>
            <input
              type="color"
              class="board-color-input"
              value={props.currentColor ?? DEFAULT_COLOR}
              onInput={(e) => props.onPreview(e.currentTarget.value)}
              onChange={(e) => props.onSelect(e.currentTarget.value)}
            />
          </label>
          <button class="board-color-reset" onClick={() => props.onSelect(null)}>
            Reset to default
          </button>
        </div>
      </Show>
    </div>
  );
}
