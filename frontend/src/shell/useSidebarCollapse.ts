import { useCallback, useState } from "react";

// Ported from frontend/js/shell.js's applySidebarCollapsed()/
// toggleSidebarCollapsed() -- the whole-sidebar thin-rail collapse. CSS does
// the actual layout work off `body.sidebar-collapsed` (kept as a real body
// class, same as vanilla, rather than a React-only concept, since nothing
// else in the page needs to react to it besides CSS) plus `.sidebar-peek`
// (see styles.css's own comment on it) for the hover-to-glance-without-
// committing behaviour -- tracked here in JS, not CSS :hover, because
// :hover is still true right after the click that collapsed it.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: the choice just won't persist
  }
}

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(() => readStored("sidebarCollapsed") === "true");
  const [peek, setPeek] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      writeStored("sidebarCollapsed", String(next));
      if (next) setPeek(false); // collapsing always shows the true collapsed rail immediately
      return next;
    });
  }, []);

  return { collapsed, peek, setPeek, toggle };
}
