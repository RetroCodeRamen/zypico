// The 128×80 indexed-color play-window framebuffer (plan §4, §5; outline §13.1).
//
// This is the canonical "screen": a 128-wide, 80-high grid of 4-bit palette
// indices (one byte each here for simplicity). All companion scenes, mini-games,
// and Cart canvases draw into a buffer like this; the renderer (PixelScreen)
// upscales it nearest-neighbor so the pixels stay chunky. Drawing in indices
// (not RGB) keeps content palette-independent — a colorway is just a different
// table at blit time (see palette.ts).
//
// Framework-agnostic and side-effect-free, so it unit-tests without a DOM and
// could later back the Lua Cart SDK's draw calls unchanged.

import { PALETTE_SIZE, type Rgb } from "./palette.ts";

export const SCREEN_W = 128;
export const SCREEN_H = 80;

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  /** One palette index (0–15) per pixel, row-major. */
  readonly pixels: Uint8Array;

  constructor(width = SCREEN_W, height = SCREEN_H) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Fill the whole buffer with one palette index. */
  clear(color = 0): void {
    this.pixels.fill(color & 0x0f);
  }

  /** Set one pixel (no-op if off-screen). */
  set(x: number, y: number, color: number): void {
    x |= 0;
    y |= 0;
    if (this.inBounds(x, y)) this.pixels[y * this.width + x] = color & 0x0f;
  }

  get(x: number, y: number): number {
    return this.inBounds(x | 0, y | 0) ? this.pixels[(y | 0) * this.width + (x | 0)] : 0;
  }

  /** Filled rectangle, clipped to the buffer. */
  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.width, (x | 0) + (w | 0));
    const y1 = Math.min(this.height, (y | 0) + (h | 0));
    const c = color & 0x0f;
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.width;
      for (let xx = x0; xx < x1; xx++) this.pixels[row + xx] = c;
    }
  }

  /** A line from (x0,y0) to (x1,y1) (Bresenham), clipped per-pixel. */
  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** A rectangle outline (1px), clipped to the buffer. */
  rect(x: number, y: number, w: number, h: number, color: number): void {
    if (w <= 0 || h <= 0) return;
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }

  /** A circle outline (midpoint), clipped per-pixel. */
  circle(cx: number, cy: number, r: number, color: number): void {
    cx |= 0; cy |= 0; r |= 0;
    if (r < 0) return;
    let x = r;
    let y = 0;
    let err = 1 - r;
    while (x >= y) {
      this.set(cx + x, cy + y, color); this.set(cx + y, cy + x, color);
      this.set(cx - y, cy + x, color); this.set(cx - x, cy + y, color);
      this.set(cx - x, cy - y, color); this.set(cx - y, cy - x, color);
      this.set(cx + y, cy - x, color); this.set(cx + x, cy - y, color);
      y++;
      if (err < 0) { err += 2 * y + 1; } else { x--; err += 2 * (y - x) + 1; }
    }
  }

  /** Filled disc centred at (cx, cy) with radius r. */
  fillCircle(cx: number, cy: number, r: number, color: number): void {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) this.set(cx + dx, cy + dy, color);
      }
    }
  }

  /**
   * Blit the buffer into an RGBA byte array (e.g. an ImageData.data) using a
   * palette's RGB table. `out` must be width*height*4 bytes.
   */
  blitTo(out: Uint8ClampedArray, rgb: Rgb[]): void {
    if (out.length < this.pixels.length * 4) {
      throw new RangeError("output buffer too small for blit");
    }
    for (let i = 0; i < this.pixels.length; i++) {
      const c = rgb[this.pixels[i] % PALETTE_SIZE];
      const o = i * 4;
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = 255;
    }
  }
}
