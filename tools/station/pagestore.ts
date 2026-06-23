// Station page hosting (DESIGN §5.2 "Pages are hosted by Stations"). The Station
// caches the latest signed Traveler Page per owner — ones it overhears being
// served, and ones Travelers publish to it — and serves them on PAGE_REQ so a
// page is fetchable even when its owner is offline. Pages are public + signed,
// so the Station relays them verbatim and requesters still verify authorship.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodePage } from "@core/protocol/index.ts";

interface Held { fp: string; updatedAt: number; b64: string }

export class PageStore {
  private items: Held[] = [];

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      try { this.items = JSON.parse(readFileSync(path, "utf8")) as Held[]; } catch { /* start empty */ }
    }
  }

  private persist(): void {
    if (this.path) { try { writeFileSync(this.path, JSON.stringify(this.items)); } catch { /* non-fatal */ } }
  }

  /** Cache a heard/published PAGE payload, keeping the newest per owner.
   *  Returns true if it was stored (new or fresher than what we held). */
  put(payload: Uint8Array): boolean {
    const p = decodePage(payload); // verifies the owner's signature
    if (!p) return false;
    const existing = this.items.find((x) => x.fp === p.fingerprint);
    if (existing && existing.updatedAt >= p.updatedAt) return false;
    this.items = this.items.filter((x) => x.fp !== p.fingerprint);
    this.items.push({ fp: p.fingerprint, updatedAt: p.updatedAt, b64: Buffer.from(payload).toString("base64") });
    this.persist();
    return true;
  }

  /** The cached PAGE payload for an owner, if hosted. */
  get(ownerFp: string): Uint8Array | undefined {
    const held = this.items.find((x) => x.fp === ownerFp);
    return held ? new Uint8Array(Buffer.from(held.b64, "base64")) : undefined;
  }

  get count(): number { return this.items.length; }
}
