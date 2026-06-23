// Station Cart hosting (DESIGN §Making / §5). The Station caches the signed Cart
// payloads it overhears / is published, keyed by author+name, and serves them on
// CART_REQ — so Carts stay distributable even when the author is offline. Carts
// are public + signed, so the Station relays them verbatim (never forges).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodeCart } from "@core/protocol/index.ts";

interface Held { authorFp: string; name: string; b64: string }

export class CartStore {
  private items: Held[] = [];

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      try { this.items = JSON.parse(readFileSync(path, "utf8")) as Held[]; } catch { /* start empty */ }
    }
  }

  private persist(): void {
    if (this.path) { try { writeFileSync(this.path, JSON.stringify(this.items)); } catch { /* non-fatal */ } }
  }

  /** Cache a signed CART payload (keyed by author+name, last wins). True if stored. */
  put(payload: Uint8Array): boolean {
    const c = decodeCart(payload); // verifies the author signature
    if (!c) return false;
    this.items = this.items.filter((x) => !(x.authorFp === c.authorFp && x.name === c.name));
    this.items.push({ authorFp: c.authorFp, name: c.name, b64: Buffer.from(payload).toString("base64") });
    this.persist();
    return true;
  }

  get(authorFp: string, name: string): Uint8Array | undefined {
    const held = this.items.find((x) => x.authorFp === authorFp && x.name === name);
    return held ? new Uint8Array(Buffer.from(held.b64, "base64")) : undefined;
  }

  get count(): number { return this.items.length; }
}
