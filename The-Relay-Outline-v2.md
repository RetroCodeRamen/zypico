# The Relay — Complete Project Outline (v2)

> A retro-inspired social handheld where a small living community fits in your pocket. All communication runs over a LoRa mesh (Meshtastic). The first build target is a browser-based web app (PWA) that connects directly to a local Meshtastic node; the end target is a dedicated handheld device.

This document describes the **finished product**, not a first milestone. It is the full feature surface, the lore that motivates it, the technical constraints that shape it, and a build roadmap that reaches the end state. An implementing agent should treat the end state as the goal and use the roadmap only to sequence the work.

**v2 changes:** This revision folds in the resolved design decisions from the first design review. Decisions are integrated into the relevant sections below and also logged for traceability in **§17 — Resolved Decisions**. Where v2 changes existing behavior, it is marked **(v2)**.

---

## 1. Vision

**North star: Cybiko meets Tamagotchi — with modern LoRa.** The Relay is, in spirit, a **Cybiko reborn**: a late-90s wireless social handheld with messaging, communities, little games, and a built-in programming environment — but where the Cybiko had *Cylandia* (its onboard creature world), The Relay has **Wisps**. To that Cybiko DNA we add Tamagotchi-style companion warmth and a few modern mesh advantages — far longer range, store-and-forward resilience, and a real LoRa mesh — in place of the Cybiko's short-range RF.

The Relay recreates the feeling of late-90s connected life: AIM buddy lists, ICQ, BBSes, the Cybiko, the Dreamcast VMU, Tamagotchi. It is a single coherent app where you message friends, hang out in communities, play small games, explore, **make things and pass them to each other**, and raise a companion creature that grows into a portrait of how you spend your time here.

It is a **communication platform built around creativity**, not a chat app. Messaging is the connective tissue; making and sharing is the point. The headline expression of that is user scripting: travelers write small programs in **Lua** and send them across the mesh to each other (see §7 and §12.1).

**Core philosophy:**
- The platform exists to connect people. The companion enriches that; it is never the point.
- The hierarchy is always: Traveler → Profile → Companion. The companion is not the user's identity.
- Growth comes from participation, not grinding.
- Creation is first-class: the platform ships the tools to make things, not just consume them.
- Constraints are aesthetic. The mesh is slow and patient; that patience is part of the feeling, not a flaw to hide.
- **(v2) Local-first as a feeling, not a fallback.** The device is fully alive with no radio attached — you can raise your Wisp, author and play single-player Carts, and compose messages into an outbox offline. It *travels* to the Relay to share, explore, and communicate. There is **no simulated or synthetic mesh anywhere** — not in the product and not in testing; mesh behavior is validated on real nodes.

**This is NOT:** a chat app, modern social media, a Pokémon clone, a Digimon clone, or a Tamagotchi clone. Companions do not fight to the death, are not collected for power, and cannot be bought.

---

## 2. The World

**The Relay** is the invisible network that exists between devices. It is formed by everything travelers do: messages, mail, posts, games, quests, friendships. Opening the app means entering the Relay.

**Travelers** are the users. Each has a handle (e.g. `WonkyTanuki`), a profile, and a companion. **(v2)** A traveler's identity is a cryptographic keypair (see §9.3); the handle is a display label, not the identity.

**Geography — Stations.** The Relay is organized into *Stations*: named places a traveler can move between. Stations give Journey and quests somewhere to happen, and they reconcile the local-vs-global question:

- **Global Stations** always exist for everyone: **The Commons** (town square / general hub), **The Arcade** (games), **The Broadcast** (public boards), **The Post** (mail), **The Exchange** (player content + cosmetics), **The Archive** (guides and stories), **The Arena** (companion bouts), **The Frontier** (exploration / the unmapped edge). **(v2)** Global Stations are UI containers; their *content* is real only as far as the shared Relay channel propagates across the mesh. Your Commons and a distant traveler's Commons hold the same shape but only overlap where the mesh connects you.
- **Local Stations** are emergent from the physical mesh. Because LoRa reachability depends on proximity, the cluster of nodes near you forms your **Home Station** / neighborhood — **(v2)** literally the set of travelers whose beacons you can hear. As the real mesh grows, new local Stations appear.
- **Clubs** are private Stations (see §5).

Navigation in the UI is "traveling" between Stations, with the companion always present on screen.

---

## 3. Companions (Wisps)

### 3.1 What they are
Companions are called **Wisps**: small lights born from the Relay. The unformed residue of everyone's activity drifts as ambient signal ("drift"); when enough gathers, it awakens into a Wisp. A freshly awakened Wisp is unsorted signal, made of everyone and claimed by no one, which is why every Wisp starts identical. The moment it bonds to a traveler, it begins to be shaped only by that traveler's signal.

A Wisp is a companion, partner, sidekick, and mascot. It is a visible, carryable record of who its traveler — **(v2)** and everyone who has ever held it — has been in the Relay.

**(v2) Wisps are first-class objects.** A Wisp is a serializable, signed object with a **lineage chain** (see §3.7). It can be raised, gifted, released, backed up, and carried between devices and identities. A traveler keeps **one active companion** (always on screen, currently being raised) plus a **held collection / menagerie** of others received, caught from drift, or kept as lineage keepsakes; the active Wisp can be swapped from the collection.

### 3.2 The five Hearts
Hearts fill from how the traveler participates. They are tracked **locally** on the device.

