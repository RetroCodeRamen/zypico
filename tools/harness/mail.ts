// Real-radio test: B mails A over LoRa; A must receive, decrypt, and read it.
// Exercises the M6 MAIL path (sealed, addressed) on the actual radios.
//
// Run: sg dialout -c "npx vite-node tools/harness/mail.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { decodeMail, encodeFrame, encodeMail, SubType } from "@core/protocol/index.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

async function main(): Promise<void> {
  guard(40_000);
  const idA = await deriveIdentity("MailRecipient", "pw-a");
  const idB = await deriveIdentity("MailSender", "pw-b");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA);
  const b = new RelayClient(tB);
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  let received: string | null = null;
  a.onInbound((f) => {
    if (f.subtype !== SubType.MAIL) return;
    const env = decodeMail(f.payload);
    if (!env || env.recipientFp !== idA.fingerprint) return;
    const opened = open(idA.secretKey, idB.publicKey, env.sealed);
    if (opened) received = fromUtf8(opened);
  });

  log(`A=${PORT_A}  B=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  log("B → mailing A…");
  const mailId = 0x5a17_c0de;
  const sealed = seal(idB.secretKey, idA.publicKey, utf8("posted from across the relay"));
  for (let i = 0; i < 3 && received === null; i++) {
    txB(SubType.MAIL, encodeMail(idA.fingerprint, idB.fingerprint, mailId, idB.handle, sealed));
    await delay(2500);
  }
  await waitFor(() => received !== null, 4000);

  check("A received B's mail over LoRa", received !== null);
  check("mail decrypts to the sent body", received === "posted from across the relay", received ?? "(none)");

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
