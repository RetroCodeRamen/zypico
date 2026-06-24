// Persisted login session: lets the same device keep its login across page
// reloads. The board issues a session id (GET /session) that is fresh per boot
// and rotates when the WiFi client disconnects; we store the identity *keyed to
// that id*, so a refresh restores instantly but a board reboot or a WiFi
// reconnect (new id) drops the session and forces a fresh login.
//
// SECURITY NOTE: this persists the 32-byte secret seed on the device (so we can
// skip the slow password derivation). That's a deliberate convenience tradeoff
// for a personal handheld; the SETTINGS → STAY SIGNED IN toggle turns it off
// (and clears any saved session) for anyone who doesn't want keys at rest.

const SESSION_KEY = "zypico.session";
const STAY_KEY = "zypico.staySignedIn";

export interface StoredSession {
  handle: string;
  fingerprint: string;
  /** Hex of the 32-byte Ed25519 seed (the secret). */
  seed: string;
  /** The board session id this login is bound to. */
  sessionId: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof p.handle === "string" && typeof p.fingerprint === "string"
      && typeof p.seed === "string" && typeof p.sessionId === "string") {
      return { handle: p.handle, fingerprint: p.fingerprint, seed: p.seed, sessionId: p.sessionId };
    }
  } catch { /* fall through */ }
  return null;
}

export function saveSession(s: StoredSession): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* non-fatal */ }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* non-fatal */ }
}

/** Whether "stay signed in" is enabled (default on — the user asked for it). */
export function staySignedIn(): boolean {
  return localStorage.getItem(STAY_KEY) !== "0";
}
export function setStaySignedIn(on: boolean): void {
  try { localStorage.setItem(STAY_KEY, on ? "1" : "0"); } catch { /* non-fatal */ }
  if (!on) clearSession();
}

/** The board's current session id, or null if unreachable (dev / other host). */
export async function fetchSessionId(): Promise<string | null> {
  try {
    const res = await fetch("/session", { cache: "no-store" });
    if (!res.ok) return null;
    const id = (await res.text()).trim();
    return id.length ? id : null;
  } catch {
    return null;
  }
}
