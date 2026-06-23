// Traveler Page — a small personal page (Cybiko / Geocities / .plan vibe, DESIGN
// §5.2): a tagline + an About blurb, intentionally small. The page belongs to
// the Traveler (local-first); Stations host/sync it later (M7). Stored per
// identity, behind these functions, like the rest of local state.

export interface TravelerPage {
  tagline: string;
  about: string;
  /** Epoch ms of the last edit (0 = never written). */
  updatedAt: number;
}

// Kept small for the air (DESIGN §5.2 "intentionally small").
export const TAGLINE_MAX = 40;
export const ABOUT_MAX = 180;

export function emptyPage(): TravelerPage {
  return { tagline: "", about: "", updatedAt: 0 };
}

const keyFor = (fingerprint: string) => `zypico.page.${fingerprint}`;

export function loadPage(fingerprint: string): TravelerPage {
  try {
    const raw = localStorage.getItem(keyFor(fingerprint));
    if (raw) {
      const p = JSON.parse(raw) as Partial<TravelerPage>;
      return {
        tagline: (p.tagline ?? "").slice(0, TAGLINE_MAX),
        about: (p.about ?? "").slice(0, ABOUT_MAX),
        updatedAt: p.updatedAt ?? 0,
      };
    }
  } catch {
    // fall through to an empty page
  }
  return emptyPage();
}

export function savePage(fingerprint: string, page: TravelerPage): void {
  try {
    localStorage.setItem(keyFor(fingerprint), JSON.stringify(page));
  } catch {
    // storage full/unavailable — non-fatal
  }
}
