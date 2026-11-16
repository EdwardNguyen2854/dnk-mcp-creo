# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// End-to-end check: MCP client (SDK) -> dnk-mcp-creo server -> native bridge -> Creo.
//
// Usage (from the repository root, with Creo running):
//   node scripts/mcp-live-check.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["packages/server/dist/index.js"],
  env: {
    DNK_MCP_CREO_LOG_LEVEL: "warn",
  },
});

const client = new Client({ name: "mcp-live-check", version: "1.0.0" });

function show(label, value) {
  console.log(`\n== ${label} ==`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

try {
  await client.connect(transport);

  const tools = await client.listTools();
  show(
    "tools",
    tools.tools.map((tool) => `${tool.name} (readOnly=${tool.annotations?.readOnlyHint})`),
  );

  const status = await client.callTool({ name: "creo_status", arguments: {} });
  show("creo_status", status.structuredContent);

  const models = await client.callTool({ name: "creo_list_models", arguments: {} });
  show("creo_list_models", models.structuredContent);

  const active = await client.callTool({ name: "creo_get_active_model", arguments: {} });
  show("creo_get_active_model", active.structuredContent);

  const hasReadPack = tools.tools.some((tool) => tool.name === "creo_get_features");
  let readPackOk = true;
  if (hasReadPack) {
    if (active.structuredContent?.model) {
      const features = await client.callTool({ name: "creo_get_features", arguments: {} });
      show("creo_get_features", {
        count: features.structuredContent?.count,
      });
      readPackOk = features.structuredContent?.count > 0;
    } else {
      console.log("\n[--] read pack enabled but no active model to read");
    }
  }

  const selfTest = await client.callTool({ name: "creo_self_test", arguments: {} });
  show("creo_self_test", selfTest.structuredContent);

  const ok = selfTest.structuredContent?.ok === true && readPackOk;
  console.log(`\n${ok ? "MCP_LIVE_OK" : "MCP_LIVE_FAILED"}`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(`\nMCP_LIVE_FAILED: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
