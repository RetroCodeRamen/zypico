import { useEffect, useState } from "react";
import {
  type TravelerPage, ABOUT_MAX, TAGLINE_MAX, emptyPage, loadPage, savePage,
} from "@app/storage/page.ts";

// Your Traveler Page (local-first; per-identity). Autosaves under the
// fingerprint; `load` swaps in the stored page at login. Editing a field stamps
// updatedAt so peers/Stations can tell whose copy is newer (M5+).
export function usePages(fingerprint: string | null) {
  const [myPage, setMyPage] = useState<TravelerPage>(emptyPage);

  useEffect(() => {
    if (fingerprint) savePage(fingerprint, myPage);
  }, [myPage, fingerprint]);

  const load = (fp: string) => setMyPage(loadPage(fp));

  const setTagline = (v: string) =>
    setMyPage((p) => ({ ...p, tagline: v.slice(0, TAGLINE_MAX), updatedAt: Date.now() }));
  const setAbout = (v: string) =>
    setMyPage((p) => ({ ...p, about: v.slice(0, ABOUT_MAX), updatedAt: Date.now() }));

  return { myPage, load, setTagline, setAbout };
}
