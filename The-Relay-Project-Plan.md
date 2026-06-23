# The Relay — Project Plan

> **Companion document to [The-Relay-Outline-v2.md](The-Relay-Outline-v2.md).** The outline is the *product specification* (what The Relay is). This plan is the *build plan* (how we make it): scope, stack, workstreams, phased delivery with exit criteria, testing, risks, and the path to hardware. Where the two ever disagree, the outline wins on *what*, this plan wins on *how/when*.

_Status: draft v1 · Last updated 2026-06-20_

**Related docs:** [The-Relay-Outline-v2.md](The-Relay-Outline-v2.md) (product spec) · [The-Relay-Screens.html](The-Relay-Screens.html) (visual reference — Home, Instant Messenger, Lua editor, Onboarding) · [docs/protocol.md](docs/protocol.md) (RelayProtocol wire spec) · [docs/adr/](docs/adr/) (decision records).

**Build progress (2026-06-20):**
- **Phase 0 — done.** Repo scaffolded (Vite + React + TS strict), PWA + service worker, Vitest. ADR 0001 (React), ADR 0002 (crypto deferred to Phase 2). Production build green.
- **Phase 1 — in progress.** Done: `MeshTransport` facade + `HttpTransport`; RelayProtocol common header + sub-type catalog (version skipping, unknown-subtype tolerance); **HLC ordering, dedupe, fragmentation + selective-repeat reassembly, exact-formula airtime estimator, and the airtime governor** (prioritized queue + region-aware token bucket + adaptive backpressure) — all unit-tested. `RelayClient` wires dedupe + reassembly inbound and fragmentation + governor pacing outbound. Wire spec written ([docs/protocol.md](docs/protocol.md)). **Remaining:** ACK/NACK + selective-repeat retransmit, store-and-forward outbox, companion data model + IndexedDB, then the 2-node real-hardware round-trip that closes the phase.
- **UI shell (workstream §7) — Tamagotchi rebuild.** The interface is a 4× Tamagotchi: a single LCD plate with hi-res vector place-icons (4 above + 4 below) framing the **128×80, 16-color dot matrix**; **all content/menus render inside the matrix** (3×5 bitmap font). Driven by **three buttons** — SELECT (move highlight), ACCEPT (enter/confirm), CANCEL (deselect → idle home). Home idles with **no icon highlighted** until SELECT (Tamagotchi-true). PICO-8 play-window palette, early-2000s candy colorway, **uniform scale-to-fit** (preserves aspect ratio on phone + desktop). **On-screen QWERTY keyboard** below the buttons (page chrome, not on the LCD — see [[keyboard-placement]] memory) with an in-LCD text-entry mode; arrow keys map ←/↓/→ = SELECT/ACCEPT/CANCEL. RADIO connect is wired to the real transport.
- **Transport / deployment (ADR 0004, supersedes 0003) — board IS the device.** After dead ends (Meshtastic Android removed its third-party API; Web Bluetooth fails on Android bonding), settled on the project's hardware end-goal early: a **Heltec WiFi LoRa 32 V3** runs custom firmware (`firmware/heltec-v3/`) as a **WiFi access point** that serves the bundled ZyPico UI from flash and bridges a **WebSocket ↔ SX1262 LoRa** (RadioLib). The browser runs the whole UI + RelayProtocol; `BoardTransport` (WebSocket) implements the `MeshTransport` facade — web app otherwise unchanged. **Fully offline** (board AP, no internet, no `INTERNET`-equivalent). ZyPico-only LoRa net (not Meshtastic-compatible). Ports to T-Deck (same ESP32-S3 + SX1262). Toolchain (JDK/Android SDK/Gradle, PlatformIO) installed under `~/.local/zypico-android/`. Shelved alternatives still in-tree behind the facade: `HttpTransport`, `BleTransport`, `MeshServiceTransport` (ADR 0003 native shell).
- **Messaging (workstream §4, Phase 3) — started.** MAIL is a live message screen: ACCEPT opens the keyboard to compose, messages **broadcast over LoRa** as plaintext IM frames (E2E is Phase 2), and sent/received traffic shows in an in-LCD log. Sending grants the **Signal heart** — the first real activity→heart hook (retires the dev raise for Signal). Chiptune SFX on connect/error/send. **Next:** addressed/E2E DMs (needs identity), store-and-forward outbox for offline compose, and IM vs Mail split.
- **Companion (workstream §3, Phase 5) — started.** Framework-agnostic **hearts engine**: five Hearts (Signal/Arena/Journey/Broadcast/Craft), four tiers (Flicker→Ember→Glow→Beacon), the full **1→2→4→8 evolution tree** with natural drift (form derived from hearts; tier monotonic). Unit-tested. Wisp **persists locally** (localStorage; Dexie later), renders procedurally on HOME (animated, tinted by form), and has a **MY WISP** detail screen (creature, form, age, five heart meters) reachable via PROFILE. Hearts grow via a labeled bootstrap "raise" action until real activity hooks (messaging→Signal, games→Arena, etc.) land. Tests: 77 total.

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

