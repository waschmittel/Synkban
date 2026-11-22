import { createSignal, For, onCleanup, Show } from "solid-js";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";
import { accelLabel, tip } from "../platform";

/// Where the help was opened; its tab is shown first.
export type HelpContext = "home" | "board" | "notes" | "card" | "editor";

/// The context for the focused element on a board page.
export function helpContextOf(el: Element | null, notes: boolean): HelpContext {
  if (el?.closest(".ProseMirror, .editor-search-bar")) return "editor";
  if (el?.closest(".modal-content")) return "card";
  return notes ? "notes" : "board";
}

interface Props {
  context: HelpContext;
  onClose: () => void;
}

/// One shortcut: alternative chords (each a list of keys) and what it does.
type Row = [chords: string[][], desc: string];
interface Group {
  title: string;
  rows: Row[];
}

const A = accelLabel;
const k = (...keys: string[]) => keys;

/// Whole-board keys, the same in both views.
const BOARD_KEYS: Group = {
  title: "Board",
  rows: [
    [[k("v")], "Switch Board / Notes view"],
    [[k("l")], "Add list"],
    [[k("#label"), k("due:fri")], "In a new card's title: set a label / due date"],
    [[k("g")], "Labels panel"],
    [[k("f")], "Filter cards"],
    [[k("a")], "Archived cards"],
    [[k(","), k("j")], "Previous board"],
    [[k("."), k("k")], "Next board"],
    [[k("b")], "All boards"],
    [[k("?")], "This help"],
  ],
};

/// Panels opened from a board, the same in both views.
const PANEL_KEYS: Group = {
  title: "Filter, labels & archive",
  rows: [
    [[k("Esc")], "Filter: clear it, then close the bar"],
    [[k("↑", "↓")], "Labels / archive: previous / next"],
    [[k("Shift", "↑"), k("Shift", "↓")], "Labels: reorder"],
    [[k("Enter")], "Labels: rename (renaming onto another label merges, after asking)"],
    [[k("Esc")], "Close the panel / cancel the rename"],
  ],
};

