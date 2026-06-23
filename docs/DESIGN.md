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

**Wisps** are the companion (v2 §3 for the full model). Two **independent
systems** — this reconciles the Wisp-care direction with the anti-grind guardrail:

- **Hearts → Evolution (identity).** The five Hearts (Signal, Arena, Journey,
  Broadcast, Craft) are **earned only through participation** and drive the
  1→2→4→8 evolution tree + drift. **Care never buys Hearts.** (Unchanged from v2.)
- **Bond / Mood (warmth).** A separate system moved by **care** (Feed, Treat,
  Play, Clean, Rest, Talk). Bond/Mood drives the Wisp's **personality,
  animations, reactions, dialogue, and emotional state** — never evolution.

So: **who your Wisp *is*** comes from how you participate; **how your Wisp
*feels*** comes from how you care for it.

**Neglect — warmth, not anxiety.** A Wisp **never dies, never loses an evolution
stage, never permanently regresses.** Mood uses **gentle, slow decay** and is
**not** punishment-based. A long-neglected Wisp simply becomes **lonely / sad,
moves less, animates differently**, and may **mention it missed you** — then
brightens when you return.

**The Wisp lives its life (the mesh, felt through the companion).** While you're
away, the Wisp keeps living in the Relay: it **notices passing Travelers, hears
about Stations, and collects little discoveries.** On your return it **shares
what it saw** — "I spotted a traveler named WonkyTanuki," "I heard about a Station
to the south," small journal moments. This is how the **mesh becomes emotionally
legible** — presence and activity the device hears become the Wisp's stories,
not a notification list.

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

**Decided:** the **first Station is a Station *mode* on existing Heltec hardware**
(fast to test/deploy) — switched via an **administrative setting**, gated behind
**Station admin login** (separate credentials + auth model from any Traveler
identity). Dedicated full-Station firmware (Pi-class) comes later.

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

**Nearby Travelers vs. Relay Travelers** (worldbuilding, not networking jargon):
- **Nearby Travelers** — heard **directly**, within immediate radio range.
- **Relay Travelers** — reached **through one or more mesh hops** (other devices /
  Stations relaying). Present, part of your world, just **further out**.

This makes the Relay feel **larger than radio range while still local** — you
sense a community beyond the people right next to you, with no internet involved.
The UI surfaces it as a soft sense of distance ("Nearby" vs "across the Relay"),
never as hop counts.

### 4.2 Reachability
"Can I reach Traveler X **right now**?" = _did I hear X's presence within the
5-min window_ (directly = Nearby, or via hops = Relay). Reachability gates **Chat**.

### 4.3 Repeating (multi-hop — baseline, from day one)
**Multi-hop is on from the start, not deferred to Stations.** Every ZyPico board
(Traveler firmware included) **repeats** frames within a **hop limit of 3**, so
the world feels inhabited even when adopters are sparse — no Stations or internet
required. Stations simply repeat with more range/uptime. Requires a **hop-limit /
TTL field** in the frame (new — today's link is single-hop) + the existing dedupe
so repeats never loop; all repeating runs under the **airtime governor**. The hop
limit is protocol-adjustable for future tuning.

### 4.4 Communication is two distinct systems
- **Chat — immediate.** Exists only while Travelers can currently reach each
  other through the mesh (Nearby or Relay). Includes the **Commons** (public local
  chat) and **live private DMs** (E2E). If a peer goes unreachable, Chat to them
  becomes unavailable — history stays visible, and the UI offers a **prompt**:
  _"Traveler unavailable. Send as Mail instead?"_ Chat is **never silently
  converted** to Mail — the distinction stays visible. Chat feels like AIM /
  Cybiko / walkie-talkies.
- **Mail — persistent, private.** The **only** Traveler-to-Traveler system that
  moves **between Stations** (store-and-forward). Write → outbox → reaches a
  Station → forwarded → eventually arrives. Encrypted E2E and **stored encrypted
  at rest** on Stations (vault pattern). Mail feels like **letters traveling
  through the Relay.**

_Implication:_ with no Station in the path, Mail waits in the outbox — Chat still
works locally. Intended.

**Commons history (hybrid).** Without a Station, the Commons keeps **~10 recent
messages** (a live gathering place, not a forum). With a Station present, the
Station acts as local memory and the Commons keeps **~50** scrollable. Either
way it stays a **town square**, not a traditional forum.

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

**Decided:** **Home/landing = your Wisp** (always alive, local) — you *live with*
your Wisp and *travel into* the Relay. **Craft (Cart authoring)** lives inside
Exchange/Pages tooling, not a top icon. **Quests / exploration / travel to
Stations** is reached **through the Commons** (a travel action), not a ninth icon.

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

## 8. Decisions locked + remaining detail

**Locked (2026-06-22):** two-axis Wisp (Hearts=evolution / Bond=care); Wisp never
dies, gentle non-punitive mood decay, "lives its life" + shares discoveries; home
= Wisp; eight Places; Craft under Exchange/Pages; travel via the Commons; Chat vs
Mail split with a DM→Mail prompt; Mail private-only; Commons history 10/50
(without/with Station); first Station = admin mode on Heltec; full Station later;
US 915 only; presence 60 s / 5-min; **multi-hop from day one, hop limit 3, all
boards repeat**; Nearby vs Relay Travelers; location = current Place; local
neighborhoods bridged optionally by internet Stations; local encrypted
export/import first, Station Vaults later; multiple identities per device;
**start with M1 (architecture).**

**Remaining implementation detail (resolve at the relevant milestone):**
- **Mail addressing/retention** — how a Station decides where to forward and how
  long it holds undelivered mail (M6/M7).
- **Repeating tuning** — dedupe window + governor budget so a busy neighborhood
  doesn't saturate, beyond the hop-limit of 3 (done with the baseline repeater).
- **Station service advertisement** — what a Station beacon announces (M7).
