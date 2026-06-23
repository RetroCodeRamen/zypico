import { useRef, useState } from "react";
import { BoardTransport } from "@transport/index.ts";
import type { MeshTransport, TransportStatus } from "@transport/index.ts";
import { RelayClient, type InboundDecoded } from "@app/RelayClient.ts";
import type { RelayView } from "@ui/scenes/render.ts";
import type { SubType } from "@core/protocol/index.ts";
import { sfx } from "@ui/sound.ts";

const STATUS_LABEL: Record<TransportStatus, string> = {
  disconnected: "OFFLINE",
  connecting: "CONNECTING...",
  connected: "ON RELAY",
  error: "LINK ERROR",
};

// The optional Relay link. The device is fully usable offline; this owns the
// transport + RelayClient lifecycle and exposes the live link view plus a thin
// send/connect surface for the social layer. Inbound frames are routed to
// whatever handler `setInbound` last registered (the social layer plugs in).
export function useRelay() {
  const [view, setView] = useState<RelayView>({ statusLabel: "OFFLINE", online: false });
  const clientRef = useRef<RelayClient | undefined>(undefined);
  const viaRef = useRef<string | undefined>(undefined); // how we're linked (for STATUS)
  const inboundRef = useRef<(f: InboundDecoded) => void>(() => {});

  const refreshView = (client: RelayClient, status: TransportStatus) => {
    const node = client.selfNodeNum;
    setView({
      statusLabel: STATUS_LABEL[status],
      online: status === "connected",
      ...(viaRef.current ? { via: viaRef.current } : {}),
      ...(node !== undefined ? { nodeLabel: `NODE !${node.toString(16)}` } : {}),
    });
  };

  // Start a link over a chosen transport. `via` labels how we're connected.
  // `quiet` suppresses the connect/error chirps for the silent auto-connect.
  const startLink = async (transport: MeshTransport, via: string, quiet = false) => {
    viaRef.current = via;
    const client = new RelayClient(transport);
    clientRef.current = client;
    client.onStatus((s) => refreshView(client, s));
    client.onInbound((f) => inboundRef.current(f));
    setView({ statusLabel: "CONNECTING...", online: false, via });
    try {
      await client.connect();
      refreshView(client, "connected");
      if (!quiet) sfx("connect");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[ZyPico] link failed:", err);
      setView({ statusLabel: "LINK ERROR", online: false, via, detail });
      if (!quiet) sfx("error");
    }
  };

  // The board serves this page, so the WebSocket link is always-on: auto-connect
  // (quietly) and only expose reconnect/disconnect for control.
  const connectBoard = (quiet = false) => startLink(new BoardTransport(), "WIFI BOARD", quiet);

  const disconnect = async () => {
    await clientRef.current?.disconnect();
    clientRef.current = undefined;
    viaRef.current = undefined;
    setView({ statusLabel: "OFFLINE", online: false });
  };

  return {
    view,
    connectBoard,
    disconnect,
    setInbound: (fn: (f: InboundDecoded) => void) => { inboundRef.current = fn; },
    isConnected: () => clientRef.current?.status === "connected",
    send: (subtype: SubType, payload: Uint8Array) => clientRef.current?.send(subtype, payload),
  };
}

export type Relay = ReturnType<typeof useRelay>;
