import { createEffect, createSignal, on, Show } from "solid-js";
import type { SearchState } from "../editorSearch";
import { accel, accelShift, hasAccel, tip } from "../platform";

interface Props {
  state: SearchState;
  /// Incremented whenever the user presses Find / Replace shortcuts so the
  /// appropriate input regains focus even if the bar was already open.
  focusRequest: { seq: number; target: "find" | "replace" };
  onQueryChange: (query: string) => void;
  onToggleCase: () => void;
  onToggleRegex: () => void;
  onToggleReplace: () => void;
  onStep: (delta: 1 | -1) => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onClose: () => void;
}

/// Collapsible Find & Replace bar docked under the description editor's
/// menubar (ADR-0029). Lives inside `.editor-wrapper` so CardDetail's focus
/// trap covers it without an extra overlay layer.
export default function EditorSearchBar(props: Props) {
  const [replacement, setReplacement] = createSignal("");
  let findInputRef: HTMLInputElement | undefined;
  let replaceInputRef: HTMLInputElement | undefined;

  // Focus & select ONLY on explicit open/shortcut requests — never on search
  // state updates while typing (tracking props.state here would re-select the
  // input after every keystroke).
  createEffect(
    on(
      () => props.focusRequest,
      (req) => {
        if (!props.state.open || req.seq === 0) return;
        requestAnimationFrame(() => {
          const target =
            req.target === "replace" && props.state.replaceOpen && props.state.query
              ? replaceInputRef
              : findInputRef;
          target?.focus();
          target?.select();
        });
      },
    ),
  );

  // Sync external query changes (e.g. pre-fill from editor selection) without
  // overwriting the DOM value while the user is typing/editing mid-string.
  createEffect(() => {
    const q = props.state.query;
    if (props.state.open && findInputRef && findInputRef.value !== q) {
      findInputRef.value = q;
    }
  });

  const hasMatches = () => props.state.matches.length > 0 && !props.state.regexError;
  const statusText = () => {
    if (props.state.regexError) return "Invalid";
    if (!props.state.query) return "";
    if (!props.state.matches.length) return "No matches";
    return `${props.state.activeIndex + 1} of ${props.state.matches.length}`;
  };

  const handleFindKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      props.onStep(e.shiftKey ? -1 : 1);
    }
  };

  const handleReplaceKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (e.key === "Enter" && hasAccel(e)) {
      e.preventDefault();
      props.onReplaceAll(replacement());
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      props.onReplace(replacement());
    }
  };

  return (
    <Show when={props.state.open}>
      <div class="editor-search-bar" role="search" aria-label="Find in description">
        <div class="editor-search-row">
          <button
            type="button"
            class="editor-search-icon-btn editor-search-expand"
            classList={{ "editor-search-expand--open": props.state.replaceOpen }}
            aria-expanded={props.state.replaceOpen}
            aria-label="Toggle replace"
            title={tip("Toggle replace", accelShift("H"))}
            onClick={() => props.onToggleReplace()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <div
            class="editor-search-input-wrap"
            classList={{ "editor-search-input-wrap--error": !!props.state.regexError }}
          >
            <input
              ref={(el) => {
                findInputRef = el;
                el.value = props.state.query;
              }}
              type="text"
              class="editor-search-input editor-search-find-input"
              placeholder="Find in description…"
              aria-label="Find in description"
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => props.onQueryChange(e.currentTarget.value)}
              onKeyDown={handleFindKeyDown}
            />
            <div class="editor-search-toggles">
              <button
                type="button"
                class="editor-search-toggle editor-search-case"
                aria-pressed={props.state.caseSensitive}
                title="Match case"
                onClick={() => {
                  props.onToggleCase();
                  findInputRef?.focus();
                }}
              >
                Aa
              </button>
              <button
                type="button"
                class="editor-search-toggle editor-search-regex"
                aria-pressed={props.state.regex}
                title="Use regular expression"
                onClick={() => {
                  props.onToggleRegex();
                  findInputRef?.focus();
                }}
              >
                .*
              </button>
            </div>
          </div>

          <span
            class="editor-search-status"
            classList={{ "editor-search-status--error": !!props.state.regexError }}
            aria-live="polite"
          >
            {statusText()}
          </span>

          <div class="editor-search-nav">
            <button
              type="button"
              class="editor-search-icon-btn editor-search-prev"
              disabled={!hasMatches()}
              aria-label="Previous match"
              title={tip("Previous match", "Shift+Enter")}
              onClick={() => props.onStep(-1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              type="button"
              class="editor-search-icon-btn editor-search-next"
              disabled={!hasMatches()}
              aria-label="Next match"
              title={tip("Next match", "Enter")}
              onClick={() => props.onStep(1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              type="button"
              class="editor-search-icon-btn editor-search-close"
              aria-label="Close search"
              title={tip("Close search", "Esc")}
              onClick={() => props.onClose()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <Show when={props.state.replaceOpen}>
          <div class="editor-replace-row">
            <div class="editor-search-input-wrap">
              <input
                ref={(el) => (replaceInputRef = el)}
                type="text"
                class="editor-search-input editor-search-replace-input"
                placeholder={props.state.regex ? "Replace with… ($1, $&)" : "Replace with…"}
                aria-label="Replace with"
                autocomplete="off"
                spellcheck={false}
                value={replacement()}
                onInput={(e) => setReplacement(e.currentTarget.value)}
                onKeyDown={handleReplaceKeyDown}
              />
            </div>
            <div class="editor-replace-actions">
              <button
                type="button"
                class="editor-search-action editor-search-replace-btn"
                disabled={!hasMatches()}
                title={tip("Replace", "Enter")}
                onClick={() => props.onReplace(replacement())}
              >
                Replace
              </button>
              <button
                type="button"
                class="editor-search-action editor-search-replace-all-btn"
                disabled={!hasMatches()}
                title={tip("Replace all", accel("Enter"))}
                onClick={() => props.onReplaceAll(replacement())}
              >
                Replace all
              </button>
            </div>
          </div>
        </Show>

        <Show when={props.state.regexError}>
          {(err) => (
            <div class="editor-search-error" role="alert">
              Invalid regex: {err()}
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}
