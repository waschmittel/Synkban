import { createResource, createSignal, onCleanup, Show } from "solid-js";
import { api } from "../api";
import type { Theme, UpdateSettingsPayload } from "../types";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";
import { desktopBridge } from "../settings";
import { applyTheme } from "../theme";

interface Props {
  onClose: () => void;
}

/// All edits are buffered locally; nothing persists until Save. Cancel,
/// Escape, X, and overlay click all discard. Saving a data-dir change on
/// desktop relaunches the whole app (the backend reads its dir at spawn).
export default function SettingsDialog(props: Props) {
  const desktop = desktopBridge();
  const [settings] = createResource(() => api.getSettings());

  // Staged edits: null = untouched, otherwise the pending value.
  const [stagedStartup, setStagedStartup] = createSignal<"overview" | "last" | null>(null);
  const [stagedTheme, setStagedTheme] = createSignal<Theme | null>(null);
  // undefined = untouched, string = new custom dir, null = revert to default.
  const [stagedDataDir, setStagedDataDir] = createSignal<string | null | undefined>(undefined);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const startupView = () => stagedStartup() ?? settings()?.startup_view ?? "overview";
  const theme = () => stagedTheme() ?? settings()?.theme ?? "system";

  // Theme is previewed live (applied to <html> on selection), so a discarded
  // dialog must roll the preview back to the persisted value.
  const previewTheme = (t: Theme) => {
    setStagedTheme(t);
    applyTheme(t);
  };
  const revertThemePreview = () => {
    const s = settings();
    if (s && stagedTheme() !== null && stagedTheme() !== s.theme) applyTheme(s.theme);
  };
  const dataDir = () => {
    const s = settings();
    if (!s) return "";
    const staged = stagedDataDir();
    if (staged === undefined) return s.data_dir;
    return staged ?? s.default_data_dir;
  };
  const dataDirChanged = () => settings() !== undefined && dataDir() !== settings()!.data_dir;
  const dirty = () =>
    settings() !== undefined &&
    (startupView() !== settings()!.startup_view ||
      theme() !== settings()!.theme ||
      dataDirChanged());

  // All close paths (Cancel, X, overlay click, Escape) discard staged edits.
  const close = () => {
    revertThemePreview();
    props.onClose();
  };

  const browse = async () => {
    if (!desktop) return;
    const dir = await desktop.pickDataDir(dataDir());
    if (dir) setStagedDataDir(dir);
  };

  const save = async () => {
    const s = settings();
    if (!s || saving()) return;
    if (!dirty()) {
      props.onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: UpdateSettingsPayload = {};
      if (startupView() !== s.startup_view) payload.startup_view = startupView();
      if (theme() !== s.theme) payload.theme = theme();
      if (dataDirChanged()) payload.data_dir = stagedDataDir() ?? null;
      await api.updateSettings(payload);
      // Preview already applied the theme; keep it (do not revert on close).
      applyTheme(theme());
      if (dataDirChanged() && desktop) {
        desktop.relaunch();
        return; // app is going down; keep the dialog as-is
      }
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saving failed");
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  onCleanup(
    dialogKeys((e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    })
  );

  const StartupChoice = (p: {
    value: "overview" | "last";
    title: string;
    desc: string;
  }) => (
    <label
      class="settings-choice"
      classList={{ "settings-choice--selected": startupView() === p.value }}
    >
      <input
        type="radio"
        name="startup-view"
        checked={startupView() === p.value}
        onChange={() => setStagedStartup(p.value)}
      />
      <span class="settings-choice-text">
        <span class="settings-choice-title">{p.title}</span>
        <span class="settings-choice-desc">{p.desc}</span>
      </span>
    </label>
  );

  const ThemeChoice = (p: { value: Theme; title: string; desc: string }) => (
    <label
      class="settings-choice"
      classList={{ "settings-choice--selected": theme() === p.value }}
    >
      <input
        type="radio"
        name="theme-mode"
        checked={theme() === p.value}
        onChange={() => previewTheme(p.value)}
      />
      <span class="settings-choice-text">
        <span class="settings-choice-title">{p.title}</span>
        <span class="settings-choice-desc">{p.desc}</span>
      </span>
    </label>
  );

  return (
    <div
      class="settings-overlay"
      ref={(el) => onCleanup(focusTrap(el))}
      onClick={handleOverlayClick}
    >
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="settings-header">
          <h3>Settings</h3>
          <button class="settings-close" onClick={close} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="settings-body">
          <Show when={settings()} fallback={<p class="settings-hint">Loading…</p>}>
            <section class="settings-section">
              <h4 class="settings-section-title">Appearance</h4>
              <div class="settings-choices">
                <ThemeChoice
                  value="system"
                  title="Use system setting"
                  desc="Match your device's light or dark appearance"
                />
                <ThemeChoice
                  value="light"
                  title="Light"
                  desc="Always use the light theme"
                />
                <ThemeChoice
                  value="dark"
                  title="Dark"
                  desc="Always use the dark theme"
                />
              </div>
            </section>

            <section class="settings-section">
              <h4 class="settings-section-title">On startup, open</h4>
              <div class="settings-choices">
                <StartupChoice
                  value="overview"
                  title="Board overview"
                  desc="Start on the list of all boards"
                />
                <StartupChoice
                  value="last"
                  title="Last used board"
                  desc="Continue where you left off"
                />
              </div>
            </section>

            <section class="settings-section">
              <h4 class="settings-section-title">Data folder</h4>
              <Show
                when={desktop}
                fallback={
                  <p class="settings-hint">
                    Set on the server via the <code>--data-dir</code> flag, the{" "}
                    <code>DATA_DIR</code> environment variable, or{" "}
                    <code>~/.config/synkban/synkban.toml</code>. Currently:
                    <span class="settings-path settings-path--inline">
                      <code>{settings()!.data_dir}</code>
                    </span>
                  </p>
                }
              >
                <div class="settings-path" title={dataDir()}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <code>{dataDir()}</code>
                </div>
                <div class="settings-path-actions">
                  <button class="settings-btn" onClick={browse}>
                    Browse…
                  </button>
                  <Show when={dataDir() !== settings()!.default_data_dir}>
                    <button class="settings-btn" onClick={() => setStagedDataDir(null)}>
                      Use default
                    </button>
                  </Show>
                </div>
                <Show when={dataDirChanged()}>
                  <p class="settings-note">
                    Synkban restarts to switch folders. Existing boards stay in
                    the old folder and are not moved.
                  </p>
                </Show>
              </Show>
            </section>

            <Show when={error()}>
              <p class="settings-error">{error()}</p>
            </Show>
          </Show>
        </div>

        <div class="settings-footer">
          <button class="settings-btn" onClick={close} disabled={saving()}>
            Cancel
          </button>
          <button
            class="settings-btn settings-btn--primary"
            onClick={save}
            disabled={saving() || !settings()}
          >
            {saving() ? "Saving…" : dataDirChanged() ? "Save & Restart" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
