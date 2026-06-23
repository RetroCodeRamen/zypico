// BleTransport — Web Bluetooth link straight to the node (plan §4; outline §11.2).
//
// On Chromium (Chrome on Android/desktop), the web app can talk to a Meshtastic
// node directly over BLE — no node IP, no native app. `TransportWebBluetooth.create()`
// prompts the browser's device picker, so connect() must be triggered from a user
// gesture (the CONNECT button). Implements the same MeshTransport facade as the
// HTTP and service transports, so nothing above changes.
//
// Note: BLE is one-connection-at-a-time. If the Meshtastic app holds the node
// over Bluetooth, disconnect it there first so the browser can pair.

import { MeshDevice, Protobuf, type Types } from "@meshtastic/core";
import { TransportWebBluetooth } from "@meshtastic/transport-web-bluetooth";
import {
  Emitter,
  withTimeout,
  type Destination,
  type InboundFrame,
  type MeshTransport,
  type SendOptions,
  type TransportStatus,
  type Unsubscribe,
} from "./MeshTransport.ts";

const RELAY_PORTNUM = Protobuf.Portnums.PortNum.PRIVATE_APP;

/** True when the browser exposes Web Bluetooth (Chromium only; not iOS Safari). */
export function bluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export class BleTransport implements MeshTransport {
  readonly kind = "ble" as const;

  private device: MeshDevice | undefined;
  private subscriptions: Unsubscribe[] = [];
  private _status: TransportStatus = "disconnected";
  private _selfNodeNum: number | undefined;

  private readonly frames = new Emitter<InboundFrame>();
  private readonly statuses = new Emitter<TransportStatus>();

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
      // Prompts the BLE device picker (needs the user gesture from CONNECT).
      const transport = await TransportWebBluetooth.create();
      const device = new MeshDevice(transport);
      this.device = device;

      this.subscriptions.push(
        device.events.onPrivatePacket.subscribe((packet: Types.PacketMetadata<Uint8Array>) => {
          this.frames.emit({
            from: packet.from,
            channel: packet.channel,
            packetId: packet.id,
            rxTime: packet.rxTime,
            payload: packet.data,
          });
        }),
      );
      this.subscriptions.push(
        device.events.onMyNodeInfo.subscribe((info: Protobuf.Mesh.MyNodeInfo) => {
          this._selfNodeNum = info.myNodeNum;
        }),
      );

      // The Meshtastic config handshake; if it stalls (e.g. bonding/notify
      // issues) fail loud instead of hanging on "connecting" forever.
      await withTimeout(device.configure(), 25_000, "config handshake timed out");
      this.setStatus("connected");
    } catch (err) {
      console.error("[BleTransport] connect failed:", err);
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
      throw new Error("BleTransport: not connected");
    }
    const destination: Destination = opts.destination ?? "broadcast";
    return this.device.sendPacket(payload, RELAY_PORTNUM, destination, undefined, opts.wantAck ?? false);
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
        // link may already be gone
      }
    }
  }
}
