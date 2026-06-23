// Cart wire formats (DESIGN/outline §Making). A Cart is a small Lua program,
// **signed by its author** so it carries verifiable provenance as it spreads —
// "a Cart authored on one device runs on another with verified provenance."
// Distribution mirrors Pages: peer-served + Station-hosted, request or overheard.
//
//   CART     : [pubkey:32][sig:64 over pubkey‖handle‖name‖code][handleLen:1][handle][nameLen:1][name][codeLen:2][code]
//   CART_REQ : [authorFp:6][nameLen:1][name]

import { sign, verify, type Identity } from "@core/identity/index.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";

const FP_LEN = 6;
const PUBKEY_LEN = 32;
const SIG_LEN = 64;
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export interface CartMsg {
  author: string;
  authorFp: string;
  name: string;
  code: string;
}

export function encodeCart(identity: Identity, name: string, code: string): Uint8Array {
  const h = utf8(identity.handle), n = utf8(name), c = utf8(code);
  const sig = sign(identity, concat(identity.publicKey, h, n, c));
  return concat(
    identity.publicKey, sig,
    Uint8Array.of(h.length & 0xff), h,
    Uint8Array.of(n.length & 0xff), n,
    Uint8Array.of((c.length >> 8) & 0xff, c.length & 0xff), c,
  );
}

export function decodeCart(payload: Uint8Array): CartMsg | null {
  let o = 0;
  if (payload.length < PUBKEY_LEN + SIG_LEN + 1) return null;
  const publicKey = payload.subarray(o, o + PUBKEY_LEN); o += PUBKEY_LEN;
  const sig = payload.subarray(o, o + SIG_LEN); o += SIG_LEN;
  const hLen = payload[o++];
  if (payload.length < o + hLen + 1) return null;
  const h = payload.subarray(o, o + hLen); o += hLen;
  const nLen = payload[o++];
  if (payload.length < o + nLen + 2) return null;
  const n = payload.subarray(o, o + nLen); o += nLen;
  const cLen = (payload[o] << 8) | payload[o + 1]; o += 2;
  if (payload.length < o + cLen) return null;
  const c = payload.subarray(o, o + cLen); o += cLen;
  if (!verify(publicKey, concat(publicKey, h, n, c), sig)) return null;
  return {
    author: fromUtf8(h),
    authorFp: bytesToHex(sha256(publicKey)).slice(0, 12),
    name: fromUtf8(n),
    code: fromUtf8(c),
  };
}

export function encodeCartReq(authorFp: string, name: string): Uint8Array {
  const n = utf8(name);
  return concat(hexToBytes(authorFp), Uint8Array.of(n.length & 0xff), n);
}

export function decodeCartReq(payload: Uint8Array): { authorFp: string; name: string } | null {
  if (payload.length < FP_LEN + 1) return null;
  const authorFp = bytesToHex(payload.subarray(0, FP_LEN));
  const nLen = payload[FP_LEN];
  if (payload.length < FP_LEN + 1 + nLen) return null;
  return { authorFp, name: fromUtf8(payload.subarray(FP_LEN + 1, FP_LEN + 1 + nLen)) };
}
