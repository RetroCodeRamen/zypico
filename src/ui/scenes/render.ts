// Everything the user sees is drawn here, inside the 128×80 dot matrix (the
// user's directive: "all menus render inside the screen"). drawScreen() reads a
// small view model and paints the companion home (with ambient activity stars +
// connection glyph), a place menu, a live surface (Commons / Travelers / Wisp /
// Profile), the text-entry field, or the Wisp detail. Pure buffer drawing — no DOM.

import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { CELL_H, CELL_W, drawText, drawTextCentered, measureText } from "@ui/pixel/font.ts";
import { currentPlace, PLACES, type NavState, type PlaceDef, type RelayScene } from "@ui/shell/nav.ts";
import { caretRowCol, lines, WORKSHOP_MENU, type CartDoc, type WorkshopView } from "@ui/workshop/editor.ts";
import {
  CARE_DEFS,
  CARES,
  HEART_DEFS,
  HEARTS,
  MOOD_MAX,
  MOOD_STATE_DEFS,
  THRESHOLD,
  TIER_NAMES,
  wispAgeDays,
  wispForm,
  type MoodState,
  type Wisp,
} from "@core/companion/index.ts";
import type { Discovery } from "@app/storage/discoveries.ts";
import type { TravelerPage } from "@app/storage/page.ts";
import type { GuestEntry } from "@app/storage/guestbook.ts";
import type { InboxMail, OutboxMail } from "@app/storage/mail.ts";
import { SERVICE, type PageMsg } from "@core/protocol/index.ts";
import { LOGO, LOGO_H, LOGO_TRANSPARENT, LOGO_W } from "@ui/pixel/logoBitmap.ts";
import { drawHeartMeter, drawWisp } from "./wisp.ts";

// PICO-8 indices used as semantic colors for the UI register.
const C = {
  bg: 1, ground: 0, title: 10, text: 6, textHi: 7, cursor: 9,
  selBar: 9, selText: 1, dim: 5, tagLocal: 11, tagRelay: 12, warn: 8, ok: 11,
};

export interface RelayView {
  statusLabel: string;
  nodeLabel?: string;
  online: boolean;
  /** How we're linked, e.g. "MESHTASTIC APP" or "HTTP". */
  via?: string;
  /** Full error message on failure (shown wrapped on the RADIO screen). */
  detail?: string;
}

/** Greedy word-wrap to `maxChars` per line. */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface EditView {
  label: string;
  value: string;
}

/** The WISP Place. `care` = actions + reactions (front); `stats` = hearts;
 * `journal` = "what I saw" (the Wisp's discoveries). */
export interface WispView {
  panel: "care" | "stats" | "journal";
  /** Highlighted action in the care panel (the action list, see CARE_ACTIONS). */
  cursor: number;
}

/** The PAGES place overlay. `mine` = edit your Traveler Page (cursor: 0 tagline,
 * 1 about); `browse` = pick a reachable Traveler; `view` = read their page. */
export interface PageView {
  panel: "mine" | "browse" | "view" | "guestbook";
  cursor: number;
  /** Whose page is open (panel "view"). */
  fp?: string;
}

/** PROFILE → VAULT overlay (cursor: 0 backup, 1 restore). */
export interface VaultView {
  cursor: number;
}

/** THE EXCHANGE overlay — a list of Carts to run (cursor selects one). */
export interface ExchangeView {
  cursor: number;
}

/** The POST place overlay: read mail, pick a recipient to compose, or browse the
 * outbox. `id` selects the open inbox mail (panel "read"). */
export interface PostView {
  panel: "inbox" | "read" | "pick" | "outbox";
  cursor: number;
  id?: number;
}

/** Settled mood summary handed to the renderer (kept pure — App owns the clock). */
export interface MoodSummary {
  state: MoodState;
  fed: number;
  energy: number;
  clean: number;
  joy: number;
  bond: number;
}

/** The login/onboarding gate, shown before anything else. */
export interface LoginView {
  mode: "create" | "login";
  handle: string;
  password: string;
  field: "handle" | "password";
  busy: boolean;
  error?: string;
}

// The boot splash: a title screen that waits for input (App dismisses it). The
// prompt loops gently; with reduced motion it stays static. No auto-dismiss.
export function drawSplash(buf: PixelBuffer, frame: number, reducedMotion = false): void {
  buf.clear(C.textHi); // white ground (the logo's transparent pixels show through)
  const ox = Math.floor((buf.width - LOGO_W) / 2);
  const oy = Math.floor((buf.height - LOGO_H) / 2) - 4;
  for (let y = 0; y < LOGO_H; y++) {
    for (let x = 0; x < LOGO_W; x++) {
      const v = LOGO[y * LOGO_W + x];
      if (v !== LOGO_TRANSPARENT) buf.set(ox + x, oy + y, v);
    }
  }
  // Gently pulsing prompt (static when the user prefers reduced motion).
  if (reducedMotion || Math.floor(frame / 4) % 2 === 0) drawTextCentered(buf, 70, "PRESS ANY BUTTON", C.dim);
}

export function drawLogin(buf: PixelBuffer, frame: number, v: LoginView): void {
  buf.clear(C.bg);
  drawTextCentered(buf, 3, "ZYPICO", C.title);
  drawTextCentered(buf, 11, v.mode === "create" ? "NEW TRAVELER" : "WELCOME BACK", C.dim);
  divider(buf, 19);

  const blink = Math.floor(frame / 4) % 2 === 0;
  const maxChars = Math.floor((buf.width - 6) / CELL_W);

  // Handle field
  drawText(buf, 3, 24, "HANDLE", v.field === "handle" ? C.textHi : C.text);
  const hShown = v.handle.slice(-maxChars);
  const hx = drawText(buf, 3, 32, hShown, C.textHi);
  if (v.field === "handle" && blink) buf.fillRect(hx, 31, 2, 7, C.cursor);

  // Password field (masked)
  drawText(buf, 3, 42, "PASSWORD", v.field === "password" ? C.textHi : C.text);
  const pMask = "*".repeat(Math.min(v.password.length, maxChars));
  const px = drawText(buf, 3, 50, pMask, C.textHi);
  if (v.field === "password" && blink) buf.fillRect(px, 49, 2, 7, C.cursor);

  divider(buf, 60);
  if (v.busy) drawTextCentered(buf, 64, "UNLOCKING...", C.title);
  else if (v.error) drawTextCentered(buf, 64, v.error, C.warn);
  else if (v.mode === "create") drawTextCentered(buf, 64, "NO RESET - REMEMBER IT", C.dim);

  drawTextCentered(buf, 73, "ACCEPT LOGIN  SELECT FIELD", C.dim);
}

