import { For, Show } from "solid-js";

const BOARD_COLORS = [
  "#0079bf", "#026aa7", "#5ba4cf", "#29cce5",
  "#b3d9ff", "#519839", "#4bbf6b", "#d29034",
  "#f5a623", "#eb5a46", "#cd5a91", "#89609e",
  "#172b4d", "#838c91", "#7a6652", "#344563",
];

interface Props {
  open: boolean;
  currentColor?: string;
  onToggle: () => void;
  onSelect: (color: string | null) => void;
}

/// Board color button + grid dropdown. Open state lives in the parent so it
/// can close the dropdown from its own outside-click handler.
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
          <div class="board-color-grid">
            <For each={BOARD_COLORS}>
              {(color) => (
                <button
                  class="board-color-swatch"
                  classList={{ "board-color-swatch--active": props.currentColor === color }}
                  style={{ "background-color": color }}
                  onClick={() => props.onSelect(color)}
                  title={color}
                >
                  <Show when={props.currentColor === color}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <button class="board-color-reset" onClick={() => props.onSelect(null)}>
            Reset to default
          </button>
        </div>
      </Show>
    </div>
  );
}
