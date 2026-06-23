// End-to-end sealing for direct messages (outline §9.3). A DM is encrypted to
// the recipient's identity key so only they can read it — on a broadcast LoRa
// medium everyone hears the ciphertext, nobody else can open it.
//
// Identities are Ed25519 (signing). For Diffie-Hellman we convert each key to
// its X25519 (Montgomery) form, agree a shared secret, derive a key via HKDF,
// and use XChaCha20-Poly1305 (AEAD) with a random 24-byte nonce. Both sides
// compute the same shared secret, so no key material crosses the air.

import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";

const NONCE_LEN = 24;
const TAG_LEN = 16;
const utf8 = (s: string) => new TextEncoder().encode(s);

function sharedKey(mySeed: Uint8Array, theirEdPublicKey: Uint8Array): Uint8Array {
  const myMontPriv = edwardsToMontgomeryPriv(mySeed);
  const theirMontPub = edwardsToMontgomeryPub(theirEdPublicKey);
  const shared = x25519.getSharedSecret(myMontPriv, theirMontPub);
  return hkdf(sha256, shared, undefined, utf8("zypico-dm-v1"), 32);
}

/** Seal `plaintext` to a recipient's Ed25519 public key. Output: nonce ‖ ciphertext. */
export function seal(mySeed: Uint8Array, theirEdPublicKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const key = sharedKey(mySeed, theirEdPublicKey);
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(NONCE_LEN + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_LEN);
  return out;
}

/** Open a sealed message from a sender's Ed25519 public key. Null if it isn't for us / is tampered. */
export function open(mySeed: Uint8Array, theirEdPublicKey: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  if (sealed.length < NONCE_LEN + TAG_LEN) return null;
  try {
    const key = sharedKey(mySeed, theirEdPublicKey);
    const nonce = sealed.subarray(0, NONCE_LEN);
    const ct = sealed.subarray(NONCE_LEN);
    return xchacha20poly1305(key, nonce).decrypt(ct);
  } catch {
    return null; // wrong key or tampered
  }
}
