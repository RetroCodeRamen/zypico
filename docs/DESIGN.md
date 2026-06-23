# ZyPico / The Relay — Design

_Status: canonical design direction · v3 · 2026-06-22._

> This is the authoritative design document. It supersedes
> [The-Relay-Outline-v2.md](../The-Relay-Outline-v2.md) for **direction**; v2 is
> retained for deeper mechanics (hearts table, evolution tree, crypto detail)
> that this document references rather than repeats. Where they disagree, this
> document wins. Build state + roadmap live in
> [The-Relay-Project-Plan.md](../The-Relay-Project-Plan.md).

---

## 0. North star

ZyPico is a **tiny living world that exists inside a mesh network.** Opening it
should feel like **entering a place**, not launching software. Its ancestors are
the Cybiko, Tamagotchi, Dreamcast VMU, Geocities, AIM, BBSes, and Neopets — not
modern social media.

**The guiding question for every feature:** _does this make the Relay feel more
like a place people visit, and less like software they use?_ If a feature reads
as "an app screen," it's wrong.

Vocabulary: **ZyPico** is the device/product. **The Relay** is the world/network.
Users are **Travelers**; their companion is a **Wisp**; infrastructure nodes are
**Stations**; named locations are **Places** (the Commons, the Post, …).

---

## 1. Mesh-first architecture

The Relay is **local-first and mesh-first.** It is **not** a client/server
platform and must never become one. Four layers, in strict priority:

1. **Offline Device** — fully alive alone.
2. **Peer Mesh** — direct device-to-device over LoRa. _The primary experience._
3. **Station Infrastructure** — optional nodes that add persistence + reach.
4. **Optional Internet Relay** — opt-in federation between Stations.

**Stations enhance the world; they do not define it.** Everything core works
peer-to-peer with zero Stations and zero internet.

**What "the Relay" is, spatially:** your **local reachable mesh neighborhood** —
the set of devices you can currently hear (directly or via repeating Stations).
There is no single global world; there are many local neighborhoods, optionally
bridged by internet Stations. Two Travelers share "the Commons" only as far as
the mesh (or a Station bridge) connects them.

### 1.1 Offline Device (alone)
A Traveler with no one around can still: raise + care for their Wisp, play
single-player games, create content + Carts, **edit their Traveler Page**,
**compose Mail** (queues in the outbox), customize their profile, and browse
local content. The device is **always alive.**

### 1.2 Peer Mesh (others nearby) — the primary experience
When other Travelers are in range: presence activates, Travelers are
**discovered**, the **Commons** comes alive, **live Chat** is available, friends
are made, Wisps are seen, local activity becomes visible.

---

## 2. Travelers, Identity & Wisps

**Identity** is a cryptographic keypair derived from handle + password (Argon2id
→ Ed25519; X25519 for sealing). No server, no reset; the fingerprint is the
address. (Implemented; see v2 §9.3 and `core/identity`.)

**Wisps** are the companion (v2 §3 for the full model). Two **independent axes** —
this is the key reconciliation of the new Wisp-care direction with the old
anti-grind guardrail:

- **Hearts → Evolution (identity).** The five Hearts (Signal, Arena, Journey,
  Broadcast, Craft) are **earned only through participation** and drive the
  1→2→4→8 evolution tree + drift. **Care never buys Hearts.** (Unchanged from v2.)
- **Bond / Mood (warmth).** A separate axis moved by **care**: Feed, Treat, Play,
  Clean, Rest, Talk. Care affects the Wisp's **mood, animations, and idle
  behavior** — never evolution, never death (a neglected Wisp gets dim/sad, not
  gone). This is the Tamagotchi loop.

So: **who your Wisp *is*** comes from how you participate; **how your Wisp
*feels*** comes from how you care for it. Both are visible in the Wisp area.

---

## 3. Stations

A **Station** is a special ZyPico node providing infrastructure + persistence,
represented in-world as a **place with memory.** Stations are **optional**; the
Relay must function without them.

**A Station may provide:** mesh **repeating** (multi-hop reach); **ZyPico web
hosting**; **Mail** storage + forwarding; **Traveler Page** hosting; local
**shops**, **events**, **statistics**; **Account Vault** backups; and an optional
**internet gateway**.

**Stations are peer/federated, never central.** Each is autonomous; the network
runs with zero Stations; internet sync is opt-in federation between equals.

