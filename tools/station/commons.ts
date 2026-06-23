// Station Commons memory (DESIGN §4.4). A Station retains recent Commons posts
// (~50, deduped by sender+HLC) and replays them on a COMMONS_REQ, so a Traveler
// who just arrived sees a living town square instead of an empty room. Posts are
// public + signed-by-handle text; the Station stores them verbatim and replays
// them as POST frames (the requester HLC-orders + dedupes on receipt).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { bytesToHex } from "@noble/hashes/utils";
import { decodeRoomMsg } from "@core/protocol/social.ts";

interface Held { key: string; b64: string }

export class CommonsLog {
  private items: Held[] = [];

  constructor(private readonly cap = 50, private readonly path?: string) {
    if (path && existsSync(path)) {
      try { this.items = JSON.parse(readFileSync(path, "utf8")) as Held[]; } catch { /* start empty */ }
    }
  }

  private persist(): void {
    if (this.path) { try { writeFileSync(this.path, JSON.stringify(this.items)); } catch { /* non-fatal */ } }
  }

  /** Retain a heard POST payload (deduped by sender+HLC). Returns true if new. */
  add(payload: Uint8Array): boolean {
    const m = decodeRoomMsg(payload);
    if (!m) return false;
    const key = `${m.senderFp}:${bytesToHex(m.hlc)}`;
    if (this.items.some((x) => x.key === key)) return false;
    this.items.push({ key, b64: Buffer.from(payload).toString("base64") });
    if (this.items.length > this.cap) this.items = this.items.slice(-this.cap);
    this.persist();
    return true;
  }

  /** The most recent `n` stored POST payloads (oldest→newest) for backfill. */
  recent(n: number): Uint8Array[] {
    return this.items.slice(-n).map((x) => new Uint8Array(Buffer.from(x.b64, "base64")));
  }

  get count(): number { return this.items.length; }
}
