import { useEffect, useRef, useState } from "react";
import { open, seal, type Identity } from "@core/identity/index.ts";
import { decodeMail, encodeMail, SubType } from "@core/protocol/index.ts";
import {
  type InboxMail, type OutboxMail,
  addInbox, loadInbox, loadOutbox, saveInbox, saveOutbox,
} from "@app/storage/mail.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

// The Post office (DESIGN §4.4). Mail is composed any time and queued in the
// outbox; we deliver it when the recipient is reachable (peer-to-peer now, via
// Station store-and-forward in M7). Inbound mail is sealed E2E and persists.
// `resolvePubkey` (from the social layer) maps a fingerprint → public key for
// sealing/opening; `reachableFps` drives retry when a recipient comes in range.
export function usePostOffice(
  identity: Identity | null,
  link: Relay,
  resolvePubkey: (fp: string) => Uint8Array | undefined,
  reachableFps: string[],
) {
  const [inbox, setInbox] = useState<InboxMail[]>([]);
  const [outbox, setOutbox] = useState<OutboxMail[]>([]);
  const identityRef = useRef<Identity | null>(identity);
  const resolveRef = useRef(resolvePubkey);
  identityRef.current = identity;
  resolveRef.current = resolvePubkey;

  useEffect(() => { if (identity) saveInbox(identity.fingerprint, inbox); }, [inbox, identity]);
  useEffect(() => { if (identity) saveOutbox(identity.fingerprint, outbox); }, [outbox, identity]);

  // Put one queued mail on the air (re-sealed; the recipient dedupes by mailId).
  const deliver = (m: OutboxMail): boolean => {
    const me = identityRef.current;
    const pub = resolveRef.current(m.toFp);
    if (!me || !pub || !link.isConnected()) return false;
    link.send(SubType.MAIL, encodeMail(m.toFp, me.fingerprint, m.id, me.handle, seal(me.secretKey, pub, utf8(m.text))));
    return true;
  };

  // Receive mail addressed to us, sealed E2E.
  useEffect(() => link.onInbound((f) => {
    if (f.subtype !== SubType.MAIL) return;
    const me = identityRef.current;
    if (!me) return;
    const env = decodeMail(f.payload);
    if (!env || env.recipientFp !== me.fingerprint) return;
    const pub = resolveRef.current(env.senderFp);
    if (!pub) return; // unknown sender — can't open
    const opened = open(me.secretKey, pub, env.sealed);
    if (!opened) return;
    setInbox((list) => addInbox(list, {
      id: env.mailId, fromFp: env.senderFp, handle: env.senderHandle,
      text: fromUtf8(opened), at: Date.now(), read: false,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Retry undelivered outbox mail whenever recipients come into range.
  const reachKey = [...reachableFps].sort().join(",");
  useEffect(() => {
    if (!identity) return;
    const reach = new Set(reachableFps);
    setOutbox((list) => {
      let changed = false;
      const next = list.map((m) => {
        if (!m.delivered && reach.has(m.toFp) && deliver(m)) { changed = true; return { ...m, delivered: true }; }
        return m;
      });
      return changed ? next : list;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachKey, identity]);

  /** Compose + queue a mail; sends immediately if the recipient is reachable. */
  const compose = (toFp: string, toHandle: string, text: string) => {
    const me = identityRef.current;
    const t = text.trim();
    if (!me || !t) return;
    const item: OutboxMail = { id: (Math.random() * 0xffff_ffff) >>> 0, toFp, handle: toHandle, text: t, at: Date.now(), delivered: false };
    const sent = reachableFps.includes(toFp) && deliver(item);
    setOutbox((list) => [...list, { ...item, delivered: sent }]);
  };

  const markRead = (id: number) => setInbox((list) => list.map((m) => (m.id === id ? { ...m, read: true } : m)));
  const load = (fp: string) => { setInbox(loadInbox(fp)); setOutbox(loadOutbox(fp)); };
  const unread = inbox.reduce((n, m) => n + (m.read ? 0 : 1), 0);

  return { inbox, outbox, compose, markRead, load, unread };
}
