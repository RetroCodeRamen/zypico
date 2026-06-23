// Tiny test helpers for the on-hardware harness (run via vite-node under
// `sg dialout`). Not a unit-test framework — these scripts exercise the real
// radio, so they live outside vitest (which is deterministic-only, no mesh).

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Log to stderr — unbuffered, so progress shows live even when stdout is piped.
export const log = (s: string): void => { process.stderr.write(s + "\n"); };

/** Force-exit if a script overruns (radio backlog shouldn't wedge a test run). */
export function guard(ms: number): void {
  const t = setTimeout(() => { log(`\nTIMED OUT after ${ms}ms`); process.exit(2); }, ms);
  t.unref();
}

/** Poll until `cond()` is true or the timeout elapses; returns the final result. */
export async function waitFor(cond: () => boolean, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (cond()) return true;
    await delay(stepMs);
  }
  return cond();
}

let failures = 0;
export function check(label: string, ok: boolean, detail = ""): void {
  log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

export function finish(): never {
  if (failures > 0) {
    log(`\nFAILED — ${failures} check(s) did not pass`);
    process.exit(1);
  }
  log("\nALL CHECKS PASSED");
  process.exit(0);
}
