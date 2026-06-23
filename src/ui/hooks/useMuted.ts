import { useEffect, useState } from "react";
import { setMuted } from "@ui/sound.ts";

const MUTE_KEY = "zypico.muted";

// Sound on/off, persisted to localStorage and kept in sync with the sound
// module. Returns the current state plus a setter that accepts a value or an
// updater (mirroring useState), so callers can toggle.
export function useMuted() {
  const [muted, setMutedState] = useState(() => localStorage.getItem(MUTE_KEY) === "1");
  useEffect(() => {
    setMuted(muted);
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  }, [muted]);
  return [muted, setMutedState] as const;
}
