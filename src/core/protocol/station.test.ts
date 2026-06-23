import { describe, expect, it } from "vitest";
import { deriveIdentity } from "@core/identity/index.ts";
import { decodeStationBeacon, encodeStationBeacon, SERVICE, serviceTags } from "./station.ts";

describe("station beacon", () => {
  it("round-trips name, fingerprint, and services, verifying the signature", async () => {
    const st = await deriveIdentity("HarborLight", "admin-pw");
    const services = SERVICE.REPEAT | SERVICE.MAIL | SERVICE.PAGES;
    const b = decodeStationBeacon(encodeStationBeacon(st, services));
    expect(b).not.toBeNull();
    expect(b!.name).toBe("HarborLight");
    expect(b!.fingerprint).toBe(st.fingerprint);
    expect(b!.services).toBe(services);
    expect(serviceTags(b!.services)).toEqual(["REPEAT", "MAIL", "PAGES"]);
  });

  it("rejects a beacon whose services were tampered after signing", async () => {
    const st = await deriveIdentity("HarborLight", "admin-pw");
    const bytes = encodeStationBeacon(st, SERVICE.MAIL);
    bytes[bytes.length - 1] ^= 0xff; // flip the services byte (signed)
    expect(decodeStationBeacon(bytes)).toBeNull();
  });
});
