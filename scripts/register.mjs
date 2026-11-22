// Registers the Cebulator MCP server into the GitHub Copilot App config
// (~/.copilot/mcp-config.json) — idempotent, preserves other servers.
//   npm run register            -> global config (~/.copilot/mcp-config.json)
//   npm run register:project    -> per-project .mcp.json in the repo root
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectMode = process.argv.includes("--project");
const cfgPath = projectMode
  ? path.join(root, ".mcp.json")
  : path.join(os.homedir(), ".copilot", "mcp-config.json");

const entry = {
  type: "local",
  command: process.execPath, // absolute node path, robust in any PATH
  args: [path.join(root, "server.mjs")],
  env: {},
  tools: ["*"],
};

let cfg = { mcpServers: {} };
if (fs.existsSync(cfgPath)) {
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (e) {
    console.error(`Existing ${cfgPath} is not valid JSON; not touching it.`);
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
cfg.mcpServers ??= {};

// Remove stale duplicate registrations (e.g. an old hand-pasted "Cebulator"
// entry) that point at the same server file. Case-insensitive match, but only
// when the entry points at our server.mjs.
for (const name of Object.keys(cfg.mcpServers)) {
  if (name !== "cebulator") {
    const other = cfg.mcpServers[name];
    if (other && Array.isArray(other.args) && other.args.some((a) => /server\.mjs$/i.test(String(a)))) {
      delete cfg.mcpServers[name];
      console.log(`Removed stale duplicate entry "${name}" (points to server.mjs).`);
    }
  }
}

const changed = JSON.stringify(cfg.mcpServers["cebulator"] ?? null) !== JSON.stringify(entry);
cfg.mcpServers["cebulator"] = entry;

fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

console.log(changed ? `Registered 'cebulator' in ${cfgPath}` : `'cebulator' already up to date in ${cfgPath}`);
console.log("Restart the client (GitHub Copilot App / VS Code) to pick up the server.");
