import { useEffect, useState } from "react";

const KB_KEY = "zypico.keyboard";

// Whether the on-screen keyboard is shown. Persisted to localStorage. Disabling
// it unmounts the keyboard so the screen + buttons fill the viewport (the layout
// scales to fit the smaller device) — useful on small handhelds like a Retroid
// Pocket, where typing is done with a hardware/system keyboard. Returns the
// current state plus a useState-style setter so callers can toggle.
export function useKeyboardEnabled() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(KB_KEY) !== "0");
  useEffect(() => {
    localStorage.setItem(KB_KEY, enabled ? "1" : "0");
  }, [enabled]);
  return [enabled, setEnabled] as const;
}
