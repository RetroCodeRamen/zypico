// Procedural Wisp rendering for the 128×80 matrix (outline §3.3–3.4). Each form
// is a distinct silhouette, not just a brighter blob: a Flicker is a faint
// spark, an Ember a flame, a Glow an orb with a path motif, and each of the
// eight Beacons a realized creature with its own emblem. Tinted by the form's
// dominant-heart color. Drawn from primitives so all 15 forms read differently
// without 15 hand-authored sprites.

import type { PixelBuffer } from "@ui/pixel/PixelBuffer.ts";
import type { FormDef, FormId } from "@core/companion/index.ts";

const BASE_R: Record<number, number> = { 1: 6, 2: 8, 3: 10, 4: 12 };

// ---- primitives --------------------------------------------------------------

function line(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: number): void {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    buf.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function ring(buf: PixelBuffer, cx: number, cy: number, r: number, c: number): void {
  let x = r, y = 0, err = 0;
  while (x >= y) {
    for (const [sx, sy] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) {
      buf.set(cx + sx, cy + sy, c);
    }
    y++;
    if (err <= 0) err += 2 * y + 1;
    if (err > 0) { x--; err -= 2 * x + 1; }
  }
}

// A flame/teardrop: rounded or sharp taper to a point at the top.
function flame(buf: PixelBuffer, cx: number, baseY: number, h: number, maxW: number, color: number, sharp: boolean): void {
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1); // 0 = bottom, 1 = top
    const w = sharp ? Math.round(maxW * (1 - t)) : Math.round(maxW * Math.cos((t * Math.PI) / 2));
    if (w > 0) buf.fillRect(cx - Math.floor(w / 2), baseY - i, w, 1, color);
  }
}

function eyes(buf: PixelBuffer, cx: number, by: number, r: number, color: number, frame: number): void {
  const ex = Math.max(2, Math.round(r * 0.42));
  const ey = Math.round(r * 0.15);
  const open = frame % 90 >= 4; // a quick blink every ~90 frames
  for (const x of [cx - ex, cx + ex - 1]) {
    if (open) {
      buf.set(x, by - ey, color);
      buf.set(x, by - ey + 1, color);
    } else {
      buf.set(x, by - ey + 1, color);
      buf.set(x + 1, by - ey + 1, color);
    }
  }
}

// Orb body shared by Glow/Beacon: halo, body, highlight, eyes.
function orb(buf: PixelBuffer, cx: number, by: number, r: number, color: number, halo: number, frame: number): void {
  buf.fillCircle(cx, by, r + 1, halo);
  buf.fillCircle(cx, by, r, color);
  buf.fillCircle(cx - Math.round(r * 0.3), by - Math.round(r * 0.3), Math.max(1, Math.round(r * 0.35)), 7);
  eyes(buf, cx, by, r, 0, frame);
}

// ---- the creature ------------------------------------------------------------

export function drawWisp(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  frame: number,
  form: FormDef,
  scale = 1,
): void {
  const tier = form.tier;
  const r = Math.max(3, Math.round(BASE_R[tier] * scale));
  const by = cy + Math.round(Math.sin(frame / 6) * 2 * scale);
  const col = form.color;

  if (tier === 1) {
    // Flicker — a faint, wavering spark; barely a shape.
    const wave = Math.sin(frame / 3);
    const c = wave > 0.4 ? 7 : wave > -0.3 ? 6 : 5;
    buf.fillCircle(cx, by, Math.max(2, r - 2), c);
    buf.set(cx, by - r, c);
    buf.set(cx, by + r, c);
    buf.set(cx - r, by, c);
    buf.set(cx + r, by, c);
    eyes(buf, cx, by, r, 1, frame);
    return;
  }

  if (tier === 2) {
    // Ember — the light catches into a flame. Warm = rounded, Bright = sharp.
    const sharp = form.id === "bright_ember";
    flame(buf, cx, by + r, r * 2, r * 2, col, sharp);
    buf.fillCircle(cx, by + Math.round(r * 0.5), Math.round(r * 0.7), col);
    eyes(buf, cx, by + Math.round(r * 0.3), r, 0, frame);
    return;
  }

  if (tier === 3) {
    orb(buf, cx, by, r, col, 6, frame);
    drawGlowMotif(buf, cx, by, r, col, form.id);
    return;
  }

  // Beacon — fully realized: orbiting sparks + a form-specific emblem.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + frame * 0.05;
    const rr = r + 4 + (i % 2 ? 2 : 0);
    buf.set(cx + Math.round(Math.cos(a) * rr), by + Math.round(Math.sin(a) * rr), 7);
  }
  orb(buf, cx, by, r, col, 7, frame);
  drawBeaconEmblem(buf, cx, by, r, col, form.id, frame);
}

