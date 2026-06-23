import { describe, expect, it } from "vitest";
import { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { CartRunner } from "./CartRunner.ts";
import { SAMPLE_CARTS } from "./samples.ts";

// A deterministic cart: a 2px block at x (default 64), moved right by ACCEPT.
const MOVER = `
function _update() if btn(1) then x = (x or 64) + 2 end end
function _draw() cls(1) rectfill((x or 64) - 1, 40, 2, 2, 12) end
`;

describe("CartRunner", () => {
  it("runs a sandboxed cart that draws + responds to input", async () => {
    const buf = new PixelBuffer();
    const cart = await CartRunner.load(MOVER);
    try {
      cart.setInput({ select: false, accept: false, cancel: false });
      cart.render(buf);
      expect(buf.get(64, 40)).toBe(12); // block starts centred

      cart.setInput({ select: false, accept: true, cancel: false }); // ACCEPT held
      for (let i = 0; i < 8; i++) cart.render(buf);
      expect(buf.get(64, 40)).not.toBe(12); // moved off centre
      expect(buf.get(80, 40)).toBe(12);     // …to x = 64 + 8*2
    } finally {
      cart.dispose();
    }
  });

  it("loads each built-in sample cart without error", async () => {
    for (const sample of SAMPLE_CARTS) {
      const buf = new PixelBuffer();
      const cart = await CartRunner.load(sample.code);
      cart.render(buf);
      cart.render(buf);
      cart.dispose();
      // reaching here means it parsed + ran two frames sandboxed
      expect(buf.width).toBe(128);
    }
  });
});
