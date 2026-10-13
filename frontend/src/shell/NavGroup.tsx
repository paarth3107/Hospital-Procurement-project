import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../lib/icons";

// Ported from frontend/js/shell.js's setGroupCollapsed() -- Vuexy-style
// slide down/up for a nav group's sub-items. CSS can only transition
// max-height to/from a real number, not "auto"/"none", so the pixel height
// is measured right before each toggle and cleared again once expanded (so
// later layout isn't pinned to a stale height). The first render never
// animates (restoring a saved collapse state shouldn't visibly animate on
// page load) -- only a later toggle does.
export function NavGroup({
  groupKey,
  label,
  icon,
  collapsed,
  onToggleCollapsed,
  children,
}: {
  groupKey: string;
  label: string;
  icon: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
}) {
  const itemsRef = useRef<HTMLDivElement>(null);
  const isFirst = useRef(true);
  const prevCollapsed = useRef(collapsed);

  useEffect(() => {
    const items = itemsRef.current;
    if (!items) return;
    if (isFirst.current) {
      isFirst.current = false;
      items.style.maxHeight = collapsed ? "0px" : "";
      prevCollapsed.current = collapsed;
      return;
    }
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    if (collapsed) {
      items.style.maxHeight = items.scrollHeight + "px"; // pin the current (expanded) height first --
      requestAnimationFrame(() => {
        items.style.maxHeight = "0px"; // then animate down to 0 from a real value
      });
    } else {
      items.style.maxHeight = items.scrollHeight + "px"; // scrollHeight is accurate even while clipped at 0
      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName === "max-height" && !collapsed) items.style.maxHeight = "";
      };
      items.addEventListener("transitionend", onEnd, { once: true });
    }
  }, [collapsed]);

  return (
    <div className={`ep-navgroup${collapsed ? " collapsed" : ""}`} data-group={groupKey}>
      <button className="ep-navgroup-head" type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
        <Icon name={icon} size={18} className="nav-icon" />
        <span className="nav-label">{label}</span>
        <Icon name="chevron-down" size={14} className="nav-chevron" />
      </button>
      <div className="ep-navgroup-items" ref={itemsRef}>
        {children}
      </div>
    </div>
  );
}
