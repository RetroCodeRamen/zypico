import { useEffect, useReducer, useRef, useState } from "react";
import { Screen } from "@ui/shell/Screen.tsx";
import { PixelScreen } from "@ui/pixel/PixelScreen.tsx";
import { Buttons, type ButtonAction } from "@ui/shell/Buttons.tsx";
import { Keyboard } from "@ui/shell/Keyboard.tsx";
import { currentPlace, INITIAL_NAV, navReduce } from "@ui/shell/nav.ts";
import { drawLogin } from "@ui/scenes/render.ts";
import type { EditView } from "@ui/scenes/render.ts";
import { applyActivity, createWisp, HEARTS, renameWisp, wispForm } from "@core/companion/index.ts";
import type { Identity } from "@core/identity/index.ts";
import { sfx } from "@ui/sound.ts";
import { useViewportScale } from "@ui/hooks/useViewportScale.ts";
import { useMuted } from "@ui/hooks/useMuted.ts";
import { useCompanion } from "@ui/hooks/useCompanion.ts";
import { useRelay } from "@ui/hooks/useRelay.ts";
import { useSocial } from "@ui/hooks/useSocial.ts";
import { useIdentity } from "@ui/hooks/useIdentity.ts";

// Points granted per local "raise" action. This is a TEST-ONLY affordance,
// gated to dev builds (CAN_RAISE) — hearts are meant to be earned through
// participation, never picked at will (outline §3.2/§14). Real features
// (messaging→Signal, games→Arena, …) will call applyActivity the same way, and
// this manual action goes away.
const FEED_AMOUNT = 8;
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

  // Identity gate — nothing is shown until the traveler logs in (outline §13.6).
  // On login we load per-identity state and bring the link up; that wiring lives
  // below the dependent hooks, so the callback is reached through a ref.
  const postAuthRef = useRef<(id: Identity) => void>(() => {});
  const { identity, login, loginType, loginBackspace, handleButton: handleLoginButton } =
    useIdentity((id) => postAuthRef.current(id));

  // The companion (local-first; per-identity). Autosaves under the fingerprint.
  const { wisp, setWisp, wispView, setWispView, load: loadCompanion } =
    useCompanion(identity?.fingerprint ?? null);

  // The Relay link (optional) and the social layer that rides it. FRIENDS-place
  // navigation (which row, which open thread) is UI state and stays here.
  const link = useRelay();
  const social = useSocial(identity, link);
  const [friendsCursor, setFriendsCursor] = useState(0);
  const [friendsThread, setFriendsThread] = useState<string | null>(null); // buddy fingerprint

  // Reached at login (after identity is derived, before the gate lifts).
  postAuthRef.current = (id: Identity) => {
    loadCompanion(id.fingerprint);
    social.load(id.fingerprint);
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

  // FRIENDS: buddies (added) listed first, then nearby (heard, not yet added).
  const friendList: { kind: "buddy" | "nearby"; handle: string; fingerprint: string }[] = [
    ...social.buddies.map((b) => ({ kind: "buddy" as const, handle: b.petname ?? b.handle, fingerprint: b.fingerprint })),
    ...social.nearby
      .filter((n) => !social.buddies.some((b) => b.fingerprint === n.fingerprint))
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

    if (action === "accept" && nav.level === "place") {
      const place = currentPlace(nav);
      const item = place.items[nav.itemIndex];
      if (place.id === "radio") {
        if (item === "RECONNECT") {
          sfx("accept");
          void link.connectBoard(); // manual retry if the always-on link dropped
          return;
        }
        if (item === "DISCONNECT") {
          void link.disconnect();
          return;
        }
        // STATUS just shows the link report (handled by selection rendering).
      }
      if (place.id === "bcast") {
        sfx("accept");
        setEditing({ label: "MAIN ROOM", value: "", onSubmit: (v) => social.sendRoom(v) });
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
                nav, editing, relay: link.view, wisp, wispView, canRaise: CAN_RAISE, muted,
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
                chat: nav.level === "place" && currentPlace(nav).id === "bcast"
                  ? { title: "MAIN ROOM", messages: social.roomMsgs.map((m) => ({ mine: m.mine, who: m.handle, text: m.text })) }
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
