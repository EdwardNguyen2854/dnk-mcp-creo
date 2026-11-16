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

const READ_CONFIG: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "read"] },
});

async function connectTestClient(
  bridge: MockBridgeTransport,
  config: ResolvedConfig = READ_CONFIG,
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

async function callRead(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  return structured(result);
}

describe("read pack registration", () => {
  it("registers read tools only when the pack is enabled", async () => {
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

    const withRead = await connectTestClient(new MockBridgeTransport());
    try {
      const { tools } = await withRead.client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("creo_get_parameters");
      expect(names).toContain("creo_open_model");
      expect(names).toContain("creo_close_model");
      expect(names).toHaveLength(21);
    } finally {
      await withRead.close();
    }
  });

  it("marks read tools as read-only and open/close as session-mutating", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(byName.get("creo_get_parameters")?.annotations?.readOnlyHint).toBe(
        true,
      );
      expect(byName.get("creo_open_model")?.annotations?.readOnlyHint).toBe(
        false,
      );
      expect(byName.get("creo_close_model")?.annotations?.destructiveHint).toBe(
        true,
      );
    } finally {
      await close();
    }
  });
});

describe("read tools (mock bridge)", () => {
  it("returns parameters with typed values and flags", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_parameters");
      expect(payload["count"]).toBe(4);
      const parameters = payload["parameters"] as {
        name: string;
        value: { type: string; value: unknown };
        isRelationDriven: boolean;
      }[];
      const width = parameters.find((p) => p.name === "WIDTH");
      expect(width?.value).toEqual({ type: "double", value: 120 });
      const height = parameters.find((p) => p.name === "HEIGHT");
      expect(height?.isRelationDriven).toBe(true);
    } finally {
      await close();
    }
  });

  it("returns dimensions with symbols and relation flags", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_dimensions");
      expect(payload["count"]).toBe(3);
      const dimensions = payload["dimensions"] as {
        symbol: string;
        isRelationDriven: boolean;
        tolerance: string | null;
      }[];
      const d1 = dimensions.find((d) => d.symbol === "d1");
      expect(d1?.isRelationDriven).toBe(true);
      const d0 = dimensions.find((d) => d.symbol === "d0");
      expect(d0?.tolerance).toBe("plus_minus");
    } finally {
      await close();
    }
  });

  it("returns the feature tree with suppression status", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_features");
      expect(payload["count"]).toBe(4);
      const features = payload["features"] as {
        name?: string;
        status: string;
        parentIds: number[];
        childIds: number[];
      }[];
      const round = features.find((f) => f.name === "Round 1");
      expect(round?.status).toBe("suppressed");
      const extrude = features.find((f) => f.name === "Extrude 1");
      expect(extrude?.parentIds).toEqual([1]);
      expect(extrude?.childIds).toEqual([3, 4]);
    } finally {
      await close();
    }
  });

  it("returns relation text lines", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_relations");
      expect(payload["count"]).toBe(2);
      expect(payload["relations"]).toContain("d1 = d0 / 2");
    } finally {
      await close();
    }
  });

  it("returns mass properties for the active model", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_mass_properties");
      const props = payload["massProperties"] as {
        volume: number;
        mass: number;
        gravityCenter: number[];
      };
      expect(props.volume).toBeGreaterThan(0);
      expect(props.mass).toBeGreaterThan(0);
      expect(props.gravityCenter).toHaveLength(3);
    } finally {
      await close();
    }
  });

  it("returns materials for parts and reports unsupported for assemblies", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const partPayload = await callRead(client, "creo_get_materials");
      expect(partPayload["supported"]).toBe(true);
      const current = partPayload["currentMaterial"] as { name: string };
      expect(current.name).toBe("STEEL");

      const assemblyPayload = await callRead(client, "creo_get_materials", {
        name: "GEARBOX",
      });
      expect(assemblyPayload["supported"]).toBe(false);
      expect(assemblyPayload["materials"]).toEqual([]);
    } finally {
      await close();
    }
  });

  it("returns layers with display status", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_layers");
      expect(payload["count"]).toBe(3);
      const layers = payload["layers"] as { name: string; status: string }[];
      expect(layers.find((l) => l.name === "HIDDEN_STUFF")?.status).toBe(
        "hidden",
      );
    } finally {
      await close();
    }
  });

  it("returns the principal unit system", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_units");
      const units = payload["units"] as {
        name: string;
        units: Record<string, { name: string }>;
      };
      expect(units.name).toContain("Millimeter");
      expect(units.units["length"]?.name).toBe("mm");
    } finally {
      await close();
    }
  });

  it("returns geometry outline and counts", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_get_geometry");
      const geometry = payload["geometry"] as {
        outline: { min: number[]; max: number[] };
        counts: { surfaces: number; edges: number; bodies: number };
      };
      expect(geometry.outline.min).toEqual([-60, -40, 0]);
      expect(geometry.outline.max).toEqual([60, 40, 12]);
      expect(geometry.counts.bodies).toBe(1);
    } finally {
      await close();
    }
  });

  it("lists edges and surfaces for reference-aware tools", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const edges = await callRead(client, "creo_get_edges");
      expect(edges["count"]).toBe(12);
      const list = edges["edges"] as {
        id: number;
        edgeTypeName?: string;
        start?: number[];
        featureName?: string;
      }[];
      expect(list.some((edge) => edge.edgeTypeName === "line")).toBe(true);
      expect(list.every((edge) => edge.start?.length === 3)).toBe(true);
      expect(list[0]?.featureName).toBe("Extrude 1");

      const filtered = await callRead(client, "creo_get_edges", {
        ids: [list[0]?.id],
      });
      expect(filtered["count"]).toBe(1);
      expect((filtered["edges"] as { id: number }[])[0]?.id).toBe(list[0]?.id);

      const surfaces = await callRead(client, "creo_get_surfaces");
      const surfaceList = surfaces["surfaces"] as {
        id: number;
        featureName?: string;
      }[];
      const datumNames = surfaceList.map((surface) => surface.featureName);
      expect(datumNames).toContain("TOP");
      expect(datumNames).toContain("FRONT");
      expect(surfaces["count"]).toBe(surfaceList.length);
    } finally {
      await close();
    }
  });

  it("returns family tables and null when absent", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const bracket = await callRead(client, "creo_get_family_table");
      expect(bracket["hasFamilyTable"]).toBe(true);
      const table = bracket["familyTable"] as {
        columns: { symbol: string }[];
        rows: { instanceName: string }[];
      };
      expect(table.columns.map((c) => c.symbol)).toEqual([
        "WIDTH",
        "MATERIAL",
      ]);
      expect(table.rows.map((r) => r.instanceName)).toContain("BRACKET_A");

      const gearbox = await callRead(client, "creo_get_family_table", {
        name: "GEARBOX",
      });
      expect(gearbox["hasFamilyTable"]).toBe(false);
      expect(gearbox["familyTable"]).toBeNull();
    } finally {
      await close();
    }
  });
});

