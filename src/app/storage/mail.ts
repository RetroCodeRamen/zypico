// Mail storage — the inbox (received) and outbox (queued to send), per identity.
// Mail persists across reloads (unlike live Chat). Stored behind these functions
// like the rest of local state; Stations back this up later (M7 vaults).

export interface InboxMail {
  /** Mail-layer id (dedupe key). */
  id: number;
  fromFp: string;
  handle: string;
  text: string;
  at: number;
  read: boolean;
}

export interface OutboxMail {
  id: number;
  toFp: string;
  handle: string;
  text: string;
  at: number;
  /** Best-effort: set once sent while the recipient was reachable. */
  delivered: boolean;
}

const CAP = 50;
const inboxKey = (fp: string) => `zypico.inbox.${fp}`;
const outboxKey = (fp: string) => `zypico.outbox.${fp}`;

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw) as T[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function save<T>(key: string, list: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* non-fatal */ }
}

export const loadInbox = (fp: string): InboxMail[] => load<InboxMail>(inboxKey(fp));
export const saveInbox = (fp: string, list: InboxMail[]): void => save(inboxKey(fp), list);
export const loadOutbox = (fp: string): OutboxMail[] => load<OutboxMail>(outboxKey(fp));
export const saveOutbox = (fp: string, list: OutboxMail[]): void => save(outboxKey(fp), list);

/** Append a received mail, ignoring a re-delivery of one we already have. */
export function addInbox(list: InboxMail[], m: InboxMail): InboxMail[] {
  if (list.some((x) => x.id === m.id && x.fromFp === m.fromFp)) return list;
  return [...list, m].slice(-CAP);
}
