import { describe, expect, it } from "vitest";
import {
  caretDown, caretLeft, caretRight, caretRowCol, caretUp, cleanName,
  CODE_MAX, deleteBack, insertAt, lines, rowColToCaret,
} from "./editor.ts";

describe("workshop editor — text model", () => {
  it("inserts at the caret and advances it", () => {
    const r = insertAt("ac", 1, "b");
    expect(r.code).toBe("abc");
    expect(r.caret).toBe(2);
  });

  it("refuses to insert past the code cap", () => {
    const big = "x".repeat(CODE_MAX);
    const r = insertAt(big, big.length, "y");
    expect(r.code).toBe(big); // unchanged
  });

  it("backspaces the char before the caret", () => {
    const r = deleteBack("abc", 2);
    expect(r.code).toBe("ac");
    expect(r.caret).toBe(1);
  });

  it("backspace at start is a no-op", () => {
    expect(deleteBack("abc", 0)).toEqual({ code: "abc", caret: 0 });
  });

  it("clamps caret movement to the buffer", () => {
    expect(caretLeft("ab", 0)).toBe(0);
    expect(caretRight("ab", 2)).toBe(2);
  });

  it("computes row/col across newlines", () => {
    // "ab\ncd", caret after 'c' (index 4) → row 1, col 1
    expect(caretRowCol("ab\ncd", 4)).toEqual({ row: 1, col: 1 });
    expect(lines("ab\ncd")).toEqual(["ab", "cd"]);
  });

  it("moves up/down keeping the column where possible", () => {
    const code = "abcd\nef\nghij";
    // caret at row 2 col 3 (index: 4+1 +2+1 +3 = 11) → up → row 1 clamps col to 2
    const up = caretUp(code, 11);
    expect(caretRowCol(code, up)).toEqual({ row: 1, col: 2 });
    // down from there → back toward row 2, col clamps to 2
    const down = caretDown(code, up);
    expect(caretRowCol(code, down).row).toBe(2);
  });

  it("rowColToCaret round-trips with caretRowCol", () => {
    const code = "one\ntwo\nthree";
    const idx = rowColToCaret(code, 2, 3);
    expect(caretRowCol(code, idx)).toEqual({ row: 2, col: 3 });
  });

  it("cleans names: caps, strips junk, falls back", () => {
    expect(cleanName("  my game!! ")).toBe("MY GAME");
    expect(cleanName("@@@")).toBe("MYCART");
    expect(cleanName("a".repeat(40)).length).toBe(16);
  });
});
