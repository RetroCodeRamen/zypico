#include "station.h"
#include <WiFi.h>
#include <Preferences.h>
#include <Crypto.h>
#include <Ed25519.h>

// --- config / identity (NVS) -------------------------------------------------
extern uint32_t nodeId; // from main.cpp (made non-static)

static Preferences prefs;
static String cfgSsid, cfgPass, cfgName;
static uint8_t svcMask = 0x01; // SERVICE.REPEAT by default (v1 actively repeats)
static uint8_t stPriv[32], stPub[32];

// RelayProtocol / beacon constants (must match src/core/protocol).
static const uint8_t VERSION_BYTE = 0x02; // (major 0 << 4) | minor 2
static const uint8_t SUBTYPE_STATION = 0x04;

static bool staMode = false;     // true once joined the home WiFi (vs setup AP)
static uint32_t framesRepeated = 0, beaconsSent = 0;

// --- msgId dedupe ring (repeater) --------------------------------------------
static const int SEEN_N = 96;
static uint32_t seen[SEEN_N];
static int seenHead = 0;
static bool sawMsg(uint32_t id) {
  for (int i = 0; i < SEEN_N; i++) if (seen[i] == id) return true;
  return false;
}
static void markMsg(uint32_t id) { seen[seenHead] = id; seenHead = (seenHead + 1) % SEEN_N; }

// --- pending (jittered) repeats ----------------------------------------------
struct Pending { uint8_t buf[200]; int len; uint32_t at; bool used; };
static const int PEND_N = 12;
static Pending pend[PEND_N];

// --- identity ---------------------------------------------------------------
static void loadOrMakeKeypair() {
  size_t got = prefs.getBytes("seed", stPriv, sizeof(stPriv));
  if (got != sizeof(stPriv)) {
    for (int i = 0; i < 32; i += 4) { uint32_t r = esp_random(); memcpy(stPriv + i, &r, 4); }
    prefs.putBytes("seed", stPriv, sizeof(stPriv));
  }
  Ed25519::derivePublicKey(stPub, stPriv);
}

static String defaultName() {
  char n[24];
  snprintf(n, sizeof(n), "STATION-%04X", (unsigned)(nodeId & 0xffff));
  return String(n);
}

// --- the signed STATION beacon ----------------------------------------------
static void sendBeacon() {
  uint8_t name[20];
  int nameLen = cfgName.length(); if (nameLen > 20) nameLen = 20;
  memcpy(name, cfgName.c_str(), nameLen);

  // sig over pubkey || name || serviceByte
  uint8_t msg[32 + 20 + 1];
  memcpy(msg, stPub, 32);
  memcpy(msg + 32, name, nameLen);
  msg[32 + nameLen] = svcMask;
  uint8_t sig[64];
  Ed25519::sign(sig, stPriv, stPub, msg, 32 + nameLen + 1);

  uint8_t frame[8 + 32 + 64 + 1 + 20 + 1];
  int o = 0;
  frame[o++] = VERSION_BYTE; frame[o++] = SUBTYPE_STATION; frame[o++] = 0x00; frame[o++] = 0x03; // hopLimit 3
  uint32_t msgId = esp_random();
  frame[o++] = msgId >> 24; frame[o++] = msgId >> 16; frame[o++] = msgId >> 8; frame[o++] = msgId;
  memcpy(frame + o, stPub, 32); o += 32;
  memcpy(frame + o, sig, 64); o += 64;
  frame[o++] = (uint8_t)nameLen;
  memcpy(frame + o, name, nameLen); o += nameLen;
  frame[o++] = svcMask;

  markMsg(msgId);          // don't repeat our own beacon echo
  loraQueueFrame(frame, o);
  beaconsSent++;
}

// --- repeater ---------------------------------------------------------------
void stationOnFrame(const uint8_t *frame, int len) {
  if (len < 8) return;
  uint32_t msgId = ((uint32_t)frame[4] << 24) | ((uint32_t)frame[5] << 16) | ((uint32_t)frame[6] << 8) | frame[7];
  if (sawMsg(msgId)) return;
  markMsg(msgId);
  uint8_t hop = frame[3];
  if (hop <= 1 || len > 200) return; // terminal, or too big to buffer
  // Schedule a jittered rebroadcast (Meshtastic-style) so the repeat doesn't
  // collide with the originator's next frame on this half-duplex link.
  for (int i = 0; i < PEND_N; i++) {
    if (!pend[i].used) {
      memcpy(pend[i].buf, frame, len);
      pend[i].buf[3] = hop - 1; // decrement hop limit
      pend[i].len = len;
      pend[i].at = millis() + 250 + (esp_random() % 750);
      pend[i].used = true;
      return;
    }
  }
}

