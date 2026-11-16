// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { MockBridgeTransport } from "../src/bridge/mock.js";
import { createLogger } from "../src/logging.js";
import { createCreoMcpServer } from "../src/server.js";
import {
  errorText,
  isErrorResult,
  makeConfig,
  structured,
} from "./helpers.js";

async function connectTestClient(
  bridge: MockBridgeTransport,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = await createCreoMcpServer({
    config: makeConfig(),
    logger: createLogger("silent"),
    bridge,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("Creo MCP server (mock bridge)", () => {
  it("exposes the core tool set", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual(
        [
          "creo_capabilities",
          "creo_get_active_model",
          "creo_get_model_info",
          "creo_get_working_directory",
          "creo_list_models",
          "creo_self_test",
          "creo_status",
        ].sort(),
      );
    } finally {
      await close();
    }
  });

  it("reports offline status", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const result = await client.callTool({
        name: "creo_status",
        arguments: {},
      });
      const payload = structured(result);
      expect(payload["bridge"]).toMatchObject({
        protocolVersion: "1.0",
        connected: false,
      });
      expect(payload["session"]).toMatchObject({ connected: false });
    } finally {
      await close();
    }
  });

  it("auto-attaches to Creo when calling model tools", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const result = await client.callTool({
        name: "creo_get_active_model",
        arguments: {},
      });
      const payload = structured(result);
      expect(payload["connected"]).toBe(true);
      expect(payload["model"]).toMatchObject({
        name: "BRACKET",
        type: "part",
      });
    } finally {
      await close();
    }
  });

  it("returns the working directory and Creo version", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport({ connected: true }),
    );
    try {
      const result = await client.callTool({
        name: "creo_get_working_directory",
        arguments: {},
      });
      expect(structured(result)).toMatchObject({
        connected: true,
        workingDirectory: "C:\\creo-workspace\\demo",
        creoVersion: "9.0.2.0",
      });
    } finally {
      await close();
    }
  });

  it("filters models by type", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport({ connected: true }),
    );
    try {
      const result = await client.callTool({
        name: "creo_list_models",
        arguments: { type: "assembly" },
      });
      const payload = structured(result);
      expect(payload["count"]).toBe(1);
      expect((payload["models"] as { name: string }[])[0]?.name).toBe(
        "GEARBOX",
      );
    } finally {
      await close();
    }
  });

  it("returns structured errors for unknown models", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport({ connected: true }),
    );
    try {
      const result = await client.callTool({
        name: "creo_get_model_info",
        arguments: { name: "MISSING" },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("MODEL_NOT_FOUND");
    } finally {
      await close();
    }
  });

  it("passes self test against the mock bridge", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport({ connected: true }),
    );
    try {
      const result = await client.callTool({
        name: "creo_self_test",
        arguments: {},
      });
      const payload = structured(result);
      expect(payload["ok"]).toBe(true);
      const checks = payload["checks"] as { ok: boolean }[];
      expect(checks.every((check) => check.ok)).toBe(true);
    } finally {
      await close();
    }
  });

  it("describes capabilities and safety mode", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const result = await client.callTool({
        name: "creo_capabilities",
        arguments: {},
      });
      const payload = structured(result);
      expect(payload["safetyMode"]).toBe("read-only");
      expect(payload["packs"]).toEqual(["core"]);
      expect(payload["protocolVersion"]).toBe("1.0");
    } finally {
      await close();
    }
  });
});
