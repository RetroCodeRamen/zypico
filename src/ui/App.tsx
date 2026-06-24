import { useEffect, useReducer, useRef, useState } from "react";
import { Screen } from "@ui/shell/Screen.tsx";
import { PixelScreen } from "@ui/pixel/PixelScreen.tsx";
import { Buttons, type ButtonAction } from "@ui/shell/Buttons.tsx";
import { Keyboard } from "@ui/shell/Keyboard.tsx";
import { currentPlace, INITIAL_NAV, navReduce, PLACES, RELAY_SCENES, type RelayScene } from "@ui/shell/nav.ts";
import { careActionCount, drawLogin, drawSplash } from "@ui/scenes/render.ts";
import type { EditView, ExchangeView, MoodSummary, PageView, PostView, VaultView } from "@ui/scenes/render.ts";
import {
  applyCare, CARES, createWisp, formWireIndex, moodState, renameWisp, settleMood, wispForm,
} from "@core/companion/index.ts";
import { PLACE_HOME } from "@core/protocol/social.ts";
import { SERVICE } from "@core/protocol/index.ts";
import type { Identity } from "@core/identity/index.ts";
import { sfx } from "@ui/sound.ts";
import { useViewportScale } from "@ui/hooks/useViewportScale.ts";
import { useMuted } from "@ui/hooks/useMuted.ts";
import { useCompanion } from "@ui/hooks/useCompanion.ts";
import { useRelay } from "@ui/hooks/useRelay.ts";
import { useSocial } from "@ui/hooks/useSocial.ts";
import { useIdentity } from "@ui/hooks/useIdentity.ts";
import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { CartRunner } from "@ui/cart/CartRunner.ts";
import { SAMPLE_CARTS } from "@ui/cart/samples.ts";
// Bundle the Lua WASM as a local asset so Carts run offline on the board.
import luaWasmUrl from "wasmoon/dist/glue.wasm?url";
import { usePages } from "@ui/hooks/usePages.ts";
import { usePageExchange } from "@ui/hooks/usePageExchange.ts";
import { usePostOffice } from "@ui/hooks/usePostOffice.ts";
import { useVault } from "@ui/hooks/useVault.ts";
import { useCartExchange } from "@ui/hooks/useCartExchange.ts";

// Hearts are earned through participation, never picked at will (DESIGN §2) —
// real activity hooks grant them. CAN_RAISE now only gates a dev-only RESET in
// the Wisp care panel (handy for testing evolution without grinding).
const CAN_RAISE = import.meta.env.DEV;

interface Editing extends EditView {
  onSubmit: (value: string) => void;
}

// The Relay's Post/Pages sub-menus (REDESIGN §8) — labels shown in the sub-menu
// and indexed by relaySubCursor to open the matching overlay panel.
const POST_ITEMS = ["INBOX", "WRITE MAIL", "OUTBOX"];
const PAGE_ITEMS = ["MY PAGE", "BROWSE", "GUESTBOOK"];