export interface ScreenModel {
  nav: NavState;
  editing: EditView | null;
  relay: RelayView;
  wisp: Wisp;
  wispView: WispView | null;
  /** PAGES overlay (edit/browse/view), when open. */
  pageView: PageView | null;
  /** Your Traveler Page (for the PAGES editor). */
  myPage: TravelerPage;
  /** Reachable Travelers whose pages you can fetch (PAGES → browse). */
  pageBrowse: { handle: string; fingerprint: string }[];
  /** The page being viewed (PAGES → view), or null while it's still fetching. */
  pageViewed: PageMsg | null;
  /** Guestbook entries left for you (PAGES → guestbook). */
  myGuestbook: GuestEntry[];
  /** THE POST overlay + its data, when open. */
  postView: PostView | null;
  inbox: InboxMail[];
  outbox: OutboxMail[];
  /** Buddies you can compose mail to (POST → compose). */
  mailPick: { handle: string; fingerprint: string }[];
  /** The inbox mail being read (POST → read), or null. */
  mailRead: InboxMail | null;
  /** PROFILE → VAULT overlay + its status, when open. */
  vaultView: VaultView | null;
  vaultStatus: "idle" | "backed-up" | "requesting" | "restored";
  /** THE EXCHANGE overlay + the Carts you can run, when open. */
  exchangeView: ExchangeView | null;
  cartList: { name: string; author: string }[];
  /** The Wisp's settled mood (drives the home behavior + the care panel). */
  wispMood: MoodSummary;
  /** The Wisp's discoveries, oldest→newest (the JOURNAL panel). */
  discoveries: Discovery[];
  /** TRAVELERS screen state (buddy list + open DM thread), when in that place. */
  friends?: FriendsView;
  /** COMMONS chatroom state, when in that place. */
  chat?: ChatView;
  /** COMMONS sub-panel: chat, or the discovered-Stations list (travel, §6.2). */
  commonsPanel: "chat" | "stations";
  stationList: StationRow[];
  /** Which Relay scene is open (Commons/Travelers/Post/Pages/Stations), or null
   *  for the Relay's own scene menu (REDESIGN §8). */
  relayScene?: RelayScene | null;
  /** The Post/Pages sub-menu inside the Relay (its items + cursor). */
  relaySub?: { title: string; items: string[]; cursor: number };
  /** Epoch ms of the last carousel advance (Relay scene-picker / Arcade slide). */
  carouselSlideAt?: number;
  /** Who you are, for the PROFILE place (handle + short fingerprint). */
  identityLabel?: { handle: string; fpShort: string };
  /** Whether the on-screen keyboard is shown (SETTINGS → KEYBOARD). */
  keyboardEnabled?: boolean;
  /** The Workshop overlay (Lua editor), when open. */
  workshop?: WorkshopView | null;
  /** Names of your authored carts (WORKSHOP → MY CARTS list). */
  myCartNames?: string[];
  /** Whether the test-only "raise a heart" action is available (dev builds). */
  canRaise: boolean;
  /** Sound muted (shown as a small indicator on home). */
  muted: boolean;
  /** Reachable Travelers right now — drives the home activity stars (§6.4). */
  nearbyCount: number;
  /** A recent thing the Wisp saw, voiced on the idle home (DESIGN §2). */
  sighting?: string;
}

export interface FriendsView {
  list: {
    kind: "buddy" | "nearby"; handle: string; fingerprint: string;
    /** How a not-yet-added Traveler was heard (DESIGN §4.1). */
    via?: "nearby" | "relay";
  }[];
  cursor: number;
  thread: {
    title: string;
    messages: { out: boolean; text: string }[];
    /** Is the buddy reachable right now? Gates live Chat (DESIGN §4.4). */
    reachable: boolean;
  } | null;
}

export interface ChatView {
  title: string;
  messages: { mine: boolean; who: string; text: string }[];
  /** Reachable Travelers right now — the Commons' "signs of life" (§4/§6.2). */
  present: number;
  /** Stations heard nearby (infrastructure presence). */
  stations: number;
}

/** A discovered Station, for the Commons' Stations panel (DESIGN §5/§6.2). */
export interface StationRow {
  name: string;
  services: number;
  /** 0 = heard directly (Nearby), ≥1 = across the Relay. */
  hops: number;
}

// The Wisp wanders the play area on a non-repeating path (layered sines), so it
// roams rather than hovering in place. Deterministic from `frame` — no state.
const wanderX = (t: number) => clamp(64 + Math.sin(t * 0.012) * 40 + Math.sin(t * 0.037 + 1) * 8, 22, 106);
const wanderY = (t: number) => clamp(38 + Math.sin(t * 0.019 + 2) * 12 + Math.cos(t * 0.027) * 5, 26, 54);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A small bright "+" star, for the activity indicator (§6.4). */
function drawStar(buf: PixelBuffer, x: number, y: number, color: number): void {
  buf.set(x, y, color);
  buf.set(x - 1, y, color);
  buf.set(x + 1, y, color);
  buf.set(x, y - 1, color);
  buf.set(x, y + 1, color);
}

// Nearby Traveler count → bright activity stars (DESIGN §6.4): 0–3 → 1, 4–6 → 2,
// 7–9 → 3. Airtime caps a neighborhood at low dozens, so three is "very alive".
function activityStars(nearbyCount: number): number {
  return nearbyCount <= 3 ? 1 : nearbyCount <= 6 ? 2 : 3;
}

// How much the Wisp moves by mood — happy roams, lonely/sad/sleepy go still
// (DESIGN §2: "moves less, animates differently"). Never zero — always alive.
const LIVELINESS: Record<MoodState, number> = {
  joyful: 1, happy: 0.85, content: 0.6, okay: 0.5,
  hungry: 0.5, messy: 0.5, lonely: 0.3, sad: 0.25, sleepy: 0.12,
};

// States whose feeling is worth voicing on the idle home (others stay neutral).
const VOICED: ReadonlySet<MoodState> = new Set(["joyful", "lonely", "sad", "sleepy", "hungry", "messy"]);

/** The companion home: the Wisp (mood-driven), its name above, the idle hint below. */
export function drawCompanion(
  buf: PixelBuffer,
  frame: number,
  wisp: Wisp,
  mood: MoodSummary,
  highlightLabel?: string,
  muted?: boolean,
  online?: boolean,
  nearbyCount = 0,
  sighting?: string,
): void {
  buf.clear(C.bg);
  buf.fillRect(0, 66, buf.width, 14, C.ground);
  if (muted) drawText(buf, 2, 2, "MUTE", C.dim);
  // Ambient connection glyph (DESIGN §6.1 — status, never a destination).
  const conn = online ? "=RELAY" : "OFFLINE";
  drawText(buf, buf.width - measureText(conn) - 2, 2, conn, online ? C.ok : C.dim);

  const stars = [[16, 12], [34, 7], [53, 17], [77, 9], [97, 19], [110, 8], [64, 5]];
  for (let i = 0; i < stars.length; i++) {
    if ((frame + i * 5) % 22 < 11) buf.set(stars[i][0], stars[i][1], C.text);
  }
  // Bright, steady activity stars — how inhabited the Relay feels right now.
  const bright = [[24, 14], [64, 11], [104, 14]];
  for (let i = 0; i < activityStars(nearbyCount); i++) drawStar(buf, bright[i][0], bright[i][1], C.textHi);

  if (wisp.name) drawTextCentered(buf, 3, wisp.name.toUpperCase(), C.title);

  // Motion scales with mood: a happy Wisp roams + hops, a low one barely drifts.
  const live = LIVELINESS[mood.state];
  const pos = (t: number) => ({ x: 64 + (wanderX(t) - 64) * live, y: 40 + (wanderY(t) - 40) * live });
  const hopPhase = frame % 175;
  const hop = (hopPhase < 22 ? -Math.abs(Math.sin(hopPhase * 0.45)) * 7 : 0) * live;
  const here = pos(frame);
  const cx = Math.round(here.x);
  const cy = Math.round(here.y + hop);

  // A faint motion trail behind it.
  for (let k = 3; k >= 1; k--) {
    const p = pos(frame - k * 5);
    buf.set(Math.round(p.x), Math.round(p.y), k === 1 ? C.text : C.dim);
  }

  drawWisp(buf, cx, cy, frame, wispForm(wisp), 1);

  if (mood.state === "sleepy") {
    // Drifting "z z z" above a dozing Wisp.
    "ZZZ".split("").forEach((z, i) => {
      if ((frame + i * 8) % 36 < 24) drawText(buf, cx + 8 + i * 4, cy - 12 - i * 3, z, C.dim);
    });
  } else if ((mood.state === "joyful" || mood.state === "happy") && frame % 240 < 12) {
    // A happy Wisp scatters sparkles now and then.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + frame * 0.2;
      buf.set(cx + Math.round(Math.cos(a) * 16), cy + Math.round(Math.sin(a) * 12), C.textHi);
    }
  }

  buf.fillRect(0, 72, buf.width, 8, C.ground);
  if (highlightLabel) {
    drawTextCentered(buf, 73, highlightLabel, C.title);
    return;
  }
  // Idle: rotate through what the Wisp has to say — its feeling (when notable)
  // and a recent thing it saw on the mesh (DESIGN §2 "shares what it saw").
  const pool: [string, number][] = [];
  if (VOICED.has(mood.state)) {
    for (const l of MOOD_STATE_DEFS[mood.state].lines) pool.push([l, MOOD_STATE_DEFS[mood.state].color]);
  }
  if (sighting) pool.push([`I SAW ${sighting.toUpperCase()}`.slice(0, 21), C.ok]);
  if (pool.length === 0) {
    drawTextCentered(buf, 73, "SELECT TO EXPLORE", C.dim);
  } else {
    const [text, color] = pool[Math.floor(frame / 40) % pool.length];
    drawTextCentered(buf, 73, text, color);
  }
}

