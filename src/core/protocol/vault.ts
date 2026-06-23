// Account Vault wire formats (DESIGN §5.4, §7). A Vault is a client-encrypted
// backup of local state. The Station stores only the **opaque ciphertext**,
// keyed by the owner's fingerprint — it never sees the password or the plaintext.
//
//   VAULT_PUT / VAULT : [ownerFp:6][updatedAt:4][ciphertext…]   (store / serve)
//   VAULT_REQ         : [ownerFp:6]                              (fetch mine)

import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const FP_LEN = 6;
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const readU32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export interface VaultBlobMsg {
  ownerFp: string;
  /** Seconds since epoch — Stations keep the newest. */
  updatedAt: number;
  ciphertext: Uint8Array;
}

export function encodeVault(ownerFp: string, updatedAtMs: number, ciphertext: Uint8Array): Uint8Array {
  return concat(hexToBytes(ownerFp), u32(Math.floor(updatedAtMs / 1000)), ciphertext);
}

export function decodeVault(payload: Uint8Array): VaultBlobMsg | null {
  if (payload.length < FP_LEN + 4) return null;
  return {
    ownerFp: bytesToHex(payload.subarray(0, FP_LEN)),
    updatedAt: readU32(payload, FP_LEN) * 1000,
    ciphertext: payload.subarray(FP_LEN + 4),
  };
}

export function encodeVaultReq(ownerFp: string): Uint8Array {
  return hexToBytes(ownerFp);
}

export function decodeVaultReq(payload: Uint8Array): { ownerFp: string } | null {
  if (payload.length < FP_LEN) return null;
  return { ownerFp: bytesToHex(payload.subarray(0, FP_LEN)) };
}
