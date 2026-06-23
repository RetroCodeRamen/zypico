import { describe, expect, it } from "vitest";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { decodeVault, decodeVaultReq, encodeVault, encodeVaultReq } from "./vault.ts";

describe("vault envelope", () => {
  it("round-trips owner, freshness, and an opaque ciphertext", async () => {
    const me = await deriveIdentity("Owner", "pw");
    const cipher = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const v = decodeVault(encodeVault(me.fingerprint, 1_718_000_000_000, cipher));
    expect(v).not.toBeNull();
    expect(v!.ownerFp).toBe(me.fingerprint);
    expect(Math.floor(v!.updatedAt / 1000)).toBe(Math.floor(1_718_000_000_000 / 1000));
    expect([...v!.ciphertext]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("a vault sealed to yourself only opens by re-deriving your identity", async () => {
    const me = await deriveIdentity("Owner", "secret-pw");
    const blob = new TextEncoder().encode(JSON.stringify({ wisp: "mine" }));
    const sealed = seal(me.secretKey, me.publicKey, blob); // sealed to self

    // Re-deriving the same identity (handle + password) decrypts it.
    const again = await deriveIdentity("Owner", "secret-pw");
    const opened = open(again.secretKey, again.publicKey, sealed);
    expect(opened).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(opened!))).toEqual({ wisp: "mine" });

    // A different identity (wrong password) cannot.
    const other = await deriveIdentity("Owner", "wrong-pw");
    expect(open(other.secretKey, other.publicKey, sealed)).toBeNull();
  });

  it("round-trips a vault request", async () => {
    const me = await deriveIdentity("Owner", "pw");
    expect(decodeVaultReq(encodeVaultReq(me.fingerprint))!.ownerFp).toBe(me.fingerprint);
  });
});