| Heart | Domain | Filled by | Reads as (visual tone) |
|---|---|---|---|
| **Signal** | Connection | IM, mail, friend interaction | warm, soft, golden |
| **Arena** | Skill | games, challenges, bouts | sharp, quick, crystalline |
| **Journey** | Curiosity | quests, discovery, new travelers, new Stations | restless, cool, trailing |
| **Broadcast** | Community | posting, replying, discussion | loud, radiant, large presence |
| **Craft** | Creativity | making content, quests, clubs, resources | intricate, structured, lattice-like |

Hearts are **trust-based and cosmetic** (§9.4): computed locally, not server-verified. Some hearts can grow offline (Craft via authoring; raising activity); social hearts grow when the device reaches the Relay.

### 3.3 Lifecycle — four tiers of light
Evolution is behavior-driven, not level-driven. The question is "how was this Wisp raised?" Four tiers:

1. **Flicker** (Awakening) — identical for everyone. A thin, colorless, uncertain light. A neglected Wisp simply stays a Flicker; no death, no punishment.
2. **Ember** (Young Form) — the light catches and takes its first tone.
3. **Glow** (Developed Form) — a distinct, recognizable character.
4. **Beacon** (Master Form) — a fully realized light others can navigate by. A Beacon is a landmark in the Relay; maturation makes a traveler part of the map everyone else uses.

### 3.4 The evolution tree (1 → 2 → 4 → 8)
A binary tree. Each split is a more specific answer to "who are you in the Relay," derived from the traveler's hearts at the moment of evolving.

- **Flicker** (1)
  - **Warm Ember** — turned toward people
    - *Close-warm Glow* → **Lantern** (steady one-to-one warmth) · **Hearth** (gathers and holds a circle)
    - *Public-warm Glow* → **Herald** (a voice that carries) · **Chorus** (lifts other voices)
  - **Bright Ember** — turned toward the world and works
    - *Venturing Glow* → **Pathfinder** (explores and maps) · **Champion** (sharpens against others)
    - *Making Glow* → **Forge** (builds the tools and quests others use) · **Weaver** (makes stories, guides, patterns)

The eight Beacons map back to the hearts: Signal → Lantern, Hearth; Broadcast → Herald, Chorus; Journey → Pathfinder; Arena → Champion; Craft → Forge, Weaver.

The system is built to expand later (deeper splits, more leaves) without restructuring.

### 3.5 Drift (re-pathing)
A Wisp's form is the current settling of an ongoing process, not a carving. If a traveler's behavior changes over time, the Wisp can **drift** to a different path. Drift does not drop tiers (earned maturity stays); it changes which kind of mature the Wisp is. The previous form lingers as a faint undertone, so a veteran's Wisp becomes a palimpsest layered with everyone they have been. Drift costs real participation, never a button press.

### 3.6 On the mesh **(v2 revised)**
The full Wisp lives locally. In ordinary operation only a compact **Wisp signature** (`WISP_SIG`) crosses the network: a few bytes encoding tier, path, and dominant/secondary hearts. The mesh carries the **whole creature only on an explicit gift or transfer** (`WISP_GIFT`, §11.3), which rides the same large-transfer plumbing as a Cart (§5/§11.2). Nothing about the full Wisp is broadcast routinely.

### 3.7 Lineage, gifting & the menagerie **(v2 new)**
Every Wisp carries a **signed lineage chain**: born from drift → raised by `Traveler·fp` → gifted to `Traveler·fp` → …, each handoff signed by the giving identity.

- **Gift = custody transfer.** Gifting hands off the living Wisp; the canonical copy leaves you (you may keep a faint *echo*/memory). The receiver continues raising it — it **keeps growing** under the new traveler, layering into a palimpsest of everyone who held it (the §3.5 drift mechanic, extended).
- **Release** returns a Wisp to drift.
- **Backup / migration** exports the signed Wisp object (credential-unlocked, §9.5). Restoring under your *own* identity is not a fork.
- **Duplication cannot be prevented** on local data, but it is **legible**: a duplicate forks the lineage chain and is detectable as a copy. Authenticity is made visible rather than enforced; a continuously-raised Wisp is socially rare and valued. (Offline "double-spend" — using a backup while also having gifted it — is detectable via lineage, not preventable.)

This preserves the "earned, not bought" guardrail: power can change hands, but a real lineage cannot be faked.

---

## 4. Communication

All asynchronous-tolerant; see §11 for transport. **(v2)** All one-to-one private traffic is **end-to-end encrypted** to the recipient's identity key (§9.3). Messages composed offline queue in a local **outbox** and flush when a node connects.

- **Instant Messenger** — short direct text, near-real-time when the mesh allows, degrading gracefully to delayed delivery. Friend list, last-seen presence.
- **Mail** — store-and-forward, fragmented for longer bodies, may arrive later. The native, unhurried mode.
- **Presence** — "last seen" beacons and a short status, not live presence. **(v2)** Presence/profile/`WISP_SIG` are coalesced into a single throttled beacon (§11.2).
- **Group / Club messaging** — multi-recipient threads scoped to a club or board. **(v2)** Club messages are encrypted with a **shared club key** handed to each member encrypted to their identity key on join.

Profiles surface a status line and an equipped Wisp, AIM-style.

---

## 5. Communities

### 5.1 The Broadcast (public boards)
A BBS/forum system. Default boards: **General, Games, Music, Programming, Marketplace, Quests, Local**. Travelers can create additional community boards (e.g. Retro Gaming, D&D, Anime, Pinball). Posts and replies propagate over the shared Relay channel with eventual-consistency display, ordered by hybrid logical clock (§11.5). **(v2)** Boards are discovered organically by observing post traffic (§8).

