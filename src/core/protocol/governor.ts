// Airtime governor (plan §5, §8 Phase 1 exit, §11 risk #1).
//
// LoRa is a shared, slow, duty-cycle-limited medium. A handheld that transmits
// greedily ruins the channel for everyone in range and, in EU868, breaks the
// law (1% duty cycle). The governor is how ZyPico stays "a good mesh citizen":
//
//   1. PRIORITIZED QUEUE — ACKs/control jump ahead of interactive messages,
//      which jump ahead of bulk transfers (fragments, content, Carts). A board
//      sync never starves a live IM.
//   2. REGION-AWARE TOKEN BUCKET — a bucket of "spendable airtime ms" refills
//      at the region's duty-cycle rate. Each send debits its measured time on
//      air (airtime.ts). When the bucket is dry, transmission waits.
//   3. ADAPTIVE BACKPRESSURE — once the queue passes a high-water mark, the
//      governor sheds the lowest-priority work first so the queue can't grow
//      without bound on a thin device.
//
// DETERMINISM. The governor owns no timers. It is a pure scheduler: the caller
// drives it (enqueue / drain / poll msUntilNext) and supplies the clock, so the
// whole thing unit-tests with a fake clock and no real radio (plan §9 tier 1).

import { airtimeMs, type ModemParams } from "./airtime.ts";

/** Lower value = served first. */
export enum Priority {
  /** ACK/NACK and other protocol control — never let bulk delay a handshake. */
  CONTROL = 0,
  /** User-facing, latency-sensitive: IM, presence, game moves. */
  INTERACTIVE = 1,
  /** Background transfers: fragments, mail bodies, content, Carts. */
  BULK = 2,
}

export interface GovernorConfig {
  modem: ModemParams;
  /**
   * Fraction of wall time this region permits on air (e.g. 0.01 = EU868's 1%).
   * Conservative by default; the plan calls for staying *within* the limit.
   */
  dutyCycle: number;
  /**
   * Bucket capacity in airtime-ms — the largest burst allowed after an idle
   * spell. Defaults to one frame's worth so a fresh device can send promptly
   * without hoarding a large airtime debt to spend in a burst.
   */
  bucketCapacityMs?: number;
  /** Hard cap on queued frames; enqueue past this sheds by priority. */
  maxQueue?: number;
  now?: () => number;
}

export interface EnqueueOptions {
  priority?: Priority;
  /** Caller's frame metadata, passed back out of drain() untouched. */
  meta?: unknown;
}

export type EnqueueResult =
  | { accepted: true }
  | { accepted: false; reason: "queue-full" };

export interface ReadyFrame {
  payload: Uint8Array;
  priority: Priority;
  airtimeMs: number;
  meta?: unknown;
}

interface Queued extends ReadyFrame {
  seq: number; // FIFO tiebreak within a priority
}

const DEFAULT_MAX_QUEUE = 256;

export class AirtimeGovernor {
  private readonly queue: Queued[] = [];
  private readonly now: () => number;
  private readonly capacityMs: number;
  private readonly maxQueue: number;

  private tokensMs: number;
  private lastRefill: number;
  private seqCounter = 0;

  constructor(private readonly config: GovernorConfig) {
    if (config.dutyCycle <= 0 || config.dutyCycle > 1) {
      throw new RangeError("dutyCycle must be in (0, 1]");
    }
    this.now = config.now ?? Date.now;
    // Default the burst to one max-size frame's airtime (255-byte PHY payload).
    this.capacityMs = config.bucketCapacityMs ?? airtimeMs(config.modem, 255);
    this.maxQueue = config.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.tokensMs = this.capacityMs; // start with a full bucket
    this.lastRefill = this.now();
  }

  get queueLength(): number {
    return this.queue.length;
  }

  /** Current spendable airtime, in ms (refreshed to "now"). */
  get availableMs(): number {
    this.refill();
    return this.tokensMs;
  }

  /** Estimated airtime for a frame of `payloadBytes` under this modem. */
  estimate(payloadBytes: number): number {
    return airtimeMs(this.config.modem, payloadBytes);
  }

  /** Queue pressure in [0,1] for adaptive callers (1 = at the hard cap). */
  pressure(): number {
    return this.queue.length / this.maxQueue;
  }

  enqueue(payload: Uint8Array, opts: EnqueueOptions = {}): EnqueueResult {
    const priority = opts.priority ?? Priority.INTERACTIVE;
    if (this.queue.length >= this.maxQueue) {
      // Backpressure: try to make room by dropping a strictly-lower-priority
      // (higher number) frame; otherwise refuse this one.
      if (!this.shedFor(priority)) return { accepted: false, reason: "queue-full" };
    }
    this.queue.push({
      payload,
      priority,
      airtimeMs: this.estimate(payload.length),
      meta: opts.meta,
      seq: this.seqCounter++,
    });
    return { accepted: true };
  }

  /**
   * Pop the next frame the device may transmit *right now* — highest priority
   * first, but only if the bucket can pay for its airtime. Debits the bucket.
   * Returns undefined if the queue is empty or the next frame can't be afforded
   * yet (poll msUntilNext to know when to retry).
   */
  next(): ReadyFrame | undefined {
    if (this.queue.length === 0) return undefined;
    this.refill();
    const idx = this.bestIndex();
    const candidate = this.queue[idx];
    if (candidate.airtimeMs > this.tokensMs) return undefined;
    this.queue.splice(idx, 1);
    this.tokensMs -= candidate.airtimeMs;
    const { seq: _seq, ...frame } = candidate;
    return frame;
  }

  /**
   * Drain every frame that can be sent now, in priority order, calling `send`
   * for each. Stops as soon as the bucket can't afford the next-best frame.
   */
  drain(send: (frame: ReadyFrame) => void): number {
    let sent = 0;
    for (;;) {
      const frame = this.next();
      if (!frame) break;
      send(frame);
      sent++;
    }
    return sent;
  }

  /**
   * Milliseconds until the highest-priority queued frame can be afforded.
   * 0 if one is ready now; undefined if the queue is empty.
   */
  msUntilNext(): number | undefined {
    if (this.queue.length === 0) return undefined;
    this.refill();
    const candidate = this.queue[this.bestIndex()];
    const deficit = candidate.airtimeMs - this.tokensMs;
    if (deficit <= 0) return 0;
    return Math.ceil(deficit / this.config.dutyCycle);
  }

  private bestIndex(): number {
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) {
        best = i;
      }
    }
    return best;
  }

  // Drop the lowest-priority, newest frame to admit one of `incoming` priority.
  // Returns true if room was made.
  private shedFor(incoming: Priority): boolean {
    let victim = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.priority <= incoming) continue;
      if (victim === -1 || q.priority > this.queue[victim].priority ||
        (q.priority === this.queue[victim].priority && q.seq > this.queue[victim].seq)) {
        victim = i;
      }
    }
    if (victim === -1) return false;
    this.queue.splice(victim, 1);
    return true;
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokensMs = Math.min(this.capacityMs, this.tokensMs + elapsed * this.config.dutyCycle);
    this.lastRefill = t;
  }
}
