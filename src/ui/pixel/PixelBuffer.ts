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
