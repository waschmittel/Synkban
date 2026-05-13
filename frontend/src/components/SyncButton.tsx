import { createSignal, onMount, onCleanup } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "../api";
import type { SyncStatus } from "../types";

export default function SyncButton() {
  const [status, setStatus] = createSignal<SyncStatus | null>(null);
  const [syncing, setSyncing] = createSignal(false);

  const fetchStatus = async () => {
    try {
      const s = await api.getSyncStatus();
      setStatus(s);
    } catch {
      // ignore fetch errors
    }
  };

  onMount(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    onCleanup(() => clearInterval(id));
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const s = await api.syncNow();
      setStatus(s);
    } catch {
      // ignore
    }
    setSyncing(false);
  };

  const indicatorClass = () => {
    const s = status();
    if (!s || !s.enabled) return "sync-indicator disabled";
    if (s.error) return "sync-indicator error";
    if (s.pending_changes) return "sync-indicator pending";
    return "sync-indicator synced";
  };

  const tooltip = () => {
    const s = status();
    if (!s) return "Git sync";
    if (!s.enabled) return "Git sync disabled";
    if (s.error) return `Error: ${s.error}`;
    if (s.last_push) return `Last push: ${s.last_push}`;
    return "Git sync enabled";
  };

  return (
    <div class="sync-controls">
      <button
        class="sync-button"
        onClick={handleSync}
        disabled={syncing() || !status()?.enabled}
        title={tooltip()}
      >
        <svg
          class={syncing() ? "sync-icon spinning" : "sync-icon"}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
        </svg>
        <span class={indicatorClass()} />
      </button>
      <A href="/settings" class="settings-link" title="Sync settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </A>
    </div>
  );
}
