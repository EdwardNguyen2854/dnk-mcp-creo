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

const DRAWING_COPY: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "drawing"] },
  safety: { mode: "copy" },
});

async function connectTestClient(
  bridge: MockBridgeTransport,
  config: ResolvedConfig = DRAWING_COPY,
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

async function callDrawing(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return structured(await client.callTool({ name, arguments: args }));
}

describe("drawing pack", () => {
  it("registers drawing tools only when enabled", async () => {
    const core = await connectTestClient(new MockBridgeTransport(), makeConfig());
    try {
      expect((await core.client.listTools()).tools).toHaveLength(7);
    } finally {
      await core.close();
    }

    const drawing = await connectTestClient(new MockBridgeTransport());
    try {
      const names = (await drawing.client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("creo_create_drawing");
      expect(names).toContain("creo_create_projection_view");
      expect(names).toContain("creo_generate_standard_drawing");
      expect(names).toContain("creo_save_drawing");
      expect(names).toHaveLength(21);
    } finally {
      await drawing.close();
    }
  });

  it("creates a unique drawing and blocks unsupported existing-drawing edits in copy mode", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const created = await callDrawing(client, "creo_create_drawing", {
        modelName: "BRACKET",
        drawingName: "BRACKET_2D",
        templateName: "a4.frm",
        save: false,
        viewName: "FRONT",
        locationX: 100,
        locationY: 80,
      });
      expect(created["created"]).toBe(true);
      expect((created["views"] as unknown[])).toHaveLength(1);

      const sheets = await callDrawing(client, "creo_list_drawing_sheets", {
        name: "BRACKET_2D",
      });
      expect(sheets["count"]).toBe(1);

      const views = await callDrawing(client, "creo_list_drawing_views", {
        name: "BRACKET_2D",
      });
      const viewId = (views["views"] as { id: number }[])[0]?.id;
      expect(viewId).toBeTypeOf("number");

      const blocked = await client.callTool({
        name: "creo_create_projection_view",
        arguments: {
          name: "BRACKET_2D",
          parentViewId: viewId,
          sheetNumber: 1,
          locationX: 160,
          locationY: 80,
        },
      });
      expect(isErrorResult(blocked)).toBe(true);
      expect(errorText(blocked)).toContain("SAFE_WRITE_UNAVAILABLE");
    } finally {
      await close();
    }
  });

  it("generates a standard view drawing and blocks standalone save in copy mode", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const created = await callDrawing(client, "creo_generate_standard_drawing", {
        drawingName: "BRACKET_STD",
        templateName: "a4.frm",
        save: false,
        scale: 0.5,
      });
      expect(created["created"]).toBe(true);
      expect(created["saved"]).toBe(false);
      expect(created["exports"]).toEqual([]);
      expect((created["sourceModel"] as { name?: string })?.name).toBe("BRACKET");
      const generatedViews = created["views"] as { model?: { name?: string } }[];
      expect(generatedViews.length).toBeGreaterThanOrEqual(3);
      expect(generatedViews.every((view) => view.model?.name === "BRACKET")).toBe(true);

      const saved = await client.callTool({
        name: "creo_save_drawing",
        arguments: { name: "BRACKET_STD" },
      });
      expect(isErrorResult(saved)).toBe(true);
      expect(errorText(saved)).toContain("SAFE_WRITE_UNAVAILABLE");

      const sheets = await callDrawing(client, "creo_list_drawing_sheets", {
        name: "BRACKET_STD",
      });
      expect(sheets["count"]).toBe(1);
    } finally {
      await close();
    }
  });

  it("rejects PDF/DXF export when the export pack is disabled", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const result = await client.callTool({
        name: "creo_generate_standard_drawing",
        arguments: {
          modelName: "BRACKET",
          drawingName: "BRACKET_STD",
          templateName: "a4.frm",
          pdfFileName: "bracket.pdf",
        },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("export");
    } finally {
      await close();
    }
  });

  it("blocks drawing writes in read-only mode and validates file names", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      makeConfig({ tools: { packs: ["core", "drawing"] } }),
    );
    try {
      const blocked = await client.callTool({
        name: "creo_create_drawing",
        arguments: {
          drawingName: "BRACKET_2D",
          templateName: "a4.frm",
        },
      });
      expect(isErrorResult(blocked)).toBe(true);
      expect(errorText(blocked)).toContain("POLICY_BLOCKED");

      const invalid = await client.callTool({
        name: "creo_create_drawing",
        arguments: {
          drawingName: "BRACKET_2D",
          templateName: "..\\a4.frm",
        },
      });
      expect(isErrorResult(invalid)).toBe(true);
      expect(errorText(invalid)).toContain("POLICY_BLOCKED");
    } finally {
      await close();
    }
  });
});
