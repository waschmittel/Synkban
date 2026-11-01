import { For, Show, createSignal } from "solid-js";
import type { Label } from "../types";
import { handleMarkdownShortcut } from "../mdInput";
import { renderTitle } from "./Card";
import { tip } from "../platform";

interface Props {
  open: boolean;
  labels: Label[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (labelId: string, name: string) => void;
  onDelete: (labelId: string) => void;
  /// Persist a new label order (full list of ids). Resolves once the board refetched.
  onReorder: (ids: string[]) => Promise<void>;
}

/// Right-side slide-out drawer for board label management. Always rendered
/// (CSS transition relies on `--open` toggle). Backdrop click closes via
/// `onClose`.
export default function LabelDrawer(props: Props) {
  const [newName, setNewName] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingName, setEditingName] = createSignal("");

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const commitEdit = (id: string) => {
    const name = editingName().trim();
    setEditingId(null);
    if (!name) return;
    props.onRename(id, name);
  };

  // --- Reorder (drag & drop + Shift+↑↓) ---
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{ id: string; after: boolean } | null>(null);

  const focusRow = (id: string) =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.label-drawer-item[data-label-id="${id}"]`)?.focus(),
    );

  /// Move `id` before/after `targetId` (or by `delta` steps when no target).
  const moveLabel = async (id: string, targetId: string | null, after: boolean, delta = 0) => {
    const ids = props.labels.map((l) => l.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    ids.splice(from, 1);
    let to: number;
    if (targetId) {
      const t = ids.indexOf(targetId);
      if (t < 0) return;
      to = after ? t + 1 : t;
    } else {
      to = Math.max(0, Math.min(ids.length, from + delta));
    }
    ids.splice(to, 0, id);
    if (ids.every((v, i) => v === props.labels[i].id)) return;
    await props.onReorder(ids);
    focusRow(id);
  };

  const endDrag = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const submitNew = (e: Event) => {
    e.preventDefault();
    const name = newName().trim();
    if (!name) return;
    props.onCreate(name);
    setNewName("");
  };

  return (
    <>
      <div class="label-drawer" classList={{ "label-drawer--open": props.open }}>
        <div class="label-drawer-header">
          <span>Labels</span>
          <button class="label-drawer-close" onClick={props.onClose} title={tip("Close", "Esc")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="label-drawer-list">
          <For
            each={props.labels}
            fallback={<p class="label-drawer-empty">No labels yet. Create one below.</p>}
          >
            {(label) => (
              <div
                class="label-drawer-item"
                classList={{
                  "label-drawer-item--dragging": dragId() === label.id,
                  "label-drawer-item--drop-before":
                    dropTarget()?.id === label.id && !dropTarget()!.after,
                  "label-drawer-item--drop-after":
                    dropTarget()?.id === label.id && dropTarget()!.after,
                }}
                data-label-id={label.id}
                tabindex={editingId() === label.id ? undefined : 0}
                draggable={editingId() !== label.id}
                onDragStart={(e) => {
                  setDragId(label.id);
                  e.dataTransfer!.effectAllowed = "move";
                  e.dataTransfer!.setData("text/plain", label.id);
                }}
                onDragOver={(e) => {
                  if (!dragId()) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropTarget({ id: label.id, after: e.clientY > r.top + r.height / 2 });
                }}
                onDrop={(e) => {
                  const id = dragId();
                  const t = dropTarget();
                  if (!id || !t) return;
                  e.preventDefault();
                  endDrag();
                  if (id !== t.id) void moveLabel(id, t.id, t.after);
                }}
                onDragEnd={endDrag}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.ctrlKey || e.metaKey || e.altKey) return;
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    const dir = e.key === "ArrowUp" ? -1 : 1;
                    if (e.shiftKey) {
                      void moveLabel(label.id, null, false, dir);
                    } else {
                      const rows = [...e.currentTarget.parentElement!.children] as HTMLElement[];
                      rows[rows.indexOf(e.currentTarget) + dir]?.focus();
                    }
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    startEdit(label.id, label.name);
                  }
                }}
              >
                <Show
                  when={editingId() === label.id}
                  fallback={
                    <>
                      <span
                        class="label-drawer-swatch"
                        style={{ "background-color": label.color }}
                      />
                      <span
                        class="label-drawer-name"
                        innerHTML={renderTitle(label.name)}
                        onClick={() => startEdit(label.id, label.name)}
                        title="Click to rename"
                      />
                      <button
                        class="label-drawer-delete"
                        onClick={() => props.onDelete(label.id)}
                        title="Delete label"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </>
                  }
                >
                  <span
                    class="label-drawer-swatch"
                    style={{ "background-color": label.color }}
                  />
                  <input
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    class="label-drawer-edit-input"
                    type="text"
                    value={editingName()}
                    onInput={(e) => setEditingName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      handleMarkdownShortcut(e);
                      if (e.key === "Enter") commitEdit(label.id);
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => commitEdit(label.id)}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>

        <form class="label-drawer-form" onSubmit={submitNew}>
          <input
            type="text"
            placeholder="New label name… (**bold** *italic*)"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => {
              handleMarkdownShortcut(e);
              if (e.key === "Escape") {
                e.stopPropagation();
                props.onClose();
              }
            }}
            class="label-drawer-input"
          />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
      </div>

      <Show when={props.open}>
        <div class="label-drawer-backdrop" onClick={props.onClose} />
      </Show>
    </>
  );
}
