# Cebulator

Delegation bridge for coding agents. Heavy tasks (large inputs, small
outputs) get shipped to an unlimited-token LLM channel; only the compact
result comes back to the paid IDE session.

```
[any MCP-capable client]              GitHub Copilot App / VS Code / CLI
        |
        |  stdio (the client owns the process)
        v
+----------------------------------------------+
|  server.mjs  (Node, MCP stdio server)        |
|                                              |
|    cebulator_ping      diagnostic            |
|    cebulator_switch    kill switch on/off    |
|    cebulator_status    switch + log tail     |
|    cebulator_delegate  new chat + brief      |
|    cebulator_followup  continue thread       |
|                                              |
|  kill switch: state/switch.txt (off default) |
+---------------+------------------------------+
                |  Playwright over a persistent
                |  Chrome profile (one-time manual login)
                v
      [copilot.cloud.microsoft/chat]
      the unlimited-token channel; heavy inference happens there
                |
                v
      compact answer -> back to the client
```

License: Apache 2.0. Full design, channel status and risks: `docs/NOTES.md`.

## Quickstart

```powershell
cd C:\Dev\Cebulator
npm install

# 1) One-time login to the target web chat (a window opens; sign in; it
#    closes itself). Cookies persist in state/profile.
npm run login

# 2) Register the server with your client (idempotent, preserves other entries):
npm run register              # GitHub Copilot App:  ~/.copilot/mcp-config.json
npm run register:project      # per repo:            ./.mcp.json

# 3) Restart the client, then in chat:
#    "turn cebulator on"            -> cebulator_switch(on)
#    "use cebulator_delegate: ..."  -> the heavy task runs over there
```

By default the automation drives the Chrome installed on the machine
(`channel: "chrome"`). No system Chrome? Set `CEB_CHANNEL=chromium` and run
`npx playwright install chromium` once.

Verify without a browser:

```powershell
npm run smoke        # original probe server (first MVP, kept for history)
npm run smoke:server # full server: tool surface + kill switch gate, offline
```

## Tools

| Tool | Purpose |
|------|---------|
| `cebulator_ping` | Diagnostic round-trip. |
| `cebulator_switch(state)` | Kill switch. `off` (default) hard-blocks all delegation: the server answers "Cebulator is OFF" and runs nothing. |
| `cebulator_status` | Switch state + last 5 log lines (`state/log.txt`). |
| `cebulator_delegate(brief)` | Opens web Copilot (new chat when possible), sends the brief, waits for the answer, returns compact text. Long tool call: expect up to ~3 min. |
| `cebulator_followup(brief)` | Continues the latest thread. Chat history is kept in the browser, so pass only the new question, no re-sent context. |

Brief convention: **GOAL + ATTACHMENTS (distilled, no raw dumps) + QUALITY
CRITERIA (max length, format)**. Keep it under ~800 words.

## Configuration (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `CEB_HEADLESS` | unset | `1` runs the browser headless (only makes sense after `npm run login`). |
| `CEB_TIMEOUT_MS` | `180000` | Max wait for the web answer (ms). |
| `CEB_CHANNEL` | `chrome` | Browser channel: system Chrome, or `chromium` for Playwright's own build. |

## Layout

```
server.mjs           main MCP server (stdio) — what clients register
probe.mjs            original probe-only server (first MVP, kept on purpose)
login.mjs            one-time interactive login (visible window)
src/browser.mjs      Playwright layer: composer, send, answer extraction
src/switch.mjs       kill switch + local debug log
scripts/register.mjs idempotent client registration (~/.copilot or ./.mcp.json)
test/                offline smoke tests (no browser involved)
docs/NOTES.md        design decisions, channel status, risks
```

## Plan

- [x] probe server, validated in GitHub Copilot App
- [x] main server: `delegate` / `followup` / `switch` / `status` (Playwright channel)
- [x] scripted registration (`npm run register`), no more hand-pasted JSON
- [ ] end-to-end validation with a real task from the desktop app
- [ ] DOM fallback polish (screenshot + "awaiting human" status on selector breakage)
- [ ] GitHub coding-agent channel (frozen until security unfreezes repo agents)
