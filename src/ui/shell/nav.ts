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

// The eight Places of the Relay (DESIGN §6.2). Home/landing is your Wisp; you
// travel *into* the Relay from there. Connectivity is ambient — there is no
// "Radio" destination (DESIGN §6.1). Some Places (Commons, Travelers, Wisp)
// render a live surface rather than this item menu; the rest are placeholders
// that later milestones (Mail M6, Pages M5, Arcade M9, Exchange M8) fill in.
export type Place =
  | "commons" | "travelers" | "post" | "pages"
  | "wisp" | "arcade" | "exchange" | "profile";

export interface PlaceDef {
  id: Place;
  label: string;
  /** Local surfaces work offline; relay surfaces travel to the mesh (DESIGN §5). */
  scope: "local" | "relay";
  /** Placeholder menu items — real per-phase functionality fills these in later. */
  items: string[];
}

// Ring order matches the icon layout: top row then bottom row (outline §13.1).
export const PLACES: PlaceDef[] = [
  { id: "commons", label: "COMMONS", scope: "relay", items: ["CHAT"] },
  { id: "travelers", label: "TRAVELERS", scope: "relay", items: ["LIST"] },
  { id: "post", label: "THE POST", scope: "relay", items: ["INBOX", "COMPOSE", "OUTBOX"] },
  { id: "pages", label: "PAGES", scope: "relay", items: ["MY PAGE", "BROWSE", "GUESTBOOK"] },
  { id: "wisp", label: "WISP", scope: "local", items: ["CARE"] },
  { id: "arcade", label: "ARCADE", scope: "local", items: ["BOUNCER", "STARFIELD"] },
  { id: "exchange", label: "EXCHANGE", scope: "local", items: ["ITEMS", "THEMES", "CARTS"] },
  { id: "profile", label: "PROFILE", scope: "local", items: ["IDENTITY", "VAULT", "RELAY", "SETTINGS"] },
];

/** Index of a Place in the ring (for direct navigation / special-casing). */
export function placeIndex(id: Place): number {
  return PLACES.findIndex((p) => p.id === id);
}

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