## 8. Phased delivery plan

Phases sequence the outline's roadmap (§15) with concrete deliverables and exit criteria. Sizing is rough (S/M/L); calendar dates TBD once team/cadence is set. Each phase ends in a demoable state.

### Phase 0 — Project setup (S)
- Repo, package layout, TS strict, lint/format, CI (unit tests), framework + crypto-lib decisions recorded as ADRs.
- Protobuf/TLV generation pipeline; asset pipeline for icons (vector) and 128×80 sprites.
- **Exit:** `npm test` + a blank PWA installs and runs; ADRs for React-vs-Svelte and crypto lib committed.

### Phase 1 — Transport + spine (L)
- `MeshTransport` facade + `HttpTransport`; connect to a real node.
- `RelayProtocol`: common header (version + sub-type + signature space), fragmentation + selective-repeat + resume, dedupe, ACK/NACK, **airtime governor** (prioritized queue + region-aware token bucket + adaptive backpressure), store-and-forward outbox, HLC ordering.
- Companion data model + IndexedDB stores.
- **Exit:** two real nodes round-trip a multi-fragment message reliably; governor keeps within a conservative airtime budget; unknown sub-types/versions are skipped.

### Phase 2 — Identity & crypto (M)
- Argon2id derivation, Ed25519 signing, X25519 E2E; TOFU key pinning; petnames.
- Onboarding/first-run (handle + password → identity; "no reset" warning; node pairing; hatch Flicker).
- **Exit:** create identity offline, connect a node, sign + verify a profile beacon, send an E2E DM between two nodes; re-deriving the same credentials reproduces the same identity.

### Phase 3 — Core social (M)
- Profiles, presence (coalesced beacons), IM, Mail, friend list, organic discovery (§8.1), QR/short-code add.
- **Exit:** two travelers discover each other, add as friends, exchange IM + mail (E2E), see last-seen — all over LoRa.

### Phase 4 — Communities (M)
- The Broadcast (default + user boards), HLC-ordered threads, owner-authoritative moderation + delegates, personal block/mute, opt-in shareable blocklists.
- **Exit:** post/reply propagates and orders sensibly across nodes; an owner moderation action is honored by other clients.

### Phase 5 — Companion life (L)
- Hearts engine (local activity → hearts), 1→2→4→8 evolution tree, drift, lineage chain, gift (custody transfer) + release, menagerie, encrypted export/import (backup + migration).
- **Exit:** participation raises hearts and evolves a Wisp; a Wisp is gifted to another identity (lineage intact) and keeps growing; export on one device → import on another.

### Phase 6 — Play (L)
- Deterministic game engine (shared-seed), Arcade (Chess, Tic-Tac-Toe), then Relay Arena (Trials/Focus, countersigned results).
- **Exit:** a full game and a full bout resolve identically on both nodes with no referee; bout produces a countersigned result feeding an award.

### Phase 7 — World (M)
- Stations, travel UI, Journey heart, quest system (data + later Cart-driven).
- **Exit:** travel between Stations registers Journey progress; a simple quest can be defined, propagated, and completed.

### Phase 8 — Making / Craft (L)
- Lua runtime + Web Worker sandbox + Relay SDK (deny-by-default, resource limits); Cart authoring editor; sharing (direct push + advertise-then-pull manifest); content-hash provenance; then quests-as-Carts, guides, clubs (private Stations w/ shared key), events, decorations.
- **Exit:** author a Cart on node A, publish via manifest, pull + verify + run sandboxed on node B; sandbox blocks all host/network/storage access; runaway script is aborted.

### Phase 9 — Economy (M)
- Tokens (participation-earned), gifting/barter, The Exchange (reputation-gated).
- **Exit:** earn tokens, buy a cosmetic, gift content/Wisp/cosmetic to another traveler.

### Phase 10 — Hardware bring-up (L)
- `HardwareTransport` for the T-Deck SX1262; device-served UI; trackball/QWERTY input mapping; 320×240 native layout pass.
- **Exit:** the same app runs on a T-Deck using its on-board radio, no separate node.

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
