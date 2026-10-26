import { useCallback, useState } from "react";
import { NAV_GROUPS } from "../lib/constants";

// Ported from frontend/js/shell.js's initGroups() -- which sidebar groups
// the user last left open, persisted the same way (one JSON object, group
// key -> false if expanded). Every group now defaults to collapsed
// (2026-10-26, user-directed): a key this session has never toggled is
// treated as collapsed, not expanded -- Sidebar.tsx's own activeTabView
// override still force-expands whichever group contains the current page
// regardless. The slide animation itself lives in NavGroup.tsx (it needs a
// DOM ref); this hook only owns which groups are collapsed and writing
// that choice back.
function readSaved(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("navGroups") || "{}");
  } catch {
    return {};
  }
}

function isCollapsed(saved: Record<string, boolean>, key: string): boolean {
  return key in saved ? saved[key] : true;
}

export function useNavGroups() {
  const [saved, setSaved] = useState<Record<string, boolean>>(readSaved);

  const toggle = useCallback((key: string) => {
    setSaved((prev) => {
      const next = { ...prev, [key]: !isCollapsed(prev, key) };
      try {
        // Only the ones explicitly expanded need storing now that collapsed
        // is the default for everything else.
        localStorage.setItem("navGroups", JSON.stringify(Object.fromEntries(NAV_GROUPS.map((g) => [g.key, isCollapsed(next, g.key)]).filter(([, collapsed]) => !collapsed))));
      } catch {
        // private mode or blocked storage: the choice just won't persist
      }
      return next;
    });
  }, []);

  const isGroupCollapsed = useCallback((key: string) => isCollapsed(saved, key), [saved]);

  return { saved, toggle, isCollapsed: isGroupCollapsed };
}
