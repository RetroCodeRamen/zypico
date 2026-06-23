import { describe, expect, it } from "vitest";
import {
  applyActivity,
  createWisp,
  deriveForm,
  emptyHearts,
  THRESHOLD,
  tierForTotal,
  wispForm,
  wispTier,
  type Hearts,
} from "./index.ts";

const hearts = (p: Partial<Hearts>): Hearts => ({ ...emptyHearts(), ...p });

describe("tiers", () => {
  it("rises with total participation and never implies death", () => {
    expect(tierForTotal(0)).toBe(1);
    expect(tierForTotal(THRESHOLD.ember - 1)).toBe(1);
    expect(tierForTotal(THRESHOLD.ember)).toBe(2);
    expect(tierForTotal(THRESHOLD.glow)).toBe(3);
    expect(tierForTotal(THRESHOLD.beacon)).toBe(4);
  });

  it("a neglected Wisp stays a Flicker", () => {
    expect(wispForm(createWisp(() => 0)).id).toBe("flicker");
  });
});

describe("evolution tree", () => {
  it("Flicker → Warm/Bright Ember by people-vs-world lean", () => {
    expect(deriveForm(hearts({ signal: THRESHOLD.ember }))).toBe("warm_ember");
    expect(deriveForm(hearts({ craft: THRESHOLD.ember }))).toBe("bright_ember");
  });

  it("reaches the right Glow node", () => {
    expect(deriveForm(hearts({ signal: THRESHOLD.glow }))).toBe("closewarm_glow");
    expect(deriveForm(hearts({ broadcast: THRESHOLD.glow }))).toBe("publicwarm_glow");
    expect(deriveForm(hearts({ journey: THRESHOLD.glow }))).toBe("venturing_glow");
    expect(deriveForm(hearts({ craft: THRESHOLD.glow }))).toBe("making_glow");
  });

  it("reaches the eight Beacons from dominant hearts", () => {
    expect(deriveForm(hearts({ signal: THRESHOLD.beacon }))).toBe("lantern");
    expect(deriveForm(hearts({ broadcast: THRESHOLD.beacon }))).toBe("herald");
    expect(deriveForm(hearts({ journey: THRESHOLD.beacon }))).toBe("pathfinder");
    expect(deriveForm(hearts({ arena: THRESHOLD.beacon }))).toBe("champion");
    expect(deriveForm(hearts({ craft: THRESHOLD.beacon }))).toBe("forge");
  });

  it("splits same-heart Beacons by the secondary lean", () => {
    // Strong signal with real broadcast presence → Hearth (a circle), else Lantern.
    expect(deriveForm(hearts({ signal: 300, broadcast: 200 }))).toBe("hearth");
    expect(deriveForm(hearts({ signal: 400, broadcast: 10 }))).toBe("lantern");
    // Craft with a narrative (broadcast) lean → Weaver, else Forge.
    expect(deriveForm(hearts({ craft: 300, broadcast: 150 }))).toBe("weaver");
    expect(deriveForm(hearts({ craft: 400, arena: 80 }))).toBe("forge");
  });
});

describe("drift (re-pathing)", () => {
  it("changes form as behavior shifts, but never drops tier", () => {
    // Raised toward people → a warm Beacon.
    let w = createWisp(() => 0);
    w = applyActivity(w, "signal", THRESHOLD.beacon);
    expect(wispForm(w).id).toBe("lantern");
    expect(wispTier(w)).toBe(4);

    // Later, heavy crafting outweighs the old signal → drifts toward Making/Forge,
    // staying tier 4 (earned maturity stays).
    w = applyActivity(w, "craft", THRESHOLD.beacon * 2);
    expect(wispTier(w)).toBe(4);
    expect(wispForm(w).id).toBe("forge");
  });
});

describe("applyActivity", () => {
  it("adds points immutably to one heart", () => {
    const w0 = createWisp(() => 0);
    const w1 = applyActivity(w0, "arena", 12);
    expect(w0.hearts.arena).toBe(0); // original untouched
    expect(w1.hearts.arena).toBe(12);
  });
});
