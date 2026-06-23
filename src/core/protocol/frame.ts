// RelayProtocol common header + framing (outline §11.3, DESIGN §4.3).
//
// Every Relay payload, regardless of sub-type, begins with a fixed common
// header carrying a protocol VERSION, the 1-byte SUB-TYPE, a FLAGS byte that
// reserves space for the per-message signature (outline §9.3), a HOP LIMIT for
// multi-hop repeating, and a sender-assigned MESSAGE ID. The hop limit + msg id
// live in the common header on purpose: the mesh spine can dedupe and repeat a
// frame **without decoding the sub-type payload**, so even unknown sub-types get
// range, and a repeated frame keeps one stable identity across every hop.
//
// Wire layout (big-endian where it matters):
//
//   byte 0     version   (major << 4) | minor
//   byte 1     sub-type  (SubType)
//   byte 2     flags     bit0 = SIGNED
//   byte 3     hop limit remaining hops (decremented per repeat; 0 = terminal)
//   byte 4..7  msg id    uint32, sender-assigned, STABLE across hops (dedupe key)
//   [64]       signature (present iff SIGNED) — Ed25519 over header+body
//   …          payload   (sub-type specific bytes)
//
// Byte discipline (plan §12): binary only, no JSON over the air. The header is
// 8 bytes of overhead (72 with a signature), leaving the rest of the ~180-byte
// working budget for payload.

import { isKnownSubType, SubType } from "./subtypes.ts";

export const PROTOCOL_MAJOR = 0;
export const PROTOCOL_MINOR = 2;

export const SIG_LEN = 64; // Ed25519
const FLAG_SIGNED = 0b0000_0001;
export const HEADER_LEN = 8;

/** Default hop budget for an originated frame (DESIGN §4.3 — hop limit 3). */
export const DEFAULT_HOPS = 3;
const HOP_OFF = 3;
const MSGID_OFF = 4;

export interface ProtocolVersion {
  major: number;
  minor: number;
}

export interface RelayFrame {
  version: ProtocolVersion;
  subtype: SubType;
  /** Remaining hops when this frame was received (DEFAULT_HOPS = heard direct). */
  hopLimit: number;
  /** Sender-assigned id, stable across hops — the network-wide dedupe key. */
  msgId: number;
  /** Present iff the frame carried a signature block. Not yet verified (Phase 2). */
  signature?: Uint8Array;
  payload: Uint8Array;
}

export interface EncodeOptions {
  version?: ProtocolVersion;
  /** Reserve and attach a 64-byte signature block (left zero-filled until Phase 2 signs it). */
  signature?: Uint8Array;
  /** Hop budget (default DEFAULT_HOPS). */
  hopLimit?: number;
  /** Stable message id (default: a random uint32). */
  msgId?: number;
}

const randomMsgId = () => (Math.random() * 0x1_0000_0000) >>> 0;

export function encodeFrame(
  subtype: SubType,
  payload: Uint8Array,
  opts: EncodeOptions = {},
): Uint8Array {
  const major = opts.version?.major ?? PROTOCOL_MAJOR;
  const minor = opts.version?.minor ?? PROTOCOL_MINOR;
  const signed = opts.signature !== undefined;
  const hopLimit = opts.hopLimit ?? DEFAULT_HOPS;
  const msgId = (opts.msgId ?? randomMsgId()) >>> 0;

  if (signed && opts.signature!.length !== SIG_LEN) {
    throw new RangeError(`signature must be ${SIG_LEN} bytes`);
  }
  if (major > 0xf || minor > 0xf) {
    throw new RangeError("version major/minor must each fit in a nibble");
  }
  if (hopLimit < 0 || hopLimit > 0xff) {
    throw new RangeError("hopLimit must fit in a byte");
  }

  const out = new Uint8Array(
    HEADER_LEN + (signed ? SIG_LEN : 0) + payload.length,
  );
  out[0] = (major << 4) | minor;
  out[1] = subtype;
  out[2] = signed ? FLAG_SIGNED : 0;
  out[HOP_OFF] = hopLimit;
  out[MSGID_OFF] = (msgId >>> 24) & 0xff;
  out[MSGID_OFF + 1] = (msgId >>> 16) & 0xff;
  out[MSGID_OFF + 2] = (msgId >>> 8) & 0xff;
  out[MSGID_OFF + 3] = msgId & 0xff;
  let offset = HEADER_LEN;
  if (signed) {
    out.set(opts.signature!, offset);
    offset += SIG_LEN;
  }
  out.set(payload, offset);
  return out;
}

/** A frame's routing envelope, read without decoding the sub-type payload. */
export interface FrameEnvelope {
  hopLimit: number;
  msgId: number;
}

/** Peek the hop limit + msg id from raw frame bytes (the spine's repeat/dedupe). */
export function peekEnvelope(bytes: Uint8Array): FrameEnvelope | null {
  if (bytes.length < HEADER_LEN) return null;
  const major = bytes[0] >> 4;
  if (major > PROTOCOL_MAJOR) return null; // can't trust a future major's layout
  const msgId =
    ((bytes[MSGID_OFF] << 24) | (bytes[MSGID_OFF + 1] << 16) |
     (bytes[MSGID_OFF + 2] << 8) | bytes[MSGID_OFF + 3]) >>> 0;
  return { hopLimit: bytes[HOP_OFF], msgId };
}

/** A copy of the frame with its hop limit decremented — what a repeater sends. */
export function decrementHop(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  if (out.length > HOP_OFF && out[HOP_OFF] > 0) out[HOP_OFF] -= 1;
  return out;
}

export type DecodeResult =
  | { ok: true; frame: RelayFrame }
  | { ok: false; reason: "too-short" | "incompatible-major" | "unknown-subtype"; subtype?: number };

/**
 * Parse a Relay frame. Per outline §11.3 the receiver:
 *  - skips a payload whose MAJOR version is higher than ours (forward-incompat),
 *  - surfaces unknown sub-types so the caller can ignore them,
 *  - otherwise parses known fields and hands back the body.
 *
 * Same-major / higher-minor frames parse fine (extra trailing fields, if any,
 * live inside the sub-type payload and are that decoder's concern).
 */
export function decodeFrame(bytes: Uint8Array): DecodeResult {
  if (bytes.length < HEADER_LEN) return { ok: false, reason: "too-short" };

  const major = bytes[0] >> 4;
  const minor = bytes[0] & 0x0f;
  const subtype = bytes[1];
  const signed = (bytes[2] & FLAG_SIGNED) !== 0;
  const hopLimit = bytes[HOP_OFF];
  const msgId =
    ((bytes[MSGID_OFF] << 24) | (bytes[MSGID_OFF + 1] << 16) |
     (bytes[MSGID_OFF + 2] << 8) | bytes[MSGID_OFF + 3]) >>> 0;

  if (major > PROTOCOL_MAJOR) {
    return { ok: false, reason: "incompatible-major", subtype };
  }

  let offset = HEADER_LEN;
  let signature: Uint8Array | undefined;
  if (signed) {
    if (bytes.length < offset + SIG_LEN) return { ok: false, reason: "too-short" };
    signature = bytes.slice(offset, offset + SIG_LEN);
    offset += SIG_LEN;
  }

  if (!isKnownSubType(subtype)) {
    return { ok: false, reason: "unknown-subtype", subtype };
  }

  return {
    ok: true,
    frame: {
      version: { major, minor },
      subtype,
      hopLimit,
      msgId,
      ...(signature ? { signature } : {}),
      payload: bytes.slice(offset),
    },
  };
}