### 5.2 Clubs (private Stations)
Smaller, private groups. Features: a private board, a member roster, a **club identity** (name, emblem, optional shared club Beacon), shared events, and club-level awards. Founders moderate. Clubs are created through Craft (§7). **(v2)** Clubs are **invite-only** (not browse-discoverable); an invite carries the shared club key. Club mutable state is **owner-authoritative + delegates** (§11.5).

### 5.3 Moderation **(v2 expanded)**
Because there is no central server, **global takedown is impossible** — moderation is local and owner-scoped:
- **Personal:** block / mute / hide any traveler or content on your own device.
- **Owner-scoped:** board/club founders (and delegated mods) sign moderation actions (mute, remove post, ban) that other clients honor for that space. This is the same owner-authority model used for mutable shared state (§11.5).
- **(v2) Opt-in shareable blocklists:** travelers may subscribe to community-curated blocklists that propagate over the mesh (`BLOCKLIST`, §11.3), giving collective defense without central authority.

---

## 6. Games & Competition

### 6.1 The Arcade
Home of simple, turn-based, mesh-friendly games. Launch set: **Chess**, **Tic-Tac-Toe**, with **Signal Match** (puzzle competition) and **Relay Racer** (asynchronous challenge) as additional titles. All resolve deterministically from shared seeds so two clients agree without a referee server. **(v2)** Single-player Carts/games are fully playable offline with no node.

### 6.2 Relay Arena (companion competition) — designed
Where Wisps test themselves. **Not** health-bar attrition and **not** warfare. A bout is two travelers showing each other who their companion has become.

- **Format:** an asynchronous best-of-N **bout** between two Wisps (later: small tournaments).
- **Trials:** each round is a *Trial* drawn from the five hearts — a Signal Trial, Arena Trial, Journey Trial, Broadcast Trial, or Craft Trial — each a tiny abstract contest.
- **Aptitude:** a Wisp performs strongly in Trials matching its dominant hearts and weakly in others. A Champion dominates Arena Trials; a Pathfinder excels at Journey Trials; a Weaver at Craft Trials. No Wisp is good at everything, so there is no single dominant build.
- **Tactics (so skill matters):** each round, both players secretly call a Trial from a limited hand and spend a small renewable resource (**Focus**) to press it. It is a light commitment/bluff game on top of the Wisp's aptitudes. Resolution is deterministic from both submissions plus a shared seed.
- **Stakes:** the winner gains a small Arena-heart boost and recognition; the loser still gains Arena heart from participating. No stat loss, no damage, no item-stripping. Growth either way.
- **(v2) Integrity:** each bout result is **countersigned by both players** (deterministic outcome + shared seed + two signatures). Competitive awards (e.g. "won 25 bouts") are backed by collectible signed results, not a self-reported tally.
- **Why it fits:** Trials are the five hearts turned into play, so a bout *expresses* identity rather than measuring raw power.

---

## 7. Creation (Craft)

Craft is the heart of the platform's creativity and the only heart that produces what the other four hearts consume.

### 7.1 Carts — user-scripted creations
The centerpiece of Craft is the **Cart** (working name; "cartridge"): a small, self-contained creation that a traveler authors in **Lua** and can send to other travelers over the mesh. A Cart can be a mini-game, a toy, a tool, an interactive object, a companion accessory with behavior, or the logic behind a quest.

- **Authoring:** an in-app Lua editor (usable with the on-screen or system keyboard, §13.4). The platform exposes a small, safe **Relay SDK** to Cart code: a fixed-size pixel canvas, an update/draw loop, input from the three buttons and keyboard, simple sound, a seeded RNG, limited read-only context (current Station, the involved Wisps' public signatures, **(v2)** and the active Wisp's full local state for accessory/companion Carts), and a tiny key/value store for the Cart's own saved state. Nothing else.
- **Size as aesthetic:** Carts travel over LoRa, so they have a strict size budget — **(v2) hard cap ~8 KB of Lua source, ~2 KB soft target**, enforced by the authoring tool before send/publish. This pushes a demoscene / PICO-8 spirit.
- **Sharing:** a Cart is its Lua source plus small metadata (name, author, type, version), fragmented and sent via the mesh (`CART` message, §11.3), or published to **The Archive** / traded at **The Exchange**. **(v2)** Direct gifts push point-to-point with resume; published Carts use **advertise-then-pull** (a small `MANIFEST` broadcast, then interested travelers pull fragments, §5/§11.2). The recipient's device verifies the content hash and runs it in a sandbox (§12.1). Nothing auto-executes.
- **Play and competition:** Cart games can be launched from the Arcade and played head-to-head through Relay Arena's async, deterministic match plumbing — a first-class citizen alongside built-in games. Single-player Carts run offline.

### 7.2 Other creation tools
- **Quest Creation** — build quests for others. Quest logic can be plain data or a Lua Cart. Grows others' Journey heart.
- **Guide / Story Creation** — articles, tutorials, stories, published to **The Archive** (advertise-then-pull).
- **Club Creation** — found and run communities (§5.2).
- **Event Creation** — schedule activities (tournaments, meetups, board events).
- **Companion Decorations** — cosmetic frames, badges, themes for Wisps and profiles.

Player-made content circulates via The Exchange and gifting (§10).

---

## 8. Exploration, Quests & Discovery (Journey)

