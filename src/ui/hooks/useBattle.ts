import { useEffect, useRef, useState } from "react";
import type { Identity } from "@core/identity/index.ts";
import {
  attackerScores, battleCommit, decodeBattleInvite, decodeBattleMove, decodeBattleResult,
  encodeBattleAccept, encodeBattleCommit, encodeBattleInvite, encodeBattleResult, encodeBattleReveal,
  inviterAttacks, SubType, verifyCommit, WIN_SCORE,
} from "@core/protocol/index.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";
import { sfx } from "@ui/sound.ts";

// Wisp battles (REDESIGN §6–§7): a turn-based commit/reveal duel over LoRa. No
// authority — both devices compute the same score from the two revealed choices.
// The hook is a small state machine driven by inbound frames + the three buttons,
// with retransmit of the last frame and a forfeit timer for lost packets.

export type BattlePhase =
  | "idle" | "inviting" | "invited" | "choose" | "wait" | "reveal"
  | "result" | "won" | "lost" | "aborted";

export interface BattleView {
  phase: BattlePhase;
  oppHandle: string;
  oppForm: number;
  myForm: number;
  amInviter: boolean;
  battleId: number; // who attacks first is derived from this (fairness)
  round: number;
  myScore: number;
  oppScore: number;
  myChoice: number | null;
  /** Last resolved round, for the result screen. */
  last: { myChoice: number; oppChoice: number; iScored: boolean; iAttacked: boolean } | null;
  message?: string;
}

const IDLE: BattleView = {
  phase: "idle", oppHandle: "", oppForm: 0, myForm: 0, amInviter: false,
  battleId: 0, round: 0, myScore: 0, oppScore: 0, myChoice: null, last: null,
};

const RETRANSMIT_MS = 2500;
const FORFEIT_MS = 30_000;
const RESULT_MS = 2200;
const rngU32 = () => (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);

