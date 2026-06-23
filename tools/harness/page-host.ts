// Real-radio test of Station page hosting (DESIGN §5.2) across both boards:
//   Board A = a Station that hosts pages.
//   Board B = the owner (publishes its page), then a different Traveler who
//             requests that page while the owner is no longer serving.
// Proves a page is fetchable via the Station even when its owner is offline.
//
// Run: sg dialout -c "npx vite-node tools/harness/page-host.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import {
  decodePage, decodePageReq, encodeFrame, encodePage, encodePageReq, SubType, type PageMsg,
} from "@core/protocol/index.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { PageStore } from "../station/pagestore.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

async function main(): Promise<void> {
  guard(40_000);
  const owner = await deriveIdentity("HostedOwner", "pw-o");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA); // the Station
  const b = new RelayClient(tB); // owner, then a requester
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  // Board A behaves as a hosting Station.
  const pages = new PageStore();
  a.onInbound((f) => {
    if (f.subtype === SubType.PAGE) pages.put(f.payload);
    else if (f.subtype === SubType.PAGE_REQ) {
      const r = decodePageReq(f.payload);
      const hosted = r && pages.get(r.ownerFp);
      if (hosted) txA(SubType.PAGE, hosted);
    }
  });

  let got: PageMsg | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.PAGE) return;
    const p = decodePage(f.payload);
    if (p?.fingerprint === owner.fingerprint) got = p;
  });

  log(`A(station)=${PORT_A}  B(owner→requester)=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  // Phase 1: owner publishes its page to the Station.
  log("Owner → publishing page to the Station…");
  txB(SubType.PAGE, encodePage(owner, "lives on the station", "fetch me even when im away", Date.now()));
  await delay(2000);
  check("Station is hosting the page", pages.count === 1, `count=${pages.count}`);

  // Phase 2: a requester asks for the owner's page (owner no longer serving).
  log("Requester → asking the Station for the owner's page…");
  for (let i = 0; i < 3 && got === null; i++) {
    txB(SubType.PAGE_REQ, encodePageReq(owner.fingerprint));
    await delay(2500);
  }
  await waitFor(() => got !== null, 4000);

  check("got the owner's page from the Station (owner offline)", got !== null);
  const p = got as PageMsg | null;
  if (p) {
    check("verified it is the owner's page", p.fingerprint === owner.fingerprint, p.fingerprint);
    check("tagline round-trips via the Station", p.tagline === "lives on the station", p.tagline);
  }

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
