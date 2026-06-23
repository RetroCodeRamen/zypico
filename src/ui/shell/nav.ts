// The Tamagotchi-style navigation state machine (outline §13.4–13.5).
//
// Three buttons drive everything:
//   SELECT  — move the highlight (cycle the 8 place-icons at home, or the items
//             inside a place's menu)
//   ACCEPT  — enter / confirm (open the highlighted place; select a menu item)
//   CANCEL  — hierarchical back: if an item is selected, deselect it; otherwise
//             leave the place and return to the companion home.
//
// "Home" is the companion screen — there is no home icon; CANCEL always walks
// back toward it (outline §13.5). The reducer is pure and DOM-free so it
// unit-tests in isolation (plan §9 tier 1); rendering reads this state.

export type Place =
  | "radio" | "mail" | "friends" | "profile"
  | "bcast" | "arcade" | "craft" | "quests";

export interface PlaceDef {
  id: Place;
  label: string;
  /** Local surfaces work offline; relay surfaces travel to the mesh (outline §1). */
  scope: "local" | "relay";
  /** Placeholder menu items — real per-phase functionality fills these in later. */
  items: string[];
}

// Ring order matches the icon layout: top row then bottom row (outline §13.1).
export const PLACES: PlaceDef[] = [
  { id: "radio", label: "RADIO", scope: "relay", items: ["STATUS", "RECONNECT", "DISCONNECT"] },
  { id: "mail", label: "MAIL", scope: "relay", items: ["INBOX", "COMPOSE", "OUTBOX"] },
  { id: "friends", label: "FRIENDS", scope: "relay", items: ["LIST", "ADD FRIEND", "REQUESTS"] },
  { id: "profile", label: "PROFILE", scope: "local", items: ["IDENTITY", "MY WISP", "SETTINGS"] },
  { id: "bcast", label: "BROADCAST", scope: "relay", items: ["GENERAL", "GAMES", "LOCAL", "NEW BOARD"] },
  { id: "arcade", label: "ARCADE", scope: "local", items: ["TIC-TAC-TOE", "CHESS", "SIGNAL MATCH"] },
  { id: "craft", label: "CRAFT", scope: "local", items: ["NEW CART", "MY CARTS", "EDITOR"] },
  { id: "quests", label: "QUESTS", scope: "relay", items: ["ACTIVE", "BROWSE", "JOURNEY"] },
];

export const TOP_PLACES = PLACES.slice(0, 4);
export const BOTTOM_PLACES = PLACES.slice(4, 8);

export type NavLevel = "home" | "place";
export type NavAction =
  | "select"
  | "select-prev"
  | "accept"
  | "cancel"
  // Desktop affordance: click an icon to jump straight into that place.
  | { type: "goto"; index: number };

export interface NavState {
  level: NavLevel;
  /**
   * Highlighted place-icon (0–7), or null when nothing is highlighted. At the
   * companion home the device idles with NO icon selected (like a Tamagotchi);
   * SELECT begins the highlight and CANCEL clears it back to idle.
   */
  iconIndex: number | null;
  /** Highlighted item within the open place's menu. */
  itemIndex: number;
  /** The selected/active item (null = just browsing). */
  selectedItem: number | null;
}

export const INITIAL_NAV: NavState = {
  level: "home",
  iconIndex: null,
  itemIndex: 0,
  selectedItem: null,
};

/** The place currently open (only meaningful at place level). */
export function currentPlace(state: NavState): PlaceDef {
  return PLACES[state.iconIndex ?? 0];
}

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export function navReduce(state: NavState, action: NavAction): NavState {
  if (typeof action === "object") {
    // goto: open the clicked place directly.
    return {
      level: "place",
      iconIndex: wrap(action.index, PLACES.length),
      itemIndex: 0,
      selectedItem: null,
    };
  }

  if (state.level === "home") {
    switch (action) {
      case "select":
        // From idle (null) begin at the first icon; otherwise advance.
        return {
          ...state,
          iconIndex: state.iconIndex === null ? 0 : wrap(state.iconIndex + 1, PLACES.length),
        };
      case "select-prev":
        return {
          ...state,
          iconIndex: state.iconIndex === null ? PLACES.length - 1 : wrap(state.iconIndex - 1, PLACES.length),
        };
      case "accept":
        // Nothing highlighted → nothing to enter.
        if (state.iconIndex === null) return state;
        return { ...state, level: "place", itemIndex: 0, selectedItem: null };
      case "cancel":
        // Return to idle: no icon highlighted.
        return { ...state, iconIndex: null };
    }
  }

  // level === "place"
  const itemCount = currentPlace(state).items.length;
  switch (action) {
    case "select":
      // While an item is selected, SELECT is reserved for that item's own
      // controls (none yet) — so it's a no-op until those land.
      if (state.selectedItem !== null) return state;
      return { ...state, itemIndex: wrap(state.itemIndex + 1, itemCount) };
    case "select-prev":
      if (state.selectedItem !== null) return state;
      return { ...state, itemIndex: wrap(state.itemIndex - 1, itemCount) };
    case "accept":
      // Select/activate the highlighted item (idempotent if already selected).
      return { ...state, selectedItem: state.itemIndex };
    case "cancel":
      // Hierarchical back (the rule you set): selected → deselect; else → home,
      // returning to idle with no icon highlighted.
      if (state.selectedItem !== null) return { ...state, selectedItem: null };
      return { ...state, level: "home", iconIndex: null };
  }
}
