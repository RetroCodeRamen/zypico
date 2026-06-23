// Station mailbox — store-and-forward for Mail (DESIGN §4.4). A Station holds the
// opaque, E2E-sealed Mail envelopes it hears (it can read the routing header —
// recipient + mailId — but never the body), re-sends them when the recipient
// appears, and drops them once the recipient acks. Optionally file-backed so a
// Station restart doesn't lose held mail (it stays encrypted at rest).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodeMail } from "@core/protocol/index.ts";

interface Held { recipientFp: string; mailId: number; b64: string }

export class Mailbox {
  private items: Held[] = [];

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      try { this.items = JSON.parse(readFileSync(path, "utf8")) as Held[]; } catch { /* start empty */ }
    }
  }

  private persist(): void {
    if (this.path) { try { writeFileSync(this.path, JSON.stringify(this.items)); } catch { /* non-fatal */ } }
  }

  /** Hold a heard MAIL payload (opaque envelope). Returns true if newly held. */
  store(payload: Uint8Array): boolean {
    const env = decodeMail(payload);
    if (!env) return false;
    if (this.items.some((x) => x.recipientFp === env.recipientFp && x.mailId === env.mailId)) return false;
    this.items.push({ recipientFp: env.recipientFp, mailId: env.mailId, b64: Buffer.from(payload).toString("base64") });
    this.persist();
    return true;
  }

  /** The payloads to (re)send for a recipient that just came into range. */
  forwardFor(recipientFp: string): Uint8Array[] {
    return this.items.filter((x) => x.recipientFp === recipientFp).map((x) => new Uint8Array(Buffer.from(x.b64, "base64")));
  }

  /** Drop a held mail once its recipient has acked it. Returns true if removed. */
  drop(recipientFp: string, mailId: number): boolean {
    const before = this.items.length;
    this.items = this.items.filter((x) => !(x.recipientFp === recipientFp && x.mailId === mailId));
    const removed = this.items.length !== before;
    if (removed) this.persist();
    return removed;
  }

  get count(): number { return this.items.length; }
}