// --- web pages ---------------------------------------------------------------
static const char SETUP_HTML[] PROGMEM = R"HTML(<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>ZyPico Station setup</title><style>body{font:16px system-ui;margin:24px;max-width:480px;background:#10131a;color:#e6e6e6}
h1{font-size:20px}button,input{font:inherit;padding:8px;border-radius:8px;border:1px solid #444;background:#1d2330;color:#e6e6e6}
.n{display:block;width:100%;text-align:left;margin:4px 0}.n b{float:right;color:#8aa}#st{color:#9c9}</style>
<h1>ZyPico Station</h1><p>Pick your WiFi network, enter its password, and Join. The station will then be reachable on your network.</p>
<div id=list>scanning...</div><p><input id=ssid placeholder="network name" style="width:100%"></p>
<p><input id=pw type=password placeholder="wifi password" style="width:100%"></p>
<p><button onclick=join()>JOIN WIFI</button> <button onclick=scan()>RESCAN</button></p><p id=st></p>
<script>
function scan(){fetch('/scan').then(r=>r.json()).then(ns=>{list.innerHTML='';ns.forEach(n=>{var b=document.createElement('button');b.className='n';b.innerHTML=n.ssid+' <b>'+n.rssi+'dBm'+(n.lock?' \u{1F512}':'')+'</b>';b.onclick=()=>{ssid.value=n.ssid;pw.focus()};list.appendChild(b)})}).catch(()=>list.innerHTML='scan failed')}
function join(){st.textContent='joining...';var f=new FormData();f.append('ssid',ssid.value);f.append('pass',pw.value);fetch('/join',{method:'POST',body:f}).then(r=>r.text()).then(t=>st.textContent=t)}
scan();
</script>)HTML";

static const char MGMT_HTML[] PROGMEM = R"HTML(<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>ZyPico Station</title><style>body{font:16px system-ui;margin:24px;max-width:480px;background:#10131a;color:#e6e6e6}
h1{font-size:20px}button,input{font:inherit;padding:8px;border-radius:8px;border:1px solid #444;background:#1d2330;color:#e6e6e6}
label{display:block;margin:6px 0}.s{color:#9c9}.danger{border-color:#a44}</style>
<h1>ZyPico Station</h1><pre id=st class=s>loading...</pre>
<h3>Name</h3><p><input id=name style="width:70%"> <button onclick=saveName()>SET</button></p>
<h3>Services advertised</h3><div id=svc></div>
<p><button onclick=fwifi() class=danger>FORGET WIFI</button> <button onclick=toClient() class=danger>SWITCH TO CLIENT MODE</button></p>
<script>
var SV=[['REPEAT',1],['MAIL',2],['PAGES',4],['COMMONS',8],['VAULT',16]];
function load(){fetch('/status').then(r=>r.json()).then(s=>{st.textContent='name: '+s.name+'\nwifi: '+s.ssid+'  ip: '+s.ip+'\nuptime: '+s.up+'s\nrepeated: '+s.rep+'  beacons: '+s.bc;name.value=s.name;svc.innerHTML='';SV.forEach(([n,b])=>{var l=document.createElement('label');l.innerHTML='<input type=checkbox '+((s.svc&b)?'checked':'')+' onchange="setSvc('+b+',this.checked)"> '+n;svc.appendChild(l)})})}
function saveName(){var f=new FormData();f.append('name',name.value);fetch('/name',{method:'POST',body:f}).then(load)}
function setSvc(b,on){var f=new FormData();f.append('bit',b);f.append('on',on?1:0);fetch('/services',{method:'POST',body:f}).then(load)}
function fwifi(){if(confirm('Forget WiFi and return to setup?'))fetch('/forget',{method:'POST'})}
function toClient(){if(confirm('Switch this board back to a Wisp handheld?'))fetch('/mode/client',{method:'POST'})}
load();setInterval(load,4000);
</script>)HTML";

// --- WiFi + web setup --------------------------------------------------------
static void serveRoot(AsyncWebServer &server) {
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
    req->send_P(200, "text/html", staMode ? MGMT_HTML : SETUP_HTML);
  });
  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *req) {
    char j[200];
    snprintf(j, sizeof(j), "{\"name\":\"%s\",\"ssid\":\"%s\",\"ip\":\"%s\",\"up\":%lu,\"rep\":%lu,\"bc\":%lu,\"svc\":%u}",
             cfgName.c_str(), staMode ? cfgSsid.c_str() : "(setup)",
             staMode ? WiFi.localIP().toString().c_str() : "-",
             (unsigned long)(millis() / 1000), (unsigned long)framesRepeated, (unsigned long)beaconsSent, svcMask);
    req->send(200, "application/json", j);
  });
  server.on("/scan", HTTP_GET, [](AsyncWebServerRequest *req) {
    int n = WiFi.scanNetworks();
    String out = "[";
    for (int i = 0; i < n && i < 20; i++) {
      if (i) out += ",";
      out += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + WiFi.RSSI(i)
           + ",\"lock\":" + (WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "0" : "1") + "}";
    }
    out += "]";
    WiFi.scanDelete();
    req->send(200, "application/json", out);
  });
  server.on("/join", HTTP_POST, [](AsyncWebServerRequest *req) {
    if (!req->hasParam("ssid", true)) { req->send(400, "text/plain", "no ssid"); return; }
    prefs.putString("ssid", req->getParam("ssid", true)->value());
    prefs.putString("pass", req->hasParam("pass", true) ? req->getParam("pass", true)->value() : "");
    req->send(200, "text/plain", "saved - rebooting to join...");
    delay(400); ESP.restart();
  });
  server.on("/name", HTTP_POST, [](AsyncWebServerRequest *req) {
    if (req->hasParam("name", true)) { cfgName = req->getParam("name", true)->value(); prefs.putString("name", cfgName); }
    req->send(200, "text/plain", "ok");
  });
  server.on("/services", HTTP_POST, [](AsyncWebServerRequest *req) {
    if (req->hasParam("bit", true) && req->hasParam("on", true)) {
      uint8_t bit = (uint8_t)req->getParam("bit", true)->value().toInt();
      if (req->getParam("on", true)->value().toInt()) svcMask |= bit; else svcMask &= ~bit;
      prefs.putUChar("svc", svcMask);
    }
    req->send(200, "text/plain", "ok");
  });
  server.on("/forget", HTTP_POST, [](AsyncWebServerRequest *req) {
    prefs.remove("ssid"); prefs.remove("pass");
    req->send(200, "text/plain", "forgotten - rebooting");
    delay(400); ESP.restart();
  });
  server.on("/mode/client", HTTP_POST, [](AsyncWebServerRequest *req) {
    Preferences m; m.begin("zypico", false); m.putUChar("mode", 0); m.end();
    req->send(200, "text/plain", "switching to client mode - rebooting");
    delay(400); ESP.restart();
  });
  server.onNotFound([](AsyncWebServerRequest *req) { req->send_P(200, "text/html", staMode ? MGMT_HTML : SETUP_HTML); });
}

