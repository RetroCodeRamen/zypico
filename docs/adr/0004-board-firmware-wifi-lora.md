# ADR 0004 — ZyPico runs on the board; WiFi + WebSocket ↔ LoRa

_Status: accepted · 2026-06-22 · supersedes the app-route parts of ADR 0003_

## Context
The phone-connectivity attempts hit walls: the Meshtastic Android app removed its
third-party service API (ADR 0003 dead end), and Web Bluetooth to a node fails on
Android bonding. The user has a **Heltec WiFi LoRa 32 V3** (ESP32-S3 + SX1262 +
WiFi), and the project's hardware end-goal (plan §10) is a device that *is* its
own radio and serves its own UI.

## Decision
Make the **board the device**. Custom ESP32 firmware:
- runs a **WiFi access point** ("ZyPico", offline — no router/internet);
- serves the bundled ZyPico web UI from flash (LittleFS) over HTTP;
- exposes a **WebSocket** that bridges raw RelayProtocol frame bytes to the
  **SX1262** via RadioLib (a thin radio bridge);
- the browser runs the entire UI + RelayProtocol (framing, fragmentation,
  dedupe, airtime governor) — unchanged.

A new `BoardTransport` (WebSocket) implements the `MeshTransport` facade, so the
web app is otherwise untouched. This sidesteps BLE bonding and the Meshtastic-app
API entirely, is fully offline, and ports to the T-Deck (same chip family).

## Trade-offs
- **ZyPico-only LoRa network** (custom sync word) — not Meshtastic-compatible.
  Accepted for a clean self-contained appliance; Meshtastic framing could be
  added later if interop is wanted.
- Adds a firmware workstream (PlatformIO / RadioLib / ESPAsyncWebServer).
- BLE (`BleTransport`) and the Android service shell (ADR 0003) are shelved but
  kept in-tree as alternative transports behind the same facade.

## Link framing (browser ↔ board over WebSocket)
- text: `{"type":"hello","nodeId":<u32>}` on connect.
- binary browser→board: a RelayProtocol frame to transmit (board stamps src/seq).
- binary board→browser: `[srcId:u32 BE][seq:u16 BE][payload…]` for each heard packet.

LoRa frequency is region-set at build time (`ZYPICO_LORA_FREQ`, default US 915).

## See also
`firmware/README.md`, `src/transport/BoardTransport.ts`, plan §10 (hardware path).
