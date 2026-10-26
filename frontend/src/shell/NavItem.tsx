import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useChromeState } from "../lib/chromeStore";
import { BADGE_FIELD, type NavItem as NavItemDef } from "../lib/constants";

// Ported from index.html's static `.tab-btn` markup -- a plain button, not
// a real link, same as every internal nav control in this app (there's
// nothing to middle-click-open-in-a-new-tab here, and switching to <Link>
// would need its own active-state logic to replicate the special-cased
// mappings below anyway, not less of it).
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
