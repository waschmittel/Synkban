import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Home from "./pages/Home";
import BoardPage from "./pages/Board";
import { installTouchDrag } from "./touchDrag";
import { api } from "./api";
import { applyTheme } from "./theme";
import "prosemirror-view/style/prosemirror.css";
import "prosemirror-menu/style/menu.css";
import "./styles/app.css";

// Mark the document so CSS can adapt the title bar for the Electron shell,
// where the window is frameless and .app-header doubles as the title bar: it
// has to keep clear of the OS window controls, whose side and size the
// stylesheet reads from the Window Controls Overlay env() vars (see app.css).
if (typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent)) {
  document.documentElement.classList.add("electron");
}

// Register the service worker so the app is installable on Android.
// Skipped in the Electron shell, which is already a native window.
if (
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  !/Electron\//.test(navigator.userAgent)
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Bridge touch gestures to the native HTML5 drag events the reorder handlers use.
installTouchDrag();

// Startup view preference: rewrite "/" to the last used board BEFORE the
// router initializes, so this only fires on a fresh page load — in-app
// navigation back to the overview never bounces. The query string is
// preserved for the desktop shell's initial `?token=` load. Settings come
// from the server (~/.config/synkban/synkban.toml): localStorage can't persist
// them because the desktop shell serves the UI from a random port each launch.
/// Crash safety (ADR-0024): starting the app (on "/"), a draft left by the
/// last session wins over the startup view: start on its board, which reopens
/// the card (or drops the draft if the card changed). A draft of a board
/// that's gone is dropped here. A board URL (reload, link) is left alone.
async function openCrashDraftBoard() {
  try {
    const draft = await api.getDraft();
    if (!draft) return;
    const boards = await api.listBoards();
    if (!boards.some((b) => b.id === draft.board_id)) {
      await api.deleteDraft(draft.card_id);
      return;
    }
    const path = `/board/${draft.board_id}`;
    if (window.location.pathname !== path) window.history.replaceState(null, "", `${path}${window.location.search}`);
  } catch {
    /* server unreachable: the page shows that */
  }
}

async function bootstrap() {
  // Only the redirect must run before the router mounts, so we only await
  // settings on "/". The theme (not render-blocking) is applied afterwards
  // from the same response, reusing it when available.
  let pending: ReturnType<typeof api.getSettings> | null = null;
  let settingsFailed = false;
  const atStart = window.location.pathname === "/";
  if (atStart) {
    try {
      const settings = await api.getSettings();
      pending = Promise.resolve(settings);
      if (settings.startup_view === "last" && settings.last_board_id) {
        window.history.replaceState(
          null,
          "",
          `/board/${settings.last_board_id}${window.location.search}`
        );
      }
    } catch {
      settingsFailed = true;
      /* settings unreachable — start on the overview, keep OS-default theme */
    }
  }
  if (atStart && !settingsFailed) await openCrashDraftBoard();

  render(
    () => (
      <Router root={App}>
        <Route path="/" component={Home} />
        <Route path="/board/:id" component={BoardPage} />
      </Router>
    ),
    document.getElementById("root")!
  );

  // Correct the OS-default theme set by index.html with the persisted
  // preference. Not render-blocking, so it may resolve after first paint.
  if (!settingsFailed) {
    (pending ?? api.getSettings())
      .then((s) => applyTheme(s.theme))
      .catch(() => {
        /* keep the OS-default theme applied inline in index.html */
      });
  }
}

bootstrap();
