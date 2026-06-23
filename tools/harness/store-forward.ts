// Real-radio test of Mail store-and-forward (DESIGN §4.4) across both boards:
//   Board A = a Station (holds + forwards mail).
//   Board B = the sender, then later the recipient (same radio, two identities).
// Sender mails the recipient ONCE while the recipient is absent; the Station
// holds it; when the recipient appears (presence) the Station forwards it; the
// recipient receives, opens, and acks; the Station drops it.
//
// Run: sg dialout -c "npx vite-node tools/harness/store-forward.ts"

import { RelayClient } from "@app/RelayClient.ts";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { decodeMail, decodeMailAck, encodeFrame, encodeMail, encodeMailAck, SubType } from "@core/protocol/index.ts";
import { decodePresence, encodePresence, PLACE_HOME } from "@core/protocol/social.ts";
import { SerialTransport } from "./SerialTransport.ts";
import { Mailbox } from "../station/mailbox.ts";
import { check, delay, finish, guard, log, waitFor } from "./lib.ts";

const PORT_A = process.env.PORT_A ?? "/dev/ttyUSB0";
const PORT_B = process.env.PORT_B ?? "/dev/ttyUSB1";
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

async function main(): Promise<void> {
  guard(45_000);
  const sender = await deriveIdentity("Sender", "pw-s");
  const recipient = await deriveIdentity("Recipient", "pw-r");

  const tA = new SerialTransport(PORT_A);
  const tB = new SerialTransport(PORT_B);
  const a = new RelayClient(tA); // the Station
  const b = new RelayClient(tB); // sender, then recipient
  const txA = (s: SubType, p: Uint8Array) => tA.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));
  const txB = (s: SubType, p: Uint8Array) => tB.sendFrame(encodeFrame(s, p, { hopLimit: 1 }));

  // Board A behaves as a Station: hold mail, forward on presence, drop on ack.
  const mailbox = new Mailbox();
  a.onInbound((f) => {
    if (f.subtype === SubType.MAIL) mailbox.store(f.payload);
    else if (f.subtype === SubType.PRESENCE) {
      const p = decodePresence(f.payload);
      if (p) for (const payload of mailbox.forwardFor(p.fingerprint)) txA(SubType.MAIL, payload);
    } else if (f.subtype === SubType.MAIL_ACK) {
      const ack = decodeMailAck(f.payload);
      if (ack) mailbox.drop(ack.recipientFp, ack.mailId);
    }
  });

  // Board B as the recipient: receive forwarded mail + open it.
  let got: string | null = null;
  b.onInbound((f) => {
    if (f.subtype !== SubType.MAIL) return;
    const env = decodeMail(f.payload);
    if (!env || env.recipientFp !== recipient.fingerprint) return;
    const opened = open(recipient.secretKey, sender.publicKey, env.sealed);
    if (opened) got = fromUtf8(opened);
  });

  log(`A(station)=${PORT_A}  B(sender→recipient)=${PORT_B}`);
  await a.connect();
  await b.connect();
  await delay(700);

  // Phase 1: sender mails the (absent) recipient, exactly once.
  log("Sender → mailing the absent recipient (once)…");
  const mailId = 0x00ab_cdef;
  const sealed = seal(sender.secretKey, recipient.publicKey, utf8("held for you at the station"));
  txB(SubType.MAIL, encodeMail(recipient.fingerprint, sender.fingerprint, mailId, sender.handle, sealed));
  await delay(2000);
  check("Station held the mail", mailbox.count === 1, `count=${mailbox.count}`);
  check("recipient has NOT received it yet", got === null);

  // Phase 2: recipient appears → the Station forwards the held mail.
  log("Recipient → appears (presence); Station should forward…");
  for (let i = 0; i < 4 && got === null; i++) {
    txB(SubType.PRESENCE, encodePresence(recipient, 0, PLACE_HOME));
    await delay(2500);
  }
  await waitFor(() => got !== null, 4000);
  check("recipient received the held mail via the Station", got === "held for you at the station", got ?? "(none)");

  // Phase 3: recipient acks → the Station drops it.
  log("Recipient → ack; Station should drop…");
  for (let i = 0; i < 3 && mailbox.count > 0; i++) {
    txB(SubType.MAIL_ACK, encodeMailAck(recipient.fingerprint, mailId));
    await delay(1500);
  }
  check("Station dropped the mail after ack", mailbox.count === 0, `count=${mailbox.count}`);

  await a.disconnect();
  await b.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
