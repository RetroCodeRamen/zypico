# ADR 0001 — UI framework: React

_Status: accepted · 2026-06-20 · Phase 0_

## Context
The Project Plan (§4, §13) requires a component framework for the PWA. The two
candidates the plan names are **React** and **Svelte**. The framework only lives
in the `ui`/`app` layers; the framework-agnostic core (`protocol`, `crypto`,
`data`, `hearts`, `games`) must stay free of any framework/DOM deps so it ports
to the T-Deck unchanged.

## Decision
Use **React 18** with Vite + `@vitejs/plugin-react`.

## Rationale
- The plan's own recommendation (§14 "immediate next steps").
- Largest ecosystem for the device-shell UI, on-screen keyboard, canvas play
  window, and Playwright testing.
- The architectural seam (`MeshTransport` facade + framework-agnostic core)
  means a later framework swap would not touch protocol/crypto/data anyway, so
  this choice is low-risk and reversible at the UI edge.

## Consequences
- React stays confined to `src/ui` and `src/app`. `src/core` and
  `src/transport` import nothing from React or the DOM.
- Revisit only if bundle size on the T-Deck becomes a real constraint.
