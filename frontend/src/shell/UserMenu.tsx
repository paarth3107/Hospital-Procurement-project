import { useAuthState, clearAuthState } from "../lib/authStore";
import { resetChromeState } from "../lib/chromeStore";
import { identityFor, initials } from "./identity";

// Ported from frontend/js/shell.js's renderUserMenu() + frontend/js/nav.js's
// logout-btn handler.
export function UserMenu({ onClose, onLoggedOut }: { onClose: () => void; onLoggedOut: () => void }) {
  const auth = useAuthState();
  const identity = identityFor(auth);

  const logout = () => {
    clearAuthState();
    resetChromeState();
    onClose();
    onLoggedOut();
  };

  return (
    <div className="ep-dropdown" id="user-menu">
      <div className="ep-user-head">
        <div className="ep-avatar" id="user-menu-avatar">
          {initials(identity.name)}
        </div>
        <div>
          <div className="who-name">{identity.name}</div>
          <div className="who-role">{identity.role}</div>
        </div>
      </div>
      <button className="ep-dropdown-item" type="button" onClick={logout}>
        Log out
      </button>
    </div>
  );
}
