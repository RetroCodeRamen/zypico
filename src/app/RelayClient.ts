// RelayClient — the coordinator between RelayProtocol and a MeshTransport.
//
// Still a Phase-1 spike (not the full domain layer), but now wired to the real
// protocol spine: every outbound message is paced by the airtime governor and
// fragmented if it overflows one frame; every inbound packet is de-duplicated
// and, if fragmented, reassembled before its sub-type is surfaced. IM bodies are
// plain UTF-8 here; end-to-end encryption (outline §9.3) is Phase 2 and slots in
// at this seam without touching the transport.

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
  subTypeName,
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

export interface RelayMessage {
  direction: "in" | "out";
  from: number | "me";
  subtype: SubType;
  subtypeName: string;
  /** Decoded text for IM/MAIL/POST; undefined for binary sub-types. */
  text?: string;
  /** Total payload bytes for this message (summed across fragments). */
  bytes: number;
  at: Date;
}

interface SendMeta {
  destination: Destination;
  wantAck: boolean;
}

/** A decoded inbound frame, for higher layers (presence, DM) to interpret. */
export interface InboundDecoded {
  from: number;
  subtype: SubType;
  payload: Uint8Array;
  at: Date;
}

export class RelayClient {
  private unsubs: Array<() => void> = [];
  private readonly messages = new Emitter<RelayMessage>();
  private readonly inbound = new Emitter<InboundDecoded>();

  // Protocol spine (plan §5).
  private readonly dedupe = new DedupeCache();
  private readonly reassembler = new Reassembler();
  private readonly governor: AirtimeGovernor;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly transport: MeshTransport) {
    // EU868's 1% duty cycle is the conservative default; region awareness and a
    // modem read from the node land alongside transport config later.
    this.governor = new AirtimeGovernor({
      modem: MODEM_PRESETS.LONG_FAST,
      dutyCycle: 0.01,
    });
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

  onMessage(handler: (msg: RelayMessage) => void): () => void {
    return this.messages.on(handler);
  }

  /** Raw decoded frames (presence, DM, …) for the social layer to route. */
  onInbound(handler: (frame: InboundDecoded) => void): () => void {
    return this.inbound.on(handler);
  }

  /** Broadcast an arbitrary typed frame (e.g. PRESENCE, IM/DM). */
  send(subtype: SubType, payload: Uint8Array, priority: Priority = Priority.INTERACTIVE): void {
    this.enqueueFrame(encodeFrame(subtype, payload), { destination: "broadcast", wantAck: false }, priority);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    return this.transport.onStatus(handler);
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

  /** Send a short text message as an IM frame (fragmented + paced as needed). */
  async sendIM(text: string, destination: Destination = "broadcast"): Promise<void> {
    const body = new TextEncoder().encode(text);
    const frame = encodeFrame(SubType.IM, body);
    const wantAck = destination !== "broadcast";
    this.enqueueFrame(frame, { destination, wantAck }, Priority.INTERACTIVE);

    this.messages.emit({
      direction: "out",
      from: "me",
      subtype: SubType.IM,
      subtypeName: subTypeName(SubType.IM),
      text,
      bytes: frame.length,
      at: new Date(),
    });
  }

  // Hand a complete RelayProtocol frame to the governor — directly if it fits a
  // single transmission, else split into FRAG frames (lower priority, since a
  // bulk transfer must never starve interactive traffic).
  private enqueueFrame(frame: Uint8Array, meta: SendMeta, priority: Priority): void {
    if (frame.length <= MAX_ONAIR) {
      this.governor.enqueue(frame, { priority, meta });
    } else {
      const msgId = (Math.random() * 0xffff_ffff) >>> 0;
      const frags = fragmentToFrames(msgId, frame, MAX_FRAME_PAYLOAD);
      for (const f of frags) {
        this.governor.enqueue(f, { priority: Priority.BULK, meta });
      }
    }
    this.pump();
  }

  // Drain everything the airtime bucket can afford now, then schedule the next
  // wakeup for whatever remains queued. This is where "patience as aesthetic"
  // (outline §11.1, plan §11) becomes real: traffic leaves at a lawful rate.
  private pump(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    this.governor.drain((ready) => {
      const meta = ready.meta as SendMeta;
      void this.transport
        .sendFrame(ready.payload, { destination: meta.destination, wantAck: meta.wantAck })
        .catch((err) => this.emitError(err));
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
    if (!res.ok) {
      this.emitUndecodable(f, res.reason, res.subtype);
      return;
    }

    if (res.frame.subtype === SubType.FRAG) {
      this.handleFragment(f, res.frame.payload);
      return;
    }
    this.emitDecoded(f.from, res.frame.subtype, res.frame.payload, f.rxTime);
  }

  // Feed a FRAG envelope to the reassembler; on completion the bytes are a whole
  // inner frame, so decode it and surface the original sub-type.
  private handleFragment(f: InboundFrame, fragPayload: Uint8Array): void {
    const result = this.reassembler.accept(fragPayload);
    if (result.status !== "complete") return;
    const inner = decodeFrame(result.data);
    if (!inner.ok) {
      this.emitUndecodable(f, inner.reason, inner.subtype);
      return;
    }
    this.emitDecoded(f.from, inner.frame.subtype, inner.frame.payload, f.rxTime);
  }

  private emitDecoded(from: number, subtype: SubType, payload: Uint8Array, at: Date): void {
    this.inbound.emit({ from, subtype, payload, at });
    const textual =
      subtype === SubType.IM || subtype === SubType.MAIL || subtype === SubType.POST;
    this.messages.emit({
      direction: "in",
      from,
      subtype,
      subtypeName: subTypeName(subtype),
      ...(textual ? { text: new TextDecoder().decode(payload) } : {}),
      bytes: payload.length,
      at,
    });
  }

  private emitUndecodable(
    f: InboundFrame,
    reason: string,
    subtype: number | undefined,
  ): void {
    this.messages.emit({
      direction: "in",
      from: f.from,
      subtype: (subtype ?? 0) as SubType,
      subtypeName:
        reason === "unknown-subtype" ? `?${subTypeName(subtype ?? 0)}` : reason,
      bytes: f.payload.length,
      at: f.rxTime,
    });
  }

  private emitError(err: unknown): void {
    // Surface a send failure into the same message stream so the UI can show it.
    this.messages.emit({
      direction: "out",
      from: "me",
      subtype: 0 as SubType,
      subtypeName: "send-error",
      text: err instanceof Error ? err.message : String(err),
      bytes: 0,
      at: new Date(),
    });
  }
}
