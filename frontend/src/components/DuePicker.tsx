import { createSignal, For, onCleanup, onMount } from "solid-js";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";
import { closeActiveFloatingPopup, hidePopoverSafe, positionFloating, showPopoverSafe } from "../floatingPopup";
import { onOverlayOpen } from "../overlayLayers";
import { hasAccel } from "../platform";
import { addDays, addMonths, daysBetween, firstDayOfWeek, monthGrid, parseDueInput, parseIso, toIso } from "../dueDate";

interface Props {
  value: string;
  /// The chip it opens from: placement and focus on close.
  anchor: HTMLElement;
  onPick: (iso: string) => void;
  onClose: () => void;
}

/// Calendar popover for the due date. Opens on the text field: type
/// `2026-12-01`, `tomorrow`, `+3d`, `+2w` and Enter, or ↓ into the month grid
/// (arrows ±day/week, PgUp/PgDn ±month, Shift ±year, Home/End week,
/// Enter picks). Esc closes; focus returns to the chip.
export default function DuePicker(props: Props) {
  let root!: HTMLDivElement;
  let input!: HTMLInputElement;
  let grid!: HTMLDivElement;
  const today = new Date();
  const initial = parseIso(props.value) ?? today;
  const [cursor, setCursor] = createSignal(initial);
  const [text, setText] = createSignal(props.value);
  const [invalid, setInvalid] = createSignal(false);
  const firstDay = firstDayOfWeek();
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + firstDay + i).toLocaleDateString(undefined, { weekday: "narrow" }),
  );
  const days = () => monthGrid(cursor(), firstDay);
  const sameDay = (a: Date, b: Date) => daysBetween(a, b) === 0;

  const close = () => {
    props.onClose();
    props.anchor.focus();
  };
  const pick = (iso: string) => {
    props.onPick(iso);
    close();
  };

  const focusCursor = () =>
    queueMicrotask(() => grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
  const moveTo = (d: Date) => {
    setCursor(d);
    focusCursor();
  };

  const commitText = () => {
    if (!text().trim()) return pick("");
    const iso = parseDueInput(text(), today);
    if (iso) pick(iso);
    else setInvalid(true);
  };

  const gridKey = (e: KeyboardEvent): boolean => {
    const c = cursor();
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(c, -1),
      ArrowRight: () => addDays(c, 1),
      ArrowUp: () => addDays(c, -7),
      ArrowDown: () => addDays(c, 7),
      PageUp: () => addMonths(c, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(c, e.shiftKey ? 12 : 1),
      Home: () => addDays(c, -((c.getDay() - firstDay + 7) % 7)),
      End: () => addDays(c, 6 - ((c.getDay() - firstDay + 7) % 7)),
    };
    if (step[e.key]) {
      moveTo(step[e.key]());
      return true;
    }
    if (e.key === "Enter" || e.key === " ") {
      pick(toIso(c));
      return true;
    }
    return false;
  };

  const reposition = () => positionFloating(root, props.anchor);

  onMount(() => {
    closeActiveFloatingPopup();
    showPopoverSafe(root);
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    onCleanup(() => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      hidePopoverSafe(root);
    });
    input.focus();
    input.select();
  });

  onCleanup(onOverlayOpen((el) => { if (el !== root) props.onClose(); }));

  // Document capture: the picker owns these keys before the card/board do.
  onCleanup(
    dialogKeys((e) => {
      const t = e.target as Node;
      // A card shortcut (Accel+S, +G, …) closes the picker and goes on to the card.
      // (Re-sent from the chip: closing detaches this event's target.)
      if (hasAccel(e) && !"acvxzy".includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        props.anchor.focus();
        props.anchor.dispatchEvent(new KeyboardEvent("keydown", e));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (grid.contains(t) && !e.metaKey && !e.ctrlKey && !e.altKey && gridKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      } else if (t === input && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitText();
      } else if (t === input && e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        focusCursor();
      }
    }),
  );

  const onDocDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node) && !props.anchor.contains(e.target as Node)) props.onClose();
  };
  document.addEventListener("pointerdown", onDocDown, true);
  onCleanup(() => document.removeEventListener("pointerdown", onDocDown, true));

  const quick = (label: string, d: Date) => (
    <button type="button" class="due-picker-quick" onClick={() => pick(toIso(d))}>
      {label}
    </button>
  );

  return (
      <div
        class="due-picker"
        popover="manual"
        role="dialog"
        aria-label="Due date"
        ref={(el) => {
          root = el;
          onCleanup(focusTrap(el));
        }}
      >
        <input
          ref={input}
          class="due-picker-input"
          classList={{ "due-picker-input--invalid": invalid() }}
          aria-invalid={invalid()}
          type="text"
          placeholder="YYYY-MM-DD, tomorrow, +3d"
          title="A date (YYYY-MM-DD), today, tomorrow, or +3d / +2w · Enter to set · ↓ calendar"
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setInvalid(false);
            const iso = parseDueInput(e.currentTarget.value, today);
            if (iso) setCursor(parseIso(iso)!);
          }}
        />
        <div class="due-picker-head">
          <button type="button" class="due-picker-nav" title="Previous month (PgUp)" aria-label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))}>
            ‹
          </button>
          <span class="due-picker-month" aria-live="polite">
            {cursor().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button type="button" class="due-picker-nav" title="Next month (PgDn)" aria-label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))}>
            ›
          </button>
        </div>
        <div class="due-picker-grid" role="grid" ref={grid}>
          <For each={weekdays}>{(w) => <span class="due-picker-wd" aria-hidden="true">{w}</span>}</For>
          <For each={days()}>
            {(d) => (
              <button
                type="button"
                class="due-picker-day"
                classList={{
                  "due-picker-day--out": d.getMonth() !== cursor().getMonth(),
                  "due-picker-day--today": sameDay(d, today),
                  "due-picker-day--selected": props.value === toIso(d),
                }}
                role="gridcell"
                aria-selected={props.value === toIso(d)}
                aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                data-date={toIso(d)}
                tabindex={sameDay(d, cursor()) ? 0 : -1}
                onClick={() => pick(toIso(d))}
              >
                {d.getDate()}
              </button>
            )}
          </For>
        </div>
        <div class="due-picker-foot">
          {quick("Today", today)}
          {quick("Tomorrow", addDays(today, 1))}
          {quick("Next week", addDays(today, 7))}
          <button type="button" class="due-picker-quick due-picker-clear" disabled={!props.value} onClick={() => pick("")}>
            Clear
          </button>
        </div>
      </div>
  );
}
