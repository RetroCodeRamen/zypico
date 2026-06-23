// Everything the user sees is drawn here, inside the 128×80 dot matrix (the
// user's directive: "all menus render inside the screen"). drawScreen() reads a
// small view model and paints the companion home (with ambient activity stars +
// connection glyph), a place menu, a live surface (Commons / Travelers / Wisp /
// Profile), the text-entry field, or the Wisp detail. Pure buffer drawing — no DOM.

import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import { CELL_W, drawText, drawTextCentered, measureText } from "@ui/pixel/font.ts";
import { currentPlace, PLACES, type NavState, type PlaceDef } from "@ui/shell/nav.ts";
import {
  HEART_DEFS,
  HEARTS,
  THRESHOLD,
  TIER_NAMES,
  wispAgeDays,
  wispForm,
  type Wisp,
} from "@core/companion/index.ts";
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

/** Detail view for the WISP Place. `cursor` 0–4 selects a heart to raise, 5 = name. */
export interface WispView {
  cursor: number;
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
  /** TRAVELERS screen state (buddy list + open DM thread), when in that place. */
  friends?: FriendsView;
  /** COMMONS chatroom state, when in that place. */
  chat?: ChatView;
  /** Whether the test-only "raise a heart" action is available (dev builds). */
  canRaise: boolean;
  /** Sound muted (shown as a small indicator on home). */
  muted: boolean;
  /** Reachable Travelers right now — drives the home activity stars (§6.4). */
  nearbyCount: number;
}

export interface FriendsView {
  list: { kind: "buddy" | "nearby"; handle: string; fingerprint: string }[];
  cursor: number;
  thread: { title: string; messages: { out: boolean; text: string }[] } | null;
}

export interface ChatView {
  title: string;
  messages: { mine: boolean; who: string; text: string }[];
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

/** The companion home: the Wisp wandering, its name above, the idle hint below. */
export function drawCompanion(
  buf: PixelBuffer,
  frame: number,
  wisp: Wisp,
  highlightLabel?: string,
  muted?: boolean,
  online?: boolean,
  nearbyCount = 0,
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

  // Occasional little hop ("doing things"): a couple of bounces now and then.
  const hopPhase = frame % 175;
  const hop = hopPhase < 22 ? -Math.abs(Math.sin(hopPhase * 0.45)) * 7 : 0;
  const cx = Math.round(wanderX(frame));
  const cy = Math.round(wanderY(frame) + hop);

  // A faint motion trail behind it.
  for (let k = 3; k >= 1; k--) {
    buf.set(Math.round(wanderX(frame - k * 5)), Math.round(wanderY(frame - k * 5)), k === 1 ? C.text : C.dim);
  }

  drawWisp(buf, cx, cy, frame, wispForm(wisp), 1);

  // Now and then it scatters a few sparkles around itself.
  if (frame % 240 < 12) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + frame * 0.2;
      buf.set(cx + Math.round(Math.cos(a) * 16), cy + Math.round(Math.sin(a) * 12), C.textHi);
    }
  }

  buf.fillRect(0, 72, buf.width, 8, C.ground);
  if (highlightLabel) drawTextCentered(buf, 73, highlightLabel, C.title);
  else drawTextCentered(buf, 73, "SELECT TO EXPLORE", C.dim);
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

