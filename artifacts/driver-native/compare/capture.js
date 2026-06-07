// Captures phone-sized screenshots of the NEW React Native shell (Expo web build)
// and the CURRENT web shell reproduction, plus a side-by-side comparison image.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:8088";
const OUT = path.resolve(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const VP = { width: 390, height: 844 };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });

  // ---- NEW app: Orders (default tab) ----
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[new console error]", m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("text=BUX-001", { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "new-orders.png") });
  console.log("captured new-orders");

  // ---- NEW app: Profile (identity + language switch) ----
  await page.click("text=Профиль");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "new-profile.png") });
  console.log("captured new-profile");

  // ---- NEW app: login-by-code screen ----
  const lp = await ctx.newPage();
  await lp.goto(BASE + "/driver-login", { waitUntil: "networkidle" });
  await lp.waitForTimeout(900);
  await lp.screenshot({ path: path.join(OUT, "new-login.png") });
  await lp.close();
  console.log("captured new-login");

  // ---- CURRENT web shell reproduction ----
  const cur = await ctx.newPage();
  await cur.goto(BASE + "/compare/current-shell.html", { waitUntil: "networkidle" });
  await cur.waitForTimeout(1800);
  await cur.screenshot({ path: path.join(OUT, "current-orders.png") });
  await cur.close();
  console.log("captured current-orders");

  // ---- Side-by-side comparison ----
  const cmp = await ctx.newPage();
  await cmp.setViewportSize({ width: 390 * 2 + 24 * 3, height: 844 + 96 });
  await cmp.setContent(
    `<!doctype html><html><body style="margin:0;background:#0b0b14;font-family:system-ui,Segoe UI,sans-serif">
      <div style="display:flex;gap:24px;padding:24px;align-items:flex-start;justify-content:center">
        <div>
          <div style="color:#cbd5e1;font-size:13px;font-weight:700;margin:0 0 10px;text-align:center;letter-spacing:.4px">CURRENT — web / live WebView APK</div>
          <iframe src="${BASE}/compare/current-shell.html" width="390" height="844" style="border:1px solid #1f2937;border-radius:20px;background:#0a0a1a"></iframe>
        </div>
        <div>
          <div style="color:#22d3ee;font-size:13px;font-weight:700;margin:0 0 10px;text-align:center;letter-spacing:.4px">NEW — React Native (Expo)</div>
          <iframe src="${BASE}/" width="390" height="844" style="border:1px solid #1f2937;border-radius:20px;background:#0a0a1a"></iframe>
        </div>
      </div></body></html>`,
    { waitUntil: "networkidle" },
  );
  await cmp.waitForTimeout(3000);
  await cmp.screenshot({ path: path.join(OUT, "compare-shell.png") });
  await cmp.close();
  console.log("captured compare-shell");

  // ---- NEW app: i18n -> Uzbek (isolated context so RU comparison is unaffected) ----
  try {
    const uzCtx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
    const uz = await uzCtx.newPage();
    await uz.goto(BASE + "/", { waitUntil: "networkidle" });
    await uz.waitForSelector("text=BUX-001", { timeout: 30000 });
    await uz.click("text=Профиль");
    await uz.waitForTimeout(500);
    await uz.click("text=Oʻzbekcha");
    await uz.waitForTimeout(500);
    await uz.screenshot({ path: path.join(OUT, "new-profile-uz.png") });
    await uzCtx.close();
    console.log("captured new-profile-uz");
  } catch (e) {
    console.log("uz capture skipped:", e.message);
  }

  await browser.close();
  console.log("DONE ->", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
