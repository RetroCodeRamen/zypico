// BoardTransport — the link to a ZyPico hardware board over WiFi (ADR 0004).
//
// The board (Heltec LoRa V3 / later T-Deck) runs as a WiFi access point, serves
// this very web app from its flash, and exposes a WebSocket that bridges to its
// SX1262 LoRa radio. So this transport just opens a WebSocket back to the host
// that served the page and shuttles raw RelayProtocol frame bytes. Everything
// above (framing, fragmentation, dedupe, airtime governor) stays in the browser.
//
// Board link framing on the WebSocket:
//   - text  : JSON control, e.g. {"type":"hello","nodeId":<u32>} on connect.
//   - binary: a heard LoRa packet = [srcId:u32 BE][seq:u16 BE][payload…].
//             Outbound (browser→board) binary is just the payload; the board
//             stamps its own srcId/seq and transmits.

import {
  Emitter,
  type InboundFrame,
  type MeshTransport,
  type SendOptions,
  type TransportStatus,
  type Unsubscribe,
} from "./MeshTransport.ts";

/** Default WebSocket URL: back to whoever served the page (the board's AP). */
export function defaultBoardUrl(): string {
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
  const host = typeof location !== "undefined" && location.host ? location.host : "192.168.4.1";
  return `${proto}://${host}/ws`;
}

export class BoardTransport implements MeshTransport {
  readonly kind = "wifi" as const;

  private ws: WebSocket | undefined;
  private _status: TransportStatus = "disconnected";
  private _selfNodeNum: number | undefined;
  private readonly frames = new Emitter<InboundFrame>();
  private readonly statuses = new Emitter<TransportStatus>();

  constructor(private readonly url: string = defaultBoardUrl()) {}

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

  connect(): Promise<void> {
    if (this._status === "connected" || this._status === "connecting") return Promise.resolve();
    this.setStatus("connecting");
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        settled = true;
        this.setStatus("connected");
        resolve();
      };
      ws.onmessage = (ev) => this.onMessage(ev.data);
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          this.setStatus("error");
          reject(new Error("board websocket closed before opening"));
        } else {
          this.setStatus("disconnected");
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          this.setStatus("error");
          reject(new Error(`cannot reach board at ${this.url}`));
        }
      };
    });
  }

  disconnect(): Promise<void> {
    const ws = this.ws;
    this.ws = undefined;
    this._selfNodeNum = undefined;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // already closing
      }
    }
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  sendFrame(payload: Uint8Array, _opts: SendOptions = {}): Promise<number> {
    if (!this.ws || this._status !== "connected") {
      throw new Error("BoardTransport: not connected");
    }
    // The board stamps src/seq and transmits; we just send the frame bytes.
    this.ws.send(payload);
    return Promise.resolve(0);
  }

  private onMessage(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data) as { type?: string; nodeId?: number };
        if (msg.type === "hello" && typeof msg.nodeId === "number") {
          this._selfNodeNum = msg.nodeId >>> 0;
        }
      } catch {
        // ignore malformed control text
      }
      return;
    }
    if (data.byteLength < 6) return; // need at least the [srcId][seq] header
    const view = new DataView(data);
    const from = view.getUint32(0, false);
    const packetId = view.getUint16(4, false);
    this.frames.emit({
      from,
      channel: 0,
      packetId,
      rxTime: new Date(),
      payload: new Uint8Array(data, 6),
    });
  }

  private setStatus(status: TransportStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.statuses.emit(status);
  }
}
