import { describe, expect, it } from "vitest";
import { PixelBuffer, SCREEN_H, SCREEN_W } from "./PixelBuffer.ts";
import { PICO8_RGB } from "./palette.ts";

describe("PixelBuffer", () => {
  it("defaults to the canonical 128×80 play window", () => {
    const buf = new PixelBuffer();
    expect(buf.width).toBe(SCREEN_W);
    expect(buf.height).toBe(SCREEN_H);
    expect(buf.pixels.length).toBe(128 * 80);
  });

  it("clears to a palette index", () => {
    const buf = new PixelBuffer(4, 4);
    buf.clear(7);
    expect([...buf.pixels]).toEqual(new Array(16).fill(7));
  });

  it("sets and gets a pixel, masking to 4 bits", () => {
    const buf = new PixelBuffer(4, 4);
    buf.set(1, 2, 0x1f); // 0x1f & 0x0f === 15
    expect(buf.get(1, 2)).toBe(15);
  });

  it("ignores out-of-bounds writes and reads", () => {
    const buf = new PixelBuffer(4, 4);
    buf.set(-1, 0, 9);
    buf.set(99, 99, 9);
    expect(buf.get(-1, 0)).toBe(0);
    expect(buf.get(99, 99)).toBe(0);
    expect([...buf.pixels]).toEqual(new Array(16).fill(0));
  });

  it("fills a clipped rectangle", () => {
    const buf = new PixelBuffer(4, 4);
    buf.fillRect(2, 2, 10, 10, 3); // overruns the edge
    expect(buf.get(2, 2)).toBe(3);
    expect(buf.get(3, 3)).toBe(3);
    expect(buf.get(1, 1)).toBe(0);
  });

  it("blits indices to RGBA via the palette", () => {
    const buf = new PixelBuffer(2, 1);
    buf.set(0, 0, 8); // PICO-8 red #FF004D
    buf.set(1, 0, 0); // black
    const out = new Uint8ClampedArray(2 * 1 * 4);
    buf.blitTo(out, PICO8_RGB);
    expect([...out.slice(0, 4)]).toEqual([0xff, 0x00, 0x4d, 255]);
    expect([...out.slice(4, 8)]).toEqual([0x00, 0x00, 0x00, 255]);
  });

  it("rejects an undersized blit target", () => {
    const buf = new PixelBuffer(2, 2);
    expect(() => buf.blitTo(new Uint8ClampedArray(4), PICO8_RGB)).toThrow();
  });
});