describe("model.open containment", () => {
  it("opens a plain file name and reports already-open models", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const opened = await callRead(client, "creo_open_model", {
        fileName: "cover.prt",
      });
      expect(opened["opened"]).toBe(true);
      expect(opened["alreadyOpen"]).toBe(false);
      expect((opened["model"] as { name: string }).name).toBe("COVER");

      const again = await callRead(client, "creo_open_model", {
        fileName: "bracket.prt",
      });
      expect(again["opened"]).toBe(false);
      expect(again["alreadyOpen"]).toBe(true);
    } finally {
      await close();
    }
  });

  it.each([
    "../evil.prt",
    "..\\evil.prt",
    "sub/dir.prt",
    "sub\\dir.prt",
    "C:\\temp\\evil.prt",
    "\\\\server\\share\\evil.prt",
    ".hidden.prt",
    "no-extension",
  ])("rejects path escapes: %s", async (fileName) => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const result = await client.callTool({
        name: "creo_open_model",
        arguments: { fileName },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("INVALID_ARGUMENT");
    } finally {
      await close();
    }
  });

  it("reports missing fixtures as MODEL_NOT_FOUND", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const result = await client.callTool({
        name: "creo_open_model",
        arguments: { fileName: "missing.prt" },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("MODEL_NOT_FOUND");
    } finally {
      await close();
    }
  });
});

describe("model.close guards", () => {
  it("closes a model and verifies it is gone", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
    );
    try {
      const payload = await callRead(client, "creo_close_model", {
        name: "GEARBOX",
      });
      expect(payload["closed"]).toBe(true);
      expect(payload["verified"]).toBe(true);

      const models = await callRead(client, "creo_list_models");
      const names = (models["models"] as { name: string }[]).map(
        (model) => model.name,
      );
      expect(names).not.toContain("GEARBOX");
    } finally {
      await close();
    }
  });

  it("refuses to close a modified model without force", async () => {
    const modified: ModelInfo = {
      name: "BRACKET",
      type: "part",
      fileName: "bracket.prt",
      fullName: "BRACKET",
      isModified: true,
      isNative: true,
    };
    const { client, close } = await connectTestClient(
      new MockBridgeTransport({ models: [modified] }),
    );
    try {
      const refused = await client.callTool({
        name: "creo_close_model",
        arguments: { name: "BRACKET" },
      });
      expect(isErrorResult(refused)).toBe(true);
      expect(errorText(refused)).toContain("MODEL_MODIFIED");

      const forced = await callRead(client, "creo_close_model", {
        name: "BRACKET",
        force: true,
      });
      expect(forced["closed"]).toBe(true);
    } finally {
      await close();
    }
  });
});
