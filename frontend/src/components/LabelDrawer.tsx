import { For, Show, createSignal } from "solid-js";
import type { Label } from "../types";
import { handleMarkdownShortcut } from "../mdInput";

interface Props {
  open: boolean;
  labels: Label[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (labelId: string, name: string) => void;
  onDelete: (labelId: string) => void;
}

function renderLabelName(name: string): string {
  return name
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
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
          <button class="label-drawer-close" onClick={props.onClose} title="Close">
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
              <div class="label-drawer-item">
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
                        innerHTML={renderLabelName(label.name)}
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
