/// Label preset palette (matches `backend/src/store/labels.rs::LABEL_COLORS`).
export const LABEL_PRESET_COLORS: readonly { hex: string; name: string }[] = [
  { hex: "#ffb3b3", name: "Rose" },
  { hex: "#9bf6ff", name: "Sky" },
  { hex: "#caffbf", name: "Lime" },
  { hex: "#c9b3ff", name: "Lavender" },
  { hex: "#ffd6a5", name: "Peach" },
  { hex: "#a0c4ff", name: "Periwinkle" },
  { hex: "#fdffb6", name: "Lemon" },
  { hex: "#ffc6ff", name: "Pink" },
  { hex: "#b5ead7", name: "Mint" },
  { hex: "#ffdac1", name: "Apricot" },
  { hex: "#c7ceea", name: "Steel blue" },
  { hex: "#e2f0cb", name: "Pale green" },
];

export type Rgb = [number, number, number];

const DARK_INK_RGB: Rgb = [0, 0, 0];
const WHITE_INK_RGB: Rgb = [255, 255, 255];

export const LABEL_DARK_INK = "#000000";
export const LABEL_LIGHT_INK = "#ffffff";
export const DEFAULT_BOARD_COLOR = "#0079bf";

/// Parses `#RRGGBB` into `[r, g, b]` in `0..=255`, or `null` if invalid.
export function parseHexColor(hex: string): Rgb | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/// WCAG 2.1 relative luminance for an sRGB triple (`0..=255`).
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/// WCAG 2.1 contrast ratio (`1..=21`) between two sRGB triples.
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/// Picks dark or white text for a solid label chip (`bgHex`), whichever
/// produces the higher WCAG contrast ratio.
export function labelTextColor(bgHex: string): string {
  const bg = parseHexColor(bgHex);
  if (!bg) return LABEL_DARK_INK;
  return contrastRatio(WHITE_INK_RGB, bg) > contrastRatio(DARK_INK_RGB, bg)
    ? LABEL_LIGHT_INK
    : LABEL_DARK_INK;
}

/// True when dark ink achieves higher WCAG contrast than white on `bgHex`.
export function isLightColor(bgHex: string): boolean {
  const bg = parseHexColor(bgHex);
  if (!bg) return false;
  return contrastRatio(DARK_INK_RGB, bg) >= contrastRatio(WHITE_INK_RGB, bg);
}
