import { createSignal, Show, type JSX } from "solid-js";
import ConfirmDialog from "./components/ConfirmDialog";

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (yes: boolean) => void;
}

export interface ConfirmHelper {
  /// Shows the confirm dialog and resolves to `true` if the user confirmed,
  /// `false` if cancelled. Pages do `if (!await confirm.ask({...})) return;`
  /// — far less bookkeeping than juggling a signal + render branch by hand.
  ask: (opts: { message: string; confirmLabel: string }) => Promise<boolean>;
  /// True when a dialog is currently open. Use to suppress global shortcuts.
  isOpen: () => boolean;
  /// Mount once in the page's JSX so the dialog has a place to render.
  Render: () => JSX.Element;
}

export function createConfirm(): ConfirmHelper {
  const [request, setRequest] = createSignal<ConfirmRequest | null>(null);

  return {
    ask: (opts) =>
      new Promise<boolean>((resolve) => {
        // A still-pending request would never settle once replaced — cancel it.
        request()?.resolve(false);
        setRequest({ ...opts, resolve });
      }),
    isOpen: () => request() !== null,
    Render: () => (
      <Show when={request()}>
        {(req) => (
          <ConfirmDialog
            message={req().message}
            confirmLabel={req().confirmLabel}
            onConfirm={() => {
              req().resolve(true);
              setRequest(null);
            }}
            onCancel={() => {
              req().resolve(false);
              setRequest(null);
            }}
          />
        )}
      </Show>
    ),
  };
}
