// The 16-color play-window palette (plan §4, §13; outline §13.1 — "128×80,
// 16-color, chunky pixels, PICO-8 in spirit"). PICO-8's palette is the baseline
// the plan names (§13 open items). Indices are the wire/auth-stable contract:
// the framebuffer stores indices 0–15; only this table maps them to RGB, so a
// later shell colorway (outline §13.8 — Monochrome Green, Amber CRT, …) is a
// palette swap, not a content change.

export const PALETTE_SIZE = 16;

/** PICO-8 palette, index → #RRGGBB. */
export const PICO8: readonly string[] = [
  "#000000", // 0  black
  "#1D2B53", // 1  dark-blue
  "#7E2553", // 2  dark-purple
  "#008751", // 3  dark-green
  "#AB5236", // 4  brown
  "#5F574F", // 5  dark-grey
  "#C2C3C7", // 6  light-grey
  "#FFF1E8", // 7  white
  "#FF004D", // 8  red
  "#FFA300", // 9  orange
  "#FFEC27", // 10 yellow
  "#00E436", // 11 green
  "#29ADFF", // 12 blue
  "#83769C", // 13 lavender
  "#FF77A8", // 14 pink
  "#FFCCAA", // 15 peach
] as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Expand a palette of hex strings into RGB triples for fast framebuffer fills. */
export function toRgbTable(hex: readonly string[]): Rgb[] {
  return hex.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  });
}

export const PICO8_RGB: Rgb[] = toRgbTable(PICO8);
