import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Screen } from "@ui/shell/Screen.tsx";
import { PixelScreen } from "@ui/pixel/PixelScreen.tsx";
import { Buttons, type ButtonAction } from "@ui/shell/Buttons.tsx";
import { Keyboard } from "@ui/shell/Keyboard.tsx";
import { currentPlace, INITIAL_NAV, navReduce } from "@ui/shell/nav.ts";
import { drawLogin } from "@ui/scenes/render.ts";
import type { EditView, LoginView, RelayView, WispView } from "@ui/scenes/render.ts";
import { BoardTransport } from "@transport/index.ts";
import type { MeshTransport, TransportStatus } from "@transport/index.ts";
import { RelayClient, type InboundDecoded } from "@app/RelayClient.ts";
import { applyActivity, createWisp, HEARTS, renameWisp, wispForm } from "@core/companion/index.ts";
import { deriveIdentity, open, seal, type Identity } from "@core/identity/index.ts";
import {
  compareHlc, decodeHlc, encodeHlc, HybridLogicalClock, SubType, type HlcTimestamp,
} from "@core/protocol/index.ts";
import {
  decodeDM, decodePresence, decodeRoomMsg, encodeDM, encodePresence, encodeRoomMsg, MAIN_ROOM, type Presence,
} from "@core/protocol/social.ts";
import { loadWisp, saveWisp } from "@app/storage/wisp.ts";
import { clearStoredIdentity, loadStoredIdentity, saveStoredIdentity } from "@app/storage/identity.ts";
import { type Buddy, loadBuddies, saveBuddies, upsertBuddy } from "@app/storage/buddies.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { setMuted, sfx } from "@ui/sound.ts";

const MUTE_KEY = "zypico.muted";

// Points granted per local "raise" action. This is a TEST-ONLY affordance,
// gated to dev builds (CAN_RAISE) — hearts are meant to be earned through
// participation, never picked at will (outline §3.2/§14). Real features
// (messaging→Signal, games→Arena, …) will call applyActivity the same way, and
// this manual action goes away.
const FEED_AMOUNT = 8;
const CAN_RAISE = import.meta.env.DEV;

const STATUS_LABEL: Record<TransportStatus, string> = {
  disconnected: "OFFLINE",
  connecting: "CONNECTING...",
  connected: "ON RELAY",
  error: "LINK ERROR",
};

interface Editing extends EditView {
  onSubmit: (value: string) => void;
}

