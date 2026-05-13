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
          <Section title="Cards">
            <Row keys={["Enter"]} desc="Open focused card" />
            <Row keys={["e"]} desc="Edit focused card" />
            <Row keys={["n"]} desc="Add card to current list" />
            <Row keys={["Del"]} desc="Delete focused card" />
          </Section>
          <Section title="Board">
            <Row keys={["l"]} desc="Add new list" />
            <Row keys={["g"]} desc="Toggle label panel" />
          </Section>
          <Section title="Card Detail">
            <Row keys={["Ctrl", "Enter"]} desc="Save" />
            <Row keys={["Ctrl", "B"]} desc="Bold selection (title)" />
            <Row keys={["Ctrl", "I"]} desc="Italic selection (title)" />
            <Row keys={["Esc"]} desc="Close (with unsaved guard)" />
            <Row keys={["Enter"]} desc="Title → focus editor" />
          </Section>
          <Section title="Global">
            <Row keys={["?"]} desc="Show / hide this help" />
          </Section>
        </div>
      </div>
    </div>
  );
}
