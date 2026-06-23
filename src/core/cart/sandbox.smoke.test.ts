import { describe, expect, it } from "vitest";
import { LuaFactory } from "wasmoon";

// Proves wasmoon works in our toolchain and can be sandboxed: a host function is
// callable from Lua, arithmetic runs, and the dangerous std libs are gone.
describe("wasmoon sandbox smoke", () => {
  it("runs sandboxed Lua that calls a host function", async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      const drawn: number[][] = [];
      lua.global.set("pset", (x: number, y: number, c: number) => drawn.push([x, y, c]));
      // Strip host access — a Cart must not touch io/os/filesystem/network.
      await lua.doString("io=nil os=nil require=nil dofile=nil loadfile=nil package=nil load=nil debug=nil");
      await lua.doString(`
        for i = 0, 2 do pset(i, i * 2, i + 1) end
        result = 6 * 7
      `);
      expect(drawn).toEqual([[0, 0, 1], [1, 2, 2], [2, 4, 3]]);
      expect(lua.global.get("result")).toBe(42);
      expect(lua.global.get("io") ?? null).toBeNull();
      expect(lua.global.get("os") ?? null).toBeNull();
    } finally {
      lua.global.close();
    }
  });
});
