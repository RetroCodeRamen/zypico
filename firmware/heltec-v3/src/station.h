// ZyPico Station mode (device-as-Station). A board toggled into station mode
// becomes infrastructure, not a Wisp handheld: it provisions onto the local WiFi
// (setup AP -> join), serves a small management web page at its LAN IP, beacons
// as a STATION over LoRa, and repeats frames to extend range. No React app, no
// browser brain — the firmware does the mesh work itself in this mode.
//
// One integrated binary: main.cpp reads an NVS mode flag and dispatches here.
#pragma once
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>

// Boot the station: WiFi (setup AP or STA join), web pages, keypair. `server`
// and `dns` are owned by main.cpp and shared.
void stationSetup(AsyncWebServer &server, DNSServer &dns);

// Per-loop work in station mode: captive DNS (setup phase), the beacon timer.
void stationLoop();

// A RelayProtocol frame heard over LoRa (MAC header already stripped) — the
// repeater dedupes + rebroadcasts it onward.
void stationOnFrame(const uint8_t *frame, int len);

// --- provided by main.cpp (shared LoRa TX) ---
// Queue a RelayProtocol frame for transmit; main stamps the MAC header + sends.
void loraQueueFrame(const uint8_t *frame, int len);
