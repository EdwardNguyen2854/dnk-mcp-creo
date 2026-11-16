// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { MockBridgeTransport } from "../src/bridge/mock.js";
import type { ResolvedConfig } from "../src/config.js";
import { createLogger } from "../src/logging.js";
import { createCreoMcpServer } from "../src/server.js";
import { errorText, isErrorResult, makeConfig, structured } from "./helpers.js";

const MODELING_COPY: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "modeling"] },
  safety: { mode: "copy", parameterAllowlist: ["WIDTH"] },
});

async function connectTestClient(
  bridge: MockBridgeTransport,
  config: ResolvedConfig = MODELING_COPY,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = await createCreoMcpServer({
    config,
    logger: createLogger("silent"),
    bridge,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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

async function callModeling(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return structured(await client.callTool({ name, arguments: args }));
}

describe("modeling pack", () => {
  it("registers modeling tools only when enabled", async () => {
    const core = await connectTestClient(new MockBridgeTransport(), makeConfig());
    try {
      expect((await core.client.listTools()).tools).toHaveLength(7);
    } finally {
      await core.close();
    }

    const modeling = await connectTestClient(new MockBridgeTransport());
    try {
      const names = (await modeling.client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("creo_set_parameter");
      expect(names).toContain("creo_delete_features");
      expect(names).toContain("creo_create_part");
      expect(names).toContain("creo_create_part_from_template");
      expect(names).toContain("creo_assemble_component");
      expect(names).toHaveLength(21);
    } finally {
      await modeling.close();
    }
  });

  it("writes parameters and dimensions with readback", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const parameter = await callModeling(client, "creo_set_parameter", {
        paramName: "WIDTH",
        expectedOldValue: { type: "double", value: 120 },
        value: 135,
      });
      expect(parameter["verified"]).toBe(true);
      expect((parameter["parameter"] as { value: { value: number } }).value.value).toBe(135);

      const dimension = await callModeling(client, "creo_set_dimension", {
        dimensionId: 10,
        expectedOldValue: 120,
        value: 135,
      });
      expect(dimension["verified"]).toBe(true);
      expect((dimension["dimension"] as { value: number }).value).toBe(135);
    } finally {
      await close();
    }
  });

  it("supports lifecycle and feature operations", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      expect((await callModeling(client, "creo_save_model"))["verified"]).toBe(true);
      expect(
        (await callModeling(client, "creo_copy_model", { newName: "BRACKET_COPY" }))["verified"],
      ).toBe(true);
      expect(
        (await callModeling(client, "creo_suppress_features", { featureIds: [4] }))["verified"],
      ).toBe(true);
      expect(
        (await callModeling(client, "creo_resume_features", { featureIds: [4] }))["verified"],
      ).toBe(true);
      expect(
        (await callModeling(client, "creo_reorder_feature", {
          featureId: 4,
          referenceFeatureId: 3,
        }))["verified"],
      ).toBe(true);
    } finally {
      await close();
    }
  });

  it("assembles components into an assembly", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const created = await callModeling(client, "creo_create_assembly", {
        modelName: "MCP_ASM",
      });
      expect(created["verified"]).toBe(true);
      expect((created["model"] as { type: string }).type).toBe("assembly");

      const part = await callModeling(client, "creo_create_part", {
        modelName: "MCP_ASM_PART",
      });
      expect(part["verified"]).toBe(true);

      const assembled = await callModeling(client, "creo_assemble_component", {
        name: "MCP_ASM",
        component: "MCP_ASM_PART",
        x: 100,
      });
      expect(assembled["verified"]).toBe(true);
      expect((assembled["feature"] as { type: string }).type).toBe("Component");
      expect((assembled["component"] as { name: string }).name).toBe("MCP_ASM_PART");
      expect((assembled["features"] as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("creates a part from a whitelisted template", async () => {
    const base = makeConfig();
    const config = makeConfig({
      creo: { ...base.creo, installDir: "C:\\PTC\\Creo 9.0.2.0" },
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      config,
    );
    try {
      const created = await callModeling(
        client,
        "creo_create_part_from_template",
        { modelName: "MCP_BRACKET", template: "mmns_part_solid_abs.prt" },
      );
      expect(created["verified"]).toBe(true);
      expect(created["template"]).toBe("mmns_part_solid_abs.prt");
      expect((created["model"] as { name: string }).name).toBe("MCP_BRACKET");

      const again = await client.callTool({
        name: "creo_create_part_from_template",
        arguments: { modelName: "MCP_BRACKET" },
      });
      expect(isErrorResult(again)).toBe(true);
      expect(errorText(again)).toContain("already");
    } finally {
      await close();
    }
  });

  it("refuses templates without a configured Creo install directory", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      config,
    );
    try {
      const result = await client.callTool({
        name: "creo_create_part_from_template",
        arguments: { modelName: "MCP_NO_INSTALL" },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("install directory");
    } finally {
      await close();
    }
  });

  it("blocks modeling writes in read-only mode", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      makeConfig({ tools: { packs: ["core", "modeling"] } }),
    );
    try {
      const result = await client.callTool({
        name: "creo_set_parameter",
        arguments: { paramName: "WIDTH", expectedOldValue: 120, value: 130 },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("POLICY_BLOCKED");
    } finally {
      await close();
    }
  });
});
