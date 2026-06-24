// Bounce — a timing game: a marker sweeps a bar, tap (SELECT or ACCEPT) when it's
// in the target zone to bounce your Wisp (REDESIGN §5). Each hit speeds it up and
// shrinks the zone; a miss ends it.

import { drawText, drawTextCentered } from "@ui/pixel/font.ts";
import { drawWisp } from "@ui/scenes/wisp.ts";
import type { FormDef } from "@core/companion/index.ts";
import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import type { GameInput, WispGame } from "./types.ts";

export class Bounce implements WispGame {
  private pos = 10;
  private dir = 1;
  private speed = 2.4;
  private zoneC = 64;
  private zoneW = 24;
  private score = 0;
  private over = false;
  private bob = 0;
  private prevTap = false;

  constructor(private readonly form: FormDef) { this.place(); }

  private place(): void {
    this.zoneW = Math.max(9, 24 - this.score * 1.2);
    this.zoneC = 22 + Math.random() * 84;
  }
  private reset(): void {
    this.score = 0; this.speed = 2.4; this.over = false; this.pos = 10; this.dir = 1; this.place();
  }

  update(input: GameInput): void {
    const tap = (input.select || input.accept) && !this.prevTap;
    this.prevTap = input.select || input.accept;
    if (this.over) { if (tap) this.reset(); return; }

    this.pos += this.dir * this.speed;
    if (this.pos > 118) { this.pos = 118; this.dir = -1; }
    if (this.pos < 10) { this.pos = 10; this.dir = 1; }
    if (this.bob > 0) this.bob--;

    if (tap) {
      if (Math.abs(this.pos - this.zoneC) < this.zoneW / 2) {
        this.score++; this.speed += 0.35; this.bob = 9; this.place();
      } else {
        this.over = true;
      }
    }
  }

  draw(buf: PixelBuffer, frame: number): void {
    buf.clear(0);
    drawText(buf, 2, 2, `BOUNCE ${this.score}`, 7);
    drawWisp(buf, 64, 34 - this.bob, frame, this.form, 0.6);
    buf.fillRect(8, 60, 112, 3, 5); // the bar
    buf.fillRect((this.zoneC - this.zoneW / 2) | 0, 58, this.zoneW | 0, 7, 3); // target zone
    buf.fillRect((this.pos | 0) - 1, 55, 3, 12, this.over ? 8 : 10); // sweeping marker
    drawTextCentered(buf, 70, this.over ? "MISS! ACCEPT RETRY" : "TAP IN THE GREEN ZONE", this.over ? 8 : 6);
  }
}