- Travelers move between **Stations** (§2). Visiting new Stations, meeting new travelers, and completing quests fills the Journey heart.
- **Quests** are structured objectives, many player-made via Craft.
- **The Frontier** surfaces the unmapped edge of the Relay as the real mesh grows.

### 8.1 Discovery model **(v2 new)**
Organic / passive, since there is no global directory:
- **Travelers:** learned by hearing their coalesced presence/profile beacons in mesh range — this heard set *is* your Home Station roster.
- **Friends:** add from context (heard a beacon, saw a post, played a bout) by pinning their key + a petname; for out-of-range people, exchange a **Relay ID code / QR** out-of-band, then route store-and-forward.
- **Boards:** discovered by observing post traffic, alongside the always-present defaults.
- **Clubs:** invite-only (§5.2), not browse-discoverable.
- **Carts / content:** discovered via `MANIFEST` broadcasts (§7.1).

---

## 9. Progression & Identity

### 9.1 Traveler progression
Travelers progress alongside their Wisp through **awards, titles, and reputation**. Examples: 📬 Courier (sent 100 messages), 📋 Broadcaster (created 50 posts), 🎮 Challenger (won 25 bouts), 🗺 Pathfinder (completed 20 quests), 🏆 Founder (founded a club). Reaching a Beacon form grants a corresponding title. **(v2)** Competitive awards are backed by signed records (§6.2/§9.4); participation awards are trust-based.

### 9.2 Profiles
Fields: handle (+ fingerprint), status line, equipped Wisp (with its signature), awards/titles, favorite game, current Station, club memberships, activity highlights. **(v2)** Settings (node/transport, theme, keyboard mode, identity, backup) are reached from Profile. Heavily AIM-profile inspired.

### 9.3 Identity & trust **(v2 new)**
- **Identity = an app-level keypair derived from username + password** via Argon2id (slow, memory-hard; username as salt). The seed yields an **Ed25519 signing keypair** + a symmetric data key. Same username+password anywhere regenerates the same traveler; a different password is a different traveler. No central registry.
- **Two layers:** this Relay identity (signs profiles, `WISP_SIG`, moderation, Cart authorship, bout results, Wisp lineage) sits *above* Meshtastic's node-level transport encryption, which we treat as a non-relied-upon bonus.
- **Handles are display-only**, rendered `Handle·fingerprint` (e.g. `AJ·a3f9`); identity is the public key. Collisions are harmless.
- **Petnames:** each device keeps a private local alias map (e.g. tag a friend "Dad"); never public.
- **Trust = TOFU:** pin the key behind a handle on first sight; flag if a known handle's key ever changes (impersonation defense).
- **Signing from day one;** signature space reserved in the payload header.
- **No password reset / rotation:** the password *is* the key (see §9.5). Onboarding states this unmissably.

### 9.4 Integrity model **(v2 new)**
Trust-based but **legible**:
- Hearts and Wisp state are local and cosmetic; not server-verified. Fudging them is low-stakes by design (anti-grind, anti-purchase).
- **Competitive** surfaces are hardened: bout results are **countersigned** by both players; competitive awards are backed by collectible signed results.
- Wisp authenticity is protected by the signed **lineage chain** (§3.7), not by preventing copies.

### 9.5 Backup, migration & device loss **(v2 new)**
- **Identity** is portable for free: re-enter username+password on any device to regenerate the keypair.
- **Companion + local state** (hearts, menagerie, petnames, pinned keys, club keys, owned Carts) live only on-device and cannot be rebuilt from the mesh, so they are carried via an **encrypted export/import snapshot**, unlocked by your credentials. This is also the **web → handheld migration** path.
- Losing a device before exporting loses that local state (Tamagotchi-honest); identity itself always returns.

---

## 10. Economy

Deliberately soft, earned, and never pay-to-win. Companion strength is **never** purchasable.

- **Tokens** (working name; "Stamps" candidate) are earned through participation and spent on cosmetic decorations and profile customization. No real-money purchase, no power purchase.
- **Gifting & barter** — travelers gift player-made content, cosmetics, **(v2) and Wisps** (custody transfer, §3.7) directly over the mesh.
- **The Exchange** — a Station where player-made content and cosmetics are shared and traded, reputation-gated rather than money-gated.

---

## 11. The Mesh Layer (Meshtastic)

### 11.1 The hard constraint
**All user-to-user communication runs over Meshtastic (LoRa mesh).** No central server, no internet dependency for any message, post, bout move, quest, trade, or presence update. The app is offline-first and local-first. The internet may only be used for non-communication concerns and must be optional.

The mesh is **tiny** (~200 bytes usable per packet; treat 180 as the working budget), **slow** (seconds of airtime per packet, duty-cycle limited), **lossy and delayed** (store-and-forward), and **asynchronous** by default.

