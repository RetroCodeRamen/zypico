// The Wisp's discoveries — the little things it notices while you're away: a
// Traveler that passed by, a Station it heard about (DESIGN §2 "lives its life").
// These turn raw mesh activity into the Wisp's *stories*, which it recounts on
// return. Scoped per-identity, like the rest of local state.
//
// localStorage for now, behind these functions (swappable for Dexie later — the
// same staging wisp/buddies/messages follow).

export interface Discovery {
  /** traveler = new face; reunion = a known face returned; station = new node;
   *  station-changed = a known station's services changed since last visit. */
  kind: "traveler" | "station" | "reunion" | "station-changed";
  /** The handle / station name the Wisp will recount. */
  name: string;
  /** Epoch ms it was noticed. */
  at: number;
}

const CAP = 20; // a short journal — the Wisp remembers the recent, not everything
const DEDUP_WINDOW = 3_600_000; // don't re-log the same name within an hour

const keyFor = (fingerprint: string) => `zypico.discoveries.${fingerprint}`;

export function loadDiscoveries(fingerprint: string): Discovery[] {
  try {
    const raw = localStorage.getItem(keyFor(fingerprint));
    if (!raw) return [];
    const list = JSON.parse(raw) as Discovery[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveDiscoveries(fingerprint: string, list: Discovery[]): void {
  try {
    localStorage.setItem(keyFor(fingerprint), JSON.stringify(list));
  } catch {
    // non-fatal
  }
}

/** Record a sighting (newest last), skipping a recent repeat of the same thing. */
export function addDiscovery(list: Discovery[], d: Discovery): Discovery[] {
  const seenRecently = list.some(
    (x) => x.kind === d.kind && x.name === d.name && d.at - x.at < DEDUP_WINDOW,
  );
  if (seenRecently) return list;
  return [...list, d].slice(-CAP);
}
