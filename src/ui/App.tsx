import { useEffect, useReducer, useRef, useState } from "react";
import { Screen } from "@ui/shell/Screen.tsx";
import { PixelScreen } from "@ui/pixel/PixelScreen.tsx";
import { Buttons, type ButtonAction } from "@ui/shell/Buttons.tsx";
import { Keyboard } from "@ui/shell/Keyboard.tsx";
import { currentPlace, INITIAL_NAV, navReduce, PLACES, RELAY_SCENES, type RelayScene } from "@ui/shell/nav.ts";
import { careActionCount, drawCartError, drawErrorBanner, drawLogin, drawSplash } from "@ui/scenes/render.ts";
import {
  CART_TEMPLATE, caretDown, caretLeft, caretRight, caretUp, cleanName, deleteBack, insertAt,
  WORKSHOP_MENU, type WorkshopView,
} from "@ui/workshop/editor.ts";
import type { EditView, ExchangeView, MoodSummary, PageView, PostView, VaultView } from "@ui/scenes/render.ts";
import {
  applyCare, CARES, createWisp, formWireIndex, moodState, renameWisp, settleMood, wispForm,
} from "@core/companion/index.ts";
import { PLACE_HOME } from "@core/protocol/social.ts";
import { SERVICE } from "@core/protocol/index.ts";
import type { Identity } from "@core/identity/index.ts";
import { cartBeep, sfx } from "@ui/sound.ts";
import { useViewportScale } from "@ui/hooks/useViewportScale.ts";
import { useMuted } from "@ui/hooks/useMuted.ts";
import { useKeyboardEnabled } from "@ui/hooks/useKeyboardEnabled.ts";
import { useCompanion } from "@ui/hooks/useCompanion.ts";
import { useRelay } from "@ui/hooks/useRelay.ts";
import { useSocial } from "@ui/hooks/useSocial.ts";
import { useIdentity } from "@ui/hooks/useIdentity.ts";
import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { CartRunner, cleanLuaError } from "@ui/cart/CartRunner.ts";
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
  const [carouselSlideAt, setCarouselSlideAt] = useState(0); // last carousel advance (Relay/Arcade slide)

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

  // A running Cart (Arcade game, or a Workshop preview). runner null + no error
  // = still loading; error set = compile failure; preview = launched to test.
  const [cart, setCart] = useState<{ runner: CartRunner | null; name: string; error: string | null; preview: boolean } | null>(null);
  const cartPressRef = useRef({ select: 0, accept: 0 }); // last tap times → momentary input

  const launchCart = (name: string, code: string, preview = false) => {
    sfx("accept");
    cartPressRef.current = { select: 0, accept: 0 };
    setCart({ runner: null, name, error: null, preview });
    void CartRunner.load(code, luaWasmUrl, { beep: cartBeep }).then((r) => {
      setCart((cur) => (cur && cur.name === name && cur.runner === null && !cur.error ? { runner: r, name, error: null, preview } : (r.dispose(), cur)));
    }).catch((e) => {
      setCart((cur) => (cur && cur.name === name ? { runner: null, name, error: cleanLuaError(e), preview } : cur));
    });
  };
  const exitCart = () => { cart?.runner?.dispose(); setCart(null); }; // workshop editor (if any) shows again

  // Draw the running Cart into the matrix, feeding it momentary button input.
  const cartDraw = (buf: PixelBuffer, _frame: number) => {
    if (cart?.error) { drawCartError(buf, cart.error); return; } // compile failure
    const r = cart?.runner;
    if (!r) { buf.clear(1); return; } // brief load
    const now = Date.now();
    r.setInput({
      select: now - cartPressRef.current.select < 160,
      accept: now - cartPressRef.current.accept < 160,
      cancel: false,
    });
    r.render(buf);
    const err = cart?.preview ? r.getError() : null; // surface runtime errors in preview
    if (err) drawErrorBanner(buf, err);
  };

  // The Workshop (Lua dev env): list → editor → command menu / help. Preview
  // reuses the Cart overlay above. myCarts = the carts you authored (editable).
  const [workshop, setWorkshop] = useState<WorkshopView | null>(null);
  const myCarts = identity ? cartExchange.carts.filter((c) => c.authorFp === identity.fingerprint) : [];
  const newCartName = () => {
    const names = new Set(myCarts.map((c) => c.name));
    if (!names.has("MYCART")) return "MYCART";
    let i = 2;
    while (names.has(`MYCART${i}`)) i++;
    return `MYCART${i}`;
  };
  // Editor text ops applied to the open edit doc (typing + caret movement).
  const wsInsert = (s: string) => setWorkshop((w) => {
    if (!w || w.mode !== "edit") return w;
    const r = insertAt(w.doc.code, w.doc.caret, s);
    return { mode: "edit", doc: { ...w.doc, code: r.code, caret: r.caret, dirty: true } };
  });
  const wsBackspace = () => setWorkshop((w) => {
    if (!w || w.mode !== "edit") return w;
    const r = deleteBack(w.doc.code, w.doc.caret);
    return { mode: "edit", doc: { ...w.doc, code: r.code, caret: r.caret, dirty: true } };
  });
  const wsCaret = (fn: (code: string, caret: number) => number) => setWorkshop((w) =>
    w && w.mode === "edit" ? { mode: "edit", doc: { ...w.doc, caret: fn(w.doc.code, w.doc.caret) } } : w);

  // Reached at login (after identity is derived, before the gate lifts).
  postAuthRef.current = (id: Identity) => {
    reloadLocal(id.fingerprint);
    void link.connectBoard(true); // always-on link to the board, no manual step
  };

  // Sound on/off (persisted), kept in sync with the sound module.
  const [muted, setMutedState] = useMuted();

  // On-screen keyboard on/off (persisted). Off hides it so the screen + buttons
  // fill the viewport on small handhelds (typing then uses a hardware keyboard).
  const [keyboardEnabled, setKeyboardEnabled] = useKeyboardEnabled();

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
  const inArcade = identity != null && nav.level === "place" && currentPlace(nav).id === "arcade";
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

    // THE WORKSHOP (Lua dev env). list → editor → command menu / help. In the
    // editor the keyboard types; the three buttons move the caret + open the menu.
    if (workshop) {
      if (workshop.mode === "list") {
        const count = 1 + myCarts.length; // "+ NEW CART" + your carts
        if (action === "select") setWorkshop({ mode: "list", cursor: (workshop.cursor + 1) % count });
        else if (action === "accept") {
          if (workshop.cursor === 0) {
            const name = newCartName();
            setWorkshop({ mode: "edit", doc: { name, code: CART_TEMPLATE, caret: CART_TEMPLATE.length, dirty: true, origName: null } });
          } else {
            const c = myCarts[workshop.cursor - 1];
            if (c) setWorkshop({ mode: "edit", doc: { name: c.name, code: c.code, caret: 0, dirty: false, origName: c.name } });
          }
        } else if (action === "cancel") { setWorkshop(null); navDispatch("cancel"); }
        return;
      }
      if (workshop.mode === "edit") {
        const doc = workshop.doc;
        if (action === "select") wsCaret(caretLeft);
        else if (action === "accept") wsCaret(caretRight);
        else if (action === "cancel") setWorkshop({ mode: "menu", cursor: 0, doc });
        return;
      }
      if (workshop.mode === "menu") {
        const doc = workshop.doc;
        if (action === "select") { setWorkshop({ mode: "menu", cursor: (workshop.cursor + 1) % WORKSHOP_MENU.length, doc }); return; }
        if (action === "cancel") { setWorkshop({ mode: "edit", doc }); return; }
        if (action === "accept") {
          const cmd = WORKSHOP_MENU[workshop.cursor];
          if (cmd === "RUN") { setWorkshop({ mode: "edit", doc }); launchCart(doc.name || "PREVIEW", doc.code, true); }
          else if (cmd === "SAVE") {
            const name = cleanName(doc.name);
            cartExchange.saveCart(name, doc.code); sfx("accept");
            setWorkshop({ mode: "edit", doc: { ...doc, name, dirty: false, origName: name } });
          } else if (cmd === "API HELP") setWorkshop({ mode: "help", doc, page: 0 });
          else if (cmd === "RENAME") {
            setEditing({ label: "CART NAME", value: doc.name, onSubmit: (v) => setWorkshop({ mode: "edit", doc: { ...doc, name: cleanName(v), dirty: true } }) });
          } else if (cmd === "DELETE") {
            if (doc.origName) cartExchange.deleteCart(doc.origName);
            sfx("cancel"); setWorkshop({ mode: "list", cursor: 0 });
          } else if (cmd === "SHARE") {
            const name = cleanName(doc.name);
            cartExchange.saveCart(name, doc.code); cartExchange.shareCart(name, doc.code); sfx("accept");
            setWorkshop({ mode: "edit", doc: { ...doc, name, dirty: false, origName: name } });
          } else if (cmd === "EXIT") setWorkshop({ mode: "list", cursor: 0 });
        }
        return;
      }
      if (workshop.mode === "help") {
        if (action === "select") setWorkshop({ mode: "help", doc: workshop.doc, page: workshop.page + 1 });
        else if (action === "cancel") setWorkshop({ mode: "edit", doc: workshop.doc });
        return;
      }
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
        // Scene picker (carousel): ACCEPT opens the scene; SELECT advances the
        // carousel (record the moment so the renderer animates the slide), then
        // falls through to the default to actually move the cursor; CANCEL falls
        // through to leave the Relay.
        if (action === "accept") {
          const scene = RELAY_SCENES[nav.itemIndex];
          sfx("accept");
          if (scene === "post" || scene === "pages") setRelaySubCursor(0);
          setRelayScene(scene);
          return;
        }
        if (action === "select") setCarouselSlideAt(Date.now()); // then fall through to navDispatch
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

    // The Arcade is a carousel too: a SELECT records the slide moment, then
    // falls through to cycle the cursor.
    if (inArcade && action === "select") setCarouselSlideAt(Date.now());

    if (action === "accept" && nav.level === "place") {
      const place = currentPlace(nav);
      const item = place.items[nav.itemIndex];
      if (place.id === "arcade") {
        const s = SAMPLE_CARTS.find((c) => c.name === item);
        if (s) launchCart(s.name, s.code);
        return;
      }
      if (place.id === "workshop") {
        if (item === "MY CARTS") { sfx("accept"); setWorkshop({ mode: "list", cursor: 0 }); return; }
        if (item === "EXCHANGE") {
          sfx("accept");
          cartExchange.publish(); // share our Carts while we're here
          setExchangeView({ cursor: 0 });
          return;
        }
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
        if (item === "KEYBOARD") {
          // Toggle the on-screen keyboard (off = fill the screen on small devices).
          sfx("accept");
          setKeyboardEnabled((k) => !k);
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
    // Workshop code editor: keys type/edit directly; arrows move the caret
    // (incl. up/down lines), Enter = newline, Esc = command menu. Takes priority
    // over the arrow→button mapping so the caret moves instead of navigating.
    if (workshop?.mode === "edit" && identity && !editing && !cart) {
      if (e.key === "ArrowLeft") return e.preventDefault(), wsCaret(caretLeft);
      if (e.key === "ArrowRight") return e.preventDefault(), wsCaret(caretRight);
      if (e.key === "ArrowUp") return e.preventDefault(), wsCaret(caretUp);
      if (e.key === "ArrowDown") return e.preventDefault(), wsCaret(caretDown);
      if (e.key === "Enter") return e.preventDefault(), wsInsert("\n");
      if (e.key === "Backspace") return e.preventDefault(), wsBackspace();
      if (e.key === "Escape") return e.preventDefault(), setWorkshop({ mode: "menu", cursor: 0, doc: workshop.doc });
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return e.preventDefault(), wsInsert(e.key);
      return;
    }
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
      ? cart.error || cart.preview ? "CANCEL back to editor" : "SELECT / ACCEPT play · CANCEL exit"
    : editing
      ? "TYPE · ACCEPT ok · CANCEL back"
      : workshop
        ? workshop.mode === "edit"
          ? "TYPE code · SEL/ACC caret · CANCEL menu"
          : workshop.mode === "menu"
            ? "SELECT move · ACCEPT do · CANCEL back"
            : workshop.mode === "help"
              ? "CANCEL back"
              : "SELECT move · ACCEPT open · CANCEL back"
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
              fps={(inRelay && relayScene === null) || inArcade ? 16 : 8}
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
                carouselSlideAt,
                relaySub: relayScene === "post"
                  ? { title: "THE POST", items: POST_ITEMS, cursor: relaySubCursor }
                  : relayScene === "pages"
                    ? { title: "PAGES", items: PAGE_ITEMS, cursor: relaySubCursor }
                    : undefined,
                identityLabel: { handle: identity.handle, fpShort: identity.fingerprint.slice(0, 10).toUpperCase() },
                keyboardEnabled,
                workshop,
                myCartNames: myCarts.map((c) => c.name),
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
                setWorkshop(null);
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
        {/* Always available at login (where Settings can't be reached); post-login
            it follows the SETTINGS → KEYBOARD toggle. */}
        {(keyboardEnabled || !identity) && (
          <Keyboard
            active={!splash && !cart && (!identity || editing !== null || workshop?.mode === "edit")}
            onType={workshop?.mode === "edit" ? wsInsert : identity ? editType : loginType}
            onBackspace={workshop?.mode === "edit" ? wsBackspace : identity ? editBackspace : loginBackspace}
            onEnter={workshop?.mode === "edit" ? () => wsInsert("\n") : () => handleButton("accept")}
          />
        )}
        <div className="footer-verbs">{footer}</div>
      </div>
    </div>
  );
}
