import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useChromeState, type ChromeState } from "../lib/chromeStore";
import type { NavItem as NavItemDef } from "../lib/constants";

// Ported from index.html's static `.tab-btn` markup -- a plain button, not
// a real link, same as every internal nav control in this app (there's
// nothing to middle-click-open-in-a-new-tab here, and switching to <Link>
// would need its own active-state logic to replicate the special-cased
// mappings below anyway, not less of it).
const BADGE_FIELD: Record<NonNullable<NavItemDef["badge"]>, keyof ChromeState> = {
  queue: "badgeQueue",
  mappings: "badgeMappings",
  approvals: "badgeApprovals",
  awards: "badgeAwards",
  decisions: "badgeDecisions",
  "vendor-categories": "badgeVendorCategories",
  "vendor-dashboard": "badgeVendorDashboard",
};

export function NavItem({ item, active }: { item: NavItemDef; active: boolean }) {
  const navigate = useNavigate();
  const chrome = useChromeState();
  const badge = item.badge ? chrome[BADGE_FIELD[item.badge]] : 0;
  return (
    <button type="button" className={`tab-btn ep-nav${active ? " active" : ""}`} onClick={() => navigate("/" + item.view)}>
      <Icon name={item.icon} size={18} className="nav-icon" />
      <span className="nav-label">{item.label}</span>
      {item.badge && <span className="nav-badge">{badge ? badge : ""}</span>}
    </button>
  );
}