function divider(buf: PixelBuffer, y: number): void {
  buf.fillRect(0, y, buf.width, 1, C.dim);
}

function drawItems(buf: PixelBuffer, items: string[], state: NavState, y0: number): void {
  items.forEach((item, i) => {
    const rowY = y0 + i * 7;
    const isCursor = i === state.itemIndex;
    const isSelected = state.selectedItem === i;
    if (isSelected) {
      buf.fillRect(0, rowY - 1, buf.width, 7, C.selBar);
      drawText(buf, 2, rowY, "*", C.selText);
      drawText(buf, 8, rowY, item, C.selText);
    } else {
      if (isCursor) drawText(buf, 2, rowY, ">", C.cursor);
      drawText(buf, 8, rowY, item, isCursor ? C.textHi : C.text);
    }
  });
}

export function drawPlace(buf: PixelBuffer, place: PlaceDef, state: NavState): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, place.label, C.title);
  const tag = place.scope === "local" ? "LOC" : "REL";
  drawText(buf, buf.width - measureText(tag) - 3, 2, tag, place.scope === "local" ? C.tagLocal : C.tagRelay);
  divider(buf, 9);
  drawItems(buf, place.items, state, 13);
  if (state.selectedItem !== null) {
    drawTextCentered(buf, 64, "NOT BUILT YET", C.warn);
    drawTextCentered(buf, 71, "CANCEL TO GO BACK", C.dim);
  }
}

// A titled item list (the Relay's Post/Pages sub-menus, REDESIGN §8).
export function drawSubMenu(buf: PixelBuffer, title: string, items: string[], cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, title, C.title);
  drawText(buf, buf.width - measureText("REL") - 3, 2, "REL", C.tagRelay);
  divider(buf, 9);
  items.forEach((item, i) => {
    const y = 13 + i * 7;
    if (i === cursor) drawText(buf, 2, y, ">", C.cursor);
    drawText(buf, 8, y, item, i === cursor ? C.textHi : C.text);
  });
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT OPEN  CANCEL BACK", C.dim);
}

// PROFILE — who you are: identity + Vault (system config moved to SETTINGS, §1).
export function drawProfile(
  buf: PixelBuffer,
  place: PlaceDef,
  state: NavState,
  identity: { handle: string; fpShort: string } | undefined,
): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, place.label, C.title);
  drawText(buf, buf.width - measureText("LOC") - 3, 2, "LOC", C.tagLocal);
  divider(buf, 9);
  drawItems(buf, place.items, state, 13);

  if (state.selectedItem === null) return;
  const item = place.items[state.selectedItem];
  divider(buf, 45);
  if (item === "IDENTITY" && identity) {
    drawTextCentered(buf, 49, `@${identity.handle}`.slice(0, 18), C.textHi);
    drawTextCentered(buf, 57, identity.fpShort, C.dim);
  } else {
    drawTextCentered(buf, 49, "NOT BUILT YET", C.warn);
    drawTextCentered(buf, 57, "CANCEL TO GO BACK", C.dim);
  }
}

// SETTINGS — system config: sound on/off + the ambient Relay link report (RELAY
// is a status item, not a destination — DESIGN §6.1).
export function drawSettings(
  buf: PixelBuffer,
  place: PlaceDef,
  state: NavState,
  relay: RelayView,
  muted: boolean,
  keyboardEnabled: boolean,
): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, place.label, C.title);
  drawText(buf, buf.width - measureText("LOC") - 3, 2, "LOC", C.tagLocal);
  divider(buf, 9);
  drawItems(buf, place.items, state, 13);

  if (state.selectedItem === null) return;
  const item = place.items[state.selectedItem];
  divider(buf, 45);
  if (item === "SOUND") {
    drawTextCentered(buf, 49, muted ? "SOUND: OFF" : "SOUND: ON", muted ? C.dim : C.ok);
    drawTextCentered(buf, 57, "ACCEPT TO TOGGLE", C.dim);
  } else if (item === "KEYBOARD") {
    drawTextCentered(buf, 49, keyboardEnabled ? "KEYBOARD: ON" : "KEYBOARD: OFF", keyboardEnabled ? C.ok : C.dim);
    drawTextCentered(buf, 57, keyboardEnabled ? "ACCEPT: HIDE FOR BIG SCREEN" : "ACCEPT TO SHOW", C.dim);
  } else if (item === "RELAY") {
    drawTextCentered(buf, 49, relay.statusLabel, relay.online ? C.ok : relay.detail ? C.warn : C.dim);
    if (relay.online) {
      drawTextCentered(buf, 57, `VIA ${relay.via ?? "LINK"}`, C.text);
      if (relay.nodeLabel) drawTextCentered(buf, 65, relay.nodeLabel, C.dim);
    } else if (relay.detail) {
      wrapText(relay.detail, Math.floor((buf.width - 4) / CELL_W)).slice(0, 2)
        .forEach((ln, i) => drawText(buf, 2, 57 + i * 7, ln, C.warn));
    } else {
      drawTextCentered(buf, 57, "ACCEPT TO RECONNECT", C.dim);
    }
  } else {
    drawTextCentered(buf, 49, "NOT BUILT YET", C.warn);
    drawTextCentered(buf, 57, "CANCEL TO GO BACK", C.dim);
  }
}

export function drawEditor(buf: PixelBuffer, frame: number, edit: EditView): void {
  buf.clear(C.bg);
  drawText(buf, 3, 3, edit.label, C.title);
  divider(buf, 11);
  const maxChars = Math.floor((buf.width - 6) / CELL_W);
  const shown = edit.value.length > maxChars ? edit.value.slice(edit.value.length - maxChars) : edit.value;
  const endX = drawText(buf, 3, 22, shown, C.textHi);
  if (Math.floor(frame / 4) % 2 === 0) buf.fillRect(endX, 21, 2, 7, C.cursor);
  drawTextCentered(buf, 70, "ACCEPT OK  CANCEL BACK", C.dim);
}

