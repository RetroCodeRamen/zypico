import { useEffect, useReducer, useRef, useState } from "react";
import { Screen } from "@ui/shell/Screen.tsx";
import { PixelScreen } from "@ui/pixel/PixelScreen.tsx";
import { Buttons, type ButtonAction } from "@ui/shell/Buttons.tsx";
import { Keyboard } from "@ui/shell/Keyboard.tsx";
import { currentPlace, INITIAL_NAV, navReduce, PLACES } from "@ui/shell/nav.ts";
import { careActionCount, drawLogin, drawSplash } from "@ui/scenes/render.ts";
import type { EditView, MoodSummary, PageView } from "@ui/scenes/render.ts";
import {
  applyCare, CARES, createWisp, formWireIndex, moodState, renameWisp, settleMood, wispForm,
} from "@core/companion/index.ts";
import { PLACE_HOME } from "@core/protocol/social.ts";
import type { Identity } from "@core/identity/index.ts";
import { sfx } from "@ui/sound.ts";
import { useViewportScale } from "@ui/hooks/useViewportScale.ts";
import { useMuted } from "@ui/hooks/useMuted.ts";
import { useCompanion } from "@ui/hooks/useCompanion.ts";
import { useRelay } from "@ui/hooks/useRelay.ts";
import { useSocial } from "@ui/hooks/useSocial.ts";
import { useIdentity } from "@ui/hooks/useIdentity.ts";
import { usePages } from "@ui/hooks/usePages.ts";
import { usePageExchange } from "@ui/hooks/usePageExchange.ts";

