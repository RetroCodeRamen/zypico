import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Unit tests cover deterministic logic only (protocol framing, hearts, games,
// crypto round-trips). No network, no mesh simulation — see outline §11.4.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@transport": fileURLToPath(new URL("./src/transport", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
    },
  },
});