### 11.2 Integration approach
- **Connect directly to a local Meshtastic node** using **`@meshtastic/core`** (`MeshDevice`) plus a transport adapter. No dependency on the official phone app.
- **Transport options** (all wrap the same `MeshDevice`): `@meshtastic/transport-http` (recommended default, WiFi/ESP32 node over HTTP(S)); `@meshtastic/transport-web-bluetooth` (Chromium only); `@meshtastic/transport-web-serial` (Chromium only).
- **Browser reality:** BLE/Serial are Chromium-only and need HTTPS; HTTP-to-node is the baseline (self-signed cert trusted once). HTTP is default; BLE/Serial are progressive enhancements.
- Send/receive structured data as Meshtastic `Data` packets (`portnum` + binary `payload`).
- Use a **private PortNum in the 256–511 range** (`PRIVATE_APP` early). All Relay traffic shares one app portnum; sub-type is encoded in our own payload header.
- **(v2) Channel strategy:** all Relay traffic rides **one well-known default Relay channel** (known name + public key) that the app auto-configures on the node, so anyone running The Relay converges on the same public square within mesh reach. Boards/clubs are scoped in our payload header (board-id / club-id), **not** by Meshtastic channels (only 8 slots exist). The user's other channel slots stay free.
- **Addressing:** direct node ID for one-to-one; broadcast (`4294967295`) on the Relay channel for public boards and presence.
- **Compact binary only** (protobuf preferred, or tight TLV). Never JSON over the air.
- **(v2) Fragmentation & large transfers:** anything over one packet uses a `{ msgId, seq, total }` header with **selective-repeat + resume** (receiver NACKs only missing fragments). **Published** large content uses **advertise-then-pull**: broadcast a small `MANIFEST` (id, name, author, type, version, size, fragment count, content hash); interested travelers pull fragments. **Direct** transfers (gifts) push point-to-point.
- **(v2) Airtime governor:** a single prioritized TX queue + a token bucket sized to the node's region, **conservative with adaptive backpressure** — under congestion, background beacons slow and the UI surfaces the Relay as "busy/patient." Priority (high→low): interactive+reliable (IM, bout moves, trade handshakes, ACK/NACK, pull-requests) → mail → pull-serve → public posts/club messages → coalesced background beacons.
- **Reliability:** dedupe by packet ID; optimistic UI (queued/sending/delivered); ACKs where needed (DMs, mail, bout moves, trades, direct Cart/Wisp transfers); fire-and-forget for presence and posts; local store-and-forward queue / outbox for offline composition.

### 11.3 On-air message catalog **(v2 updated)**
All under one private portnum, distinguished by a 1-byte sub-type. **(v2)** Every payload carries a common header with a **protocol `version`** and reserved **signature** space (§9.3); receivers **skip unknown sub-types** and handle versions major/minor (same major → parse known fields, ignore extra; higher major → skip, optionally notify).

| Sub-type | Purpose | Addressing | Reliable? |
|---|---|---|---|
| `PRESENCE` | last-seen + short status (coalesced w/ profile + wisp sig) | broadcast | no |
| `PROFILE` | profile beacon (handle, status, wisp sig, award flags) | direct/req | no |
| `WISP_SIG` | companion signature (tier, path, hearts) | direct/broadcast | no |
| `IM` | short direct text (E2E encrypted) | direct | yes |
| `MAIL` | store-and-forward message (fragmented, E2E encrypted) | direct | yes |
| `POST` | board post/reply (signed) | Relay channel | no |
| `CLUB_MSG` | club thread message (shared-club-key encrypted) | Relay channel | yes |
| `GAME_INVITE` | start a game / bout | direct | yes |
| `GAME_MOVE` | one move/round submission | direct | yes |
| `GAME_RESULT` | agreed result (countersigned) | direct | yes |
| `QUEST_DEF` | publish a quest (fragmented) | board/broadcast | no |
| `QUEST_EVENT` | quest progress / completion | direct | yes |
| `CONTENT_PUB` | publish guide/story (advertise-then-pull) | broadcast/Exchange | no |
| `CART` | send/publish a Lua Cart: source + metadata | direct (push) / broadcast (manifest) | yes (direct) / no (broadcast) |
| `WISP_GIFT` | **(v2)** transfer a full Wisp object (lineage-signed) | direct | yes |
| `MANIFEST` | **(v2)** advertise a pullable large item | broadcast | no |
| `PULL_REQ` / `PULL_SERVE` | **(v2)** request / serve specific fragments | direct | yes |
| `BLOCKLIST` | **(v2)** shareable opt-in blocklist | direct/broadcast | no |
| `TRADE_OFFER` | offer / accept a trade | direct | yes |
| `GIFT` | send an item or content | direct | yes |
| `FRAG` / `ACK` / `NACK` | fragmentation + acknowledgement envelopes | — | — |

### 11.4 Transport facade & testing on real hardware **(v2)**
Wrap `@meshtastic/core` behind a thin `MeshTransport` facade the whole app depends on, so the radio link is swappable without touching app logic:
- **Today:** `MeshDevice` over HTTP (default) / Web Bluetooth / Web Serial.
- **Later:** a `HardwareTransport` for the T-Deck's own on-board SX1262 radio (§14).

**No simulated mesh, ever.** There is no fake/in-memory transport and no synthetic peers anywhere — in the product *or* in tests. Mesh behavior is validated on **real hardware (2+ physical Meshtastic nodes)**. "Offline" means a genuine local device (raise the Wisp, author/play single-player Carts, queue mail in the outbox) with no peers until a node connects — never a simulation. Deterministic logic (game/bout resolution, the hearts engine, fragmentation/reassembly, framing) is unit-tested in isolation, with no network involved.

### 11.5 Ordering & conflict resolution **(v2 new)**
- **Append-only signed content** (posts, replies, IM, mail, bout results): each carries `{author key, per-author sequence #, advisory timestamp, parent ref}` and orders by a **hybrid logical clock (HLC)** — causal order + human-readable time without trusting drifting device clocks. Threads render as trees by parent ref.
- **Mutable shared state** (club roster/identity, board settings, moderation): **owner-authoritative + delegates** — the owner's signed state is canonical; members propose changes the owner or delegated mods ratify (reuses the §5.3 model). If owner and all delegates are offline, that state waits.