// The interface is the Tamagotchi shell: a screen unit (icons + 128×80 matrix)
// driven by three buttons, with an HTML keyboard below for text entry. App is
// the controller — it owns navigation, the text-entry mode, and the (optional)
// Relay link. All content renders inside the matrix (see scenes/render.ts).
export function App() {
  const [nav, navDispatch] = useReducer(navReduce, INITIAL_NAV);
  const [editing, setEditing] = useState<Editing | null>(null);

  // Boot splash — a title screen that waits for input (no auto-dismiss timer).
  // Armed shortly after appearing so a held button carried over from a prior
  // action can't skip it; dismissed by any button/key/pointer once armed.
  const [splash, setSplash] = useState(true);
  const splashArmedRef = useRef(false);
  const reducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  ).current;
  useEffect(() => {
    const t = setTimeout(() => { splashArmedRef.current = true; }, 350);
    return () => clearTimeout(t);
  }, []);
  const dismissSplash = () => {
    if (splash && splashArmedRef.current) { setSplash(false); sfx("select"); }
  };

  // Identity gate — nothing is shown until the traveler logs in (outline §13.6).
  // On login we load per-identity state and bring the link up; that wiring lives
  // below the dependent hooks, so the callback is reached through a ref.
  const postAuthRef = useRef<(id: Identity) => void>(() => {});
  const { identity, login, loginType, loginBackspace, handleButton: handleLoginButton } =
    useIdentity((id) => postAuthRef.current(id));

  // The companion (local-first; per-identity). Autosaves under the fingerprint.
  const { wisp, setWisp, wispView, setWispView, load: loadCompanion, grant } =
    useCompanion(identity?.fingerprint ?? null);

  // The Relay link (optional) and the social layer that rides it. Participation
  // grows Hearts via `grant`. FRIENDS-place nav state stays here.
  const link = useRelay();
  const social = useSocial(identity, link, grant, () => ({
    formIndex: formWireIndex(wispForm(wisp).id),
    placeId: nav.level === "place" && nav.iconIndex !== null ? nav.iconIndex : PLACE_HOME,
  }));
  const [friendsCursor, setFriendsCursor] = useState(0);
  const [friendsThread, setFriendsThread] = useState<string | null>(null); // buddy fingerprint
  const [commonsPanel, setCommonsPanel] = useState<"chat" | "stations">("chat"); // Commons sub-view
  // The Relay is one place holding scenes (Commons/Travelers/Post/Pages/Stations,
  // REDESIGN §8). relayScene = which scene is open (null = the scene picker);
  // relaySubCursor = the cursor inside the Post/Pages sub-menu.
  const [relayScene, setRelayScene] = useState<RelayScene | null>(null);
  const [relaySubCursor, setRelaySubCursor] = useState(0);

  // Your Traveler Page (local-first; per-identity) + the PAGES overlay, plus the
  // peer-to-peer page exchange (serve/fetch over the mesh).
  const { myPage, load: loadPages, setTagline, setAbout } = usePages(identity?.fingerprint ?? null);
  const [pageView, setPageView] = useState<PageView | null>(null);
  const pageStationFps = social.stations.filter((s) => s.services & SERVICE.PAGES).map((s) => s.fingerprint);
  const pageExchange = usePageExchange(identity, link, () => myPage, pageStationFps);

  // The Post: Mail (compose/outbox/inbox), delivered when recipients are reachable.
  const reachableFps = social.nearby.filter((n) => Date.now() - n.lastSeen < 300_000).map((n) => n.fingerprint);
  const postOffice = usePostOffice(identity, link, social.resolvePubkey, reachableFps);
  const [postView, setPostView] = useState<PostView | null>(null);

  // The Exchange: Carts you hold (yours + received over the mesh) — run + share.
  const cartExchange = useCartExchange(identity, link);
  const [exchangeView, setExchangeView] = useState<ExchangeView | null>(null);

  // Account Vault: encrypted backup/restore at a Station. Restore re-loads every
  // local hook from the freshly-restored storage.
  const reloadLocal = (fp: string) => {
    loadCompanion(fp); social.load(fp); loadPages(fp);
    pageExchange.loadGuests(fp); postOffice.load(fp); cartExchange.load(fp);
  };
  const vault = useVault(identity, link, reloadLocal);
  const [vaultView, setVaultView] = useState<VaultView | null>(null);

  // A running Cart (the Arcade): runner null = still loading the Lua engine.
  const [cart, setCart] = useState<{ runner: CartRunner | null; name: string } | null>(null);
  const cartPressRef = useRef({ select: 0, accept: 0 }); // last tap times → momentary input

  const launchCart = (name: string, code: string) => {
    sfx("accept");
    cartPressRef.current = { select: 0, accept: 0 };
    setCart({ runner: null, name });
    void CartRunner.load(code, luaWasmUrl).then((r) => {
      setCart((cur) => (cur && cur.name === name && cur.runner === null ? { runner: r, name } : (r.dispose(), cur)));
    });
  };
  const exitCart = () => { cart?.runner?.dispose(); setCart(null); };

  // Draw the running Cart into the matrix, feeding it momentary button input.
  const cartDraw = (buf: PixelBuffer, _frame: number) => {
    const r = cart?.runner;
    if (!r) { buf.clear(1); return; } // brief load
    const now = Date.now();
    r.setInput({
      select: now - cartPressRef.current.select < 160,
      accept: now - cartPressRef.current.accept < 160,
      cancel: false,
    });
    r.render(buf);
  };

  // Reached at login (after identity is derived, before the gate lifts).
  postAuthRef.current = (id: Identity) => {
    reloadLocal(id.fingerprint);
    void link.connectBoard(true); // always-on link to the board, no manual step
  };

  // Sound on/off (persisted), kept in sync with the sound module.
  const [muted, setMutedState] = useMuted();

  // Scale-to-fit: laid out at true design size, scaled by one uniform factor.
  const { stageRef, deviceRef, scale } = useViewportScale();

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

  // Reachable Travelers = heard within the 5-min window (DESIGN §4.2). Stale
  // beacons drop off so the world reflects who's actually around.
  const reachable = social.nearby.filter((n) => Date.now() - n.lastSeen < 300_000);

  // Buddies you can compose Mail to (mail waits in the outbox until they're reachable).
  const mailPick = social.buddies.map((b) => ({ handle: b.petname ?? b.handle, fingerprint: b.fingerprint }));

  // Travelers whose page we can fetch right now: buddies + reachable (deduped).
  const pageBrowse: { handle: string; fingerprint: string }[] = [
    ...social.buddies.map((b) => ({ handle: b.petname ?? b.handle, fingerprint: b.fingerprint })),
    ...reachable
      .filter((n) => !social.buddies.some((b) => b.fingerprint === n.fingerprint))
      .map((n) => ({ handle: n.handle, fingerprint: n.fingerprint })),
  ];

  // TRAVELERS: buddies (added) first, then reachable nearby/relay (not yet added).
  // `via` distinguishes Nearby (direct) from Relay (heard across hops), §4.1.
  const friendList: {
    kind: "buddy" | "nearby"; handle: string; fingerprint: string;
    via?: "nearby" | "relay";
  }[] = [
    ...social.buddies.map((b) => ({ kind: "buddy" as const, handle: b.petname ?? b.handle, fingerprint: b.fingerprint })),
    ...reachable
      .filter((n) => !social.buddies.some((b) => b.fingerprint === n.fingerprint))
      .map((n) => ({
        kind: "nearby" as const, handle: n.handle, fingerprint: n.fingerprint,
        via: (n.hops === 0 ? "nearby" : "relay") as "nearby" | "relay",
      })),
  ];
  const inRelay = identity != null && nav.level === "place" && currentPlace(nav).id === "relay";
  const inFriends = inRelay && relayScene === "travelers";
  const inCommons = inRelay && relayScene === "commons";

  // Leaving the Relay drops back to its scene picker.
  useEffect(() => { if (!inRelay) setRelayScene(null); }, [inRelay]);

  // Reset the TRAVELERS cursor/thread whenever we open that scene.
  useEffect(() => {
    if (inFriends) {
      setFriendsCursor(0);
      setFriendsThread(null);
    }
  }, [inFriends]);

  // Default the Commons to chat each time you open it.
  useEffect(() => { if (inCommons) setCommonsPanel("chat"); }, [inCommons]);

  // ---- Button controller (shared by on-screen buttons + arrow keys) ----
  const handleButton = (action: ButtonAction) => {
    if (splash) { dismissSplash(); return; }
    // A running Cart owns the buttons: CANCEL exits, SELECT/ACCEPT are its input.
    if (cart) {
      if (action === "cancel") exitCart();
      else if (action === "select") cartPressRef.current.select = Date.now();
      else if (action === "accept") cartPressRef.current.accept = Date.now();
      return;
    }
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

    // WISP Place. Stats panel is view-only (CANCEL returns to care). Care panel:
    // the six care actions (move Mood, never Hearts), then RENAME, STATS, RESET.
    if (wispView) {
      if (wispView.panel === "stats" || wispView.panel === "journal") {
        if (action === "cancel") setWispView({ panel: "care", cursor: 0 });
        return;
      }
      const count = careActionCount(CAN_RAISE);
      if (action === "select") {
        setWispView({ panel: "care", cursor: (wispView.cursor + 1) % count });
      } else if (action === "accept") {
        const i = wispView.cursor;
        if (i < CARES.length) {
          setWisp((w) => ({ ...w, mood: applyCare(w.mood, CARES[i]) }));
          sfx("feed"); // a soft, happy reaction
        } else if (i === CARES.length) { // RENAME
          sfx("accept");
          setEditing({
            label: "NAME YOUR WISP",
            value: wisp.name,
            onSubmit: (v) => setWisp((w) => renameWisp(w, v.slice(0, 12))),
          });
        } else if (i === CARES.length + 1) { // STATS
          sfx("select");
          setWispView({ panel: "stats", cursor: 0 });
        } else if (i === CARES.length + 2) { // JOURNAL
          sfx("select");
          setWispView({ panel: "journal", cursor: 0 });
        } else if (CAN_RAISE) { // RESET (dev)
          sfx("cancel");
          setWisp(createWisp()); // TEST ONLY: start a fresh Flicker
          setWispView({ panel: "care", cursor: 0 });
        }
      } else if (action === "cancel") {
        setWispView(null);
        navDispatch("cancel"); // leave the Wisp place, back to home
      }
      return;
    }

    // PAGES overlay: edit your page, browse reachable Travelers, or read a page.
    if (pageView) {
      if (pageView.panel === "mine") {
        if (action === "select") {
          setPageView({ panel: "mine", cursor: (pageView.cursor + 1) % 2 });
        } else if (action === "accept") {
          if (pageView.cursor === 0) setEditing({ label: "TAGLINE", value: myPage.tagline, onSubmit: setTagline });
          else setEditing({ label: "ABOUT", value: myPage.about, onSubmit: setAbout });
        } else if (action === "cancel") {
          setPageView(null); // back to the Relay's Pages sub-menu
        }
      } else if (pageView.panel === "browse") {
        if (action === "select") {
          setPageView({ panel: "browse", cursor: pageBrowse.length ? (pageView.cursor + 1) % pageBrowse.length : 0 });
        } else if (action === "accept") {
          const it = pageBrowse[pageView.cursor];
          if (it) {
            sfx("accept");
            pageExchange.requestPage(it.fingerprint); // owner serves it back over the mesh
            setPageView({ panel: "view", cursor: 0, fp: it.fingerprint });
          }
        } else if (action === "cancel") {
          setPageView(null); // back to the Relay's Pages sub-menu
        }
      } else if (pageView.panel === "guestbook") {
        if (action === "cancel") { setPageView(null); }
      } else { // view someone's page
        if (action === "accept" && pageView.fp) {
          const who = (pageExchange.pages[pageView.fp]?.handle ?? "TRAVELER").toUpperCase();
          const fp = pageView.fp;
          setEditing({ label: `SIGN ${who}`.slice(0, 18), value: "", onSubmit: (v) => pageExchange.signGuestbook(fp, v) });
        } else if (action === "cancel") {
          setPageView({ panel: "browse", cursor: 0 });
        }
      }
      return;
    }

    // PROFILE → VAULT overlay: encrypted backup / restore.
    if (vaultView) {
      if (action === "select") setVaultView({ cursor: (vaultView.cursor + 1) % 2 });
      else if (action === "accept") { if (vaultView.cursor === 0) vault.backup(); else vault.restore(); }
      else if (action === "cancel") { setVaultView(null); navDispatch("cancel"); }
      return;
    }

    // THE EXCHANGE overlay: pick a Cart and run it.
    if (exchangeView) {
      const list = cartExchange.carts;
      if (action === "select") setExchangeView({ cursor: list.length ? (exchangeView.cursor + 1) % list.length : 0 });
      else if (action === "accept") { const c = list[exchangeView.cursor]; if (c) launchCart(c.name, c.code); }
      else if (action === "cancel") { setExchangeView(null); navDispatch("cancel"); }
      return;
    }

    // THE POST overlay: read mail, pick a recipient + compose, browse the outbox.
    if (postView) {
      if (postView.panel === "inbox") {
        const shown = [...postOffice.inbox].reverse().slice(0, 8);
        if (action === "select") setPostView({ panel: "inbox", cursor: shown.length ? (postView.cursor + 1) % shown.length : 0 });
        else if (action === "accept") {
          const it = shown[postView.cursor];
          if (it) { postOffice.markRead(it.id); setPostView({ panel: "read", cursor: 0, id: it.id }); }
        } else if (action === "cancel") { setPostView(null); }
      } else if (postView.panel === "pick") {
        if (action === "select") setPostView({ panel: "pick", cursor: mailPick.length ? (postView.cursor + 1) % mailPick.length : 0 });
        else if (action === "accept") {
          const it = mailPick[postView.cursor];
          if (it) setEditing({
            label: `MAIL ${it.handle}`.slice(0, 18), value: "",
            onSubmit: (v) => { postOffice.compose(it.fingerprint, it.handle, v); setPostView({ panel: "outbox", cursor: 0 }); },
          });
        } else if (action === "cancel") { setPostView(null); }
      } else { // read / outbox — view only
        if (action === "cancel") {
          if (postView.panel === "read") setPostView({ panel: "inbox", cursor: 0 });
          else { setPostView(null); }
        }
      }
      return;
    }

    // TRAVELERS place: buddy list (add nearby / open DM) and DM threads.
    if (inFriends) {
      if (friendsThread) {
        const buddy = social.buddies.find((b) => b.fingerprint === friendsThread);
        if (action === "accept" && buddy) {
          const name = buddy.petname ?? buddy.handle;
          if (reachableFps.includes(buddy.fingerprint)) {
            setEditing({ label: `DM ${name}`.slice(0, 18), value: "", onSubmit: (v) => social.sendDM(buddy, v) });
          } else {
            // Chat needs the peer reachable; offer Mail instead (never silent).
            setEditing({ label: `MAIL ${name}`.slice(0, 18), value: "", onSubmit: (v) => postOffice.compose(buddy.fingerprint, name, v) });
          }
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
          const p = social.nearby.find((n) => n.fingerprint === it.fingerprint);
          if (p) social.addBuddy(p);
        } else if (it) {
          sfx("accept");
          setFriendsThread(it.fingerprint);
        }
      } else if (action === "cancel") {
        setRelayScene(null); // back to the Relay's scene picker
      }
      return;
    }

    // Entering the Wisp Place opens the care/detail surface (home = Wisp; the
    // Place is where you interact with it). DESIGN §6.2/§6.5.
    if (action === "accept" && nav.level === "home" && nav.iconIndex !== null
        && PLACES[nav.iconIndex].id === "home") {
      sfx("accept");
      setWispView({ panel: "care", cursor: 0 });
      navDispatch("accept");
      return;
    }

    // COMMONS scene: ACCEPT writes a message; CANCEL returns to the Relay's
    // scene picker. (Stations are now their own Relay scene, §8.)
    if (inCommons) {
      if (action === "accept") {
        sfx("accept");
        setEditing({ label: "COMMONS", value: "", onSubmit: (v) => social.sendRoom(v) });
        return;
      }
      if (action === "cancel") { setRelayScene(null); return; }
      return; // SELECT inert in the Commons
    }

    // THE RELAY — scene picker + the Post/Pages sub-menus + Stations (§8). The
    // Commons/Travelers scenes are handled above; this covers the rest.
    if (inRelay) {
      if (relayScene === null) {
        // Scene picker: ACCEPT opens the scene; SELECT/CANCEL fall through to
        // the default (cycle the menu / leave the Relay).
        if (action === "accept") {
          const scene = RELAY_SCENES[nav.itemIndex];
          sfx("accept");
          if (scene === "post" || scene === "pages") setRelaySubCursor(0);
          setRelayScene(scene);
          return;
        }
      } else if (relayScene === "stations") {
        if (action === "cancel") setRelayScene(null);
        return; // the Stations list is view-only for now
      } else if (relayScene === "post" || relayScene === "pages") {
        const items = relayScene === "post" ? POST_ITEMS : PAGE_ITEMS;
        if (action === "select") { setRelaySubCursor((c) => (c + 1) % items.length); return; }
        if (action === "cancel") { setRelayScene(null); return; }
        if (action === "accept") {
          sfx("accept");
          if (relayScene === "post") {
            if (relaySubCursor === 0) setPostView({ panel: "inbox", cursor: 0 });
            else if (relaySubCursor === 1) setPostView({ panel: "pick", cursor: 0 });
            else setPostView({ panel: "outbox", cursor: 0 });
          } else {
            if (relaySubCursor === 0) setPageView({ panel: "mine", cursor: 0 });
            else if (relaySubCursor === 1) setPageView({ panel: "browse", cursor: 0 });
            else setPageView({ panel: "guestbook", cursor: 0 });
          }
          return;
        }
      }
    }

    if (action === "accept" && nav.level === "place") {
      const place = currentPlace(nav);
      const item = place.items[nav.itemIndex];
      if (place.id === "arcade") {
        const s = SAMPLE_CARTS.find((c) => c.name === item);
        if (s) launchCart(s.name, s.code);
        return;
      }
      if (place.id === "workshop" && item === "CARTS") {
        sfx("accept");
        cartExchange.publish(); // share our Carts while we're here
        setExchangeView({ cursor: 0 });
        return;
      }
      if (place.id === "profile" && item === "VAULT") {
        sfx("accept");
        setVaultView({ cursor: 0 });
        return;
      }
      if (place.id === "settings") {
        if (item === "SOUND") {
          // Toggle sound. Beep on unmute so you hear it return.
          setMutedState((m) => {
            const next = !m;
            if (!next) sfx("accept");
            return next;
          });
          navDispatch("accept"); // select so the toggle state shows
          return;
        }
        if (item === "RELAY") {
          // Ambient link control: report status (select) + re-link / drop.
          sfx("accept");
          if (link.view.online) void link.disconnect();
          else void link.connectBoard();
          navDispatch("accept"); // select so the status report shows
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
    if (splash) { e.preventDefault(); dismissSplash(); return; }
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

  // The Wisp's settled mood (App owns the clock; the renderer stays pure).
  const now = Date.now();
  // A recent thing the Wisp saw (last 24h) for it to mention on the home.
  const latest = social.discoveries[social.discoveries.length - 1];
  const sighting = latest && now - latest.at < 86_400_000 ? latest.name : undefined;
  const settledMood = settleMood(wisp.mood, now);
  const wispMood: MoodSummary = {
    state: moodState(wisp.mood, now),
    fed: settledMood.fed, energy: settledMood.energy,
    clean: settledMood.clean, joy: settledMood.joy, bond: settledMood.bond,
  };

  const footer = !identity
    ? login.mode === "create"
      ? "TYPE · SELECT field · ACCEPT create"
      : "TYPE password · ACCEPT login · CANCEL switch"
    : cart
      ? "SELECT / ACCEPT play · CANCEL exit"
    : editing
      ? "TYPE · ACCEPT ok · CANCEL back"
      : wispView
        ? wispView.panel === "stats"
          ? "CANCEL back to care"
          : "SELECT move · ACCEPT do · CANCEL back"
        : pageView
          ? pageView.panel === "view"
            ? "ACCEPT sign · CANCEL back"
            : pageView.panel === "guestbook"
              ? "CANCEL back"
              : pageView.panel === "browse"
                ? "SELECT move · ACCEPT view · CANCEL back"
                : "SELECT move · ACCEPT edit · CANCEL back"
        : vaultView
          ? "SELECT move · ACCEPT do · CANCEL back"
        : exchangeView
          ? "SELECT move · ACCEPT run · CANCEL back"
        : postView
          ? postView.panel === "read" || postView.panel === "outbox"
            ? "CANCEL back"
            : postView.panel === "pick"
              ? "SELECT move · ACCEPT write · CANCEL back"
              : "SELECT move · ACCEPT read · CANCEL back"
        : inFriends && friendsThread
          ? "ACCEPT write · CANCEL back"
          : inFriends
            ? "SELECT move · ACCEPT add/open · CANCEL back"
            : inCommons
              ? "ACCEPT write · CANCEL back"
              : inRelay && relayScene === "stations"
                ? "CANCEL back"
              : inRelay && (relayScene === "post" || relayScene === "pages")
                ? "SELECT move · ACCEPT open · CANCEL back"
              : "SELECT move · ACCEPT enter · CANCEL back";

  return (
    <div className="stage" ref={stageRef}>
      <div className="device" ref={deviceRef} style={{ transform: `scale(${scale})` }}>
        <div className="wordmark">ZyPico</div>
        <div className="shell">
          {splash ? (
            <div className="lcd" onPointerDown={dismissSplash}>
              <div className="matrix">
                <PixelScreen draw={(buf, f) => drawSplash(buf, f, reducedMotion)} fps={8} />
              </div>
            </div>
          ) : cart ? (
            <div className="lcd">
              <div className="matrix">
                <PixelScreen draw={cartDraw} fps={15} />
              </div>
            </div>
          ) : identity ? (
            <Screen
              model={{
                nav, editing, relay: link.view, wisp, wispView, canRaise: CAN_RAISE, muted,
                wispMood, discoveries: social.discoveries, sighting,
                pageView, myPage, pageBrowse, myGuestbook: pageExchange.myGuestbook,
                pageViewed: pageView?.panel === "view" && pageView.fp ? pageExchange.pages[pageView.fp] ?? null : null,
                postView, inbox: postOffice.inbox, outbox: postOffice.outbox, mailPick,
                mailRead: postView?.panel === "read" && postView.id != null ? postOffice.inbox.find((m) => m.id === postView.id) ?? null : null,
                vaultView, vaultStatus: vault.status,
                exchangeView, cartList: cartExchange.carts.map((c) => ({ name: c.name, author: c.author })),
                nearbyCount: reachable.length,
                friends: inFriends
                  ? {
                      list: friendList,
                      cursor: friendsCursor,
                      thread: friendsThread
                        ? {
                            title: (social.buddies.find((b) => b.fingerprint === friendsThread)?.handle ?? "DM").toUpperCase(),
                            messages: social.dmThreads[friendsThread] ?? [],
                            reachable: reachableFps.includes(friendsThread),
                          }
                        : null,
                    }
                  : undefined,
                chat: inCommons
                  ? {
                      title: "COMMONS",
                      messages: social.roomMsgs.map((m) => ({ mine: m.mine, who: m.handle, text: m.text })),
                      present: reachable.length,
                      stations: social.stations.filter((s) => Date.now() - s.lastSeen < 300_000).length,
                    }
                  : undefined,
                commonsPanel,
                relayScene,
                relaySub: relayScene === "post"
                  ? { title: "THE POST", items: POST_ITEMS, cursor: relaySubCursor }
                  : relayScene === "pages"
                    ? { title: "PAGES", items: PAGE_ITEMS, cursor: relaySubCursor }
                    : undefined,
                identityLabel: { handle: identity.handle, fpShort: identity.fingerprint.slice(0, 10).toUpperCase() },
                stationList: social.stations
                  .filter((s) => Date.now() - s.lastSeen < 300_000)
                  .map((s) => ({ name: s.name, services: s.services, hops: s.hops })),
              }}
              onIcon={(index) => {
                sfx("accept");
                // The Home icon opens the Wisp's care surface; others clear overlays.
                setWispView(PLACES[index].id === "home" ? { panel: "care", cursor: 0 } : null);
                setRelayScene(null);
                setPageView(null);
                setPostView(null);
                setVaultView(null);
                setExchangeView(null);
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
          active={!splash && !cart && (!identity || editing !== null)}
          onType={identity ? editType : loginType}
          onBackspace={identity ? editBackspace : loginBackspace}
          onEnter={() => handleButton("accept")}
        />
        <div className="footer-verbs">{footer}</div>
      </div>
    </div>
  );
}
