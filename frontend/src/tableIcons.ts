/// Icons for the table menu and the toolbar button. Each value is the inner
/// markup of a 24×24 stroke icon (`currentColor`, round caps); `svg()` wraps it.
/// All strings are static — nothing user-controlled ever reaches `innerHTML`.

export const svg = (inner: string, size = 16): string =>
  // Inline style, not just attributes: prosemirror-menu's stylesheet sets
  // `.ProseMirror-icon svg { fill: currentColor; height: 1em }`, which would
  // turn the outline icon in the toolbar into a solid square.
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `style="fill:none;width:${size}px;height:${size}px" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/// A grid with a header row.
export const TABLE_ICON =
  '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>';

const BAND = 'fill="currentColor" fill-opacity=".28" stroke="none"';

export const ICONS = {
  // Move: an arrow in the direction of travel.
  moveUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  moveDown: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  moveLeft: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  moveRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  // Insert: the existing grid plus a "+" where the new line goes.
  rowAbove: '<rect x="3" y="12" width="18" height="8" rx="1.5"/><path d="M12 3v6M9 6h6"/>',
  rowBelow: '<rect x="3" y="4" width="18" height="8" rx="1.5"/><path d="M12 15v6M9 18h6"/>',
  colLeft: '<rect x="12" y="3" width="8" height="18" rx="1.5"/><path d="M3 12h6M6 9v6"/>',
  colRight: '<rect x="4" y="3" width="8" height="18" rx="1.5"/><path d="M15 12h6M18 9v6"/>',
  // Align: text lines hugging the left edge, centred, or the right edge.
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  // Delete: the grid with the affected row/column struck out, or a bin.
  deleteRow:
    `<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="3" y="9.5" width="18" height="5" ${BAND}/>` +
    '<path d="M10.5 10.5l3 3M13.5 10.5l-3 3"/>',
  deleteColumn:
    `<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="9.5" y="4" width="5" height="16" ${BAND}/>` +
    '<path d="M10.5 10.5l3 3M13.5 10.5l-3 3"/>',
  deleteTable:
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
} as const;
