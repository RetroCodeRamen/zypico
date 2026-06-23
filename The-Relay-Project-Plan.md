# The Relay — Project Plan

> **Companion document to [The-Relay-Outline-v2.md](The-Relay-Outline-v2.md).** The outline is the *product specification* (what The Relay is). This plan is the *build plan* (how we make it): scope, stack, workstreams, phased delivery with exit criteria, testing, risks, and the path to hardware. Where the two ever disagree, the outline wins on *what*, this plan wins on *how/when*.

_Status: draft v1 · Last updated 2026-06-20_

**Related docs:** [docs/DESIGN.md](docs/DESIGN.md) (**canonical design direction, v3** — read first) · [The-Relay-Outline-v2.md](The-Relay-Outline-v2.md) (background mechanics; superseded by DESIGN for direction) · [The-Relay-Screens.html](The-Relay-Screens.html) (visual reference) · [docs/protocol.md](docs/protocol.md) (RelayProtocol wire spec) · [docs/adr/](docs/adr/) (decision records).

**Build progress (last updated 2026-06-22 · 89 unit tests passing):**

**Deployment shape (settled — ADR 0004).** ZyPico runs on the **device itself**: a
**Heltec WiFi LoRa 32 V3** flashed with custom firmware (`firmware/heltec-v3/`)
runs as a **WiFi access point**, serves the bundled web UI from flash, and bridges
a **WebSocket ↔ SX1262 LoRa** (RadioLib). The browser (phone) runs the whole UI +
RelayProtocol; `BoardTransport` (WebSocket) is the only live `MeshTransport`.
**Fully offline** (board AP, no `INTERNET` permission/equivalent), one device per
board, unique AP name per board, OLED shows status. **Validated on two real
boards:** bidirectional LoRa at 915 MHz proven end-to-end. Ports to T-Deck (same
ESP32-S3 + SX1262). _Earlier abandoned routes (Android app via Meshtastic AIDL/SDK,
Web Bluetooth, HTTP-to-node) were removed in the cleanup — see git history / ADR
0003 (superseded)._

**Done:**
- **Phase 0 — setup.** Vite + React + TS strict, Vitest, ADR 0001 (React), 0002 (crypto).
- **Phase 1 — protocol spine.** RelayProtocol header + sub-type catalog; **HLC ordering, dedupe, fragmentation + selective-repeat reassembly, exact-formula airtime estimator + airtime governor** — all unit-tested. `RelayClient` does dedupe/reassembly inbound, fragmentation/governor pacing outbound, and exposes typed `send` + raw `onInbound`. Wire spec: [docs/protocol.md](docs/protocol.md).
- **Phase 2 — identity & crypto.** **Login gate before anything** (handle + password → Ed25519 keypair via Argon2id; offline, no reset; per-identity local state). Signed **presence beacons**, and **end-to-end DMs** (X25519 + XChaCha20-Poly1305). `@noble/*`.
- **UI shell (§7) — Tamagotchi.** One LCD plate: hi-res vector place-icons framing the **128×80 16-color dot matrix** (all menus render inside it, 3×5 font). **Three buttons** (SELECT/ACCEPT/CANCEL; arrows ←/↓/→), idle home with no icon selected, PICO-8 palette, early-2000s colorway, uniform scale-to-fit, **on-screen QWERTY** below the buttons (see [[keyboard-placement]]), chiptune SFX.
- **Companion (§3, Phase 5).** Hearts engine (five Hearts; Flicker→Ember→Glow→Beacon; full 1→2→4→8 tree + drift). Wisp persists **per-identity** (localStorage), renders procedurally + animated on HOME, **MY WISP** detail under PROFILE. Hearts grown via a **dev-only** raise action until real activity hooks land.
- **Social (§4/§8, Phase 3).** **FRIENDS** = discovery (nearby from presence) → add buddy (TOFU key pin) → **encrypted DM threads**. MAIL folded in.

**Next (see discussion):** Relay **chatrooms** (main public room + others) with **join-time history backfill** (last ~10 msgs / 15 min, advertise-then-pull); **persistence** (DM/room history, Dexie); real **activity→heart** hooks; companion lineage/gift.

**Design status:** the spec is build-ready. Identity/crypto, transport/mesh, companion model, sandbox, and the visual system are all decided. Four screens are designed and the surface grammar is proven. Remaining unknowns are best resolved during implementation, not further outlining.

---

## 1. One-paragraph vision

The Relay is **Cybiko meets Tamagotchi on modern LoRa**: a retro-styled wireless social handheld where you message friends, hang out in communities, play and *write* small games, explore, and raise a **Wisp** — a companion that becomes a portrait of how you spend your time on the mesh. All user-to-user communication runs over a Meshtastic LoRa mesh; no central server. First target is an installable web app (PWA) talking to a local Meshtastic node; end target is a T-Deck-class handheld that *is* its own radio.

