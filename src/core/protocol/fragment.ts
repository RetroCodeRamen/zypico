// Fragmentation + reassembly with selective repeat (plan §5, §8 Phase 1).
//
// A single LoRa frame holds only ~180 working bytes (outline §11.1), but mail,
// board posts, profiles, and Cart manifests routinely exceed that. The protocol
// spine splits an oversized inner frame into a series of FRAG envelopes, each a
// self-describing piece that can arrive out of order, be lost, and be re-sent
// individually — "selective repeat" rather than restarting the whole transfer
// (plan §8 Phase 1 exit: "two real nodes round-trip a multi-fragment message
// reliably; survives loss and delay").
//
// LAYERING. The bytes we fragment are a *complete RelayProtocol frame* (header +
// sub-type payload, see frame.ts). The reassembled output is therefore ready to
// hand straight back to decodeFrame. Each fragment is itself carried in a normal
// frame with SubType.FRAG, so the wire still has exactly one framing format.
//
// FRAG envelope payload (sits inside a SubType.FRAG frame):
//
//   byte 0..3   msgId   uint32  — sender-chosen, groups a transfer's fragments
//   byte 4..5   index   uint16  — 0-based position
//   byte 6..7   total   uint16  — fragment count (1..65535)
//   byte 8..    chunk   bytes   — this fragment's slice of the original
//
// 8 bytes of envelope overhead per fragment; with the 3-byte frame header that
// is 11 bytes off the budget per fragment (plan §12 byte discipline).

import { encodeFrame } from "./frame.ts";
import { SubType } from "./subtypes.ts";

export const FRAG_HEADER_LEN = 8;
const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;

export interface FragmentHeader {
  msgId: number;
  index: number;
  total: number;
}

export interface Fragment extends FragmentHeader {
  chunk: Uint8Array;
}

export function encodeFragment(header: FragmentHeader, chunk: Uint8Array): Uint8Array {
  const { msgId, index, total } = header;
  if (msgId < 0 || msgId > U32_MAX) throw new RangeError("msgId out of uint32 range");
  if (total < 1 || total > U16_MAX) throw new RangeError("total out of 1..65535");
  if (index < 0 || index >= total) throw new RangeError("index out of range for total");

  const out = new Uint8Array(FRAG_HEADER_LEN + chunk.length);
  // uint32 big-endian; >>> keeps it unsigned.
  out[0] = (msgId >>> 24) & 0xff;
  out[1] = (msgId >>> 16) & 0xff;
  out[2] = (msgId >>> 8) & 0xff;
  out[3] = msgId & 0xff;
  out[4] = (index >> 8) & 0xff;
  out[5] = index & 0xff;
  out[6] = (total >> 8) & 0xff;
  out[7] = total & 0xff;
  out.set(chunk, FRAG_HEADER_LEN);
  return out;
}

export function decodeFragment(payload: Uint8Array): Fragment {
  if (payload.length < FRAG_HEADER_LEN) throw new RangeError("FRAG payload too short");
  const msgId =
    payload[0] * 0x100_0000 + (payload[1] << 16) + (payload[2] << 8) + payload[3];
  const index = (payload[4] << 8) | payload[5];
  const total = (payload[6] << 8) | payload[7];
  return { msgId, index, total, chunk: payload.slice(FRAG_HEADER_LEN) };
}

/**
 * Split `data` into FRAG-envelope payloads.
 * @param maxChunk maximum chunk bytes per fragment (the per-frame byte budget
 *                 minus the frame header and the 8-byte FRAG envelope).
 */
export function fragment(msgId: number, data: Uint8Array, maxChunk: number): Uint8Array[] {
  if (maxChunk < 1) throw new RangeError("maxChunk must be >= 1");
  const total = Math.max(1, Math.ceil(data.length / maxChunk));
  if (total > U16_MAX) throw new RangeError("data exceeds maximum fragment count");
  const out: Uint8Array[] = [];
  for (let index = 0; index < total; index++) {
    const start = index * maxChunk;
    const chunk = data.subarray(start, start + maxChunk);
    out.push(encodeFragment({ msgId, index, total }, chunk));
  }
  return out;
}

