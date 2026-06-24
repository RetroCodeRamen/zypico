// The LCD "screen" unit (outline §13.1): one panel holding a top row of four
// vector icons, the 128×80 dot matrix, and a bottom row of four icons. The
// icons frame the matrix like a real Tamagotchi; the active one highlights so
// location is always clear (outline §13.5). Clicking an icon (desktop) jumps
// into that place; the three buttons drive it otherwise.

import { PixelScreen } from "@ui/pixel/PixelScreen.tsx";
import { drawScreen, type ScreenModel } from "@ui/scenes/render.ts";
import { PlaceIcon } from "./icons.tsx";
import { BOTTOM_PLACES, TOP_PLACES, type PlaceDef } from "./nav.ts";

export function Screen({
  model,
  onIcon,
  fps = 8,
}: {
  model: ScreenModel;
  onIcon: (index: number) => void;
  /** Matrix refresh rate; bumped for the Relay carousel slide (the Wisp, whose
   *  frame-based wander assumes 8 fps, isn't on screen then). */
  fps?: number;
}) {
  const renderIcon = (place: PlaceDef, index: number) => (
    <button
      key={place.id}
      className={`place-icon ${place.scope} ${index === model.nav.iconIndex ? "active" : ""}`}
      tabIndex={-1}
      onClick={() => onIcon(index)}
      aria-label={place.label}
      title={place.label}
    >
      <PlaceIcon id={place.id} />
    </button>
  );

  return (
    <div className="lcd">
      <div className="icon-row top">{TOP_PLACES.map((p, i) => renderIcon(p, i))}</div>
      <div className="matrix">
        <PixelScreen draw={(buf, frame) => drawScreen(buf, frame, model)} fps={fps} />
      </div>
      <div className="icon-row bottom">{BOTTOM_PLACES.map((p, i) => renderIcon(p, i + 4))}</div>
    </div>
  );
}
