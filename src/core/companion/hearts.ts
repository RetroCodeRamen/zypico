// The five Hearts (outline §3.2). Hearts fill from how a traveler participates
// and are tracked locally and cosmetically (never server-verified, §9.4). Each
// heart accumulates points; the Wisp's tier and form derive from them (wisp.ts).
//
// Visual tones below follow the outline's table, mapped to PICO-8 indices so the
// renderer can color a Wisp by its dominant heart.

export type Heart = "signal" | "arena" | "journey" | "broadcast" | "craft";

export const HEARTS: Heart[] = ["signal", "arena", "journey", "broadcast", "craft"];

export interface HeartDef {
  id: Heart;
  /** Single-letter tag used in the cramped LCD (S/A/J/B/C). */
  tag: string;
  label: string;
  /** What fills it (outline §3.2). */
  filledBy: string;
  /** PICO-8 palette index for this heart's visual tone. */
  color: number;
}

export const HEART_DEFS: Record<Heart, HeartDef> = {
  signal: { id: "signal", tag: "S", label: "SIGNAL", filledBy: "IM, mail, friends", color: 10 }, // warm golden
  arena: { id: "arena", tag: "A", label: "ARENA", filledBy: "games, bouts", color: 12 }, // crystalline blue
  journey: { id: "journey", tag: "J", label: "JOURNEY", filledBy: "quests, discovery", color: 11 }, // cool green
  broadcast: { id: "broadcast", tag: "B", label: "BROADCAST", filledBy: "posting, replies", color: 8 }, // loud red
  craft: { id: "craft", tag: "C", label: "CRAFT", filledBy: "making, carts", color: 13 }, // lattice lavender
};

export type Hearts = Record<Heart, number>;

export function emptyHearts(): Hearts {
  return { signal: 0, arena: 0, journey: 0, broadcast: 0, craft: 0 };
}

export function totalHearts(h: Hearts): number {
  return h.signal + h.arena + h.journey + h.broadcast + h.craft;
}

/** The dominant heart (ties broken by HEARTS order). */
export function dominantHeart(h: Hearts): Heart {
  return HEARTS.reduce((best, k) => (h[k] > h[best] ? k : best), HEARTS[0]);
}
