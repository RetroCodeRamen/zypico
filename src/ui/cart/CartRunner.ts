// CartRunner — runs a user-authored Lua "Cart" sandboxed (DESIGN/outline §Making).
// The Cart sees only a small drawing + input API and PICO-8-style callbacks
// (_init/_update/_draw); all host access (io/os/filesystem/network/require) is
// stripped, so a Cart authored on one device runs safely on another with zero
// host access. Loading is async (the WASM Lua engine); ticking is synchronous,
// so it slots into the per-frame render loop.

import { LuaEngine, LuaFactory } from "wasmoon";
import { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { drawText } from "@ui/pixel/font.ts";

export interface CartInput { select: boolean; accept: boolean; cancel: boolean }

// Extract row strings from a Lua table passed to spr(), tolerating however
// wasmoon decoded it (JS array, 1-indexed object, or plain object).
function spriteRows(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data.map(String);
  const obj = data as Record<string, unknown>;
  const out: string[] = [];
  for (let i = 1; obj[i] !== undefined; i++) out.push(String(obj[i]));
  return out.length ? out : Object.values(obj).map(String);
}

/** Trim wasmoon's noisy error text to the useful "[string]:line: message" tail. */
export function cleanLuaError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\[string[^\]]*\]:(\d+):\s*(.*)/);
  return m ? `LINE ${m[1]}: ${m[2]}` : msg.split("\n")[0].slice(0, 60);
}

// Remove every ambient capability before any Cart code runs.
const STRIP_HOST = "io=nil os=nil require=nil dofile=nil loadfile=nil package=nil load=nil debug=nil collectgarbage=nil";

/** Host hooks a Cart can reach (kept out of the sandbox so it stays portable). */
export interface CartHost {
  /** Play a tone (Cart `beep`); no-op in headless/test contexts. */
  beep?: (freq: number, durSec: number, wave?: string) => void;
}

export class CartRunner {
  private input: CartInput = { select: false, accept: false, cancel: false };
  private prevInput: CartInput = { select: false, accept: false, cancel: false }; // for btnp edges
  private frame = 0;
  // The matrix the Cart draws into this frame (swapped in by render()).
  private target = new PixelBuffer();
  private update?: () => void;
  private draw?: () => void;
  /** Last runtime error message (for the Workshop preview), or null. */
  private runtimeError: string | null = null;

  private constructor(private readonly lua: LuaEngine, private readonly host: CartHost) {}

  // `wasmUri` points at the bundled Lua WASM so the engine loads offline (the
  // board has no internet). In Node (tests) it's omitted — wasmoon reads it from
  // the package directly. `host` injects optional capabilities (e.g. sound).
  static async load(code: string, wasmUri?: string, host: CartHost = {}): Promise<CartRunner> {
    const lua = await new LuaFactory(wasmUri).createEngine();
    const runner = new CartRunner(lua, host);
    runner.bindApi();
    await lua.doString(STRIP_HOST);
    await lua.doString(code);
    runner.update = lua.global.get("_update") as (() => void) | undefined;
    runner.draw = lua.global.get("_draw") as (() => void) | undefined;
    const init = lua.global.get("_init") as (() => void) | undefined;
    if (typeof init === "function") init();
    return runner;
  }

  // The Cart-facing API: drawing into the current matrix + reading the buttons.
  private bindApi(): void {
    const g = this.lua.global;
    g.set("W", this.target.width);
    g.set("H", this.target.height);
    g.set("cls", (c?: number) => this.target.clear((c ?? 0) | 0));
    g.set("pset", (x: number, y: number, c: number) => this.target.set(x | 0, y | 0, c | 0));
    g.set("pget", (x: number, y: number) => this.target.get(x | 0, y | 0));
    g.set("rectfill", (x: number, y: number, w: number, h: number, c: number) => this.target.fillRect(x | 0, y | 0, w | 0, h | 0, c | 0));
    g.set("rect", (x: number, y: number, w: number, h: number, c: number) => this.target.rect(x | 0, y | 0, w | 0, h | 0, c | 0));
    g.set("circfill", (x: number, y: number, r: number, c: number) => this.target.fillCircle(x | 0, y | 0, r | 0, c | 0));
    g.set("circ", (x: number, y: number, r: number, c: number) => this.target.circle(x | 0, y | 0, r | 0, c | 0));
    g.set("line", (x0: number, y0: number, x1: number, y1: number, c: number) => this.target.line(x0 | 0, y0 | 0, x1 | 0, y1 | 0, c | 0));
    g.set("print", (s: unknown, x: number, y: number, c: number) => drawText(this.target, x | 0, y | 0, String(s).toUpperCase(), c | 0));
    g.set("spr", (x: number, y: number, data: unknown, scale?: number) => this.drawSprite(x | 0, y | 0, data, Math.max(1, (scale as number | undefined ?? 1) | 0)));
    g.set("btn", (b: number) => this.btnDown(b, this.input));
    g.set("btnp", (b: number) => this.btnDown(b, this.input) && !this.btnDown(b, this.prevInput));
    g.set("flr", (n: number) => Math.floor(n));
    g.set("rnd", (n: number) => Math.random() * (n ?? 1));
    g.set("beep", (freq: number, dur: number, wave?: string) => this.host.beep?.(freq, dur, wave));
  }

  private btnDown(b: number, i: CartInput): boolean {
    return b === 0 ? i.select : b === 1 ? i.accept : i.cancel;
  }

  // Blit string-art: `data` is a sequence of row strings, one hex digit (0-f) per
  // pixel, "." or " " = transparent. `scale` draws each pixel as an s×s block.
  private drawSprite(x: number, y: number, data: unknown, scale: number): void {
    const rows = spriteRows(data);
    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry];
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === "." || ch === " ") continue;
        const ci = parseInt(ch, 16);
        if (Number.isNaN(ci)) continue;
        if (scale === 1) this.target.set(x + rx, y + ry, ci);
        else this.target.fillRect(x + rx * scale, y + ry * scale, scale, scale, ci);
      }
    }
  }

  setInput(input: CartInput): void { this.input = input; }

  /** Advance one frame into `buf`: _update then _draw. A buggy Cart can't crash the shell. */
  render(buf: PixelBuffer): void {
    this.target = buf;
    this.lua.global.set("frame", this.frame);
    try {
      this.update?.();
      this.draw?.();
    } catch (e) {
      // Swallow so a buggy Cart can't crash the shell; remember it for the
      // Workshop preview to surface (the Arcade ignores it).
      this.runtimeError = cleanLuaError(e);
    }
    this.prevInput = { ...this.input }; // so btnp() sees this frame's edges next time
    this.frame++;
  }

  /** The last runtime error, if any (Workshop preview). */
  getError(): string | null {
    return this.runtimeError;
  }

  dispose(): void {
    try { this.lua.global.close(); } catch { /* already closed */ }
  }
}
