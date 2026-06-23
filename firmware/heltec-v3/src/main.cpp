// ZyPico — Heltec WiFi LoRa 32 V3 firmware.
//
// The board is the "device": a WiFi access point that serves the ZyPico web UI
// from flash and bridges a WebSocket to the SX1262 LoRa radio. The browser runs
// the whole app + RelayProtocol; this firmware is a thin radio bridge.
//
// WebSocket link framing:
//   browser -> board (binary): a RelayProtocol frame to transmit (payload only).
//   board -> browser (binary): a heard packet = [srcId:u32 BE][seq:u16 BE][payload].
//   board -> browser (text)  : {"type":"hello","nodeId":<u32>} on connect.
//
// USB-serial bridge (for the automated two-board test harness — host can drive
// both boards at once over USB, which WiFi can't). Magic-framed binary, carried
// alongside the human-readable debug logs; the host locks onto the 0xAA55 sync
// and ignores the text. Same payload contract as the WebSocket:
//   host  -> board : 0xAA 0x55 [len:u16 BE] [RelayProtocol frame]      (transmit)
//   board -> host  : 0xAA 0x55 [len:u16 BE] [srcId:4][seq:2][payload]  (heard)
// A plain text line (no magic) is still transmitted as-is — the old debug path.

#include <Arduino.h>
#include <WiFi.h>
#include <SPI.h>
#include <LittleFS.h>
#include <RadioLib.h>
#include <ESPAsyncWebServer.h>
#include <U8g2lib.h>
#include "logo_xbm.h" // generated: tools/gen-logo.py

// --- Heltec V3 onboard SSD1306 OLED (128x64, I2C) ---
#define PIN_VEXT 36   // powers the OLED (active LOW)
#define PIN_OLED_RST 21
#define PIN_OLED_SDA 17
#define PIN_OLED_SCL 18
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, PIN_OLED_RST, PIN_OLED_SCL, PIN_OLED_SDA);

// --- Heltec V3 SX1262 pin map ---
#define PIN_NSS 8
#define PIN_DIO1 14
#define PIN_RST 12
#define PIN_BUSY 13
#define PIN_SCK 9
#define PIN_MISO 11
#define PIN_MOSI 10

// --- LoRa params (must match across all ZyPico boards) ---
#ifndef ZYPICO_LORA_FREQ
#define ZYPICO_LORA_FREQ 915.0
#endif
#define LORA_BW 250.0
#define LORA_SF 9
#define LORA_CR 5
#define LORA_SYNC 0x2B   // ZyPico private sync word
#define LORA_POWER 17    // dBm
#define LORA_PREAMBLE 8
#define LORA_TCXO 1.8    // Heltec V3 has a 1.8V TCXO

#define MAC_HEADER 6     // [srcId:4][seq:2]
#define MAX_PAYLOAD 240

#define PIN_USER_BTN 0   // Heltec V3 "PRG"/USER button (GPIO0, active LOW)

static SX1262 radio = new Module(PIN_NSS, PIN_DIO1, PIN_RST, PIN_BUSY);
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

static uint32_t nodeId = 0;
static uint16_t txSeq = 0;
static char apSsid[24]; // unique per board so two boards are distinguishable
static volatile bool rxFlag = false;

// OLED view: the logo splash stays up until the USER button switches to info.
static bool showInfo = false;

// Distinct ZyPico devices heard directly (by MAC src) — "in range" on the OLED.
#define MAX_PEERS 24
#define PEER_WINDOW_MS 300000UL // a device is "in range" if heard in the last 5 min
static uint32_t peerIds[MAX_PEERS];
static uint32_t peerLastMs[MAX_PEERS];
static int peerCount = 0;

struct TxMsg {
  uint8_t len;
  uint8_t data[MAX_PAYLOAD];
};
static QueueHandle_t txQueue;

static void drawSplashOled();
static void drawInfo();

