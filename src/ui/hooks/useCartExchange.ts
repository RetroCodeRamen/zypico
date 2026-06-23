import { useEffect, useRef, useState } from "react";
import type { Identity } from "@core/identity/index.ts";
import { decodeCart, decodeCartReq, encodeCart, encodeCartReq, SubType } from "@core/protocol/index.ts";
import { type HeldCart, addCart, loadCarts, saveCarts } from "@app/storage/carts.ts";
import { SAMPLE_CARTS } from "@ui/cart/samples.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

// The Exchange (DESIGN §Making / §5): Carts you hold — your own + ones received
// over the mesh — distributed like Pages. We cache verified Carts we overhear,
// publish ours, and serve any we hold on request. On a fresh identity the
// built-in samples are seeded as yours so there's something to share/run.
export function useCartExchange(identity: Identity | null, link: Relay) {
  const [carts, setCarts] = useState<HeldCart[]>([]);
  const identityRef = useRef<Identity | null>(identity);
  const cartsRef = useRef<HeldCart[]>(carts);
  identityRef.current = identity;
  cartsRef.current = carts;

  useEffect(() => { if (identity) saveCarts(identity.fingerprint, carts); }, [carts, identity]);

  useEffect(() => link.onInbound((f) => {
    const me = identityRef.current;
    if (!me) return;
    if (f.subtype === SubType.CART) {
      const c = decodeCart(f.payload); // verifies the author's signature
      if (c) setCarts((list) => addCart(list, { ...c, at: Date.now(), payload: [...f.payload] }));
    } else if (f.subtype === SubType.CART_REQ) {
      const r = decodeCartReq(f.payload);
      const held = r && cartsRef.current.find((x) => x.authorFp === r.authorFp && x.name === r.name);
      if (held) link.send(SubType.CART, Uint8Array.from(held.payload));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /** Broadcast the Carts we authored, so peers + Stations can hold + spread them. */
  const publish = () => {
    const me = identityRef.current;
    if (!me) return;
    for (const c of cartsRef.current) if (c.authorFp === me.fingerprint) link.send(SubType.CART, Uint8Array.from(c.payload));
  };

  /** Ask a peer/Station for a specific Cart. */
  const requestCart = (authorFp: string, name: string) => link.send(SubType.CART_REQ, encodeCartReq(authorFp, name));

  const load = (fp: string) => {
    let held = loadCarts(fp);
    const me = identityRef.current;
    if (held.length === 0 && me) {
      // Seed the built-in samples as this Traveler's own Carts (signed by them).
      held = SAMPLE_CARTS.map((s) => {
        const payload = encodeCart(me, s.name, s.code);
        const d = decodeCart(payload)!;
        return { authorFp: d.authorFp, author: d.author, name: d.name, code: d.code, at: Date.now(), payload: [...payload] };
      });
      saveCarts(fp, held);
    }
    setCarts(held);
  };

  return { carts, publish, requestCart, load };
}
