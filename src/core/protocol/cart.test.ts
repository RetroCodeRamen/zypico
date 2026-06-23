import { describe, expect, it } from "vitest";
import { deriveIdentity } from "@core/identity/index.ts";
import { decodeCart, decodeCartReq, encodeCart, encodeCartReq } from "./cart.ts";

describe("cart wire", () => {
  it("round-trips a signed cart (author, name, code) with provenance", async () => {
    const author = await deriveIdentity("CartSmith", "pw");
    const code = "function _draw() cls(1) print('HI', 2, 2, 7) end";
    const c = decodeCart(encodeCart(author, "HELLO", code));
    expect(c).not.toBeNull();
    expect(c!.author).toBe("CartSmith");
    expect(c!.authorFp).toBe(author.fingerprint);
    expect(c!.name).toBe("HELLO");
    expect(c!.code).toBe(code);
  });

  it("rejects a cart whose code was tampered after signing", async () => {
    const author = await deriveIdentity("CartSmith", "pw");
    const bytes = encodeCart(author, "X", "print('a',0,0,7)");
    bytes[bytes.length - 1] ^= 0xff; // flip a code byte (signed)
    expect(decodeCart(bytes)).toBeNull();
  });

  it("round-trips a cart request", async () => {
    const author = await deriveIdentity("CartSmith", "pw");
    const r = decodeCartReq(encodeCartReq(author.fingerprint, "HELLO"));
    expect(r).toEqual({ authorFp: author.fingerprint, name: "HELLO" });
  });
});
