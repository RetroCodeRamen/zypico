import { describe, expect, it } from "vitest";
import { deriveIdentity, open, seal } from "@core/identity/index.ts";
import { decodeMail, decodeMailAck, encodeMail, encodeMailAck } from "./mail.ts";

describe("mail envelope", () => {
  it("round-trips addressing, id, sender handle, and a sealed body", async () => {
    const a = await deriveIdentity("Sender", "pw-a");
    const b = await deriveIdentity("Recipient", "pw-b");
    const sealed = seal(a.secretKey, b.publicKey, new TextEncoder().encode("see you at the commons"));
    const env = decodeMail(encodeMail(b.fingerprint, a.fingerprint, 0xcafe1234, a.handle, sealed));
    expect(env).not.toBeNull();
    expect(env!.recipientFp).toBe(b.fingerprint);
    expect(env!.senderFp).toBe(a.fingerprint);
    expect(env!.mailId).toBe(0xcafe1234);
    expect(env!.senderHandle).toBe("Sender");
    // only the recipient can open it, and it authenticates the sender
    const opened = open(b.secretKey, a.publicKey, env!.sealed);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe("see you at the commons");
  });

  it("rejects a too-short mail", () => {
    expect(decodeMail(new Uint8Array(8))).toBeNull();
  });
});

describe("mail ack", () => {
  it("round-trips recipient + mailId", async () => {
    const b = await deriveIdentity("Recipient", "pw-b");
    const ack = decodeMailAck(encodeMailAck(b.fingerprint, 0xcafe1234));
    expect(ack).not.toBeNull();
    expect(ack!.recipientFp).toBe(b.fingerprint);
    expect(ack!.mailId).toBe(0xcafe1234);
  });
});
