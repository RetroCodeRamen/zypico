// Hybrid Logical Clock (plan §5 — "HLC ordering"; outline §11.3).
//
// The mesh has no shared wall clock and no server, yet boards, threads, and
// game/bout logs need a sensible, causal order that survives loss and delay
// (plan §8 Phase 4 exit). An HLC gives every event a timestamp that
//   - tracks physical time closely enough to read like real time, AND
//   - never goes backwards and always reflects causality: if event A is heard
//     before B is created, A's timestamp sorts before B's.
//
// Algorithm: Kulkarni et al. We keep a logical wall component `wallMs` and a
// `counter`. On a local event (`send`) we advance to max(lastWall, now); ties
// bump the counter. On receiving a remote timestamp (`recv`) we advance past
// both our own and the peer's, merging counters on a tie. The local node's
// physical clock is injectable so the engine is fully deterministic under test
// (plan §9 tier 1 — "no wall-clock … in test").
//
// Wire form: a fixed 8 bytes, big-endian — 48-bit millisecond wall + 16-bit
// counter. 48 bits of milliseconds runs out around the year 10889; 16 bits
// allows 65 536 events inside a single millisecond before we borrow from the
// wall. Eight bytes is a deliberate, budgeted cost (plan §12 byte discipline).

export const HLC_LEN = 8;

const WALL_BITS = 48;
const COUNTER_MAX = 0xffff; // 16-bit counter
const WALL_MAX = 2 ** WALL_BITS - 1;

export interface HlcTimestamp {
  /** Logical wall-clock component, milliseconds since the Unix epoch. */
  readonly wallMs: number;
  /** Tie-breaking counter for events sharing a wall value (0…65535). */
  readonly counter: number;
}

/** Total order over timestamps: wall first, then counter. */
export function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return 0;
}

export function hlcEqual(a: HlcTimestamp, b: HlcTimestamp): boolean {
  return a.wallMs === b.wallMs && a.counter === b.counter;
}

export function encodeHlc(ts: HlcTimestamp): Uint8Array {
  if (ts.wallMs < 0 || ts.wallMs > WALL_MAX) {
    throw new RangeError("HLC wallMs out of 48-bit range");
  }
  if (ts.counter < 0 || ts.counter > COUNTER_MAX) {
    throw new RangeError("HLC counter out of 16-bit range");
  }
  const out = new Uint8Array(HLC_LEN);
  // 48-bit wall, big-endian, across bytes 0..5. Bit ops top out at 32 bits in
  // JS, so split the wall into a high and low half by arithmetic.
  const high = Math.floor(ts.wallMs / 0x1_0000_0000); // top 16 bits
  const low = ts.wallMs % 0x1_0000_0000; // bottom 32 bits
  out[0] = (high >> 8) & 0xff;
  out[1] = high & 0xff;
  out[2] = (low >>> 24) & 0xff;
  out[3] = (low >>> 16) & 0xff;
  out[4] = (low >>> 8) & 0xff;
  out[5] = low & 0xff;
  out[6] = (ts.counter >> 8) & 0xff;
  out[7] = ts.counter & 0xff;
  return out;
}

export function decodeHlc(bytes: Uint8Array, offset = 0): HlcTimestamp {
  if (bytes.length - offset < HLC_LEN) {
    throw new RangeError("HLC needs 8 bytes");
  }
  const high = (bytes[offset] << 8) | bytes[offset + 1];
  const low =
    bytes[offset + 2] * 0x100_0000 +
    (bytes[offset + 3] << 16) +
    (bytes[offset + 4] << 8) +
    bytes[offset + 5];
  const wallMs = high * 0x1_0000_0000 + low;
  const counter = (bytes[offset + 6] << 8) | bytes[offset + 7];
  return { wallMs, counter };
}

export class HybridLogicalClock {
  private wallMs = 0;
  private counter = 0;

  /** @param now physical clock; injectable so tests stay deterministic. */
  constructor(private readonly now: () => number = Date.now) {}

  /** Current state without advancing (for inspection/tests). */
  peek(): HlcTimestamp {
    return { wallMs: this.wallMs, counter: this.counter };
  }

  /** Stamp a locally originated event and advance the clock. */
  send(): HlcTimestamp {
    const pt = Math.floor(this.now());
    const prevWall = this.wallMs;
    this.wallMs = Math.max(prevWall, pt);
    this.counter = this.wallMs === prevWall ? this.counter + 1 : 0;
    this.normalize();
    return this.peek();
  }

  /** Merge a timestamp heard from a peer and advance past it. */
  recv(remote: HlcTimestamp): HlcTimestamp {
    const pt = Math.floor(this.now());
    const prevWall = this.wallMs;
    const prevCounter = this.counter;
    this.wallMs = Math.max(prevWall, remote.wallMs, pt);
    if (this.wallMs === prevWall && this.wallMs === remote.wallMs) {
      this.counter = Math.max(prevCounter, remote.counter) + 1;
    } else if (this.wallMs === prevWall) {
      this.counter = prevCounter + 1;
    } else if (this.wallMs === remote.wallMs) {
      this.counter = remote.counter + 1;
    } else {
      this.counter = 0;
    }
    this.normalize();
    return this.peek();
  }

  // A counter that overflows 16 bits borrows one millisecond from the wall.
  // This keeps timestamps monotone even under an implausible event storm.
  private normalize(): void {
    while (this.counter > COUNTER_MAX) {
      this.wallMs += 1;
      this.counter -= COUNTER_MAX + 1;
    }
    if (this.wallMs > WALL_MAX) {
      throw new RangeError("HLC wall overflow");
    }
  }
}
