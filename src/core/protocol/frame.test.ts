import { describe, expect, it } from "vitest";
import {
  decodeFrame,
  decrementHop,
  DEFAULT_HOPS,
  encodeFrame,
  HEADER_LEN,
  peekEnvelope,
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  SIG_LEN,
} from "./frame.ts";
import { SubType } from "./subtypes.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("RelayProtocol frame", () => {
  it("round-trips a payload through encode/decode", () => {
    const frame = encodeFrame(SubType.IM, enc("hello relay"));
    const res = decodeFrame(frame);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frame.subtype).toBe(SubType.IM);
    expect(res.frame.version).toEqual({ major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR });
    expect(res.frame.signature).toBeUndefined();
    expect(dec(res.frame.payload)).toBe("hello relay");
  });

  it("keeps header overhead at 8 bytes for unsigned frames", () => {
    const frame = encodeFrame(SubType.PRESENCE, new Uint8Array([1, 2, 3]));
    expect(frame.length).toBe(HEADER_LEN + 3);
  });

  it("defaults to the full hop budget and a random msg id", () => {
    const a = encodeFrame(SubType.POST, enc("x"));
    const b = encodeFrame(SubType.POST, enc("x"));
    const ra = decodeFrame(a), rb = decodeFrame(b);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(ra.frame.hopLimit).toBe(DEFAULT_HOPS);
    expect(ra.frame.msgId).not.toBe(rb.frame.msgId); // fresh id each frame
  });

  it("preserves the msg id across a hop and decrements the hop limit", () => {
    const frame = encodeFrame(SubType.POST, enc("relayed"), { msgId: 0xdeadbeef, hopLimit: 3 });
    const env = peekEnvelope(frame);
    expect(env).toEqual({ msgId: 0xdeadbeef, hopLimit: 3 });

    const hopped = decrementHop(frame);
    const res = decodeFrame(hopped);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frame.msgId).toBe(0xdeadbeef); // identity survives the hop
    expect(res.frame.hopLimit).toBe(2);
    expect(dec(res.frame.payload)).toBe("relayed"); // payload untouched
  });

  it("never decrements a terminal (hop 0) frame below zero", () => {
    const frame = encodeFrame(SubType.IM, enc("last"), { hopLimit: 0 });
    expect(peekEnvelope(decrementHop(frame))?.hopLimit).toBe(0);
  });

  it("carries and returns a reserved signature block", () => {
    const sig = new Uint8Array(SIG_LEN).fill(7);
    const frame = encodeFrame(SubType.POST, enc("signed post"), { signature: sig });
    expect(frame.length).toBe(HEADER_LEN + SIG_LEN + enc("signed post").length);
    const res = decodeFrame(frame);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frame.signature).toEqual(sig);
    expect(dec(res.frame.payload)).toBe("signed post");
  });

  it("skips frames from a higher major version", () => {
    const frame = encodeFrame(SubType.IM, enc("future"), {
      version: { major: PROTOCOL_MAJOR + 1, minor: 0 },
    });
    const res = decodeFrame(frame);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("incompatible-major");
  });

  it("accepts a same-major / higher-minor frame", () => {
    const frame = encodeFrame(SubType.IM, enc("newer minor"), {
      version: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR + 1 },
    });
    const res = decodeFrame(frame);
    expect(res.ok).toBe(true);
  });

  it("reports unknown sub-types instead of guessing", () => {
    // Full 8-byte header (version, subtype 0xab, flags, hop, 4-byte msgId) + body.
    const raw = new Uint8Array([(PROTOCOL_MAJOR << 4) | PROTOCOL_MINOR, 0xab, 0x00, 3, 0, 0, 0, 1, 9, 9]);
    const res = decodeFrame(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("unknown-subtype");
    expect(res.subtype).toBe(0xab);
  });

  it("rejects truncated frames", () => {
    expect(decodeFrame(new Uint8Array([0x01])).ok).toBe(false);
  });

  it("rejects a wrong-length signature at encode time", () => {
    expect(() => encodeFrame(SubType.IM, enc("x"), { signature: new Uint8Array(10) })).toThrow();
  });
});
