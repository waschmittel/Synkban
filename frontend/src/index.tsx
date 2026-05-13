import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Home from "./pages/Home";
import BoardPage from "./pages/Board";
import "./styles/app.css";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Home} />
      <Route path="/board/:id" component={BoardPage} />
    </Router>
  ),
  document.getElementById("root")!
);
