import { describe, expect, it } from "vitest";
import { AirtimeGovernor, Priority } from "./governor.ts";
import { MODEM_PRESETS } from "./airtime.ts";

function fakeClock(start = 0) {
  let t = start;
  const fn = () => t;
  fn.advance = (d: number) => (t += d);
  return fn;
}

const payload = (n: number) => new Uint8Array(n);

// A governor with a generous bucket so scheduling/priority tests aren't gated
// by airtime; token-bucket tests below set a tight capacity on purpose.
function looseGovernor(now = fakeClock()) {
  return new AirtimeGovernor({
    modem: MODEM_PRESETS.LONG_FAST,
    dutyCycle: 0.01,
    bucketCapacityMs: 1_000_000,
    now,
  });
}

describe("AirtimeGovernor — priority queue", () => {
  it("serves CONTROL before INTERACTIVE before BULK", () => {
    const g = looseGovernor();
    g.enqueue(payload(10), { priority: Priority.BULK, meta: "bulk" });
    g.enqueue(payload(10), { priority: Priority.CONTROL, meta: "ctrl" });
    g.enqueue(payload(10), { priority: Priority.INTERACTIVE, meta: "im" });

    const order: unknown[] = [];
    g.drain((f) => order.push(f.meta));
    expect(order).toEqual(["ctrl", "im", "bulk"]);
  });

  it("preserves FIFO order within a priority", () => {
    const g = looseGovernor();
    g.enqueue(payload(10), { priority: Priority.INTERACTIVE, meta: 1 });
    g.enqueue(payload(10), { priority: Priority.INTERACTIVE, meta: 2 });
    g.enqueue(payload(10), { priority: Priority.INTERACTIVE, meta: 3 });
    const order: unknown[] = [];
    g.drain((f) => order.push(f.meta));
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("AirtimeGovernor — token bucket", () => {
  it("blocks when the bucket can't afford the next frame, then recovers", () => {
    const clock = fakeClock();
    const one = MODEM_PRESETS.LONG_FAST; // ~395 ms for 20 bytes
    const probe = new AirtimeGovernor({ modem: one, dutyCycle: 0.01, now: clock });
    const cost = probe.estimate(20);

    const g = new AirtimeGovernor({
      modem: one,
      dutyCycle: 0.01,
      bucketCapacityMs: cost, // exactly one frame's worth
      now: clock,
    });
    g.enqueue(payload(20));
    g.enqueue(payload(20));

    // First send drains the bucket; second can't be afforded yet.
    expect(g.next()).toBeDefined();
    expect(g.next()).toBeUndefined();

    const wait = g.msUntilNext();
    expect(wait).toBeGreaterThan(0);
    // Refilling at the duty cycle for `wait` ms restores one frame of airtime.
    clock.advance(wait!);
    expect(g.next()).toBeDefined();
    expect(g.msUntilNext()).toBeUndefined(); // queue drained
  });

  it("refills tokens over time, capped at capacity", () => {
    const clock = fakeClock();
    const g = new AirtimeGovernor({
      modem: MODEM_PRESETS.LONG_FAST,
      dutyCycle: 0.01,
      bucketCapacityMs: 500,
      now: clock,
    });
    // Spend the whole bucket.
    g.enqueue(payload(20));
    g.next();
    expect(g.availableMs).toBeLessThan(500);
    // Wait a very long time; tokens cap at capacity, not beyond.
    clock.advance(10_000_000);
    expect(g.availableMs).toBe(500);
  });

  it("reports msUntilNext as 0 when a frame is ready now", () => {
    const g = looseGovernor();
    g.enqueue(payload(10));
    expect(g.msUntilNext()).toBe(0);
  });
});

describe("AirtimeGovernor — backpressure", () => {
  it("rejects a low-priority frame when the queue is full", () => {
    const g = new AirtimeGovernor({
      modem: MODEM_PRESETS.LONG_FAST,
      dutyCycle: 0.01,
      bucketCapacityMs: 1_000_000,
      maxQueue: 2,
      now: fakeClock(),
    });
    expect(g.enqueue(payload(10), { priority: Priority.INTERACTIVE }).accepted).toBe(true);
    expect(g.enqueue(payload(10), { priority: Priority.INTERACTIVE }).accepted).toBe(true);
    // No lower-priority frame to shed for an incoming BULK → refused.
    const bulk = g.enqueue(payload(10), { priority: Priority.BULK });
    expect(bulk.accepted).toBe(false);
    if (!bulk.accepted) expect(bulk.reason).toBe("queue-full");
  });

  it("sheds a lower-priority frame to admit a higher-priority one", () => {
    const g = new AirtimeGovernor({
      modem: MODEM_PRESETS.LONG_FAST,
      dutyCycle: 0.01,
      bucketCapacityMs: 1_000_000,
      maxQueue: 2,
      now: fakeClock(),
    });
    g.enqueue(payload(10), { priority: Priority.BULK, meta: "bulk-a" });
    g.enqueue(payload(10), { priority: Priority.BULK, meta: "bulk-b" });
    // Queue full of BULK; a CONTROL frame evicts the newest BULK and is admitted.
    expect(g.enqueue(payload(10), { priority: Priority.CONTROL, meta: "ctrl" }).accepted).toBe(true);

    const order: unknown[] = [];
    g.drain((f) => order.push(f.meta));
    expect(order[0]).toBe("ctrl");
    expect(order).toContain("bulk-a");
    expect(order).not.toContain("bulk-b"); // newest BULK was shed
    expect(order.length).toBe(2);
  });

  it("reports queue pressure", () => {
    const g = new AirtimeGovernor({
      modem: MODEM_PRESETS.LONG_FAST,
      dutyCycle: 0.01,
      maxQueue: 4,
      now: fakeClock(),
    });
    g.enqueue(payload(10));
    g.enqueue(payload(10));
    expect(g.pressure()).toBe(0.5);
  });

  it("rejects an invalid duty cycle", () => {
    expect(() => new AirtimeGovernor({ modem: MODEM_PRESETS.LONG_FAST, dutyCycle: 0 })).toThrow();
    expect(() => new AirtimeGovernor({ modem: MODEM_PRESETS.LONG_FAST, dutyCycle: 2 })).toThrow();
  });
});
