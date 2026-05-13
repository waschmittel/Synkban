import type { ParentProps } from "solid-js";
import { A } from "@solidjs/router";
import SyncButton from "./components/SyncButton";

export default function App(props: ParentProps) {
  return (
    <div class="app">
      <header class="app-header">
        <A href="/" class="app-logo">
          Trello Clone
        </A>
        <SyncButton />
      </header>
      <main class="app-main">{props.children}</main>
    </div>
  );
}
