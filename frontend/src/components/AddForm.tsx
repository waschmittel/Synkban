import { createSignal, Show } from "solid-js";

interface Props {
  placeholder: string;
  buttonText: string;
  onAdd: (value: string) => void;
}

export default function AddForm(props: Props) {
  const [active, setActive] = createSignal(false);
  const [value, setValue] = createSignal("");

  const close = () => {
    setActive(false);
    setValue("");
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const v = value().trim();
    if (!v) return;
    props.onAdd(v);
    setValue("");
    setActive(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const focusRef = (el: HTMLInputElement) => {
    requestAnimationFrame(() => el.focus());
  };

  return (
    <Show
      when={active()}
      fallback={
        <button class="add-trigger" onClick={() => setActive(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{props.buttonText}</span>
        </button>
      }
    >
      <form class="add-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
        <input
          ref={focusRef}
          type="text"
          placeholder={props.placeholder}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
        />
        <div class="add-form-actions">
          <button type="submit" class="btn btn-primary">
            Add
          </button>
          <button type="button" class="btn btn-icon" onClick={close} title="Cancel (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </form>
    </Show>
  );
}
