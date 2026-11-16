// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { MockBridgeTransport } from "../src/bridge/mock.js";
import type { ModelInfo } from "../src/bridge/protocol.js";
import type { ResolvedConfig } from "../src/config.js";
import { createLogger } from "../src/logging.js";
import { createCreoMcpServer } from "../src/server.js";
import {
  errorText,
  isErrorResult,
  makeConfig,
  structured,
} from "./helpers.js";

const EXPORT_CONFIG_READONLY: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "read", "export"] },
  safety: { mode: "read-only" },
});

const EXPORT_CONFIG_COPY: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "read", "export"] },
  safety: { mode: "copy" },
});

async function connectTestClient(
  bridge: MockBridgeTransport,
  config: ResolvedConfig = EXPORT_CONFIG_COPY,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = await createCreoMcpServer({
    config,
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

async function callExport(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  return structured(result);
}

describe("export pack registration", () => {
  it("registers export tools only when the pack is enabled", async () => {
    const coreOnly = await connectTestClient(
      new MockBridgeTransport(),
      makeConfig(),
    );
    try {
      const { tools } = await coreOnly.client.listTools();
      expect(tools).toHaveLength(7);
    } finally {
      await coreOnly.close();
    }

    const withExport = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const { tools } = await withExport.client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("creo_export_step");
      expect(names).toContain("creo_export_iges");
      expect(names).toContain("creo_export_stl");
      expect(names).toContain("creo_export_pdf");
      expect(names).toContain("creo_export_dxf");
      expect(tools).toHaveLength(26);
    } finally {
      await withExport.close();
    }
  });

  it("marks export tools as session-mutating and not read-only", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const stepAnnotations = byName.get("creo_export_step")?.annotations;
      expect(stepAnnotations?.readOnlyHint).toBe(false);
      expect(stepAnnotations?.destructiveHint).toBe(false);
      expect(stepAnnotations?.idempotentHint).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("export tools succeed under safety.mode = copy", () => {
  it("exports STEP, IGES, and STL with verified paths", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const step = await callExport(client, "creo_export_step", {
        fileName: "bracket.stp",
      });
      expect(step["path"]).toBe("C:\\creo-workspace\\demo\\bracket.stp");
      expect(step["sizeBytes"]).toBeGreaterThan(0);
      expect(step["verified"]).toBe(true);

      const iges = await callExport(client, "creo_export_iges", {
        fileName: "bracket.igs",
      });
      expect(iges["path"]).toBe("C:\\creo-workspace\\demo\\bracket.igs");

      const stl = await callExport(client, "creo_export_stl", {
        fileName: "bracket.stl",
        mode: "binary",
      });
      expect(stl["path"]).toBe("C:\\creo-workspace\\demo\\bracket.stl");
    } finally {
      await close();
    }
  });

  it("exports PDF and DXF for a drawing model", async () => {
    const drawingModel: ModelInfo = {
      name: "BRACKET_DRW",
      type: "drawing",
      fileName: "bracket.drw",
      fullName: "BRACKET_DRW",
      isModified: false,
      isNative: true,
    };
    const { client, close } = await connectTestClient(
      new MockBridgeTransport({
        connected: true,
        models: [drawingModel],
        activeModel: "BRACKET_DRW",
      }),
      EXPORT_CONFIG_COPY,
    );
    try {
      const pdf = await callExport(client, "creo_export_pdf", {
        fileName: "bracket.pdf",
      });
      expect(pdf["path"]).toBe("C:\\creo-workspace\\demo\\bracket.pdf");
      expect(pdf["sizeBytes"]).toBeGreaterThan(0);

      const dxf = await callExport(client, "creo_export_dxf", {
        fileName: "bracket.dxf",
      });
      expect(dxf["path"]).toBe("C:\\creo-workspace\\demo\\bracket.dxf");
    } finally {
      await close();
    }
  });
});

describe("export policy gating", () => {
  it("blocks every export tool when safety.mode = read-only", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_READONLY,
    );
    try {
      const tools = [
        ["creo_export_step", { fileName: "bracket.stp" }],
        ["creo_export_iges", { fileName: "bracket.igs" }],
        ["creo_export_stl", { fileName: "bracket.stl" }],
        ["creo_export_pdf", { fileName: "bracket.pdf" }],
        ["creo_export_dxf", { fileName: "bracket.dxf" }],
      ] as const;
      for (const [name, args] of tools) {
        const result = await client.callTool({ name, arguments: args });
        expect(isErrorResult(result)).toBe(true);
        expect(errorText(result)).toContain("POLICY_BLOCKED");
      }
    } finally {
      await close();
    }
  });
});

describe("export safety validations", () => {
  const cases = [
    "../evil.stp",
    "..\\evil.stp",
    "sub/dir.stp",
    "sub\\dir.stp",
    "C:\\temp\\evil.stp",
    "\\\\server\\share\\evil.stp",
    ".hidden.stp",
    "no-extension",
  ];

  it.each(cases)(
    "rejects unsafe fileName %s via creo_export_step",
    async (fileName) => {
      const { client, close } = await connectTestClient(
        new MockBridgeTransport(),
        EXPORT_CONFIG_COPY,
      );
      try {
        const result = await client.callTool({
          name: "creo_export_step",
          arguments: { fileName },
        });
        expect(isErrorResult(result)).toBe(true);
        expect(errorText(result)).toContain("INVALID_ARGUMENT");
      } finally {
        await close();
      }
    },
  );

  it("rejects fileName when missing", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const result = await client.callTool({
        name: "creo_export_step",
        arguments: {},
      });
      expect(isErrorResult(result)).toBe(true);
      const text = errorText(result);
      expect(text.includes("INVALID_ARGUMENT") || text.includes("fileName")).toBe(
        true,
      );
    } finally {
      await close();
    }
  });

  it("refuses to overwrite an existing file without the flag", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const first = await callExport(client, "creo_export_step", {
        fileName: "bracket.stp",
      });
      expect(first["verified"]).toBe(true);

      const refused = await client.callTool({
        name: "creo_export_step",
        arguments: { fileName: "bracket.stp" },
      });
      expect(isErrorResult(refused)).toBe(true);
      expect(errorText(refused)).toContain("FILE_EXISTS");

      const replaced = await callExport(client, "creo_export_step", {
        fileName: "bracket.stp",
        overwrite: true,
      });
      expect(replaced["verified"]).toBe(true);
    } finally {
      await close();
    }
  });

  it("rejects STL on a non-solid model", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const result = await client.callTool({
        name: "creo_export_stl",
        arguments: { fileName: "gearbox.stl", name: "GEARBOX" },
      });
      expect(isErrorResult(result)).toBe(true);
      const text = errorText(result);
      expect(text.includes("INVALID_ARGUMENT") || text.includes("part")).toBe(
        true,
      );
    } finally {
      await close();
    }
  });

  it("rejects DXF on a non-drawing model", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const result = await client.callTool({
        name: "creo_export_dxf",
        arguments: { fileName: "bracket.dxf" },
      });
      expect(isErrorResult(result)).toBe(true);
      const text = errorText(result);
      expect(text).toContain("INVALID_ARGUMENT");
      expect(text).toContain("drawing");
    } finally {
      await close();
    }
  });

  it("rejects PDF on a non-drawing model", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const result = await client.callTool({
        name: "creo_export_pdf",
        arguments: { fileName: "bracket.pdf" },
      });
      expect(isErrorResult(result)).toBe(true);
      const text = errorText(result);
      expect(text).toContain("INVALID_ARGUMENT");
      expect(text).toContain("drawing");
    } finally {
      await close();
    }
  });

  it("rejects unknown STL mode", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      EXPORT_CONFIG_COPY,
    );
    try {
      const result = await client.callTool({
        name: "creo_export_stl",
        arguments: { fileName: "bracket.stl", mode: "raw" },
      });
      expect(isErrorResult(result)).toBe(true);
      const text = errorText(result);
      expect(text.includes("INVALID_ARGUMENT") || text.includes("ascii")).toBe(
        true,
      );
    } finally {
      await close();
    }
  });
});
