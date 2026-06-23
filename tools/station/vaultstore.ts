// Station Account-Vault storage (DESIGN §5.4, §7). The Station keeps the newest
// **opaque ciphertext** per owner and serves it back on request. It never sees
// the password or the plaintext — encryption is entirely client-side.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodeVault } from "@core/protocol/index.ts";

interface Held { ownerFp: string; updatedAt: number; b64: string }

export class VaultStore {
  private items: Held[] = [];

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      try { this.items = JSON.parse(readFileSync(path, "utf8")) as Held[]; } catch { /* start empty */ }
    }
  }

  private persist(): void {
    if (this.path) { try { writeFileSync(this.path, JSON.stringify(this.items)); } catch { /* non-fatal */ } }
  }

  /** Store a VAULT_PUT payload, keeping the newest per owner. Returns true if kept. */
  put(payload: Uint8Array): boolean {
    const v = decodeVault(payload);
    if (!v) return false;
    const existing = this.items.find((x) => x.ownerFp === v.ownerFp);
    if (existing && existing.updatedAt >= v.updatedAt) return false;
    this.items = this.items.filter((x) => x.ownerFp !== v.ownerFp);
    this.items.push({ ownerFp: v.ownerFp, updatedAt: v.updatedAt, b64: Buffer.from(payload).toString("base64") });
    this.persist();
    return true;
  }

  /** The stored VAULT payload for an owner, if any. */
  get(ownerFp: string): Uint8Array | undefined {
    const held = this.items.find((x) => x.ownerFp === ownerFp);
    return held ? new Uint8Array(Buffer.from(held.b64, "base64")) : undefined;
  }

  get count(): number { return this.items.length; }
}
