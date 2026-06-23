// Guestbook — short public messages visitors leave on your Traveler Page
// (DESIGN §5.3, early-internet vibe). Entries left *for you* are stored locally
// under your fingerprint; Stations host/sync them later (M7). Per-identity,
// behind these functions like the rest of local state.

export interface GuestEntry {
  /** Who signed (their fingerprint). */
  fromFp: string;
  handle: string;
  text: string;
  /** Epoch ms received. */
  at: number;
}

const CAP = 30; // pages are small — keep a short, recent guestbook
const DEDUP_WINDOW = 60_000; // ignore an identical re-send within a minute

const keyFor = (fingerprint: string) => `zypico.guestbook.${fingerprint}`;

export function loadGuestbook(fingerprint: string): GuestEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(fingerprint));
    if (!raw) return [];
    const list = JSON.parse(raw) as GuestEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveGuestbook(fingerprint: string, list: GuestEntry[]): void {
  try {
    localStorage.setItem(keyFor(fingerprint), JSON.stringify(list));
  } catch {
    // non-fatal
  }
}

/** Append an entry (newest last), skipping an identical recent re-send. */
export function addGuestEntry(list: GuestEntry[], e: GuestEntry): GuestEntry[] {
  const dupe = list.some((x) => x.fromFp === e.fromFp && x.text === e.text && e.at - x.at < DEDUP_WINDOW);
  if (dupe) return list;
  return [...list, e].slice(-CAP);
}
