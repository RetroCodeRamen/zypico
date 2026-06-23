// The Wisp — the companion engine (outline §3.3–3.5). Behavior-driven, not
// level-driven: the *tier* (how mature) comes from total participation, and the
// *form* (which kind of mature) comes from the distribution of hearts at the
// moment of evolving. Because the form is always derived from current hearts,
// "drift" (re-pathing, §3.5) happens naturally as a traveler's behavior shifts —
// while the tier only ever rises (earned maturity stays).
//
// Framework-agnostic and pure (plan §5): the same engine ports to the T-Deck and
// unit-tests with no DOM. Thresholds are tunable (plan §13 open items).

import { emptyHearts, type Heart, type Hearts, totalHearts } from "./hearts.ts";
import { freshMood, type Mood } from "./mood.ts";

export type Tier = 1 | 2 | 3 | 4;

export const TIER_NAMES: Record<Tier, string> = {
  1: "FLICKER",
  2: "EMBER",
  3: "GLOW",
  4: "BEACON",
};

// Total-heart thresholds for each tier boundary (tunable).
export const THRESHOLD = { ember: 40, glow: 160, beacon: 400 } as const;

export type FlickerId = "flicker";
export type EmberId = "warm_ember" | "bright_ember";
export type GlowId =
  | "closewarm_glow" | "publicwarm_glow" | "venturing_glow" | "making_glow";
export type BeaconId =
  | "lantern" | "hearth" | "herald" | "chorus"
  | "pathfinder" | "champion" | "forge" | "weaver";
export type FormId = FlickerId | EmberId | GlowId | BeaconId;

export interface FormDef {
  id: FormId;
  name: string;
  tier: Tier;
  /** PICO-8 color the renderer tints this form. */
  color: number;
  blurb: string;
}

export const FORMS: Record<FormId, FormDef> = {
  flicker: { id: "flicker", name: "Flicker", tier: 1, color: 6, blurb: "A thin, uncertain light." },
  warm_ember: { id: "warm_ember", name: "Warm Ember", tier: 2, color: 9, blurb: "Turned toward people." },
  bright_ember: { id: "bright_ember", name: "Bright Ember", tier: 2, color: 12, blurb: "Turned toward the world." },
  closewarm_glow: { id: "closewarm_glow", name: "Close Glow", tier: 3, color: 10, blurb: "Warmth, up close." },
  publicwarm_glow: { id: "publicwarm_glow", name: "Public Glow", tier: 3, color: 8, blurb: "Warmth, out loud." },
  venturing_glow: { id: "venturing_glow", name: "Venturing Glow", tier: 3, color: 11, blurb: "Out exploring." },
  making_glow: { id: "making_glow", name: "Making Glow", tier: 3, color: 13, blurb: "Always building." },
  lantern: { id: "lantern", name: "Lantern", tier: 4, color: 10, blurb: "Steady one-to-one warmth." },
  hearth: { id: "hearth", name: "Hearth", tier: 4, color: 9, blurb: "Gathers and holds a circle." },
  herald: { id: "herald", name: "Herald", tier: 4, color: 8, blurb: "A voice that carries." },
  chorus: { id: "chorus", name: "Chorus", tier: 4, color: 14, blurb: "Lifts other voices." },
  pathfinder: { id: "pathfinder", name: "Pathfinder", tier: 4, color: 11, blurb: "Explores and maps." },
  champion: { id: "champion", name: "Champion", tier: 4, color: 12, blurb: "Sharpens against others." },
  forge: { id: "forge", name: "Forge", tier: 4, color: 4, blurb: "Builds the tools others use." },
  weaver: { id: "weaver", name: "Weaver", tier: 4, color: 13, blurb: "Makes stories and guides." },
};

export function tierForTotal(total: number): Tier {
  if (total >= THRESHOLD.beacon) return 4;
  if (total >= THRESHOLD.glow) return 3;
  if (total >= THRESHOLD.ember) return 2;
  return 1;
}

/** Derive the Wisp's form from its hearts — the whole evolution tree (§3.4). */
export function deriveForm(hearts: Hearts): FormId {
  const tier = tierForTotal(totalHearts(hearts));
  if (tier === 1) return "flicker";

  // Split 1: people (Signal+Broadcast) vs the world & works (Journey+Arena+Craft).
  const people = hearts.signal + hearts.broadcast;
  const world = hearts.journey + hearts.arena + hearts.craft;
  const warm = people >= world;
  if (tier === 2) return warm ? "warm_ember" : "bright_ember";

  // Split 2: the glow node.
  let glow: GlowId;
  if (warm) {
    glow = hearts.signal >= hearts.broadcast ? "closewarm_glow" : "publicwarm_glow";
  } else {
    const venturing = hearts.journey + hearts.arena;
    glow = venturing >= hearts.craft ? "venturing_glow" : "making_glow";
  }
  if (tier === 3) return glow;

  // Split 3: the beacon leaf, by the secondary lean within each glow.
  switch (glow) {
    case "closewarm_glow":
      return hearts.broadcast * 2 >= hearts.signal ? "hearth" : "lantern";
    case "publicwarm_glow":
      return hearts.signal * 2 >= hearts.broadcast ? "chorus" : "herald";
    case "venturing_glow":
      return hearts.journey >= hearts.arena ? "pathfinder" : "champion";
    case "making_glow":
      // Forge (tools/quests) is the base maker; a narrative/Broadcast lean → Weaver.
      return hearts.broadcast > hearts.arena ? "weaver" : "forge";
  }
}

export interface Wisp {
  /** Traveler-given name; empty until named at hatch. */
  name: string;
  hearts: Hearts;
  /** Warmth system (care/feel) — independent of hearts/evolution (DESIGN §2). */
  mood: Mood;
  /** Epoch ms when the Wisp awoke from drift. */
  bornAt: number;
}

export function createWisp(now: () => number = Date.now): Wisp {
  return { name: "", hearts: emptyHearts(), mood: freshMood(now), bornAt: now() };
}

/** Add participation to one heart (immutable). The only way a Wisp grows. */
export function applyActivity(wisp: Wisp, heart: Heart, amount: number): Wisp {
  return { ...wisp, hearts: { ...wisp.hearts, [heart]: wisp.hearts[heart] + amount } };
}

export function renameWisp(wisp: Wisp, name: string): Wisp {
  return { ...wisp, name };
}

export function wispTier(wisp: Wisp): Tier {
  return tierForTotal(totalHearts(wisp.hearts));
}

export function wispForm(wisp: Wisp): FormDef {
  return FORMS[deriveForm(wisp.hearts)];
}

/** Whole-number days since the Wisp awoke (for the detail view). */
export function wispAgeDays(wisp: Wisp, now: () => number = Date.now): number {
  return Math.floor((now() - wisp.bornAt) / 86_400_000);
}