/**
 * Convenience: split `data` into ready-to-send RelayProtocol frames (SubType.FRAG).
 * @param maxFramePayload the transport's per-frame byte budget (incl. envelopes
 *                        but excl. the 3-byte frame header — i.e. the bytes we
 *                        hand to encodeFrame).
 */
export function fragmentToFrames(
  msgId: number,
  data: Uint8Array,
  maxFramePayload: number,
): Uint8Array[] {
  const maxChunk = maxFramePayload - FRAG_HEADER_LEN;
  return fragment(msgId, data, maxChunk).map((p) => encodeFrame(SubType.FRAG, p));
}

export type ReassembleResult =
  | { status: "incomplete"; msgId: number; received: number; total: number }
  | { status: "complete"; msgId: number; data: Uint8Array }
  | { status: "duplicate"; msgId: number; index: number }
  | { status: "inconsistent"; msgId: number };

interface Partial {
  total: number;
  chunks: Array<Uint8Array | undefined>;
  received: number;
}

/**
 * Reassembles fragmented transfers. Tolerant of loss, duplication, and
 * out-of-order arrival; partial transfers persist across calls so a late
 * fragment resumes rather than restarts (plan §8 Phase 1). `missing()` backs
 * selective-repeat NACKs. Bounded by `maxConcurrent` in-flight transfers so a
 * flood of partial transfers can't exhaust memory; the oldest is dropped.
 */
export class Reassembler {
  private readonly partials = new Map<number, Partial>();

  constructor(private readonly maxConcurrent = 32) {}

  accept(payload: Uint8Array): ReassembleResult {
    const frag = decodeFragment(payload);
    const { msgId, index, total, chunk } = frag;

    let partial = this.partials.get(msgId);
    if (partial && partial.total !== total) {
      // Two transfers reusing one msgId with different sizes — reject; the
      // caller should treat this msgId as poisoned for now.
      return { status: "inconsistent", msgId };
    }
    if (index >= total) return { status: "inconsistent", msgId };

    if (!partial) {
      partial = { total, chunks: new Array(total).fill(undefined), received: 0 };
      this.partials.set(msgId, partial);
      this.evictIfNeeded();
    }

    if (partial.chunks[index] !== undefined) {
      return { status: "duplicate", msgId, index };
    }
    partial.chunks[index] = chunk;
    partial.received++;

    if (partial.received < partial.total) {
      return { status: "incomplete", msgId, received: partial.received, total };
    }

    // Complete: concatenate in index order and retire the transfer.
    const size = partial.chunks.reduce((n, c) => n + (c ? c.length : 0), 0);
    const data = new Uint8Array(size);
    let offset = 0;
    for (const c of partial.chunks) {
      data.set(c!, offset);
      offset += c!.length;
    }
    this.partials.delete(msgId);
    return { status: "complete", msgId, data };
  }

  /** Indices still missing for an in-flight transfer (for a selective-repeat NACK). */
  missing(msgId: number): number[] {
    const partial = this.partials.get(msgId);
    if (!partial) return [];
    const out: number[] = [];
    for (let i = 0; i < partial.total; i++) {
      if (partial.chunks[i] === undefined) out.push(i);
    }
    return out;
  }

  /** True while a transfer is partially received. */
  isPending(msgId: number): boolean {
    return this.partials.has(msgId);
  }

  /** Abandon an in-flight transfer (e.g. on timeout). */
  drop(msgId: number): void {
    this.partials.delete(msgId);
  }

  private evictIfNeeded(): void {
    while (this.partials.size > this.maxConcurrent) {
      const oldest = this.partials.keys().next().value;
      if (oldest === undefined) break;
      this.partials.delete(oldest);
    }
  }
}
