# ZyPico firmware — Heltec WiFi LoRa 32 V3

The board *is* the device: a WiFi **access point** that serves the ZyPico web UI
from flash and bridges a **WebSocket ↔ the SX1262 LoRa radio**. The browser (your
phone) runs the whole app + RelayProtocol; the firmware is a thin radio bridge.
**Fully offline** — the AP has no internet, the app never phones home. Ports to
the LilyGo T-Deck later (same ESP32-S3 + SX1262 family).

See `heltec-v3/`. Architecture decision: `docs/adr/0004-board-firmware-wifi-lora.md`.

## Prerequisites
- PlatformIO (installed for this repo at `~/.local/zypico-android/piovenv/bin/pio`).
- The Heltec V3 on USB. To flash, your user needs serial access
  (`sudo usermod -aG dialout $USER`, then re-login) — or flash from your own setup.

## Build & flash
From the repo root:

```bash
# 1. Build the web UI
npm run build

# 2. Bundle it into the firmware's LittleFS image (data/ is gitignored — generated)
mkdir -p firmware/heltec-v3/data && rm -rf firmware/heltec-v3/data/* && cp -r dist/* firmware/heltec-v3/data/

# 3. Build + flash the firmware (board on USB)
cd firmware/heltec-v3
pio run                 # compile
pio run -t upload       # flash firmware
pio run -t uploadfs     # flash the web UI (LittleFS)
pio device monitor      # optional: watch serial (nodeId, status)
```

## Use it
1. On the phone, join the WiFi network **"ZyPico"** (open, no internet — that's expected).
2. Browse to **http://192.168.4.1** — the board serves ZyPico.
3. RADIO → **CONNECT** (it opens a WebSocket back to the board). STATUS shows
   `CONNECTED · VIA WIFI BOARD`.
4. MAIL → compose → send. With a second ZyPico board, messages go over LoRa.

## Configuration
- **LoRa region/frequency** is in `platformio.ini` (`ZYPICO_LORA_FREQ`): **915.0
  for US**, `868.0` for EU. It **must match on every board** (and is a legal
  requirement for your region).
- This is a **ZyPico-only LoRa network** (custom sync word `0x2B`) — it does not
  interoperate with stock Meshtastic nodes. That trade was chosen for a clean,
  self-contained appliance; Meshtastic compatibility can be added later.
