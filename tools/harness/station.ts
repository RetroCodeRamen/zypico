// Real-radio test: a Station beacons; a Traveler (B) must hear + verify it.
// Exercises the M7 STATION beacon path on the actual radios.
//
// Run: sg dialout -c "npx vite-node tools/harness/station.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import {
  decodeStationBeacon, encodeFrame, encodeStationBeacon, SERVICE, serviceTags,
  SubType, type StationBeacon,
} from "@core/protocol/index.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

async function main(): Promise<void> {
  guard(40_000);
  const station = await deriveIdentity("HarborLight", "admin-pw");
  const services = SERVICE.REPEAT | SERVICE.MAIL | SERVICE.PAGES;

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA);
  const b = new RelayClient(tB);
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  let heard: StationBeacon | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.STATION) return;
    const s = decodeStationBeacon(f.payload);
    if (s?.fingerprint === station.fingerprint) heard = s;
  });

  log(`A(station)=${PORT_A}  B(traveler)=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  log("Station → beaconing…");
  for (let i = 0; i < 4 && heard === null; i++) {
    txA(SubType.STATION, encodeStationBeacon(station, services));
    await delay(800);
  }
  await waitFor(() => heard !== null, 5000);

  check("Traveler heard the Station beacon", heard !== null);
  const s = heard as StationBeacon | null;
  if (s) {
    check("station name", s.name === "HarborLight", s.name);
    check("verified fingerprint", s.fingerprint === station.fingerprint, s.fingerprint);
    check("services advertised", serviceTags(s.services).join(" ") === "REPEAT MAIL PAGES", serviceTags(s.services).join(" "));
  }

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
