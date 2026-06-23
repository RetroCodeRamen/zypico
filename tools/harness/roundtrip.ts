// Full real-radio round-trip across both boards: presence (both ways), an
// encrypted DM, a Commons post, and network-wide dedupe — all over actual LoRa,
// using the real RelayClient + RelayProtocol + crypto. This is the script to run
// after touching the protocol / messaging.
//
// Run: sg dialout -c "npx vite-node tools/harness/roundtrip.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { encodeFrame, encodeHlc, HybridLogicalClock, SubType } from "@core/protocol/index.ts";
import {
  decodeDM, decodePresence, decodeRoomMsg,
  encodeDM, encodePresence, encodeRoomMsg, MAIN_ROOM,
} from "@core/protocol/social.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

async function main(): Promise<void> {
  guard(75_000);
  const idA = await deriveIdentity("AlphaTester", "pw-a");
  const idB = await deriveIdentity("BetaTester", "pw-b");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA);
  const b = new RelayClient(tB);

  // Send straight through the transport so the 1% airtime governor doesn't starve
  // later frames — this harness tests delivery/decode/dedupe over the radio (the
  // governor has its own unit tests). The full RelayClient *receive* pipeline
  // (dedupe, repeat, hop count) is still exercised on the far side.
  const txA = (sub: SubType, payload: Uint8Array) => tA.sendFrame(encodeFrame(sub, payload, { hopLimit: 1 }));
  const txB = (sub: SubType, payload: Uint8Array) => tB.sendFrame(encodeFrame(sub, payload, { hopLimit: 1 }));

  // --- inbound capture ---
  let bHeardA = false;          // B hears A's presence
  let aHeardB = false;          // A hears B's presence
  let dmPlain: string | null = null;
  let postText: string | null = null;
  let dedupeCount = 0;          // how many times B delivers the fixed-id post

  b.onInbound((f) => {
    if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (p?.fingerprint === idA.fingerprint) bHeardA = true;
    } else if (f.subtype === SubType.IM) {
      const env = decodeDM(f.payload);
      if (env && env.recipientFp === idB.fingerprint) {
        const opened = open(idB.secretKey, idA.publicKey, env.sealed);
        if (opened) dmPlain = fromUtf8(opened);
      }
    } else if (f.subtype === SubType.POST) {
      const m = decodeRoomMsg(f.payload);
      if (m && m.roomId === MAIN_ROOM) {
        if (m.text === "hello commons") postText = m.text;
        if (m.text === "dupe-me") dedupeCount++;
      }
    }
  });
  a.onInbound((f) => {
    if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (p?.fingerprint === idB.fingerprint) aHeardB = true;
    }
  });

  log(`A=${PORT_A}  B=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  // 1) Presence — one direction at a time. LoRa is half-duplex: if both boards
  // transmit at once the packets collide, so we never let A and B send together.
  log("• presence A→B…");
  for (let i = 0; i < 6 && !bHeardA; i++) {
    txA(SubType.PRESENCE, encodePresence(idA, 7, 0));
    await delay(700);
  }
  await waitFor(() => bHeardA, 5000);
  check("B heard A's presence", bHeardA);

  log("• presence B→A…");
  for (let i = 0; i < 6 && !aHeardB; i++) {
    txB(SubType.PRESENCE, encodePresence(idB, 2, 1));
    await delay(700);
  }
  await waitFor(() => aHeardB, 5000);
  check("A heard B's presence", aHeardB);

  // 2) Encrypted DM A → B.
  log("• encrypted DM…");
  const sealed = seal(idA.secretKey, idB.publicKey, utf8("meet at the commons"));
  for (let i = 0; i < 4 && dmPlain === null; i++) {
    txA(SubType.IM, encodeDM(idB.fingerprint, idA.fingerprint, sealed));
    await delay(500);
  }
  await waitFor(() => dmPlain !== null, 5000);
  check("B decrypted A's DM", dmPlain === "meet at the commons", dmPlain ?? "(none)");

  // 3) Commons post A → B (HLC-ordered).
  log("• Commons post…");
  const hlc = new HybridLogicalClock();
  for (let i = 0; i < 4 && postText === null; i++) {
    txA(SubType.POST, encodeRoomMsg(MAIN_ROOM, encodeHlc(hlc.send()), idA.fingerprint, idA.handle, "hello commons"));
    await delay(500);
  }
  await waitFor(() => postText !== null, 5000);
  check("B received A's Commons post", postText === "hello commons", postText ?? "(none)");

  // 4) Network dedupe over real radio: send the SAME msg id twice; B delivers once.
  log("• dedupe (same msg id twice)…");
  const dupe = encodeFrame(
    SubType.POST,
    encodeRoomMsg(MAIN_ROOM, encodeHlc(hlc.send()), idA.fingerprint, idA.handle, "dupe-me"),
    { msgId: 0x0bad_f00d },
  );
  tA.sendFrame(dupe);
  await delay(150);
  tA.sendFrame(dupe);
  await delay(2500);
  check("duplicate msg id delivered exactly once", dedupeCount === 1, `delivered ${dedupeCount}x`);

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
