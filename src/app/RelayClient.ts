// RelayClient — the coordinator between RelayProtocol and a MeshTransport.
//
// Outbound: an arbitrary typed frame (PRESENCE, IM/DM, …) is paced by the
// airtime governor and fragmented if it overflows one transmission. Inbound:
// every packet is de-duplicated and, if fragmented, reassembled, then the
// decoded frame is surfaced for the social layer (presence, DM) to interpret.
// Message *meaning* (text, encryption, addressing) lives above this seam.

import {
  AirtimeGovernor,
  DedupeCache,
  decodeFrame,
  decrementHop,
  DEFAULT_HOPS,
  encodeFrame,
  FRAG_HEADER_LEN,
  fragmentToFrames,
  HEADER_LEN,
  MODEM_PRESETS,
  peekEnvelope,
  Priority,
  Reassembler,
  SubType,
} from "@core/protocol/index.ts";
import {
  Emitter,
  type Destination,
  type InboundFrame,
  type MeshTransport,
  type TransportStatus,
} from "@transport/index.ts";

// Conservative on-air budget (outline §11.1: ≤180 B working). A fragment goes on
// air as the common header + the fragment header + a chunk, so each chunk must
// leave room for both or a fragmented transfer would overflow one transmission.
const MAX_ONAIR = 180;
const MAX_FRAME_PAYLOAD = MAX_ONAIR - HEADER_LEN - FRAG_HEADER_LEN;

/** A decoded inbound frame, for higher layers (presence, DM) to interpret. */
export interface InboundDecoded {
  from: number;
  subtype: SubType;
  payload: Uint8Array;
  at: Date;
  /** Hops travelled to reach us: 0 = heard directly (Nearby), ≥1 = via the Relay. */
  hops: number;
}

interface SendMeta {
  destination: Destination;
  wantAck: boolean;
}

export class RelayClient {
  private unsubs: Array<() => void> = [];
  private readonly inbound = new Emitter<InboundDecoded>();

