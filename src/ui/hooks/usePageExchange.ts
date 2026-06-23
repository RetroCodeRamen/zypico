import { useEffect, useRef, useState } from "react";
import type { Identity } from "@core/identity/index.ts";
import {
  decodePage, decodePageReq, encodePage, encodePageReq, SubType, type PageMsg,
} from "@core/protocol/index.ts";
import type { TravelerPage } from "@app/storage/page.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

// Peer-to-peer Traveler Page exchange over the mesh (DESIGN §5.2; Stations host
// them later in M7). We serve our own page when a reachable Traveler asks, and
// cache pages we fetch. The inbound handler is bound once and reads current
// state through refs. `getMyPage` lets us serve the latest local edits.
export function usePageExchange(identity: Identity | null, link: Relay, getMyPage: () => TravelerPage) {
  const [pages, setPages] = useState<Record<string, PageMsg>>({}); // fingerprint → fetched page
  const identityRef = useRef<Identity | null>(identity);
  const pageRef = useRef(getMyPage);
  identityRef.current = identity;
  pageRef.current = getMyPage;

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /** Ask a reachable Traveler for their page (their device serves it back). */
  const requestPage = (ownerFp: string) => link.send(SubType.PAGE_REQ, encodePageReq(ownerFp));

  return { pages, requestPage };
}