// Hearts are earned through participation, never picked at will (DESIGN §2) —
// real activity hooks grant them. CAN_RAISE now only gates a dev-only RESET in
// the Wisp care panel (handy for testing evolution without grinding).
const CAN_RAISE = import.meta.env.DEV;

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

  // Boot splash (the ZyPico wordmark) — shown briefly before the login gate,
  // auto-dismissed; any button/key skips it.
  const [splash, setSplash] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1600);
    return () => clearTimeout(t);
  }, []);

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

  // Your Traveler Page (local-first; per-identity) + the PAGES overlay, plus the
  // peer-to-peer page exchange (serve/fetch over the mesh).
  const { myPage, load: loadPages, setTagline, setAbout } = usePages(identity?.fingerprint ?? null);
  const [pageView, setPageView] = useState<PageView | null>(null);
  const pageExchange = usePageExchange(identity, link, () => myPage);

  // Reached at login (after identity is derived, before the gate lifts).
  postAuthRef.current = (id: Identity) => {
    loadCompanion(id.fingerprint);
    social.load(id.fingerprint);
    loadPages(id.fingerprint);
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
  const inFriends = identity != null && nav.level === "place" && currentPlace(nav).id === "travelers";

  // Reset the TRAVELERS cursor/thread whenever we enter that place.
  useEffect(() => {
    if (inFriends) {
      setFriendsCursor(0);
      setFriendsThread(null);
    }
  }, [inFriends]);

  // ---- Button controller (shared by on-screen buttons + arrow keys) ----
  const handleButton = (action: ButtonAction) => {
    if (splash) { setSplash(false); sfx("select"); return; }
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
          setPageView(null);
          navDispatch("cancel");
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
          setPageView(null);
          navDispatch("cancel");
        }
      } else { // view
        if (action === "cancel") setPageView({ panel: "browse", cursor: 0 });
      }
      return;
    }

    // TRAVELERS place: buddy list (add nearby / open DM) and DM threads.
    if (inFriends) {
      if (friendsThread) {
        const buddy = social.buddies.find((b) => b.fingerprint === friendsThread);
        if (action === "accept" && buddy) {
          setEditing({ label: `DM ${buddy.petname ?? buddy.handle}`.slice(0, 18), value: "", onSubmit: (v) => social.sendDM(buddy, v) });
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
        navDispatch("cancel");
      }
      return;
    }

    // Entering the Wisp Place opens the care/detail surface (home = Wisp; the
    // Place is where you interact with it). DESIGN §6.2/§6.5.
    if (action === "accept" && nav.level === "home" && nav.iconIndex !== null
        && PLACES[nav.iconIndex].id === "wisp") {
      sfx("accept");
      setWispView({ panel: "care", cursor: 0 });
      navDispatch("accept");
      return;
    }

    if (action === "accept" && nav.level === "place") {
      const place = currentPlace(nav);
      const item = place.items[nav.itemIndex];
      if (place.id === "commons") {
        sfx("accept");
        setEditing({ label: "COMMONS", value: "", onSubmit: (v) => social.sendRoom(v) });
        return;
      }
      if (place.id === "pages" && item === "MY PAGE") {
        sfx("accept");
        setPageView({ panel: "mine", cursor: 0 });
        return;
      }
      if (place.id === "pages" && item === "BROWSE") {
        sfx("accept");
        setPageView({ panel: "browse", cursor: 0 });
        return;
      }
      if (place.id === "profile") {
        if (item === "RELAY") {
          // Ambient link control: report status (select) + re-link / drop.
          sfx("accept");
          if (link.view.online) void link.disconnect();
          else void link.connectBoard();
          navDispatch("accept"); // select so the status report shows
          return;
        }
        if (item === "SETTINGS") {
          // Real setting: toggle sound. Beep on unmute so you hear it return.
          setMutedState((m) => {
            const next = !m;
            if (!next) sfx("accept");
            return next;
          });
          navDispatch("accept"); // select so the toggle state shows
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
    if (splash) { e.preventDefault(); setSplash(false); return; }
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
    : editing
      ? "TYPE · ACCEPT ok · CANCEL back"
      : wispView
        ? wispView.panel === "stats"
          ? "CANCEL back to care"
          : "SELECT move · ACCEPT do · CANCEL back"
        : pageView
          ? pageView.panel === "view"
            ? "CANCEL back"
            : pageView.panel === "browse"
              ? "SELECT move · ACCEPT view · CANCEL back"
              : "SELECT move · ACCEPT edit · CANCEL back"
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
          {splash ? (
            <div className="lcd">
              <div className="matrix">
                <PixelScreen draw={drawSplash} fps={8} />
              </div>
            </div>
          ) : identity ? (
            <Screen
              model={{
                nav, editing, relay: link.view, wisp, wispView, canRaise: CAN_RAISE, muted,
                wispMood, discoveries: social.discoveries, sighting,
                pageView, myPage, pageBrowse,
                pageViewed: pageView?.panel === "view" && pageView.fp ? pageExchange.pages[pageView.fp] ?? null : null,
                nearbyCount: reachable.length,
                friends: inFriends
                  ? {
                      list: friendList,
                      cursor: friendsCursor,
                      thread: friendsThread
                        ? {
                            title: (social.buddies.find((b) => b.fingerprint === friendsThread)?.handle ?? "DM").toUpperCase(),
                            messages: social.dmThreads[friendsThread] ?? [],
                          }
                        : null,
                    }
                  : undefined,
                chat: nav.level === "place" && currentPlace(nav).id === "commons"
                  ? {
                      title: "COMMONS",
                      messages: social.roomMsgs.map((m) => ({ mine: m.mine, who: m.handle, text: m.text })),
                      present: reachable.length,
                    }
                  : undefined,
              }}
              onIcon={(index) => {
                sfx("accept");
                // The Wisp icon opens its care surface; others clear both overlays.
                setWispView(PLACES[index].id === "wisp" ? { panel: "care", cursor: 0 } : null);
                setPageView(null);
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
          active={!splash && (!identity || editing !== null)}
          onType={identity ? editType : loginType}
          onBackspace={identity ? editBackspace : loginBackspace}
          onEnter={() => handleButton("accept")}
        />
        <div className="footer-verbs">{footer}</div>
      </div>
    </div>
  );
}
