// Deep, bidirectional communication test over real LoRa — exercises the REAL
// send path (RelayClient.send → airtime governor), unlike roundtrip.ts which
// bypasses the governor. Hunts the "one side receives but can't send" class of
// bug: two-way Commons, two-way DM, rapid-fire throughput, and governor
// starvation. Run: sg dialout -c "npx vite-node tools/harness/comms-deep.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { SubType, encodeHlc, HybridLogicalClock } from "@core/protocol/index.ts";
import {
  decodeDM, decodePresence, decodeRoomMsg, encodeDM, encodePresence, encodeRoomMsg, MAIN_ROOM,
} from "@core/protocol/social.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

async function main(): Promise<void> {
  guard(180_000);
  const idA = await deriveIdentity("AlphaTester", "pw-a");
  const idB = await deriveIdentity("BetaTester", "pw-b");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA);
  const b = new RelayClient(tB);

  // Captures, per side.
  const aRoom: string[] = []; const bRoom: string[] = [];
  const aDM: string[] = []; const bDM: string[] = [];
  let aHeardB = false; let bHeardA = false;
  const hlcA = new HybridLogicalClock(); const hlcB = new HybridLogicalClock();

  a.onInbound((f) => {
    if (f.subtype === SubType.PRESENCE) { if (decodePresence(f.payload)?.fingerprint === idB.fingerprint) aHeardB = true; }
    else if (f.subtype === SubType.POST) { const m = decodeRoomMsg(f.payload); if (m?.roomId === MAIN_ROOM && m.senderFp !== idA.fingerprint) aRoom.push(m.text); }
    else if (f.subtype === SubType.IM) { const e = decodeDM(f.payload); if (e?.recipientFp === idA.fingerprint) { const o = open(idA.secretKey, idB.publicKey, e.sealed); if (o) aDM.push(fromUtf8(o)); } }
  });
  b.onInbound((f) => {
    if (f.subtype === SubType.PRESENCE) { if (decodePresence(f.payload)?.fingerprint === idA.fingerprint) bHeardA = true; }
    else if (f.subtype === SubType.POST) { const m = decodeRoomMsg(f.payload); if (m?.roomId === MAIN_ROOM && m.senderFp !== idB.fingerprint) bRoom.push(m.text); }
    else if (f.subtype === SubType.IM) { const e = decodeDM(f.payload); if (e?.recipientFp === idB.fingerprint) { const o = open(idB.secretKey, idA.publicKey, e.sealed); if (o) bDM.push(fromUtf8(o)); } }
  });

  log(`A=${PORT_A}  B=${PORT_B}  (real send path — through the airtime governor)`);
  await a.connect();
  await b.connect();
  await delay(700);

  // 1) Mutual presence via the real send path (retry — a lone broadcast can be lost).
  log("• presence A→B…");
  for (let i = 0; i < 5 && !bHeardA; i++) { a.send(SubType.PRESENCE, encodePresence(idA, 7, 0)); await delay(900); }
  log("• presence B→A…");
  for (let i = 0; i < 5 && !aHeardB; i++) { b.send(SubType.PRESENCE, encodePresence(idB, 2, 1)); await delay(900); }
  check("B heard A", bHeardA); check("A heard B", aHeardB);

  // 2) Two-way Commons at a realistic chat cadence (~1.5s between turns).
  log("• two-way Commons (alternating, 4 each)…");
  for (let i = 0; i < 4; i++) {
    a.send(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(hlcA.send()), idA.fingerprint, idA.handle, `A${i}`)); await delay(1500);
    b.send(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(hlcB.send()), idB.fingerprint, idB.handle, `B${i}`)); await delay(1500);
  }
  await delay(3000);
  check("B got all 4 of A's posts", bRoom.length === 4, `got ${bRoom.length}: ${bRoom.join(",")}`);
  check("A got all 4 of B's posts", aRoom.length === 4, `got ${aRoom.length}: ${aRoom.join(",")}`);

  // 3) Rapid-fire from A (6 posts, no gap). Measures burst throughput — some
  // loss is expected over half-duplex LoRa (the sender's burst overlaps the
  // peer's rebroadcasts), so we report the count and only fail on starvation.
  log("• rapid-fire: A sends 6 Commons posts back-to-back…");
  const before = bRoom.length;
  for (let i = 0; i < 6; i++) a.send(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(hlcA.send()), idA.fingerprint, idA.handle, `R${i}`));
  await delay(12_000);
  const burst = bRoom.length - before;
  // Informational: raw back-to-back bursts lose some frames over half-duplex
  // LoRa (the sender's burst overlaps the peer's rebroadcasts). Normal chat is
  // paced (see the 4/4 two-way result above) and the UI adds send-redundancy, so
  // this isn't a correctness gate — but a total starve (0) would be a regression.
  log(`    burst throughput: ${burst}/6 delivered (informational — half-duplex burst loss)`);
  check("rapid burst is not fully starved", burst >= 1, `received ${burst}/6`);

  // 4) Two-way DM (encrypted) — send ONCE each way using the client's built-in
  // redundancy (repeats=2, what useSocial now does), so a single dropped frame
  // doesn't lose the message. Must work in BOTH directions.
  log("• two-way DM (built-in redundancy, sent once)…");
  await delay(1500);
  a.send(SubType.IM, encodeDM(idB.fingerprint, idA.fingerprint, seal(idA.secretKey, idB.publicKey, utf8("hi B from A"))), undefined, 2);
  await delay(4000);
  b.send(SubType.IM, encodeDM(idA.fingerprint, idB.fingerprint, seal(idB.secretKey, idA.publicKey, utf8("hi A from B"))), undefined, 2);
  await delay(4000);
  check("B decrypted A's DM", bDM.includes("hi B from A"), bDM.join(","));
  check("A decrypted B's DM", aDM.includes("hi A from B"), aDM.join(","));

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
