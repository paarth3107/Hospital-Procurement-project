import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design-system.css";
import "./styles.css";
import { App } from "./App";

// Scrolling the mouse wheel over a focused number input silently changes
// its value -- the browser's own spinner behavior, easy to trigger by
// accident while scrolling the page past one (user-reported, 2026-10-28:
// "remove this scroll to increase decrease... its just annoying").
// Blurring it the instant a wheel event arrives while it's focused stops
// the browser from acting on the scroll at all -- one global, passive
// listener here covers every <input type="number"> in the app, rather
// than adding onWheel={(e) => e.currentTarget.blur()} to each one by hand.
document.addEventListener(
  "wheel",
  () => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === "number") el.blur();
  },
  { passive: true }
);

// The real production entry point (Final Phase, 2026-10-12) -- replaces
// frontend/js/main.js. `mounts.tsx`'s per-page mount functions and the old
// library-mode build are gone; this is a normal Vite SPA now, built
// straight into frontend/ (see vite.config.ts).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