// The care panel's action order — the WispView cursor indexes this. First the
// six care actions (CARES), then RENAME, STATS, and a dev-only RESET. App's
// handler maps the same indices, so keep the two in lockstep.
export const CARE_ACTION_LABELS = [...CARES.map((c) => CARE_DEFS[c].label), "RENAME", "STATS", "JOURNAL"];
export function careActionCount(canRaise: boolean): number {
  return CARE_ACTION_LABELS.length + (canRaise ? 1 : 0);
}

/** A small filled need-meter bar (0..max) for the care panel. */
function drawBar(buf: PixelBuffer, x: number, y: number, w: number, value: number, color: number): void {
  buf.fillRect(x, y, w, 3, C.ground);
  const fill = Math.round((Math.max(0, Math.min(MOOD_MAX, value)) / MOOD_MAX) * w);
  if (fill > 0) buf.fillRect(x, y, fill, 3, color);
}

const METER_ROWS: { key: keyof MoodSummary; tag: string }[] = [
  { key: "fed", tag: "FED" }, { key: "energy", tag: "ENE" },
  { key: "clean", tag: "CLN" }, { key: "joy", tag: "JOY" },
];

/** The WISP care panel (front): the creature reacting, its mood, and the verbs. */
export function drawWispCare(
  buf: PixelBuffer,
  frame: number,
  wisp: Wisp,
  view: WispView,
  mood: MoodSummary,
  canRaise: boolean,
): void {
  buf.clear(C.bg);
  const state = MOOD_STATE_DEFS[mood.state];
  drawText(buf, 3, 2, wisp.name ? wisp.name.toUpperCase() : "UNNAMED", C.title);
  drawText(buf, buf.width - measureText(state.label) - 3, 2, state.label, state.color);
  divider(buf, 9);

  // The creature, tinted by mood; livelier when happy, still when low.
  const form = wispForm(wisp);
  const lively = mood.state === "joyful" || mood.state === "happy";
  const bob = lively ? Math.round(Math.sin(frame * 0.12) * 2) : 0;
  drawWisp(buf, 22, 24 + bob, frame, { ...form, color: state.color }, 0.6);
  if (mood.state === "joyful" && frame % 30 < 14) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + frame * 0.2;
      buf.set(22 + Math.round(Math.cos(a) * 13), 24 + Math.round(Math.sin(a) * 11), C.textHi);
    }
  }

  // Need meters on the right.
  METER_ROWS.forEach((m, i) => {
    const y = 13 + i * 6;
    drawText(buf, 44, y, m.tag, C.dim);
    drawBar(buf, 64, y + 1, 56, mood[m.key] as number, state.color);
  });
  divider(buf, 39);

  // Care verbs, two columns.
  const labels = [...CARE_ACTION_LABELS, ...(canRaise ? ["RESET"] : [])];
  labels.forEach((label, i) => {
    const col = i % 2;
    const x = col === 0 ? 4 : 66;
    const y = 43 + Math.floor(i / 2) * 7;
    const hi = i === view.cursor;
    if (hi) drawText(buf, x, y, ">", C.cursor);
    const isReset = label === "RESET";
    drawText(buf, x + 6, y, label, hi ? (isReset ? C.warn : C.textHi) : isReset ? C.dim : C.text);
  });
}

/** The WISP stats panel: the creature, its form, age, and the five hearts. */
export function drawWispStats(buf: PixelBuffer, frame: number, wisp: Wisp): void {
  buf.clear(C.bg);
  const form = wispForm(wisp);
  drawText(buf, 3, 2, wisp.name ? wisp.name.toUpperCase() : "UNNAMED", C.title);
  drawText(buf, buf.width - measureText(TIER_NAMES[form.tier]) - 3, 2, TIER_NAMES[form.tier], C.text);
  divider(buf, 9);

  // Creature + identity along the top.
  drawWisp(buf, 14, 22, frame, form, 0.55);
  drawText(buf, 28, 14, form.name.toUpperCase(), C.textHi);
  drawText(buf, 28, 22, `DAY ${wispAgeDays(wisp)}`, C.dim);
  divider(buf, 31);

  // Five Hearts (earned by participation — never by care).
  HEARTS.forEach((heart, i) => {
    const def = HEART_DEFS[heart];
    const y = 35 + i * 6;
    drawText(buf, 7, y, def.tag, def.color);
    drawHeartMeter(buf, 14, y, wisp.hearts[heart], THRESHOLD.beacon, def.color);
  });
  drawTextCentered(buf, 73, "CANCEL BACK TO CARE", C.dim);
}

/** Short relative age, e.g. "NOW", "5M", "2H", "3D". */
function ago(ms: number): string {
  if (ms < 60_000) return "NOW";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}M`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}H`;
  return `${Math.floor(ms / 86_400_000)}D`;
}

/** The WISP journal: what the Wisp saw while it lived its life (DESIGN §2). */
export function drawWispJournal(buf: PixelBuffer, discoveries: Discovery[], now: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "WHAT I SAW", C.title);
  divider(buf, 9);
  if (discoveries.length === 0) {
    drawTextCentered(buf, 30, "NOTHING YET", C.dim);
    drawTextCentered(buf, 40, "THE WISP IS WATCHING", C.dim);
  } else {
    // Newest first; the Wisp recounts its recent sightings.
    [...discoveries].reverse().slice(0, 8).forEach((d, i) => {
      const y = 13 + i * 7;
      const age = ago(Math.max(0, now - d.at));
      drawText(buf, 2, y, "-", d.kind === "station" ? C.tagRelay : C.ok);
      drawText(buf, 7, y, d.name.toUpperCase().slice(0, 16), C.text);
      drawText(buf, buf.width - measureText(age) - 3, y, age, C.dim);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "CANCEL BACK TO CARE", C.dim);
}

/** PAGES → MY PAGE: edit your small Traveler Page (tagline + about). */
export function drawPageMine(buf: PixelBuffer, page: TravelerPage, view: PageView): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "MY PAGE", C.title);
  drawText(buf, buf.width - measureText("MINE") - 3, 2, "MINE", C.tagLocal);
  divider(buf, 9);

  const tagHi = view.cursor === 0;
  if (tagHi) drawText(buf, 1, 13, ">", C.cursor);
  drawText(buf, 7, 13, "TAGLINE", tagHi ? C.textHi : C.text);
  drawText(buf, 7, 21, page.tagline || "(none yet)", page.tagline ? C.ok : C.dim);

  const aboutHi = view.cursor === 1;
  if (aboutHi) drawText(buf, 1, 33, ">", C.cursor);
  drawText(buf, 7, 33, "ABOUT", aboutHi ? C.textHi : C.text);
  const lines = page.about ? wrapText(page.about, Math.floor((buf.width - 8) / CELL_W)) : ["(say hi to the Relay)"];
  lines.slice(0, 4).forEach((ln, i) => drawText(buf, 7, 41 + i * 7, ln, page.about ? C.text : C.dim));

  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT EDIT  CANCEL BACK", C.dim);
}

