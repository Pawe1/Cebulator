// Browser layer: drives copilot.cloud.microsoft/chat through Playwright
// with a persistent local profile (one-time human login, then headless).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { LOG } from "./switch.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const profileDir = path.join(ROOT, "state", "profile");
export const CHAT_URL = "https://copilot.cloud.microsoft/chat";
const DEFAULT_TIMEOUT_MS = Number(process.env.CEB_TIMEOUT_MS ?? 180_000);
const POLL_MS = 2_000;
const STABLE_MS = 10_000;
const HEADLESS = process.env.CEB_HEADLESS === "1";
// Default: drive the real Chrome installed on the machine (no separate
// browser download needed). Set CEB_CHANNEL=chromium to use Playwright's
// own build instead (requires `npx playwright install chromium`).
const CHANNEL = process.env.CEB_CHANNEL === "chromium" ? undefined : "chrome";

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
    ctxPromise = chromium
      .launchPersistentContext(profileDir, {
        headless: HEADLESS,
        channel: CHANNEL,
        viewport: { width: 1440, height: 900 },
      })
      .catch((e) => {
        const msg = String(e?.message ?? e);
        if (CHANNEL && /executable doesn't exist|browserType\.launch/i.test(msg)) {
          throw new Error(
            "Chrome was not found on this machine. Either install Chrome, or set " +
              "CEB_CHANNEL=chromium and run `npx playwright install chromium` once."
          );
        }
        throw e;
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

// Returns a chat page with a ready composer; throws LoginRequired if the
// profile genuinely lacks a session.
//
// NOTE: even for a logged-in profile, M365 performs a short single-sign-on
// dance (a brief bounce to the identity wall, then back to /chat). So we do
// NOT treat a single instant login-looking URL as a failure — we wait for
// the composer to appear; only a wall that never clears means manual login.
async function getChatPage() {
  const ctx = await getCtx();
  const page =
    ctx.pages().find((p) => p.url().includes("cloud.microsoft.com")) ??
    (await ctx.newPage());

  if (!page.url().includes("cloud.microsoft.com")) {
    await page
      .goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
      .catch(() => {});
  }

  const deadline = Date.now() + Number(process.env.CEB_LOGIN_SETTLE_MS ?? 90_000);
  let wallSince = 0;
  while (Date.now() < deadline) {
    const onWall = isLoginWall(page.url());
    const composer = onWall ? null : await findComposer(page);
    if (composer) return page;
    if (onWall) {
      wallSince = wallSince || Date.now();
      if (Date.now() - wallSince > 30_000) throw new LoginRequired();
    } else {
      wallSince = 0;
    }
    await page.waitForTimeout(1_500);
  }
  throw new LoginRequired();
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
async function readAnswerAfter(page, brief) {
  // Whitespace-tolerant match for the first words of our brief — the spot
  // where our own sent message rendered. Everything AFTER it (raw, with
  // line structure kept) is the answer region to wait for and extract.
  const words = brief.slice(0, 40).replace(/\s+/g, " ").trim().split(" ");
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(words.map(esc).join("\\s+"));
  const start = Date.now();
  let lastRaw = null;
  let stableSince = 0;
  while (Date.now() - start < DEFAULT_TIMEOUT_MS) {
    await page.waitForTimeout(POLL_MS);
    const raw = await page.evaluate(() => document.body.innerText ?? "");
    const m = raw.match(re);
    if (m) {
      const after = raw.slice(m.index + m[0].length).replace(/\u200b/g, "").trim();
      // Wait for the actual reply marker — the region right after our sent
      // message is "stable" (contains only our echo) until Copilot answers,
      // so stability alone is not a completion signal.
      if (REPLY_MARKER.test(after)) {
        if (after !== lastRaw) {
          lastRaw = after;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= STABLE_MS) {
          return after;
        }
      }
    }
  }
  if (lastRaw && lastRaw.length > 0) return lastRaw;
  throw new Error("TIMEOUT: web Copilot didn't finish responding within the window. Retry or run with a larger CEB_TIMEOUT_MS.");
}

// Phrases that begin platform chrome after the real answer (suggested
// follow-up questions, composer label, disclaimer). The last line of the
// reply region that starts with one of these is where the model's reply ends.
const STOP_MARKERS = /^(copilot said|message copilot|ai-generated content|give me|draft (the|a)|show (the|me)|explain the|list the|compare |help me|suggested)$/i;

// Marker the UI renders before the model's reply bubble.
const REPLY_MARKER = /copilot said\s*:/i;

// Cut the platform chrome off the raw region: the model's reply begins after
// the "Copilot said:" marker (which also drops the echo of our own brief);
// the tail (suggested follow-ups, composer label, disclaimer) is trimmed
// from the bottom line-wise.
function cleanAnswer(text) {
  let t = String(text ?? "").replace(/\u200b/g, "");
  const m = t.match(REPLY_MARKER);
  if (m) t = t.slice(m.index + m[0].length);
  const lines = t.split(/\r?\n/).map((l) => l.trim());
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) { end = i; continue; }
    if (STOP_MARKERS.test(lines[i])) { end = i; break; }
  }
  return lines.slice(0, end).join("\n").trim();
}

async function run(brief, { freshChat }) {
  const page = await getChatPage();
  if (freshChat) await openNewChatIfPossible(page);
  await sendBrief(page, brief);
  LOG(`brief sent to copilot cloud chat (${brief.length} chars)`);
  const raw = await readAnswerAfter(page, brief);
  return cleanAnswer(raw);
}

export async function delegate(brief, opts = {}) {
  return await run(brief, { freshChat: true, ...opts });
}

export async function followup(brief, opts = {}) {
  return await run(brief, { freshChat: false, ...opts });
}

export { LoginRequired };
