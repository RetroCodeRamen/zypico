// Real-radio test: board B fetches board A's Traveler Page over LoRa. A serves
// its (signed) page when asked; B requests it and must decode + verify it.
// Exercises the M5 PAGE_REQ / PAGE path on the actual radios.
//
// Run: sg dialout -c "npx vite-node tools/harness/pages.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import {
  decodePage, decodePageReq, encodeFrame, encodePage, encodePageReq, SubType, type PageMsg,
} from "@core/protocol/index.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

async function main(): Promise<void> {
  guard(45_000);
  const idA = await deriveIdentity("PageOwner", "pw-a");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA);
  const b = new RelayClient(tB);
  // Direct sends (skip the governor — see roundtrip.ts), hop-limit 1 so neither
  // board repeats: a 2-node direct test, no repeat storm to collide with replies.
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  // A serves its page whenever asked for it.
  a.onInbound((f) => {
    if (f.subtype !== SubType.PAGE_REQ) return;
    const r = decodePageReq(f.payload);
    if (r?.ownerFp === idA.fingerprint) {
      txA(SubType.PAGE, encodePage(idA, "wandering the mesh", "i collect signal hearts and good chats", Date.now()));
    }
  });

  let got: PageMsg | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.PAGE) return;
    const p = decodePage(f.payload);
    if (p?.fingerprint === idA.fingerprint) got = p;
  });

  log(`A=${PORT_A}  B=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  // One request, then stay quiet so A's (larger) page response has a clear
  // channel — LoRa is half-duplex, and a chatty requester collides with it.
  log("B → requesting A's page…");
  for (let i = 0; i < 3 && got === null; i++) {
    txB(SubType.PAGE_REQ, encodePageReq(idA.fingerprint));
    await delay(3000);
  }
  await waitFor(() => got !== null, 4000);

  check("B fetched A's page over LoRa", got !== null);
  const p = got as PageMsg | null;
  if (p) {
    check("page is from A (verified signature)", p.fingerprint === idA.fingerprint, p.fingerprint);
    check("handle round-trips", p.handle === "PageOwner", p.handle);
    check("tagline round-trips", p.tagline === "wandering the mesh", p.tagline);
    check("about round-trips", p.about.startsWith("i collect signal hearts"), p.about);
  }

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
