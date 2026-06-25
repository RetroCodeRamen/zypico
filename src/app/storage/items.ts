// The traveler's item inventory, per-identity (REDESIGN §10). Behind these
// functions like the rest of local state; included in the Vault backup.

import type { InvEntry } from "@core/items.ts";

const keyFor = (fingerprint: string) => `zypico.items.${fingerprint}`;

export function loadItems(fingerprint: string): InvEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(fingerprint));
    if (!raw) return [];
    const list = JSON.parse(raw) as InvEntry[];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string" && typeof e.count === "number") : [];
  } catch {
    return [];
  }
}

export function saveItems(fingerprint: string, inv: InvEntry[]): void {
  try { localStorage.setItem(keyFor(fingerprint), JSON.stringify(inv)); } catch { /* non-fatal */ }
}