export function useBattle(
  identity: Identity | null,
  link: Relay,
  myFormIndex: () => number,
  resolveHandle: (fp: string) => string,
) {
  const [view, setView] = useState<BattleView>(IDLE);
  const v = useRef(view); v.current = view;
  const idRef = useRef(identity); idRef.current = identity;
  const formRef = useRef(myFormIndex); formRef.current = myFormIndex;
  const resolveRef = useRef(resolveHandle); resolveRef.current = resolveHandle;

  // Per-match secrets / wire bookkeeping (not rendered).
  const m = useRef({
    battleId: 0,
    oppFp: "",
    salt: null as Uint8Array | null,
    commit: null as Uint8Array | null,
    iRevealed: false,
    oppCommit: null as Uint8Array | null,
    oppReveal: null as { choice: number; salt: Uint8Array } | null,
    lastFrame: null as { subtype: SubType; payload: Uint8Array } | null,
    lastReveal: null as { subtype: SubType; payload: Uint8Array } | null,
    phaseAt: 0,
  });

  const set = (next: BattleView) => { v.current = next; setView(next); };
  const send = (subtype: SubType, payload: Uint8Array) => link.send(subtype, payload);
  const sendTracked = (subtype: SubType, payload: Uint8Array) => {
    m.current.lastFrame = { subtype, payload };
    m.current.phaseAt = Date.now();
    link.send(subtype, payload);
  };

  const resetMatch = () => {
    m.current.salt = null; m.current.commit = null; m.current.iRevealed = false;
    m.current.oppCommit = null; m.current.oppReveal = null;
  };

  const abort = (message: string) => {
    set({ ...v.current, phase: "aborted", message });
    m.current.lastFrame = null;
    sfx("error");
  };

  /** End the battle and clear the overlay. */
  const exit = () => { set(IDLE); m.current.lastFrame = null; };

  // ---- starting / answering ----

  const invite = (oppFp: string, oppHandle: string, oppForm = 0) => {
    const me = idRef.current;
    if (!me || !link.isConnected()) return;
    const battleId = rngU32();
    m.current.battleId = battleId; m.current.oppFp = oppFp; resetMatch();
    set({ ...IDLE, phase: "inviting", oppHandle, oppForm, myForm: formRef.current(), amInviter: true, battleId });
    sendTracked(SubType.GAME_INVITE, encodeBattleInvite({ battleId, fromFp: me.fingerprint, wispForm: formRef.current(), nonce: rngU32() }));
    sfx("connect");
  };

  const accept = () => {
    if (v.current.phase !== "invited") return;
    resetMatch();
    set({ ...v.current, phase: "choose", round: 0, myScore: 0, oppScore: 0, myChoice: null, last: null });
    sendTracked(SubType.GAME_INVITE, encodeBattleAccept({ battleId: m.current.battleId, accept: true, wispForm: formRef.current() }));
    sfx("accept");
  };

  const decline = () => {
    if (v.current.phase !== "invited") return;
    send(SubType.GAME_INVITE, encodeBattleAccept({ battleId: m.current.battleId, accept: false, wispForm: 0 }));
    exit();
  };

  // ---- a round: choose → commit → reveal → resolve ----

  const choose = (choice: number) => {
    if (v.current.phase !== "choose") return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const commit = battleCommit(choice, salt);
    m.current.salt = salt; m.current.commit = commit; m.current.iRevealed = false;
    set({ ...v.current, phase: "wait", myChoice: choice });
    sendTracked(SubType.GAME_MOVE, encodeBattleCommit(m.current.battleId, v.current.round, commit));
    sfx("select");
    progress();
  };

  // Drive the commit/reveal/resolve transitions whenever a piece arrives.
  const progress = () => {
    const s = m.current;
    const cur = v.current;
    // Both commits in hand → reveal.
    if (!s.iRevealed && s.commit && s.oppCommit && (cur.phase === "wait" || cur.phase === "choose")) {
      s.iRevealed = true;
      const frame = encodeBattleReveal(s.battleId, cur.round, cur.myChoice ?? 0, s.salt!);
      s.lastReveal = { subtype: SubType.GAME_MOVE, payload: frame };
      sendTracked(SubType.GAME_MOVE, frame);
      set({ ...v.current, phase: "reveal" });
    }
    // I've revealed + opponent revealed → resolve (after verifying their commit).
    if (s.iRevealed && s.oppReveal && s.oppCommit) {
      if (!verifyCommit(s.oppReveal.choice, s.oppReveal.salt, s.oppCommit)) { abort("CHEAT DETECTED"); return; }
      resolve(s.oppReveal.choice);
    }
  };

  const resolve = (oppChoice: number) => {
    const cur = v.current;
    const myChoice = cur.myChoice ?? 0;
    const iAttack = cur.amInviter === inviterAttacks(cur.round, cur.battleId);
    const att = iAttack ? myChoice : oppChoice;
    const blk = iAttack ? oppChoice : myChoice;
    const scored = attackerScores(att, blk);
    const myScore = cur.myScore + (scored && iAttack ? 1 : 0);
    const oppScore = cur.oppScore + (scored && !iAttack ? 1 : 0);
    send(SubType.GAME_RESULT, encodeBattleResult({ battleId: m.current.battleId, myScore, oppScore, round: cur.round }));
    const last = { myChoice, oppChoice, iScored: scored && iAttack, iAttacked: iAttack };
    const phase: BattlePhase = myScore >= WIN_SCORE ? "won" : oppScore >= WIN_SCORE ? "lost" : "result";
    set({ ...cur, phase, myScore, oppScore, last });
    sfx(phase === "won" ? "evolve" : phase === "lost" ? "cancel" : scored && iAttack ? "accept" : "feed");
    m.current.phaseAt = Date.now();
  };

  /** Advance from the result screen to the next round. */
  const nextRound = () => {
    const cur = v.current;
    if (cur.phase !== "result") return;
    resetMatch();
    set({ ...cur, phase: "choose", round: cur.round + 1, myChoice: null });
  };

  // ---- inbound ----

  useEffect(() => link.onInbound((f) => {
    const me = idRef.current;
    if (!me) return;
    if (f.subtype === SubType.GAME_INVITE) {
      const msg = decodeBattleInvite(f.payload);
      if (!msg) return;
      if (msg.kind === "invite") {
        if (v.current.phase !== "idle") return; // busy — ignore (no async hold yet)
        m.current.battleId = msg.battleId; m.current.oppFp = msg.fromFp; resetMatch();
        set({ ...IDLE, phase: "invited", oppHandle: resolveRef.current(msg.fromFp), oppForm: msg.wispForm, myForm: formRef.current(), amInviter: false, battleId: msg.battleId });
        sfx("connect");
      } else if (msg.kind === "accept" && msg.battleId === m.current.battleId && v.current.phase === "inviting") {
        if (!msg.accept) { abort("DECLINED"); return; }
        set({ ...v.current, phase: "choose", round: 0, oppForm: msg.wispForm });
      }
      return;
    }
    if (f.subtype === SubType.GAME_MOVE) {
      const msg = decodeBattleMove(f.payload);
      if (!msg || msg.battleId !== m.current.battleId) return;
      if (msg.round !== v.current.round) {
        // A stale reveal means they didn't get ours — resend it so they unstick.
        if (m.current.lastReveal) send(m.current.lastReveal.subtype, m.current.lastReveal.payload);
        return;
      }
      if (msg.kind === "commit") { m.current.oppCommit = msg.commit; progress(); }
      else { m.current.oppReveal = { choice: msg.choice, salt: msg.salt }; progress(); }
      return;
    }
    if (f.subtype === SubType.GAME_RESULT) {
      const r = decodeBattleResult(f.payload);
      if (!r || r.battleId !== m.current.battleId) return;
      // Their myScore is our oppScore and vice-versa; disagree at the same round = desync.
      if (r.round === v.current.round && (r.myScore !== v.current.oppScore || r.oppScore !== v.current.myScore)) {
        abort("BATTLE DESYNCED");
      }
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Retransmit the last frame while waiting; forfeit if the opponent goes silent.
  useEffect(() => {
    const iv = setInterval(() => {
      const phase = v.current.phase;
      const waiting = phase === "inviting" || phase === "wait" || phase === "reveal";
      if (!waiting) return;
      if (Date.now() - m.current.phaseAt > FORFEIT_MS) { abort("OPPONENT UNREACHABLE"); return; }
      if (m.current.lastFrame) send(m.current.lastFrame.subtype, m.current.lastFrame.payload);
    }, RETRANSMIT_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance the result screen to the next round.
  useEffect(() => {
    if (view.phase !== "result") return;
    const t = setTimeout(nextRound, RESULT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase, view.round]);

  return { view, invite, accept, decline, choose, nextRound, exit, abort };
}
