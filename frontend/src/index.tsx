import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Home from "./pages/Home";
import BoardPage from "./pages/Board";
import Settings from "./pages/Settings";
import "prosemirror-view/style/prosemirror.css";
import "prosemirror-menu/style/menu.css";
import "./styles/app.css";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Home} />
      <Route path="/board/:id" component={BoardPage} />
      <Route path="/settings" component={Settings} />
    </Router>
  ),
  document.getElementById("root")!
);
