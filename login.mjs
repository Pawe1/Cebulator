// One-time login: opens a visible Chromium window on a Cebulator-dedicated
// persistent profile (state/profile) and waits until you sign in to
// copilot.cloud.microsoft. Cookies persist afterwards; delegations run headless.
//   npm run login
import { launchPersistentContext } from "playwright";
import { profileDir, CHAT_URL } from "./src/browser.mjs";

const ctx = await launchPersistentContext(profileDir, { headless: false });
const page = (await ctx.pages())[0] ?? (await ctx.newPage());
await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

console.log("\n=== SIGN IN in the opened browser window (once, ever). ===");
console.log("You have up to 10 minutes. The window closes automatically after sign-in.\n");

const ok = await page
  .waitForFunction(
    () =>
      !/login|aad|signin/i.test(location.hostname) &&
      !!document.querySelector('[contenteditable="true"], [role="textbox"], textarea'),
    { timeout: 600_000 }
  )
  .then(() => true)
  .catch(() => false);

if (ok) {
  console.log("\nSigned in. Session saved under state/profile — headless runs should work now.");
} else {
  console.log("\nTimed out. If you did not sign in, run again: npm run login");
}
await ctx.close();
process.exit(ok ? 0 : 1);
