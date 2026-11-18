import { Show, createEffect, createSignal } from "solid-js";
import { actionError, clearActionError, serverUnreachable, triggerReconnect } from "../api";

interface Props {
  onRetry?: () => void;
  suppressWhen?: boolean;
}

/// Non-blocking banner surfaced when the server is unreachable or a write fails,
/// keeping the loaded board/overview on screen instead of replacing it.
export default function NetworkBanner(props: Props) {
  const [dismissedKey, setDismissedKey] = createSignal<string | null>(null);
  const currentKey = () => `${serverUnreachable() ? "offline" : "online"}:${actionError() ?? ""}`;

  createEffect(() => {
    if (!serverUnreachable() && !actionError()) setDismissedKey(null);
  });

  const visible = () =>
    !props.suppressWhen &&
    (serverUnreachable() || !!actionError()) &&
    dismissedKey() !== currentKey();

  return (
    <Show when={visible()}>
      <div class="network-banner" role="alert">
        <svg class="network-banner-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div class="network-banner-body">
          <Show
            when={serverUnreachable()}
            fallback={<span>{actionError()}</span>}
          >
            <strong>Cannot reach the server</strong>
            <span>
              {actionError()
                ? ` — ${actionError()}`
                : " — changes cannot be saved right now. Retrying automatically…"}
            </span>
          </Show>
        </div>
        <Show when={serverUnreachable() && props.onRetry}>
          <button
            type="button"
            class="btn btn-sm network-banner-retry"
            onClick={() => {
              clearActionError();
              triggerReconnect();
              props.onRetry?.();
            }}
          >
            Retry
          </button>
        </Show>
        <button
          type="button"
          class="network-banner-close"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={() => {
            clearActionError();
            setDismissedKey(currentKey());
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </Show>
  );
}