---

## 12. Architecture & Stack

- **Web app (PWA), TypeScript.** A component framework (React pairs naturally with the Meshtastic SDK; Svelte is a fine lighter alternative). Installable and offline-capable via a service worker.
- **Mesh:** `@meshtastic/core` + `@meshtastic/protobufs` + a transport adapter.
- **Local-first persistence:** IndexedDB (e.g. Dexie) for messages, content, companion + menagerie state, identity material, pinned keys, petnames, outbox.
- **Crypto:** Argon2id (key derivation), Ed25519 (signing), X25519 + an AEAD (E2E encryption). Library choice TBD (e.g. libsodium / `@noble/*`).
- **Layering:** `MeshTransport` (wrapping `@meshtastic/core`) → `RelayProtocol` (framing, sub-type routing, version handling, fragmentation, selective-repeat, dedupe, ACK, airtime governor, store-and-forward/outbox) → domain stores → UI. Communication is fully encapsulated behind `MeshTransport`.
- **Identity & crypto module:** derivation, signing, verification, E2E, lineage signing/verification.
- **Hearts engine:** local activity → hearts → Wisp tier/path/drift, deterministic and inspectable.
- **Deterministic game engine:** shared-seed resolution for Arcade games and Relay Arena bouts.
- **Suggested structure:** a framework-agnostic core (`protocol`, `crypto`, `data`, `hearts`, `games`) with feature slices: `messaging`, `broadcast`, `clubs`, `arcade`, `arena`, `journey`, `craft`, `profile`, `companion`, `economy`, `settings`.
- Pull Meshtastic protobufs from `@meshtastic/protobufs`.

### 12.1 Scripting runtime (Lua) & sandbox
Carts (§7.1) run in an embedded Lua VM. Because Carts arrive from other travelers over the mesh, **every Cart is untrusted code** and must run fully sandboxed.

- **Runtime:** **wasmoon** (Lua 5.4 → WASM) primary, chosen because each environment is built by explicitly injecting globals (deny-by-default is natural). **Fengari** (Lua 5.3 in JS) is a lighter fallback. Run Carts in a **Web Worker**.
- **Deny by default:** start from an empty environment. No `os`, `io`, `package`/`require`, `dofile`, arbitrary `load`/`loadstring` of bytecode, or any JS bridge to network, DOM, storage, or the Meshtastic device.
- **Relay SDK (the entire allow-list):** fixed-size canvas draw calls, an update/draw loop, button + keyboard input, simple sound, a **seeded** RNG and a **logical clock** (never wall-clock or true randomness, so multiplayer Carts stay deterministic), read-only access to the current Station and the involved Wisps' public signatures, **(v2)** read-only access to the active Wisp's full local state for accessory/companion Carts, and a small sandboxed key/value store scoped to that Cart.
- **Resource limits:** instruction-count hook (`debug.sethook` count mode) to abort runaway scripts, a memory ceiling, a per-frame step budget. One fresh VM per running Cart, freed on exit.
- **Network is never direct:** a Cart can never transmit. Anything that leaves the device (a move, a score) is funneled through the platform's mesh layer under platform quotas and message types.
- **Provenance:** Carts carry a signed author identity and are content-addressed by hash; recipients see who made a Cart and whether it was altered. Nothing auto-executes.

---

## 13. UI / Aesthetic

> **(v2) Visual model — the virtual Tamagotchi.** The default skin is an **early-LCD / PDA-VMU device** rendered as a warm, toy-like **virtual Tamagotchi shell**, not an industrial gadget. Two rendering tiers on one face:
> - **Outer shell — the full T-Deck native resolution (320×240).** A lightly decorated "printed-shell" background with **single-color, higher-resolution function icons** arranged in **two rows — one directly above and one directly below** the central play window (top: radio = enter the Relay, mail, friends, profile; bottom: broadcast, die = Arcade, `_>` = Craft/Lua, compass = Quests). Settings (gear) is reached through Profile. No side icons. Clean, readable, decorative; not bound by the low-res rules.
> - **Inner play window — 128×80, 16-color, chunky pixels** (PICO-8 in spirit; ~4:5-ish working area). The living center: the companion, mini-games, and the Cart canvas. Everything interactive/animated happens here.
>
> Two art pipelines: hi-res single-color iconography for the shell, and a 16-color chunky pixel buffer for the play window. Overall register: warm, approachable, beloved-digital-companion — not rugged hardware.

### 13.1 The feeling
AOL Instant Messenger + Tamagotchi + Dreamcast VMU + 1990s BBS combined into a dedicated handheld sold at RadioShack in 2001, rebuilt today on mesh networking. A **community device + companion device + communicator**, never a social-media app. Runs as an installable PWA today, built so the same UI can later be served from the dedicated device.

Visual influences: Cybiko, Tamagotchi Connection, Dreamcast VMU, AIM, BBS software, Palm Pilot, Neo Geo Pocket, Game Boy Color menus, old PDA software, public-access-TV graphics.

