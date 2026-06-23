import { describe, expect, it } from "vitest";
import {
  applyCare, comfort, freshMood, MOOD_MAX, moodState, settleMood,
} from "./index.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const at = (ms: number) => () => ms;

describe("care", () => {
  it("a fresh Wisp is comfortable, not needy", () => {
    const m = freshMood(at(0));
    expect(comfort(m, 0)).toBeGreaterThanOrEqual(60);
    expect(moodState(m, 0)).toBe("happy");
    expect(m.bond).toBe(0);
  });

  it("feeding raises fed; talking deepens bond most; care marks 'tended'", () => {
    const m0 = freshMood(at(0));
    const fed = applyCare(m0, "feed", at(HOUR));
    expect(fed.fed).toBeGreaterThan(settleMood(m0, HOUR).fed);
    expect(fed.tendedAt).toBe(HOUR);

    expect(applyCare(m0, "talk", at(0)).bond).toBeGreaterThan(applyCare(m0, "feed", at(0)).bond);
  });

  it("meters never exceed MOOD_MAX", () => {
    let m = freshMood(at(0));
    for (let i = 0; i < 10; i++) m = applyCare(m, "feed", at(0));
    expect(m.fed).toBe(MOOD_MAX);
  });

  it("play tires the Wisp; rest restores energy", () => {
    const m0 = freshMood(at(0));
    expect(applyCare(m0, "play", at(0)).energy).toBeLessThan(m0.energy);
    const tired = { ...m0, energy: 20 };
    expect(applyCare(tired, "rest", at(0)).energy).toBeGreaterThan(20);
  });
});

describe("gentle decay (never punishing)", () => {
  it("needs drain slowly over time, clamped at 0", () => {
    const m = freshMood(at(0));
    const day = settleMood(m, DAY);
    expect(day.fed).toBeLessThan(m.fed);
    expect(day.fed).toBeGreaterThanOrEqual(0);
    // Even after a long absence nothing goes negative (no death state).
    const gone = settleMood(m, 30 * DAY);
    expect(gone.fed).toBe(0);
    expect(gone.joy).toBe(0);
  });

  it("bond fades far slower than the need meters", () => {
    const m = { ...freshMood(at(0)), bond: 60 };
    const afterDay = settleMood(m, DAY);
    expect(afterDay.bond).toBeGreaterThan(55); // barely moved
    expect(60 - afterDay.bond).toBeLessThan(m.fed - afterDay.fed); // slower than fed
  });
});

describe("mood states", () => {
  it("surfaces an urgent unmet need first", () => {
    const base = freshMood(at(0));
    expect(moodState({ ...base, energy: 10 }, 0)).toBe("sleepy");
    expect(moodState({ ...base, fed: 10 }, 0)).toBe("hungry");
    expect(moodState({ ...base, clean: 10 }, 0)).toBe("messy");
  });

  it("grows lonely after neglect, then brightens with care", () => {
    const neglected = { ...freshMood(at(0)), joy: 40, tendedAt: 0 };
    expect(moodState(neglected, 3 * DAY)).toBe("lonely");
    const cared = applyCare(neglected, "talk", at(3 * DAY));
    expect(moodState(cared, 3 * DAY)).not.toBe("lonely");
  });

  it("never reports worse than 'sad' — the worst case is still recoverable", () => {
    const empty = { ...freshMood(at(0)), fed: 30, energy: 30, clean: 30, joy: 5, tendedAt: 0 };
    // joy floored but needs above the urgent thresholds → the comfort band bottoms at "sad".
    expect(moodState(empty, 0)).toBe("sad");
  });
});
