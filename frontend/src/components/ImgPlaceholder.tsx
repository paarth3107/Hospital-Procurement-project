import { Icon } from "../lib/icons";

// Ported from frontend/js/kit.js's imgPlaceholder() -- a reserved image slot
// (no upload feature yet for catalog entries or vendor logos), same
// .ep-thumb/.ep-thumb-{size} CSS. size: "sm" (table row, 40px) | "md"
// (card/avatar, 64px) | "lg" (a form's image card, fills its container).
export function ImgPlaceholder({ iconName = "image", size = "sm" }: { iconName?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`ep-thumb ep-thumb-${size}`}>
      <Icon name={iconName} size={size === "lg" ? 28 : size === "md" ? 20 : 16} />
    </div>
  );
}
