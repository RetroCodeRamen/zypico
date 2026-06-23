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
  decodeCartReq, decodeMailAck, decodePageReq, decodeVaultReq, encodeStationBeacon,
  SERVICE, serviceTags, SubType, subTypeName,
} from "@core/protocol/index.ts";
import { decodeCommonsReq, decodePresence } from "@core/protocol/social.ts";
import { SerialTransport } from "../harness/SerialTransport.ts";
import { Mailbox } from "./mailbox.ts";
import { PageStore } from "./pagestore.ts";
import { CommonsLog } from "./commons.ts";
import { VaultStore } from "./vaultstore.ts";
import { CartStore } from "./cartstore.ts";

const PORT = process.env.ZYPICO_STATION_PORT ?? "/dev/ttyUSB0";
const NAME = process.env.ZYPICO_STATION_NAME ?? "HarborLight";
const ADMIN_PW = process.env.ZYPICO_STATION_PW ?? "change-me"; // admin creds (separate from any Traveler)
const BEACON_MS = 60_000;

// Services this Station offers — admin-configurable via ZYPICO_STATION_SERVICES
// (comma list, e.g. "mail,pages,commons"); defaults to everything we implement.
const SERVICE_BY_NAME: Record<string, number> = {
  repeat: SERVICE.REPEAT, mail: SERVICE.MAIL, pages: SERVICE.PAGES,
  commons: SERVICE.COMMONS, vault: SERVICE.VAULT, gateway: SERVICE.GATEWAY,
};
const SERVICES = process.env.ZYPICO_STATION_SERVICES
  ? process.env.ZYPICO_STATION_SERVICES.split(",").reduce((m, n) => m | (SERVICE_BY_NAME[n.trim().toLowerCase()] ?? 0), 0)
  : SERVICE.REPEAT | SERVICE.MAIL | SERVICE.PAGES | SERVICE.COMMONS | SERVICE.VAULT;

const log = (s: string) => process.stderr.write(`[station] ${s}\n`);

async function main(): Promise<void> {
  // The Station's identity is derived from its name + admin password — the admin
  // login. It is NOT a Traveler identity.
  const id = await deriveIdentity(NAME, ADMIN_PW);
  const client = new RelayClient(new SerialTransport(PORT));
  const base = process.env.ZYPICO_STATION_STORE ?? `tools/station/.mailbox-${id.fingerprint}`;
  const mailbox = new Mailbox(`${base}.json`);
  const pages = new PageStore(`${base}.pages.json`);
  const commons = new CommonsLog(50, `${base}.commons.json`);
  const vaults = new VaultStore(`${base}.vaults.json`);
  const carts = new CartStore(`${base}.carts.json`);

  client.onInbound((f) => {
    if (f.subtype === SubType.MAIL) {
      // Hold the (opaque) mail; we forward it when the recipient appears.
      if (mailbox.store(f.payload)) log(`held mail (now ${mailbox.count})`);
    } else if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (!p) return;
      const pending = mailbox.forwardFor(p.fingerprint);
      for (const payload of pending) client.send(SubType.MAIL, payload);
      if (pending.length) log(`forwarded ${pending.length} mail to ${p.handle} (${p.fingerprint})`);
    } else if (f.subtype === SubType.MAIL_ACK) {
      const ack = decodeMailAck(f.payload);
      if (ack && mailbox.drop(ack.recipientFp, ack.mailId)) log(`mail acked + dropped (now ${mailbox.count})`);
    } else if (f.subtype === SubType.PAGE) {
      // Cache pages we overhear / are published to us (newest per owner).
      if (pages.put(f.payload)) log(`hosting page (now ${pages.count})`);
    } else if (f.subtype === SubType.PAGE_REQ) {
      const r = decodePageReq(f.payload);
      const hosted = r && pages.get(r.ownerFp);
      if (hosted) { client.send(SubType.PAGE, hosted); log(`served hosted page for ${r!.ownerFp}`); }
    } else if (f.subtype === SubType.POST) {
      if (commons.add(f.payload)) log(`commons retained (now ${commons.count})`);
    } else if (f.subtype === SubType.COMMONS_REQ) {
      decodeCommonsReq(f.payload); // (room id; single room today)
      const recent = commons.recent(20);
      for (const payload of recent) client.send(SubType.POST, payload);
      if (recent.length) log(`backfilled ${recent.length} Commons posts`);
    } else if (f.subtype === SubType.VAULT_PUT) {
      // Store the opaque ciphertext; we can never read it.
      if (vaults.put(f.payload)) log(`vault stored (now ${vaults.count})`);
    } else if (f.subtype === SubType.VAULT_REQ) {
      const r = decodeVaultReq(f.payload);
      const held = r && vaults.get(r.ownerFp);
      if (held) { client.send(SubType.VAULT, held); log(`served vault for ${r!.ownerFp}`); }
    } else if (f.subtype === SubType.CART) {
      if (carts.put(f.payload)) log(`hosting cart (now ${carts.count})`);
    } else if (f.subtype === SubType.CART_REQ) {
      const r = decodeCartReq(f.payload);
      const held = r && carts.get(r.authorFp, r.name);
      if (held) { client.send(SubType.CART, held); log(`served cart ${r!.name}`); }
    } else {
      log(`rx ${subTypeName(f.subtype)} (${f.payload.length}B, ${f.hops} hops)`);
    }
  });

  await client.connect();
  log(`"${NAME}" up on ${PORT}  id=${id.fingerprint}  services=[${serviceTags(SERVICES).join(" ")}]  held=${mailbox.count} pages=${pages.count}`);

  const beacon = () => client.send(SubType.STATION, encodeStationBeacon(id, SERVICES));
  beacon();
  const iv = setInterval(beacon, BEACON_MS);

  const stop = () => { clearInterval(iv); void client.disconnect().finally(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
