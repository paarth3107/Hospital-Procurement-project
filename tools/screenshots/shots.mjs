// Screenshots every page of the frontend in light and dark, for visual review.
// Usage: npm run shots -- [view ...]   (no args = all views)
// Needs the backend running on BASE and the demo data seeded (app.seed_demo).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:8000";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(OUT, { recursive: true });

const STAFF = { user: "sysadmin@medsource.local", password: "changeme123", actor: "staff" };
const VENDOR = { user: "rohan@medequipsolutions.co", password: "vendor12345", actor: "vendor" };

const STAFF_VIEWS = ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals", "evaluation", "awards", "pofiles", "staff", "audit"];
const VENDOR_VIEWS = ["vendor-dashboard", "vendor-profile", "vendor-categories", "bid"];

async function login({ user, password, actor }) {
  const path = actor === "vendor" ? "/api/v1/vendor-auth/login" : "/api/v1/auth/login";
  const res = await fetch(BASE + path, { method: "POST", body: new URLSearchParams({ username: user, password }) });
  if (!res.ok) throw new Error(`${actor} login failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function shoot(browser, session, view, theme) {
  const token = await login(session);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ({ token, actor, theme }) => {
      sessionStorage.setItem("token", token);
      sessionStorage.setItem("actorType", actor);
      localStorage.setItem("theme", theme);
    },
    { token, actor: session.actor, theme }
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/?view=${view}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const file = join(OUT, `${view}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
  return { file, errors };
}

const requested = process.argv.slice(2);
const browser = await chromium.launch();
const results = [];
try {
  for (const [session, views] of [[STAFF, STAFF_VIEWS], [VENDOR, VENDOR_VIEWS]]) {
    for (const view of views) {
      if (requested.length && !requested.includes(view)) continue;
      for (const theme of ["light", "dark"]) {
        try {
          const r = await shoot(browser, session, view, theme);
          results.push({ view, theme, ...r });
          console.log(`${view} ${theme}: ${r.errors.length ? r.errors.length + " console error(s)" : "ok"}`);
        } catch (err) {
          console.log(`${view} ${theme}: FAILED ${err.message}`);
        }
      }
    }
  }
} finally {
  await browser.close();
}
for (const r of results.filter((r) => r.errors.length)) {
  console.log(`\n[${r.view} ${r.theme}]`);
  for (const e of r.errors.slice(0, 5)) console.log("  -", e);
}
