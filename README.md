# Cebulator

Delegation bridge: heavy tasks (big context, deep analysis) get shipped to an
unlimited-token LLM channel; only a compact result comes back to the paid session.

## MVP (current)

`probe.mjs` — minimal MCP server (stdio) with one tool, `cebulator_ping`,
used to verify that clients (GitHub Copilot App, VS Code) can spawn the local
server and call its tools.

## Register the probe

GitHub Copilot App (global config, `~/.copilot/mcp-config.json`, or per-project
`.mcp.json` / `.github/mcp.json`):

```json
{
  "mcpServers": {
    "cebulator-probe": {
      "type": "local",
      "command": "node",
      "args": ["C:\\Dev\\Cebulator\\probe.mjs"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

VS Code (`.vscode/mcp.json` in the workspace):

```json
{
  "servers": {
    "cebulator-probe": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Dev\\Cebulator\\probe.mjs"]
    }
  }
}
```

Then ask the agent in the client: "call the cebulator_ping tool with message 'test'".

## Plan

- [x] probe server (this)
- [ ] `delegate(brief)` tool — drives `copilot.cloud.microsoft/chat` via Playwright
- [ ] `followup(brief)` tool
- [ ] switch (kill switch in `state/`, CLI: on/off)
- [ ] GitHub coding-agent channel (frozen until security unfreezes repo agents)