---

## 2. Goals & success criteria

**Primary goals**
1. A working PWA that connects to a real Meshtastic node and lets two travelers message, post, and play over LoRa.
2. A companion (Wisp) system whose growth is driven by participation, fully local, with the lineage/gift model.
3. A safe, embedded Lua "Cart" runtime so travelers can author and share programs over the mesh.
4. An architecture that ports to a T-Deck-class device by swapping the transport, not rewriting the app.

**Success criteria (definition of "it works")**
- Two physical nodes exchange IM, mail, board posts, and a complete game/bout end-to-end over LoRa, surviving loss and delay.
- All on-air payloads respect the byte budget (≤180B working) and the airtime governor keeps the app a good mesh citizen.
- A Cart authored on one device runs sandboxed on another with verified provenance and zero host access.
- A Wisp can be raised, gifted (custody transfer), backed up, and restored, with lineage intact.
- The same UI runs in desktop, mobile, and (later) on T-Deck against the canonical 320×240 canvas.

**Explicit non-goals** (see outline §16) — no central server for comms; no real-time-heavy mechanics; no purchasable companion power; **no simulated/synthetic mesh anywhere**; no large/frequent transmissions.

---

## 3. Scope

**Foundation (must reach a usable, dog-foodable state):** transport spine + protocol, identity/crypto, core social (IM/mail/presence/profiles/friends), boards, the hearts/companion engine, and the Arcade with at least one deterministic head-to-head game.

**Full product (the outline in full):** Relay Arena, Stations/travel/quests, the Lua runtime + full Craft toolset, clubs, economy/Exchange, and hardware bring-up.

**Out of scope for now:** native mobile apps (PWA only), any cloud backend for communication, optional internet backup (deferred convenience), deep evolution-tree expansion beyond the 1→2→4→8 tree.

---

## 4. Technology stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript | strict mode |
| App shell | PWA + service worker | installable, offline-capable |
| UI framework | React (default) or Svelte | React pairs with Meshtastic SDK; decide at Phase 0 |
| Mesh | `@meshtastic/core`, `@meshtastic/protobufs` | + transport adapters |
| Transport (today) | `@meshtastic/transport-http` (default), `-web-bluetooth`, `-web-serial` | HTTP is the baseline |
| Transport (later) | `HardwareTransport` (T-Deck SX1262) | device is its own node |
| Persistence | IndexedDB via Dexie | messages, content, companion + menagerie, identity material, outbox |
| Crypto | Argon2id (KDF) + Ed25519 (sign) + X25519/AEAD (E2E) | libsodium-wrappers or `@noble/*` — decide at Phase 0 |
| Lua runtime | wasmoon (Lua 5.4 → WASM), Fengari fallback | runs in a Web Worker |
| Wire format | protobuf or tight TLV | never JSON over the air |
| Pixel rendering | canvas/SVG, 128×80 16-color buffer | nearest-neighbor upscale |
| Testing | Vitest (unit), Playwright (PWA/UI), 2 real nodes (mesh) | **no mesh simulation** |

---

## 5. Architecture (build view)

Strict one-directional layering; every layer is independently testable.

```
UI (device shell + 128×80 play window + surfaces)
  ↓
Domain stores (messaging, broadcast, clubs, arcade, arena, journey, craft, profile, companion, economy, settings)
  ↓
Core engines (hearts, deterministic game/bout, lineage)
  ↓
RelayProtocol (framing, version, sub-type routing, fragmentation + selective-repeat,
               dedupe, ACK/NACK, airtime governor, store-and-forward / outbox, HLC ordering)
  ↓
Crypto module (KDF, sign/verify, E2E, lineage sign/verify)
  ↓
MeshTransport facade  →  { HttpTransport | BleTransport | SerialTransport | HardwareTransport }
```

- **Framework-agnostic core** (`protocol`, `crypto`, `data`, `hearts`, `games`) with no UI or DOM deps — this is what ports to hardware unchanged.
- Communication is *fully* encapsulated behind `MeshTransport`; nothing above it knows the radio type.
- Determinism is a first-class property of the game/bout and hearts engines (shared-seed, inspectable).

---

## 6. Suggested repository structure

```
/packages
  /core            # framework-agnostic: protocol, crypto, data, hearts, games, lineage
  /transport       # MeshTransport facade + adapters (http/ble/serial; hardware later)
  /lua-runtime     # wasmoon worker + Relay SDK + sandbox
  /ui              # React/Svelte device shell, surfaces, 128x80 renderer
  /app             # PWA wiring, service worker, IndexedDB (Dexie) stores
/tools             # build, asset pipeline (icons + pixel sprites), protobuf gen
/docs              # outline v2, this plan, protocol spec, ADRs
```

