import { useEffect, useState } from "react";
import { setStaySignedIn, staySignedIn } from "@app/storage/session.ts";

// "Stay signed in" preference (persisted, default on). Turning it off also
// clears any saved session (see setStaySignedIn), so the next reload re-logs-in.
export function useStaySignedIn() {
  const [on, setOn] = useState(() => staySignedIn());
  useEffect(() => { setStaySignedIn(on); }, [on]);
  return [on, setOn] as const;
}
