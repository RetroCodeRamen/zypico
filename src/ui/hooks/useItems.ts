import { useEffect, useState } from "react";
import type { Identity } from "@core/identity/index.ts";
import { addItem, useItem, type InvEntry } from "@core/items.ts";
import { loadItems, saveItems } from "@app/storage/items.ts";

// The traveler's item inventory (REDESIGN §10): grant (earned by doing things),
// consume (using an item), and load per-identity. Autosaves under the fingerprint.
export function useItems(identity: Identity | null) {
  const [items, setItems] = useState<InvEntry[]>([]);

  useEffect(() => { if (identity) saveItems(identity.fingerprint, items); }, [items, identity]);

  const grant = (id: string) => setItems((inv) => addItem(inv, id));
  const consume = (id: string) => setItems((inv) => useItem(inv, id));
  const load = (fp: string) => setItems(loadItems(fp));

  return { items, grant, consume, load };
}
