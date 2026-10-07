import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
const urls = [
  "https://demos.pixinvent.com/vuexy-html-admin-template/html/vertical-menu-template/app-academy-dashboard.html",
];
for (const url of urls) {
  try {
    await p.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    console.log("OK", url, p.url());
    await p.screenshot({ path: "vuexy_academy_full.png", fullPage: true });
    break;
  } catch (e) {
    console.log("FAIL", url, e.message);
  }
}
await b.close();
