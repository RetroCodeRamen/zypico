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
  // Home — the Wisp's room: a little house (REDESIGN §2).
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
      <rect x="10" y="14" width="4" height="5" />
    </>
  ),
  // The Relay — radio tower with broadcast arcs (the social region).
  relay: (
    <>
      <path d="M9 21l3-9 3 9" />
      <line x1="10" y1="17" x2="14" y2="17" />
      <path d="M8 8a5 5 0 0 1 8 0M6 6a8 8 0 0 1 12 0" />
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
  // Workshop — a wrench over a workbench (create / edit Carts, §2).
  workshop: (
    <>
      <path d="M14.5 4a3.5 3.5 0 0 0-4.6 4.3l-5 5 2.6 2.6 5-5A3.5 3.5 0 0 0 18 7l-2.3 2.3-1.7-1.7L16.3 5.3A3.5 3.5 0 0 0 14.5 4z" />
    </>
  ),
  // Bag — a satchel / pouch (items + collection, §2).
  bag: (
    <>
      <path d="M6 9h12l-1 11H7L6 9z" />
      <path d="M9 9V7a3 3 0 0 1 6 0v2" />
    </>
  ),
  // Profile — single head + shoulders.
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6" />
    </>
  ),
  // Settings — a gear (system config, §2).
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  // Alerts — a bell that lights up when something needs you (last slot, §2).
  alerts: (
    <>
      <path d="M6 16a6 6 0 0 1 0-8 6 6 0 0 1 12 0 6 6 0 0 1 0 8z" />
      <path d="M10.5 19a1.6 1.6 0 0 0 3 0" />
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
