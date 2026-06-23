// Real-radio test: board A broadcasts a presence beacon; board B's RelayClient
// must hear + decode it over LoRa (handle, fingerprint, Wisp form, location),
// heard directly (Nearby, hops = 0). Exercises the actual M4 presence v2 path.
//
// Run: sg dialout -c "npx vite-node tools/harness/presence.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity } from "@core/identity/index.ts";
import { SubType } from "@core/protocol/index.ts";
import { decodePresence, encodePresence, type Presence } from "@core/protocol/social.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

interface Heard { p: Presence; hops: number }

async function main(): Promise<void> {
  const idA = await deriveIdentity("AlphaTester", "pw-a");

  const a = new RelayClient(new SerialTransport(PORT_A));
  const b = new RelayClient(new SerialTransport(PORT_B));

  let heard: Heard | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.PRESENCE) return;
    const p = decodePresence(f.payload);
    if (p && p.fingerprint === idA.fingerprint) heard = { p, hops: f.hops };
  });

  log(`A=${PORT_A}  B=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700); // let the read streams settle

  log("A → broadcasting presence (handle AlphaTester, form 7, place 0 = Commons)…");
  for (let i = 0; i < 5 && heard === null; i++) {
    a.send(SubType.PRESENCE, encodePresence(idA, 7, 0));
    await delay(500);
  }
  await waitFor(() => heard !== null, 6000);

  check("B heard A's presence over LoRa", heard !== null);
  const h = heard as Heard | null;
  if (h) {
    check("handle round-trips", h.p.handle === "AlphaTester", h.p.handle);
    check("fingerprint matches A", h.p.fingerprint === idA.fingerprint, h.p.fingerprint);
    check("Wisp form index carried", h.p.formIndex === 7, String(h.p.formIndex));
    check("location (place) carried", h.p.placeId === 0, String(h.p.placeId));
    check("heard directly (Nearby, hops=0)", h.hops === 0, `hops=${h.hops}`);
  }

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