---

## 7. Workstreams (parallelizable tracks)

1. **Mesh & protocol** — transport facade, framing, fragmentation, governor, reliability.
2. **Identity & security** — KDF/sign/E2E, TOFU, lineage, the Lua sandbox.
3. **Companion** — hearts engine, evolution tree, drift, lineage/gift/menagerie.
4. **Social & communities** — IM, mail, presence, profiles, friends, boards, clubs, moderation.
5. **Play** — deterministic game engine, Arcade titles, Relay Arena.
6. **World & creation** — Stations, travel, quests, Craft tools, Cart authoring/sharing.
7. **UI/UX & art** — device shell, 128×80 renderer, surface designs, icon + sprite pipelines.
8. **Economy** — tokens, gifting/barter, Exchange.
9. **Hardware** — T-Deck bring-up, `HardwareTransport`, on-device serving.

---

## 8. Roadmap

Milestones now follow the v3 direction ([docs/DESIGN.md](docs/DESIGN.md)). Each
ends in a demoable, on-hardware state. **Deployment is mesh-first**: ZyPico runs
on the board (Traveler firmware), browser does UI + protocol; Stations come later.

### Shipped
- **Setup + protocol spine** — Vite/React/TS, Vitest; RelayProtocol (frame, HLC, dedupe, fragmentation, airtime governor); `RelayClient`. **Validated on two real Heltec V3 boards: bidirectional LoRa at 915 MHz.**
- **Board firmware (ADR 0004)** — WiFi-AP, serves UI from flash, WebSocket↔SX1262, OLED, one-device, unique per-board SSID.
- **Identity (Phase 2)** — login gate (Argon2id→Ed25519, offline, no reset); signed **presence**; **E2E DMs** (X25519 + XChaCha20).
- **UI shell** — 128×80 Tamagotchi LCD, 3 buttons, on-screen keyboard, scale-to-fit, SFX.
- **Companion engine** — five Hearts, full evolution tree + drift; per-identity persistence; procedural animated Wisp.
- **Social** — discovery → buddies → encrypted DMs; basic **Commons** public chat (HLC-ordered, app-deduped).

### Forward (v3)

**M1 — Structural foundation.** Extract a **domain layer** out of `App.tsx`
(`useIdentity`/`useRelay`/`useSocial`/`useCompanion` or stores); drop the dead
`@meshtastic/*` deps + shims; introduce a **persistence layer** (IndexedDB/Dexie)
so DMs/rooms/Wisp survive reload. _Exit: App is thin composition; nothing lost on reload._

**M2 — Worldify the shell.** Remove **Radio** (connectivity → ambient status);
restructure nav to the eight **Places** (Commons, Travelers, Post, Pages, Wisp,
Arcade, Exchange, Profile); **activity stars**; people-first presence language
("Traveler Nearby"). _Exit: nav matches DESIGN §6; no node tech in the UI._

**M3 — The Wisp comes alive.** Wisp interaction area (Feed/Treat/Play/Clean/Rest/
Talk) on the new **Bond/Mood** axis; wire **real Hearts hooks** (participation →
hearts), retire the dev raise. _Exit: care moves mood; activity grows hearts; both visible._

**M4 — The Commons.** Presence v2 (60 s / 5 min; Wisp form + location); activity
feed; discovery; reachability model. _Exit: entering the Commons shows live signs of life._

**M5 — Traveler Pages + Guestbooks.** Author/edit a small page (About/Pixel Art/
Notes/Achievements) locally; Guestbook; view others'. _Exit: build a page, sign another's guestbook over the mesh._

**M6 — Chat vs Mail split.** Chat reachability-gated (history persists);
**Mail store-and-forward** with outbox (delivers via a Station). _Exit: chat goes quiet when a peer leaves; mail waits + delivers through a Station._

**M7 — Stations.** **Station Mode** (repeating with hop-limit; Mail relay; Page
hosting; **Account Vault** backups; admin login). Light Station on Heltec.
_Exit: a Station repeats range, forwards mail, hosts a page, stores an encrypted vault._

**M8 — Making + the Exchange.** Lua **Cart** runtime + sandbox; authoring;
**Exchange** (items/themes/Carts/content); participation economy. _Exit: author a Cart, share + run it sandboxed; buy a cosmetic._

**M9 — Play.** Deterministic Arcade games head-to-head over LoRa; Arena bouts
(the Hearts as play). _Exit: a full game resolves identically on two boards, no referee._

**M10 — Breadth.** T-Deck (on-device screen); **full Station** (Pi-class storage +
internet **federation**: Page sync, vault backup, mail bridging between
neighborhoods). _Exit: two neighborhoods bridged by internet Stations; same app on a T-Deck._