  // Protocol spine (plan §5).
  private readonly dedupe = new DedupeCache();
  private readonly reassembler = new Reassembler();
  private readonly governor: AirtimeGovernor;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly transport: MeshTransport) {
    // The governor must model the BOARD's real modem (SF9/BW250 — see
    // MODEM_PRESETS.ZYPICO), or it mischarges airtime. Duty is 25%: ZyPico is a
    // small personal mesh on US915 (no EU 1% rule; FCC dwell-time of 400ms/tx is
    // satisfied since a 40B frame is ~207ms). At 1% with the wrong SF11 estimate,
    // chat starved — a board could receive but its own sends never drained. 25%
    // gives sub-second/frame plus a multi-frame burst. (Region-aware later.)
    this.governor = new AirtimeGovernor({ modem: MODEM_PRESETS.ZYPICO, dutyCycle: 0.25 });
  }

  get status(): TransportStatus {
    return this.transport.status;
  }

  get selfNodeNum(): number | undefined {
    return this.transport.selfNodeNum;
  }

  /** Queued frames waiting on the airtime governor (for a UI "sending…" hint). */
  get pending(): number {
    return this.governor.queueLength;
  }

  /** Raw decoded frames (presence, DM, …) for the social layer to route. */
  onInbound(handler: (frame: InboundDecoded) => void): () => void {
    return this.inbound.on(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    return this.transport.onStatus(handler);
  }

  /**
   * Broadcast an arbitrary typed frame (e.g. PRESENCE, IM/DM). `repeats` resends
   * the SAME frame (identical msgId) a few times, spaced out — broadcasts are
   * unacked and a single LoRa frame is sometimes lost, so a small amount of
   * redundancy makes delivery reliable; the receiver dedupes, so no duplicate
   * messages appear. Only use on small (single-on-air) frames.
   */
  send(subtype: SubType, payload: Uint8Array, priority: Priority = Priority.INTERACTIVE, repeats = 0): void {
    const msgId = (Math.random() * 0x1_0000_0000) >>> 0;
    // Record our own id so the frame's mesh echo (and our repeat of it) dedupes.
    this.dedupe.check(String(msgId));
    const frame = encodeFrame(subtype, payload, { msgId });
    const meta: SendMeta = { destination: "broadcast", wantAck: false };
    this.enqueueFrame(frame, meta, priority);
    for (let i = 1; i <= repeats && frame.length <= MAX_ONAIR; i++) {
      setTimeout(() => this.enqueueFrame(frame, meta, priority), i * 700);
    }
  }

  async connect(): Promise<void> {
    this.unsubs.push(this.transport.onFrame((f) => this.handleInbound(f)));
    await this.transport.connect();
  }

  async disconnect(): Promise<void> {
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = undefined;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    await this.transport.disconnect();
  }

  // Hand a complete RelayProtocol frame to the governor — directly if it fits a
  // single transmission, else split into FRAG frames (lower priority, since a
  // bulk transfer must never starve interactive traffic).
  private enqueueFrame(frame: Uint8Array, meta: SendMeta, priority: Priority): void {
    if (frame.length <= MAX_ONAIR) {
      this.governor.enqueue(frame, { priority, meta });
    } else {
      const msgId = (Math.random() * 0xffff_ffff) >>> 0;
      for (const f of fragmentToFrames(msgId, frame, MAX_FRAME_PAYLOAD)) {
        this.governor.enqueue(f, { priority: Priority.BULK, meta });
      }
    }
    this.pump();
  }

  // Drain everything the airtime bucket can afford now, then schedule the next
  // wakeup for whatever remains queued — traffic leaves at a lawful rate.
  private pump(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    this.governor.drain((ready) => {
      const meta = ready.meta as SendMeta;
      void this.transport
        .sendFrame(ready.payload, { destination: meta.destination, wantAck: meta.wantAck })
        .catch((err) => console.error("[RelayClient] send failed:", err));
    });
    const wait = this.governor.msUntilNext();
    if (wait !== undefined) {
      this.pumpTimer = setTimeout(() => this.pump(), Math.max(wait, 0));
    }
  }

  private handleInbound(f: InboundFrame): void {
    // Network-wide dedupe on the stable msg id (it survives every hop), before
    // any work — a flood reaches us by many paths and our repeats echo back.
    const env = peekEnvelope(f.payload);
    if (!env) return; // too short / future major — not ours to handle
    if (!this.dedupe.check(String(env.msgId))) return;

    // Multi-hop repeat (DESIGN §4.3): rebroadcast onward with one less hop,
    // before consuming — so range extends even for sub-types we can't decode.
    // The dedupe above guarantees we never repeat the same frame twice or loop.
    if (env.hopLimit > 1) {
      // Rebroadcast after a short random delay (Meshtastic-style). Repeating
      // immediately makes this node deaf (half-duplex TX) right when the sender's
      // next frame arrives — which dropped frames during bursts; jitter staggers
      // repeats so they don't collide with the originator or each other.
      const repeat = decrementHop(f.payload);
      setTimeout(() => {
        this.governor.enqueue(repeat, { priority: Priority.BULK, meta: { destination: "broadcast", wantAck: false } });
        this.pump();
      }, 250 + Math.random() * 750);
    }

    const hops = Math.max(0, DEFAULT_HOPS - env.hopLimit);
    const res = decodeFrame(f.payload);
    if (!res.ok) return; // unknown sub-type / incompatible version — skip

    if (res.frame.subtype === SubType.FRAG) {
      const result = this.reassembler.accept(res.frame.payload);
      if (result.status !== "complete") return;
      const inner = decodeFrame(result.data);
      if (inner.ok) this.inbound.emit({ from: f.from, subtype: inner.frame.subtype, payload: inner.frame.payload, at: f.rxTime, hops });
      return;
    }
    this.inbound.emit({ from: f.from, subtype: res.frame.subtype, payload: res.frame.payload, at: f.rxTime, hops });
  }
}
