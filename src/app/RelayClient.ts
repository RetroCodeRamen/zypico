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
  encodeFrame,
  fragmentToFrames,
  frameKey,
  MODEM_PRESETS,
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

// Conservative on-air budget (outline §11.1: ≤180 B working). A frame is the
// 3-byte header plus its payload, so the payload we hand to encodeFrame caps at
// 177; fragmentation chunks inside that again (see protocol/fragment.ts).
const MAX_ONAIR = 180;
const MAX_FRAME_PAYLOAD = MAX_ONAIR - 3;

/** A decoded inbound frame, for higher layers (presence, DM) to interpret. */
export interface InboundDecoded {
  from: number;
  subtype: SubType;
  payload: Uint8Array;
  at: Date;
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
    // EU868's 1% duty cycle is the conservative default; region awareness and a
    // modem read from the board land alongside transport config later.
    this.governor = new AirtimeGovernor({ modem: MODEM_PRESETS.LONG_FAST, dutyCycle: 0.01 });
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

  /** Broadcast an arbitrary typed frame (e.g. PRESENCE, IM/DM). */
  send(subtype: SubType, payload: Uint8Array, priority: Priority = Priority.INTERACTIVE): void {
    this.enqueueFrame(encodeFrame(subtype, payload), { destination: "broadcast", wantAck: false }, priority);
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
    // Dedupe at the radio-envelope level before any work (plan §5).
    if (!this.dedupe.check(frameKey(f.from, f.packetId))) return;

    const res = decodeFrame(f.payload);
    if (!res.ok) return; // unknown sub-type / incompatible version — skip

    if (res.frame.subtype === SubType.FRAG) {
      const result = this.reassembler.accept(res.frame.payload);
      if (result.status !== "complete") return;
      const inner = decodeFrame(result.data);
      if (inner.ok) this.inbound.emit({ from: f.from, subtype: inner.frame.subtype, payload: inner.frame.payload, at: f.rxTime });
      return;
    }
    this.inbound.emit({ from: f.from, subtype: res.frame.subtype, payload: res.frame.payload, at: f.rxTime });
  }
}
