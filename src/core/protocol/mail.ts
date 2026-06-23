// Mail — persistent, addressed, end-to-end-sealed messages (DESIGN §4.4).
// Unlike Chat (live, reachability-gated), Mail is composed any time, queued in
// an outbox, and delivered when the recipient is reachable — peer-to-peer today,
// via Station store-and-forward in M7. Rides the MAIL sub-type.
//
// Layout: [recipientFp:6][senderFp:6][mailId:4][handleLen:1][handle][sealed…]
//   sealed = seal(senderSecret, recipientPub, body) — X25519 + XChaCha20-Poly1305,
//   which also authenticates the sender. The cleartext handle is for display only.

import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const FP_LEN = 6;
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const readU32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export interface MailEnvelope {
  recipientFp: string;
  senderFp: string;
  /** Sender-assigned id — the mail-layer dedupe key across delivery retries. */
  mailId: number;
  senderHandle: string;
  /** Sealed body (open with recipient secret + sender pubkey). */
  sealed: Uint8Array;
}

export function encodeMail(
  recipientFp: string,
  senderFp: string,
  mailId: number,
  senderHandle: string,
  sealed: Uint8Array,
): Uint8Array {
  const h = utf8(senderHandle);
  return concat(hexToBytes(recipientFp), hexToBytes(senderFp), u32(mailId), Uint8Array.of(h.length & 0xff), h, sealed);
}

export function decodeMail(payload: Uint8Array): MailEnvelope | null {
  let o = 0;
  if (payload.length < FP_LEN * 2 + 4 + 1) return null;
  const recipientFp = bytesToHex(payload.subarray(o, o + FP_LEN)); o += FP_LEN;
  const senderFp = bytesToHex(payload.subarray(o, o + FP_LEN)); o += FP_LEN;
  const mailId = readU32(payload, o); o += 4;
  const hLen = payload[o++];
  if (payload.length < o + hLen) return null;
  const senderHandle = fromUtf8(payload.subarray(o, o + hLen)); o += hLen;
  return { recipientFp, senderFp, mailId, senderHandle, sealed: payload.subarray(o) };
}

// ---- Mail ack: the recipient confirms receipt so held copies can be dropped ----
// Layout: [recipientFp:6][mailId:4]

export interface MailAck { recipientFp: string; mailId: number }

export function encodeMailAck(recipientFp: string, mailId: number): Uint8Array {
  return concat(hexToBytes(recipientFp), u32(mailId));
}

export function decodeMailAck(payload: Uint8Array): MailAck | null {
  if (payload.length < FP_LEN + 4) return null;
  return { recipientFp: bytesToHex(payload.subarray(0, FP_LEN)), mailId: readU32(payload, FP_LEN) };
}
