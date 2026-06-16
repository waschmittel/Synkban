import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Home from "./pages/Home";
import BoardPage from "./pages/Board";
import { installTouchDrag } from "./touchDrag";
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

// Bridge touch gestures to the native HTML5 drag events the reorder handlers use.
installTouchDrag();

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Home} />
      <Route path="/board/:id" component={BoardPage} />
    </Router>
  ),
  document.getElementById("root")!
);
