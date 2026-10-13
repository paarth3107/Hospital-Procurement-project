import { useCallback, useState } from "react";
import { refreshCharts } from "../lib/charts";

// Ported from frontend/js/shell.js's applyTheme()/toggleTheme(). The
// instant-on-load theme (no flash of the wrong one before paint) is a tiny
// inline <script> in index.html, same as before -- this hook just owns the
// toggle button's behaviour from here on.
function readStoredTheme(): "light" | "dark" {
  try {
    return localStorage.getItem("theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => (document.documentElement.dataset.theme === "dark" ? "dark" : readStoredTheme()));

  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // private mode or blocked storage: the choice just won't persist
    }
    refreshCharts();
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
