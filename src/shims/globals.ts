// Browser globals shim — must be imported FIRST, before any @meshtastic/* code.
//
// @meshtastic/core references Node globals (`process`, `Buffer`) at module-load
// time — e.g. `process == null`, `process.cwd()`, `Buffer.isBuffer(...)`. In a
// browser those identifiers are undefined and the bare reference throws
// `ReferenceError: process is not defined`, which aborts module evaluation and
// leaves the page blank. We install the minimal surface the library touches.
// Pairs with the os/path/util shims in ./node/* (aliased in vite.config.ts).
// Remove if the dependency ever ships a clean browser build.

// Cast through unknown to avoid clashing with @types/node's global typings; this
// is a runtime polyfill, not a place to model Node's real API.
const g = globalThis as unknown as Record<string, unknown>;

if (g.process === undefined) {
  g.process = { env: {}, version: "", cwd: () => "/" };
}

if (g.Buffer === undefined) {
  // The library only calls Buffer.isBuffer for a type check; in the browser our
  // payloads are Uint8Arrays, never Node Buffers, so false is always correct.
  g.Buffer = { isBuffer: () => false };
}

export {};
