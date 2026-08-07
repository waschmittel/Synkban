import { createSignal, Show } from "solid-js";

interface Props {
  placeholder: string;
  buttonText: string;
  onAdd: (value: string) => void;
  draftKey?: string;
}

// Every board refetch hands <For> a fresh payload, so the list rows — and this
// component with them — are torn down and re-created mid-typing. The draft
// text, the open state and the caret all have to outlive that, which is why
// they live in module scope keyed by `draftKey` rather than in the instance.
const drafts = new Map<string, string>();
const openForms = new Set<string>();
// Form whose input holds the caret. Only cleared when focus demonstrably moved
// to another live element: a re-render removes the focused input without firing
// a reliable blur, and that case is exactly the one we need to remember.
let focusedKey: string | null = null;

export default function AddForm(props: Props) {
  const readDraft = () => (props.draftKey ? drafts.get(props.draftKey) ?? "" : "");
  const writeDraft = (v: string) => {
    if (!props.draftKey) return;
    if (v) drafts.set(props.draftKey, v);
    else drafts.delete(props.draftKey);
  };

  const markOpen = (open: boolean) => {
    if (!props.draftKey) return;
    if (open) openForms.add(props.draftKey);
    else openForms.delete(props.draftKey);
  };

  const [active, setActive] = createSignal(!!props.draftKey && openForms.has(props.draftKey));
  const [value, setValue] = createSignal(readDraft());
  let openedByUser = false;

  const updateValue = (v: string) => {
    setValue(v);
    writeDraft(v);
  };

  const open = () => {
    openedByUser = true;
    setValue(readDraft());
    setActive(true);
    markOpen(true);
  };

  // Cancel keeps the draft so reopening the form restores the text.
  const close = () => {
    setActive(false);
    markOpen(false);
    if (focusedKey === props.draftKey) focusedKey = null;
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const v = value().trim();
    if (!v) return;
    props.onAdd(v);
    updateValue("");
    close();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const focusRef = (el: HTMLInputElement) => {
    const byUser = openedByUser;
    openedByUser = false;
    const reclaim = !!props.draftKey && focusedKey === props.draftKey;
    if (!byUser && !reclaim) return;
    requestAnimationFrame(() => {
      // A re-created form only takes the caret back if nothing else claimed it
      // first — a card that was focused before the refetch gets restored too,
      // and it was there before this form was.
      if (!byUser && document.activeElement !== document.body) return;
      el.focus();
    });
  };

  const handleBlur = () => {
    queueMicrotask(() => {
      const next = document.activeElement;
      if (next && next !== document.body) focusedKey = null;
    });
  };

  return (
    <Show
      when={active()}
      fallback={
        <button class="add-trigger" onClick={open}>
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
          onInput={(e) => updateValue(e.currentTarget.value)}
          onFocus={() => { focusedKey = props.draftKey ?? null; }}
          onBlur={handleBlur}
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
