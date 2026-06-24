import { useEffect, useRef, useState } from "react";
import { deriveIdentity, identityFromSeed, type Identity } from "@core/identity/index.ts";
import { clearStoredIdentity, loadStoredIdentity, saveStoredIdentity } from "@app/storage/identity.ts";
import { clearSession, fetchSessionId, loadSession, saveSession, staySignedIn } from "@app/storage/session.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { LoginView } from "@ui/scenes/render.ts";
import type { ButtonAction } from "@ui/shell/Buttons.tsx";
import { sfx } from "@ui/sound.ts";

// The identity gate: handle + password → a derived Identity (outline §13.6).
// Owns the login view state machine and the create/login/switch flow. When a
// traveler authenticates, `onAuthenticated(id)` fires so the app can load
// per-identity state (companion, buddies) and bring the link up before render.
export function useIdentity(onAuthenticated: (id: Identity) => void) {
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

  // Restore a saved session on boot — but only if the board's session id still
  // matches (same boot + same WiFi connection). A page reload hits this and logs
  // straight in; a board reboot or WiFi reconnect makes the id mismatch → we drop
  // the saved session and fall back to the login screen. Skips the slow Argon2.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sess = loadSession();
      if (!sess || !staySignedIn()) return;
      const current = await fetchSessionId();
      if (cancelled) return;
      if (!current || current !== sess.sessionId) { clearSession(); return; }
      try {
        const id = identityFromSeed(sess.handle, hexToBytes(sess.seed));
        if (id.fingerprint !== sess.fingerprint) { clearSession(); return; }
        onAuthenticated(id);
        setIdentity(id);
      } catch {
        clearSession();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      onAuthenticated(id);
      setIdentity(id);
      setLogin((l) => ({ ...l, busy: false, password: "" }));
      sfx("connect");
      // Remember this login for reloads, bound to the board's current session id.
      if (staySignedIn()) {
        const sessionId = await fetchSessionId();
        if (sessionId) saveSession({ handle: id.handle, fingerprint: id.fingerprint, seed: bytesToHex(id.secretKey), sessionId });
      }
    } catch {
      setLogin((l) => ({ ...l, busy: false, error: "LOGIN FAILED" }));
      sfx("error");
    }
  };

  // Login-gate button controller (delegated to while no identity exists).
  const handleButton = (action: ButtonAction) => {
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
        // Switch traveler: forget the stored identity + session and start fresh.
        clearStoredIdentity();
        clearSession();
        storedRef.current = null;
        setLogin({ mode: "create", handle: "", password: "", field: "handle", busy: false });
      } else {
        setLogin((l) => ({ ...l, [l.field]: "" }));
      }
    }
  };

  // Save the current login as a session now (e.g. when STAY SIGNED IN is turned
  // back on mid-session), bound to the board's current session id.
  const rememberCurrent = () => {
    if (!identity) return;
    void (async () => {
      const sessionId = await fetchSessionId();
      if (sessionId) saveSession({ handle: identity.handle, fingerprint: identity.fingerprint, seed: bytesToHex(identity.secretKey), sessionId });
    })();
  };

  return { identity, login, loginType, loginBackspace, handleButton, rememberCurrent };
}