### 3.1 Station hardware — Traveler Mode vs. Station Mode
A device runs in one of two modes:
- **Traveler Mode** — the normal handheld (what we ship today).
- **Station Mode** — infrastructure: always-on, repeats, hosts, stores.

**Stations are a spectrum, not one box:**
- A **light Station** = supported hardware (e.g. Heltec V3) in Station Mode:
  repeating + a little Mail/Page storage in flash.
- A **full Station** = a bigger class of device (e.g. Raspberry Pi + LoRa) with
  real storage, web hosting, and an internet gateway.

**Mode switching** is an administrative/firmware setting (config menu or build
flag), gated behind Station admin login — not a casual toggle. _Open: exact
switch mechanism (physical vs. menu vs. separate firmware) — decide at Station
bring-up; favor a config/admin setting on shared hardware, dedicated firmware
for full Stations._

### 3.2 Station administration
In Station Mode, an **admin login** (separate from Traveler identity) exposes
config: station name + description, WiFi/LAN, repeater settings, Mail relay
settings, internet gateway, storage management, firmware management. **Normal
Travelers never see Station administration.**

---

## 4. Networking model

### 4.1 Presence (discovery, not detection)
Presence is **periodic broadcast**: every **60 s**; a Traveler is considered
**inactive after 5 min** of silence. A presence beacon carries: **handle,
fingerprint, Wisp form, current location, timestamp** (signed — proves key
ownership). Presence is how the world feels **inhabited**.

The UI speaks in **people**, never node tech: "Traveler Nearby," "New Traveler
Found," "Wisp Spotted," "Traveler Page Available" — never "node !a09e found."

### 4.2 Reachability
"Can I reach Traveler X **right now**?" = _did I hear X's presence within the
5-min window_ (directly or via a repeating Station). Reachability gates **Chat**.