void stationSetup(AsyncWebServer &server, DNSServer &dns) {
  prefs.begin("zypico-st", false);
  cfgSsid = prefs.getString("ssid", "");
  cfgPass = prefs.getString("pass", "");
  cfgName = prefs.getString("name", defaultName());
  svcMask = prefs.getUChar("svc", 0x01);
  loadOrMakeKeypair();

  if (cfgSsid.length() > 0) {
    // Provisioned — join the home WiFi (STA). Fall back to the setup AP if it
    // won't connect within ~20s so you can always re-provision.
    WiFi.mode(WIFI_STA);
    WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(200);
    staMode = WiFi.status() == WL_CONNECTED;
    Serial.printf("[station] join '%s' -> %s  ip=%s\n", cfgSsid.c_str(),
                  staMode ? "OK" : "FAILED", WiFi.localIP().toString().c_str());
  }
  if (!staMode) {
    char ap[24];
    snprintf(ap, sizeof(ap), "ZyPico-Setup-%04X", (unsigned)(nodeId & 0xffff));
    WiFi.mode(WIFI_AP);
    WiFi.softAP(ap, nullptr, 1, 0, 1);
    dns.setErrorReplyCode(DNSReplyCode::NoError);
    dns.start(53, "*", WiFi.softAPIP()); // captive: setup page auto-opens
    Serial.printf("[station] setup AP=%s ip=%s\n", ap, WiFi.softAPIP().toString().c_str());
  }
  serveRoot(server);
  server.begin();
  Serial.printf("[station] '%s' up (services=%u)\n", cfgName.c_str(), svcMask);
}

void stationLoop() {
  // Drain any due jittered repeats.
  uint32_t now = millis();
  for (int i = 0; i < PEND_N; i++) {
    if (pend[i].used && (int32_t)(now - pend[i].at) >= 0) {
      loraQueueFrame(pend[i].buf, pend[i].len);
      framesRepeated++;
      uint32_t id = ((uint32_t)pend[i].buf[4] << 24) | ((uint32_t)pend[i].buf[5] << 16) | ((uint32_t)pend[i].buf[6] << 8) | pend[i].buf[7];
      Serial.printf("[station] repeat msgId=%08X hop=%u (total %lu)\n", (unsigned)id, pend[i].buf[3], (unsigned long)framesRepeated);
      pend[i].used = false;
    }
  }
  // Periodic STATION beacon — first one soon after boot (~3s), then every ~60s.
  static uint32_t lastBeacon = 0;
  if (now - lastBeacon > (beaconsSent ? 60000 : 3000)) { lastBeacon = now; sendBeacon(); }
}
