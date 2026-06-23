// Buddies — locally pinned identities you can DM (outline §9.3 TOFU + petnames).
// Stored per-traveler (keyed by your own fingerprint), since your buddy list is
// part of your local state. The public key is what makes a buddy a buddy: it's
// what we seal DMs to and verify their presence with.

export interface Buddy {
  handle: string;
  fingerprint: string;
  /** Ed25519 public key, hex. */
  pubkey: string;
  /** Private local alias (outline §9.3 petnames). */
  petname?: string;
  addedAt: number;
}

const keyFor = (myFingerprint: string) => `zypico.buddies.${myFingerprint}`;

export function loadBuddies(myFingerprint: string): Buddy[] {
  try {
    const raw = localStorage.getItem(keyFor(myFingerprint));
    if (!raw) return [];
    const list = JSON.parse(raw) as Buddy[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveBuddies(myFingerprint: string, buddies: Buddy[]): void {
  try {
    localStorage.setItem(keyFor(myFingerprint), JSON.stringify(buddies));
  } catch {
    // non-fatal
  }
}

/** Add or update a buddy (dedup by fingerprint), returning the new list. */
export function upsertBuddy(buddies: Buddy[], buddy: Buddy): Buddy[] {
  const without = buddies.filter((b) => b.fingerprint !== buddy.fingerprint);
  return [...without, buddy];
}
