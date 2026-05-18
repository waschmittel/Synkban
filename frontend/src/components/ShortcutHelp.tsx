interface Props {
  onClose: () => void;
}

function Row(props: { keys: string[]; desc: string }) {
  return (
    <div class="shortcut-row">
      <span class="shortcut-keys">
        {props.keys.map((k, i) => (
          <>
            {i > 0 && <span class="shortcut-sep">+</span>}
            <kbd>{k}</kbd>
          </>
        ))}
      </span>
      <span class="shortcut-desc">{props.desc}</span>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <div class="shortcut-section">
      <h4 class="shortcut-section-title">{props.title}</h4>
      {props.children}
    </div>
  );
}

export default function ShortcutHelp(props: Props) {
  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "?") {
      e.stopPropagation();
      props.onClose();
    }
  };

  return (
    <div
      class="shortcut-help-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div class="shortcut-help-modal">
        <div class="shortcut-help-header">
          <h3>Keyboard Shortcuts</h3>
          <button class="shortcut-help-close" onClick={props.onClose}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="shortcut-help-body">
          <Section title="Home">
            <Row keys={["↑", "↓", "←", "→"]} desc="Navigate between boards" />
            <Row keys={["Shift", "↑↓←→"]} desc="Reorder focused board" />
            <Row keys={["Enter"]} desc="Open board" />
            <Row keys={["n"]} desc="Create new board" />
            <Row keys={["Del"]} desc="Archive focused board" />
            <Row keys={["a"]} desc="Toggle archived boards" />
            <Row keys={["Esc"]} desc="Close form / archive" />
          </Section>
          <Section title="Navigation">
            <Row keys={["↑", "↓"]} desc="Move between cards" />
            <Row keys={["←", "→"]} desc="Jump to adjacent list" />
          </Section>
          <Section title="Move Card">
            <Row keys={["Shift", "↑"]} desc="Move card up" />
            <Row keys={["Shift", "↓"]} desc="Move card down" />
            <Row keys={["Shift", "←"]} desc="Move card to prev list" />
            <Row keys={["Shift", "→"]} desc="Move card to next list" />
          </Section>
          <Section title="Move / Rename List">
            <Row keys={["Shift", "Alt", "←"]} desc="Move list left" />
            <Row keys={["Shift", "Alt", "→"]} desc="Move list right" />
            <Row keys={["r"]} desc="Rename focused list" />
          </Section>
          <Section title="Cards">
            <Row keys={["Enter"]} desc="Open focused card" />
            <Row keys={["e"]} desc="Edit focused card" />
            <Row keys={["n"]} desc="Add card to current list" />
            <Row keys={["Del"]} desc="Archive focused card (confirm)" />
          </Section>
          <Section title="Board">
            <Row keys={["b"]} desc="Back to boards overview" />
            <Row keys={["l"]} desc="Add new list" />
            <Row keys={["g"]} desc="Toggle label panel" />
            <Row keys={["f"]} desc="Toggle filter bar" />
            <Row keys={["a"]} desc="Toggle archive panel" />
          </Section>
          <Section title="Archive">
            <Row keys={["↑", "↓"]} desc="Navigate archived cards" />
            <Row keys={["Esc"]} desc="Close archive" />
          </Section>
          <Section title="Card Detail">
            <Row keys={["Ctrl", "Enter"]} desc="Save" />
            <Row keys={["Ctrl", "B"]} desc="Bold selection (title)" />
            <Row keys={["Ctrl", "I"]} desc="Italic selection (title)" />
            <Row keys={["Esc"]} desc="Close (with unsaved guard)" />
            <Row keys={["Ctrl", "Shift"]} desc="Toggle title / editor focus" />
            <Row keys={["Enter"]} desc="Title → focus editor" />
            <Row keys={["l"]} desc="Toggle label picker" />
            <Row keys={["d"]} desc="Focus due date input" />
            <Row keys={["f"]} desc="Toggle filter bar" />
            <Row keys={["?"]} desc="Toggle shortcuts help" />
          </Section>
          <Section title="Description Editor">
            <Row keys={["Tab"]} desc="Nest list item (indent)" />
            <Row keys={["Shift", "Tab"]} desc="Outdent list item" />
            <Row keys={["Ctrl", "]"]} desc="Nest list item (alt)" />
            <Row keys={["Ctrl", "["]} desc="Outdent list item (alt)" />
            <Row keys={["Enter"]} desc="Split list item" />
          </Section>
          <Section title="Attachments">
            <Row keys={["Tab"]} desc="Navigate attachments" />
            <Row keys={["Del"]} desc="Delete focused attachment" />
            <Row keys={["Enter"]} desc="Preview/download attachment" />
          </Section>
          <Section title="Global">
            <Row keys={["?"]} desc="Show / hide this help" />
          </Section>
        </div>
      </div>
    </div>
  );
}
