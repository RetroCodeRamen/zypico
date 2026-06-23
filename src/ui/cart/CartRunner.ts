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

// Remove every ambient capability before any Cart code runs.
const STRIP_HOST = "io=nil os=nil require=nil dofile=nil loadfile=nil package=nil load=nil debug=nil collectgarbage=nil";

export class CartRunner {
  private input: CartInput = { select: false, accept: false, cancel: false };
  private frame = 0;
  // The matrix the Cart draws into this frame (swapped in by render()).
  private target = new PixelBuffer();
  private update?: () => void;
  private draw?: () => void;

  private constructor(private readonly lua: LuaEngine) {}

  // `wasmUri` points at the bundled Lua WASM so the engine loads offline (the
  // board has no internet). In Node (tests) it's omitted — wasmoon reads it from
  // the package directly.
  static async load(code: string, wasmUri?: string): Promise<CartRunner> {
    const lua = await new LuaFactory(wasmUri).createEngine();
    const runner = new CartRunner(lua);
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
    g.set("rectfill", (x: number, y: number, w: number, h: number, c: number) => this.target.fillRect(x | 0, y | 0, w | 0, h | 0, c | 0));
    g.set("circfill", (x: number, y: number, r: number, c: number) => this.target.fillCircle(x | 0, y | 0, r | 0, c | 0));
    g.set("print", (s: unknown, x: number, y: number, c: number) => drawText(this.target, x | 0, y | 0, String(s).toUpperCase(), c | 0));
    g.set("btn", (b: number) => (b === 0 ? this.input.select : b === 1 ? this.input.accept : this.input.cancel));
    g.set("flr", (n: number) => Math.floor(n));
    g.set("rnd", (n: number) => Math.random() * (n ?? 1));
  }

  setInput(input: CartInput): void { this.input = input; }

  /** Advance one frame into `buf`: _update then _draw. A buggy Cart can't crash the shell. */
  render(buf: PixelBuffer): void {
    this.target = buf;
    this.lua.global.set("frame", this.frame);
    try {
      this.update?.();
      this.draw?.();
    } catch {
      /* swallow Cart errors — the shell keeps running */
    }
    this.frame++;
  }

  dispose(): void {
    try { this.lua.global.close(); } catch { /* already closed */ }
  }
}
