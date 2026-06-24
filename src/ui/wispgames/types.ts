// Wisp minigames (REDESIGN §5): small built-in games you play *with* your Wisp,
// reached from the PLAY care verb. Two-button complete (like Carts): SELECT and
// ACCEPT are the inputs, CANCEL exits. Each game owns its over/restart screen;
// the App applies the "play" Mood effect when you leave.

import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";

export interface GameInput {
  select: boolean;
  accept: boolean;
  cancel: boolean;
}

export interface WispGame {
  /** Advance one frame given the (momentary) input. */
  update(input: GameInput): void;
  /** Render the current frame. */
  draw(buf: PixelBuffer, frame: number): void;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