### 13.2 Screen layout — three zones plus a button bar
```
┌──────────────────────────────────┐
│ RELAY   MAIL   FRIENDS   PROFILE  │   top row (icons)
├──────────────────────────────────┤
│        ┌──────────────────┐       │
│        │   128 × 80 play  │       │   center: the play window
│        │   window (Wisp)  │       │   (16-color chunky pixels)
│        └──────────────────┘       │
├──────────────────────────────────┤
│ BCAST   ARCADE   CRAFT   QUESTS   │   bottom row (icons)
└──────────────────────────────────┘
      [ SELECT ]  [ OK ]  [ BACK ]   (desktop: on-screen; T-Deck: trackball + keys)
```
Two icon rows only — one directly above and one directly below the central 128×80 play window (no side icons). Top row leans communication, bottom row leans activities; the center play window (with the companion) never disappears entirely. Icon set is adjustable; Settings (gear) is reached through Profile. The wider world (Commons, Exchange, Archive, Arena, Frontier) is reached through these or an in-app travel menu. **(v2)** Settings and the Wisp collection/menagerie are reached from Profile / the companion.

### 13.3 The companion presence
Always visible, rendered as a **character, not an icon**. It animates: wanders, looks around, reacts to events. A small label shows its name and current mood/form:
```
        /\
       (o  o)
        \__/
   Mochi  ·  Curious
```

### 13.4 Input — three buttons and a dual keyboard
**Three on-screen buttons under the main window: SELECT, OK, BACK** — a focus-and-confirm model. SELECT moves the highlight, OK activates, BACK pops. No hamburger menus, FABs, or swipe-heavy gestures. Bound to keyboard keys, designed to map onto the future device's physical buttons.

**Text entry — dual-keyboard model:**
- A **built-in on-screen keyboard, hard-coded into the page**: period-appropriate, navigable by the three buttons, pointer, or touch. The canonical, hardware-faithful path.
- An **optional system-keyboard mode** (toggleable in settings) for speed/comfort.
- **(v2)** During text entry the on-screen keyboard **replaces the bottom icon row** (the top row + active-icon state stay visible); BACK dismisses it and restores navigation. On the T-Deck the physical QWERTY is the fast path and the on-screen keyboard is the fallback.

### 13.5 Per-surface treatments
**(v2) Shared surface grammar** (persistent-frame model): the two icon rows stay fixed as permanent navigation; selecting an icon swaps only the **center region**. The **active icon highlights** (coral) so location is always clear. The screen bezel carries over for continuity. The center shows the dark 16-color game scene on the home/companion view and a **pale-LCD panel** for text surfaces. A **footer line** always shows the current button verbs in context (e.g. "OK message · SELECT next · BACK home"). BACK returns toward the companion/home.

- **Mail** looks like a mailbox: sender + subject list with unread count.
- **Instant Messenger** is pure AIM: buddy list with online dots; Send / View Profile / Challenge / Add Friend.
- **Profile** has AIM-profile energy: handle, companion sprite, status line, current game, awards.
- **Craft / Lua editor** (v2): syntax-colored code panel with line numbers and a live **size-budget meter** (the ~8 KB cap made visible); `▶ run` launches the Cart into the 128×80 play canvas; on-screen keyboard takes the bottom region while editing.
- **The Broadcast** feels like entering a building: a list of boards, then numbered threads.
- **The Arcade** feels like an arcade: each game a small pixel-art cabinet.
- **(v2) The Menagerie**: a collection view of held Wisps with their lineage, swap-active control.
- **(v2) Onboarding** (outside the nav shell): focused full-panel steps with step badges and contextual next/back buttons. Step 1 identity (handle + password + strength meter + a prominent "your password is your key, no reset" warning); step 2 connect (HTTP default, BLE/USB pairing, "skip — explore offline"); step 3 hatch — the **Flicker rendered colorless/dim/uncertain** (per §3.3, visually distinct from any evolved Wisp) and name it.

### 13.6 Companion stats as hearts
```
SIGNAL      ♥♥♥♥♡
ARENA       ♥♥♥♡♡
JOURNEY     ♥♥♥♥♥
BROADCAST   ♥♥♥♡♡
CRAFT       ♥♥♡♡♡
```

### 13.7 Notifications — the world changes
The device itself changes: the mail icon blinks, the arcade icon glows, the companion reacts ("Mochi looks excited. You have new mail."). Ambient, not a banner stack. **(v2)** Airtime backpressure shows here too (the Relay looking "busy/patient").

### 13.8 Color & themes
**(v2)** Default theme is **warm and toy-like**: a soft cream/ivory shell with coral + teal accents, **unified deep-teal single-color icons** (section identity comes from position + label, not icon color), and a 16-color play window (PICO-8-inspired palette). Reads as a beloved companion device, not industrial hardware. Optional later **shell colorways** (Tamagotchi-style): Mint/Seafoam, Coral/Sunset, Translucent "see-through" (Cybiko-era), plus screen-register alt themes (Monochrome Green, Amber CRT, Game Boy, Dreamcast VMU).

---

## 14. Hardware Vision (end target)

**(v2) Primary hardware target: LilyGo T-Deck (or T-Deck-class device).** Concrete spec the UI is designed against:
- **320×240 landscape (4:3) IPS display** — the canonical canvas. The whole display is dressed as the virtual-Tamagotchi shell (§13), with the 128×80 play window inset in the center.
- **Physical BlackBerry-style QWERTY keyboard** (the fast text path; on-screen keyboard becomes fallback).
- **Trackball + buttons** → drives SELECT/focus (trackball) and OK/BACK.
- **Integrated SX1262 LoRa + ESP32-S3** — the device *is* the radio, so there is no separate node; the app and the mesh live on one device (the eventual `HardwareTransport`).

