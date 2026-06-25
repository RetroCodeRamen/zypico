import { useEffect, useRef, useState } from "react";
import { open, seal, type Identity } from "@core/identity/index.ts";
import type { Heart } from "@core/companion/index.ts";
import {
  compareHlc, decodeHlc, encodeHlc, HybridLogicalClock, SubType,
} from "@core/protocol/index.ts";
import {
  decodeDM, decodePresence, decodeRoomMsg, encodeCommonsReq, encodeDM, encodePresence, encodeRoomMsg, MAIN_ROOM, type Presence,
} from "@core/protocol/social.ts";
import { decodeStationBeacon, SERVICE, type StationBeacon } from "@core/protocol/index.ts";
import { type Buddy, loadBuddies, saveBuddies, upsertBuddy } from "@app/storage/buddies.ts";
import {
  type DmThreads, type RoomLine,
  loadDmThreads, loadRoom, saveDmThreads, saveRoom,
} from "@app/storage/messages.ts";
import {
  type Discovery, addDiscovery, loadDiscoveries, saveDiscoveries,
} from "@app/storage/discoveries.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sfx } from "@ui/sound.ts";
import type { InboundDecoded } from "@app/RelayClient.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

const roomKey = (line: RoomLine) => `${line.senderFp}:${line.ts.wallMs}.${line.ts.counter}`;

// Commons history (DESIGN §4.4): a town square, not a forum. ~10 recent messages
// without a Station; a COMMONS-capable Station deepens it to ~50.
const COMMONS_HISTORY = 10;
const COMMONS_HISTORY_STATION = 50;
const STATION_WINDOW_MS = 300_000;

const PRESENCE_INTERVAL = 60_000; // DESIGN §4.1 — beacon every 60 s

/** What a presence beacon should advertise right now (Wisp form + location). */
export interface PresenceMeta { formIndex: number; placeId: number }

/** A heard Traveler: their beacon plus how/when we heard it. */
export interface NearbyTraveler extends Presence {
  /** Epoch ms we last heard them (for the 5-min reachability window). */
  lastSeen: number;
  /** Hops travelled: 0 = Nearby (direct radio), ≥1 = across the Relay. */
  hops: number;
}

/** A heard Station: its beacon plus how/when we heard it. */
export interface KnownStation extends StationBeacon {
  lastSeen: number;
  hops: number;
}

