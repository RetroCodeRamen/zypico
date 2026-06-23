# ADR 0002 — Crypto library: @noble/* (deferred final pick to Phase 2)

_Status: provisional · 2026-06-20 · Phase 0_

## Context
Identity & crypto (outline §9.3, plan §4) needs Argon2id (KDF), Ed25519
(signing), and X25519 + AEAD (E2E). The plan names **libsodium-wrappers** vs
**`@noble/*`** and recommends libsodium-wrappers.

## Decision
Provisionally target the **`@noble/*`** family (`@noble/hashes`,
`@noble/curves`, `@noble/ciphers`) — but **do not install crypto yet**. Phase 1
(transport + protocol) needs no crypto. The dependency is added at the start of
Phase 2 with a one-file `crypto` module behind a stable interface.

## Rationale
- Phase 1 deliberately carries no crypto code, so committing the lib now is
  premature. The `RelayProtocol` header reserves signature space (outline
  §11.3) without needing the implementation.
- `@noble/*` is pure-JS, tiny, audited, tree-shakeable, and Argon2id is
  available via `@noble/hashes`. This matters for the eventual T-Deck bundle.
- libsodium-wrappers (WASM) remains a valid fallback if a primitive or
  performance gap appears; the `crypto` module interface makes the swap local.

## Consequences
- Whatever is chosen lives behind `src/core/crypto` with a narrow interface
  (`deriveIdentity`, `sign`, `verify`, `seal`, `open`, lineage sign/verify).
- Final decision recorded as an amendment here when Phase 2 starts.
