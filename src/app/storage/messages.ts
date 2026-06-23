// Message persistence — DM threads and the main chatroom cache. Like the rest
// of local state these are scoped to the traveler's identity (fingerprint), so
// separate logins on one device keep separate histories.
//
// localStorage for now; the plan's home for this is IndexedDB via Dexie (plan
// §4). Keeping it behind these functions means that swap stays local later —
// the same staging wisp.ts/buddies.ts already follow.

import type { HlcTimestamp } from "@core/protocol/index.ts";

/** One line in a DM thread: outgoing (ours) or incoming, plus the text. */
export interface DmLine { out: boolean; text: string }
/** DM threads keyed by the *other* party's fingerprint. */
export type DmThreads = Record<string, DmLine[]>;
/** One line in the HLC-ordered main chatroom. */
export interface RoomLine { ts: HlcTimestamp; senderFp: string; handle: string; text: string; mine: boolean }

const dmsKey = (fp: string) => `zypico.dms.${fp}`;
const roomKey = (fp: string) => `zypico.room.main.${fp}`;

export function loadDmThreads(fingerprint: string): DmThreads {
  try {
    const raw = localStorage.getItem(dmsKey(fingerprint));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DmThreads;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDmThreads(fingerprint: string, threads: DmThreads): void {
  try {
    localStorage.setItem(dmsKey(fingerprint), JSON.stringify(threads));
  } catch {
    // storage full/unavailable — non-fatal
  }
}

export function loadRoom(fingerprint: string): RoomLine[] {
  try {
    const raw = localStorage.getItem(roomKey(fingerprint));
    if (!raw) return [];
    const list = JSON.parse(raw) as RoomLine[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveRoom(fingerprint: string, msgs: RoomLine[]): void {
  try {
    localStorage.setItem(roomKey(fingerprint), JSON.stringify(msgs));
  } catch {
    // non-fatal
  }
}
