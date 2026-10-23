import { Icon } from "../lib/icons";

// Icon-only row action (Edit/Deactivate/Details/Manage ...), replacing the
// old text buttons in table "Action" columns and similar spots (2026-10-23,
// user-directed, matching a reference screenshot: small muted icons, no
// visible button box until hovered). `tone="danger"` is for a destructive-
// leaning action (Deactivate) -- it only tints on hover, same restraint the
// rest of this icon set already uses elsewhere (e.g. NotificationsMenu's
// dismiss button).
export function IconActionButton({
  icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  tone?: "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ep-icon-action${tone === "danger" ? " ep-icon-action-danger" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
