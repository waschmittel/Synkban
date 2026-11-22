import { createMemo, For, Show } from "solid-js";
import type { Label } from "../types";
import { parseQuickAdd } from "../quickAdd";
import { dueInfo } from "../dueDate";
import { renderTitle } from "./Card";
import { labelTextColor } from "../colorContrast";

/// What a quick-add title will set: labels (new ones marked), due date.
export default function QuickAddPreview(props: { text: string; labels: Label[] }) {
  const q = createMemo(() => {
    const q = parseQuickAdd(props.text, props.labels);
    return q.labels.length || q.newLabels.length || q.due ? q : null;
  });
  return (
    <Show when={q()}>
      {(q) => (
        <div class="quick-add-preview" aria-live="polite">
          <For each={q().labels}>
            {(l) => (
              <span
                class="card-label-chip"
                style={{ "background-color": l.color, color: labelTextColor(l.color) }}
                innerHTML={renderTitle(l.name)}
              />
            )}
          </For>
          <For each={q().newLabels}>
            {(n) => (
              <span class="card-label-chip quick-add-new" title="New label">
                + {n}
              </span>
            )}
          </For>
          <Show when={q().due}>
            {(d) => {
              const info = () => dueInfo(d())!;
              return <span class={`due-badge due-badge--${info().tone}`}>{info().long}</span>;
            }}
          </Show>
          <Show when={!q().title}>
            <span class="quick-add-missing">Needs a title</span>
          </Show>
        </div>
      )}
    </Show>
  );
}
