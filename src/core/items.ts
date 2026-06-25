// Items & collection (REDESIGN §10) — a small, curiosity-driven inventory, NOT a
// grind economy. Few, meaningful items with visible uses. Pure + DOM-free so the
// catalog + stacking rules unit-test in isolation; storage + UI sit on top.

export type ItemKind = "treat" | "toy" | "badge" | "souvenir";

export interface ItemDef {
  name: string;
  kind: ItemKind;
  desc: string;
  /** Usable items do something when ACCEPTed in the Bag (treats feed, toys play). */
  usable: boolean;
}

// The curated catalog. Ids are the stable storage/wire key; names are display.
export const ITEM_DEFS: Record<string, ItemDef> = {
  berry: { name: "BERRY", kind: "treat", desc: "A SWEET BERRY. YOUR WISP LOVES THESE.", usable: true },
  starsnack: { name: "STARSNACK", kind: "treat", desc: "A GLOWING SNACK FROM THE RELAY.", usable: true },
  ball: { name: "BALL", kind: "toy", desc: "A BOUNCY BALL - GREAT FOR PLAY.", usable: true },
  arena_badge: { name: "ARENA BADGE", kind: "badge", desc: "EARNED BY WINNING A WISP BATTLE.", usable: false },
  traveler_pin: { name: "TRAVELER PIN", kind: "souvenir", desc: "A KEEPSAKE FROM MEETING A TRAVELER.", usable: false },
  relay_shard: { name: "RELAY SHARD", kind: "souvenir", desc: "A SIGNAL FRAGMENT FROM A STATION.", usable: false },
};

export const TREATS = ["berry", "starsnack"];
export function randomTreat(): string { return TREATS[Math.floor(Math.random() * TREATS.length)]; }

/** One inventory slot: an item id and how many you hold (duplicates stack). */
export interface InvEntry { id: string; count: number }

export const STACK_CAP = 9; // duplicates stack up to here, then stop piling up

/** Add one of `id` (stacks, capped). Unknown ids are ignored (no clutter). */
export function addItem(inv: InvEntry[], id: string): InvEntry[] {
  if (!ITEM_DEFS[id]) return inv;
  const existing = inv.find((e) => e.id === id);
  if (existing) {
    if (existing.count >= STACK_CAP) return inv;
    return inv.map((e) => (e.id === id ? { ...e, count: e.count + 1 } : e));
  }
  return [...inv, { id, count: 1 }];
}

/** Consume one of `id`; the slot is removed when it hits zero. */
export function useItem(inv: InvEntry[], id: string): InvEntry[] {
  return inv
    .map((e) => (e.id === id ? { ...e, count: e.count - 1 } : e))
    .filter((e) => e.count > 0);
}
