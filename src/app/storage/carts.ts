// Cart storage — the Carts a Traveler holds: their own + ones received over the
// mesh. Each keeps the original signed wire payload so it can be re-served
// verbatim (preserving the author's signature). Per-identity, behind these
// functions like the rest of local state.

export interface HeldCart {
  authorFp: string;
  author: string;
  name: string;
  code: string;
  at: number;
  /** The original signed CART payload bytes, for verbatim re-serving. */
  payload: number[];
}

const CAP = 30;
const keyFor = (fingerprint: string) => `zypico.carts.${fingerprint}`;

export function loadCarts(fingerprint: string): HeldCart[] {
  try {
    const raw = localStorage.getItem(keyFor(fingerprint));
    if (!raw) return [];
    const list = JSON.parse(raw) as HeldCart[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCarts(fingerprint: string, list: HeldCart[]): void {
  try { localStorage.setItem(keyFor(fingerprint), JSON.stringify(list)); } catch { /* non-fatal */ }
}

/** Add/replace a cart (keyed by author+name, newest wins). */
export function addCart(list: HeldCart[], c: HeldCart): HeldCart[] {
  const existing = list.find((x) => x.authorFp === c.authorFp && x.name === c.name);
  if (existing && existing.at >= c.at) return list;
  return [...list.filter((x) => !(x.authorFp === c.authorFp && x.name === c.name)), c].slice(-CAP);
}
