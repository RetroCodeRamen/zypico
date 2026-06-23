import { useEffect, useRef, useState } from "react";
import { open, seal, type Identity } from "@core/identity/index.ts";
import {
  compareHlc, decodeHlc, encodeHlc, HybridLogicalClock, SubType,
} from "@core/protocol/index.ts";
import {
  decodeDM, decodePresence, decodeRoomMsg, encodeDM, encodePresence, encodeRoomMsg, MAIN_ROOM, type Presence,
} from "@core/protocol/social.ts";
import { type Buddy, loadBuddies, saveBuddies, upsertBuddy } from "@app/storage/buddies.ts";
import {
  type DmThreads, type RoomLine,
  loadDmThreads, loadRoom, saveDmThreads, saveRoom,
} from "@app/storage/messages.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sfx } from "@ui/sound.ts";
import type { InboundDecoded } from "@app/RelayClient.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

const roomKey = (line: RoomLine) => `${line.senderFp}:${line.ts.wallMs}.${line.ts.counter}`;

// The social layer: presence (who's around), buddies, encrypted DMs, and the
// HLC-ordered main chatroom. Reads/sends through the Relay link; persists
// buddies per-identity. The inbound handler is bound once and reads current
// state through refs, so it never goes stale.
export function useSocial(identity: Identity | null, link: Relay) {
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [nearby, setNearby] = useState<Presence[]>([]);
  const [dmThreads, setDmThreads] = useState<DmThreads>({});
  const [roomMsgs, setRoomMsgs] = useState<RoomLine[]>([]);
  const hlcRef = useRef(new HybridLogicalClock());
  const seenRoomRef = useRef(new Set<string>()); // app-level dedupe of room messages

  // Refs so the inbound handler (bound once) reads current values.
  const identityRef = useRef<Identity | null>(null);
  const buddiesRef = useRef<Buddy[]>(buddies);
  const nearbyRef = useRef<Presence[]>(nearby);
  identityRef.current = identity;
  buddiesRef.current = buddies;
  nearbyRef.current = nearby;

  useEffect(() => {
    if (identity) saveBuddies(identity.fingerprint, buddies);
  }, [buddies, identity]);
  useEffect(() => {
    if (identity) saveDmThreads(identity.fingerprint, dmThreads);
  }, [dmThreads, identity]);
  useEffect(() => {
    if (identity) saveRoom(identity.fingerprint, roomMsgs);
  }, [roomMsgs, identity]);

  const resolvePubkey = (fp: string): Uint8Array | undefined => {
    const b = buddiesRef.current.find((x) => x.fingerprint === fp);
    if (b) return hexToBytes(b.pubkey);
    return nearbyRef.current.find((x) => x.fingerprint === fp)?.publicKey;
  };

  // Insert a room message (app-deduped, HLC-ordered).
  const ingestRoom = (line: RoomLine) => {
    const key = roomKey(line);
    if (seenRoomRef.current.has(key)) return;
    seenRoomRef.current.add(key);
    setRoomMsgs((prev) => [...prev, line].sort((a, b) => compareHlc(a.ts, b.ts)).slice(-60));
  };

  const handleInbound = (f: InboundDecoded) => {
    const me = identityRef.current;
    if (!me) return;
    if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (!p || p.fingerprint === me.fingerprint) return; // ignore self / forged
      setNearby((prev) => [...prev.filter((x) => x.fingerprint !== p.fingerprint), p].slice(-30));
    } else if (f.subtype === SubType.IM) {
      const env = decodeDM(f.payload);
      if (!env || env.recipientFp !== me.fingerprint) return; // not addressed to us
      const senderPub = resolvePubkey(env.senderFp);
      if (!senderPub) return; // unknown sender — can't decrypt
      const opened = open(me.secretKey, senderPub, env.sealed);
      if (!opened) return;
      const text = new TextDecoder().decode(opened);
      setDmThreads((t) => ({ ...t, [env.senderFp]: [...(t[env.senderFp] ?? []), { out: false, text }] }));
      sfx("feed"); // soft chirp on an incoming DM
    } else if (f.subtype === SubType.POST) {
      const m = decodeRoomMsg(f.payload);
      if (!m || m.roomId !== MAIN_ROOM || m.senderFp === me.fingerprint) return;
      const ts = decodeHlc(m.hlc);
      hlcRef.current.recv(ts); // keep our clock ahead of what we hear
      ingestRoom({ ts, senderFp: m.senderFp, handle: m.handle, text: m.text, mine: false });
    }
  };

  // Bind the inbound handler once; it reads current state through refs.
  useEffect(() => {
    link.setInbound(handleInbound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const broadcastPresence = () => {
    const me = identityRef.current;
    if (me && link.isConnected()) link.send(SubType.PRESENCE, encodePresence(me));
  };

  // Announce presence on connect and periodically, so others discover us.
  useEffect(() => {
    if (!identity || !link.view.online) return;
    broadcastPresence();
    const iv = setInterval(broadcastPresence, 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, link.view.online]);

  const addBuddy = (p: Presence) => {
    setBuddies((prev) => upsertBuddy(prev, {
      handle: p.handle,
      fingerprint: p.fingerprint,
      pubkey: bytesToHex(p.publicKey),
      addedAt: Date.now(),
    }));
    sfx("accept");
  };

  const sendRoom = (text: string) => {
    const me = identityRef.current;
    const t = text.trim();
    if (!t || !me) return;
    if (link.isConnected()) {
      const ts = hlcRef.current.send();
      link.send(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(ts), me.fingerprint, me.handle, t));
      ingestRoom({ ts, senderFp: me.fingerprint, handle: me.handle, text: t, mine: true });
      sfx("accept");
    } else {
      sfx("error");
    }
  };

  const sendDM = (buddy: Buddy, text: string) => {
    const me = identityRef.current;
    const t = text.trim();
    if (!t || !me) return;
    if (link.isConnected()) {
      const sealed = seal(me.secretKey, hexToBytes(buddy.pubkey), new TextEncoder().encode(t));
      link.send(SubType.IM, encodeDM(buddy.fingerprint, me.fingerprint, sealed));
      setDmThreads((d) => ({ ...d, [buddy.fingerprint]: [...(d[buddy.fingerprint] ?? []), { out: true, text: t }] }));
      sfx("accept");
    } else {
      sfx("error");
    }
  };

  // Restore the traveler's stored social state at login: buddies, DM threads,
  // and the cached chatroom. Seed the room dedupe set from what we restore, and
  // advance the clock past restored history so new sends sort after it.
  const load = (fingerprint: string) => {
    setBuddies(loadBuddies(fingerprint));
    setDmThreads(loadDmThreads(fingerprint));
    const room = loadRoom(fingerprint);
    seenRoomRef.current = new Set(room.map(roomKey));
    for (const line of room) hlcRef.current.recv(line.ts);
    setRoomMsgs(room);
  };

  return { buddies, nearby, dmThreads, roomMsgs, addBuddy, sendRoom, sendDM, load };
}
