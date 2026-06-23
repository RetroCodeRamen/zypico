// Hi-res, single-color vector place-icons (outline §13.1, §13.8 — crisp icons
// framing the low-res screen; "not bound by the low-res rules"). One unified
// stroke style; color comes from CSS (active vs idle), so identity reads from
// position + glyph, not hue (outline §13.8).

import type { ReactNode } from "react";
import type { Place } from "./nav.ts";

const COMMON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PATHS: Record<Place, ReactNode> = {
  // The Commons — the town square: a speech bubble (public chat / gathering).
  commons: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="12" x2="13" y2="12" />
    </>
  ),
  // Travelers — two people (friends met on your travels).
  travelers: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <path d="M16 6.5a3 3 0 0 1 0 5M17 15c2 0 4 2 4 5" />
    </>
  ),
  // The Post — envelope (Mail).
  post: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  // Pages — a document with lines (Traveler Pages + Guestbooks).
  pages: (
    <>
      <path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0z" />
      <path d="M14 3v4h4" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="15" x2="16" y2="15" />
      <line x1="8" y1="18" x2="13" y2="18" />
    </>
  ),
  // Wisp — the companion: a little spark/creature with a glow.
  wisp: (
    <>
      <path d="M12 4c4 0 7 3 7 7 0 5-4 6-4 9H9c0-3-4-4-4-9 0-4 3-7 7-7z" />
      <circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="11" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Arcade — a die (outline §13.1 "die = Arcade").
  arcade: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // The Exchange — a marketplace: swap arrows (items, themes, Carts).
  exchange: (
    <>
      <path d="M4 9h13l-4-4M20 15H7l4 4" />
    </>
  ),
  // Profile — single head + shoulders.
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6" />
    </>
  ),
};

export function PlaceIcon({ id }: { id: Place }) {
  return (
    <svg {...COMMON} aria-hidden="true">
      {PATHS[id]}
    </svg>
  );
}
