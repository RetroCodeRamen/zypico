// HttpTransport — the baseline radio link (outline §11.2).
//
// Wraps @meshtastic/core's MeshDevice over an HTTP connection to a local
// Meshtastic node (WiFi/ESP32). HTTP is the supported default because, unlike
// Web Bluetooth / Web Serial, it is not Chromium-only. BLE/Serial adapters will
// implement the same MeshTransport interface later as progressive enhancements.

import { MeshDevice, Protobuf, type Types } from "@meshtastic/core";
import { TransportHTTP } from "@meshtastic/transport-http";
import {
  Emitter,
  type Destination,
  type InboundFrame,
  type MeshTransport,
  type SendOptions,
  type TransportStatus,
  type Unsubscribe,
} from "./MeshTransport.ts";

// All ZyPico traffic shares one private portnum; the sub-type lives in our own
// payload header (outline §11.2). PRIVATE_APP (256) is the early choice.
const RELAY_PORTNUM = Protobuf.Portnums.PortNum.PRIVATE_APP;

export interface HttpTransportOptions {
  /** Node address, e.g. "192.168.1.50", "meshtastic.local", or a full URL. */
  address: string;
  /** Force TLS (https). If omitted, inferred from the address scheme (default false). */
  tls?: boolean;
}

interface NormalizedAddress {
  host: string;
  tls: boolean;
}

function normalizeAddress(raw: string, tlsOverride?: boolean): NormalizedAddress {
  const trimmed = raw.trim();
  let host = trimmed;
  let tls = false;
  const schemeMatch = /^(https?):\/\//i.exec(trimmed);
  if (schemeMatch) {
    tls = schemeMatch[1].toLowerCase() === "https";
    host = trimmed.slice(schemeMatch[0].length);
  }
  host = host.replace(/\/+$/, ""); // strip trailing slashes
  return { host, tls: tlsOverride ?? tls };
}

export class HttpTransport implements MeshTransport {
  readonly kind = "http" as const;

  private readonly opts: NormalizedAddress;
  private device: MeshDevice | undefined;
  private subscriptions: Unsubscribe[] = [];
  private _status: TransportStatus = "disconnected";
  private _selfNodeNum: number | undefined;

  private readonly frames = new Emitter<InboundFrame>();
  private readonly statuses = new Emitter<TransportStatus>();

  constructor(options: HttpTransportOptions) {
    this.opts = normalizeAddress(options.address, options.tls);
  }

  get status(): TransportStatus {
    return this._status;
  }

  get selfNodeNum(): number | undefined {
    return this._selfNodeNum;
  }

  onFrame(handler: (frame: InboundFrame) => void): Unsubscribe {
    return this.frames.on(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): Unsubscribe {
    return this.statuses.on(handler);
  }

  async connect(): Promise<void> {
    if (this._status === "connected" || this._status === "connecting") return;
    this.setStatus("connecting");
    try {
      const transport = await TransportHTTP.create(this.opts.host, this.opts.tls);
      const device = new MeshDevice(transport);
      this.device = device;

      // Inbound: packets on our private portnum arrive here as raw payload bytes.
      this.subscriptions.push(
        device.events.onPrivatePacket.subscribe((packet: Types.PacketMetadata<Uint8Array>) => {
          const frame: InboundFrame = {
            from: packet.from,
            channel: packet.channel,
            packetId: packet.id,
            rxTime: packet.rxTime,
            payload: packet.data,
          };
          this.frames.emit(frame);
        }),
      );

      // Learn our own node number for addressing / self-filtering.
      this.subscriptions.push(
        device.events.onMyNodeInfo.subscribe((info: Protobuf.Mesh.MyNodeInfo) => {
          this._selfNodeNum = info.myNodeNum;
        }),
      );

      // Kick off the config handshake; resolves once the node has reported state.
      await device.configure();
      this.setStatus("connected");
    } catch (err) {
      this.setStatus("error");
      await this.teardown();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.teardown();
    this.setStatus("disconnected");
  }

  async sendFrame(payload: Uint8Array, opts: SendOptions = {}): Promise<number> {
    if (!this.device || this._status !== "connected") {
      throw new Error("HttpTransport: not connected");
    }
    const destination: Destination = opts.destination ?? "broadcast";
    return this.device.sendPacket(
      payload,
      RELAY_PORTNUM,
      destination,
      undefined, // channel: node's primary; channel auto-config lands later
      opts.wantAck ?? false,
    );
  }

  private setStatus(status: TransportStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.statuses.emit(status);
  }

  private async teardown(): Promise<void> {
    for (const unsub of this.subscriptions) unsub();
    this.subscriptions = [];
    const device = this.device;
    this.device = undefined;
    this._selfNodeNum = undefined;
    if (device) {
      try {
        await device.disconnect();
      } catch {
        // best-effort; the link may already be gone
      }
    }
  }
}
