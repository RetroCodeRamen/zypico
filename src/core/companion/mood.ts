// Bond & Mood — the Wisp's *warmth* system (DESIGN §2), kept deliberately apart
// from Hearts/evolution. Hearts say who the Wisp *is* (earned by participation);
// Mood says how it *feels* (moved by care). Care never touches Hearts, and Mood
// never touches evolution.
//
// Non-punitive by design ("Tamagotchi affection without Tamagotchi stress"): a
// Wisp never dies and never regresses. Need meters drain **gently** over real
// time and a neglected Wisp simply grows lonely — then brightens the moment you
// return. Pure + framework-agnostic (plan §5), so it unit-tests with no DOM.

export type Care = "feed" | "treat" | "play" | "clean" | "rest" | "talk";

export const CARES: Care[] = ["feed", "treat", "play", "clean", "rest", "talk"];

export interface CareDef {
  id: Care;
  /** Menu label (LCD). */
  label: string;
  /** What the act is, in-world. */
  blurb: string;
}

export const CARE_DEFS: Record<Care, CareDef> = {
  feed: { id: "feed", label: "FEED", blurb: "a proper meal" },
  treat: { id: "treat", label: "TREAT", blurb: "a little something" },
  play: { id: "play", label: "PLAY", blurb: "romp about" },
  clean: { id: "clean", label: "CLEAN", blurb: "tidy up" },
  rest: { id: "rest", label: "REST", blurb: "a quiet nap" },
  talk: { id: "talk", label: "TALK", blurb: "a chat together" },
};

// The four need meters (0..100) plus Bond (0..100). Meters are stored as last
// settled here + when they were settled; selectors bring them current on read.
export interface Mood {
  fed: number;
  energy: number;
  clean: number;
  joy: number;
  /** Slow-growing, slow-fading closeness — the long relationship. */
  bond: number;
  /** When the meters above were last brought current (for lazy decay). */
  settledAt: number;
  /** When the traveler last performed any care (for "missed you"). */
  tendedAt: number;
}

export const MOOD_MAX = 100;
const START = 70; // a freshly-hatched Wisp is comfortable, not needy

type Meter = "fed" | "energy" | "clean" | "joy";

// Care effects on the need meters. Deltas, clamped to 0..MOOD_MAX on apply.
const EFFECTS: Record<Care, Partial<Record<Meter, number>>> = {
  feed: { fed: 35, joy: 4 },
  treat: { fed: 12, joy: 26 },
  play: { joy: 28, energy: -18, fed: -6 },
  clean: { clean: 60, joy: 4 },
  rest: { energy: 45, joy: 2 },
  talk: { joy: 16 },
};

// Bond grows a little with any care; talking deepens it most.
const BOND_GAIN: Record<Care, number> = { feed: 2, treat: 3, play: 4, clean: 2, rest: 2, talk: 6 };

// Gentle drain per hour. Bond fades far slower (per day) — closeness lingers.
const DECAY_PER_HOUR: Record<Meter, number> = { fed: 4, energy: 3, clean: 2.5, joy: 3 };
const BOND_DECAY_PER_DAY = 1.5;

const HOUR = 3_600_000;
const DAY = 86_400_000;

function clamp(v: number): number {
  return v < 0 ? 0 : v > MOOD_MAX ? MOOD_MAX : v;
}

export function freshMood(now: () => number = Date.now): Mood {
  const t = now();
  return { fed: START, energy: START, clean: START, joy: START, bond: 0, settledAt: t, tendedAt: t };
}

/** Bring the meters current for elapsed real time (lazy, idempotent decay). */
export function settleMood(mood: Mood, at: number): Mood {
  const hours = Math.max(0, (at - mood.settledAt) / HOUR);
  if (hours === 0) return mood;
  const days = (at - mood.settledAt) / DAY;
  return {
    ...mood,
    fed: clamp(mood.fed - DECAY_PER_HOUR.fed * hours),
    energy: clamp(mood.energy - DECAY_PER_HOUR.energy * hours),
    clean: clamp(mood.clean - DECAY_PER_HOUR.clean * hours),
    joy: clamp(mood.joy - DECAY_PER_HOUR.joy * hours),
    bond: clamp(mood.bond - BOND_DECAY_PER_DAY * Math.max(0, days)),
    settledAt: at,
  };
}

