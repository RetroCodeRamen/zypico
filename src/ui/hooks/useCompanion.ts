import { useEffect, useState } from "react";
import { createWisp } from "@core/companion/index.ts";
import type { WispView } from "@ui/scenes/render.ts";
import { loadWisp, saveWisp } from "@app/storage/wisp.ts";

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

  return { wisp, setWisp, wispView, setWispView, load };
}
