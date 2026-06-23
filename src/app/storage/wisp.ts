// Wisp persistence. The companion + local state live only on-device (outline
// §9.5) — so we save the whole Wisp object locally and reload it on launch.
//
// localStorage for now; the plan's home for this is IndexedDB via Dexie (plan
// §4). Keeping it behind these two functions means that swap is local later.

import { createWisp, freshMood, type Wisp } from "@core/companion/index.ts";

// The Wisp is scoped to the traveler's identity (fingerprint), so different
// logins on one device keep separate companions (outline §2: Traveler → Wisp).
const keyFor = (fingerprint: string) => `zypico.wisp.${fingerprint}`;

export function loadWisp(fingerprint: string): Wisp {
  try {
    const raw = localStorage.getItem(keyFor(fingerprint));
    if (raw) {
      const parsed = JSON.parse(raw) as Wisp;
      // Tolerate older/partial saves by filling any missing hearts + mood.
      return {
        name: parsed.name ?? "",
        bornAt: parsed.bornAt ?? Date.now(),
        hearts: {
          signal: parsed.hearts?.signal ?? 0,
          arena: parsed.hearts?.arena ?? 0,
          journey: parsed.hearts?.journey ?? 0,
          broadcast: parsed.hearts?.broadcast ?? 0,
          craft: parsed.hearts?.craft ?? 0,
        },
        mood: parsed.mood ?? freshMood(),
      };
    }
  } catch {
    // fall through to a fresh Wisp
  }
  return createWisp();
}

export function saveWisp(fingerprint: string, wisp: Wisp): void {
  try {
    localStorage.setItem(keyFor(fingerprint), JSON.stringify(wisp));
  } catch {
    // storage full/unavailable — non-fatal
  }
}
