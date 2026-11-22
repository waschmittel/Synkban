import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isLightColor,
  LABEL_DARK_INK,
  LABEL_LIGHT_INK,
  LABEL_PRESET_COLORS,
  labelTextColor,
  parseHexColor,
  relativeLuminance,
} from "./colorContrast";

describe("colorContrast", () => {
  it("parses valid #RRGGBB hex colors and rejects invalid ones", () => {
    expect(parseHexColor("#0079bf")).toEqual([0, 121, 191]);
    expect(parseHexColor(" #FFaa00 ")).toEqual([255, 170, 0]);
    expect(parseHexColor("#fff")).toBeNull();
    expect(parseHexColor("red")).toBeNull();
    expect(parseHexColor("#gggggg")).toBeNull();
  });

  it("computes WCAG relative luminance and contrast ratio", () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2);
    expect(contrastRatio([128, 128, 128], [128, 128, 128])).toBeCloseTo(1, 5);
  });

  it("picks dark ink for all 12 pastel presets and bright colors", () => {
    for (const preset of LABEL_PRESET_COLORS) {
      expect(labelTextColor(preset.hex)).toBe(LABEL_DARK_INK);
      const bg = parseHexColor(preset.hex)!;
      const fg = parseHexColor(LABEL_DARK_INK)!;
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(labelTextColor("#ffffff")).toBe(LABEL_DARK_INK);
    expect(labelTextColor("#ffff00")).toBe(LABEL_DARK_INK);
  });

  it("picks white ink for dark and saturated colors with WCAG AA contrast", () => {
    for (const hex of ["#000000", "#1d4ed8", "#7f1d1d", "#065f46", "#4c1d95"]) {
      expect(labelTextColor(hex)).toBe(LABEL_LIGHT_INK);
      const bg = parseHexColor(hex)!;
      const fg = parseHexColor(LABEL_LIGHT_INK)!;
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("guarantees >= 4.5:1 contrast across the entire sRGB cube", () => {
    const steps = [0, 64, 128, 192, 255];
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
          const ink = parseHexColor(labelTextColor(hex))!;
          expect(contrastRatio(ink, [r, g, b])).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("falls back to dark ink for invalid hex strings", () => {
    expect(labelTextColor("invalid")).toBe(LABEL_DARK_INK);
  });

  it("detects light board colors for Home tiles", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#fff59d")).toBe(true);
    expect(isLightColor("#0079bf")).toBe(false);
    expect(isLightColor("#000000")).toBe(false);
  });
});
