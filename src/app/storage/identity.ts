// Remembers the last traveler on this device — just the handle + public-key
// fingerprint, never the password or secret key. On return we show the handle
// and validate the password by re-deriving and comparing the fingerprint.

const KEY = "zypico.identity";

export interface StoredIdentity {
  handle: string;
  fingerprint: string;
}

export function loadStoredIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredIdentity>;
    if (typeof p.handle === "string" && typeof p.fingerprint === "string") {
      return { handle: p.handle, fingerprint: p.fingerprint };
    }
  } catch {
    // fall through
  }
  return null;
}

export function saveStoredIdentity(id: StoredIdentity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    // non-fatal
  }
}

export function clearStoredIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // non-fatal
  }
}
