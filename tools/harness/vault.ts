// Real-radio test of Account Vaults (DESIGN §5.4) across both boards:
//   Board A = a Station storing opaque vault ciphertext.
//   Board B = the owner: backs up (seal-to-self → VAULT_PUT), then restores
//             (VAULT_REQ → receive → decrypt) and checks it round-trips.
// (Small blob + direct send here; real vaults fragment via the normal send path.)
//
// Run: sg dialout -c "npx vite-node tools/harness/vault.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { decodeVault, decodeVaultReq, encodeFrame, encodeVault, encodeVaultReq, SubType } from "@core/protocol/index.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { VaultStore } from "../station/vaultstore.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";

async function main(): Promise<void> {
  guard(40_000);
  const me = await deriveIdentity("VaultOwner", "secret-pw");
  const secret = JSON.stringify({ v: 1, wisp: "Ember", buddies: 3 });

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA); // the Station
  const b = new RelayClient(tB); // the owner
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  // Board A behaves as a VAULT Station: store ciphertext, serve on request.
  const vaults = new VaultStore();
  a.onInbound((f) => {
    if (f.subtype === SubType.VAULT_PUT) vaults.put(f.payload);
    else if (f.subtype === SubType.VAULT_REQ) {
      const r = decodeVaultReq(f.payload);
      const held = r && vaults.get(r.ownerFp);
      if (held) txA(SubType.VAULT, held);
    }
  });

  // Board B (owner) receives + decrypts its returned vault.
  let restored: string | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.VAULT) return;
    const v = decodeVault(f.payload);
    if (!v || v.ownerFp !== me.fingerprint) return;
    const opened = open(me.secretKey, me.publicKey, v.ciphertext);
    if (opened) restored = new TextDecoder().decode(opened);
  });

  log(`A(station)=${PORT_A}  B(owner)=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  // Phase 1: back up (sealed to self) to the Station.
  log("Owner → backing up (encrypted) to the Station…");
  const sealed = seal(me.secretKey, me.publicKey, new TextEncoder().encode(secret));
  txB(SubType.VAULT_PUT, encodeVault(me.fingerprint, Date.now(), sealed));
  await delay(2000);
  check("Station stored the vault (opaque)", vaults.count === 1, `count=${vaults.count}`);

  // Phase 2: restore — fetch + decrypt.
  log("Owner → restoring from the Station…");
  for (let i = 0; i < 3 && restored === null; i++) {
    txB(SubType.VAULT_REQ, encodeVaultReq(me.fingerprint));
    await delay(2500);
  }
  await waitFor(() => restored !== null, 4000);

  check("owner restored its vault from the Station", restored !== null);
  check("vault decrypts to the original (only the owner can)", restored === secret, restored ?? "(none)");

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