function drawGlowMotif(buf: PixelBuffer, cx: number, by: number, r: number, col: number, id: FormId): void {
  switch (id) {
    case "closewarm_glow": // companionship — two small flanking lights
      buf.fillCircle(cx - r - 3, by + 2, 2, col);
      buf.fillCircle(cx + r + 3, by + 2, 2, col);
      break;
    case "publicwarm_glow": // a voice — sound arcs to the right
      ring(buf, cx, by, r + 3, 8);
      ring(buf, cx, by, r + 5, 8);
      break;
    case "venturing_glow": { // a heading — chevron above
      const t = by - r - 4;
      line(buf, cx, t, cx - 4, t + 4, 7);
      line(buf, cx, t, cx + 4, t + 4, 7);
      break;
    }
    case "making_glow": // a lattice on the body
      line(buf, cx - 4, by, cx + 4, by, 7);
      line(buf, cx, by - 4, cx, by + 4, 7);
      break;
    default:
      break;
  }
}

function drawBeaconEmblem(buf: PixelBuffer, cx: number, by: number, r: number, col: number, id: FormId, frame: number): void {
  switch (id) {
    case "lantern": { // steady flame above a caged light
      line(buf, cx - r, by - r, cx - r, by + r, 0);
      line(buf, cx + r, by - r, cx + r, by + r, 0);
      flame(buf, cx, by - r, 5, 4, 10, false);
      break;
    }
    case "hearth": // a gathered circle beneath
      ring(buf, cx, by + r + 1, r, col);
      break;
    case "herald": { // a horn casting waves to the right
      line(buf, cx + r, by, cx + r + 5, by - 3, 0);
      line(buf, cx + r, by, cx + r + 5, by + 3, 0);
      ring(buf, cx + r + 5, by, 3, 8);
      break;
    }
    case "chorus": { // satellites it lifts up, orbiting
      for (let i = 0; i < 3; i++) {
        const a = frame * 0.06 + (i / 3) * Math.PI * 2;
        buf.fillCircle(cx + Math.round(Math.cos(a) * (r + 5)), by + Math.round(Math.sin(a) * (r + 5)), 2, 14);
      }
      break;
    }
    case "pathfinder": { // a compass needle
      buf.fillCircle(cx, by - r + 2, 1, 7);
      line(buf, cx, by - r + 2, cx, by + r - 2, 8);
      break;
    }
    case "champion": { // crystalline spikes
      line(buf, cx, by - r - 4, cx, by - r, 7);
      line(buf, cx, by + r, cx, by + r + 4, 7);
      line(buf, cx - r - 4, by, cx - r, by, 7);
      line(buf, cx + r, by, cx + r + 4, by, 7);
      break;
    }
    case "forge": { // an anvil base with sparks
      buf.fillRect(cx - r, by + r, r * 2, 3, 5);
      if (frame % 8 < 4) { buf.set(cx + r, by + r - 1, 9); buf.set(cx - r, by + r - 1, 10); }
      break;
    }
    case "weaver": { // a woven lattice across the body
      line(buf, cx - r, by - r, cx + r, by + r, 7);
      line(buf, cx + r, by - r, cx - r, by + r, 7);
      break;
    }
    default:
      break;
  }
}

// A Tamagotchi-style heart icon (6×5). Level: 0 empty, 1 half (left), 2 full.
const HEART = [".#..#.", "######", "######", ".####.", "..##.."];
const HEART_DIM = 5; // dark-grey for the unfilled portion

function drawHeart(buf: PixelBuffer, x: number, y: number, level: number, color: number): void {
  for (let dy = 0; dy < HEART.length; dy++) {
    const row = HEART[dy];
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] !== "#") continue;
      const lit = level === 2 ? color : level === 1 ? (dx < 3 ? color : HEART_DIM) : HEART_DIM;
      buf.set(x + dx, y + dy, lit);
    }
  }
}

export const HEART_CELL = 7; // 6px heart + 1px gap
export const HEART_METER_W = HEART_CELL * 5;

/** Five hearts (half-step granularity) representing value/max (outline-style). */
export function drawHeartMeter(
  buf: PixelBuffer,
  x: number,
  y: number,
  value: number,
  max: number,
  color: number,
): void {
  const halves = Math.max(0, Math.min(10, Math.round((value / max) * 10)));
  for (let i = 0; i < 5; i++) {
    const level = halves >= 2 * (i + 1) ? 2 : halves === 2 * i + 1 ? 1 : 0;
    drawHeart(buf, x + i * HEART_CELL, y, level, color);
  }
}