/** Perform a care action: settle, apply its effects, deepen bond, mark tended. */
export function applyCare(mood: Mood, care: Care, now: () => number = Date.now): Mood {
  const t = now();
  const m = settleMood(mood, t);
  const eff = EFFECTS[care];
  return {
    ...m,
    fed: clamp(m.fed + (eff.fed ?? 0)),
    energy: clamp(m.energy + (eff.energy ?? 0)),
    clean: clamp(m.clean + (eff.clean ?? 0)),
    joy: clamp(m.joy + (eff.joy ?? 0)),
    bond: clamp(m.bond + BOND_GAIN[care]),
    tendedAt: t,
  };
}

export type MoodState =
  | "joyful" | "happy" | "content" | "okay" | "lonely" | "sad"
  | "sleepy" | "hungry" | "messy";

export interface MoodStateDef {
  id: MoodState;
  label: string;
  /** PICO-8 tint the renderer may use to color the emotion. */
  color: number;
  /** A few short lines the Wisp might say in this state (≤22 chars for the LCD). */
  lines: string[];
}

export const MOOD_STATE_DEFS: Record<MoodState, MoodStateDef> = {
  joyful: { id: "joyful", label: "JOYFUL", color: 10, lines: ["BEST DAY EVER!", "IM SO HAPPY", "LETS DO MORE!"] },
  happy: { id: "happy", label: "HAPPY", color: 11, lines: ["FEELING GREAT", "GOOD TO SEE YOU", "ALL IS WELL"] },
  content: { id: "content", label: "CONTENT", color: 6, lines: ["JUST FINE", "NICE AND CALM", "HUMMING ALONG"] },
  okay: { id: "okay", label: "OKAY", color: 6, lines: ["COULD BE BETTER", "IM ALRIGHT", "A BIT RESTLESS"] },
  lonely: { id: "lonely", label: "LONELY", color: 12, lines: ["I MISSED YOU", "WHERE WERE YOU?", "ITS BEEN QUIET"] },
  sad: { id: "sad", label: "SAD", color: 12, lines: ["FEELING LOW", "PLEASE STAY", "I NEED SOME CARE"] },
  sleepy: { id: "sleepy", label: "SLEEPY", color: 5, lines: ["SO TIRED...", "NEED A NAP", "*yawn*"] },
  hungry: { id: "hungry", label: "HUNGRY", color: 9, lines: ["IM HUNGRY", "GOT A SNACK?", "TUMMY RUMBLING"] },
  messy: { id: "messy", label: "MESSY", color: 13, lines: ["IM ALL MESSY", "NEED A WASH", "TIDY ME UP?"] },
};

/** Overall comfort across the four need meters (0..100). */
export function comfort(mood: Mood, at: number): number {
  const m = settleMood(mood, at);
  return (m.fed + m.energy + m.clean + m.joy) / 4;
}

// The Wisp's current feeling. After a long absence the emotional headline is
// "I missed you" (DESIGN §2) — loneliness leads, since the drained need meters
// would otherwise mask it. With recent care, urgent unmet needs surface first
// (sleepy/hungry/messy), then the overall comfort band. Never a failure state —
// the worst case is "sad", which a little care lifts.
export function moodState(mood: Mood, at: number): MoodState {
  const m = settleMood(mood, at);
  const daysSinceTended = (at - m.tendedAt) / DAY;
  if (daysSinceTended > 2 && m.joy < 55) return "lonely";
  if (m.energy < 25) return "sleepy";
  if (m.fed < 25) return "hungry";
  if (m.clean < 25) return "messy";
  const avg = (m.fed + m.energy + m.clean + m.joy) / 4;
  if (avg >= 80 && m.joy >= 75) return "joyful";
  if (avg >= 60) return "happy";
  if (avg >= 40) return "content";
  if (avg >= 25) return "okay";
  return "sad";
}
