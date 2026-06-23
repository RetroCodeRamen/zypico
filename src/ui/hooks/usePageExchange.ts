import { useEffect, useRef, useState } from "react";
import type { Identity } from "@core/identity/index.ts";
import {
  decodeGuestbook, decodePage, decodePageReq,
  encodeGuestbook, encodePage, encodePageReq, SubType, type PageMsg,
} from "@core/protocol/index.ts";
import type { TravelerPage } from "@app/storage/page.ts";
import {
  type GuestEntry, addGuestEntry, loadGuestbook, saveGuestbook,
} from "@app/storage/guestbook.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

// Peer-to-peer Traveler Page exchange over the mesh (DESIGN §5.2; Stations host
// them later in M7). We serve our own page when a reachable Traveler asks, and
// cache pages we fetch. The inbound handler is bound once and reads current
// state through refs. `getMyPage` lets us serve the latest local edits.
export function usePageExchange(
  identity: Identity | null,
  link: Relay,
  getMyPage: () => TravelerPage,
  pageStationFps: string[],
) {
  const [pages, setPages] = useState<Record<string, PageMsg>>({}); // fingerprint → fetched page
  const [myGuestbook, setMyGuestbook] = useState<GuestEntry[]>([]); // entries left for me
  const identityRef = useRef<Identity | null>(identity);
  const pageRef = useRef(getMyPage);
  identityRef.current = identity;
  pageRef.current = getMyPage;

  useEffect(() => {
    if (identity) saveGuestbook(identity.fingerprint, myGuestbook);
  }, [myGuestbook, identity]);

  useEffect(() => link.onInbound((f) => {
    const me = identityRef.current;
    if (!me) return;
    if (f.subtype === SubType.PAGE_REQ) {
      const r = decodePageReq(f.payload);
      if (r && r.ownerFp === me.fingerprint) {
        const p = pageRef.current();
        link.send(SubType.PAGE, encodePage(me, p.tagline, p.about, p.updatedAt || Date.now()));
      }
    } else if (f.subtype === SubType.PAGE) {
      const p = decodePage(f.payload);
      if (p && p.fingerprint !== me.fingerprint) setPages((m) => ({ ...m, [p.fingerprint]: p }));
    } else if (f.subtype === SubType.GUESTBOOK) {
      const g = decodeGuestbook(f.payload);
      if (g && g.ownerFp === me.fingerprint && g.signerFp !== me.fingerprint) {
        setMyGuestbook((list) => addGuestEntry(list, { fromFp: g.signerFp, handle: g.handle, text: g.text, at: Date.now() }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Publish our page to each PAGES-capable Station we discover, so it stays
  // fetchable when we're away (DESIGN §5.2). Once per station (per session).
  const publishedRef = useRef(new Set<string>());
  const stationKey = [...pageStationFps].sort().join(",");
  useEffect(() => {
    const me = identityRef.current;
    const page = pageRef.current();
    if (!me || page.updatedAt === 0) return;
    for (const fp of pageStationFps) {
      if (!publishedRef.current.has(fp)) {
        publishedRef.current.add(fp);
        link.send(SubType.PAGE, encodePage(me, page.tagline, page.about, page.updatedAt));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationKey]);

  /** Ask a reachable Traveler (or a hosting Station) for a page. */
  const requestPage = (ownerFp: string) => link.send(SubType.PAGE_REQ, encodePageReq(ownerFp));

  /** Sign a Traveler's guestbook (delivered to them; appears on their page). */
  const signGuestbook = (ownerFp: string, text: string) => {
    const me = identityRef.current;
    const t = text.trim();
    if (me && t) link.send(SubType.GUESTBOOK, encodeGuestbook(ownerFp, me, t));
  };

  const loadGuests = (fp: string) => setMyGuestbook(loadGuestbook(fp));

  return { pages, requestPage, myGuestbook, signGuestbook, loadGuests };
}
