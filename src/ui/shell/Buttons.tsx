// The three physical buttons (outline §13.4): SELECT moves the highlight,
// ACCEPT confirms/enters, CANCEL backs out. On the T-Deck these map to
// trackball + keys; here they're on-screen, and the real keyboard's arrow keys
// mirror them (Left→SELECT, Down→ACCEPT, Right→CANCEL; handled in App).
//
// tabIndex=-1 so the physical keyboard's Space/Enter drive the global handler
// rather than "clicking" a focused button.

export type ButtonAction = "select" | "accept" | "cancel";

export function Buttons({ onAction }: { onAction: (action: ButtonAction) => void }) {
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
      <button className="btn3 cancel" tabIndex={-1} onClick={() => onAction("cancel")}>
        <span className="btn3-glyph">✕</span>
        CANCEL
      </button>
    </div>
  );
}
