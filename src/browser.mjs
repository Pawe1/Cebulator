// Browser layer: drives copilot.cloud.microsoft/chat through Playwright
// with a persistent local profile (one-time human login, then headless).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchPersistentContext } from "playwright";
import { LOG } from "./switch.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const profileDir = path.join(ROOT, "state", "profile");
export const CHAT_URL = "https://copilot.cloud.microsoft/chat";
const DEFAULT_TIMEOUT_MS = Number(process.env.CEB_TIMEOUT_MS ?? 180_000);
const POLL_MS = 2_000;
const STABLE_MS = 10_000;
const HEADLESS = process.env.CEB_HEADLESS === "1";

class LoginRequired extends Error {
  constructor() {
    super("LOGIN_REQUIRED");
    this.name = "LoginRequired";
  }
}

let ctxPromise = null;

function isLoginWall(url) {
  return /login|aad|signin|account\.live|identity|signup/i.test(url);
}

async function getCtx() {
  if (!ctxPromise) {
    ctxPromise = launchPersistentContext(profileDir, {
      headless: HEADLESS,
      viewport: { width: 1440, height: 900 },
    });
  }
  return ctxPromise;
}

export async function closeBrowser() {
  if (ctxPromise) {
    const ctx = await ctxPromise;
    ctxPromise = null;
    await ctx.close().catch(() => {});
  }
}

// Returns a chat page; throws LoginRequired if the profile is not logged in.
async function getChatPage() {
  const ctx = await getCtx();
  const existing = ctx.pages().find((p) => p.url().includes("cloud.microsoft.com"));
  const page = existing ?? await ctx.newPage();

  if (!page.url().includes("cloud.microsoft.com")) {
    await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  // M365 bounces unauthenticated traffic to an identity wall.
  if (isLoginWall(page.url)) throw new LoginRequired();

  // Give the SPA a moment to render the composer.
  await page.waitForTimeout(2_500);
  return page;
}

async function findComposer(page) {
  const candidates = [
    '[contenteditable="true"]',
    '[role="textbox"]',
    "textarea",
    ".ql-editor",
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    const n = await el.count().catch(() => 0);
    if (n > 0 && (await el.isVisible().catch(() => false))) return el;
  }
  return null;
}

async function openNewChatIfPossible(page) {
  // Best effort: look for a "New chat" trigger; if absent, continue in the current thread.
  const candidates = [
    '[aria-label*="New chat"]',
    '[aria-label*="New Chat"]',
    'button:has-text("New chat")',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if ((await el.count().catch(() => 0)) > 0) {
      const before = page.url();
      await el.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      LOG(`new-chat attempt via ${sel}: url ${before} -> ${page.url()}`);
      return;
    }
  }
  LOG("new-chat trigger not found; continuing in current thread");
}

async function sendBrief(page, brief) {
  const composer = await findComposer(page);
  if (!composer) throw new LoginRequired(); // composer only exists on a logged-in chat
  await composer.click();
  await page.keyboard.type(brief, { delay: 2 });
  await page.keyboard.press("Enter");
}

// Waits until the page stops changing after our brief marker and returns
// everything rendered after it (the answer; may contain the brief's own
// bubble text — callers may trim it).
async function readAnswerAfter(page, marker) {
  const markerNorm = marker.slice(0, 40).replace(/\s+/g, " ").trim();
  const start = Date.now();
  let last = null;
  let stableSince = 0;
  while (Date.now() - start < DEFAULT_TIMEOUT_MS) {
    await page.waitForTimeout(POLL_MS);
    const body = (await page.evaluate(() => document.body.innerText ?? "")).replace(/\s+/g, " ");
    const i = body.indexOf(markerNorm);
    if (i >= 0) {
      const after = body.slice(i + markerNorm.length).trim();
      if (after && after !== last) {
        last = after;
        stableSince = Date.now();
      } else if (after && Date.now() - stableSince >= STABLE_MS) {
        return after;
      }
    }
  }
  if (last && last.length > 0) return last;
  throw new Error("TIMEOUT: web Copilot didn't finish responding within the window. Retry or run with a larger CEB_TIMEOUT_MS.");
}

async function run(brief, { freshChat }) {
  const page = await getChatPage();
  if (freshChat) await openNewChatIfPossible(page);
  await sendBrief(page, brief);
  LOG(`brief sent to copilot cloud chat (${brief.length} chars)`);
  return await readAnswerAfter(page, brief);
}

export async function delegate(brief, opts = {}) {
  return await run(brief, { freshChat: true, ...opts });
}

export async function followup(brief, opts = {}) {
  return await run(brief, { freshChat: false, ...opts });
}

export { LoginRequired };