// Record a directly-heard device (its MAC src), newest timestamp wins.
static void notePeer(uint32_t src) {
  uint32_t now = millis();
  for (int i = 0; i < peerCount; i++) {
    if (peerIds[i] == src) { peerLastMs[i] = now; return; }
  }
  if (peerCount < MAX_PEERS) {
    peerIds[peerCount] = src; peerLastMs[peerCount] = now; peerCount++;
  } else {
    int oldest = 0;
    for (int i = 1; i < MAX_PEERS; i++) if (peerLastMs[i] < peerLastMs[oldest]) oldest = i;
    peerIds[oldest] = src; peerLastMs[oldest] = now;
  }
}

static int peersInRange() {
  uint32_t now = millis();
  int n = 0;
  for (int i = 0; i < peerCount; i++) if (now - peerLastMs[i] < PEER_WINDOW_MS) n++;
  return n;
}

// Magic-framed binary on USB serial, for the test harness (see header comment).
static const uint8_t SERIAL_MAGIC0 = 0xAA;
static const uint8_t SERIAL_MAGIC1 = 0x55;

// Emit a heard packet to the host as a magic-framed binary frame.
static void serialEmitFrame(const uint8_t *buf, int len) {
  uint8_t hdr[4] = {SERIAL_MAGIC0, SERIAL_MAGIC1, (uint8_t)(len >> 8), (uint8_t)(len & 0xff)};
  Serial.write(hdr, sizeof(hdr));
  Serial.write(buf, len);
}

ICACHE_RAM_ATTR void onLoraRx() { rxFlag = true; }

static void onWsEvent(AsyncWebSocket *s, AsyncWebSocketClient *client, AwsEventType type,
                      void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    // One device per board: if a client is already connected, refuse the new one.
    if (s->count() > 1) {
      client->close(1013); // "try again later"
      return;
    }
    char hello[48];
    snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"nodeId\":%u}", nodeId);
    client->text(hello);
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    if (info->opcode == WS_BINARY && info->final && info->index == 0 && info->len == len) {
      TxMsg msg;
      msg.len = len > MAX_PAYLOAD ? MAX_PAYLOAD : (uint8_t)len;
      memcpy(msg.data, data, msg.len);
      xQueueSend(txQueue, &msg, 0); // drop if full — the governor upstream paces us
    }
  }
}

void setup() {
  Serial.begin(115200);
  nodeId = (uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF);
  snprintf(apSsid, sizeof(apSsid), "ZyPico-%08X", (unsigned)nodeId); // full id — unique
  txQueue = xQueueCreate(8, sizeof(TxMsg));

  // WiFi access point — fully offline, no router/internet. Open network
  // "ZyPico", limited to ONE connected device (max_connection = 1).
  WiFi.mode(WIFI_AP);
  bool apok = WiFi.softAP(apSsid, nullptr, 1 /*channel*/, 0 /*hidden*/, 1 /*max_connection*/);
  Serial.printf("softAP=%d  IP=%s\n", apok, WiFi.softAPIP().toString().c_str());

  bool fsok = LittleFS.begin(true);
  Serial.printf("LittleFS mount=%d total=%u used=%u\n", fsok,
                (unsigned)LittleFS.totalBytes(), (unsigned)LittleFS.usedBytes());
  File idx = LittleFS.open("/index.html", "r");
  Serial.printf("index.html exists=%d size=%u\n", idx ? 1 : 0, idx ? (unsigned)idx.size() : 0);
  if (idx) idx.close();

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_NSS);
  int st = radio.begin(ZYPICO_LORA_FREQ, LORA_BW, LORA_SF, LORA_CR, LORA_SYNC,
                       LORA_POWER, LORA_PREAMBLE, LORA_TCXO);
  if (st != RADIOLIB_ERR_NONE) {
    Serial.printf("LoRa begin failed: %d\n", st);
  }
  radio.setDio2AsRfSwitch(true);
  radio.setPacketReceivedAction(onLoraRx);
  radio.startReceive();

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  server.begin();

  // Onboard OLED: power it via Vext, reset, then show the ZyPico splash/status.
  pinMode(PIN_VEXT, OUTPUT);
  digitalWrite(PIN_VEXT, LOW); // LOW = OLED powered
  delay(50);
  oled.begin();
  pinMode(PIN_USER_BTN, INPUT_PULLUP);
  // Boot to the logo splash; it stays until the USER button switches to info.
  drawSplashOled();

  Serial.printf("ZyPico board up. nodeId=%u  AP=%s  freq=%.1f\n", nodeId, apSsid, (double)ZYPICO_LORA_FREQ);
}

