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

const FEATURES_COPY: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "features"] },
  safety: { mode: "copy" },
});

const FEATURES_READ_ONLY: ResolvedConfig = makeConfig({
  tools: { packs: ["core", "features"] },
  safety: { mode: "read-only" },
});

async function connectTestClient(
  bridge: MockBridgeTransport,
  config: ResolvedConfig = FEATURES_COPY,
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

const rectangle = { type: "rectangle", x1: -25, y1: -18, x2: 25, y2: 18 };
const centerline = { type: "centerline", x1: 0, y1: -5, x2: 0, y2: 25 };

describe("features pack", () => {
  it("registers feature tools only when enabled", async () => {
    const core = await connectTestClient(
      new MockBridgeTransport(),
      makeConfig(),
    );
    try {
      expect((await core.client.listTools()).tools).toHaveLength(7);
    } finally {
      await core.close();
    }

    const features = await connectTestClient(new MockBridgeTransport());
    try {
      const tools = (await features.client.listTools()).tools;
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("creo_create_extrude");
      expect(names).toContain("creo_create_revolve");
      expect(names).toContain("creo_create_round");
      expect(names).toContain("creo_create_chamfer");
      expect(names).toContain("creo_create_shell");
      expect(names).toContain("creo_create_datum_plane");
      expect(names).toContain("creo_create_datum_axis");
      expect(names).toContain("creo_create_datum_point");
      expect(names).toContain("creo_create_hole");
      expect(names).toContain("creo_create_pattern");
      expect(names).not.toContain("creo_create_mirror");
      expect(names).toContain("creo_get_feature_tree");
      expect(tools).toHaveLength(18);
      const extrude = tools.find((tool) => tool.name === "creo_create_extrude");
      expect(extrude?.annotations?.readOnlyHint).toBe(false);
      const round = tools.find((tool) => tool.name === "creo_create_round");
      expect(round?.annotations?.readOnlyHint).toBe(false);
      const hole = tools.find((tool) => tool.name === "creo_create_hole");
      expect(hole?.annotations?.readOnlyHint).toBe(false);
      const datum = tools.find((tool) => tool.name === "creo_create_datum_plane");
      expect(datum?.annotations?.readOnlyHint).toBe(false);
      const tree = tools.find((tool) => tool.name === "creo_get_feature_tree");
      expect(tree?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await features.close();
    }
  });

  it("creates an extrude and verifies it by readback", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "read", "features"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      config,
    );
    try {
      const result = structured(
        await client.callTool({
          name: "creo_create_extrude",
          arguments: {
            name: "BRACKET",
            sketchPlane: "TOP",
            orientRef: "FRONT",
            depth: 12,
            featureName: "MCP_EXTRUDE_1",
            section: [rectangle],
          },
        }),
      );
      expect(result.verified).toBe(true);
      expect((result.feature as { name: string }).name).toBe("MCP_EXTRUDE_1");
      expect(
        (result.geometry as { counts: { surfaces: number } }).counts.surfaces,
      ).toBeGreaterThan(0);

      const createdModelName = (result.model as { name: string }).name;
      const features = structured(
        await client.callTool({
          name: "creo_get_features",
          arguments: { name: createdModelName },
        }),
      );
      expect(
        (features.features as { name?: string }[]).some(
          (feature) => feature.name === "MCP_EXTRUDE_1",
        ),
      ).toBe(true);
    } finally {
      await close();
    }
  });

  it("maps cut=true and direction to the bridge payload", async () => {
    const bridge = new MockBridgeTransport();
    const calls: Record<string, unknown>[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method.startsWith("feature.")) {
        calls.push({ method, params: params ?? {} });
      }
      return originalCall(method, params);
    }) as typeof bridge.call;

    const { client, close } = await connectTestClient(bridge);
    try {
      await client.callTool({
        name: "creo_create_extrude",
        arguments: {
          sketchPlane: "TOP",
          depth: 5,
          direction: "sideOne",
          cut: true,
          section: [rectangle],
        },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.["params"]).toMatchObject({
        sketchPlane: "TOP",
        depth: 5,
        direction: -1,
        removeMaterial: true,
      });
    } finally {
      await close();
    }
  });

  it("rejects a revolve without a centerline", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const result = await client.callTool({
        name: "creo_create_revolve",
        arguments: {
          sketchPlane: "TOP",
          angle: 360,
          section: [rectangle],
        },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("RedefineFeature");
    } finally {
      await close();
    }
  });

  it("creates a full revolve with a centerline", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const result = structured(
        await client.callTool({
          name: "creo_create_revolve",
          arguments: {
            sketchPlane: "TOP",
            orientRef: "FRONT",
            angle: 360,
            section: [centerline, rectangle],
          },
        }),
      );
      expect(result.verified).toBe(true);
      expect((result.feature as { subType: string }).subType).toBe("Revolve");
    } finally {
      await close();
    }
  });

  it("rejects an unknown sketch plane", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const result = await client.callTool({
        name: "creo_create_extrude",
        arguments: {
          sketchPlane: "SIDE",
          depth: 5,
          section: [rectangle],
        },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("SIDE");
    } finally {
      await close();
    }
  });

  it("returns feature element trees without exposing XML file export", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const tool = (await client.listTools()).tools.find((item) => item.name === "creo_get_feature_tree");
      expect(JSON.stringify(tool?.inputSchema)).not.toContain("includeXml");
      const result = structured(
        await client.callTool({
          name: "creo_get_feature_tree",
          arguments: { name: "BRACKET", featureId: 2, includeXml: true },
        }),
      );
      expect(result.elementCount).toBeGreaterThan(0);
      expect(
        (result.elements as { idName?: string }[]).some(
          (element) => element.idName === "PRO_E_SKETCHER",
        ),
      ).toBe(true);
      expect(result.xml).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("creates a round, a chamfer, and a shell with volume verification", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "read", "features"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      config,
    );
    try {
      const edges = structured(
        await client.callTool({
          name: "creo_get_edges",
          arguments: { name: "BRACKET" },
        }),
      );
      const edgeList = edges.edges as { id: number; edgeTypeName?: string }[];
      expect(edgeList.length).toBeGreaterThanOrEqual(12);
      expect(edgeList.some((edge) => edge.edgeTypeName === "line")).toBe(true);
      const edgeIds = edgeList.slice(0, 2).map((edge) => edge.id);

      const round = structured(
        await client.callTool({
          name: "creo_create_round",
          arguments: {
            name: "BRACKET",
            edgeIds,
            radius: 2,
            featureName: "MCP_ROUND_1",
          },
        }),
      );
      expect(round.verified).toBe(true);
      expect(round.volumeChange as number).toBeGreaterThan(0);
      expect((round.feature as { name: string }).name).toBe("MCP_ROUND_1");
      expect((round.feature as { status: string }).status).toBe("active");

      const chamfer = structured(
        await client.callTool({
          name: "creo_create_chamfer",
          arguments: {
            name: "BRACKET",
            edgeIds: [edgeIds[0]],
            distance: 1.5,
            distance2: 2.5,
          },
        }),
      );
      expect(chamfer.verified).toBe(true);
      expect(chamfer.volumeChange as number).toBeGreaterThan(0);

      const surfaces = structured(
        await client.callTool({
          name: "creo_get_surfaces",
          arguments: { name: "BRACKET" },
        }),
      );
      expect((surfaces.surfaces as unknown[]).length).toBeGreaterThan(0);

      const shell = structured(
        await client.callTool({
          name: "creo_create_shell",
          arguments: {
            name: "BRACKET",
            surfaceIds: [2],
            thickness: 1.5,
          },
        }),
      );
      expect(shell.verified).toBe(true);
      expect(shell.volumeChange as number).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("creates datum features and resolves their geometry", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "read", "features"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      config,
    );
    try {
      const plane = structured(
        await client.callTool({
          name: "creo_create_datum_plane",
          arguments: {
            name: "BRACKET",
            type: "offset",
            reference: "TOP",
            distance: 20,
            featureName: "DTM1",
          },
        }),
      );
      expect(plane.verified).toBe(true);
      expect((plane.feature as { name: string }).name).toBe("DTM1");
      expect((plane.datum as { surfaceId: number }).surfaceId).toBeGreaterThan(0);

      const planeModelName = (plane.model as { name: string }).name;
      const axis = structured(
        await client.callTool({
          name: "creo_create_datum_axis",
          arguments: {
            name: planeModelName,
            type: "twoPlanes",
            plane1: "TOP",
            plane2: "RIGHT",
            featureName: "A_MCP",
          },
        }),
      );
      expect(axis.verified).toBe(true);
      expect((axis.datum as { axisId: number }).axisId).toBeGreaterThan(0);

      const axisModelName = (axis.model as { name: string }).name;
      const point = structured(
        await client.callTool({
          name: "creo_create_datum_point",
          arguments: {
            name: axisModelName,
            type: "onEdge",
            edgeId: 101,
            ratio: 0.25,
            featureName: "PNT_MCP",
          },
        }),
      );
      expect(point.verified).toBe(true);
      expect((point.datum as { pointId: number }).pointId).toBeGreaterThan(0);

      const pointModelName = (point.model as { name: string }).name;
      const features = structured(
        await client.callTool({
          name: "creo_get_features",
          arguments: { name: pointModelName },
        }),
      );
      const types = features.features as { name?: string; type: string }[];
      expect(types.some((feature) => feature.name === "DTM1")).toBe(true);
      expect(types.some((feature) => feature.type === "DATUM AXIS")).toBe(true);
      expect(types.some((feature) => feature.name === "PNT_MCP")).toBe(true);
    } finally {
      await close();
    }
  });

  it("reports VERIFY_FAILED when a datum does not resolve", async () => {
    const bridge = new MockBridgeTransport();
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "feature.create_datum_plane") {
        const result = (await originalCall(method, params)) as Record<
          string,
          unknown
        >;
        return { ...result, datum: undefined };
      }
      return originalCall(method, params);
    }) as typeof bridge.call;

    const { client, close } = await connectTestClient(bridge);
    try {
      const result = await client.callTool({
        name: "creo_create_datum_plane",
        arguments: { type: "offset", reference: "TOP", distance: 10 },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("VERIFY_FAILED");
    } finally {
      await close();
    }
  });

  it("rejects invalid datum and hole inputs", async () => {
    const { client, close } = await connectTestClient(new MockBridgeTransport());
    try {
      const missingPlane = await client.callTool({
        name: "creo_create_datum_axis",
        arguments: { type: "twoPlanes", plane1: "TOP" },
      });
      expect(isErrorResult(missingPlane)).toBe(true);
      expect(errorText(missingPlane)).toContain("plane2");

      const badPlane = await client.callTool({
        name: "creo_create_datum_plane",
        arguments: { type: "offset", reference: "SIDE", distance: 10 },
      });
      expect(isErrorResult(badPlane)).toBe(true);
      expect(errorText(badPlane)).toContain("SIDE");

      const noAxis = await client.callTool({
        name: "creo_create_hole",
        arguments: {
          placement: { type: "coaxial" },
          diameter: 5,
          depth: { type: "through" },
        },
      });
      expect(isErrorResult(noAxis)).toBe(true);
      expect(errorText(noAxis)).toContain("axis");

      const smallHead = await client.callTool({
        name: "creo_create_hole",
        arguments: {
          placement: {
            type: "linear",
            surface: { surfaceId: 2 },
            ref1: "RIGHT",
            offset1: 0,
            ref2: "FRONT",
            offset2: 0,
          },
          diameter: 6,
          depth: { type: "blind", value: 5 },
          head: { type: "counterbore", diameter: 4, depth: 2 },
        },
      });
      expect(isErrorResult(smallHead)).toBe(true);
      expect(errorText(smallHead)).toContain("counterbore");
    } finally {
      await close();
    }
  });

  it("drills holes and verifies the volume decrease", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "read", "features"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      config,
    );
    try {
      const throughHole = structured(
        await client.callTool({
          name: "creo_create_hole",
          arguments: {
            name: "BRACKET",
            placement: {
              type: "linear",
              surface: { surfaceId: 2 },
              ref1: "RIGHT",
              offset1: 10,
              ref2: "FRONT",
              offset2: -10,
            },
            diameter: 8,
            depth: { type: "through" },
            featureName: "HOLE_THRU",
          },
        }),
      );
      expect(throughHole.verified).toBe(true);
      expect(throughHole.volumeChange as number).toBeGreaterThan(0);
      expect((throughHole.feature as { status: string }).status).toBe("active");

      const axis = structured(
        await client.callTool({
          name: "creo_create_datum_axis",
          arguments: {
            name: "BRACKET",
            type: "twoPlanes",
            plane1: "TOP",
            plane2: "RIGHT",
            featureName: "A_MCP",
          },
        }),
      );
      const axisModelName = (axis.model as { name: string }).name;
      const coax = structured(
        await client.callTool({
          name: "creo_create_hole",
          arguments: {
            name: axisModelName,
            placement: { type: "coaxial", axis: "A_MCP", surface: "TOP" },
            diameter: 5,
            depth: { type: "blind", value: 6 },
          },
        }),
      );
      expect(coax.verified).toBe(true);

      const counterboreRaw = await client.callTool({
        name: "creo_create_hole",
        arguments: {
          name: "BRACKET",
          placement: {
            type: "linear",
            surface: { surfaceId: 2 },
            ref1: { edgeId: 101 },
            offset1: 5,
            ref2: { edgeId: 102 },
            offset2: 5,
          },
          diameter: 6,
          depth: { type: "blind", value: 6 },
          head: { type: "counterbore", diameter: 12, depth: 3 },
          featureName: "HOLE_CBORE",
        },
      });
      expect(isErrorResult(counterboreRaw), errorText(counterboreRaw)).toBe(false);
      const counterbore = structured(counterboreRaw);
      expect(counterbore.verified, errorText(counterboreRaw)).toBe(true);
      expect(counterbore.volumeChange as number).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("creates linear and axis patterns with readback verification", async () => {
    const bridge = new MockBridgeTransport();
    const calls: { method: string; params?: Record<string, unknown> }[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "feature.create_pattern") {
        calls.push({ method, params });
      }
      return originalCall(method, params);
    }) as typeof bridge.call;

    const { client, close } = await connectTestClient(bridge);
    try {
      const linearRaw = await client.callTool({
        name: "creo_create_pattern",
        arguments: {
          name: "BRACKET",
          seedFeatureId: 2,
          type: "linear",
          direction1: { reference: "RIGHT", count: 4, spacing: 20 },
          featureName: "BOLT_PATTERN",
        },
      });
      const linear = structured(linearRaw);
      expect(linear.verified, errorText(linearRaw)).toBe(true);
      expect(linear.instanceCount).toBe(4);
      expect(linear.memberCount).toBe(4);

      const datumAxis = structured(await client.callTool({
        name: "creo_create_datum_axis",
        arguments: {
          name: "BRACKET",
          type: "twoPlanes",
          plane1: "TOP",
          plane2: "RIGHT",
          featureName: "A_PATTERN",
        },
      }));
      const axisModelName = (datumAxis.model as { name: string }).name;
      const axisFeatureId = (datumAxis.feature as { id: number }).id;
      const axis = structured(await client.callTool({
        name: "creo_create_pattern",
        arguments: {
          name: axisModelName,
          seedFeatureId: 2,
          type: "axis",
          axis: { axisFeatureId },
          count: 6,
          angle: 60,
        },
      }));
      expect(axis.verified).toBe(true);
      expect(axis.instanceCount).toBe(6);

      expect(calls).toHaveLength(2);
      expect(calls[0]?.params).toMatchObject({
        seedFeatureId: 2,
        type: "linear",
        direction1: { reference: "RIGHT", count: 4, spacing: 20 },
      });
      expect(calls[1]?.params).toMatchObject({
        type: "axis",
        axis: { axisFeatureId },
        count: 6,
        angle: 60,
      });
    } finally {
      await close();
    }
  });

  it("rejects missing pattern inputs and failed replication readback", async () => {
    const bridge = new MockBridgeTransport();
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      const result = await originalCall(method, params) as Record<string, unknown>;
      if (method === "feature.create_pattern") return { ...result, instanceCount: 3 };
      return result;
    }) as typeof bridge.call;
    const { client, close } = await connectTestClient(bridge);
    try {
      const missing = await client.callTool({
        name: "creo_create_pattern",
        arguments: { seedFeatureId: 2, type: "linear" },
      });
      expect(isErrorResult(missing)).toBe(true);

      const failedVerify = await client.callTool({
        name: "creo_create_pattern",
        arguments: {
          seedFeatureId: 2,
          type: "linear",
          direction1: { reference: "RIGHT", count: 4, spacing: 20 },
        },
      });
      expect(isErrorResult(failedVerify)).toBe(true);
      expect(errorText(failedVerify)).toContain("VERIFY_FAILED");
    } finally {
      await close();
    }
  });

  it("maps hole placement, depth, and head to the bridge payload", async () => {
    const bridge = new MockBridgeTransport();
    const calls: Record<string, unknown>[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "feature.create_hole") {
        calls.push({ method, params: params ?? {} });
      }
      return originalCall(method, params);
    }) as typeof bridge.call;

    const { client, close } = await connectTestClient(bridge);
    try {
      await client.callTool({
        name: "creo_create_hole",
        arguments: {
          placement: {
            type: "linear",
            surface: { surfaceId: 2 },
            ref1: { edgeId: 101 },
            offset1: 12.5,
            ref2: "FRONT",
            offset2: -3,
          },
          diameter: 6.5,
          depth: { type: "symmetric", value: 14 },
          head: { type: "countersink", diameter: 12, angle: 90 },
          drillAngle: 130,
        },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.["params"]).toMatchObject({
        placement: "linear",
        planeSurfaceId: 2,
        ref1EdgeId: 101,
        offset1: 12.5,
        ref2: "FRONT",
        offset2: -3,
        diameter: 6.5,
        depth: "symmetric",
        depthValue: 14,
        head: "countersink",
        headDiameter: 12,
        headAngle: 90,
        drillAngle: 130,
      });
      expect(calls[0]?.["params"]).not.toHaveProperty("headDepth");

      const datumAxis = structured(await client.callTool({
        name: "creo_create_datum_axis",
        arguments: {
          name: "BRACKET",
          type: "twoPlanes",
          plane1: "TOP",
          plane2: "RIGHT",
          featureName: "A_HOLE",
        },
      }));
      const axisModelName = (datumAxis.model as { name: string }).name;
      const axisFeatureId = (datumAxis.feature as { id: number }).id;
      await client.callTool({
        name: "creo_create_hole",
        arguments: {
          name: axisModelName,
          placement: { type: "coaxial", axis: { featureId: axisFeatureId }, surface: { surfaceId: 2 } },
          diameter: 5,
          depth: { type: "through" },
          head: { type: "counterbore", diameter: 9, depth: 2.5 },
        },
      });
      expect(calls[1]?.["params"]).toMatchObject({
        placement: "coaxial",
        axisFeatureId,
        planeSurfaceId: 2,
        depth: "through",
        head: "counterbore",
        headDepth: 2.5,
      });
      expect(calls[1]?.["params"]).not.toHaveProperty("depthValue");
      expect(calls[1]?.["params"]).not.toHaveProperty("headAngle");
    } finally {
      await close();
    }
  });

  it("reports VERIFY_FAILED when a hole does not remove material", async () => {
    const bridge = new MockBridgeTransport();
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "model.mass_properties") {
        const result = (await originalCall(method, params)) as Record<
          string,
          unknown
        >;
        const massProperties = result["massProperties"] as Record<
          string,
          unknown
        >;
        return { ...result, massProperties: { ...massProperties, volume: 1000 } };
      }
      return originalCall(method, params);
    }) as typeof bridge.call;

    const { client, close } = await connectTestClient(bridge);
    try {
      const result = await client.callTool({
        name: "creo_create_hole",
        arguments: {
          placement: {
            type: "linear",
            surface: { surfaceId: 2 },
            ref1: "RIGHT",
            offset1: 0,
            ref2: "FRONT",
            offset2: 0,
          },
          diameter: 8,
          depth: { type: "through" },
        },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("VERIFY_FAILED");
    } finally {
      await close();
    }
  });

  it("maps chamfer dimensions to the documented schema", async () => {
    const bridge = new MockBridgeTransport();
    const calls: Record<string, unknown>[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method.startsWith("feature.create_")) {
        calls.push({ method, params: params ?? {} });
      }
      return originalCall(method, params);
    }) as typeof bridge.call;

    const { client, close } = await connectTestClient(bridge);
    try {
      await client.callTool({
        name: "creo_create_chamfer",
        arguments: { name: "BRACKET", edgeIds: [101], distance: 3 },
      });
      await client.callTool({
        name: "creo_create_chamfer",
        arguments: {
          name: "BRACKET",
          edgeIds: [102],
          distance: 3,
          distance2: 4,
        },
      });
      await client.callTool({
        name: "creo_create_chamfer",
        arguments: { name: "BRACKET", edgeIds: [103], distance: 3, angle: 60 },
      });
      expect(calls).toHaveLength(3);
      expect(calls[0]?.["params"]).toMatchObject({
        schema: 602,
        distance1: 3,
      });
      expect(calls[1]?.["params"]).toMatchObject({
        schema: 603,
        distance1: 3,
        distance2: 4,
      });
      expect(calls[2]?.["params"]).toMatchObject({
        schema: 604,
        distance1: 3,
        angle: 60,
      });
    } finally {
      await close();
    }
  });

  it("blocks feature creation in read-only safety mode", async () => {
    const { client, close } = await connectTestClient(
      new MockBridgeTransport(),
      FEATURES_READ_ONLY,
    );
    try {
      const result = await client.callTool({
        name: "creo_create_extrude",
        arguments: { sketchPlane: "TOP", depth: 5, section: [rectangle] },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("POLICY_BLOCKED");

      const round = await client.callTool({
        name: "creo_create_round",
        arguments: { edgeIds: [101], radius: 2 },
      });
      expect(isErrorResult(round)).toBe(true);
      expect(errorText(round)).toContain("POLICY_BLOCKED");

      const datum = await client.callTool({
        name: "creo_create_datum_plane",
        arguments: { type: "offset", reference: "TOP", distance: 10 },
      });
      expect(isErrorResult(datum)).toBe(true);
      expect(errorText(datum)).toContain("POLICY_BLOCKED");

      const hole = await client.callTool({
        name: "creo_create_hole",
        arguments: {
          placement: {
            type: "linear",
            surface: { surfaceId: 2 },
            ref1: "RIGHT",
            offset1: 0,
            ref2: "FRONT",
            offset2: 0,
          },
          diameter: 5,
          depth: { type: "through" },
        },
      });
      expect(isErrorResult(hole)).toBe(true);
      expect(errorText(hole)).toContain("POLICY_BLOCKED");

      const pattern = await client.callTool({
        name: "creo_create_pattern",
        arguments: {
          seedFeatureId: 2,
          type: "linear",
          direction1: { reference: "RIGHT", count: 3, spacing: 10 },
        },
      });
      expect(isErrorResult(pattern)).toBe(true);
      expect(errorText(pattern)).toContain("POLICY_BLOCKED");

      const tree = await client.callTool({
        name: "creo_get_feature_tree",
        arguments: { featureId: 2 },
      });
      expect(isErrorResult(tree)).toBe(false);
    } finally {
      await close();
    }
  });
});
