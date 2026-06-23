// Identity — a traveler is a cryptographic keypair derived from handle +
// password (outline §9.3; plan Phase 2; ADR 0002 chose @noble). No server, no
// account store: the same handle+password always re-derives the same keypair,
// so "log in" = "derive your identity." The secret key lives only in memory;
// only the handle + public-key fingerprint are persisted (see storage/identity).
//
// Argon2id (slow, memory-hard) defends weak passwords against impersonation
// (plan §11). Params are kept modest here because @noble's Argon2 is pure-JS on
// a phone; they can be raised later (a Web Worker / heavier memory) without
// changing this interface.

import { argon2idAsync } from "@noble/hashes/argon2";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export interface Identity {
  /** Display handle (e.g. "WonkyTanuki"). Not the identity — the key is. */
  handle: string;
  /** Short hex of the public key hash — a stable, shareable id. */
  fingerprint: string;
  /** Ed25519 public key (32 bytes). */
  publicKey: Uint8Array;
  /** Ed25519 seed/secret (32 bytes) — kept in memory only, never persisted. */
  secretKey: Uint8Array;
}

// ~8 MiB / 2 passes: a balance for pure-JS Argon2 on a phone. Tunable later.
const ARGON = { t: 2, m: 8192, p: 1, dkLen: 32 } as const;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Derive the traveler's identity from credentials (deterministic, offline). */
export async function deriveIdentity(handle: string, password: string): Promise<Identity> {
  const h = handle.trim();
  // Salt is bound to the handle so the same password under different handles
  // yields different identities, without needing a stored random salt.
  const salt = sha256(utf8("zypico-id:" + h.toLowerCase()));
  const seed = await argon2idAsync(utf8(password), salt, ARGON);
  const publicKey = ed25519.getPublicKey(seed);
  const fingerprint = bytesToHex(sha256(publicKey)).slice(0, 12);
  return { handle: h, fingerprint, publicKey, secretKey: seed };
}

/** Sign bytes with the identity (for signed beacons/posts/lineage, Phase 2+). */
export function sign(identity: Identity, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, identity.secretKey);
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return ed25519.verify(signature, message, publicKey);
}
