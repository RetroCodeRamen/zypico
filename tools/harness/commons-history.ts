// Real-radio test of Station Commons memory + backfill (DESIGN §4.4):
//   Board A = a Station retaining Commons posts.
//   Board B = a Traveler who posts a few messages, then asks for history.
// B never hears its own sends, so the posts it gets back came from the Station's
// backfill — proving an arriving Traveler sees a populated town square.
//
// Run: sg dialout -c "npx vite-node tools/harness/commons-history.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import { encodeFrame, encodeHlc, HybridLogicalClock, SubType } from "@core/protocol/index.ts";
import { decodeRoomMsg, encodeCommonsReq, encodeRoomMsg, MAIN_ROOM } from "@core/protocol/social.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { CommonsLog } from "../station/commons.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

async function main(): Promise<void> {
  guard(45_000);
  const poster = await deriveIdentity("Townsfolk", "pw");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA); // the Station
  const b = new RelayClient(tB); // poster, then asks for backfill
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  // Board A behaves as a COMMONS Station: retain posts, backfill on request.
  const commons = new CommonsLog(50);
  a.onInbound((f) => {
    if (f.subtype === SubType.POST) commons.add(f.payload);
    else if (f.subtype === SubType.COMMONS_REQ) for (const p of commons.recent(20)) txA(SubType.POST, p);
  });

  // Board B collects backfilled posts.
  const got = new Set<string>();
  b.onInbound((f) => {
    if (f.subtype !== SubType.POST) return;
    const m = decodeRoomMsg(f.payload);
    if (m) got.add(m.text);
  });

  log(`A(station)=${PORT_A}  B(poster→arrival)=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  // Phase 1: post three Commons messages; the Station retains them.
  log("Townsfolk → posting to the Commons…");
  const hlc = new HybridLogicalClock();
  const said = ["hello commons", "anyone around?", "nice weather on the mesh"];
  for (const text of said) {
    txB(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(hlc.send()), poster.fingerprint, poster.handle, text));
    await delay(900);
  }
  await delay(1200);
  check("Station retained the posts", commons.count === 3, `count=${commons.count}`);

  // Phase 2: an arrival requests backfill; the Station replays history.
  log("Arrival → requesting Commons backfill…");
  for (let i = 0; i < 3 && got.size < 3; i++) {
    txB(SubType.COMMONS_REQ, encodeCommonsReq(MAIN_ROOM));
    await delay(2500);
  }
  await waitFor(() => got.size >= 3, 4000);

  check("arrival received the backfilled history", got.size >= 3, `${got.size} posts`);
  for (const text of said) check(`  got: "${text}"`, got.has(text));

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
