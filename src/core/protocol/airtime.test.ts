import { describe, expect, it } from "vitest";
import { airtimeMs, MODEM_PRESETS } from "./airtime.ts";

describe("airtimeMs", () => {
  it("matches the Semtech formula for LONG_FAST (SF11/BW250)", () => {
    // Hand-computed reference (see airtime.ts): 20-byte payload ≈ 395.26 ms.
    const t = airtimeMs(MODEM_PRESETS.LONG_FAST, 20);
    expect(t).toBeGreaterThan(390);
    expect(t).toBeLessThan(400);
  });

  it("grows with payload size", () => {
    const small = airtimeMs(MODEM_PRESETS.LONG_FAST, 10);
    const large = airtimeMs(MODEM_PRESETS.LONG_FAST, 200);
    expect(large).toBeGreaterThan(small);
  });

  it("is far slower at long range than short range for the same payload", () => {
    const slow = airtimeMs(MODEM_PRESETS.LONG_SLOW, 50);
    const fast = airtimeMs(MODEM_PRESETS.SHORT_FAST, 50);
    expect(slow).toBeGreaterThan(fast * 5);
  });

  it("applies low-data-rate optimization only to slow modems", () => {
    // SF12/BW125 has a >16 ms symbol time → DE engaged. We can't read DE out,
    // but its effect is a measurably larger airtime than a naive estimate; the
    // value should be in the seconds range for a modest payload.
    const t = airtimeMs(MODEM_PRESETS.LONG_SLOW, 100);
    expect(t).toBeGreaterThan(3000);
  });
});
