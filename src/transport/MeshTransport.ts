// MeshTransport — the seam the whole app depends on (outline §11.4, plan §5).
//
// Everything above this interface (RelayProtocol, domain stores, UI) is blind
// to the radio link. Today that link is a local Meshtastic node reached over
// HTTP/BLE/Serial; later it is the T-Deck's own on-board SX1262. Swapping the
// radio is implementing this interface again — never touching app logic.
//
// This layer deals only in RAW FRAME BYTES on the one well-known Relay portnum.
// It knows nothing of sub-types, signing, or fragmentation — those live in the
// RelayProtocol layer directly above it. That keeps the facade tiny and the
// port to hardware honest.

/** A Meshtastic destination: a node number, or one of the two symbolic targets. */
export type Destination = number | "self" | "broadcast";

export type TransportStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** A raw Relay payload heard on the wire, with minimal envelope metadata. */
export interface InboundFrame {
  /** Sending node number (Meshtastic node id). */
  from: number;
  /** Meshtastic channel index the packet arrived on. */
  channel: number;
  /** Packet id assigned by the sender's radio (used for dedupe upstream). */
  packetId: number;
  rxTime: Date;
  /** The bytes we put on the air — i.e. a RelayProtocol frame. */
  payload: Uint8Array;
}

export interface SendOptions {
  destination?: Destination; // default: "broadcast"
  wantAck?: boolean; // default: false
}

export type Unsubscribe = () => void;

export interface MeshTransport {
  /** "wifi" = a ZyPico board over WebSocket today; the facade can take more. */
  readonly kind: "wifi" | "hardware";
  readonly status: TransportStatus;
  /** Our own node number once known (after connect/configure). */
  readonly selfNodeNum: number | undefined;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Put one RelayProtocol frame on the air. Resolves to the radio's packet id. */
  sendFrame(payload: Uint8Array, opts?: SendOptions): Promise<number>;

  /** Subscribe to inbound Relay frames. Returns an unsubscribe fn. */
  onFrame(handler: (frame: InboundFrame) => void): Unsubscribe;
  /** Subscribe to status transitions. Returns an unsubscribe fn. */
  onStatus(handler: (status: TransportStatus) => void): Unsubscribe;
}

/** Minimal multi-listener event source shared by transport adapters. */
export class Emitter<T> {
  private handlers = new Set<(value: T) => void>();
  on(handler: (value: T) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(value: T): void {
    for (const h of this.handlers) h(value);
  }
  clear(): void {
    this.handlers.clear();
  }
}
