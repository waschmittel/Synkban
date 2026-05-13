import { createSignal, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "../api";
import type { GitSyncConfig, SyncStatus } from "../types";

export default function Settings() {
  const [config, setConfig] = createSignal<GitSyncConfig>({
    enabled: false,
    remote_url: "",
    branch: "main",
    sync_interval_secs: 30,
    author_name: "Trello Clone",
    author_email: "tc@localhost",
  });
  const [status, setStatus] = createSignal<SyncStatus | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [syncing, setSyncing] = createSignal(false);
  const [message, setMessage] = createSignal("");

  onMount(async () => {
    try {
      const [c, s] = await Promise.all([api.getSyncConfig(), api.getSyncStatus()]);
      setConfig(c);
      setStatus(s);
    } catch {
      setMessage("Failed to load config");
    }
  });

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const c = await api.updateSyncConfig(config());
      setConfig(c);
      const s = await api.getSyncStatus();
      setStatus(s);
      setMessage("Settings saved");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setSaving(false);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage("");
    try {
      const s = await api.syncNow();
      setStatus(s);
      setMessage("Sync complete");
    } catch (e: any) {
      setMessage(`Sync error: ${e.message}`);
    }
    setSyncing(false);
  };

  const updateField = <K extends keyof GitSyncConfig>(key: K, value: GitSyncConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div class="settings-page">
      <div class="settings-header">
        <A href="/" class="settings-back">&larr; Back</A>
        <h2>Git Sync Settings</h2>
      </div>

      <div class="settings-card">
        <div class="settings-form">
          <label class="form-toggle">
            <input
              type="checkbox"
              checked={config().enabled}
              onChange={(e) => updateField("enabled", e.currentTarget.checked)}
            />
            <span>Enable Git Sync</span>
          </label>

          <div class="form-group">
            <label>Remote URL</label>
            <input
              ref={(el) => requestAnimationFrame(() => el.focus())}
              type="text"
              value={config().remote_url}
              onInput={(e) => updateField("remote_url", e.currentTarget.value)}
              placeholder="https://github.com/user/repo.git"
            />
          </div>

          <div class="form-group">
            <label>Branch</label>
            <input
              type="text"
              value={config().branch}
              onInput={(e) => updateField("branch", e.currentTarget.value)}
              placeholder="main"
            />
          </div>

          <div class="form-group">
            <label>Sync Interval (seconds)</label>
            <input
              type="number"
              value={config().sync_interval_secs}
              onInput={(e) => updateField("sync_interval_secs", parseInt(e.currentTarget.value) || 30)}
              min="5"
            />
          </div>

          <div class="form-group">
            <label>Author Name</label>
            <input
              type="text"
              value={config().author_name}
              onInput={(e) => updateField("author_name", e.currentTarget.value)}
            />
          </div>

          <div class="form-group">
            <label>Author Email</label>
            <input
              type="text"
              value={config().author_email}
              onInput={(e) => updateField("author_email", e.currentTarget.value)}
            />
          </div>

          <div class="settings-actions">
            <button class="btn btn-primary" onClick={handleSave} disabled={saving()}>
              {saving() ? "Saving..." : "Save Settings"}
            </button>
            <button
              class="btn btn-primary"
              onClick={handleSyncNow}
              disabled={syncing() || !config().enabled}
            >
              {syncing() ? "Syncing..." : "Sync Now"}
            </button>
          </div>

          <Show when={message()}>
            <p class={message().startsWith("Error") || message().startsWith("Sync error") ? "sync-error" : "sync-success"}>
              {message()}
            </p>
          </Show>
        </div>

        <Show when={status()}>
          <div class="settings-status">
            <h3>Sync Status</h3>
            <div class="status-grid">
              <span class="status-label">Initialized:</span>
              <span>{status()!.initialized ? "Yes" : "No"}</span>
              <span class="status-label">Last commit:</span>
              <span>{status()!.last_commit || "—"}</span>
              <span class="status-label">Last push:</span>
              <span>{status()!.last_push || "—"}</span>
              <span class="status-label">Last pull:</span>
              <span>{status()!.last_pull || "—"}</span>
              <span class="status-label">Pending changes:</span>
              <span>{status()!.pending_changes ? "Yes" : "No"}</span>
            </div>
            <Show when={status()!.error}>
              <p class="sync-error">{status()!.error}</p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
