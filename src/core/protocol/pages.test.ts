import { describe, expect, it } from "vitest";
import { deriveIdentity } from "@core/identity/index.ts";
import {
  decodeGuestbook, decodePage, decodePageReq,
  encodeGuestbook, encodePage, encodePageReq,
} from "./pages.ts";

describe("page request", () => {
  it("round-trips the owner fingerprint", async () => {
    const id = await deriveIdentity("Owner", "pw");
    const r = decodePageReq(encodePageReq(id.fingerprint));
    expect(r?.ownerFp).toBe(id.fingerprint);
  });
});

describe("traveler page", () => {
  it("round-trips a signed page (handle, tagline, about, freshness)", async () => {
    const id = await deriveIdentity("WonkyTanuki", "pw");
    const at = 1_718_000_000_000;
    const p = decodePage(encodePage(id, "exploring the relay", "i like long walks across the mesh", at));
    expect(p).not.toBeNull();
    expect(p!.handle).toBe("WonkyTanuki");
    expect(p!.fingerprint).toBe(id.fingerprint);
    expect(p!.tagline).toBe("exploring the relay");
    expect(p!.about).toBe("i like long walks across the mesh");
    expect(Math.floor(p!.updatedAt / 1000)).toBe(Math.floor(at / 1000)); // second precision
  });

  it("rejects a page whose contents were tampered after signing", async () => {
    const id = await deriveIdentity("Tanuki", "pw");
    const bytes = encodePage(id, "tag", "about", Date.now());
    bytes[bytes.length - 1] ^= 0xff; // flip an updatedAt byte (signed)
    expect(decodePage(bytes)).toBeNull();
  });
});

describe("guestbook entry", () => {
  it("round-trips a signed entry addressed to the owner", async () => {
    const owner = await deriveIdentity("Owner", "pw-o");
    const visitor = await deriveIdentity("Visitor", "pw-v");
    const g = decodeGuestbook(encodeGuestbook(owner.fingerprint, visitor, "great page!"));
    expect(g).not.toBeNull();
    expect(g!.ownerFp).toBe(owner.fingerprint);
    expect(g!.signerFp).toBe(visitor.fingerprint);
    expect(g!.handle).toBe("Visitor");
    expect(g!.text).toBe("great page!");
  });

  it("rejects a forged guestbook signature", async () => {
    const owner = await deriveIdentity("Owner", "pw-o");
    const visitor = await deriveIdentity("Visitor", "pw-v");
    const bytes = encodeGuestbook(owner.fingerprint, visitor, "hi");
    bytes[bytes.length - 1] ^= 0xff; // corrupt the text (covered by the sig)
    expect(decodeGuestbook(bytes)).toBeNull();
  });
});
