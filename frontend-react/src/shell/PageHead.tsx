import { useLocation } from "react-router-dom";
import { PAGE_TITLES } from "../lib/constants";
import { fmtDateTime } from "../lib/format";
import { useChromeState } from "../lib/chromeStore";
import { useAuthState } from "../lib/authStore";

// Ported from frontend/js/nav.js's setPageHead() + the page-facts strip
// half of refreshChrome() (staff only).
export function PageHead() {
  const { pathname } = useLocation();
  const { actorType } = useAuthState();
  const chrome = useChromeState();
  const view = pathname.replace(/^\//, "");
  const titles = PAGE_TITLES[view];
  if (!titles) return null;
  const [kicker, title] = titles;
  return (
    <header className="ep-head" id="page-head">
      <div className="flex-1 minw-0">
        <div className="ep-k">{kicker}</div>
        <h3>{title}</h3>
      </div>
      {actorType !== "vendor" && (
        <div className="ep-head-facts">
          <div className="ep-fact">
            <div className="ep-k">Open tenders</div>
            <div className="ep-fact-value">{chrome.openTendersCount ?? ""}</div>
          </div>
          <div className="ep-fact-rule"></div>
          <div className="ep-fact">
            <div className="ep-k">Next bid close</div>
            <div className="ep-fact-value text-primary-deep">{chrome.nextBidClose ? fmtDateTime(chrome.nextBidClose) : "—"}</div>
          </div>
        </div>
      )}
    </header>
  );
}
