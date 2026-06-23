# ADR 0003 — Android app shell + Meshtastic service bridge

_Status: **SUPERSEDED** by ADR 0004 · 2026-06-21 · Phase 3_

> **Superseded.** The current Meshtastic Android app removed its third-party
> service API (`onBind` returns null, no exported AIDL), so this route is not
> possible. We moved to running ZyPico on the board itself (ADR 0004). The
> `native/android/` scaffold and the `MeshServiceTransport` adapter were removed
> in the 2026-06-22 cleanup (recoverable in git history). Kept here as a record.

## Context
The target deployment is an **Android phone that already runs the Meshtastic
app**, with ZyPico connecting through that app rather than asking the user for a
node IP. A pure PWA cannot do this: the Meshtastic app's "local API" is a native
**bound service (`com.geeksville.mesh.IMeshService`, AIDL)**, callable only by
other native Android apps — not by a web page. HTTP-to-node (needs an IP) and
Web Bluetooth (Chromium-only, talks to the node directly, bypasses the app) were
both considered and rejected for the primary path (see §11 risks).

## Decision
Ship ZyPico as a **native Android shell hosting the web UI in a WebView**, where
the shell **binds the Meshtastic `IMeshService`** and exposes a small JS bridge.
A new `MeshServiceTransport` implements the existing `MeshTransport` interface
against that bridge. Transport is **auto-selected at runtime**: native bridge
present → Meshtastic service; otherwise → `HttpTransport` (desktop/web dev).

This honors the architecture's core seam — communication stays fully behind
`MeshTransport`; nothing above it changes (plan §5). HTTP remains the dev/web
fallback; Web Bluetooth stays a possible future adapter.

## The JS bridge contract (stable interface)
The native shell injects two globals; the web app depends only on these:

- `window.ZyPicoMeshNative` — synchronous methods JS → native:
  - `connect(): void` — bind/attach to the Meshtastic service.
  - `disconnect(): void`
  - `sendFrame(dataBase64: string, destination: string, wantAck: boolean): number`
    — send one RelayProtocol frame on the private portnum; returns the packet id (or 0).
  - `getSelfNodeNum(): number` — our node number, or -1 if unknown.
- `window.ZyPicoMeshEvents` — a JS object the **web app** defines and the native
  side calls into (via `evaluateJavascript`) for events JS ← native:
  - `frame(json)` — `{from, channel, packetId, rxTimeMs, data /*base64*/}`
  - `status(s)` — `"connected" | "connecting" | "disconnected" | "error"`

All Relay traffic rides one private portnum: **`PRIVATE_APP` = 256** (matches
`HttpTransport`). Payload bytes cross the bridge as base64.

## Consequences
- ZyPico is no longer a pure PWA on Android; it's a WebView app. (It still runs
  as a plain web app in a browser, using the HTTP fallback.)
- The native shell + Meshtastic binding live in `native/android/` and are built
  with Android Studio (this repo's CI does not build the APK).
- The Meshtastic AIDL (`IMeshService.aidl`, `DataPacket.aidl`, …) must be copied
  from the official Meshtastic-Android repo and kept reconciled with its API.
- iOS is out of scope for this path (no equivalent app service); an iOS build
  would use a different transport (e.g. BLE) later.

## See also
`native/android/SETUP.md` (build steps), `src/transport/MeshServiceTransport.ts`
(the web side of the bridge), outline §11.2 / plan §4 (transport options).
