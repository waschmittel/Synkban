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

/// A grid with a header row and header column, without the top-left cell.
export const MATRIX_ICON =
  '<path d="M10 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10M3 10h18M10 4v16"/>';

const BAND = 'fill="currentColor" fill-opacity=".28" stroke="none"';

export const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  footnote:
    '<path d="M5 18h14M7 14h6M16 5l2-1v8M16 12h4"/>',
  bulletList:
    '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  orderedList:
    '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 11.5c0-.8.7-1.3 1.5-1.3s1.5.5 1.5 1.3c0 1-3 2-3 3h3M4 17.5h2c.6 0 1 .4 1 1s-.4 1-1 1H4"/>',
  blockquote:
    '<path d="M5 6v12M10 8h9M10 12h9M10 16h6"/>',
  alert:
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  highlight:
    '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  clearHighlight:
    '<path d="M18 6 6 18M6 6l12 12"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  // Move: an arrow in the direction of travel.
  moveUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  moveDown: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  moveLeft: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  moveRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  transpose: '<path d="M16 3l4 4-4 4M20 7H11a4 4 0 0 0-4 4v9M3 16l4 4 4-4"/>',
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
  // Text
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
  codeBlock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
  luaBlock: '<rect x="3" y="4" width="18" height="16" rx="2"/><polygon points="10 9 16 12 10 15"/>',
  paragraph: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  paraAbove: '<path d="M4 6h6M7 3v6M13 6h7"/><rect x="4" y="13" width="16" height="7" rx="1.5"/>',
  paraBelow: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><path d="M4 18h6M7 15v6M13 18h7"/>',
  heading1: '<path d="M4 5v14M4 12h8M12 5v14M17 9l3-2v12"/>',
  heading2: '<path d="M4 5v14M4 12h8M12 5v14M16 9a2.5 2.5 0 0 1 5 0c0 3-5 5-5 8h5"/>',
  heading3: '<path d="M4 5v14M4 12h8M12 5v14M16 7h5l-3 4a3 3 0 1 1-2 5"/>',
} as const;
