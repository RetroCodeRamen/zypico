// LoRa time-on-air estimate (Semtech AN1200.13 / datasheet formula).
//
// The airtime governor (governor.ts) needs to know, before transmitting, how
// many milliseconds a frame will occupy the channel. That cost depends entirely
// on the LoRa modem settings (spreading factor, bandwidth, coding rate), not on
// the application. This is the canonical, exact formula; given correct modem
// params it matches a node's real on-air time closely enough to budget against.
//
// Symbol time:     T_sym = 2^SF / BW
// Preamble time:   T_pre = (n_preamble + 4.25) * T_sym
// Payload symbols: n = 8 + max( ceil( (8*PL - 4*SF + 28 + 16*CRC - 20*IH)
//                                      / (4*(SF - 2*DE)) ) * (CR + 4), 0 )
// Payload time:    T_pay = n * T_sym
// Time on air:     ToA   = T_pre + T_pay

export interface ModemParams {
  /** Spreading factor 7..12. */
  spreadingFactor: number;
  /** Bandwidth in Hz (e.g. 125000, 250000). */
  bandwidthHz: number;
  /** Coding rate denominator offset: 1=4/5, 2=4/6, 3=4/7, 4=4/8. */
  codingRate: 1 | 2 | 3 | 4;
  /** Preamble length in symbols (Meshtastic uses 16). */
  preambleSymbols: number;
  /** Payload CRC enabled (Meshtastic: true). */
  crc: boolean;
  /** Implicit (no) header. Meshtastic uses an explicit header → false. */
  implicitHeader: boolean;
}

// Meshtastic modem presets (subset). Values follow Meshtastic's LoRa config.
export const MODEM_PRESETS = {
  // The Meshtastic default. SF11 / 250 kHz is a good range/throughput balance.
  LONG_FAST: {
    spreadingFactor: 11,
    bandwidthHz: 250_000,
    codingRate: 1,
    preambleSymbols: 16,
    crc: true,
    implicitHeader: false,
  },
  // Maximum range, minimum throughput — the slowest (most airtime-hungry) link.
  LONG_SLOW: {
    spreadingFactor: 12,
    bandwidthHz: 125_000,
    codingRate: 1,
    preambleSymbols: 16,
    crc: true,
    implicitHeader: false,
  },
  // Short range, fast — least airtime per frame.
  SHORT_FAST: {
    spreadingFactor: 7,
    bandwidthHz: 250_000,
    codingRate: 1,
    preambleSymbols: 16,
    crc: true,
    implicitHeader: false,
  },
  // ZyPico's actual on-air settings — MUST match firmware (main.cpp: LORA_SF=9,
  // LORA_BW=250, LORA_CR=5→4/5, LORA_PREAMBLE=8). The governor estimates airtime
  // from THIS, so a mismatch mischarges every send (it did: LONG_FAST/SF11 made
  // the governor think frames cost ~3× their real airtime). ~207ms for a 40B frame.
  ZYPICO: {
    spreadingFactor: 9,
    bandwidthHz: 250_000,
    codingRate: 1,
    preambleSymbols: 8,
    crc: true,
    implicitHeader: false,
  },
} as const satisfies Record<string, ModemParams>;

/** Time on air, in milliseconds, for a PHY payload of `payloadBytes`. */
export function airtimeMs(params: ModemParams, payloadBytes: number): number {
  const { spreadingFactor: sf, bandwidthHz: bw, codingRate: cr } = params;
  const tSym = 2 ** sf / bw; // seconds
  // Low Data Rate Optimization is mandated when symbol time exceeds ~16 ms
  // (SF11/SF12 at narrow bandwidths); it costs throughput but is required.
  const de = tSym > 0.016 ? 1 : 0;
  const ih = params.implicitHeader ? 1 : 0;
  const crc = params.crc ? 1 : 0;

  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * crc - 20 * ih;
  const denominator = 4 * (sf - 2 * de);
  const payloadSymbols = 8 + Math.max(Math.ceil(numerator / denominator) * (cr + 4), 0);

  const tPreamble = (params.preambleSymbols + 4.25) * tSym;
  const tPayload = payloadSymbols * tSym;
  return (tPreamble + tPayload) * 1000;
}
