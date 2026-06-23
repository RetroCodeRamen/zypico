// Browser shim for Node's `path` (aliased in vite.config.ts). See os.ts for why.

export function normalize(p: string): string {
  return p;
}

export default { normalize };
