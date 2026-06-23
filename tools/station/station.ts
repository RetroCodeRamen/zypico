// ZyPico Station — the "full Station" (DESIGN §3.1): a persistent Node process
// wired to a Heltec board over USB serial, running the real RelayClient + the
// RelayProtocol. It advertises itself + its services and (in later M7 slices)
// stores-and-forwards Mail, hosts Pages, deepens the Commons, and holds Vaults.
//
// A Station is just an always-on node; the network runs fine with zero of them.
// Run (persistent — Ctrl-C to stop):
//   sg dialout -c "ZYPICO_STATION_NAME=HarborLight npx vite-node tools/station/station.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import {
  encodeStationBeacon, SERVICE, serviceTags, SubType, subTypeName,
} from "@core/protocol/index.ts";
import { SerialTransport } from "../harness/SerialTransport.ts";

const PORT = process.env.ZYPICO_STATION_PORT ?? "/dev/ttyUSB0";
const NAME = process.env.ZYPICO_STATION_NAME ?? "HarborLight";
const ADMIN_PW = process.env.ZYPICO_STATION_PW ?? "change-me"; // admin creds (separate from any Traveler)
const BEACON_MS = 60_000;

// Services this Station offers. REPEAT is inherent (every board repeats); the
// rest are wired up across the M7 slices.
const SERVICES = SERVICE.REPEAT | SERVICE.MAIL | SERVICE.PAGES | SERVICE.COMMONS;

const log = (s: string) => process.stderr.write(`[station] ${s}\n`);

async function main(): Promise<void> {
  // The Station's identity is derived from its name + admin password — the admin
  // login. It is NOT a Traveler identity.
  const id = await deriveIdentity(NAME, ADMIN_PW);
  const client = new RelayClient(new SerialTransport(PORT));

  client.onInbound((f) => {
    // Slice 1 just observes; later slices act on MAIL/PAGE_REQ/etc.
    log(`rx ${subTypeName(f.subtype)} (${f.payload.length}B, ${f.hops} hops)`);
  });

  await client.connect();
  log(`"${NAME}" up on ${PORT}  id=${id.fingerprint}  services=[${serviceTags(SERVICES).join(" ")}]`);

  const beacon = () => client.send(SubType.STATION, encodeStationBeacon(id, SERVICES));
  beacon();
  const iv = setInterval(beacon, BEACON_MS);

  const stop = () => { clearInterval(iv); void client.disconnect().finally(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
