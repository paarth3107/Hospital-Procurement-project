import { switchView } from "../../lib/bridge";

// Staff/Vendor switch, shown below the MedSource branding on both login
// pages (user-directed, 2026-10-22) -- replaces the old asymmetric
// "Supplier? Click here to log in" / "← Back to staff login" pair with a
// single sliding segmented control. AuthLayout.tsx renders this once, above
// whichever of the two login pages is active, rather than each page
// managing its own copy.
export function AuthTabs({ active }: { active: "login" | "vendor-login" }) {
  return (
    <div className="auth-tabs">
      <div className={`auth-tabs-indicator${active === "vendor-login" ? " is-vendor" : ""}`} />
      <button type="button" className={`auth-tab${active === "login" ? " active" : ""}`} onClick={() => switchView("login")}>
        Staff
      </button>
      <button type="button" className={`auth-tab${active === "vendor-login" ? " active" : ""}`} onClick={() => switchView("vendor-login")}>
        Vendor
      </button>
    </div>
  );
}
