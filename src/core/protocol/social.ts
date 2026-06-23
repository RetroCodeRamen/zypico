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
// (DESIGN §4.1: carries handle, fingerprint, Wisp form + current location.)
// Layout: [pubkey:32][sig:64 over pubkey‖handle‖meta][handleLen:1][handle][meta:2]
//   meta = [formIndex:1][placeId:1]  (placeId 0xff = home/with the Wisp)
//
// The world speaks in people, never node tech — a beacon shows who someone is and
// where in the Relay they are, not radio internals.

export const PLACE_HOME = 0xff;
const META_LEN = 2;

export function encodePresence(identity: Identity, formIndex: number, placeId: number): Uint8Array {
  const handle = utf8(identity.handle);
  const meta = Uint8Array.of(formIndex & 0xff, placeId & 0xff);
  const sig = sign(identity, concat(identity.publicKey, handle, meta));
  return concat(identity.publicKey, sig, Uint8Array.of(handle.length & 0xff), handle, meta);
}

export interface Presence {
  handle: string;
  publicKey: Uint8Array;
  fingerprint: string;
  /** Wisp form (wire index — see companion FORM_ORDER). */
  formIndex: number;
  /** Where in the Relay they are (Place index, or PLACE_HOME). */
  placeId: number;
}

export function decodePresence(payload: Uint8Array): Presence | null {
  if (payload.length < PUBKEY_LEN + SIG_LEN + 1) return null;
  const publicKey = payload.subarray(0, PUBKEY_LEN);
  const sig = payload.subarray(PUBKEY_LEN, PUBKEY_LEN + SIG_LEN);
  const handleLen = payload[PUBKEY_LEN + SIG_LEN];
  const handleStart = PUBKEY_LEN + SIG_LEN + 1;
  if (payload.length < handleStart + handleLen + META_LEN) return null;
  const handle = payload.subarray(handleStart, handleStart + handleLen);
  const meta = payload.subarray(handleStart + handleLen, handleStart + handleLen + META_LEN);
  if (!verify(publicKey, concat(publicKey, handle, meta), sig)) return null;
  return {
    handle: fromUtf8(handle),
    publicKey,
    fingerprint: fingerprintOf(publicKey),
    formIndex: meta[0],
    placeId: meta[1],
  };
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

// ---- Chatroom message: public, HLC-ordered (outline §5 boards; rides POST) ----
// Layout: [roomId:1][hlc:8][senderFp:6][handleLen:1][handle][text].

export const MAIN_ROOM = 0;
const HLC_BYTES = 8;

export function encodeRoomMsg(
  roomId: number,
  hlc: Uint8Array,
  senderFp: string,
  handle: string,
  text: string,
): Uint8Array {
  const h = utf8(handle);
  return concat(
    Uint8Array.of(roomId & 0xff),
    hlc,
    fpToBytes(senderFp),
    Uint8Array.of(h.length & 0xff),
    h,
    utf8(text),
  );
}

export interface RoomMsg {
  roomId: number;
  /** 8-byte HLC timestamp (decode with decodeHlc for ordering). */
  hlc: Uint8Array;
  senderFp: string;
  handle: string;
  text: string;
}

export function decodeRoomMsg(payload: Uint8Array): RoomMsg | null {
  let o = 0;
  if (payload.length < 1 + HLC_BYTES + FP_LEN + 1) return null;
  const roomId = payload[o++];
  const hlc = payload.subarray(o, o + HLC_BYTES);
  o += HLC_BYTES;
  const senderFp = bytesToHex(payload.subarray(o, o + FP_LEN));
  o += FP_LEN;
  const handleLen = payload[o++];
  if (payload.length < o + handleLen) return null;
  const handle = fromUtf8(payload.subarray(o, o + handleLen));
  o += handleLen;
  return { roomId, hlc, senderFp, handle, text: fromUtf8(payload.subarray(o)) };
}
