// Wire formats for Traveler Pages + Guestbooks (DESIGN §5.2/§5.3), riding the
// PAGE_REQ / PAGE / GUESTBOOK sub-types. A Page is small and **signed** by its
// owner so any viewer can trust it (TOFU, like presence). Guestbook entries are
// signed by the visitor and addressed to the page owner.
//
// Pages are hosted by Stations later (M7); today they're fetched peer-to-peer
// while a Traveler is reachable.

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

function fingerprintOf(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey)).slice(0, 12);
}

function u32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

// ---- PAGE_REQ: "send me your Page" — addressed to the owner ----
// Layout: [ownerFp:6]

export function encodePageReq(ownerFp: string): Uint8Array {
  return hexToBytes(ownerFp);
}

export function decodePageReq(payload: Uint8Array): { ownerFp: string } | null {
  if (payload.length < FP_LEN) return null;
  return { ownerFp: bytesToHex(payload.subarray(0, FP_LEN)) };
}

// ---- PAGE: a signed Traveler Page ----
// Layout: [pubkey:32][sig:64 over pubkey‖handle‖tagline‖about‖updatedAt]
//         [handleLen:1][handle][taglineLen:1][tagline][aboutLen:2][about][updatedAt:4]

export interface PageMsg {
  handle: string;
  fingerprint: string;
  tagline: string;
  about: string;
  /** Seconds since epoch (fits u32) — for "whose copy is newer". */
  updatedAt: number;
}

export function encodePage(
  identity: Identity,
  tagline: string,
  about: string,
  updatedAtMs: number,
): Uint8Array {
  const h = utf8(identity.handle), t = utf8(tagline), a = utf8(about);
  const upd = u32(Math.floor(updatedAtMs / 1000));
  const sig = sign(identity, concat(identity.publicKey, h, t, a, upd));
  return concat(
    identity.publicKey, sig,
    Uint8Array.of(h.length & 0xff), h,
    Uint8Array.of(t.length & 0xff), t,
    Uint8Array.of((a.length >> 8) & 0xff, a.length & 0xff), a,
    upd,
  );
}

export function decodePage(payload: Uint8Array): PageMsg | null {
  let o = 0;
  if (payload.length < PUBKEY_LEN + SIG_LEN + 1) return null;
  const publicKey = payload.subarray(o, o + PUBKEY_LEN); o += PUBKEY_LEN;
  const sig = payload.subarray(o, o + SIG_LEN); o += SIG_LEN;
  const hLen = payload[o++];
  if (payload.length < o + hLen + 1) return null;
  const h = payload.subarray(o, o + hLen); o += hLen;
  const tLen = payload[o++];
  if (payload.length < o + tLen + 2) return null;
  const t = payload.subarray(o, o + tLen); o += tLen;
  const aLen = (payload[o] << 8) | payload[o + 1]; o += 2;
  if (payload.length < o + aLen + 4) return null;
  const a = payload.subarray(o, o + aLen); o += aLen;
  const upd = payload.subarray(o, o + 4); o += 4;
  if (!verify(publicKey, concat(publicKey, h, t, a, upd), sig)) return null;
  return {
    handle: fromUtf8(h),
    fingerprint: fingerprintOf(publicKey),
    tagline: fromUtf8(t),
    about: fromUtf8(a),
    updatedAt: readU32(upd, 0) * 1000,
  };
}

// ---- GUESTBOOK: a signed entry left for a page owner ----
// Layout: [ownerFp:6][pubkey:32][sig:64 over ownerFp‖text][handleLen:1][handle][textLen:1][text]

export interface GuestbookMsg {
  ownerFp: string;
  signerFp: string;
  handle: string;
  text: string;
}

export function encodeGuestbook(ownerFp: string, identity: Identity, text: string): Uint8Array {
  const owner = hexToBytes(ownerFp), h = utf8(identity.handle), t = utf8(text);
  const sig = sign(identity, concat(owner, t));
  return concat(owner, identity.publicKey, sig, Uint8Array.of(h.length & 0xff), h, Uint8Array.of(t.length & 0xff), t);
}

export function decodeGuestbook(payload: Uint8Array): GuestbookMsg | null {
  let o = 0;
  if (payload.length < FP_LEN + PUBKEY_LEN + SIG_LEN + 1) return null;
  const owner = payload.subarray(o, o + FP_LEN); o += FP_LEN;
  const publicKey = payload.subarray(o, o + PUBKEY_LEN); o += PUBKEY_LEN;
  const sig = payload.subarray(o, o + SIG_LEN); o += SIG_LEN;
  const hLen = payload[o++];
  if (payload.length < o + hLen + 1) return null;
  const h = payload.subarray(o, o + hLen); o += hLen;
  const tLen = payload[o++];
  if (payload.length < o + tLen) return null;
  const t = payload.subarray(o, o + tLen); o += tLen;
  if (!verify(publicKey, concat(owner, t), sig)) return null;
  return {
    ownerFp: bytesToHex(owner),
    signerFp: fingerprintOf(publicKey),
    handle: fromUtf8(h),
    text: fromUtf8(t),
  };
}
