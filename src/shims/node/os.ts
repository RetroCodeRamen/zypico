// Browser shim for Node's `os` (aliased in vite.config.ts).
//
// @meshtastic/core bundles a logging helper that pulls in `os`, `path`, and
// `util` at module load. None of those run in a browser, but the named imports
// must resolve or the production bundle fails. We provide the exact symbols the
// dependency references — nothing more. Remove these shims if the dependency
// ever ships a clean browser build.

export function hostname(): string {
  return "browser";
}

export default { hostname };