### 4.3 Repeating (multi-hop)
Stations **repeat** frames to extend reach. This requires a **hop-limit / TTL**
in the frame (a new field — today's link is single-hop) plus dedupe (have it) so
repeats don't loop or saturate. Repeating runs under the **airtime governor**.

### 4.4 Communication is two distinct systems
- **Chat — immediate.** Exists only while Travelers can currently reach each
  other through the mesh. If reachability is lost, Chat becomes unavailable
  (history stays visible); further contact requires Mail. Chat feels like AIM /
  Cybiko messaging / walkie-talkies. Local + immediate. Includes the **Commons**
  (public local chat) and **live DMs** (private, E2E) when both are reachable.
- **Mail — persistent.** The **only** Traveler-to-Traveler system that moves
  **between Stations**. Write → outbox → reaches a Station → Station forwards →
  eventually arrives. Encrypted end-to-end and **stored encrypted at rest** on
  Stations (vault pattern). Mail feels like **letters traveling through the
  Relay.** The Post is distinct from Chat.

_Implication:_ with no Station in the path, Mail simply waits in the outbox —
Chat still works locally. This is intended.

### 4.5 Airtime reality
LoRa duty cycle + presence-every-60 s means a neighborhood realistically holds a
**small number of Travelers** (low dozens). We design **for** small, intimate
neighborhoods — which is exactly why the activity stars (§6.4) top out at 9.

---

## 5. Places & the world

The Relay is a world of **Places** you move between. A Place is an *experience*
(works locally on any device); a **Station** can give a Place **memory + reach.**

- **The Commons** — the town square; the center of local social life.
- **The Post** — Mail.
- **The Exchange** — items, themes, Carts, content.
- **Pages** — Traveler Pages + Guestbooks.
- **Clubs** — private groups (shared-key, v2 §7).
- **Stations** — visitable places with memory.
- **The Arcade** — games.

### 5.1 The Commons
Entering the Commons, a Traveler **immediately sees signs of life**: Travelers
arriving, recent activity, public conversation, nearby Wisps, active Stations.
Functions: **local public chat**, **Traveler discovery**, an **activity feed**,
community announcements. The Commons stays **primarily local.**

### 5.2 Traveler Pages
Every Traveler can build a **small personal page** (Geocities / .plan / Cybiko
vibe): About Me, My Wisp, Pixel Art, Favorite Carts, Notes, Achievements, and a
**Guestbook**. Pages are **intentionally small.** Pages are **hosted by
Stations**; an internet Station may sync/back-up/surface them on other Stations.
**The page belongs to the Traveler, not the Station.**

### 5.3 Guestbooks
Every Page has a **Guestbook** — short public messages from visitors, evoking
early-internet culture.

### 5.4 Account Vaults
Optional **encrypted** backups stored at Stations: Wisp, friends, inventory,
settings, Mail, Pages, content. **Passwords never leave the client; decryption is
client-side; Stations store only ciphertext.** (Extends v2 §9.5 export/import.)

---

## 6. UX & navigation

### 6.1 Connectivity is ambient — no "Radio"
**There is no Radio section.** Connectivity is **infrastructure**: the device
simply *feels* connected to the Relay. Connection state may appear as **ambient
status** (a small glyph / a line in the Commons), but it is **not** a navigation
destination. The freed slot becomes the **Wisp** interaction area.

### 6.2 Primary navigation (eight Places)
| Place | Contains |
|-------|----------|
| **The Commons** | local public chat · activity feed · discovery |
| **Travelers** | friends · nearby travelers |
| **The Post** | mail · outbox · delivery |
| **Pages** | Traveler Pages · Guestbooks |
| **Wisp** | companion interaction (Feed/Play/Clean/Rest/Talk/Rename/Stats) |
| **The Arcade** | games |
| **The Exchange** | items · themes · Carts · content |
| **Profile** | identity · settings |

_Open items:_ **Craft (Cart authoring)** lands inside Exchange/Pages tooling
rather than a top icon; **Quests / exploration / travel to Stations** is reached
**through the Commons** (a travel action), not a ninth icon. **Home/landing = your
Wisp** (always alive, local); the Commons is a place you step into. ← confirm.

### 6.3 Friends — "I met this traveler"
Friends are **people encountered during travels**, not address-book contacts.
Per friend: View Profile · Chat · Send Mail · View Traveler Page · View Wisp.
Emotional model: _"I met this traveler,"_ never _"I added a contact."_

### 6.4 The environment shows activity
The world itself signals how alive it is. Example: decorative **stars brighten
with nearby Traveler count** — 0–3 → one bright star, 4–6 → two, 7–9 → three. The
Relay should *look* inhabited.

### 6.5 The Wisp area
Replaces Radio. Care actions (Feed, Treat, Play, Clean, Rest, Talk), plus Rename
and View Stats. It must feel **alive and present**, not a stat sheet — animations
and reactions first, numbers second. (Hearts/evolution shown; Bond/Mood front.)

---

## 7. Architecture (build view)

**Two+ artifacts behind one transport facade (`MeshTransport`):**
- **Traveler firmware** (ESP32, today: Heltec V3) — WiFi-AP + serves the web UI +
  WebSocket ↔ LoRa bridge. Thin.
- **Station firmware / mode** — adds repeating, store-and-forward, hosting,
  vaults, gateway. (New workstream.)
- **Web app** (browser) — the whole UI + RelayProtocol + domain logic.

**Web app layering** (current; see §"App.tsx" debt in the plan): `core/`
(framework-agnostic: protocol, identity, companion) → `transport/` (facade +
`BoardTransport`) → domain logic → `ui/`. A **domain layer** (social, messaging,
companion, pages stores) should be extracted out of the UI as systems grow.

**Protocol additions this direction requires:**
- presence v2 fields (Wisp form, location, timestamp; 60 s / 5 min);
- a **hop-limit/TTL** for repeating;
- **Mail store-and-forward** (addressed, encrypted-at-rest, Station-relayed);
- **Station beacons** (advertise identity + services);
- **Page** + **Guestbook** content sync (Station-hosted);
- **Vault** blob storage (opaque ciphertext) at Stations.

**Security:** Travelers sign presence/posts; DMs + Mail are E2E (X25519 +
XChaCha20-Poly1305); Vaults are encrypted client-side — Stations hold only
ciphertext and never see passwords.

---

## 8. Open questions to resolve before/at implementation

1. **Wisp axes** — confirm Hearts(evolution) vs Bond(care) split (§2).
2. **Home/landing** — Wisp vs Commons (§6.2).
3. **Craft + Quests placement** now that they're off the primary nav (§6.2).
4. **Station mode switch** mechanism + the light-vs-full Station hardware line (§3.1).
5. **Location namespace** — what a "current location" is, and how Places are named
   across a neighborhood (needed for presence "current location" + travel).
6. **Mail addressing across Stations** — how a Station knows where to forward, and
   for how long it holds undelivered mail.
7. **Repeating policy** — hop limit value, dedupe window, governor budget for
   repeats so a busy neighborhood doesn't saturate.