export const TABS: { id: HelpContext; label: string; groups: Group[] }[] = [
  {
    id: "home",
    label: "Boards",
    groups: [
      {
        title: "Navigate",
        rows: [
          [[k("↑", "↓", "←", "→")], "Move between boards"],
          [[k("Enter")], "Open board"],
        ],
      },
      {
        title: "Organise",
        rows: [
          [[k("n")], "New board"],
          [[k("Shift", "↑↓←→")], "Reorder board"],
          [[k("Del"), k("⌫")], "Archive board"],
          [[k("a")], "Archived boards"],
          [[k("Esc")], "Close form / archive"],
          [[k("?")], "This help"],
        ],
      },
    ],
  },
  {
    id: "board",
    label: "Board",
    groups: [
      {
        title: "Navigate",
        rows: [
          [[k("↑", "↓")], "Previous / next card (wraps)"],
          [[k("←", "→")], "Neighbouring list"],
          [[k("Home"), k("PgUp")], "First card of the list"],
          [[k("End"), k("PgDn")], "Last card of the list"],
        ],
      },
      {
        title: "Cards & lists",
        rows: [
          [[k("Enter"), k("Space")], "Open card"],
          [[k("e")], "Edit card"],
          [[k("n")], "Add card to this list (Enter adds, Esc cancels)"],
          [[k("Del"), k("⌫")], "Archive card"],
          [[k("c")], "Collapse / expand this list"],
          [[k("Enter")], "On a collapsed list: expand it"],
          [[k("r"), k("F2")], "Rename list (Enter on its title too)"],
        ],
      },
      {
        title: "Move",
        rows: [
          [[k("Shift", "↑"), k("Shift", "↓")], "Card up / down (wraps)"],
          [[k("Shift", "←"), k("Shift", "→")], "Card to the previous / next list"],
          [[k("Shift", "Home"), k("Shift", "End")], "Card to the top / bottom"],
          [[k("Shift", "Alt", "←"), k("Shift", "Alt", "→")], "List left / right"],
        ],
      },
      BOARD_KEYS,
      PANEL_KEYS,
    ],
  },
  {
    id: "notes",
    label: "Notes",
    groups: [
      {
        title: "Navigate",
        rows: [
          [[k("↑", "↓")], "Select card (shown beside the list)"],
          [[k("Home"), k("End")], "First / last card"],
          [[k("←", "→")], "Previous / next list tab"],
          [[k("Enter"), k("e")], "Edit the card's description"],
          [[k("Esc")], "Back to the selected card, from anywhere"],
        ],
      },
      {
        title: "Cards & lists",
        rows: [
          [[k("n")], "Add card"],
          [[k("Shift", "↑"), k("Shift", "↓")], "Card up / down"],
          [[k("Shift", "←"), k("Shift", "→")], "Card to the previous / next list"],
          [[k("Shift", "Alt", "←"), k("Shift", "Alt", "→")], "List (tab) left / right"],
          [[k("Drag")], "Drop a card on a tab to move it there"],
          [[k("Del"), k("⌫")], "Archive card"],
          [[k("r"), k("F2")], "Rename list (or Enter / click on the active tab)"],
        ],
      },
      {
        title: "Editing",
        rows: [
          [[k(A, "S")], "Save, keep editing"],
          [[k("Esc")], "Leave the card (unsaved edits: Save / Discard / Cancel)"],
        ],
      },
      BOARD_KEYS,
      PANEL_KEYS,
    ],
  },
  {
    id: "card",
    label: "Card",
    groups: [
      {
        title: "Card",
        rows: [
          [[k(A, "S")], "Save"],
          [[k("Esc")], "Close (asks about unsaved edits)"],
          [[k(A, "J")], "History (again: close it)"],
          [[k(A, "P")], "Export PDF"],
          [[k("?")], "This help (outside text fields)"],
        ],
      },
      {
        title: "Go to",
        rows: [
          [[k(A, "E")], "Title (Enter: on to the description)"],
          [[k(A, "U")], "Due date"],
          [[k(A, "G")], "Labels"],
          [[k(A, "D")], "Description"],
          [[k(A, "L")], "Checklist"],
          [[k(A, "O")], "Add attachment"],
        ],
      },
      {
        title: "Due date picker",
        rows: [
          [[k("2026-12-01"), k("tomorrow"), k("fri"), k("+3d")], "Type a date, then Enter"],
          [[k("↓")], "From the field into the calendar"],
          [[k("←", "→", "↑", "↓")], "Day / week"],
          [[k("PgUp"), k("PgDn")], "Month (with Shift: year)"],
          [[k("Home"), k("End")], "Start / end of the week"],
          [[k("Enter"), k("Space")], "Pick the day"],
          [[k("Esc")], "Close the picker"],
        ],
      },
      {
        title: "Checklist & attachments",
        rows: [
          [[k("↑", "↓")], "Previous / next item"],
          [[k("Space")], "Check item"],
          [[k("Enter")], "Edit item (Enter saves, Esc cancels) · open attachment"],
          [[k("Shift", "↑"), k("Shift", "↓")], "Reorder item"],
          [[k("Del"), k("⌫")], "Delete item (asks) / attachment"],
          [[k("Enter")], "In “Add item”: add it and stay for the next"],
        ],
      },
      {
        title: "History",
        rows: [
          [[k("↑", "↓")], "Newer / older version"],
          [[k("Home"), k("End")], "Current / oldest version"],
          [[k("PgUp"), k("PgDn")], "Ten versions"],
        ],
      },
    ],
  },
  {
    id: "editor",
    label: "Editor",
    groups: [
      {
        title: "Text",
        rows: [
          [[k(A, "B")], "Bold"],
          [[k(A, "I")], "Italic"],
          [[k(A, "`")], "Inline code"],
          [[k(A, "Z")], "Undo"],
          [[k(A, "Shift", "Z"), k(A, "Y")], "Redo"],
          [[k("Shift", "Enter"), k(A, "Enter")], "Line break (code block: exit below)"],
          [[k(A, "Enter")], "In a Lua block: run it (Shift+Enter exits below)"],
          [[k(A, "Enter")], "At a footnote reference or definition: jump to footnote / back"],
          [[k(A, "K"), k("Right-click")], "Editor menu: link, code, highlight, image, footnote, style, table, alert"],
          [[k("Esc")], "Close the menu / search bar, else leave the card"],
        ],
      },
      {
        title: "Find & replace",
        rows: [
          [[k(A, "F")], "Find in description"],
          [[k(A, "Shift", "H")], "Find and replace in description"],
          [[k("Enter"), k("Shift", "Enter")], "In Find: next / previous match"],
          [[k("Enter")], "In Replace: replace active match and advance"],
          [[k(A, "Enter")], "In Replace: replace all matches (one Undo step)"],
          [[k("Esc")], "Close search bar and return to the active match"],
        ],
      },
      {
        title: "Text styles",
        rows: [
          [[k("Ctrl", "Shift", "0")], "Plain text"],
          [[k("Ctrl", "Shift", "1", "2", "3")], "Heading 1–3"],
          [[k("Ctrl", "Shift", "\\")], "Code block"],
          [[k("Ctrl", ">")], "Quote"],
          [[k("Alt", "↑"), k("Alt", "↓")], "Join with the block above / below"],
          [[k("↑"), k("↓")], "Past a block's edge (or click outside): cursor before / after"],
          [[k("Enter")], "In a code / Lua block on a blank trailing line: exit below"],
          [[k("⌫")], "In an empty code / Lua block: turn into plain text"],
          [[k("Tab"), k("Shift", "Tab")], "In a code / Lua block: indent / unindent line(s)"],
          [[k("Tab"), k("Enter"), k("Esc")], "In a Lua block: accept / close autocomplete"],
        ],
      },
      {
        title: "While typing",
        rows: [
          [[k("#"), k("##"), k("###")], "+ Space at a line start: heading"],
          [[k("-"), k("*")], "+ Space: bulleted list"],
          [[k("1.")], "+ Space: numbered list"],
          [[k(">")], "+ Space: quote"],
          [[k("```")], "Code block"],
          [[k("```lua")], "+ Space / Enter: Lua block"],
          [[k("⌫")], "Right after one of these: undo it"],
        ],
      },
      {
        title: "Lists",
        rows: [
          [[k("Tab"), k(A, "]")], "Nest item"],
          [[k("Shift", "Tab"), k(A, "[")], "Outdent item"],
          [[k("Enter")], "New item (empty: end the list)"],
          [[k("Ctrl", "Shift", "8")], "Bulleted list (or convert numbered list)"],
          [[k("Ctrl", "Shift", "9")], "Numbered list (or convert bulleted list)"],
        ],
      },
      {
        title: "In the menu",
        rows: [
          [[k("↑", "↓"), k("Enter")], "Highlight an item, run it"],
          [[k("L"), k("U")], "Add/edit link, remove link"],
          [[k("I"), k("H"), k("G")], "Inline code, toggle highlight (last color), choose highlight color (1–8 / 0)"],
          [[k("M"), k("F")], "Insert image, insert/jump footnote"],
          [[k("D")], "Delete footnote (when inside a footnote)"],
          [[k("0"), k("B"), k("E"), k("1", "2", "3")], "Plain, code block, Lua block, heading 1–3"],
          [[k("T"), k("X"), k("A")], "Insert table, insert matrix, insert/change alert (N/T/I/W/C, X remove)"],
          [[k("C")], "Convert between bullet and ordered list (when inside a list)"],
          [[k("Shift", "P"), k("P")], "Insert paragraph above / below block"],
        ],
      },
      {
        title: "Tables & matrices",
        rows: [
          [[k("Tab"), k("Shift", "Tab")], "Next / previous cell (last cell adds a row)"],
          [[k("Enter")], "Next row (last row: leave the table)"],
          [[k("Shift", "Enter")], "Line break in the cell"],
          [[k("W", "S", "A", "D")], "Menu: move row / column"],
          [[k("X")], "Menu: transpose matrix"],
          [[k("Shift", "↑↓←→")], "Menu: insert row / column"],
          [[k("1", "2", "3")], "Menu: align column (matrix: cell)"],
          [[k("R", "C", "T")], "Menu: delete row / column / table"],
        ],
      },
    ],
  },
];

