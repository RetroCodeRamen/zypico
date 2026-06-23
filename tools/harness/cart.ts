// Real-radio test of Cart distribution + Station hosting (DESIGN §Making):
//   Board A = a Station hosting Carts.
//   Board B = the author (publishes a Cart), then a fetcher (requests it).
// Proves a signed Cart is distributable + verifiable over LoRa, served by the
// Station. (Small cart for one-frame direct send; large Carts fragment via the
// normal send path.)
//
// Run: sg dialout -c "npx vite-node tools/harness/cart.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import { decodeCart, decodeCartReq, encodeCart, encodeCartReq, encodeFrame, SubType, type CartMsg } from "@core/protocol/index.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { CartStore } from "../station/cartstore.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

async function main(): Promise<void> {
  guard(40_000);
  const author = await deriveIdentity("Smith", "pw");
  const code = "function _draw() cls(7) print('HI',2,2,0) end";

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA); // the Station
  const b = new RelayClient(tB); // author, then fetcher
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  const carts = new CartStore();
  a.onInbound((f) => {
    if (f.subtype === SubType.CART) carts.put(f.payload);
    else if (f.subtype === SubType.CART_REQ) {
      const r = decodeCartReq(f.payload);
      const held = r && carts.get(r.authorFp, r.name);
      if (held) txA(SubType.CART, held);
    }
  });

  let got: CartMsg | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.CART) return;
    const c = decodeCart(f.payload);
    if (c?.authorFp === author.fingerprint && c.name === "MINI") got = c;
  });

  log(`A(station)=${PORT_A}  B(author→fetcher)=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  log("Author → publishing the Cart to the Station…");
  txB(SubType.CART, encodeCart(author, "MINI", code));
  await delay(2000);
  check("Station is hosting the cart", carts.count === 1, `count=${carts.count}`);

  log("Fetcher → requesting the Cart from the Station…");
  for (let i = 0; i < 3 && got === null; i++) {
    txB(SubType.CART_REQ, encodeCartReq(author.fingerprint, "MINI"));
    await delay(2500);
  }
  await waitFor(() => got !== null, 4000);

  check("fetched the cart from the Station", got !== null);
  const c = got as CartMsg | null;
  if (c) {
    check("verified author (signature)", c.authorFp === author.fingerprint, c.authorFp);
    check("cart code round-trips", c.code === code, c.code);
  }

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
