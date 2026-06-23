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
  // Radio — antenna with broadcast arcs (enter the Relay).
  radio: (
    <>
      <line x1="12" y1="13" x2="12" y2="21" />
      <circle cx="12" cy="11" r="2" />
      <path d="M7 7a7 7 0 0 0 0 9M17 7a7 7 0 0 1 0 9" />
    </>
  ),
  // Mail — envelope.
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  // Friends — two people.
  friends: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <path d="M16 6.5a3 3 0 0 1 0 5M17 15c2 0 4 2 4 5" />
    </>
  ),
  // Profile — single head + shoulders.
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6" />
    </>
  ),
  // Broadcast — bulletin board / posts.
  bcast: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="13" y2="12" />
      <path d="M9 17l-2 3M15 17l2 3" />
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
  // Craft — a ">_" code prompt (outline §13.1 "_> = Craft/Lua").
  craft: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10l3 2-3 2" />
      <line x1="12" y1="15" x2="16" y2="15" />
    </>
  ),
  // Quests — compass.
  quests: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" />
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
