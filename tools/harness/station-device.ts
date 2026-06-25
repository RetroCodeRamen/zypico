// On-hardware test for the device-as-Station firmware (station.cpp). Board A must
// be flashed with the station firmware (force it for the bench:
//   PLATFORMIO_BUILD_FLAGS="-D ZYPICO_FORCE_STATION" pio run -d firmware/heltec-v3 \
//     -t upload --upload-port /dev/ttyUSB0
// ). Board B runs the normal firmware; we drive it as a harness Traveler.
//
// Verifies (over real LoRa):
//  1. The station's signed STATION beacon decodes + VERIFIES via the TS decoder
//     — proving the firmware's C++ Ed25519 matches src/core/protocol/station.ts.
//  2. The station REPEATS a frame: we send a PRESENCE with hopLimit=2 straight
//     through B's transport (so B's RelayClient doesn't pre-dedupe it); the
//     station rebroadcasts it and B hears the relayed copy.
//
// Run: sg dialout -c "npx vite-node tools/harness/station-device.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import { decodeStationBeacon, encodeFrame, SubType } from "@core/protocol/index.ts";
import { decodePresence, encodePresence } from "@core/protocol/social.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_STATION = process.env.PORT_A ?? "/dev/ttyUSB0"; // the forced-station board
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";       // a normal traveler board

async function main(): Promise<void> {
  guard(90_000);
  const traveler = await deriveIdentity("RepeatTester", "pw");

  const tB = new SerialTransport(PORT_B);
  const b = new RelayClient(tB);

  let beacon: ReturnType<typeof decodeStationBeacon> = null;
  let repeatSeen = false;

  b.onInbound((f) => {
    if (f.subtype === SubType.STATION) {
      const s = decodeStationBeacon(f.payload); // returns null unless the sig verifies
      log(`  [STATION frame] payloadLen=${f.payload.length} decode=${s ? "OK" : "FAILED"} first16=${[...f.payload.slice(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
      if (s) beacon = s;
    } else if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (p?.fingerprint === traveler.fingerprint) repeatSeen = true; // our frame, relayed back by the station
    }
  });

  log(`station=${PORT_STATION}  traveler=${PORT_B}`);
  await b.connect();
  await delay(700);

  // 1) Hear + verify the station beacon (fires ~3s after the station boots, then ~60s).
  log("• waiting for a signed STATION beacon…");
  await waitFor(() => beacon !== null, 70_000);
  check("heard + VERIFIED a station beacon (C++ Ed25519 ↔ TS)", beacon !== null, beacon ? `name=${beacon.name} svc=${beacon.services}` : "(none)");

  // 2) Repeater: send PRESENCE hopLimit=2 straight through the transport (bypass
  //    RelayClient dedupe so we can hear the station's rebroadcast of it).
  log("• sending a hop-limit-2 frame for the station to repeat…");
  for (let i = 0; i < 4 && !repeatSeen; i++) {
    tB.sendFrame(encodeFrame(SubType.PRESENCE, encodePresence(traveler, 0, 0), { hopLimit: 2 }));
    await delay(2500);
  }
  await waitFor(() => repeatSeen, 4000);
  check("station repeated our frame (heard the relayed copy)", repeatSeen);

  await b.disconnect();
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
