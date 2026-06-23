// Dedupe cache (plan §5 — "dedupe"; outline §11.3).
//
// A LoRa mesh floods: the same packet reaches us by several paths, and our own
// retransmissions echo back. The protocol spine must drop a frame it has
// already accepted before any sub-type handler runs, or the user sees doubled
// messages and game engines replay moves. Meshtastic stamps every packet with
// a sender-assigned 32-bit id; the pair (fromNode, packetId) identifies a frame
// uniquely well enough for our purposes.
//
// This is a bounded, insertion-ordered seen-set: O(1) check/insert, oldest keys
// evicted once the cache is full. The bound matters on a memory-thin handheld
// (plan §10 — no unbounded growth on the T-Deck). It is purely in-memory and
// deterministic; no timers, so it unit-tests without a clock.

/** Build the dedupe key for a heard frame. */
export function frameKey(fromNode: number, packetId: number): string {
  return `${fromNode}:${packetId}`;
}

export class DedupeCache {
  // A Map preserves insertion order, giving us FIFO eviction for free.
  private readonly seen = new Map<string, true>();

  constructor(private readonly capacity = 512) {
    if (capacity < 1) throw new RangeError("dedupe capacity must be >= 1");
  }

  get size(): number {
    return this.seen.size;
  }

  /** True if this key has been recorded as seen (without recording it). */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  /**
   * Record a key and report whether it is NEW.
   * @returns true if the frame should be accepted (first sighting),
   *          false if it is a duplicate and should be dropped.
   */
  check(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.set(key, true);
    if (this.seen.size > this.capacity) {
      // Evict the oldest entry (first key in insertion order).
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  /** Convenience: dedupe directly from (fromNode, packetId). */
  checkFrame(fromNode: number, packetId: number): boolean {
    return this.check(frameKey(fromNode, packetId));
  }

  clear(): void {
    this.seen.clear();
  }
}