// The interface is the Tamagotchi shell: a screen unit (icons + 128×80 matrix)
// driven by three buttons, with an HTML keyboard below for text entry. App is
// the controller — it owns navigation, the text-entry mode, and the (optional)
// Relay link. All content renders inside the matrix (see scenes/render.ts).
export function App() {
  const [nav, navDispatch] = useReducer(navReduce, INITIAL_NAV);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [relay, setRelay] = useState<RelayView>({ statusLabel: "OFFLINE", online: false });
  const clientRef = useRef<RelayClient | undefined>(undefined);
  const viaRef = useRef<string | undefined>(undefined); // how we're linked (for STATUS)

  // The companion (local-first; per-identity). Loaded on login.
  const [wisp, setWisp] = useState(() => createWisp());
  const [wispView, setWispView] = useState<WispView | null>(null);

  // Identity gate — nothing is shown until the traveler logs in (outline §13.6).
  const storedRef = useRef(loadStoredIdentity());
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [login, setLogin] = useState<LoginView>(() => {
    const s = storedRef.current;
    return {
      mode: s ? "login" : "create",
      handle: s?.handle ?? "",
      password: "",
      field: s ? "password" : "handle",
      busy: false,
    };
  });
  useEffect(() => {
    if (identity) saveWisp(identity.fingerprint, wisp);
  }, [wisp, identity]);

  // ---- Social: buddies, nearby (heard via presence), and DM threads ----
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [nearby, setNearby] = useState<Presence[]>([]);
  const [friendsCursor, setFriendsCursor] = useState(0);
  const [friendsThread, setFriendsThread] = useState<string | null>(null); // buddy fingerprint
  const [dmThreads, setDmThreads] = useState<Record<string, { out: boolean; text: string }[]>>({});
  // Main chatroom (public, HLC-ordered). In-memory this session; persistence later.
  interface RoomLine { ts: HlcTimestamp; senderFp: string; handle: string; text: string; mine: boolean }
  const [roomMsgs, setRoomMsgs] = useState<RoomLine[]>([]);
  const hlcRef = useRef(new HybridLogicalClock());
  const seenRoomRef = useRef(new Set<string>()); // app-level dedupe of room messages
  // Refs so the inbound handler (bound once at connect) reads current values.
  const identityRef = useRef<Identity | null>(null);
  const buddiesRef = useRef<Buddy[]>(buddies);
  const nearbyRef = useRef<Presence[]>(nearby);
  identityRef.current = identity;
  buddiesRef.current = buddies;
  nearbyRef.current = nearby;
  useEffect(() => {
    if (identity) saveBuddies(identity.fingerprint, buddies);
  }, [buddies, identity]);

  // Sound on/off (persisted), kept in sync with the sound module.
  const [muted, setMutedState] = useState(() => localStorage.getItem(MUTE_KEY) === "1");
  useEffect(() => {
    setMuted(muted);
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  }, [muted]);

  // Scale-to-fit: the gadget is laid out at its true design size, then scaled by
  // one uniform factor to fit the viewport — preserving the aspect ratio exactly
  // (no stretching), fitting both phone and desktop.
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const fit = () => {
      const stage = stageRef.current;
      const device = deviceRef.current;
      if (!stage || !device) return;
      // offsetWidth/Height report the pre-transform layout size, so measuring
      // while scaled is safe and doesn't feed back.
      const natW = device.offsetWidth;
      const natH = device.offsetHeight;
      if (natW === 0 || natH === 0) return;
      const s = Math.min(stage.clientWidth / natW, stage.clientHeight / natH);
      setScale(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    if (deviceRef.current) ro.observe(deviceRef.current);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // ---- Text entry (HTML keyboard → active LCD field) ----
  const editType = (ch: string) => {
    sfx("type");
    setEditing((e) => (e ? { ...e, value: e.value + ch } : e));
  };
  const editBackspace = () => {
    sfx("type");
    setEditing((e) => (e ? { ...e, value: e.value.slice(0, -1) } : e));
  };
  const editSubmit = () => {
    setEditing((e) => {
      if (e) e.onSubmit(e.value.trim());
      return null;
    });
  };
  const editCancel = () => setEditing(null);

  // ---- Relay link (optional; the device is fully usable offline) ----
  const refreshRelay = (client: RelayClient, status: TransportStatus) => {
    const node = client.selfNodeNum;
    setRelay({
      statusLabel: STATUS_LABEL[status],
      online: status === "connected",
      ...(viaRef.current ? { via: viaRef.current } : {}),
      ...(node !== undefined ? { nodeLabel: `NODE !${node.toString(16)}` } : {}),
    });
  };

  // Start a link over a chosen transport. `via` labels how we're connected.
  // `quiet` suppresses the connect/error chirps for the silent auto-connect.
  const startLink = async (transport: MeshTransport, via: string, quiet = false) => {
    viaRef.current = via;
    const client = new RelayClient(transport);
    clientRef.current = client;
    client.onStatus((s) => refreshRelay(client, s));
    client.onInbound((f) => handleSocialInbound(f));
    setRelay({ statusLabel: "CONNECTING...", online: false, via });
    try {
      await client.connect();
      refreshRelay(client, "connected");
      if (!quiet) sfx("connect");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[ZyPico] link failed:", err);
      setRelay({ statusLabel: "LINK ERROR", online: false, via, detail });
      if (!quiet) sfx("error");
    }
  };

  // The board serves this page, so the WebSocket link is always-on: auto-connect
  // (quietly) and only expose reconnect/disconnect for control.
  const connectBoard = (quiet = false) => startLink(new BoardTransport(), "WIFI BOARD", quiet);

  const disconnect = async () => {
    await clientRef.current?.disconnect();
    clientRef.current = undefined;
    viaRef.current = undefined;
    setRelay({ statusLabel: "OFFLINE", online: false });
  };

  // ---- Social: presence, discovery, and encrypted DMs ----
  const resolvePubkey = (fp: string): Uint8Array | undefined => {
    const b = buddiesRef.current.find((x) => x.fingerprint === fp);
    if (b) return hexToBytes(b.pubkey);
    return nearbyRef.current.find((x) => x.fingerprint === fp)?.publicKey;
  };

  const handleSocialInbound = (f: InboundDecoded) => {
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

  const broadcastPresence = () => {
    const me = identityRef.current;
    if (me && clientRef.current?.status === "connected") {
      clientRef.current.send(SubType.PRESENCE, encodePresence(me));
    }
  };

  const addBuddy = (p: Presence) => {
    setBuddies((prev) => upsertBuddy(prev, {
      handle: p.handle,
      fingerprint: p.fingerprint,
      pubkey: bytesToHex(p.publicKey),
      addedAt: Date.now(),
    }));
    sfx("accept");
  };

  // Insert a room message (app-deduped, HLC-ordered).
  const ingestRoom = (line: RoomLine) => {
    const key = `${line.senderFp}:${line.ts.wallMs}.${line.ts.counter}`;
    if (seenRoomRef.current.has(key)) return;
    seenRoomRef.current.add(key);
    setRoomMsgs((prev) => [...prev, line].sort((a, b) => compareHlc(a.ts, b.ts)).slice(-60));
  };

  const sendRoom = (text: string) => {
    const me = identityRef.current;
    const t = text.trim();
    if (!t || !me) return;
    if (clientRef.current?.status === "connected") {
      const ts = hlcRef.current.send();
      clientRef.current.send(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(ts), me.fingerprint, me.handle, t));
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
    if (clientRef.current?.status === "connected") {
      const sealed = seal(me.secretKey, hexToBytes(buddy.pubkey), new TextEncoder().encode(t));
      clientRef.current.send(SubType.IM, encodeDM(buddy.fingerprint, me.fingerprint, sealed));
      setDmThreads((d) => ({ ...d, [buddy.fingerprint]: [...(d[buddy.fingerprint] ?? []), { out: true, text: t }] }));
      sfx("accept");
    } else {
      sfx("error");
    }
  };

  // ---- Login gate (handle + password → identity; before anything else) ----
  const loginType = (ch: string) => {
    sfx("type");
    setLogin((l) => ({ ...l, [l.field]: l[l.field] + ch, error: undefined }));
  };
  const loginBackspace = () => {
    sfx("type");
    setLogin((l) => ({ ...l, [l.field]: l[l.field].slice(0, -1) }));
  };
  const submitLogin = async () => {
    const handle = login.handle.trim();
    const password = login.password;
    if (!handle || !password) {
      setLogin((l) => ({ ...l, error: "ENTER HANDLE + PASSWORD" }));
      sfx("error");
      return;
    }
    setLogin((l) => ({ ...l, busy: true, error: undefined }));
    try {
      const id = await deriveIdentity(handle, password);
      const s = storedRef.current;
      if (s && s.fingerprint !== id.fingerprint) {
        setLogin((l) => ({ ...l, busy: false, password: "", error: "WRONG PASSWORD" }));
        sfx("error");
        return;
      }
      saveStoredIdentity({ handle: id.handle, fingerprint: id.fingerprint });
      storedRef.current = { handle: id.handle, fingerprint: id.fingerprint };
      identityRef.current = id;
      setWisp(loadWisp(id.fingerprint));
      setBuddies(loadBuddies(id.fingerprint));
      setIdentity(id);
      setLogin((l) => ({ ...l, busy: false, password: "" }));
      sfx("connect");
      void connectBoard(true); // always-on link to the board, no manual step

    } catch {
      setLogin((l) => ({ ...l, busy: false, error: "LOGIN FAILED" }));
      sfx("error");
    }
  };
  const handleLoginButton = (action: ButtonAction) => {
    if (login.busy) return;
    if (action === "select") {
      sfx("select");
      if (login.mode === "create") {
        setLogin((l) => ({ ...l, field: l.field === "handle" ? "password" : "handle" }));
      }
    } else if (action === "accept") {
      void submitLogin();
    } else if (action === "cancel") {
      sfx("cancel");
      if (login.mode === "login") {
        // Switch traveler: forget the stored identity and create a new one.
        clearStoredIdentity();
        storedRef.current = null;
        setLogin({ mode: "create", handle: "", password: "", field: "handle", busy: false });
      } else {
        setLogin((l) => ({ ...l, [l.field]: "" }));
      }
    }
  };

  // FRIENDS: buddies (added) listed first, then nearby (heard, not yet added).
  const friendList: { kind: "buddy" | "nearby"; handle: string; fingerprint: string }[] = [
    ...buddies.map((b) => ({ kind: "buddy" as const, handle: b.petname ?? b.handle, fingerprint: b.fingerprint })),
    ...nearby
      .filter((n) => !buddies.some((b) => b.fingerprint === n.fingerprint))
      .map((n) => ({ kind: "nearby" as const, handle: n.handle, fingerprint: n.fingerprint })),
  ];
  const inFriends = identity != null && nav.level === "place" && currentPlace(nav).id === "friends";

  // Reset the FRIENDS cursor/thread whenever we enter that place.
  useEffect(() => {
    if (inFriends) {
      setFriendsCursor(0);
      setFriendsThread(null);
    }
  }, [inFriends]);

  // Announce presence on connect and periodically, so others discover us.
  useEffect(() => {
    if (!identity || !relay.online) return;
    broadcastPresence();
    const iv = setInterval(broadcastPresence, 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, relay.online]);

  // ---- Button controller (shared by on-screen buttons + arrow keys) ----
  const handleButton = (action: ButtonAction) => {
    if (!identity) {
      handleLoginButton(action);
      return;
    }
    // Base button feedback; specific outcomes may add their own sound below.
    if (action === "select") sfx("select");
    else if (action === "cancel") sfx("cancel");

    if (editing) {
      if (action === "accept") { sfx("accept"); editSubmit(); }
      else if (action === "cancel") editCancel();
      return; // SELECT is inert while editing
    }

    // MY WISP detail: (dev) raise hearts / name / reset / back out.
    if (wispView) {
      // Selectable actions: 5 hearts (dev only), then NAME, then RESET (dev only).
      const actionCount = CAN_RAISE ? HEARTS.length + 2 : 1;
      const nameIndex = CAN_RAISE ? HEARTS.length : 0;
      const resetIndex = CAN_RAISE ? HEARTS.length + 1 : -1;
      if (action === "select") {
        setWispView({ cursor: (wispView.cursor + 1) % actionCount });
      } else if (action === "accept") {
        if (wispView.cursor === nameIndex) {
          sfx("accept");
          setEditing({
            label: "NAME YOUR WISP",
            value: wisp.name,
            onSubmit: (v) => setWisp((w) => renameWisp(w, v.slice(0, 12))),
          });
        } else if (wispView.cursor === resetIndex) {
          sfx("cancel");
          setWisp(createWisp()); // TEST ONLY: start a fresh Flicker
        } else if (CAN_RAISE) {
          // TEST ONLY: raise the chosen heart. Real growth comes from activity.
          const heart = HEARTS[wispView.cursor];
          const next = applyActivity(wisp, heart, FEED_AMOUNT);
          sfx(wispForm(next).id !== wispForm(wisp).id ? "evolve" : "feed");
          setWisp(next);
        }
      } else if (action === "cancel") {
        setWispView(null);
      }
      return;
    }

    // FRIENDS place: buddy list (add nearby / open DM) and DM threads.
    if (inFriends) {
      if (friendsThread) {
        const buddy = buddies.find((b) => b.fingerprint === friendsThread);
        if (action === "accept" && buddy) {
          setEditing({ label: `DM ${buddy.petname ?? buddy.handle}`.slice(0, 18), value: "", onSubmit: (v) => sendDM(buddy, v) });
        } else if (action === "cancel") {
          setFriendsThread(null);
        }
        return;
      }
      if (action === "select") {
        setFriendsCursor((c) => (friendList.length ? (c + 1) % friendList.length : 0));
      } else if (action === "accept") {
        const it = friendList[friendsCursor];
        if (it && it.kind === "nearby") {
          const p = nearby.find((n) => n.fingerprint === it.fingerprint);
          if (p) addBuddy(p);
        } else if (it) {
          sfx("accept");
          setFriendsThread(it.fingerprint);
        }
      } else if (action === "cancel") {
        navDispatch("cancel");
      }
      return;
    }

    if (action === "accept" && nav.level === "place") {
      const place = currentPlace(nav);
      const item = place.items[nav.itemIndex];
      if (place.id === "radio") {
        if (item === "RECONNECT") {
          sfx("accept");
          void connectBoard(); // manual retry if the always-on link dropped
          return;
        }
        if (item === "DISCONNECT") {
          void disconnect();
          return;
        }
        // STATUS just shows the link report (handled by selection rendering).
      }
      if (place.id === "bcast") {
        sfx("accept");
        setEditing({ label: "MAIN ROOM", value: "", onSubmit: (v) => sendRoom(v) });
        return;
      }
      if (place.id === "profile") {
        if (item === "MY WISP") {
          sfx("accept");
          setWispView({ cursor: 0 });
          return;
        }
        if (item === "SETTINGS") {
          // Real setting: toggle sound. Beep on unmute so you hear it return.
          setMutedState((m) => {
            const next = !m;
            setMuted(next);
            if (!next) sfx("accept");
            return next;
          });
          return;
        }
      }
    }
    if (action === "accept") sfx("accept");
    navDispatch(action);
  };

  // Keep the latest handler in a ref so the keydown listener (bound once) never
  // reads stale state.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    // Arrow keys mirror the three buttons (the mapping you asked for).
    if (e.key === "ArrowLeft") return e.preventDefault(), handleButton("select");
    if (e.key === "ArrowDown") return e.preventDefault(), handleButton("accept");
    if (e.key === "ArrowRight") return e.preventDefault(), handleButton("cancel");

    if (!identity) {
      if (e.key === "Enter") return e.preventDefault(), handleButton("accept");
      if (e.key === "Escape") return e.preventDefault(), handleButton("cancel");
      if (e.key === "Backspace") return e.preventDefault(), loginBackspace();
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return e.preventDefault(), loginType(e.key);
      return;
    }

    if (editing) {
      if (e.key === "Enter") return e.preventDefault(), handleButton("accept");
      if (e.key === "Escape") return e.preventDefault(), handleButton("cancel");
      if (e.key === "Backspace") return e.preventDefault(), editBackspace();
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return e.preventDefault(), editType(e.key);
      return;
    }
    // Convenience aliases when not editing.
    if (e.key === "Enter" || e.key === " ") return e.preventDefault(), handleButton("accept");
    if (e.key === "Escape") return handleButton("cancel");
  };

  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const footer = !identity
    ? login.mode === "create"
      ? "TYPE · SELECT field · ACCEPT create"
      : "TYPE password · ACCEPT login · CANCEL switch"
    : editing
      ? "TYPE · ACCEPT ok · CANCEL back"
      : wispView
        ? "SELECT move · ACCEPT raise · CANCEL back"
        : inFriends && friendsThread
          ? "ACCEPT write · CANCEL back"
          : inFriends
            ? "SELECT move · ACCEPT add/open · CANCEL back"
            : "SELECT move · ACCEPT enter · CANCEL back";

  return (
    <div className="stage" ref={stageRef}>
      <div className="device" ref={deviceRef} style={{ transform: `scale(${scale})` }}>
        <div className="wordmark">ZyPico</div>
        <div className="shell">
          {identity ? (
            <Screen
              model={{
                nav, editing, relay, wisp, wispView, canRaise: CAN_RAISE, muted,
                friends: inFriends
                  ? {
                      list: friendList,
                      cursor: friendsCursor,
                      thread: friendsThread
                        ? {
                            title: (buddies.find((b) => b.fingerprint === friendsThread)?.handle ?? "DM").toUpperCase(),
                            messages: dmThreads[friendsThread] ?? [],
                          }
                        : null,
                    }
                  : undefined,
                chat: nav.level === "place" && currentPlace(nav).id === "bcast"
                  ? { title: "MAIN ROOM", messages: roomMsgs.map((m) => ({ mine: m.mine, who: m.handle, text: m.text })) }
                  : undefined,
              }}
              onIcon={(index) => {
                sfx("accept");
                setWispView(null);
                navDispatch({ type: "goto", index });
              }}
            />
          ) : (
            <div className="lcd">
              <div className="matrix">
                <PixelScreen draw={(buf, f) => drawLogin(buf, f, login)} fps={8} />
              </div>
            </div>
          )}
        </div>
        <Buttons onAction={handleButton} />
        <Keyboard
          active={!identity || editing !== null}
          onType={identity ? editType : loginType}
          onBackspace={identity ? editBackspace : loginBackspace}
          onEnter={() => handleButton("accept")}
        />
        <div className="footer-verbs">{footer}</div>
      </div>
    </div>
  );
}
