// Smoke test: spawn probe.mjs as a child process and exercise one tool
// call through the real MCP handshake. Run: node test/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "probe.mjs");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});

const client = new Client({ name: "cebulator-smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
const ping = tools.tools.find((t) => t.name === "cebulator_ping");
if (!ping) throw new Error("cebulator_ping not found in tool list");

const result = await client.callTool({ name: "cebulator_ping", arguments: { message: "smoke-test" } });
const text = result.content.map((c) => c.text).join(" ");
console.log(`OK tools: ${tools.tools.map((t) => t.name).join(", ")}`);
console.log(`OK cebulator_ping -> ${text}`);

await client.close();
process.exit(0);
