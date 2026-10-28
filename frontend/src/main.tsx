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

// api.ts's hardRedirectTo() forces a real page reload (instead of a
// same-document hash change, which left a stale protected page mounted
// long enough to race and overwrite the redirect -- 2026-10-28, user-
// reported) by changing a throwaway "?r=<timestamp>" query param, since
// only the non-fragment part of the URL actually triggers a full
// navigation. Nothing ever reads that param -- its only job is to be
// different -- so it's cosmetic clutter left sitting in the address bar
// the moment the fresh page finishes loading. Stripped here, once, before
// anything renders; by the time this module's own top-level code runs,
// App.tsx (and RootRedirect's module-level read of a real query param,
// `?guest=`) has already been evaluated via the import above, so this
// can't clobber that.
{
  const params = new URLSearchParams(location.search);
  if (params.has("r")) {
    params.delete("r");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  }
}

// The real production entry point (Final Phase, 2026-10-12) -- replaces
// frontend/js/main.js. `mounts.tsx`'s per-page mount functions and the old
// library-mode build are gone; this is a normal Vite SPA now, built
// straight into frontend/ (see vite.config.ts).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
