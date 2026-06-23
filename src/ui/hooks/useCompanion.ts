import { useEffect, useState } from "react";
import { applyActivity, createWisp, wispForm, type Heart } from "@core/companion/index.ts";
import type { WispView } from "@ui/scenes/render.ts";
import { loadWisp, saveWisp } from "@app/storage/wisp.ts";
import { sfx } from "@ui/sound.ts";

// The companion (local-first; per-identity). `fingerprint` is the logged-in
// traveler's id — null before login. The Wisp autosaves under that fingerprint;
// `load` swaps in the stored Wisp at login. `wispView` is the detail-panel
// cursor (UI state that rides alongside the companion).
export function useCompanion(fingerprint: string | null) {
  const [wisp, setWisp] = useState(() => createWisp());
  const [wispView, setWispView] = useState<WispView | null>(null);

  useEffect(() => {
    if (fingerprint) saveWisp(fingerprint, wisp);
  }, [wisp, fingerprint]);

  const load = (fp: string) => setWisp(loadWisp(fp));

  // Grow a Heart through participation (DESIGN §2 — the only way Hearts rise).
  // Chirps on a form change so evolution is felt the moment it happens.
  const grant = (heart: Heart, amount: number) => {
    setWisp((w) => {
      const next = applyActivity(w, heart, amount);
      if (wispForm(next).id !== wispForm(w).id) sfx("evolve");
      return next;
    });
  };

  return { wisp, setWisp, wispView, setWispView, load, grant };
}
