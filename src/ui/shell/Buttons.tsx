// The three physical buttons (outline §13.4): SELECT moves the highlight,
// ACCEPT confirms/enters, CANCEL backs out. On the T-Deck these map to
// trackball + keys; here they're on-screen, and the real keyboard's arrow keys
// mirror them (Left→SELECT, Down→ACCEPT, Right→CANCEL; handled in App).
//
// tabIndex=-1 so the physical keyboard's Space/Enter drive the global handler
// rather than "clicking" a focused button.

import { useRef } from "react";

export type ButtonAction = "select" | "accept" | "cancel";

const HOLD_MS = 500; // hold CANCEL this long → jump Home (REDESIGN §13)

export function Buttons({ onAction, onHoldCancel }: {
  onAction: (action: ButtonAction) => void;
  /** Fired when CANCEL is held (instead of a normal tap-cancel). */
  onHoldCancel?: () => void;
}) {
  // CANCEL distinguishes a tap (back) from a hold (Home) via pointer timing.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  const cancelDown = () => {
    if (hold.current) return;
    hold.current = { fired: false, timer: setTimeout(() => { if (hold.current) hold.current.fired = true; onHoldCancel?.(); }, HOLD_MS) };
  };
  const cancelUp = () => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    clearTimeout(h.timer);
    if (!h.fired) onAction("cancel");
  };

  return (
    <div className="buttons">
      <button className="btn3 select" tabIndex={-1} onClick={() => onAction("select")}>
        <span className="btn3-glyph">↻</span>
        SELECT
      </button>
      <button className="btn3 accept" tabIndex={-1} onClick={() => onAction("accept")}>
        <span className="btn3-glyph">●</span>
        ACCEPT
      </button>
      <button
        className="btn3 cancel"
        tabIndex={-1}
        onPointerDown={cancelDown}
        onPointerUp={cancelUp}
        onPointerLeave={cancelUp}
        onPointerCancel={cancelUp}
      >
        <span className="btn3-glyph">✕</span>
        CANCEL
      </button>
    </div>
  );
}
