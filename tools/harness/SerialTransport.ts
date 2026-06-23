// SerialTransport — a MeshTransport that drives a real ZyPico board over USB
// serial (Node only; the test harness). It speaks the firmware's magic-framed
// binary channel (0xAA55 [len:u16 BE] [bytes]), the serial twin of the board's
// WebSocket contract, so the *real* RelayClient + RelayProtocol run against a
// physical radio. Two of these = two real Relay nodes talking over LoRa.
//
// Run under `sg dialout` (the ports are root:dialout) via vite-node, which gives
// us the @core/@transport aliases.

import { spawnSync } from "node:child_process";
import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import {
  Emitter,
  type InboundFrame,
  type MeshTransport,
  type SendOptions,
  type TransportStatus,
  type Unsubscribe,
} from "@transport/index.ts";

const MAGIC0 = 0xaa;
const MAGIC1 = 0x55;
const MAC_HEADER = 6; // [srcId:4][seq:2]

export class SerialTransport implements MeshTransport {
  readonly kind = "hardware" as const;
  private _status: TransportStatus = "disconnected";
  private fd: number | undefined;
  private readonly frames = new Emitter<InboundFrame>();
  private readonly statuses = new Emitter<TransportStatus>();

  // Inbound parser state (mirrors the firmware state machine).
  private st = 0;
  private len = 0;
  private got = 0;
  private buf = Buffer.alloc(0);

  constructor(private readonly port: string, private readonly baud = 115200) {}

  get status(): TransportStatus { return this._status; }
  get selfNodeNum(): number | undefined { return undefined; } // not needed by the harness

  onFrame(handler: (frame: InboundFrame) => void): Unsubscribe { return this.frames.on(handler); }
  onStatus(handler: (status: TransportStatus) => void): Unsubscribe { return this.statuses.on(handler); }

  connect(): Promise<void> {
    // Raw mode at the board's baud, then open the device for read+write.
    const r = spawnSync("stty", ["-F", this.port, String(this.baud), "raw", "-echo", "-echoe", "-echok"]);
    if (r.status !== 0) {
      this.setStatus("error");
      return Promise.reject(new Error(`stty failed on ${this.port}: ${r.stderr?.toString() ?? r.status}`));
    }
    this.fd = openSync(this.port, "r+");
    const rs = createReadStream(this.port, { fd: this.fd, autoClose: false });
    rs.on("data", (chunk: Buffer) => this.consume(chunk));
    rs.on("error", () => this.setStatus("error"));
    this.setStatus("connected");
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    if (this.fd !== undefined) {
      try { closeSync(this.fd); } catch { /* already closed */ }
      this.fd = undefined;
    }
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  sendFrame(payload: Uint8Array, _opts: SendOptions = {}): Promise<number> {
    if (this.fd === undefined) throw new Error("SerialTransport: not connected");
    const len = payload.length;
    const frame = Buffer.concat([
      Buffer.from([MAGIC0, MAGIC1, (len >> 8) & 0xff, len & 0xff]),
      Buffer.from(payload),
    ]);
    writeSync(this.fd, frame); // the board stamps src/seq and transmits
    return Promise.resolve(0);
  }

  private setStatus(s: TransportStatus): void {
    this._status = s;
    this.statuses.emit(s);
  }

  // Scan the byte stream for magic-framed frames, ignoring interleaved debug text.
  private consume(chunk: Buffer): void {
    for (const c of chunk) {
      switch (this.st) {
        case 0: if (c === MAGIC0) this.st = 1; break;
        case 1: this.st = c === MAGIC1 ? 2 : c === MAGIC0 ? 1 : 0; break;
        case 2: this.len = c << 8; this.st = 3; break;
        case 3:
          this.len |= c;
          this.got = 0;
          this.buf = Buffer.alloc(this.len);
          this.st = this.len >= MAC_HEADER && this.len <= 300 ? 4 : 0; // drop absurd lengths
          break;
        case 4:
          this.buf[this.got++] = c;
          if (this.got >= this.len) { this.emitFrame(this.buf); this.st = 0; }
          break;
      }
    }
  }

  private emitFrame(b: Buffer): void {
    // b = [srcId:4 BE][seq:2 BE][payload] — the firmware's heard-packet framing.
    const from = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const packetId = (b[4] << 8) | b[5];
    this.frames.emit({
      from,
      channel: 0,
      packetId,
      rxTime: new Date(),
      payload: new Uint8Array(b.subarray(MAC_HEADER)),
    });
  }
}
