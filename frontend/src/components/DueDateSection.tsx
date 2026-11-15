import { createSignal, Show } from "solid-js";
import { accel, tip } from "../platform";
import { dueInfo } from "../dueDate";
import DetailRow from "./DetailRow";
import DuePicker from "./DuePicker";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /// Exposes "open the picker" for the card's Accel+U.
  openRef?: (open: () => void) => void;
}

/// The due date as a chip worded like the card badge (relative within a
/// week, the date always); click or Enter opens `DuePicker`.
export default function DueDateSection(props: Props) {
  let chip!: HTMLButtonElement;
  const [open, setOpen] = createSignal(false);
  const info = () => dueInfo(props.value);
  props.openRef?.(() => setOpen(true));

  return (
    <DetailRow
      class="due-date-area"
      title={tip("Due date", accel("U"))}
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      }
    >
      <div class="due-field">
        <button
          ref={chip}
          type="button"
          class={`due-chip due-chip--${info()?.tone ?? "none"}`}
          aria-haspopup="dialog"
          aria-expanded={open()}
          title={tip(info() ? `Due ${props.value} · change` : "Set due date", accel("U"))}
          onClick={() => setOpen((v) => !v)}
        >
          {info()?.long ?? "Set due date"}
        </button>
        <Show when={props.value}>
          <button
            type="button"
            class="due-date-clear"
            onClick={() => {
              props.onChange("");
              chip.focus();
            }}
            title="Clear due date"
            aria-label="Clear due date"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Show>
      </div>
      <Show when={open()}>
        <DuePicker value={props.value} anchor={chip} onPick={props.onChange} onClose={() => setOpen(false)} />
      </Show>
    </DetailRow>
  );
}
