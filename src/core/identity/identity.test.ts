import { describe, expect, it } from "vitest";
import { deriveIdentity, sign, verify } from "./identity.ts";

describe("identity", () => {
  it("re-derives the same keypair from the same credentials (no server, no reset)", async () => {
    const a = await deriveIdentity("WonkyTanuki", "correct horse battery");
    const b = await deriveIdentity("WonkyTanuki", "correct horse battery");
    expect(b.fingerprint).toBe(a.fingerprint);
    expect([...b.publicKey]).toEqual([...a.publicKey]);
  });

  it("gives a different identity for a different password", async () => {
    const a = await deriveIdentity("WonkyTanuki", "password-one");
    const b = await deriveIdentity("WonkyTanuki", "password-two");
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("gives a different identity for a different handle (handle salts the KDF)", async () => {
    const a = await deriveIdentity("Alice", "same-password");
    const b = await deriveIdentity("Bob", "same-password");
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("handle is trimmed but case-folded only for the salt, not the display", async () => {
    const a = await deriveIdentity("  Tanuki  ", "pw");
    expect(a.handle).toBe("Tanuki");
  });

  it("signs and verifies with the derived key", async () => {
    const id = await deriveIdentity("Signer", "pw");
    const msg = new TextEncoder().encode("hello relay");
    const sig = sign(id, msg);
    expect(verify(id.publicKey, msg, sig)).toBe(true);
    expect(verify(id.publicKey, new TextEncoder().encode("tampered"), sig)).toBe(false);
  });
});
