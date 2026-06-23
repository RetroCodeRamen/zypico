// Wire formats for the social layer: presence beacons (discovery) and direct
// messages (outline §8, §5). These ride the RelayProtocol sub-types PRESENCE and
// IM. Addressing is by identity fingerprint, not node — so it survives roaming.

import { sign, verify, type Identity } from "@core/identity/index.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";

export const FP_LEN = 6; // fingerprint = 12 hex chars = 6 bytes
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

/** 6-byte fingerprint from its 12-hex string. */
export function fpToBytes(fingerprint: string): Uint8Array {
  return hexToBytes(fingerprint);
}

// ---- Presence beacon: who I am, signed so a hearer knows I hold the key ----
// Layout: [pubkey:32][sig:64 over pubkey‖handle][handleLen:1][handle].

export function encodePresence(identity: Identity): Uint8Array {
  const handle = utf8(identity.handle);
  const sig = sign(identity, concat(identity.publicKey, handle));
  return concat(identity.publicKey, sig, Uint8Array.of(handle.length & 0xff), handle);
}

export interface Presence {
  handle: string;
  publicKey: Uint8Array;
  fingerprint: string;
}

export function decodePresence(payload: Uint8Array): Presence | null {
  if (payload.length < PUBKEY_LEN + SIG_LEN + 1) return null;
  const publicKey = payload.subarray(0, PUBKEY_LEN);
  const sig = payload.subarray(PUBKEY_LEN, PUBKEY_LEN + SIG_LEN);
  const handleLen = payload[PUBKEY_LEN + SIG_LEN];
  const handleStart = PUBKEY_LEN + SIG_LEN + 1;
  if (payload.length < handleStart + handleLen) return null;
  const handle = payload.subarray(handleStart, handleStart + handleLen);
  if (!verify(publicKey, concat(publicKey, handle), sig)) return null;
  return { handle: fromUtf8(handle), publicKey, fingerprint: fingerprintOf(publicKey) };
}

// ---- Direct message: addressed + sealed (encryption lives in identity/seal) ----
// Layout: [recipientFp:6][senderFp:6][sealed…].

export function encodeDM(recipientFp: string, senderFp: string, sealed: Uint8Array): Uint8Array {
  return concat(fpToBytes(recipientFp), fpToBytes(senderFp), sealed);
}

export interface DmEnvelope {
  recipientFp: string;
  senderFp: string;
  sealed: Uint8Array;
}

export function decodeDM(payload: Uint8Array): DmEnvelope | null {
  if (payload.length < FP_LEN * 2) return null;
  return {
    recipientFp: bytesToHex(payload.subarray(0, FP_LEN)),
    senderFp: bytesToHex(payload.subarray(FP_LEN, FP_LEN * 2)),
    sealed: payload.subarray(FP_LEN * 2),
  };
}

// Fingerprint = first 12 hex of sha256(pubkey) — matches core/identity.
function fingerprintOf(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey)).slice(0, 12);
}
