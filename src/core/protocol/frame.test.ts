import { describe, expect, it } from "vitest";
import {
  decodeFrame,
  encodeFrame,
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

  it("keeps header overhead at 3 bytes for unsigned frames", () => {
    const frame = encodeFrame(SubType.PRESENCE, new Uint8Array([1, 2, 3]));
    expect(frame.length).toBe(3 + 3);
  });

  it("carries and returns a reserved signature block", () => {
    const sig = new Uint8Array(SIG_LEN).fill(7);
    const frame = encodeFrame(SubType.POST, enc("signed post"), { signature: sig });
    expect(frame.length).toBe(3 + SIG_LEN + enc("signed post").length);
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
    const raw = new Uint8Array([(PROTOCOL_MAJOR << 4) | PROTOCOL_MINOR, 0xab, 0x00, 9, 9]);
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
