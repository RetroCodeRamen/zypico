import { describe, expect, it } from "vitest";
import { DedupeCache, frameKey } from "./dedupe.ts";

describe("DedupeCache", () => {
  it("accepts a frame once and drops repeats", () => {
    const cache = new DedupeCache();
    const k = frameKey(7, 1234);
    expect(cache.check(k)).toBe(true); // first sighting
    expect(cache.check(k)).toBe(false); // duplicate
    expect(cache.check(k)).toBe(false);
  });

  it("treats different (from, packetId) pairs as distinct", () => {
    const cache = new DedupeCache();
    expect(cache.checkFrame(1, 100)).toBe(true);
    expect(cache.checkFrame(2, 100)).toBe(true); // same id, different node
    expect(cache.checkFrame(1, 101)).toBe(true); // same node, different id
    expect(cache.checkFrame(1, 100)).toBe(false); // repeat of the first
  });

  it("has() inspects without recording", () => {
    const cache = new DedupeCache();
    const k = frameKey(3, 9);
    expect(cache.has(k)).toBe(false);
    expect(cache.check(k)).toBe(true);
    expect(cache.has(k)).toBe(true);
  });

  it("evicts the oldest key once over capacity", () => {
    const cache = new DedupeCache(3);
    cache.check("a");
    cache.check("b");
    cache.check("c");
    expect(cache.size).toBe(3);
    cache.check("d"); // evicts "a"
    expect(cache.size).toBe(3);
    expect(cache.has("a")).toBe(false);
    // "b", "c", "d" are still remembered (not duplicates re-accepted).
    expect(cache.check("b")).toBe(false);
    expect(cache.check("c")).toBe(false);
    expect(cache.check("d")).toBe(false);
    // "a" fell out of the window, so it is treated as new again.
    expect(cache.check("a")).toBe(true);
  });

  it("clears all state", () => {
    const cache = new DedupeCache();
    cache.check("x");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.check("x")).toBe(true);
  });

  it("rejects an invalid capacity", () => {
    expect(() => new DedupeCache(0)).toThrow();
  });
});
