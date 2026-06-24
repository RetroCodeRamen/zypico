// Snackfall — catch the falling snacks with your Wisp (REDESIGN §5). SELECT/ACCEPT
// slide the Wisp left/right; catch to score, miss three and it's over.

import { drawText, drawTextCentered } from "@ui/pixel/font.ts";
import { drawWisp } from "@ui/scenes/wisp.ts";
import type { FormDef } from "@core/companion/index.ts";
import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { clamp, type GameInput, type WispGame } from "./types.ts";

interface Snack { x: number; y: number; v: number }

export class Snackfall implements WispGame {
  private x = 64;
  private snacks: Snack[] = [];
  private score = 0;
  private lives = 3;
  private t = 0;
  private over = false;
  private prevA = false;

  constructor(private readonly form: FormDef) {}

  private reset(): void {
    this.x = 64; this.snacks = []; this.score = 0; this.lives = 3; this.t = 0; this.over = false;
  }

  update(input: GameInput): void {
    const tap = (input.accept || input.select) && !this.prevA;
    this.prevA = input.accept || input.select;
    if (this.over) { if (tap) this.reset(); return; }

    if (input.select) this.x -= 4;
    if (input.accept) this.x += 4;
    this.x = clamp(this.x, 11, 117);

    this.t++;
    const interval = Math.max(14, 34 - this.score); // spawns quicken as you score
    if (this.t % interval === 0) this.snacks.push({ x: 10 + Math.random() * 108, y: 8, v: 1 + this.score * 0.04 });

    this.snacks = this.snacks.filter((s) => {
      s.y += s.v;
      if (s.y >= 60 && s.y <= 70 && Math.abs(s.x - this.x) < 10) { this.score++; return false; } // caught
      if (s.y > 74) { this.lives--; if (this.lives <= 0) this.over = true; return false; } // missed
      return true;
    });
  }

  draw(buf: PixelBuffer, frame: number): void {
    buf.clear(0);
    drawText(buf, 2, 2, `SNACKFALL ${this.score}`, 7);
    drawText(buf, buf.width - 14, 2, `x${this.lives}`, 8);
    for (const s of this.snacks) { buf.fillCircle(s.x | 0, s.y | 0, 2, 9); buf.set((s.x | 0), (s.y | 0) - 2, 4); }
    buf.fillRect(this.x - 10, 70, 20, 2, 5); // a little ledge under the Wisp
    drawWisp(buf, this.x | 0, 64, frame, this.form, 0.5);
    if (this.over) {
      buf.fillRect(0, 34, buf.width, 18, 1);
      drawTextCentered(buf, 36, `CAUGHT ${this.score}`, 10);
      drawTextCentered(buf, 44, "ACCEPT RETRY  CANCEL DONE", 6);
    }
  }
}
