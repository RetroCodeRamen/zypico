import { describe, expect, it } from "vitest";
import { deriveIdentity } from "@core/identity/index.ts";
import { decodeDM, decodePresence, encodeDM, encodePresence } from "./social.ts";

describe("presence beacon", () => {
  it("round-trips and verifies the signature", async () => {
    const id = await deriveIdentity("WonkyTanuki", "pw");
    const p = decodePresence(encodePresence(id));
    expect(p).not.toBeNull();
    expect(p!.handle).toBe("WonkyTanuki");
    expect(p!.fingerprint).toBe(id.fingerprint);
    expect([...p!.publicKey]).toEqual([...id.publicKey]);
  });

  it("rejects a beacon with a forged signature", async () => {
    const id = await deriveIdentity("Tanuki", "pw");
    const bytes = encodePresence(id);
    bytes[40] ^= 0xff; // corrupt a signature byte
    expect(decodePresence(bytes)).toBeNull();
  });
});

describe("DM envelope", () => {
  it("round-trips addressing + sealed payload", async () => {
    const a = await deriveIdentity("Alice", "pw-a");
    const b = await deriveIdentity("Bob", "pw-b");
    const sealed = new Uint8Array([1, 2, 3, 4, 5]);
    const env = decodeDM(encodeDM(b.fingerprint, a.fingerprint, sealed));
    expect(env).not.toBeNull();
    expect(env!.recipientFp).toBe(b.fingerprint);
    expect(env!.senderFp).toBe(a.fingerprint);
    expect([...env!.sealed]).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a too-short DM", () => {
    expect(decodeDM(new Uint8Array(4))).toBeNull();
  });
});
