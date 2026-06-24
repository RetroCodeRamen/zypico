// Echo — a memory game: your Wisp flashes a SELECT/ACCEPT pattern, you repeat it
// (REDESIGN §5). Each round adds a step; one wrong press ends it.

import { drawText, drawTextCentered } from "@ui/pixel/font.ts";
import { drawWisp } from "@ui/scenes/wisp.ts";
import type { FormDef } from "@core/companion/index.ts";
import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import type { GameInput, WispGame } from "./types.ts";

export class Echo implements WispGame {
  private seq: number[] = []; // 0 = SELECT (left), 1 = ACCEPT (right)
  private phase: "show" | "input" | "over" = "show";
  private showT = 0;
  private inIdx = 0;
  private flash = -1; // currently lit pad (-1 none)
  private flashT = 0;
  private prevS = false;
  private prevA = false;

  constructor(private readonly form: FormDef) { this.addStep(); }

  private addStep(): void {
    this.seq.push(Math.random() < 0.5 ? 0 : 1);
    this.phase = "show"; this.showT = 0; this.inIdx = 0; this.flash = -1;
  }

  update(input: GameInput): void {
    const s = input.select && !this.prevS;
    const a = input.accept && !this.prevA;
    this.prevS = input.select; this.prevA = input.accept;

    if (this.phase === "over") { if (s || a) { this.seq = []; this.addStep(); } return; }

    if (this.phase === "show") {
      const step = 16; // frames per flashed step (lit, then a gap)
      const idx = Math.floor(this.showT / step);
      this.flash = idx < this.seq.length && this.showT % step < 11 ? this.seq[idx] : -1;
      this.showT++;
      if (idx >= this.seq.length) { this.phase = "input"; this.flash = -1; }
      return;
    }

    // input phase
    const press = s ? 0 : a ? 1 : -1;
    if (press >= 0) {
      this.flash = press; this.flashT = 6;
      if (press === this.seq[this.inIdx]) {
        this.inIdx++;
        if (this.inIdx >= this.seq.length) this.addStep(); // round cleared → grow
      } else {
        this.phase = "over";
      }
    } else if (this.flashT > 0) {
      this.flashT--;
      if (this.flashT === 0) this.flash = -1;
    }
  }

  draw(buf: PixelBuffer, frame: number): void {
    buf.clear(1);
    drawText(buf, 2, 2, `ECHO  RND ${this.seq.length}`, 7);
    buf.fillRect(8, 24, 44, 30, this.flash === 0 ? 10 : 5); // left pad (SELECT)
    buf.fillRect(76, 24, 44, 30, this.flash === 1 ? 12 : 5); // right pad (ACCEPT)
    drawText(buf, 22, 36, "SEL", 0);
    drawText(buf, 90, 36, "ACC", 0);
    drawWisp(buf, 64, 38, frame, this.form, 0.5);
    const tag = this.phase === "show" ? "WATCH..." : this.phase === "input" ? "REPEAT!" : "OOPS!";
    drawTextCentered(buf, 60, tag, this.phase === "over" ? 8 : 7);
    if (this.phase === "over") drawTextCentered(buf, 70, "ACCEPT RETRY  CANCEL DONE", 6);
  }
}
