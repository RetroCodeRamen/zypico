<p align="center">
  <img src="img/logo.png" alt="ZyPico" width="300">
</p>

<h1 align="center">ZyPico — “The Relay”</h1>

A retro LoRa-mesh **social handheld** — Cybiko meets Tamagotchi on modern LoRa.
You raise a **Wisp** (a companion that grows from how you participate), hang out
in **the Commons**, message Travelers you meet, and explore a tiny living world
that exists **inside a mesh network** — no server, no internet required.

The whole UI + protocol runs in the **browser**; a **Heltec WiFi LoRa 32 V3**
board is the radio: it serves the web app from its own flash over a WiFi access
point and bridges WebSocket ↔ LoRa. The same code runs on your desktop browser
(offline) and on the board (over real LoRa) — only the transport differs.

> **Design is the source of truth:** [`docs/DESIGN.md`](docs/DESIGN.md) (canonical
> direction), [`docs/protocol.md`](docs/protocol.md) (wire format), the
> [roadmap](The-Relay-Project-Plan.md), and [`docs/adr/`](docs/adr).

## What works today (M1–M4)

- **Identity** — handle + password → Ed25519 keypair (Argon2id), fully offline, no reset.
- **The Wisp** — two-axis companion: Hearts (earned by participation → evolution)
  and Bond/Mood (care: Feed/Treat/Play/Clean/Rest/Talk); it "lives its life" and
  recounts Travelers it saw.
- **Eight Places** — Commons (public chat), Travelers, Post, Pages, Wisp, Arcade,
  Exchange, Profile. Connectivity is ambient (no "Radio" menu).
- **Mesh** — signed presence beacons (Wisp form + location), end-to-end encrypted
  DMs (X25519 + XChaCha20-Poly1305), an HLC-ordered Commons, and **multi-hop
  repeating** (hop-limit 3, network-wide dedupe) so the world feels larger than
  radio range.
- **On the board** — boot logo splash on the OLED; the USER button toggles to an
  info screen showing the AP, node id, and **devices in range**.

## Quick start

### Prerequisites
- **Node 22+** and npm (for the web app).
- **PlatformIO** (`pio`) — only if flashing a board ([install](https://platformio.org/install/cli)).
- **Python 3 + Pillow** — only if regenerating the logo assets.

### 1. Run the app in a browser (no hardware needed)
```bash
npm install
npm run dev        # http://localhost:5173
```
The app is offline-first: with no board it simply shows `OFFLINE`, but the Wisp,
care, navigation, and login all work. Create a handle + password to enter.

### 2. Quality gates
```bash
npm run typecheck  # tsc, strict
npm test           # vitest — 104 deterministic unit tests
npm run build      # production bundle → dist/
```

### 3. Flash a Heltec WiFi LoRa 32 V3 board
Build the web bundle, stage it into the firmware's flash dir, then upload the
firmware and the filesystem (the bundle is served from LittleFS):
```bash
npm run build
rm -rf firmware/heltec-v3/data && cp -r dist firmware/heltec-v3/data

pio run -d firmware/heltec-v3 -t upload      # firmware (C++)
pio run -d firmware/heltec-v3 -t uploadfs    # web bundle (LittleFS)
# multiple boards: add --upload-port /dev/ttyUSB0  (etc.)
```
Firmware changes need `-t upload`; web-only changes need just `-t uploadfs`.
**Region:** default is **US 915 MHz**; set `-D ZYPICO_LORA_FREQ=868.0` in
`firmware/heltec-v3/platformio.ini` for EU. All boards must match.

### 4. Use it on hardware
1. Power the board — it boots to the ZyPico logo (press the **USER** button for
   the info screen: AP, node, devices in range).
2. Join its WiFi AP **`ZyPico-XXXXXXXX`** (open network, one device per board).
3. Open the page (it loads automatically, or visit `http://192.168.4.1`).
4. Log in — you're on the Relay. With a second board nearby, you'll discover each
   other in **Travelers** and chat in the **Commons** over real LoRa.

## Testing over real LoRa (two boards)

A serial harness drives **both** boards over USB at once and runs the real
`RelayClient` against the physical radios — presence, encrypted DM, Commons post,
and dedupe, end-to-end over the air. See [`tools/harness/`](tools/harness).

```bash
# Linux: serial ports are root:dialout, so run under `sg dialout`.
sg dialout -c "npx vite-node tools/harness/roundtrip.ts"   # full round-trip
sg dialout -c "npx vite-node tools/harness/presence.ts"    # minimal example
```
(Boards must be flashed with current firmware; ports default to
`/dev/ttyUSB0` + `/dev/ttyUSB1`, override with `PORT_A` / `PORT_B`.)

## Regenerating the logo

The LCD splash and OLED logo are generated from `img/logo.png` (committed, so
normal builds don't need Pillow):
```bash
npm run gen:logo   # → src/ui/pixel/logoBitmap.ts + firmware/heltec-v3/src/logo_xbm.h
```

## Repo layout

```
src/core/         framework-agnostic: protocol, identity/crypto, companion (Wisp)
src/transport/    the MeshTransport seam + BoardTransport (WebSocket to the board)
src/app/          RelayClient (mesh spine) + local storage
src/ui/           React shell, hooks (domain layer), pixel screen + scenes
firmware/heltec-v3/  ESP32-S3 firmware (WiFi AP + WS↔LoRa bridge)
tools/harness/    two-board real-radio test harness
tools/gen-logo.py logo asset codegen
docs/             DESIGN.md (canonical), protocol.md, adr/
```

## Tech

React + TypeScript (strict) + Vite + Vitest · `@noble/*` crypto ·
PlatformIO / Arduino / RadioLib / ESPAsyncWebServer / U8g2 on ESP32-S3 (SX1262).
