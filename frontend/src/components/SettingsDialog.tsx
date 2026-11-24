import { createResource, createSignal, onCleanup, Show } from "solid-js";
import { api, errorMessage } from "../api";
import type { MirrorSchedule, MirrorStatus, Theme, UpdateSettingsPayload } from "../types";
import { modalDialog } from "../modalDialog";
import { dialogKeys } from "../dialogKeys";
import { desktopBridge } from "../settings";
import { applyTheme } from "../theme";
import { tip } from "../platform";
import { timeAgo } from "../timeAgo";

interface Props {
  onClose: () => void;
}

/// All edits are buffered locally; nothing persists until Save. Cancel,
/// Escape, X, and overlay click all discard. Saving a data-dir change on
/// desktop relaunches the whole app (the backend reads its dir at spawn).
export default function SettingsDialog(props: Props) {
  const desktop = desktopBridge();
  const [settings, { refetch: refetchSettings }] = createResource(() => api.getSettings());
  const loaded = () => (settings.error ? undefined : settings());

  // Staged edits: null = untouched, otherwise the pending value.
  const [stagedStartup, setStagedStartup] = createSignal<"overview" | "last" | null>(null);
  const [stagedTheme, setStagedTheme] = createSignal<Theme | null>(null);
  // undefined = untouched, string = new custom dir, null = revert to default / clear.
  const [stagedDataDir, setStagedDataDir] = createSignal<string | null | undefined>(undefined);
  const [stagedMirrorDir, setStagedMirrorDir] = createSignal<string | null | undefined>(undefined);
  const [stagedMirrorSchedule, setStagedMirrorSchedule] = createSignal<MirrorSchedule | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [mirroring, setMirroring] = createSignal(false);
  const [mirrorRunStatus, setMirrorRunStatus] = createSignal<MirrorStatus | null>(null);
  const [mirrorRunError, setMirrorRunError] = createSignal<string | null>(null);

  const startupView = () => stagedStartup() ?? loaded()?.startup_view ?? "overview";
  const theme = () => stagedTheme() ?? loaded()?.theme ?? "system";

  // Theme is previewed live (applied to <html> on selection), so a discarded
  // dialog must roll the preview back to the persisted value.
  const previewTheme = (t: Theme) => {
    setStagedTheme(t);
    applyTheme(t);
  };
  const revertThemePreview = () => {
    const s = loaded();
    if (s && stagedTheme() !== null && stagedTheme() !== s.theme) applyTheme(s.theme);
  };
  const dataDir = () => {
    const s = loaded();
    if (!s) return "";
    const staged = stagedDataDir();
    if (staged === undefined) return s.data_dir;
    return staged ?? s.default_data_dir;
  };
  const dataDirChanged = () => loaded() !== undefined && dataDir() !== loaded()!.data_dir;

  const mirrorDir = () => {
    const s = loaded();
    if (!s) return null;
    const staged = stagedMirrorDir();
    return staged === undefined ? s.mirror_dir : staged;
  };
  const mirrorDirChanged = () =>
    loaded() !== undefined && (mirrorDir() ?? null) !== (loaded()!.mirror_dir ?? null);
  const mirrorSchedule = (): MirrorSchedule =>
    stagedMirrorSchedule() ?? loaded()?.mirror_schedule ?? "off";
  const mirrorScheduleChanged = () =>
    loaded() !== undefined && mirrorSchedule() !== loaded()!.mirror_schedule;

  const activeMirrorStatus = (): MirrorStatus | null =>
    mirrorRunStatus() ?? loaded()?.mirror_status ?? null;

  const dirty = () =>
    loaded() !== undefined &&
    (startupView() !== loaded()!.startup_view ||
      theme() !== loaded()!.theme ||
      dataDirChanged() ||
      mirrorDirChanged() ||
      mirrorScheduleChanged());

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

  const browseMirror = async () => {
    if (!desktop) return;
    const dir = await desktop.pickMirrorDir(mirrorDir() ?? "");
    if (dir) {
      setStagedMirrorDir(dir);
      if (mirrorSchedule() === "off" && !loaded()?.mirror_dir) {
        setStagedMirrorSchedule("daily");
      }
    }
  };

  const clearMirror = () => {
    setStagedMirrorDir(null);
    setStagedMirrorSchedule("off");
  };

  const runMirrorNow = async () => {
    if (!desktop || mirroring() || saving()) return;
    setMirroring(true);
    setMirrorRunError(null);
    try {
      const status = await api.runMirror();
      setMirrorRunStatus(status);
    } catch (e) {
      setMirrorRunError(errorMessage(e, "Mirror update failed"));
      // Refresh settings so mirror_status reflects the persisted error & attempt time.
      void refetchSettings();
    } finally {
      setMirroring(false);
    }
  };

  const save = async () => {
    const s = loaded();
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
      if (mirrorDirChanged()) payload.mirror_dir = stagedMirrorDir() ?? null;
      if (mirrorScheduleChanged()) payload.mirror_schedule = mirrorSchedule();
      await api.updateSettings(payload);
      // Preview already applied the theme; keep it (do not revert on close).
      applyTheme(theme());
      if (dataDirChanged() && desktop) {
        desktop.relaunch();
        return; // app is going down; keep the dialog as-is
      }
      props.onClose();
    } catch (e) {
      setError(errorMessage(e, "Saving failed"));
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

  const ScheduleChoice = (p: { value: MirrorSchedule; label: string }) => {
    const disabled = () => !mirrorDir() && p.value !== "off";
    return (
      <label
        class="settings-seg"
        classList={{
          "settings-seg--selected": mirrorSchedule() === p.value,
          "settings-seg--disabled": disabled(),
        }}
      >
        <input
          type="radio"
          name="mirror-schedule"
          checked={mirrorSchedule() === p.value}
          disabled={disabled()}
          onChange={() => setStagedMirrorSchedule(p.value)}
        />
        <span>{p.label}</span>
      </label>
    );
  };

  const mirrorStatusLabel = () => {
    if (mirroring()) return "Mirroring…";
    const st = activeMirrorStatus();
    if (!st || !st.last_succeeded_at) return "Not mirrored yet";
    const cards = st.cards_mirrored;
    const count = cards !== undefined && cards !== null ? ` · ${cards} card${cards === 1 ? "" : "s"}` : "";
    return `Last updated ${timeAgo(st.last_succeeded_at)}${count}`;
  };

  const mirrorStatusTitle = () => {
    const ts = activeMirrorStatus()?.last_succeeded_at;
    return ts ? new Date(ts).toLocaleString() : undefined;
  };

  const mirrorErrText = () => mirrorRunError() ?? activeMirrorStatus()?.last_error ?? null;

  return (
    <dialog
      class="dialog-overlay settings-overlay"
      ref={(el) => onCleanup(modalDialog(el))}
      onClick={handleOverlayClick}
    >
      <div class="dialog-surface settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="settings-header">
          <h3>Settings</h3>
          <button class="btn-close settings-close" onClick={close} title={tip("Close", "Esc")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="settings-body">
          <Show
            when={!settings.error}
            fallback={
              <div class="settings-load-error" role="alert">
                <p class="settings-error">{errorMessage(settings.error, "Could not load settings.")}</p>
                <button type="button" class="btn btn-outline settings-btn" onClick={() => refetchSettings()}>
                  Retry
                </button>
              </div>
            }
          >
          <Show when={loaded()} fallback={<p class="settings-hint">Loading…</p>}>
            {(s) => (
              <>
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

            <section class="settings-section" data-section="data-dir">
              <h4 class="settings-section-title">Data folder</h4>
              <Show
                when={desktop}
                fallback={
                  <p class="settings-hint">
                    Set on the server via the <code>--data-dir</code> flag, the{" "}
                    <code>DATA_DIR</code> environment variable, or{" "}
                    <code>~/.config/synkban/synkban.toml</code>. Currently:
                    <span class="settings-path settings-path--inline">
                      <code>{s().data_dir}</code>
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
                  <button class="btn btn-outline settings-btn" onClick={browse}>
                    Browse…
                  </button>
                  <Show when={dataDir() !== s().default_data_dir}>
                    <button class="btn btn-outline settings-btn" onClick={() => setStagedDataDir(null)}>
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

            <section class="settings-section" data-section="readable-mirror">
              <h4 class="settings-section-title">Readable mirror</h4>
              <Show
                when={desktop}
                fallback={
                  <p class="settings-hint">
                    Automatic mirroring runs in the Desktop App. On a server, run{" "}
                    <code>synkban export &lt;folder&gt;</code> to create or update
                    a read-only HTML mirror (<code>index.html</code> + attachments).
                  </p>
                }
              >
                <p class="settings-hint settings-hint--spaced">
                  Maintains a browseable, read-only HTML copy (<code>index.html</code>) of
                  saved boards, cards, and attachments while Synkban is open. Permanently
                  deleted items are also removed from the mirror.
                </p>
                <div class="settings-path" title={mirrorDir() ?? undefined}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <code classList={{ "settings-path-placeholder": !mirrorDir() }}>
                    {mirrorDir() ?? "No folder selected"}
                  </code>
                </div>
                <div class="settings-path-actions">
                  <button class="btn btn-outline settings-btn" onClick={browseMirror}>
                    Browse…
                  </button>
                  <Show when={mirrorDir()}>
                    <button class="btn btn-outline settings-btn" onClick={clearMirror}>
                      Clear
                    </button>
                  </Show>
                </div>
                <div class="settings-segmented" role="radiogroup" aria-label="Mirror schedule">
                  <ScheduleChoice value="off" label="Off" />
                  <ScheduleChoice value="daily" label="Daily" />
                  <ScheduleChoice value="weekly" label="Weekly" />
                </div>
                <Show when={mirrorDirChanged() && Boolean(s().mirror_dir)}>
                  <p class="settings-note">
                    Existing files in the previous mirror folder stay untouched on disk.
                  </p>
                </Show>
                <Show when={Boolean(s().mirror_dir) && !mirrorDirChanged()}>
                  <div class="settings-mirror-row">
                    <span class="settings-mirror-status" title={mirrorStatusTitle()}>
                      {mirrorStatusLabel()}
                    </span>
                    <button
                      type="button"
                      class="btn btn-outline settings-btn"
                      onClick={runMirrorNow}
                      disabled={mirroring() || saving()}
                    >
                      {mirroring() ? "Mirroring…" : "Mirror now"}
                    </button>
                  </div>
                  <Show when={mirrorErrText()}>
                    {(err) => <p class="settings-error">{err()}</p>}
                  </Show>
                </Show>
              </Show>
            </section>

            <Show when={error()}>
              <p class="settings-error">{error()}</p>
            </Show>
              </>
            )}
          </Show>
          </Show>
        </div>

        <div class="settings-footer">
          <button class="btn btn-outline settings-btn" onClick={close} disabled={saving()}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            onClick={save}
            disabled={saving() || !loaded()}
          >
            {saving() ? "Saving…" : dataDirChanged() ? "Save & Restart" : "Save"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
