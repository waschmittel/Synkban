import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { CardContent, Label } from "../types";
import { api } from "../api";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";
import { hasAccel } from "../platform";
import {
  checklistLines, descriptionLines, diffLines, diffSets, hasChanges,
  type DiffLine,
} from "../diff";

interface Props {
  cardId: string;
  boardLabels: Label[];
  onClose: () => void;
}

/// `at` is a UTC `YYYY-MM-DD HH:MM:SS` string; show it in the user's locale.
function formatAt(at: string): string {
  const d = new Date(at.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? at : d.toLocaleString();
}

function Lines(props: { lines: DiffLine[]; empty: string }) {
  return (
    <Show
      when={props.lines.length > 0}
      fallback={<div class="history-empty-field">{props.empty}</div>}
    >
      <div class="history-lines">
        <For each={props.lines}>
          {(l) => (
            <div class={`history-line history-line--${l.kind}`}>
              <span class="history-line-sign">
                {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : ""}
              </span>
              <span class="history-line-text">{l.text || " "}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function Field(props: { name: string; lines: DiffLine[]; empty: string }) {
  const changed = () => hasChanges(props.lines);
  return (
    <section class="history-field" classList={{ "history-field--changed": changed() }}>
      <h4 class="history-field-title">
        {props.name}
        <span class="history-field-state">{changed() ? "changed" : "unchanged"}</span>
      </h4>
      <Lines lines={props.lines} empty={props.empty} />
    </section>
  );
}

/// Two-pane card history: versions newest-first on the left, and on the right
/// what changed between the selected version and the card as it is now
/// (removed = only in the selected version, added = only in the current one).
export default function HistoryDialog(props: Props) {
  const [history] = createResource(() => props.cardId, (id) => api.getCardHistory(id));
  const [picked, setPicked] = createSignal<number | null>(null);
  let listRef: HTMLDivElement | undefined;

  const entries = () => (history.error ? [] : history()?.entries ?? []);
  // Default to the previous version: index 0 is the current one (empty diff).
  const selected = () => {
    const n = entries().length;
    return Math.min(picked() ?? (n > 1 ? 1 : 0), Math.max(n - 1, 0));
  };

  const select = (i: number, focus = false) => {
    setPicked(i);
    if (focus) {
      const el = listRef?.querySelectorAll<HTMLElement>(".history-item")[i];
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    }
  };

  const labelName = (id: string) =>
    props.boardLabels.find((l) => l.id === id)?.name ?? "(deleted label)";

  const diff = createMemo(() => {
    const h = history();
    const old: CardContent | undefined = entries()[selected()];
    if (!h || !old) return null;
    const cur = h.current;
    return {
      title: diffLines([old.title], [cur.title]),
      labels: diffSets(old.label_ids, cur.label_ids).map((l) => ({ ...l, text: labelName(l.text) })),
      due: diffLines(old.due_date ? [old.due_date] : [], cur.due_date ? [cur.due_date] : []),
      description: diffLines(descriptionLines(old.description), descriptionLines(cur.description)),
      checklist: diffLines(checklistLines(old.checklist), checklistLines(cur.checklist)),
      attachments: diffSets(old.attachments, cur.attachments),
    };
  });

  // Owned via dialogKeys so the keys work before focus lands in the dialog and
  // never reach the card modal underneath.
  onCleanup(
    dialogKeys((e) => {
      // Accel+J is the key that opened the dialog, so it also closes it.
      if (e.key === "Escape" || (hasAccel(e) && e.key.toLowerCase() === "j")) {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = entries().length;
      if (n === 0) return;
      // ↓ goes to an older version (the list is newest first); Home/End jump
      // to the current and the oldest; PageUp/PageDown move ten at a time.
      const target: Record<string, number> = {
        ArrowDown: selected() + 1,
        ArrowUp: selected() - 1,
        PageDown: selected() + 10,
        PageUp: selected() - 10,
        Home: 0,
        End: n - 1,
      };
      if (e.key in target) {
        e.preventDefault();
        e.stopPropagation();
        select(Math.max(0, Math.min(n - 1, target[e.key])), true);
      }
    })
  );

  return (
    <div
      class="history-overlay"
      ref={(el) => onCleanup(focusTrap(el))}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div class="history-dialog" role="dialog" aria-label="Card history">
        <div class="history-header">
          <h3>Card history</h3>
          <span class="history-hint">Showing changes from the selected version to now</span>
          <button class="shortcut-help-close" onClick={props.onClose} title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <Show when={!history.loading} fallback={<div class="history-message">Loading…</div>}>
          <Show
            when={!history.error}
            fallback={<div class="history-message">Could not load history.</div>}
          >
            <Show
              when={entries().length > 0}
              fallback={<div class="history-message">No changes recorded yet.</div>}
            >
              <div class="history-body">
                <div class="history-list" ref={listRef} role="listbox" aria-label="Versions">
                  <For each={entries()}>
                    {(entry, i) => (
                      <button
                        class="history-item"
                        classList={{ "history-item--selected": selected() === i() }}
                        role="option"
                        aria-selected={selected() === i()}
                        onClick={() => select(i())}
                        ref={(el) => {
                          if (selected() === i()) requestAnimationFrame(() => el.focus());
                        }}
                      >
                        <span class="history-item-time">{formatAt(entry.at)}</span>
                        <Show when={i() === 0}>
                          <span class="history-item-badge">Current</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
                <div class="history-detail">
                  <Show when={diff()}>
                    {(d) => (
                      <>
                        <Show when={selected() === 0}>
                          <div class="history-note">This is the current version.</div>
                        </Show>
                        <Field name="Title" lines={d().title} empty="(empty)" />
                        <Field name="Labels" lines={d().labels} empty="No labels" />
                        <Field name="Due date" lines={d().due} empty="No due date" />
                        <Field name="Description" lines={d().description} empty="(empty)" />
                        <Field name="Checklist" lines={d().checklist} empty="No items" />
                        <Field name="Attachments" lines={d().attachments} empty="No attachments" />
                      </>
                    )}
                  </Show>
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
