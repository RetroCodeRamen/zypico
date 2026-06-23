import { describe, expect, it } from "vitest";
import { deriveIdentity } from "./identity.ts";
import { open, seal } from "./seal.ts";

describe("E2E seal/open", () => {
  it("round-trips a DM only the recipient can read", async () => {
    const alice = await deriveIdentity("Alice", "pw-a");
    const bob = await deriveIdentity("Bob", "pw-b");
    const msg = new TextEncoder().encode("meet at the commons");

    const sealed = await seal(alice.secretKey, bob.publicKey, msg);
    // Bob opens with Alice's public key.
    const opened = open(bob.secretKey, alice.publicKey, sealed);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe("meet at the commons");
  });

  it("a third party cannot open it", async () => {
    const alice = await deriveIdentity("Alice", "pw-a");
    const bob = await deriveIdentity("Bob", "pw-b");
    const eve = await deriveIdentity("Eve", "pw-e");
    const sealed = seal(alice.secretKey, bob.publicKey, new TextEncoder().encode("secret"));
    // Eve tries with her key + Alice's pubkey → fails.
    expect(open(eve.secretKey, alice.publicKey, sealed)).toBeNull();
  });

  it("rejects tampered ciphertext", async () => {
    const alice = await deriveIdentity("Alice", "pw-a");
    const bob = await deriveIdentity("Bob", "pw-b");
    const sealed = seal(alice.secretKey, bob.publicKey, new TextEncoder().encode("hi"));
    sealed[sealed.length - 1] ^= 0xff; // flip a tag byte
    expect(open(bob.secretKey, alice.publicKey, sealed)).toBeNull();
  });
});
