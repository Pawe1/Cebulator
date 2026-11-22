// Offline smoke test for the main server: spawn it, verify the tool
// surface, and confirm the kill switch hard-blocks delegation (no browser
// may launch). Run: npm run smoke:server
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverPath = path.join(ROOT, "server.mjs");
const switchFile = path.join(ROOT, "state", "switch.txt");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});
const client = new Client({ name: "cebulator-server-smoke", version: "0.0.1" });
await client.connect(transport);

// Remember and enforce switch=off so no browser can launch.
const prevSwitch = fs.existsSync(switchFile) ? fs.readFileSync(switchFile, "utf8").trim() : "off";
fs.writeFileSync(switchFile, "off\n");

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures += 1;
}

try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const expected = [
    "cebulator_delegate",
    "cebulator_followup",
    "cebulator_ping",
    "cebulator_status",
    "cebulator_switch",
  ].sort();
  check("tool surface", JSON.stringify(tools) === JSON.stringify(expected), tools.join(", "));

  const ping = (await client.callTool({ name: "cebulator_ping", arguments: { message: "s-smoke" } })).content[0].text;
  check("ping", ping === "cebulator received: s-smoke", ping);

  const del = await client.callTool({
    name: "cebulator_delegate",
    arguments: { brief: "Smoke-test brief that must be rejected by the kill switch." },
  });
  check(
    "delegate blocked while switch=off",
    del.isError === true && /OFF/i.test(del.content[0].text),
    del.content[0].text
  );
} finally {
  fs.writeFileSync(switchFile, prevSwitch ? prevSwitch + "\n" : "off\n");
  await client.close();
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
