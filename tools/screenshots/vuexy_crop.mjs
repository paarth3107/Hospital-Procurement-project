import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
await p.goto("https://demos.pixinvent.com/vuexy-html-admin-template/html/vertical-menu-template/app-academy-dashboard.html", { waitUntil: "networkidle", timeout: 30000 });
const loc = p.locator("text=Assignment Progress").first();
await loc.scrollIntoViewIfNeeded();
const card = loc.locator("xpath=ancestor::div[contains(@class,'card')][1]");
const count = await card.count();
console.log("card count", count);
if (count) {
  await card.screenshot({ path: "vuexy_assignment_card.png" });
  console.log("outerHTML length:", (await card.evaluate((el) => el.outerHTML.length)));
  const html = await card.evaluate((el) => el.outerHTML);
  require("fs").writeFileSync("vuexy_assignment_card.html", html);
}
await b.close();