// PROFILE — identity + settings, plus the ambient Relay link report. RELAY is a
// status item here (not a navigation destination, DESIGN §6.1): selecting it
// shows the connection and re-links; SETTINGS shows the sound toggle.
export function drawProfile(
  buf: PixelBuffer,
  place: PlaceDef,
  state: NavState,
  relay: RelayView,
  muted: boolean,
): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, place.label, C.title);
  drawText(buf, buf.width - measureText("LOC") - 3, 2, "LOC", C.tagLocal);
  divider(buf, 9);
  drawItems(buf, place.items, state, 13);

  if (state.selectedItem === null) return;
  const item = place.items[state.selectedItem];
  divider(buf, 45);
  if (item === "RELAY") {
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
  } else if (item === "SETTINGS") {
    drawTextCentered(buf, 49, muted ? "SOUND: OFF" : "SOUND: ON", muted ? C.dim : C.ok);
    drawTextCentered(buf, 57, "ACCEPT TO TOGGLE", C.dim);
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

/** The WISP Place: the creature, its form, age, and the five hearts. */
export function drawWispDetail(
  buf: PixelBuffer,
  frame: number,
  wisp: Wisp,
  view: WispView,
  canRaise: boolean,
): void {
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

  // Five stat rows as Tamagotchi hearts (5 per stat, half/whole). In dev the
  // cursor can highlight a heart to raise it (test only).
  HEARTS.forEach((heart, i) => {
    const def = HEART_DEFS[heart];
    const y = 34 + i * 6;
    const hi = canRaise && view.cursor === i;
    if (hi) drawText(buf, 1, y, ">", C.cursor);
    drawText(buf, 7, y, def.tag, def.color);
    drawHeartMeter(buf, 14, y, wisp.hearts[heart], THRESHOLD.beacon, def.color);
  });

  const nameIndex = canRaise ? HEARTS.length : 0;
  const resetIndex = canRaise ? HEARTS.length + 1 : -1;
  const ny = 65;
  const nameHi = view.cursor === nameIndex;
  if (nameHi) drawText(buf, 1, ny, ">", C.cursor);
  drawText(buf, 7, ny, "NAME WISP", nameHi ? C.textHi : C.text);
  if (canRaise) {
    const ry = 72;
    const resetHi = view.cursor === resetIndex;
    if (resetHi) drawText(buf, 1, ry, ">", C.cursor);
    drawText(buf, 7, ry, "RESET (DEV)", resetHi ? C.warn : C.dim);
  }
}

/** FRIENDS — buddy list (added first, then nearby with an ADD hint). */
export function drawFriends(buf: PixelBuffer, v: FriendsView): void {
  if (v.thread) {
    drawDmThread(buf, v.thread);
    return;
  }
  buf.clear(C.bg);
  drawText(buf, 3, 2, "FRIENDS", C.title);
  drawText(buf, buf.width - measureText("REL") - 3, 2, "REL", C.tagRelay);
  divider(buf, 9);
  if (v.list.length === 0) {
    drawTextCentered(buf, 30, "NOBODY NEARBY YET", C.dim);
    drawTextCentered(buf, 40, "WAITING FOR PRESENCE", C.dim);
  } else {
    v.list.slice(0, 8).forEach((it, i) => {
      const y = 13 + i * 7;
      const hi = i === v.cursor;
      if (hi) drawText(buf, 1, y, ">", C.cursor);
      drawText(buf, 7, y, it.handle.toUpperCase().slice(0, 20), hi ? C.textHi : it.kind === "buddy" ? C.text : C.ok);
      if (it.kind === "nearby") drawText(buf, buf.width - measureText("ADD") - 3, y, "ADD", C.ok);
    });
  }
  buf.fillRect(0, 72, buf.width, 8, C.ground);
  drawTextCentered(buf, 73, "ACCEPT ADD/OPEN  CANCEL BACK", C.dim);
}

function drawDmThread(buf: PixelBuffer, thread: NonNullable<FriendsView["thread"]>): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, thread.title.slice(0, 18), C.title);
  drawText(buf, buf.width - measureText("DM") - 3, 2, "DM", C.tagRelay);
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
  drawTextCentered(buf, 73, "ACCEPT WRITE  CANCEL BACK", C.dim);
}

/** BROADCAST — a public chatroom log; ACCEPT writes to the room. */
export function drawChat(buf: PixelBuffer, v: ChatView): void {
  buf.clear(C.bg);
  drawText(buf, 3, 2, v.title.slice(0, 16), C.title);
  drawText(buf, buf.width - measureText("ROOM") - 3, 2, "ROOM", C.tagRelay);
  divider(buf, 9);
  if (v.messages.length === 0) {
    drawTextCentered(buf, 30, "NO MESSAGES YET", C.dim);
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

export function drawScreen(buf: PixelBuffer, frame: number, model: ScreenModel): void {
  if (model.editing) {
    drawEditor(buf, frame, model.editing);
    return;
  }
  if (model.wispView) {
    drawWispDetail(buf, frame, model.wisp, model.wispView, model.canRaise);
    return;
  }
  const { nav } = model;
  if (nav.level === "home") {
    drawCompanion(
      buf, frame, model.wisp,
      nav.iconIndex !== null ? PLACES[nav.iconIndex].label : undefined,
      model.muted, model.relay.online, model.nearbyCount,
    );
    return;
  }
  const place = currentPlace(nav);
  if (place.id === "travelers" && model.friends) drawFriends(buf, model.friends);
  else if (place.id === "commons" && model.chat) drawChat(buf, model.chat);
  else if (place.id === "profile") drawProfile(buf, place, nav, model.relay, model.muted);
  else drawPlace(buf, place, nav);
}
