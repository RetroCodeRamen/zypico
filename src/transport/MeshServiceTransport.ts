// MeshServiceTransport — the "app route" link (ADR 0003).
//
// When ZyPico runs inside its native Android shell, the shell binds the
// Meshtastic Android app's IMeshService (its AIDL "local API") and injects a JS
// bridge. This transport speaks to that bridge, so the user connects through
// the phone's existing Meshtastic app — no IP, no separate node pairing. On the
// plain web (no bridge) the app falls back to HttpTransport (see index.ts).
//
// Bridge contract (injected by the native shell):
//   window.ZyPicoMeshNative — Java-backed methods called JS → native.
//   window.ZyPicoMeshEvents — a plain JS object WE define; native calls into it
//                             (via evaluateJavascript) JS ← native for inbound
//                             frames and status changes. (A JavascriptInterface
//                             object can't have JS callbacks attached to it, so
//                             events go through this separate dispatcher.)

import {
  Emitter,
  type Destination,
  type InboundFrame,
  type MeshTransport,
  type SendOptions,
  type TransportStatus,
  type Unsubscribe,
} from "./MeshTransport.ts";

/** Methods the native shell exposes (synchronous JavascriptInterface). */
export interface ZyPicoMeshNative {
  connect(): void;
  disconnect(): void;
  /** @returns the sender packet id, or 0 if unknown. */
  sendFrame(dataBase64: string, destination: string, wantAck: boolean): number;
  /** @returns our node number, or -1 if not yet known. */
  getSelfNodeNum(): number;
}

/** Event dispatcher the native shell invokes (JS ← native). */
export interface ZyPicoMeshEvents {
  frame(json: string): void;
  status(status: string): void;
}

declare global {
  interface Window {
    ZyPicoMeshNative?: ZyPicoMeshNative;
    ZyPicoMeshEvents?: ZyPicoMeshEvents;
  }
}

/** True when running inside the native shell that provides the Meshtastic bridge. */
export function hasMeshServiceBridge(): boolean {
  return typeof window !== "undefined" && typeof window.ZyPicoMeshNative !== "undefined";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function destToString(dest: Destination): string {
  return typeof dest === "number" ? String(dest) : dest;
}

interface FrameEvent {
  from: number;
  channel: number;
  packetId: number;
  rxTimeMs: number;
  data: string; // base64
}

export class MeshServiceTransport implements MeshTransport {
  readonly kind = "service" as const;

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

  private native(): ZyPicoMeshNative {
    const n = window.ZyPicoMeshNative;
    if (!n) throw new Error("Meshtastic bridge unavailable");
    return n;
  }

  async connect(): Promise<void> {
    if (this._status === "connected" || this._status === "connecting") return;
    this.setStatus("connecting");
    // Install the event dispatcher the native side calls into.
    window.ZyPicoMeshEvents = {
      frame: (json) => this.onNativeFrame(json),
      status: (s) => this.setStatus(normalizeStatus(s)),
    };
    try {
      this.native().connect();
      const node = this.native().getSelfNodeNum();
      this._selfNodeNum = node >= 0 ? node : undefined;
      // The native side drives the final "connected" status via an event once
      // the service handshake completes; mark connected optimistically too.
      this.setStatus("connected");
    } catch (err) {
      this.setStatus("error");
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.native().disconnect();
    } catch {
      // best effort
    }
    window.ZyPicoMeshEvents = undefined;
    this._selfNodeNum = undefined;
    this.setStatus("disconnected");
  }

  async sendFrame(payload: Uint8Array, opts: SendOptions = {}): Promise<number> {
    const id = this.native().sendFrame(
      bytesToBase64(payload),
      destToString(opts.destination ?? "broadcast"),
      opts.wantAck ?? false,
    );
    return id;
  }

  private onNativeFrame(json: string): void {
    let e: FrameEvent;
    try {
      e = JSON.parse(json) as FrameEvent;
    } catch {
      return;
    }
    if (this._selfNodeNum === undefined) {
      const node = this.native().getSelfNodeNum();
      if (node >= 0) this._selfNodeNum = node;
    }
    this.frames.emit({
      from: e.from,
      channel: e.channel,
      packetId: e.packetId,
      rxTime: new Date(e.rxTimeMs),
      payload: base64ToBytes(e.data),
    });
  }

  private setStatus(status: TransportStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.statuses.emit(status);
  }
}

function normalizeStatus(s: string): TransportStatus {
  switch (s) {
    case "connected":
    case "connecting":
    case "error":
      return s;
    default:
      return "disconnected";
  }
}
