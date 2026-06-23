// A 3×5 bitmap font for the 128×80 dot matrix (plan §4; outline §13.7 — terse,
// BBS-dense surfaces). All menus and text render *inside* the play window, so we
// need a font small enough to be useful at this resolution: a 3-wide × 5-tall
// glyph in a 4×6 cell (1px right + 1px below) gives ~31 columns × 13 rows.
//
// Uppercase, digits, and common punctuation. Lowercase folds to uppercase for
// now (legible and very retro); true lowercase can be added later without
// touching callers. Each glyph is 5 rows of 3 chars, '#' = lit pixel.

import type { PixelBuffer } from "./PixelBuffer.ts";

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const CELL_W = GLYPH_W + 1; // 1px letter spacing
export const CELL_H = GLYPH_H + 1; // 1px line spacing

const GLYPHS: Record<string, string[]> = {
  " ": ["   ", "   ", "   ", "   ", "   "],
  A: [" # ", "# #", "###", "# #", "# #"],
  B: ["## ", "# #", "## ", "# #", "## "],
  C: [" ##", "#  ", "#  ", "#  ", " ##"],
  D: ["## ", "# #", "# #", "# #", "## "],
  E: ["###", "#  ", "## ", "#  ", "###"],
  F: ["###", "#  ", "## ", "#  ", "#  "],
  G: [" ##", "#  ", "# #", "# #", " ##"],
  H: ["# #", "# #", "###", "# #", "# #"],
  I: ["###", " # ", " # ", " # ", "###"],
  J: ["  #", "  #", "  #", "# #", " # "],
  K: ["# #", "# #", "## ", "# #", "# #"],
  L: ["#  ", "#  ", "#  ", "#  ", "###"],
  M: ["# #", "###", "###", "# #", "# #"],
  N: ["# #", "## ", "###", " ##", "# #"],
  O: [" # ", "# #", "# #", "# #", " # "],
  P: ["## ", "# #", "## ", "#  ", "#  "],
  Q: [" # ", "# #", "# #", "## ", " ##"],
  R: ["## ", "# #", "## ", "# #", "# #"],
  S: [" ##", "#  ", " # ", "  #", "## "],
  T: ["###", " # ", " # ", " # ", " # "],
  U: ["# #", "# #", "# #", "# #", " # "],
  V: ["# #", "# #", "# #", " # ", " # "],
  W: ["# #", "# #", "###", "###", "# #"],
  X: ["# #", "# #", " # ", "# #", "# #"],
  Y: ["# #", "# #", " # ", " # ", " # "],
  Z: ["###", "  #", " # ", "#  ", "###"],
  "0": [" # ", "# #", "# #", "# #", " # "],
  "1": [" # ", "## ", " # ", " # ", "###"],
  "2": ["## ", "  #", " # ", "#  ", "###"],
  "3": ["###", "  #", " ##", "  #", "###"],
  "4": ["# #", "# #", "###", "  #", "  #"],
  "5": ["###", "#  ", "## ", "  #", "## "],
  "6": [" ##", "#  ", "## ", "# #", " # "],
  "7": ["###", "  #", " # ", " # ", " # "],
  "8": [" # ", "# #", " # ", "# #", " # "],
  "9": [" # ", "# #", " ##", "  #", "## "],
  ".": ["   ", "   ", "   ", "   ", " # "],
  ",": ["   ", "   ", "   ", " # ", "#  "],
  "!": [" # ", " # ", " # ", "   ", " # "],
  "?": ["## ", "  #", " # ", "   ", " # "],
  ":": ["   ", " # ", "   ", " # ", "   "],
  ";": ["   ", " # ", "   ", " # ", "#  "],
  "-": ["   ", "   ", "###", "   ", "   "],
  "+": ["   ", " # ", "###", " # ", "   "],
  "=": ["   ", "###", "   ", "###", "   "],
  "_": ["   ", "   ", "   ", "   ", "###"],
  "/": ["  #", "  #", " # ", "#  ", "#  "],
  "'": [" # ", " # ", "   ", "   ", "   "],
  '"': ["# #", "# #", "   ", "   ", "   "],
  "(": [" # ", "#  ", "#  ", "#  ", " # "],
  ")": [" # ", "  #", "  #", "  #", " # "],
  "<": ["  #", " # ", "#  ", " # ", "  #"],
  ">": ["#  ", " # ", "  #", " # ", "#  "],
  "*": ["# #", " # ", "# #", "   ", "   "],
  "%": ["# #", "  #", " # ", "#  ", "# #"],
  "#": ["# #", "###", "# #", "###", "# #"],
  "@": [" # ", "# #", "###", "#  ", " ##"],
};

const UNKNOWN = ["###", "# #", "# #", "# #", "###"];

/** Pixel width of a string in this font (no trailing letter-space). */
export function measureText(text: string): number {
  return text.length === 0 ? 0 : text.length * CELL_W - 1;
}

function glyphFor(ch: string): string[] {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? UNKNOWN;
}

/** Draw one glyph; returns the x advance (CELL_W). */
export function drawChar(buf: PixelBuffer, x: number, y: number, ch: string, color: number): number {
  const g = glyphFor(ch);
  for (let row = 0; row < GLYPH_H; row++) {
    const line = g[row];
    for (let col = 0; col < GLYPH_W; col++) {
      if (line[col] === "#") buf.set(x + col, y + row, color);
    }
  }
  return CELL_W;
}

/** Draw a left-aligned string. Returns the x just past the last glyph. */
export function drawText(buf: PixelBuffer, x: number, y: number, text: string, color: number): number {
  let cx = x;
  for (const ch of text) cx += drawChar(buf, cx, y, ch, color);
  return cx;
}

/** Draw a string centred horizontally within [0, buf.width). */
export function drawTextCentered(buf: PixelBuffer, y: number, text: string, color: number): void {
  const x = Math.round((buf.width - measureText(text)) / 2);
  drawText(buf, x, y, text, color);
}
