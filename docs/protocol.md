# RelayProtocol — wire specification (v0.1)

> The on-air format for all ZyPico traffic. Companion to
> [The-Relay-Outline-v2.md](../The-Relay-Outline-v2.md) §11 (the protocol design)
> and [The-Relay-Project-Plan.md](../The-Relay-Project-Plan.md) §5 (the build
> view). This document is the byte-level contract; the plan calls it "the first
> task of Phase 1."

_Status: draft v0.1 · Last updated 2026-06-20 · covers the Phase-1 spine
(framing, sub-types, HLC, dedupe, fragmentation, airtime governor)._

All ZyPico traffic rides **one private Meshtastic portnum** (`PRIVATE_APP`, 256).
The portnum says "this is ZyPico"; everything below distinguishes message kinds
and handles reliability. **Binary only — never JSON over the air** (plan §12).
Multi-byte integers are **big-endian** unless noted.

The transport (`MeshTransport`) carries opaque frame bytes and knows nothing of
the structure below. Each Meshtastic packet also gives us, out of band, the
sender node number and a sender-assigned 32-bit packet id — used for dedupe.

---

## 1. Common frame header

Every frame begins with a 3-byte header (`src/core/protocol/frame.ts`):

| Offset | Size | Field     | Notes |
|-------:|-----:|-----------|-------|
| 0      | 1    | version   | `(major << 4) | minor`, one nibble each |
| 1      | 1    | sub-type  | see §2 |
| 2      | 1    | flags     | bit0 = `SIGNED`; bits 1–7 reserved (0) |
| 3      | 64   | signature | present **iff** `SIGNED` — Ed25519 over header+body |
| …      | —    | payload   | sub-type-specific bytes |

Current version is **0.1**. Overhead is **3 bytes** unsigned, **67** signed.

**Receiver rules** (outline §11.3):
- `major` higher than ours → **skip** (`incompatible-major`); we never guess at
  a future layout.
- Same `major`, higher `minor` → **parse** (new fields, if any, live inside the
  sub-type payload and are that decoder's concern).
- Unknown sub-type → **surface and ignore** (`unknown-subtype`); forward-compatible.
- Signing lands in Phase 2; the flag + 64-byte block are reserved now so the
  layout is stable, but frames are emitted unsigned until then.

Budget: the working on-air payload is **≤180 bytes** (outline §11.1). With the
3-byte header that leaves **177 bytes** for the sub-type payload.

---

## 2. Sub-type catalog

One byte; fixed wire constants — **never renumber, only append**
(`src/core/protocol/subtypes.ts`). Grouped by concern:

| Range | Kinds |
|-------|-------|
| `0x01–0x03` | `PRESENCE`, `PROFILE`, `WISP_SIG` |
| `0x10–0x11` | `IM`, `MAIL` |
| `0x20–0x21` | `POST`, `CLUB_MSG` |
| `0x30–0x32` | `GAME_INVITE`, `GAME_MOVE`, `GAME_RESULT` |
| `0x40–0x41` | `QUEST_DEF`, `QUEST_EVENT` |
| `0x50–0x52` | `CONTENT_PUB`, `CART`, `WISP_GIFT` |
| `0x60–0x62` | `MANIFEST`, `PULL_REQ`, `PULL_SERVE` (advertise-then-pull) |
| `0x70`      | `BLOCKLIST` |
| `0x80–0x81` | `TRADE_OFFER`, `GIFT` |
| `0xF0–0xF2` | `FRAG`, `ACK`, `NACK` (spine envelopes) |

---

## 3. Hybrid Logical Clock (HLC)

8 bytes; orders events causally with no shared wall clock or server
(`src/core/protocol/hlc.ts`). Used by ordered surfaces (boards, threads, game
logs). Layout:

| Offset | Size | Field   | Notes |
|-------:|-----:|---------|-------|
| 0      | 6    | wallMs  | 48-bit ms since Unix epoch |
| 6      | 2    | counter | 16-bit tie-breaker within a millisecond |

Order is `wallMs`, then `counter`. On a local event the clock advances to
`max(last, physicalNow)`, bumping the counter on a tie; on receiving a peer
timestamp it advances past both, so anything heard before an event sorts before
it. Counter overflow borrows one millisecond from the wall (monotonicity
preserved). The local physical clock is injectable for deterministic tests.

---

## 4. Dedupe

The mesh floods; the same frame arrives by many paths and our own
retransmissions echo back. Before any sub-type handler runs, a frame is dropped
if `(fromNode, packetId)` has been seen (`src/core/protocol/dedupe.ts`). The
cache is a bounded, insertion-ordered seen-set (FIFO eviction) — no unbounded
growth on a memory-thin handheld.

---

## 5. Fragmentation + selective repeat

Messages larger than one frame are split into **FRAG** envelopes
(`src/core/protocol/fragment.ts`). The bytes being fragmented are **a complete
inner frame** (header + payload), so the reassembled output is fed straight back
to the frame decoder. Each FRAG envelope is itself carried in a normal
`SubType.FRAG` frame — the wire still has exactly one framing format.

FRAG envelope payload (inside a `SubType.FRAG` frame):

| Offset | Size | Field | Notes |
|-------:|-----:|-------|-------|
| 0      | 4    | msgId | uint32, sender-chosen, groups a transfer |
| 4      | 2    | index | uint16, 0-based |
| 6      | 2    | total | uint16, fragment count (1…65535) |
| 8      | …    | chunk | this fragment's slice |

Envelope overhead is **8 bytes**; with the frame header, **11 bytes** per
fragment off the budget. The receiver tolerates loss, duplication, and
out-of-order arrival; partial transfers persist so a late or re-sent fragment
**resumes** rather than restarts. `Reassembler.missing(msgId)` lists the indices
still needed — the basis for a **selective-repeat NACK** (the `ACK`/`NACK`
envelopes themselves are the next Phase-1 task). In-flight transfers are bounded;
the oldest is dropped under pressure.

---

## 6. Airtime governor

LoRa is shared, slow, and duty-cycle-limited; transmitting greedily ruins the
channel (and, in EU868, breaks the 1% law). The governor
(`src/core/protocol/governor.ts`) makes ZyPico a good mesh citizen:

1. **Prioritized queue** — `CONTROL` (ACK/NACK) > `INTERACTIVE` (IM, presence,
   game moves) > `BULK` (fragments, content, Carts). Bulk never starves a live
   message.
2. **Region-aware token bucket** — a bucket of spendable **airtime-ms** refills
   at the region's duty cycle (default EU868 1%). Each send debits its measured
   time on air, computed by the exact Semtech LoRa ToA formula
   (`src/core/protocol/airtime.ts`) from the modem's SF/BW/CR. When the bucket
   is dry, transmission waits — "patience as aesthetic."
3. **Adaptive backpressure** — past a queue high-water mark the governor sheds
   the lowest-priority work first, so the queue can't grow without bound.

The governor owns no timers: it is a pure scheduler driven by the caller
(`RelayClient` pumps it and schedules the next wake-up via `msUntilNext()`),
which keeps it fully deterministic under test.

---

## 7. Still to come (Phase 1 remainder)

- **ACK / NACK envelopes** (`0xF1`/`0xF2`) and the selective-repeat retransmit
  loop wired through the governor + outbox.
- **Store-and-forward outbox** — persist unsent/unacked frames (IndexedDB) so a
  message survives a disconnect and resumes.
- **Companion data model + IndexedDB stores** (plan §8 Phase 1).
- **Signing** (`SIGNED` flag) — Phase 2, when the crypto module lands.
