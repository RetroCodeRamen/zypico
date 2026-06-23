// Browser shim for Node's `util` (aliased in vite.config.ts). See os.ts for why.
//
// @meshtastic/core's logger uses only formatWithOptions and types.isNativeError.

export function formatWithOptions(_opts: unknown, ...args: unknown[]): string {
  return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
}

export const types = {
  isNativeError(value: unknown): value is Error {
    return value instanceof Error;
  },
};

export default { formatWithOptions, types };