**Responsive targets (same canonical 320×240 canvas, three skins):**
| Target | Screen | Navigation | Text entry |
|---|---|---|---|
| Desktop (today) | 320×240 scaled up crisply + 3 on-screen buttons | arrow/Tab/Enter/Esc → SELECT/OK/BACK | on-screen keyboard (canonical) or system-keyboard toggle |
| Mobile (today) | 320×240 pinned top | tap | on-screen keyboard fills the lower half (mirrors the T-Deck stack) |
| T-Deck (later) | fills the display | trackball + buttons | physical QWERTY; on-screen keyboard fallback |

The web app is the prototype and software foundation; the device can serve the UI directly from flash or run it as a kiosk. The `MeshTransport` seam makes the device a port, not a rewrite. **(v2)** Web → device migration is the encrypted export/import path (§9.5).

---

## 15. Implementation Roadmap (path to the end state)

1. **Transport + spine:** the `MeshTransport` facade over `@meshtastic/core` (HTTP adapter first; `HardwareTransport` later for the T-Deck radio), the `RelayProtocol` framing/version/fragmentation/selective-repeat/dedupe/ACK + **airtime governor** + outbox, and the companion data model. Brought up and tested against 2 real nodes.
2. **Identity & crypto:** Argon2id derivation, Ed25519 signing, X25519 E2E, TOFU pinning, petnames — and onboarding (§9.3/§9.5).
3. **Core social:** profiles, presence, IM, Mail, friend list, discovery (§8.1).
4. **Communities:** The Broadcast (boards), user-created boards, moderation + shareable blocklists.
5. **Companion life:** hearts engine, the 1→2→4→8 evolution tree, drift, **lineage + gifting + menagerie**, backup/migration.
6. **Play:** The Arcade (deterministic games), then Relay Arena (Trials/Focus, countersigned results).
7. **World:** Stations, travel, Journey, quests.
8. **Making:** the Lua runtime and sandbox (§12.1), Cart authoring/sharing (push + advertise-then-pull), then the rest of Craft and Clubs as private Stations.
9. **Economy:** Tokens, gifting/barter, The Exchange.
10. **Hardware bring-up:** `HardwareTransport` and the dedicated device.

---

## 16. Non-goals & Guardrails

- No central server or cloud backend for user-to-user communication. (Optional E2E-encrypted internet backup is the only sanctioned non-comms internet use, and it remains optional.)
- No real-time-heavy mechanics; everything tolerates latency and loss.
- Companions are not collectible-monster bait, are not the user's identity, never fight to the death, and their strength is never purchasable. **(v2)** Wisps can change hands, but a real lineage cannot be faked.
- This is a communication platform built around creativity, not a chat app and not a feed.
- All user Carts are untrusted code: deny by default, sandbox hard, no direct device/network access (§12.1).
- Keep every on-air payload tiny; reject any design that needs large or frequent transmissions.
- **(v2)** No simulated or synthetic mesh anywhere (product *or* tests). Offline is a real local mode; mesh behavior is tested on real hardware (2+ nodes).
- Where a requirement is ambiguous, state an assumption and proceed.

---

## 17. Resolved Decisions (design-review log)

Traceability for the decisions folded into v2.

1. **Identity root** — App-level keypair derived from username+password (Argon2id), independent of the Meshtastic node key. → §9.3
2. **Handles** — Display-only + fingerprint; petnames for local aliases; TOFU trust. → §9.3
3. **Encryption** — App-level E2E for private traffic; shared club key per club; Meshtastic encryption as bonus layer. → §4, §5.2, §9.3
4. **Password rotation** — Pure derivation, no rotation/reset; hardened with Argon2id + strength check. → §9.5
5. **Channel** — One well-known default Relay channel; board/club scoping in payload, not channels. → §11.2
6. **Large transfers** — Selective-repeat + resume; direct push vs published advertise-then-pull; Cart cap ~8 KB / ~2 KB. → §7.1, §11.2
7. **Airtime governor** — Single prioritized queue; conservative + adaptive backpressure; region from node. → §11.2
8. **Discovery** — Organic/passive + explicit add (QR/short-code); clubs invite-only. → §8.1
9. **Wisp-as-object** — First-class signed objects with lineage; gift = custody transfer; copies legible; transferred Wisps keep growing (palimpsest); one active + held collection. → §3.1, §3.6, §3.7
10. **Integrity** — Trust-based but legible; competitive bouts countersigned. → §9.4, §6.2
11. **Ordering** — HLC for append-only content; owner-authoritative + delegates for mutable shared state. → §11.5
12. **Onboarding** — Identity-first, node-optional, offline-first local device; no simulated/synthetic mesh anywhere (test on real hardware). → §1, §9.5, §11.4
13. **Protocol version** — Version + skip rules from day one. → §11.3
14. **Moderation** — Personal + owner-scoped + opt-in shareable blocklists. → §5.3
15. **Backup/migration** — Identity re-derived; companion/local state via encrypted export/import; = web→device path. → §9.5
16. **Settings / region / testing** — Settings off Profile; region read from node; **no simulated mesh** — tested on real hardware (2+ nodes); deterministic logic unit-tested. → §9.2, §11.2, §11.4
17. **Visual register** — Early-LCD / virtual-Tamagotchi shell; two-tier rendering (hi-res single-color icon shell + 128×80 16-color chunky play window); warm, toy-like. → §13
18. **Hardware target** — LilyGo T-Deck-class: 320×240 landscape canonical canvas, physical QWERTY, trackball, on-board SX1262 LoRa (device is its own node). → §14
19. **Responsive framing** — Same 320×240 canvas, three skins: desktop (screen + 3 buttons), mobile (screen + on-screen keyboard lower half), T-Deck (full display + QWERTY/trackball). → §13, §14