// The social layer: presence (who's around), buddies, encrypted DMs, and the
// HLC-ordered main chatroom. Reads/sends through the Relay link; persists
// buddies per-identity. The inbound handler is bound once and reads current
// state through refs, so it never goes stale.
export function useSocial(
  identity: Identity | null,
  link: Relay,
  onActivity: (heart: Heart, amount: number) => void,
  presenceMeta: () => PresenceMeta,
) {
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [nearby, setNearby] = useState<NearbyTraveler[]>([]);
  const [stations, setStations] = useState<KnownStation[]>([]);
  const [dmThreads, setDmThreads] = useState<DmThreads>({});
  const [roomMsgs, setRoomMsgs] = useState<RoomLine[]>([]);
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]); // the Wisp's journal
  const hlcRef = useRef(new HybridLogicalClock());
  const seenRoomRef = useRef(new Set<string>()); // app-level dedupe of room messages

  // Refs so the inbound handler (bound once) reads current values.
  const identityRef = useRef<Identity | null>(null);
  const buddiesRef = useRef<Buddy[]>(buddies);
  const nearbyRef = useRef<NearbyTraveler[]>(nearby);
  const stationsRef = useRef<KnownStation[]>(stations);
  const metaRef = useRef(presenceMeta);
  identityRef.current = identity;
  buddiesRef.current = buddies;
  nearbyRef.current = nearby;
  stationsRef.current = stations;
  metaRef.current = presenceMeta;

  useEffect(() => {
    if (identity) saveBuddies(identity.fingerprint, buddies);
  }, [buddies, identity]);
  useEffect(() => {
    if (identity) saveDmThreads(identity.fingerprint, dmThreads);
  }, [dmThreads, identity]);
  useEffect(() => {
    if (identity) saveRoom(identity.fingerprint, roomMsgs);
  }, [roomMsgs, identity]);
  useEffect(() => {
    if (identity) saveDiscoveries(identity.fingerprint, discoveries);
  }, [discoveries, identity]);

  const resolvePubkey = (fp: string): Uint8Array | undefined => {
    const b = buddiesRef.current.find((x) => x.fingerprint === fp);
    if (b) return hexToBytes(b.pubkey);
    return nearbyRef.current.find((x) => x.fingerprint === fp)?.publicKey;
  };

  // Insert a room message (app-deduped, HLC-ordered). A nearby COMMONS Station
  // deepens how much history we keep.
  const ingestRoom = (line: RoomLine) => {
    const key = roomKey(line);
    if (seenRoomRef.current.has(key)) return;
    seenRoomRef.current.add(key);
    const now = Date.now();
    const hasStation = stationsRef.current.some((s) => (s.services & SERVICE.COMMONS) && now - s.lastSeen < STATION_WINDOW_MS);
    const cap = hasStation ? COMMONS_HISTORY_STATION : COMMONS_HISTORY;
    setRoomMsgs((prev) => [...prev, line].sort((a, b) => compareHlc(a.ts, b.ts)).slice(-cap));
  };

  const handleInbound = (f: InboundDecoded) => {
    const me = identityRef.current;
    if (!me) return;
    if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (!p || p.fingerprint === me.fingerprint) return; // ignore self / forged
      const isNew = !nearbyRef.current.some((x) => x.fingerprint === p.fingerprint);
      const entry: NearbyTraveler = { ...p, lastSeen: Date.now(), hops: f.hops };
      setNearby((prev) => [...prev.filter((x) => x.fingerprint !== p.fingerprint), entry].slice(-30));
      if (isNew) {
        onActivity("journey", 2); // discovering the world grows Journey
        // The Wisp notices the passing Traveler and remembers it (DESIGN §2).
        setDiscoveries((prev) => addDiscovery(prev, { kind: "traveler", name: p.handle, at: Date.now() }));
        echoPresence(); // wave back so they discover us too (mutual discovery)
      }
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
    } else if (f.subtype === SubType.STATION) {
      const s = decodeStationBeacon(f.payload);
      if (!s) return;
      const isNew = !stationsRef.current.some((x) => x.fingerprint === s.fingerprint);
      const entry: KnownStation = { ...s, lastSeen: Date.now(), hops: f.hops };
      setStations((prev) => [...prev.filter((x) => x.fingerprint !== s.fingerprint), entry].slice(-10));
      // The Wisp hears about Stations too (DESIGN §2 "lives its life").
      if (isNew) setDiscoveries((prev) => addDiscovery(prev, { kind: "station", name: s.name, at: Date.now() }));
    }
  };

  // Subscribe the inbound handler once; it reads current state through refs.
  useEffect(() => link.onInbound(handleInbound), []); // eslint-disable-line react-hooks/exhaustive-deps

  const broadcastPresence = () => {
    const me = identityRef.current;
    if (me && link.isConnected()) {
      const meta = metaRef.current();
      link.send(SubType.PRESENCE, encodePresence(me, meta.formIndex, meta.placeId));
    }
  };

  // Mutual discovery: a presence beacon is one-shot, so the first traveler online
  // beacons before anyone is listening and stays invisible until the next 60 s
  // tick — the "whoever signs in last can talk" bug. When we hear someone NEW we
  // echo our own presence (jittered so beacons don't collide, debounced so a room
  // full of arrivals can't trigger a storm), closing discovery to one round-trip.
  const lastEchoRef = useRef(0);
  const echoPresence = () => {
    const now = Date.now();
    if (now - lastEchoRef.current < 3000) return; // at most one echo per few seconds
    lastEchoRef.current = now;
    setTimeout(broadcastPresence, 100 + Math.floor(Math.random() * 500));
  };

  // Announce presence on connect and periodically, so others discover us.
  useEffect(() => {
    if (!identity || !link.view.online) return;
    broadcastPresence();
    const iv = setInterval(broadcastPresence, PRESENCE_INTERVAL);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, link.view.online]);

  // Ask each COMMONS-capable Station to backfill recent history, once on discovery
  // — so the town square isn't empty when you arrive (DESIGN §4.4).
  const backfilledRef = useRef(new Set<string>());
  const commonsStationKey = stations.filter((s) => s.services & SERVICE.COMMONS).map((s) => s.fingerprint).sort().join(",");
  useEffect(() => {
    if (!identity) return;
    for (const s of stations) {
      if ((s.services & SERVICE.COMMONS) && !backfilledRef.current.has(s.fingerprint)) {
        backfilledRef.current.add(s.fingerprint);
        link.send(SubType.COMMONS_REQ, encodeCommonsReq(MAIN_ROOM));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commonsStationKey, identity]);

  const addBuddy = (p: Presence) => {
    setBuddies((prev) => upsertBuddy(prev, {
      handle: p.handle,
      fingerprint: p.fingerprint,
      pubkey: bytesToHex(p.publicKey),
      addedAt: Date.now(),
    }));
    onActivity("signal", 6); // friends grow Signal
    onActivity("journey", 2); // …and meeting them, Journey
    sfx("accept");
  };

  const sendRoom = (text: string) => {
    const me = identityRef.current;
    const t = text.trim();
    if (!t || !me) return;
    if (link.isConnected()) {
      const ts = hlcRef.current.send();
      // Resend a couple times: a single unacked broadcast frame is sometimes
      // lost, and the receiver dedupes so no duplicate appears (proven flaky→ok
      // in the comms-deep harness). Same below for DMs.
      link.send(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(ts), me.fingerprint, me.handle, t), 2);
      ingestRoom({ ts, senderFp: me.fingerprint, handle: me.handle, text: t, mine: true });
      onActivity("broadcast", 4); // posting in the Commons grows Broadcast
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
      link.send(SubType.IM, encodeDM(buddy.fingerprint, me.fingerprint, sealed), 2); // redundant for reliability
      setDmThreads((d) => ({ ...d, [buddy.fingerprint]: [...(d[buddy.fingerprint] ?? []), { out: true, text: t }] }));
      onActivity("signal", 3); // private messages grow Signal
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
    setDiscoveries(loadDiscoveries(fingerprint));
    const room = loadRoom(fingerprint);
    seenRoomRef.current = new Set(room.map(roomKey));
    for (const line of room) hlcRef.current.recv(line.ts);
    setRoomMsgs(room);
  };

  return { buddies, nearby, stations, dmThreads, roomMsgs, discoveries, resolvePubkey, addBuddy, sendRoom, sendDM, load };
}
