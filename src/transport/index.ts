export {
  Emitter,
  type Destination,
  type InboundFrame,
  type MeshTransport,
  type SendOptions,
  type TransportStatus,
  type Unsubscribe,
} from "./MeshTransport.ts";
export { HttpTransport, type HttpTransportOptions } from "./HttpTransport.ts";
export { MeshServiceTransport, hasMeshServiceBridge } from "./MeshServiceTransport.ts";
export { BleTransport, bluetoothAvailable } from "./BleTransport.ts";
export { BoardTransport, defaultBoardUrl } from "./BoardTransport.ts";

import type { MeshTransport } from "./MeshTransport.ts";
import { HttpTransport } from "./HttpTransport.ts";
import { hasMeshServiceBridge, MeshServiceTransport } from "./MeshServiceTransport.ts";

/**
 * Pick the right radio link for where we're running: inside the native shell,
 * go through the Meshtastic app's service (no address needed); on the plain web,
 * fall back to the node's HTTP API at `address`.
 */
export function createTransport(address?: string): MeshTransport {
  if (hasMeshServiceBridge()) return new MeshServiceTransport();
  return new HttpTransport({ address: address ?? "" });
}