static void drawSplashOled() {
  oled.clearBuffer();
  oled.drawXBM((128 - ZYPICO_LOGO_W) / 2, (64 - ZYPICO_LOGO_H) / 2, ZYPICO_LOGO_W, ZYPICO_LOGO_H, ZYPICO_LOGO_BITS);
  oled.sendBuffer();
}

// Info screen: no wordmark (the splash brands the device); status + how many
// ZyPico devices are in radio range right now.
static void drawInfo() {
  char line[28];
  oled.clearBuffer();
  oled.setFont(u8g2_font_5x8_tr);
  oled.drawStr(2, 10, "AP:");
  oled.drawStr(22, 10, apSsid);
  snprintf(line, sizeof(line), "node !%x", nodeId);
  oled.drawStr(2, 22, line);
  oled.drawStr(2, 34, "915 MHz");
  oled.drawLine(0, 40, 127, 40);
  oled.setFont(u8g2_font_6x12_tr);
  snprintf(line, sizeof(line), "In range: %d", peersInRange());
  oled.drawStr(2, 56, line);
  oled.sendBuffer();
}

void loop() {
  // Drain any pending transmit (radio is touched only from this task).
  TxMsg msg;
  while (xQueueReceive(txQueue, &msg, 0) == pdTRUE) {
    uint8_t buf[MAC_HEADER + MAX_PAYLOAD];
    txSeq++;
    buf[0] = nodeId >> 24; buf[1] = nodeId >> 16; buf[2] = nodeId >> 8; buf[3] = nodeId;
    buf[4] = txSeq >> 8; buf[5] = txSeq;
    memcpy(buf + MAC_HEADER, msg.data, msg.len);
    radio.transmit(buf, MAC_HEADER + msg.len);
    radio.startReceive();
  }

  if (rxFlag) {
    rxFlag = false;
    uint8_t buf[MAC_HEADER + MAX_PAYLOAD + 8];
    int len = radio.getPacketLength();
    if (len > 0 && len <= (int)sizeof(buf)) {
      int state = radio.readData(buf, len);
      if (state == RADIOLIB_ERR_NONE && len >= MAC_HEADER) {
        uint32_t src = ((uint32_t)buf[0] << 24) | ((uint32_t)buf[1] << 16) |
                       ((uint32_t)buf[2] << 8) | buf[3];
        uint16_t seq = ((uint16_t)buf[4] << 8) | buf[5];
        // Note: payload is BINARY (a RelayProtocol frame) — never print it as
        // text, or its bytes can mimic the 0xAA55 serial magic and desync a host.
        Serial.printf("RX src=%u seq=%u len=%d rssi=%.0f\n", src, seq, len, (double)radio.getRSSI());
        if (src != nodeId) {        // ignore our own echo
          notePeer(src);            // a ZyPico device heard directly = in range
          ws.binaryAll(buf, len);   // forward [srcId][seq][payload] to the browser
          serialEmitFrame(buf, len); // …and to the serial test harness
        }
      }
    }
    radio.startReceive();
  }

  ws.cleanupClients();

  // USER button toggles the OLED between the logo splash and the info screen.
  static bool prevDown = false;
  static uint32_t lastPress = 0;
  bool down = digitalRead(PIN_USER_BTN) == LOW;
  if (down && !prevDown && millis() - lastPress > 50) {
    lastPress = millis();
    showInfo = !showInfo;
    if (showInfo) drawInfo(); else drawSplashOled();
  }
  prevDown = down;

  // While the info screen is up, refresh it so the in-range count stays current.
  static uint32_t lastInfo = 0;
  if (showInfo && millis() - lastInfo > 2000) {
    lastInfo = millis();
    drawInfo();
  }

  // USB-serial input. A magic-framed binary frame (0xAA55 [len][frame]) is queued
  // for transmit exactly like a WebSocket frame — this is the test-harness path.
  // Any other line of text is still transmitted as-is (the old debug path). One
  // byte-at-a-time state machine handles both without one corrupting the other.
  static uint8_t serState = 0;          // 0 idle, 1 saw magic0, 2 len-hi, 3 len-lo, 4 body
  static uint16_t binLen = 0, binGot = 0;
  static uint8_t binBuf[MAC_HEADER + MAX_PAYLOAD];
  static char line[80];
  static int n = 0;
  auto flushTextLine = [&]() {
    if (n > 0) {
      uint8_t buf[MAC_HEADER + sizeof(line)];
      txSeq++;
      buf[0] = nodeId >> 24; buf[1] = nodeId >> 16; buf[2] = nodeId >> 8; buf[3] = nodeId;
      buf[4] = txSeq >> 8; buf[5] = txSeq;
      memcpy(buf + MAC_HEADER, line, n);
      radio.transmit(buf, MAC_HEADER + n);
      radio.startReceive();
      Serial.printf("TX seq=%u '%.*s'\n", txSeq, n, line);
      n = 0;
    }
  };
  while (Serial.available()) {
    uint8_t c = (uint8_t)Serial.read();
    switch (serState) {
      case 0:
        if (c == SERIAL_MAGIC0) serState = 1;
        else if (c == '\n' || c == '\r') flushTextLine();
        else if (n < (int)sizeof(line)) line[n++] = (char)c;
        break;
      case 1: // saw magic0
        if (c == SERIAL_MAGIC1) serState = 2;
        else { serState = 0; if (c == '\n' || c == '\r') flushTextLine(); else if (n < (int)sizeof(line)) line[n++] = (char)c; }
        break;
      case 2: binLen = (uint16_t)c << 8; serState = 3; break;
      case 3:
        binLen |= c; binGot = 0;
        serState = (binLen == 0 || binLen > sizeof(binBuf)) ? 0 : 4; // drop absurd lengths
        break;
      case 4:
        binBuf[binGot++] = c;
        if (binGot >= binLen) {
          TxMsg msg;                     // queue like a WS frame; loop() stamps src/seq
          msg.len = binLen > MAX_PAYLOAD ? MAX_PAYLOAD : (uint8_t)binLen;
          memcpy(msg.data, binBuf, msg.len);
          xQueueSend(txQueue, &msg, 0);
          serState = 0;
        }
        break;
    }
  }

#ifdef ZYPICO_SELFTEST
  // Hardware LoRa link test: transmit a ping every ~2s (no browser needed).
  static uint32_t lastPing = 0;
  if (millis() - lastPing > 2000) {
    lastPing = millis();
    uint8_t ping[MAC_HEADER + 4];
    txSeq++;
    ping[0] = nodeId >> 24; ping[1] = nodeId >> 16; ping[2] = nodeId >> 8; ping[3] = nodeId;
    ping[4] = txSeq >> 8; ping[5] = txSeq;
    memcpy(ping + MAC_HEADER, "PING", 4);
    radio.transmit(ping, MAC_HEADER + 4);
    radio.startReceive();
    Serial.printf("TX ping seq=%u\n", txSeq);
  }
#endif
}
