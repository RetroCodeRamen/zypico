// The on-screen QWERTY keyboard. Per the user's directive it lives in the web
// page BELOW the three buttons — part of the device chrome, NOT drawn on the LCD
// (which stays pure display). It mirrors the T-Deck's physical keyboard. Keys
// feed the active text field rendered in the LCD; the real keyboard works too
// (handled in App). Inert/dimmed when nothing is being edited.
//
// tabIndex=-1 keeps these out of the focus ring so Space/Enter on the physical
// keyboard drive the app's global handler instead of "clicking" a focused key.

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "."],
  ["z", "x", "c", "v", "b", "n", "m", "-", "_", "/"],
];

export function Keyboard({
  active,
  onType,
  onBackspace,
  onEnter,
}: {
  active: boolean;
  onType: (ch: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
}) {
  return (
    <div className={`keyboard ${active ? "active" : "idle"}`} aria-hidden={!active}>
      {ROWS.map((row, r) => (
        <div className="kb-row" key={r}>
          {row.map((k) => (
            <button key={k} className="kb-key" tabIndex={-1} onClick={() => onType(k)}>
              {k}
            </button>
          ))}
        </div>
      ))}
      <div className="kb-row">
        <button className="kb-key wide" tabIndex={-1} onClick={() => onType(":")}>:</button>
        <button className="kb-key space" tabIndex={-1} onClick={() => onType(" ")}>SPACE</button>
        <button className="kb-key wide" tabIndex={-1} onClick={onBackspace}>DEL</button>
        <button className="kb-key wide enter" tabIndex={-1} onClick={onEnter}>OK</button>
      </div>
    </div>
  );
}
