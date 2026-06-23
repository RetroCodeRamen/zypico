import { describe, expect, it } from "vitest";
import {
  compareHlc,
  decodeHlc,
  encodeHlc,
  HLC_LEN,
  HybridLogicalClock,
  hlcEqual,
  type HlcTimestamp,
} from "./hlc.ts";

// A controllable physical clock so the HLC is deterministic under test.
function fakeClock(start = 1_000) {
  let t = start;
  const fn = () => t;
  fn.set = (v: number) => (t = v);
  fn.advance = (d: number) => (t += d);
  return fn;
}

describe("HLC encode/decode", () => {
  it("round-trips a timestamp through 8 bytes", () => {
    const ts: HlcTimestamp = { wallMs: 1_718_000_000_123, counter: 42 };
    const bytes = encodeHlc(ts);
    expect(bytes.length).toBe(HLC_LEN);
    expect(decodeHlc(bytes)).toEqual(ts);
  });

  it("handles a large 48-bit wall and max counter", () => {
    const ts: HlcTimestamp = { wallMs: 2 ** 48 - 1, counter: 0xffff };
    expect(decodeHlc(encodeHlc(ts))).toEqual(ts);
  });

  it("decodes from an offset inside a larger buffer", () => {
    const ts: HlcTimestamp = { wallMs: 5, counter: 9 };
    const buf = new Uint8Array(2 + HLC_LEN);
    buf.set(encodeHlc(ts), 2);
    expect(decodeHlc(buf, 2)).toEqual(ts);
  });

  it("rejects out-of-range values and short buffers", () => {
    expect(() => encodeHlc({ wallMs: -1, counter: 0 })).toThrow();
    expect(() => encodeHlc({ wallMs: 0, counter: 0x1_0000 })).toThrow();
    expect(() => decodeHlc(new Uint8Array(4))).toThrow();
  });
});

describe("HLC compare", () => {
  it("orders by wall first, then counter", () => {
    expect(compareHlc({ wallMs: 1, counter: 9 }, { wallMs: 2, counter: 0 })).toBe(-1);
    expect(compareHlc({ wallMs: 2, counter: 0 }, { wallMs: 2, counter: 1 })).toBe(-1);
    expect(compareHlc({ wallMs: 2, counter: 5 }, { wallMs: 2, counter: 5 })).toBe(0);
    expect(hlcEqual({ wallMs: 2, counter: 5 }, { wallMs: 2, counter: 5 })).toBe(true);
  });
});

describe("HybridLogicalClock", () => {
  it("bumps the counter for events inside the same millisecond", () => {
    const clock = fakeClock(1_000);
    const hlc = new HybridLogicalClock(clock);
    expect(hlc.send()).toEqual({ wallMs: 1_000, counter: 0 });
    expect(hlc.send()).toEqual({ wallMs: 1_000, counter: 1 });
    expect(hlc.send()).toEqual({ wallMs: 1_000, counter: 2 });
  });

  it("resets the counter when physical time advances", () => {
    const clock = fakeClock(1_000);
    const hlc = new HybridLogicalClock(clock);
    hlc.send();
    hlc.send();
    clock.advance(5);
    expect(hlc.send()).toEqual({ wallMs: 1_005, counter: 0 });
  });

  it("never goes backwards if the physical clock jumps back", () => {
    const clock = fakeClock(1_000);
    const hlc = new HybridLogicalClock(clock);
    hlc.send(); // wall 1000
    clock.set(900); // clock skews backward
    const ts = hlc.send();
    expect(ts.wallMs).toBe(1_000);
    expect(ts.counter).toBe(1);
  });

  it("advances past a remote timestamp ahead of us (causality)", () => {
    const clock = fakeClock(1_000);
    const hlc = new HybridLogicalClock(clock);
    const remote: HlcTimestamp = { wallMs: 5_000, counter: 3 };
    const merged = hlc.recv(remote);
    expect(merged.wallMs).toBe(5_000);
    expect(merged.counter).toBe(4);
    // A subsequent local event sorts strictly after what we heard.
    expect(compareHlc(remote, hlc.send())).toBe(-1);
  });

  it("merges counters on a wall tie between local, remote, and physical", () => {
    const clock = fakeClock(2_000);
    const hlc = new HybridLogicalClock(clock);
    hlc.send(); // local at wall 2000, counter 0
    const merged = hlc.recv({ wallMs: 2_000, counter: 7 });
    expect(merged.wallMs).toBe(2_000);
    expect(merged.counter).toBe(8); // max(0, 7) + 1
  });

  it("keeps two clocks causally ordered across a send/recv exchange", () => {
    const a = new HybridLogicalClock(fakeClock(1_000));
    const b = new HybridLogicalClock(fakeClock(1_000));
    const m1 = a.send();
    const m2 = b.recv(m1);
    const m3 = b.send();
    expect(compareHlc(m1, m2)).toBe(-1);
    expect(compareHlc(m2, m3)).toBe(-1);
  });
});
