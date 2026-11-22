// Headless probe: launches the persistent profile, opens the target chat
// and reports where it lands (login wall vs. real chat) + a screenshot.
//   npm run probe:browser
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { profileDir, CHAT_URL } from "../src/browser.mjs";

const out = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "state",
  "browser-probe.png"
);

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  channel: process.env.CEB_CHANNEL === "chromium" ? undefined : "chrome",
});
const page = await ctx.newPage();
await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(6000); // let the SPA settle / redirect

const url = page.url();
const title = await page.title();
const wall = /login|signin|account\.live/i.test(url);

await page.screenshot({ path: out, fullPage: false }).catch(() => {});

console.log(`final url : ${url}`);
console.log(`title     : ${title}`);
console.log(wall
  ? "RESULT: LOGIN WALL — the profile has no session yet. Run: npm run login:manual"
  : "RESULT: looks logged in — profile has a session.");
console.log(`screenshot: ${out}`);

await ctx.close();
process.exit(wall ? 1 : 0);
