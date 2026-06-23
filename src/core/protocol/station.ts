// Station beacon (DESIGN §3) — a Station advertises itself + the services it
// offers, signed so a hearer knows it holds its key. Stations are peer/federated
// infrastructure ("a place with memory"); the network runs fine with zero of
// them. Rides the STATION sub-type.
//
// Layout: [pubkey:32][sig:64 over pubkey‖name‖services][nameLen:1][name][services:1]

import { sign, verify, type Identity } from "@core/identity/index.ts";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";

const PUBKEY_LEN = 32;
const SIG_LEN = 64;
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Service flags a Station can advertise (bitmask, DESIGN §3).
export const SERVICE = {
  REPEAT: 1 << 0,   // multi-hop repeating (baseline; Stations do it with reach)
  MAIL: 1 << 1,     // Mail store-and-forward
  PAGES: 1 << 2,    // Traveler Page hosting
  COMMONS: 1 << 3,  // deeper Commons memory
  VAULT: 1 << 4,    // encrypted Account Vault backups
  GATEWAY: 1 << 5,  // internet gateway / federation
} as const;

export interface StationBeacon {
  /** Station name (its handle). */
  name: string;
  publicKey: Uint8Array;
  fingerprint: string;
  /** Bitmask of SERVICE.* it offers. */
  services: number;
}

export function encodeStationBeacon(identity: Identity, services: number): Uint8Array {
  const name = utf8(identity.handle);
  const svc = Uint8Array.of(services & 0xff);
  const sig = sign(identity, concat(identity.publicKey, name, svc));
  return concat(identity.publicKey, sig, Uint8Array.of(name.length & 0xff), name, svc);
}

export function decodeStationBeacon(payload: Uint8Array): StationBeacon | null {
  if (payload.length < PUBKEY_LEN + SIG_LEN + 1) return null;
  const publicKey = payload.subarray(0, PUBKEY_LEN);
  const sig = payload.subarray(PUBKEY_LEN, PUBKEY_LEN + SIG_LEN);
  const nameLen = payload[PUBKEY_LEN + SIG_LEN];
  const nameStart = PUBKEY_LEN + SIG_LEN + 1;
  if (payload.length < nameStart + nameLen + 1) return null;
  const name = payload.subarray(nameStart, nameStart + nameLen);
  const svc = payload[nameStart + nameLen];
  if (!verify(publicKey, concat(publicKey, name, Uint8Array.of(svc)), sig)) return null;
  return {
    name: fromUtf8(name),
    publicKey,
    fingerprint: bytesToHex(sha256(publicKey)).slice(0, 12),
    services: svc,
  };
}

/** Render a services bitmask as short tags, e.g. "MAIL PAGES". */
export function serviceTags(services: number): string[] {
  const tags: string[] = [];
  if (services & SERVICE.REPEAT) tags.push("REPEAT");
  if (services & SERVICE.MAIL) tags.push("MAIL");
  if (services & SERVICE.PAGES) tags.push("PAGES");
  if (services & SERVICE.COMMONS) tags.push("COMMONS");
  if (services & SERVICE.VAULT) tags.push("VAULT");
  if (services & SERVICE.GATEWAY) tags.push("GATEWAY");
  return tags;
}
