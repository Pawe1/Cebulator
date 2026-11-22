// Cebulator probe — minimal MCP server (stdio) to validate that the
// GitHub Copilot App can spawn a local server and call its tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "cebulator-probe",
  version: "0.0.1",
});

server.registerTool(
  "cebulator_ping",
  {
    title: "Cebulator ping",
    description:
      "Probe tool. Call it to verify the Cebulator MCP server is reachable. Returns a fixed acknowledgement string.",
    inputSchema: {
      message: z.string().optional().describe("Optional message to echo back"),
    },
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: `cebulator received: ${message ?? "ping"}`,
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
