import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Home from "./pages/Home";
import BoardPage from "./pages/Board";
import { installTouchDrag } from "./touchDrag";
import { api } from "./api";
import "prosemirror-view/style/prosemirror.css";
import "prosemirror-menu/style/menu.css";
import "./styles/app.css";

// Mark the document so CSS can adapt the title bar for the Electron shell.
// Electron's UA includes "Electron/<version>"; on macOS the traffic lights
// are overlaid via `titleBarStyle: 'hiddenInset'`, so the header reserves
// extra left padding only there.
if (typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent)) {
  document.documentElement.classList.add("electron");
  if (navigator.platform.startsWith("Mac")) {
    document.documentElement.classList.add("electron--mac");
  }
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
// navigation back to the overview never bounces. Deep links (any non-root
// path) skip the settings fetch entirely, and the query string is preserved
// for the desktop shell's initial `?token=` load. Settings come from the
// server (~/.config/synkban/synkban.toml): localStorage can't persist them
// because the desktop shell serves the UI from a random port each launch.
async function bootstrap() {
  if (window.location.pathname === "/") {
    try {
      const settings = await api.getSettings();
      if (settings.startup_view === "last" && settings.last_board_id) {
        window.history.replaceState(
          null,
          "",
          `/board/${settings.last_board_id}${window.location.search}`
        );
      }
    } catch {
      /* settings unreachable — start on the overview */
    }
  }

  render(
    () => (
      <Router root={App}>
        <Route path="/" component={Home} />
        <Route path="/board/:id" component={BoardPage} />
      </Router>
    ),
    document.getElementById("root")!
  );
}

bootstrap();