function Keys(props: { chords: string[][] }) {
  return (
    <span class="shortcut-keys">
      <For each={props.chords}>
        {(chord, i) => (
          <>
            {i() > 0 && <span class="shortcut-or">or</span>}
            <span class="shortcut-chord">
              <For each={chord}>{(key) => <kbd>{key}</kbd>}</For>
            </span>
          </>
        )}
      </For>
    </span>
  );
}

/// Shortcut reference in tabs, opened on the tab for where the user is.
/// ←/→ (or 1–5) switch tabs; ? or Esc close.
export default function ShortcutHelp(props: Props) {
  const [tab, setTab] = createSignal(props.context);
  const index = () => TABS.findIndex((t) => t.id === tab());
  const current = () => TABS[index()];
  let tabsEl!: HTMLDivElement;

  const select = (i: number) => {
    setTab(TABS[(i + TABS.length) % TABS.length].id);
    if (tabsEl.contains(document.activeElement)) tabsEl.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };

  // Back to where the user was (a card, the editor) once it closes.
  const before = document.activeElement as HTMLElement | null;
  onCleanup(() => queueMicrotask(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost && before?.isConnected) before.focus();
  }));

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  // Owned via dialogKeys so the keys work even while focus is still on the
  // element behind the overlay (the help never auto-focuses anything).
  onCleanup(
    dialogKeys((e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (e.key === "Escape" || e.key === "?") props.onClose();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") select(index() + (e.key === "ArrowLeft" ? -1 : 1));
      else if (n >= 1 && n <= TABS.length) select(n - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    }),
  );

  return (
    <div class="dialog-overlay shortcut-help-overlay" ref={(el) => onCleanup(focusTrap(el))} onClick={handleOverlayClick}>
      <div class="dialog-surface shortcut-help-modal" role="dialog" aria-label="Keyboard shortcuts">
        <div class="shortcut-help-header">
          <h3>Keyboard shortcuts</h3>
          <div
            class="shortcut-tabs"
            role="tablist"
            ref={(el) => {
              tabsEl = el;
              // Start on the current tab (the trap would pick the first one).
              requestAnimationFrame(() => el.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
            }}
          >
            <For each={TABS}>
              {(t, i) => (
                <button
                  class="shortcut-tab"
                  role="tab"
                  aria-selected={tab() === t.id}
                  tabindex={tab() === t.id ? 0 : -1}
                  data-tab={t.id}
                  title={tip(t.label, String(i() + 1))}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  <Show when={t.id === props.context}>
                    <span class="shortcut-tab-here" title="Where you are">●</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <button class="btn-close shortcut-help-close" onClick={props.onClose} title={tip("Close", "Esc")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="shortcut-help-body" role="tabpanel" data-tab={tab()}>
          <For each={current().groups}>
            {(g) => (
              <section class="shortcut-section">
                <h4 class="shortcut-section-title">{g.title}</h4>
                <For each={g.rows}>
                  {([chords, desc]) => (
                    <div class="shortcut-row">
                      <span class="shortcut-desc">{desc}</span>
                      <Keys chords={chords} />
                    </div>
                  )}
                </For>
              </section>
            )}
          </For>
        </div>
        <div class="shortcut-help-footer">
          <span>
            <kbd>←</kbd> <kbd>→</kbd> switch tabs · <kbd>?</kbd> or <kbd>Esc</kbd> close
          </span>
          <span>Synkban {__APP_VERSION__}</span>
        </div>
      </div>
    </div>
  );
}
