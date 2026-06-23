// Must precede any import that pulls in @meshtastic/* — it installs the browser
// globals that library expects at load time (see shims/globals.ts).
import "../shims/globals.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@ui/App.tsx";
import "@ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
