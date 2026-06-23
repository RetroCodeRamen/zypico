import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // HTTPS in dev so Web Bluetooth works on a phone over the LAN (the BLE API
    // is only exposed in a secure context). Self-signed cert — accept the
    // browser warning once on the device.
    basicSsl(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "ZyPico",
        short_name: "ZyPico",
        description: "A retro LoRa-mesh social handheld.",
        theme_color: "#f4ebd9",
        background_color: "#f4ebd9",
        display: "standalone",
        orientation: "landscape",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      // The app must run fully offline (local-first). Cache the shell.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,wasm}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@transport": fileURLToPath(new URL("./src/transport", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      // @meshtastic/core bundles a logger that imports these Node built-ins at
      // load time. They never run in the browser; point them at tiny shims so
      // the production bundle resolves (see src/shims/node/*).
      os: fileURLToPath(new URL("./src/shims/node/os.ts", import.meta.url)),
      path: fileURLToPath(new URL("./src/shims/node/path.ts", import.meta.url)),
      util: fileURLToPath(new URL("./src/shims/node/util.ts", import.meta.url)),
    },
  },
  server: {
    host: true,
  },
});