/** PAGES → BROWSE: pick a reachable Traveler whose page to fetch. */
export function drawPageBrowse(buf: PixelBuffer, list: { handle: string }[], cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "BROWSE PAGES", C.title);
  drawText(buf, buf.width - measureText("REL") - 3, 2, "REL", C.tagRelay);
  divider(buf, 9);
  if (list.length === 0) {
    drawTextCentered(buf, 30, "NOBODY AROUND", C.dim);
    drawTextCentered(buf, 40, "PAGES NEED A TRAVELER", C.dim);
  } else {
    list.slice(0, 8).forEach((it, i) => {
      const y = 13 + i * 7;
      const hi = i === cursor;
      if (hi) drawText(buf, 1, y, ">", C.cursor);
      drawText(buf, 7, y, it.handle.toUpperCase().slice(0, 20), hi ? C.textHi : C.text);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT VIEW  CANCEL BACK", C.dim);
}

/** PAGES → VIEW: read a fetched Traveler Page (or wait for it to arrive). */
export function drawPageView(buf: PixelBuffer, page: PageMsg | null): void {
  buf.clear(C.bg);
  if (!page) {
    drawText(buf, 3, 2, "PAGE", C.title);
    divider(buf, 9);
    drawTextCentered(buf, 34, "FETCHING...", C.dim);
    drawTextCentered(buf, 44, "(MUST BE REACHABLE)", C.dim);
    return;
  }
  drawText(buf, 3, 2, page.handle.toUpperCase().slice(0, 16), C.title);
  drawText(buf, buf.width - measureText("PAGE") - 3, 2, "PAGE", C.tagRelay);
  divider(buf, 9);
  drawText(buf, 3, 14, page.tagline || "(no tagline)", page.tagline ? C.ok : C.dim);
  divider(buf, 22);
  const lines = page.about ? wrapText(page.about, Math.floor((buf.width - 6) / CELL_W)) : ["(no about yet)"];
  lines.slice(0, 6).forEach((ln, i) => drawText(buf, 3, 28 + i * 7, ln, page.about ? C.text : C.dim));
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT SIGN  CANCEL BACK", C.dim);
}

/** PAGES → GUESTBOOK: short public notes visitors have left on your page. */
export function drawPageGuestbook(buf: PixelBuffer, entries: GuestEntry[]): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "GUESTBOOK", C.title);
  drawText(buf, buf.width - measureText("MINE") - 3, 2, "MINE", C.tagLocal);
  divider(buf, 9);
  if (entries.length === 0) {
    drawTextCentered(buf, 30, "NO SIGNATURES YET", C.dim);
    drawTextCentered(buf, 40, "SHARE YOUR PAGE!", C.dim);
  } else {
    const maxChars = Math.floor((buf.width - 4) / CELL_W);
    [...entries].reverse().slice(0, 8).forEach((e, i) => {
      drawText(buf, 2, 13 + i * 7, `${e.handle}: ${e.text}`.toUpperCase().slice(0, maxChars), i === 0 ? C.ok : C.text);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "CANCEL BACK", C.dim);
}

/** THE EXCHANGE: Carts you hold (yours + received), runnable. */
export function drawExchange(buf: PixelBuffer, list: { name: string; author: string }[], cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "THE EXCHANGE", C.title);
  divider(buf, 9);
  if (list.length === 0) {
    drawTextCentered(buf, 34, "NO CARTS YET", C.dim);
  } else {
    list.slice(0, 8).forEach((it, i) => {
      const y = 13 + i * 7;
      const hi = i === cursor;
      if (hi) drawText(buf, 1, y, ">", C.cursor);
      drawText(buf, 7, y, it.name.toUpperCase().slice(0, 12), hi ? C.textHi : C.text);
      const by = it.author.toUpperCase().slice(0, 8);
      drawText(buf, buf.width - measureText(by) - 3, y, by, C.dim);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT RUN  CANCEL BACK", C.dim);
}

/** PROFILE → VAULT: encrypted backup/restore to a Station. */
export function drawVault(buf: PixelBuffer, view: VaultView, status: ScreenModel["vaultStatus"]): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "ACCOUNT VAULT", C.title);
  drawText(buf, buf.width - measureText("STN") - 3, 2, "STN", C.tagRelay);
  divider(buf, 9);
  [["BACK UP", 0], ["RESTORE", 1]].forEach(([label, i]) => {
    const y = 16 + (i as number) * 9;
    const hi = view.cursor === i;
    if (hi) drawText(buf, 1, y, ">", C.cursor);
    drawText(buf, 7, y, label as string, hi ? C.textHi : C.text);
  });
  divider(buf, 38);
  const msg = status === "backed-up" ? "BACKED UP TO STATION"
    : status === "requesting" ? "FETCHING VAULT..."
    : status === "restored" ? "RESTORED!"
    : "ENCRYPTED ON-DEVICE";
  drawTextCentered(buf, 46, msg, status === "restored" || status === "backed-up" ? C.ok : C.dim);
  drawTextCentered(buf, 56, "ONLY YOU CAN DECRYPT IT", C.dim);
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "SELECT move  ACCEPT do  CANCEL back", C.dim);
}

/** THE POST → INBOX: received mail (newest first), unread marked. */
export function drawMailInbox(buf: PixelBuffer, inbox: InboxMail[], cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "INBOX", C.title);
  divider(buf, 9);
  if (inbox.length === 0) {
    drawTextCentered(buf, 34, "NO MAIL YET", C.dim);
  } else {
    const maxChars = Math.floor((buf.width - 10) / CELL_W);
    [...inbox].reverse().slice(0, 8).forEach((m, i) => {
      const y = 13 + i * 7;
      const hi = i === cursor;
      if (hi) drawText(buf, 1, y, ">", C.cursor);
      if (!m.read) drawText(buf, 7, y, "*", C.ok);
      drawText(buf, 12, y, `${m.handle}: ${m.text}`.toUpperCase().slice(0, maxChars), hi ? C.textHi : m.read ? C.text : C.ok);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT READ  CANCEL BACK", C.dim);
}

/** THE POST → READ: one mail, full text. */
export function drawMailRead(buf: PixelBuffer, mail: InboxMail | null): void {
  buf.clear(C.bg);
  if (!mail) { drawTextCentered(buf, 34, "MAIL GONE", C.dim); return; }
  drawText(buf, 3, 2, `FROM ${mail.handle}`.toUpperCase().slice(0, 18), C.title);
  divider(buf, 9);
  wrapText(mail.text, Math.floor((buf.width - 6) / CELL_W)).slice(0, 7)
    .forEach((ln, i) => drawText(buf, 3, 16 + i * 7, ln, C.text));
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "CANCEL BACK", C.dim);
}

/** THE POST → COMPOSE: pick who to write to (your buddies). */
export function drawMailPick(buf: PixelBuffer, list: { handle: string }[], cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "MAIL TO", C.title);
  divider(buf, 9);
  if (list.length === 0) {
    drawTextCentered(buf, 30, "NO BUDDIES YET", C.dim);
    drawTextCentered(buf, 40, "ADD ONE IN TRAVELERS", C.dim);
  } else {
    list.slice(0, 8).forEach((it, i) => {
      const y = 13 + i * 7;
      const hi = i === cursor;
      if (hi) drawText(buf, 1, y, ">", C.cursor);
      drawText(buf, 7, y, it.handle.toUpperCase().slice(0, 20), hi ? C.textHi : C.text);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT WRITE  CANCEL BACK", C.dim);
}

/** THE POST → OUTBOX: queued mail; ✓ delivered, … still waiting for a Station/peer. */
export function drawMailOutbox(buf: PixelBuffer, outbox: OutboxMail[]): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "OUTBOX", C.title);
  divider(buf, 9);
  if (outbox.length === 0) {
    drawTextCentered(buf, 34, "NOTHING QUEUED", C.dim);
  } else {
    const maxChars = Math.floor((buf.width - 14) / CELL_W);
    [...outbox].reverse().slice(0, 8).forEach((m, i) => {
      const y = 13 + i * 7;
      drawText(buf, 2, y, m.delivered ? "OK" : "..", m.delivered ? C.ok : C.warn);
      drawText(buf, 16, y, `${m.handle}: ${m.text}`.toUpperCase().slice(0, maxChars), C.text);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "CANCEL BACK", C.dim);
}

/** FRIENDS — buddy list (added first, then nearby with an ADD hint). */
export function drawFriends(buf: PixelBuffer, v: FriendsView): void {
  if (v.thread) {
    drawDmThread(buf, v.thread);
    return;
  }
  buf.clear(C.bg);
  drawText(buf, 3, 2, "TRAVELERS", C.title);
  drawText(buf, buf.width - measureText("REL") - 3, 2, "REL", C.tagRelay);
  divider(buf, 9);
  if (v.list.length === 0) {
    drawTextCentered(buf, 30, "NOBODY AROUND YET", C.dim);
    drawTextCentered(buf, 40, "WAITING FOR PRESENCE", C.dim);
  } else {
    v.list.slice(0, 8).forEach((it, i) => {
      const y = 13 + i * 7;
      const hi = i === v.cursor;
      if (hi) drawText(buf, 1, y, ">", C.cursor);
      drawText(buf, 7, y, it.handle.toUpperCase().slice(0, 14), hi ? C.textHi : it.kind === "buddy" ? C.text : C.ok);
      // Not-yet-added Travelers show how they were heard + an ADD hint.
      if (it.kind === "nearby") {
        const tag = it.via === "relay" ? "RELAY" : "NEAR";
        drawText(buf, buf.width - measureText(`${tag} +`) - 3, y, `${tag} +`, it.via === "relay" ? C.tagRelay : C.ok);
      }
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT ADD/OPEN  CANCEL BACK", C.dim);
}

function drawDmThread(buf: PixelBuffer, thread: NonNullable<FriendsView["thread"]>): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, thread.title.slice(0, 16), C.title);
  // Chat is live only while the buddy is reachable (DESIGN §4.4).
  const tag = thread.reachable ? "DM" : "OFFLINE";
  drawText(buf, buf.width - measureText(tag) - 3, 2, tag, thread.reachable ? C.tagRelay : C.warn);
  divider(buf, 9);
  if (thread.messages.length === 0) {
    drawTextCentered(buf, 34, "ENCRYPTED - SAY HI", C.dim);
  } else {
    const maxChars = Math.floor((buf.width - 4) / CELL_W);
    thread.messages.slice(-7).forEach((m, i) => {
      const line = `${m.out ? ">" : "<"}${m.text}`;
      drawText(buf, 2, 12 + i * 7, line.slice(0, maxChars), m.out ? C.textHi : C.ok);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  // Unreachable → offer Mail instead (never silently convert Chat to Mail).
  if (thread.reachable) {
    drawTextCentered(buf, 73, "ACCEPT WRITE  CANCEL BACK", C.dim);
  } else {
    drawTextCentered(buf, 66, "TRAVELER UNAVAILABLE", C.warn);
    drawTextCentered(buf, 73, "ACCEPT = SEND AS MAIL", C.dim);
  }
}

// Compact service letters for a Station row, e.g. "RMPC" (Repeat/Mail/Pages/Commons).
function serviceLetters(services: number): string {
  return [
    [SERVICE.REPEAT, "R"], [SERVICE.MAIL, "M"], [SERVICE.PAGES, "P"],
    [SERVICE.COMMONS, "C"], [SERVICE.VAULT, "V"], [SERVICE.GATEWAY, "G"],
  ].filter(([bit]) => services & (bit as number)).map(([, l]) => l).join("");
}

/** THE COMMONS → STATIONS: discovered Stations + their services (travel surface). */
export function drawStations(buf: PixelBuffer, list: StationRow[]): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "STATIONS", C.title);
  drawText(buf, buf.width - measureText("REL") - 3, 2, "REL", C.tagRelay);
  divider(buf, 9);
  if (list.length === 0) {
    drawTextCentered(buf, 30, "NO STATIONS HEARD", C.dim);
    drawTextCentered(buf, 40, "THE RELAY RUNS WITHOUT THEM", C.dim);
  } else {
    list.slice(0, 6).forEach((s, i) => {
      const y = 13 + i * 9;
      drawText(buf, 2, y, s.name.toUpperCase().slice(0, 12), C.ok);
      const via = s.hops === 0 ? "NEAR" : "RLY";
      drawText(buf, buf.width - measureText(via) - 3, y, via, s.hops === 0 ? C.ok : C.tagRelay);
      drawText(buf, 78, y, serviceLetters(s.services), C.dim);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "CANCEL back", C.dim);
}

// ---- The Relay carousel (scene picker) — REDESIGN §8 -----------------------
// A single framed icon-card centered in the matrix; SELECT slides it off to the
// left while the next card slides in from the right. A row of dots shows where
// you are in the ring of five scenes.

/** A hollow 1px rectangle outline. */
function boxOutline(buf: PixelBuffer, x: number, y: number, w: number, h: number, color: number): void {
  buf.fillRect(x, y, w, 1, color);
  buf.fillRect(x, y + h - 1, w, 1, color);
  buf.fillRect(x, y, 1, h, color);
  buf.fillRect(x + w - 1, y, 1, h, color);
}

// Each scene's little glyph, drawn centered on (cx, cy) within ~±11px.
type Glyph = (buf: PixelBuffer, cx: number, cy: number, color: number) => void;

const glyphCommons: Glyph = (buf, cx, cy, c) => {
  boxOutline(buf, cx - 11, cy - 8, 22, 13, c); // speech bubble
  buf.set(cx - 6, cy + 5, c); buf.set(cx - 5, cy + 6, c); buf.set(cx - 4, cy + 5, c); // tail
  buf.fillRect(cx - 7, cy - 4, 14, 1, c);
  buf.fillRect(cx - 7, cy - 1, 9, 1, c);
};
const glyphTravelers: Glyph = (buf, cx, cy, c) => {
  buf.fillCircle(cx - 5, cy - 5, 2, c); buf.fillRect(cx - 7, cy - 1, 5, 8, c); // left figure
  buf.fillCircle(cx + 5, cy - 3, 2, c); buf.fillRect(cx + 3, cy + 1, 5, 6, c); // right figure
};
const glyphPost: Glyph = (buf, cx, cy, c) => {
  boxOutline(buf, cx - 11, cy - 7, 22, 14, c); // envelope
  for (let i = 0; i <= 10; i++) { buf.set(cx - 11 + i, cy - 7 + i, c); buf.set(cx + 11 - i, cy - 7 + i, c); } // flap
};
const glyphPages: Glyph = (buf, cx, cy, c) => {
  boxOutline(buf, cx - 8, cy - 9, 16, 18, c); // document
  buf.fillRect(cx - 5, cy - 5, 10, 1, c);
  buf.fillRect(cx - 5, cy - 2, 10, 1, c);
  buf.fillRect(cx - 5, cy + 1, 10, 1, c);
  buf.fillRect(cx - 5, cy + 4, 6, 1, c);
};
const glyphStations: Glyph = (buf, cx, cy, c) => {
  buf.fillRect(cx - 1, cy - 6, 2, 14, c); // mast
  for (let i = 0; i < 5; i++) { buf.set(cx - 2 - i, cy + 4 + i, c); buf.set(cx + 1 + i, cy + 4 + i, c); } // legs
  buf.set(cx - 4, cy - 7, c); buf.set(cx - 5, cy - 6, c); // broadcast arcs
  buf.set(cx + 4, cy - 7, c); buf.set(cx + 5, cy - 6, c);
  buf.set(cx - 6, cy - 9, c); buf.set(cx + 6, cy - 9, c);
};

const glyphBreakout: Glyph = (buf, cx, cy, c) => {
  buf.fillRect(cx - 10, cy - 9, 21, 2, c); // brick rows
  buf.fillRect(cx - 10, cy - 6, 21, 2, c);
  buf.fillCircle(cx + 2, cy + 1, 1, c); // ball
  buf.fillRect(cx - 5, cy + 7, 11, 2, c); // paddle
};
const glyphTicTac: Glyph = (buf, cx, cy, c) => {
  buf.fillRect(cx - 3, cy - 9, 1, 18, c); // grid #
  buf.fillRect(cx + 3, cy - 9, 1, 18, c);
  buf.fillRect(cx - 9, cy - 3, 18, 1, c);
  buf.fillRect(cx - 9, cy + 3, 18, 1, c);
  buf.set(cx - 8, cy - 8, c); buf.set(cx - 6, cy - 6, c); buf.set(cx - 8, cy - 6, c); buf.set(cx - 6, cy - 8, c); // X
  buf.fillCircle(cx + 6, cy + 6, 2, c); buf.set(cx + 6, cy + 6, c === 0 ? c : 1); // O ring
};

export interface CarouselCard { label: string; glyph: Glyph }

const RELAY_CARDS: CarouselCard[] = [
  { label: "COMMONS", glyph: glyphCommons },
  { label: "TRAVELERS", glyph: glyphTravelers },
  { label: "THE POST", glyph: glyphPost },
  { label: "PAGES", glyph: glyphPages },
  { label: "STATIONS", glyph: glyphStations },
];

const ARCADE_CARDS: CarouselCard[] = [
  { label: "BREAKOUT", glyph: glyphBreakout },
  { label: "TIC-TAC-TOE", glyph: glyphTicTac },
];

function drawCarouselCard(buf: PixelBuffer, cx: number, card: CarouselCard, active: boolean): void {
  const x = Math.round(cx);
  const frame = active ? C.title : C.dim;
  const inner = active ? C.text : C.dim;
  const glyphC = active ? C.textHi : C.dim;
  boxOutline(buf, x - 24, 14, 48, 48, frame); // outer
  boxOutline(buf, x - 17, 18, 34, 26, inner); // inner (holds the glyph)
  card.glyph(buf, x, 31, glyphC);
  const lx = x - Math.floor(measureText(card.label) / 2);
  drawText(buf, lx, 51, card.label, frame);
}

const SLIDE_MS = 400;
const SLIDE_PITCH = 120; // how far a card travels off-screen

/** A framed icon-card carousel: one card centered, SELECT slides to the next.
 *  Used for the Relay scene picker and the Arcade game picker (REDESIGN §8). */
export function drawCarousel(
  buf: PixelBuffer,
  header: string,
  info: string,
  cards: CarouselCard[],
  index: number,
  slideAt: number,
): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, header, C.title);
  if (info) drawText(buf, buf.width - measureText(info) - 3, 2, info, C.ok);
  divider(buf, 9);

  const n = cards.length;
  const p = slideAt ? Math.min(1, (Date.now() - slideAt) / SLIDE_MS) : 1;
  if (p < 1 && n > 1) {
    // SELECT always advances forward: the previous card slides out left, the
    // new current card slides in from the right.
    const prev = (index - 1 + n) % n;
    drawCarouselCard(buf, 64 - p * SLIDE_PITCH, cards[prev], false);
    drawCarouselCard(buf, 64 + (1 - p) * SLIDE_PITCH, cards[index], true);
  } else {
    drawCarouselCard(buf, 64, cards[index], true);
  }

  // Position dots.
  const gap = 9;
  const x0 = 64 - ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    buf.fillCircle(Math.round(x0 + i * gap), 68, i === index ? 2 : 1, i === index ? C.cursor : C.dim);
  }
}

/** THE COMMONS — a public chatroom log with a live presence count; ACCEPT writes. */
export function drawChat(buf: PixelBuffer, v: ChatView): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, v.title.slice(0, 14), C.title);
  // Signs of life: how many Travelers are around right now (+ any Stations).
  const here = (v.present > 0 ? `${v.present} HERE` : "QUIET") + (v.stations > 0 ? ` +${v.stations}ST` : "");
  drawText(buf, buf.width - measureText(here) - 3, 2, here, v.present > 0 || v.stations > 0 ? C.ok : C.dim);
  divider(buf, 9);
  if (v.messages.length === 0) {
    drawTextCentered(buf, 30, v.present > 0 ? `${v.present} TRAVELER${v.present > 1 ? "S" : ""} HERE` : "QUIET HERE", v.present > 0 ? C.ok : C.dim);
    drawTextCentered(buf, 40, "ACCEPT TO WRITE", C.dim);
  } else {
    const maxChars = Math.floor((buf.width - 4) / CELL_W);
    v.messages.slice(-7).forEach((m, i) => {
      drawText(buf, 2, 12 + i * 7, `${m.who}:${m.text}`.slice(0, maxChars), m.mine ? C.textHi : C.text);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT WRITE  CANCEL BACK", C.dim);
}

// ---- The Workshop: on-LCD Lua editor (REDESIGN §Making) --------------------

/** WORKSHOP → MY CARTS: your authored carts + "+ NEW CART", to open in the editor. */
export function drawWorkshopList(buf: PixelBuffer, cartNames: string[], cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "WORKSHOP", C.title);
  drawText(buf, buf.width - measureText("LOC") - 3, 2, "LOC", C.tagLocal);
  divider(buf, 9);
  const rows = ["+ NEW CART", ...cartNames];
  rows.slice(0, 9).forEach((name, i) => {
    const y = 12 + i * 7;
    if (i === cursor) drawText(buf, 2, y, ">", C.cursor);
    drawText(buf, 8, y, name.slice(0, 28), i === cursor ? C.textHi : (i === 0 ? C.ok : C.text));
  });
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT OPEN  CANCEL BACK", C.dim);
}

/** WORKSHOP editor: the code on the matrix with a blinking caret + scroll. */
export function drawWorkshopEditor(buf: PixelBuffer, frame: number, doc: CartDoc): void {
  buf.clear(C.bg);
  const title = `EDIT ${doc.name}${doc.dirty ? " *" : ""}`;
  drawText(buf, 2, 1, title.slice(0, 26), C.title);
  const { row, col } = caretRowCol(doc.code, doc.caret);
  const rc = `${row + 1}:${col}`;
  drawText(buf, buf.width - measureText(rc) - 2, 1, rc, C.dim);

  const ls = lines(doc.code);
  const top = 9;
  const rowH = CELL_H; // 6px — denser than menus so ~10 code lines fit
  const visRows = Math.floor((72 - top) / rowH);
  const firstRow = row >= visRows ? row - visRows + 1 : 0;
  const maxCols = Math.floor((buf.width - 4) / CELL_W);
  const colOff = col >= maxCols ? col - maxCols + 1 : 0;
  for (let i = 0; i < visRows; i++) {
    const r = firstRow + i;
    if (r >= ls.length) break;
    const text = ls[r].slice(colOff, colOff + maxCols);
    drawText(buf, 2, top + i * rowH, text, r === row ? C.text : C.dim);
  }
  // Blinking caret bar at the caret's on-screen cell.
  if (Math.floor(frame / 4) % 2 === 0) {
    buf.fillRect(2 + (col - colOff) * CELL_W, top + (row - firstRow) * rowH, 1, 5, C.cursor);
  }
  buf.fillRect(0, 73, buf.width, 7, C.ground);
  drawTextCentered(buf, 74, "SEL/ACC MOVE  CANCEL MENU", C.dim);
}

/** WORKSHOP command palette (over the editor): run/save/help/rename/delete/share/exit. */
export function drawWorkshopMenu(buf: PixelBuffer, cursor: number): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, "CART MENU", C.title);
  divider(buf, 9);
  WORKSHOP_MENU.forEach((item, i) => {
    const y = 12 + i * 8;
    if (i === cursor) drawText(buf, 2, y, ">", C.cursor);
    drawText(buf, 8, y, item, i === cursor ? C.textHi : C.text);
  });
  drawTextCentered(buf, 74, "ACCEPT DO  CANCEL BACK", C.dim);
}

// WORKSHOP API cheat-sheet — paged (SELECT flips). C = color 0-15.
const HELP_PAGES: string[][] = [
  [
    "DRAW  (C = COLOR 0-15)",
    "CLS(C)  PSET(X,Y,C)",
    "PGET(X,Y)",
    "LINE(X0,Y0,X1,Y1,C)",
    "RECT(X,Y,W,H,C)",
    "RECTFILL(X,Y,W,H,C)",
    "CIRC(X,Y,R,C)",
    "CIRCFILL(X,Y,R,C)",
    "PRINT(S,X,Y,C)",
    "SPR(X,Y,ROWS,SCALE)",
  ],
  [
    "INPUT  SOUND  LUA",
    "BTN(B)  BTNP(B)",
    " 0=SEL 1=ACC 2=CNL",
    "BEEP(FREQ,DUR,WAVE)",
    "FLR(N)  RND(N)",
    "W=128 H=80  FRAME",
    "CALLBACKS:",
    " _INIT _UPDATE _DRAW",
    "SPR ROWS={\"08\",\"80\"}",
    " HEX=COLOR . =CLEAR",
  ],
];

/** WORKSHOP API cheat-sheet (the sandbox functions you can call). */
export function drawWorkshopHelp(buf: PixelBuffer, page: number): void {
  buf.clear(C.bg);
  const p = ((page % HELP_PAGES.length) + HELP_PAGES.length) % HELP_PAGES.length;
  drawText(buf, 3, 1, "API REFERENCE", C.title);
  drawText(buf, buf.width - measureText(`${p + 1}/${HELP_PAGES.length}`) - 3, 1, `${p + 1}/${HELP_PAGES.length}`, C.dim);
  divider(buf, 8);
  HELP_PAGES[p].forEach((ln, i) => drawText(buf, 2, 11 + i * 6, ln, i === 0 ? C.ok : C.text));
  buf.fillRect(0, 73, buf.width, 7, C.ground);
  drawTextCentered(buf, 74, "SELECT PAGE  CANCEL BACK", C.dim);
}

/** A full-screen Cart error (compile failure in the Workshop preview). */
export function drawCartError(buf: PixelBuffer, msg: string): void {
  buf.clear(C.bg);
  drawText(buf, 3, 3, "CART ERROR", C.warn);
  divider(buf, 11);
  wrapText(msg.toUpperCase(), Math.floor((buf.width - 4) / CELL_W)).slice(0, 7)
    .forEach((ln, i) => drawText(buf, 2, 16 + i * 7, ln, C.text));
  drawTextCentered(buf, 73, "CANCEL BACK TO EDITOR", C.dim);
}

/** A one-line runtime-error banner overlaid on a running preview. */
export function drawErrorBanner(buf: PixelBuffer, msg: string): void {
  buf.fillRect(0, 73, buf.width, 7, C.warn);
  drawText(buf, 2, 74, msg.toUpperCase().slice(0, Math.floor((buf.width - 4) / CELL_W)), C.selText);
}

export function drawScreen(buf: PixelBuffer, frame: number, model: ScreenModel): void {
  if (model.editing) {
    drawEditor(buf, frame, model.editing);
    return;
  }
  if (model.workshop) {
    const w = model.workshop;
    if (w.mode === "list") drawWorkshopList(buf, model.myCartNames ?? [], w.cursor);
    else if (w.mode === "edit") drawWorkshopEditor(buf, frame, w.doc);
    else if (w.mode === "menu") drawWorkshopMenu(buf, w.cursor);
    else drawWorkshopHelp(buf, w.page);
    return;
  }
  if (model.wispView) {
    if (model.wispView.panel === "stats") drawWispStats(buf, frame, model.wisp);
    else if (model.wispView.panel === "journal") drawWispJournal(buf, model.discoveries, Date.now());
    else drawWispCare(buf, frame, model.wisp, model.wispView, model.wispMood, model.canRaise);
    return;
  }
  if (model.pageView) {
    if (model.pageView.panel === "browse") drawPageBrowse(buf, model.pageBrowse, model.pageView.cursor);
    else if (model.pageView.panel === "view") drawPageView(buf, model.pageViewed);
    else if (model.pageView.panel === "guestbook") drawPageGuestbook(buf, model.myGuestbook);
    else drawPageMine(buf, model.myPage, model.pageView);
    return;
  }
  if (model.postView) {
    if (model.postView.panel === "read") drawMailRead(buf, model.mailRead);
    else if (model.postView.panel === "pick") drawMailPick(buf, model.mailPick, model.postView.cursor);
    else if (model.postView.panel === "outbox") drawMailOutbox(buf, model.outbox);
    else drawMailInbox(buf, model.inbox, model.postView.cursor);
    return;
  }
  if (model.vaultView) {
    drawVault(buf, model.vaultView, model.vaultStatus);
    return;
  }
  if (model.exchangeView) {
    drawExchange(buf, model.cartList, model.exchangeView.cursor);
    return;
  }
  const { nav } = model;
  if (nav.level === "home") {
    drawCompanion(
      buf, frame, model.wisp, model.wispMood,
      nav.iconIndex !== null ? PLACES[nav.iconIndex].label : undefined,
      model.muted, model.relay.online, model.nearbyCount, model.sighting,
    );
    return;
  }
  const place = currentPlace(nav);
  if (place.id === "relay") {
    // The Relay's scenes (REDESIGN §8) — Commons/Travelers/Stations are live
    // surfaces; The Post/Pages open a sub-menu; null = the scene picker.
    if (model.relayScene === "travelers" && model.friends) drawFriends(buf, model.friends);
    else if (model.relayScene === "commons" && model.chat) drawChat(buf, model.chat);
    else if (model.relayScene === "stations") drawStations(buf, model.stationList);
    else if ((model.relayScene === "post" || model.relayScene === "pages") && model.relaySub) {
      drawSubMenu(buf, model.relaySub.title, model.relaySub.items, model.relaySub.cursor);
    } else {
      const info = (model.nearbyCount > 0 ? `${model.nearbyCount} NEAR` : "QUIET")
        + (model.stationList.length > 0 ? ` ${model.stationList.length}ST` : "");
      drawCarousel(buf, "THE RELAY", info, RELAY_CARDS, nav.itemIndex, model.carouselSlideAt ?? 0);
    }
    return;
  }
  if (place.id === "arcade") drawCarousel(buf, "ARCADE", "", ARCADE_CARDS, nav.itemIndex, model.carouselSlideAt ?? 0);
  else if (place.id === "profile") drawProfile(buf, place, nav, model.identityLabel);
  else if (place.id === "settings") drawSettings(buf, place, nav, model.relay, model.muted, model.keyboardEnabled ?? true);
  else drawPlace(buf, place, nav);
}
