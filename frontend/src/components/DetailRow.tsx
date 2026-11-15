import type { JSX } from "solid-js";

interface Props {
  /// 16px section icon; `title` is its tooltip (name + shortcut).
  icon: JSX.Element;
  title: string;
  class?: string;
  children: JSX.Element;
}

/// One card detail section: its icon (named by the tooltip) left of its
/// content, all icons in one column with the title's card icon.
export default function DetailRow(props: Props) {
  return (
    <div class={`detail-row ${props.class ?? ""}`}>
      <div class="detail-row-label" title={props.title}>
        {props.icon}
      </div>
      <div class="detail-row-body">{props.children}</div>
    </div>
  );
}
