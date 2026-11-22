// Cebulator MCP server (stdio). The main server, exposing delegation tools
// to any MCP-capable client (GitHub Copilot App, VS Code, CLI).
//
//   cebulator_ping      - diagnostic
//   cebulator_switch    - turn the kill switch on/off
//   cebulator_status    - switch state + recent activity
//   cebulator_delegate  - send a fresh task to web Copilot (new chat)
//   cebulator_followup  - continue the latest web Copilot thread
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readSwitch, setSwitch, LOG } from "./src/switch.mjs";
import { delegate, followup, closeBrowser, LoginRequired } from "./src/browser.mjs";

const CHAT_TIMEOUT_MS = Number(process.env.CEB_TIMEOUT_MS ?? 180_000);
const RESULT_CAP = 12_000;

const BRIEF_TIMEOUT_NOTE =
  `Expect a slow call (up to ~${Math.round(CHAT_TIMEOUT_MS / 1000)}s): ` +
  "web Copilot replies take tens of seconds, sometimes longer.";

const server = new McpServer({ name: "cebulator", version: "0.1.0" });

function ok(text) {
  return { content: [{ type: "text", text }] };
}

function fail(text) {
  return { content: [{ type: "text", text }], isError: true };
}

// Returns a fail result when the switch is off, otherwise null (go ahead).
function switchGate() {
  if (readSwitch() !== "on") {
    return fail(
      "Cebulator is OFF (switch=off). Enable it with cebulator_switch (state: \"on\") first; " +
        "no task will be delegated until it is on."
    );
  }
  return null;
}

function translateError(e) {
  if (e instanceof LoginRequired) {
    return (
      "Web Copilot is NOT LOGGED IN (state/profile has no session). " +
      "Run `npm run login` from C:\\Dev\\Cebulator in a terminal, sign in manually in the " +
      "window that opens (once; cookies persist), then retry. If it keeps failing, delete " +
      "the state/profile folder and log in again."
    );
  }
  return String(e?.message ?? e);
}

function capResult(text) {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  if (s.length <= RESULT_CAP) return s;
  return s.slice(0, RESULT_CAP) +
    "\n[TRUNCATED: result exceeded the return window — ask for a shorter summary via cebulator_followup]";
}

server.registerTool(
  "cebulator_ping",
  {
    title: "Cebulator ping",
    description:
      "Diagnostic: confirms the client can see the Cebulator server and that tool calls round-trip.",
    inputSchema: { message: z.string().optional() },
  },
  async ({ message }) => ok(`cebulator received: ${message ?? "ping"}`)
);

server.registerTool(
  "cebulator_switch",
  {
    title: "Cebulator switch on/off",
    description:
      "Kill switch. \"on\" allows delegating tasks; \"off\" (default) blocks them entirely.",
    inputSchema: { state: z.enum(["on", "off"]).describe("New switch state") },
  },
  async ({ state }) => {
    const v = setSwitch(state);
    LOG(`switch -> ${v}`);
    return ok(`cebulator: switch=${v}`);
  }
);

server.registerTool(
  "cebulator_status",
  {
    title: "Cebulator status",
    description: "Current switch state and the most recent log lines.",
    inputSchema: {},
  },
  async () => {
    const { readFileSync } = await import("node:fs");
    let tail = "";
    try {
      tail = readFileSync(new URL("../state/log.txt", import.meta.url), "utf8")
        .trim().split("\n").slice(-5).join("\n");
    } catch { tail = "(no log)"; }
    return ok(`switch=${readSwitch()}\n\nRecent log:\n${tail}`);
  }
);

server.registerTool(
  "cebulator_delegate",
  {
    title: "Cebulator: delegate a task",
    description:
      "Send a compact brief to the (unlimited-token) web Copilot in a NEW chat and get a compact answer back. " +
      BRIEF_TIMEOUT_NOTE,
    inputSchema: {
      brief: z
        .string()
        .min(20)
        .describe(
          "Compact task brief: GOAL + ATTACHMENTS (distilled code/text, no raw dumps) + " +
            "QUALITY CRITERIA (max length, format). Keep it under ~800 words."
        ),
    },
  },
  async ({ brief }) => {
    const gate = switchGate();
    if (gate) return gate;
    try {
      LOG(`delegate (${brief.length} chars)`);
      const result = capResult(await delegate(brief));
      return ok(result);
    } catch (e) {
      LOG(`delegate FAILED: ${e?.message ?? e}`);
      return fail(`Delegation failed: ${translateError(e)}`);
    } finally {
      await closeBrowser();
    }
  }
);

server.registerTool(
  "cebulator_followup",
  {
    title: "Cebulator: follow up",
    description:
      "Continue the most recent web Copilot thread (chat history is kept — pass only the new " +
      "question in the brief, do not re-send context). " + BRIEF_TIMEOUT_NOTE,
    inputSchema: { brief: z.string().min(5) },
  },
  async ({ brief }) => {
    const gate = switchGate();
    if (gate) return gate;
    try {
      LOG(`followup (${brief.length} chars)`);
      const result = capResult(await followup(brief));
      return ok(result);
    } catch (e) {
      LOG(`followup FAILED: ${e?.message ?? e}`);
      return fail(`Follow-up failed: ${translateError(e)}`);
    } finally {
      await closeBrowser();
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
LOG("server connected (stdio)");

process.on("SIGINT", () => { closeBrowser().then(() => process.exit(0)); });
process.on("SIGTERM", () => { closeBrowser().then(() => process.exit(0)); });
