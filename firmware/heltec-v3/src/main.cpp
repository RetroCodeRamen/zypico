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

#include <Arduino.h>
#include <WiFi.h>
#include <SPI.h>
#include <LittleFS.h>
#include <RadioLib.h>
#include <ESPAsyncWebServer.h>
#include <U8g2lib.h>

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

static SX1262 radio = new Module(PIN_NSS, PIN_DIO1, PIN_RST, PIN_BUSY);
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

static uint32_t nodeId = 0;
static uint16_t txSeq = 0;
static char apSsid[24]; // unique per board so two boards are distinguishable
static volatile bool rxFlag = false;

struct TxMsg {
  uint8_t len;
  uint8_t data[MAX_PAYLOAD];
};
static QueueHandle_t txQueue;

static void showOled();

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
  showOled();

  Serial.printf("ZyPico board up. nodeId=%u  AP=%s  freq=%.1f\n", nodeId, apSsid, (double)ZYPICO_LORA_FREQ);
}

static void showOled() {
  char node[20];
  snprintf(node, sizeof(node), "node !%x", nodeId);
  oled.clearBuffer();
  oled.setFont(u8g2_font_ncenB14_tr);
  oled.drawStr(18, 24, "ZyPico");
  oled.setFont(u8g2_font_5x8_tr);
  oled.drawStr(2, 40, "WIFI:");
  oled.drawStr(30, 40, apSsid);
  oled.drawStr(2, 52, node);
  oled.drawStr(2, 62, "915 MHz");
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
        Serial.printf("RX src=%u seq=%u len=%d rssi=%.0f data='%.*s'\n", src, seq, len,
                      (double)radio.getRSSI(), len - MAC_HEADER, (const char *)&buf[MAC_HEADER]);
        if (src != nodeId) {        // ignore our own echo
          ws.binaryAll(buf, len);   // forward [srcId][seq][payload] to the browser
        }
      }
    }
    radio.startReceive();
  }

  ws.cleanupClients();

  // Debug: a line typed on USB serial is transmitted over LoRa, exactly like a
  // message sent from the browser (harmless in the field — no serial input there).
  static char line[80];
  static int n = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
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
    } else if (n < (int)sizeof(line)) {
      line[n++] = c;
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
