import { useCallback, useState } from "react";
import { NAV_GROUPS } from "../lib/constants";

// Ported from frontend/js/shell.js's initGroups() -- which sidebar groups
// the user last left collapsed, persisted the same way (one JSON object,
// group key -> true if collapsed). The slide animation itself lives in
// NavGroup.tsx (it needs a DOM ref); this hook only owns which groups are
// collapsed and writing that choice back.
function readSaved(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("navGroups") || "{}");
  } catch {
    return {};
  }
}

export function useNavGroups() {
  const [saved, setSaved] = useState<Record<string, boolean>>(readSaved);

  const toggle = useCallback((key: string) => {
    setSaved((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("navGroups", JSON.stringify(Object.fromEntries(NAV_GROUPS.map((g) => [g.key, !!next[g.key]]).filter(([, v]) => v))));
      } catch {
        // private mode or blocked storage: the choice just won't persist
      }
      return next;
    });
  }, []);

  return { saved, toggle };
}
