import type { FormDef } from "@core/companion/index.ts";
import { Snackfall } from "./snackfall.ts";
import { Echo } from "./echo.ts";
import { Bounce } from "./bounce.ts";
import type { WispGame } from "./types.ts";

export type { GameInput, WispGame } from "./types.ts";

/** The three Wisp minigames, in PLAY-picker order (REDESIGN §5/§12). */
export const WISP_GAMES = ["SNACKFALL", "ECHO", "BOUNCE"] as const;
export type WispGameName = (typeof WISP_GAMES)[number];

export function createWispGame(name: string, form: FormDef): WispGame {
  if (name === "ECHO") return new Echo(form);
  if (name === "BOUNCE") return new Bounce(form);
  return new Snackfall(form);
}
