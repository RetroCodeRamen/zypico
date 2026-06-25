// Wisp battle wire formats + resolution (REDESIGN §6–§7). A turn-based,
// commit-and-reveal mind-game over LoRa — no real-time sync, no authority: both
// devices compute the same score from the two revealed choices.
//
//   INVITE  GAME_INVITE [tag=0][battleId:4][fromFp:6][wispForm:1][nonce:4]
//   ACCEPT  GAME_INVITE [tag=1][battleId:4][accept:1][wispForm:1]
//   COMMIT  GAME_MOVE   [battleId:4][round:1][kind=0][commit:32]   commit=sha256(choice‖salt)
//   REVEAL  GAME_MOVE   [battleId:4][round:1][kind=1][choice:1][salt:16]
//   RESULT  GAME_RESULT [battleId:4][myScore:1][oppScore:1][round:1]
//
// A match is scoped by a random battleId; rounds order turns; frames are
// idempotent by (battleId, round, kind). Choices: 0 = SELECT, 1 = ACCEPT.

import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";

const FP_LEN = 6;
export const SALT_LEN = 16;
export const COMMIT_LEN = 32;

export const CHOICE_SELECT = 0;
export const CHOICE_ACCEPT = 1;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}
function readU32(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o);
}

// ---- GAME_INVITE (invite / accept) ------------------------------------------

export interface BattleInvite { battleId: number; fromFp: string; wispForm: number; nonce: number }
export interface BattleAccept { battleId: number; accept: boolean; wispForm: number }
export type BattleInviteMsg =
  | ({ kind: "invite" } & BattleInvite)
  | ({ kind: "accept" } & BattleAccept);

export function encodeBattleInvite(i: BattleInvite): Uint8Array {
  return concat(Uint8Array.of(0), u32(i.battleId), hexToBytes(i.fromFp), Uint8Array.of(i.wispForm & 0xff), u32(i.nonce));
}
export function encodeBattleAccept(a: BattleAccept): Uint8Array {
  return concat(Uint8Array.of(1), u32(a.battleId), Uint8Array.of(a.accept ? 1 : 0), Uint8Array.of(a.wispForm & 0xff));
}
export function decodeBattleInvite(p: Uint8Array): BattleInviteMsg | null {
  if (p.length < 1) return null;
  if (p[0] === 0) {
    if (p.length < 1 + 4 + FP_LEN + 1 + 4) return null;
    return { kind: "invite", battleId: readU32(p, 1), fromFp: bytesToHex(p.slice(5, 5 + FP_LEN)), wispForm: p[11], nonce: readU32(p, 12) };
  }
  if (p[0] === 1) {
    if (p.length < 1 + 4 + 1 + 1) return null;
    return { kind: "accept", battleId: readU32(p, 1), accept: p[5] === 1, wispForm: p[6] };
  }
  return null;
}

// ---- GAME_MOVE (commit / reveal) --------------------------------------------

export type BattleMove =
  | { kind: "commit"; battleId: number; round: number; commit: Uint8Array }
  | { kind: "reveal"; battleId: number; round: number; choice: number; salt: Uint8Array };

export function encodeBattleCommit(battleId: number, round: number, commit: Uint8Array): Uint8Array {
  return concat(u32(battleId), Uint8Array.of(round & 0xff, 0), commit);
}
export function encodeBattleReveal(battleId: number, round: number, choice: number, salt: Uint8Array): Uint8Array {
  return concat(u32(battleId), Uint8Array.of(round & 0xff, 1, choice & 0xff), salt);
}
export function decodeBattleMove(p: Uint8Array): BattleMove | null {
  if (p.length < 6) return null;
  const battleId = readU32(p, 0);
  const round = p[4];
  if (p[5] === 0) {
    if (p.length < 6 + COMMIT_LEN) return null;
    return { kind: "commit", battleId, round, commit: p.slice(6, 6 + COMMIT_LEN) };
  }
  if (p[5] === 1) {
    if (p.length < 6 + 1 + SALT_LEN) return null;
    return { kind: "reveal", battleId, round, choice: p[6], salt: p.slice(7, 7 + SALT_LEN) };
  }
  return null;
}

// ---- GAME_RESULT ------------------------------------------------------------

export interface BattleResult { battleId: number; myScore: number; oppScore: number; round: number }
export function encodeBattleResult(r: BattleResult): Uint8Array {
  return concat(u32(r.battleId), Uint8Array.of(r.myScore & 0xff, r.oppScore & 0xff, r.round & 0xff));
}
export function decodeBattleResult(p: Uint8Array): BattleResult | null {
  if (p.length < 7) return null;
  return { battleId: readU32(p, 0), myScore: p[4], oppScore: p[5], round: p[6] };
}

// ---- commit / resolution ----------------------------------------------------

/** The commitment for a choice: sha256(choice ‖ salt). */
export function battleCommit(choice: number, salt: Uint8Array): Uint8Array {
  return sha256(concat(Uint8Array.of(choice & 0xff), salt));
}
/** Verify a revealed choice+salt against a prior commitment. */
export function verifyCommit(choice: number, salt: Uint8Array, commit: Uint8Array): boolean {
  const c = battleCommit(choice, salt);
  return c.length === commit.length && c.every((b, i) => b === commit[i]);
}

/** Roles alternate every round; WHO attacks first is randomized by the battleId
 *  (both devices know it), so the challenger has no first-mover edge (§6). */
export function inviterAttacks(round: number, battleId: number): boolean {
  return ((round + (battleId & 1)) % 2) === 0;
}
/** The attacker scores iff the two choices differ; a match is a block (§6). */
export function attackerScores(attackerChoice: number, blockerChoice: number): boolean {
  return attackerChoice !== blockerChoice;
}

export const WIN_SCORE = 3;
