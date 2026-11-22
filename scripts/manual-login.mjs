// Manual one-time login using a PLAIN Chrome window (no Playwright launch
// flags), pointed at the SAME persistent profile Playwright uses
// (state/profile). Some managed/enterprise Chrome builds reject Playwright's
// startup flags in headed mode; a bare launch flags nothing at all.
//   npm run login:manual
// Sign in in the window that opens, then close it. The profile keeps the
// session; Playwright (headless) picks it up afterwards.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileDir, CHAT_URL } from "../src/browser.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chromeCandidates = [
  path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["LOCALAPPDATA"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
];
const fs = await import("node:fs");
const chrome = chromeCandidates.find((p) => p && fs.existsSync(p));
if (!chrome) {
  console.error("Chrome not found on this machine. Install Chrome or run: npx playwright install chromium (then use CEB_CHANNEL=chromium).");
  process.exit(1);
}

fs.mkdirSync(profileDir, { recursive: true });
console.log("Opening a regular Chrome window on the dedicated Cebulator profile.");
console.log(`Profile : ${profileDir}`);
console.log("Sign in, then CLOSE the window. That's it.\n");

const child = spawn(chrome, [`--user-data-dir=${profileDir}`, CHAT_URL], {
  stdio: "ignore",
  detached: true,
});
child.on("error", (e) => {
  console.error("Failed to start Chrome:", e.message);
  process.exit(1);
});
child.unref();

// Poll until the profile shows a session cookie (or give up after 10 min).
const stateDir = path.dirname(profileDir);
const deadline = Date.now() + 10 * 60 * 1000;
const tick = async () => {
  try {
    const cookieFile = path.join(profileDir, "Default", "Cookies");
    if (fs.existsSync(cookieFile)) {
      const size = fs.statSync(cookieFile).size;
      if (size > 0) {
        console.log("\nSession cookies detected in the profile. You can close the window now.");
        console.log("(If you already closed it — perfect.) Headless runs should work: npm run smoke:server");
        process.exit(0);
      }
    }
  } catch { /* keep polling */ }
  if (Date.now() > deadline) {
    console.log("\nTimed out after 10 minutes without session cookies.");
    process.exit(1);
  }
  setTimeout(tick, 3000);
};
tick();
