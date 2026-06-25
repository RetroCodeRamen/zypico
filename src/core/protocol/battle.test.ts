import { describe, expect, it } from "vitest";
import {
  attackerScores, battleCommit, CHOICE_ACCEPT, CHOICE_SELECT, decodeBattleInvite, decodeBattleMove,
  decodeBattleResult, encodeBattleAccept, encodeBattleCommit, encodeBattleInvite, encodeBattleResult,
  encodeBattleReveal, inviterAttacks, verifyCommit,
} from "./battle.ts";

describe("battle protocol", () => {
  it("round-trips an invite", () => {
    const m = decodeBattleInvite(encodeBattleInvite({ battleId: 0xdeadbeef, fromFp: "0123456789ab", wispForm: 3, nonce: 42 }));
    expect(m).toEqual({ kind: "invite", battleId: 0xdeadbeef, fromFp: "0123456789ab", wispForm: 3, nonce: 42 });
  });

  it("round-trips accept / decline", () => {
    expect(decodeBattleInvite(encodeBattleAccept({ battleId: 7, accept: true, wispForm: 2 })))
      .toEqual({ kind: "accept", battleId: 7, accept: true, wispForm: 2 });
    expect(decodeBattleInvite(encodeBattleAccept({ battleId: 7, accept: false, wispForm: 0 })))
      .toMatchObject({ kind: "accept", accept: false });
  });

  it("round-trips a commit", () => {
    const commit = battleCommit(CHOICE_ACCEPT, new Uint8Array(16).fill(9));
    const m = decodeBattleMove(encodeBattleCommit(99, 2, commit));
    expect(m?.kind).toBe("commit");
    if (m?.kind === "commit") { expect(m.battleId).toBe(99); expect(m.round).toBe(2); expect([...m.commit]).toEqual([...commit]); }
  });

  it("round-trips a reveal", () => {
    const salt = new Uint8Array(16).map((_, i) => i);
    const m = decodeBattleMove(encodeBattleReveal(99, 2, CHOICE_SELECT, salt));
    expect(m?.kind).toBe("reveal");
    if (m?.kind === "reveal") { expect(m.choice).toBe(CHOICE_SELECT); expect([...m.salt]).toEqual([...salt]); }
  });

  it("round-trips a result", () => {
    expect(decodeBattleResult(encodeBattleResult({ battleId: 5, myScore: 2, oppScore: 1, round: 4 })))
      .toEqual({ battleId: 5, myScore: 2, oppScore: 1, round: 4 });
  });

  it("verifies a matching commit and rejects tampering", () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const commit = battleCommit(CHOICE_ACCEPT, salt);
    expect(verifyCommit(CHOICE_ACCEPT, salt, commit)).toBe(true);
    expect(verifyCommit(CHOICE_SELECT, salt, commit)).toBe(false); // changed choice
    const badSalt = Uint8Array.from(salt); badSalt[0] ^= 1;
    expect(verifyCommit(CHOICE_ACCEPT, badSalt, commit)).toBe(false); // changed salt
  });

  it("resolves rounds the same on both devices (differ = score, match = block)", () => {
    expect(attackerScores(CHOICE_SELECT, CHOICE_ACCEPT)).toBe(true);
    expect(attackerScores(CHOICE_ACCEPT, CHOICE_ACCEPT)).toBe(false);
    expect(inviterAttacks(0)).toBe(true);
    expect(inviterAttacks(1)).toBe(false);
  });

  it("rejects malformed payloads", () => {
    expect(decodeBattleInvite(new Uint8Array(0))).toBeNull();
    expect(decodeBattleMove(Uint8Array.of(1, 2, 3))).toBeNull();
    expect(decodeBattleResult(Uint8Array.of(1, 2))).toBeNull();
  });
});
