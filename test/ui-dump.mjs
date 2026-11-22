// Debug: open the persistent profile, load the latest chat, and dump the
// tail of the visible text so we can read the real (possibly localized)
// UI markers.  Run: node test/ui-dump.mjs [chars]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { profileDir, CHAT_URL } from "../src/browser.mjs";

const chars = Number(process.argv[2] ?? 1500);

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  channel: process.env.CEB_CHANNEL === "chromium" ? undefined : "chrome",
});
const page = await ctx.newPage();
await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(12_000);

const raw = (await page.evaluate(() => document.body.innerText ?? "")).replace(/\u200b/g, "");
console.log(`URL: ${page.url()}`);
console.log("--- LAST ${chars} CHARS ---");
console.log(raw.slice(-chars));
console.log("--- END ---");

await page.screenshot({ path: path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "state", "ui-dump.png") }).catch(() => {});
await ctx.close();
process.exit(0);
