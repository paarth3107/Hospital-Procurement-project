import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design-system.css";
import "./styles.css";
import { App } from "./App";

// The real production entry point (Final Phase, 2026-10-12) -- replaces
// frontend/js/main.js. `mounts.tsx`'s per-page mount functions and the old
// library-mode build are gone; this is a normal Vite SPA now, built
// straight into frontend/ (see vite.config.ts).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
