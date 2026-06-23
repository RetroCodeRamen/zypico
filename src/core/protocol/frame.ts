// RelayProtocol common header + framing (outline §11.3).
//
// Every Relay payload, regardless of sub-type, begins with a fixed common
// header carrying a protocol VERSION, the 1-byte SUB-TYPE, and a FLAGS byte
// that reserves space for the per-message signature (outline §9.3 — "signing
// from day one; signature space reserved in the payload header"). Signing
// itself lands in Phase 2; until then frames are emitted unsigned and the
// signature block is simply absent.
//
// Wire layout (big-endian where it matters):
//
//   byte 0   version   (major << 4) | minor
//   byte 1   sub-type  (SubType)
//   byte 2   flags     bit0 = SIGNED
//   [64]     signature (present iff SIGNED) — Ed25519 over header+body
//   …        payload   (sub-type specific bytes)
//
// Byte discipline (plan §12): binary only, no JSON over the air. The header is
// 3 bytes of overhead (67 with a signature), leaving the rest of the ~180-byte
// working budget for payload.

import { isKnownSubType, SubType } from "./subtypes.ts";

export const PROTOCOL_MAJOR = 0;
export const PROTOCOL_MINOR = 1;

export const SIG_LEN = 64; // Ed25519
const FLAG_SIGNED = 0b0000_0001;
const HEADER_LEN = 3;

export interface ProtocolVersion {
  major: number;
  minor: number;
}

export interface RelayFrame {
  version: ProtocolVersion;
  subtype: SubType;
  /** Present iff the frame carried a signature block. Not yet verified (Phase 2). */
  signature?: Uint8Array;
  payload: Uint8Array;
}

export interface EncodeOptions {
  version?: ProtocolVersion;
  /** Reserve and attach a 64-byte signature block (left zero-filled until Phase 2 signs it). */
  signature?: Uint8Array;
}

export function encodeFrame(
  subtype: SubType,
  payload: Uint8Array,
  opts: EncodeOptions = {},
): Uint8Array {
  const major = opts.version?.major ?? PROTOCOL_MAJOR;
  const minor = opts.version?.minor ?? PROTOCOL_MINOR;
  const signed = opts.signature !== undefined;

  if (signed && opts.signature!.length !== SIG_LEN) {
    throw new RangeError(`signature must be ${SIG_LEN} bytes`);
  }
  if (major > 0xf || minor > 0xf) {
    throw new RangeError("version major/minor must each fit in a nibble");
  }

  const out = new Uint8Array(
    HEADER_LEN + (signed ? SIG_LEN : 0) + payload.length,
  );
  out[0] = (major << 4) | minor;
  out[1] = subtype;
  out[2] = signed ? FLAG_SIGNED : 0;
  let offset = HEADER_LEN;
  if (signed) {
    out.set(opts.signature!, offset);
    offset += SIG_LEN;
  }
  out.set(payload, offset);
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
      ...(signature ? { signature } : {}),
      payload: bytes.slice(offset),
    },
  };
}