**Cross-cutting (early):** a frame **hop-limit/TTL** field for repeating; the
**location namespace** for presence + travel; persistence (M1) underpins M4–M7.

---

## 9. Testing & QA strategy

**No simulated mesh — ever.** Validation tiers:
1. **Unit (Vitest):** deterministic logic in isolation — game/bout resolution, hearts engine, evolution/drift, fragmentation/reassembly, framing, HLC ordering, crypto round-trips, lineage verification. Fast, no network.
2. **Sandbox security suite:** adversarial Carts attempting host/network/storage/device access, infinite loops, memory bombs — all must be denied/aborted. Treated as a release gate.
3. **Real-hardware mesh tests:** the 2 physical nodes exercise IM/mail/posts/games/bouts/Cart transfer under real loss, delay, and range. Manual + scripted checklists per phase.
4. **PWA/UI (Playwright):** install, offline mode, onboarding, three-button navigation, on-screen keyboard, surface flows.

**Performance/airtime budgets are test assertions:** payloads ≤180B working; governor stays within conservative duty-cycle limits; Cart hard cap ~8KB enforced before publish.

---

## 10. Hardware path (web → T-Deck)

- Design every layout against the canonical **320×240** canvas from day one; desktop scales up + 3 on-screen buttons; mobile pins screen + on-screen keyboard below (mirrors T-Deck stack).
- Keep the framework-agnostic core free of DOM/browser assumptions.
- Hardware is a *port*: implement `HardwareTransport`, map trackball→SELECT and physical QWERTY→text, serve the UI from device flash. No app-logic rewrite.

---

## 11. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LoRa airtime/duty-cycle makes rich features feel too slow | High | Airtime governor + advertise-then-pull + "patience as aesthetic"; reject large/frequent payloads by design |
| Lua sandbox escape (untrusted code from strangers) | High | Deny-by-default wasmoon in a Worker; security suite as a release gate; no direct device/network access |
| Pure-derivation identity: weak passwords → impersonation | Med | Argon2id (slow, memory-hard) + signup strength check; clear "no reset" messaging |
| 320×240 too cramped for boards / Lua editor | Med | Terse, paginated surfaces; lean into BBS density; design to the canvas early |
| Offline double-spend of gifted Wisps | Low | Detectable (not preventable) via signed lineage; accepted as trust-based-but-legible |
| Browser transport limits (BLE/Serial Chromium-only) | Med | HTTP-to-node is the supported baseline; BLE/Serial are progressive enhancements |
| Framework/crypto-lib churn | Low | Lock choices in Phase 0 ADRs; isolate behind modules |

---

## 12. Cross-cutting standards

- **Security first** for anything from the mesh: verify signatures, verify content hashes, never auto-execute Carts, sandbox hard.
- **Determinism** for all multiplayer/companion logic (shared seed, logical clock, no wall-clock/true-RNG in Cart SDK).
- **Byte discipline:** binary only, enums/varints/IDs over strings; every new message type gets a budget review.
- **Accessibility:** three-button + on-screen keyboard must be operable; system-keyboard toggle for comfort.
- **ADRs** in `/docs` for every significant decision (the outline §17 log is the design-decision baseline).

---

## 13. Open items

**Decide at the moment of starting code (Phase 0 — quick calls, not research):**
- React vs Svelte; crypto library (libsodium-wrappers vs `@noble`).

**Write as the first task of Phase 1 (not upfront):**
- Wire-protocol exact byte layout (common header + the §11.3 sub-type catalog) — design it against a real packet to a real node, not in a vacuum.

**Defer to during-build (balance/detail, meaningless on paper):**
- Exact 16-color play-window palette (PICO-8-inspired baseline).
- Token name ("Stamps"?) and earning/spend curves.
- Hearts→evolution thresholds and drift cost tuning.
- Remaining per-surface designs (Broadcast, Mail, Profile, Arcade, Menagerie, companion/hearts detail) — mock just-in-time per phase; the surface grammar is already proven.

**Locked (for reference):**
- Visual register, colorway, layout — see Design status above and outline §13.
- Surface grammar: persistent two-row icon frame, active-icon highlight, center swaps (game scene vs pale-LCD panel), contextual footer verbs (outline §13.5).
- Text entry: on-screen keyboard replaces the bottom icon row while editing (outline §13.4).
- Companion strength colorway/icons (outline §17 #17).

---

## 14. Immediate next steps

1. Lock the two Phase 0 calls (framework + crypto lib) as ADRs — recommendation: React + libsodium-wrappers.
2. Scaffold the repo per §6 (Phase 0).
3. Stand up the `MeshTransport` facade + HTTP adapter and get one real message between the 2 nodes (start of Phase 1), writing the wire-protocol spec alongside it.
4. From there, follow the phase plan (§8); mock remaining surfaces just-in-time as each phase needs them.
