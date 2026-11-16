// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { MockBridgeTransport } from "../src/bridge/mock.js";
import { createLogger } from "../src/logging.js";
import { createCreoMcpServer } from "../src/server.js";
import { errorText, isErrorResult, makeConfig, structured } from "./helpers.js";

const circle = { type: "circle", x: 0, y: 0, radius: 1 };

const WRITE_CALLS: Record<string, Record<string, unknown>> = {
  creo_save_model: {},
  creo_rename_model: { newName: "RENAMED" },
  creo_copy_model: { newName: "COPY" },
  creo_regenerate_model: {},
  creo_set_parameter: { paramName: "WIDTH", expectedOldValue: 120, value: 125 },
  creo_set_dimension: { dimensionId: 10, expectedOldValue: 120, value: 125 },
  creo_suppress_features: { featureIds: [4] },
  creo_resume_features: { featureIds: [4] },
  creo_delete_features: { featureIds: [4] },
  creo_reorder_feature: { featureId: 4, referenceFeatureId: 3 },
  creo_create_part: { modelName: "SAFE_PART" },
  creo_create_assembly: { modelName: "SAFE_ASSEMBLY" },
  creo_create_part_from_template: { modelName: "SAFE_TEMPLATE" },
  creo_assemble_component: { component: "GEARBOX" },
  creo_create_extrude: { sketchPlane: "TOP", depth: 1, section: [circle] },
  creo_create_revolve: { sketchPlane: "TOP", section: [{ type: "centerline", x1: 0, y1: 0, x2: 0, y2: 1 }, circle] },
  creo_create_round: { edgeIds: [101], radius: 1 },
  creo_create_chamfer: { edgeIds: [101], distance: 1 },
  creo_create_shell: { surfaceIds: [2], thickness: 1 },
  creo_create_datum_plane: { type: "through", reference: "TOP" },
  creo_create_datum_axis: { type: "twoPlanes", plane1: "TOP", plane2: "RIGHT" },
  creo_create_datum_point: { type: "edgeCenter", edgeId: 101 },
  creo_create_hole: {
    placement: { type: "linear", surface: "TOP", ref1: "RIGHT", offset1: 0, ref2: "FRONT", offset2: 0 },
    diameter: 2,
    depth: { type: "through" },
  },
  creo_create_pattern: { seedFeatureId: 2, type: "linear", direction1: { reference: "RIGHT", count: 2, spacing: 1 } },
  creo_create_drawing: { drawingName: "SAFE_DRW", templateName: "a4.frm" },
  creo_save_drawing: {},
  creo_generate_standard_drawing: { drawingName: "SAFE_STD", templateName: "a4.frm" },
  creo_add_drawing_sheet: {},
  creo_set_drawing_sheet_scale: { sheetNumber: 1, scale: 1 },
  creo_create_drawing_view: { sheetNumber: 1, locationX: 0, locationY: 0 },
  creo_create_projection_view: { parentViewId: 1, sheetNumber: 1, locationX: 0, locationY: 0 },
  creo_set_drawing_view_scale: { viewId: 1, scale: 1 },
  creo_rename_drawing_view: { viewId: 1, viewName: "SAFE_VIEW" },
  creo_delete_drawing_view: { viewId: 1 },
  creo_translate_drawing_view: { viewId: 1, x: 0, y: 0 },
  creo_regenerate_drawing_view: { viewId: 1 },
  creo_export_step: { fileName: "safe.stp" },
  creo_export_iges: { fileName: "safe.igs" },
  creo_export_stl: { fileName: "safe.stl" },
  creo_export_pdf: { fileName: "safe.pdf" },
  creo_export_dxf: { fileName: "safe.dxf" },
};

async function connectTestClient(
  config: ReturnType<typeof makeConfig>,
  bridge = new MockBridgeTransport({ connected: true }),
) {
  const { server, context } = await createCreoMcpServer({
    config,
    logger: createLogger("silent"),
    bridge,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "safe-write-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    client,
    context,
    bridge,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function reportModelPath(bridge: MockBridgeTransport, modelName: string, reportedPath: string): void {
  const originalCall = bridge.call.bind(bridge);
  bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
    const result = await originalCall(method, ...rest);
    const params = rest[0] as Record<string, unknown> | undefined;
    if (method !== "model.info" || params?.["name"] !== modelName) return result;
    const envelope = result as { model?: Record<string, unknown> | null };
    if (!envelope.model) return result;
    return { ...envelope, model: { ...envelope.model, path: reportedPath } };
  }) as typeof bridge.call;
}

function allWritePacks() {
  return makeConfig({
    tools: { packs: ["core", "read", "export", "modeling", "drawing", "features"] },
    safety: { mode: "read-only" },
  });
}

describe("M3 safe-write gateway", () => {
  it("blocks all 41 registered write tools before any bridge call in read-only mode", async () => {
    expect(Object.keys(WRITE_CALLS)).toHaveLength(41);
    const bridge = new MockBridgeTransport({ connected: true });
    const methods: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      methods.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const { client, close } = await connectTestClient(allWritePacks(), bridge);
    try {
      methods.length = 0;
      const tools = (await client.listTools()).tools;
      const registered = new Set(tools.map((tool) => tool.name));
      expect(Object.keys(WRITE_CALLS).every((name) => registered.has(name))).toBe(true);
      for (const [name, args] of Object.entries(WRITE_CALLS)) {
        const result = await client.callTool({ name, arguments: args });
        expect(isErrorResult(result), `${name}: ${errorText(result)}`).toBe(true);
        expect(errorText(result), name).toContain("POLICY_BLOCKED");
      }
      expect(methods).toEqual([]);
    } finally {
      await close();
    }
  });

  it("keeps feature-tree XML writes disabled in read-only mode for omitted and legacy true inputs", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-feature-tree-readonly-"));
    const beforeFiles = readdirSync(workingDirectory).sort();
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    const treeCalls: Record<string, unknown>[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "feature.tree") treeCalls.push(params ?? {});
      return originalCall(method, params);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "features"] },
      safety: { mode: "read-only" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const featureTool = (await client.listTools()).tools.find((tool) => tool.name === "creo_get_feature_tree");
      expect(JSON.stringify(featureTool?.inputSchema)).not.toContain("includeXml");
      const omitted = await client.callTool({ name: "creo_get_feature_tree", arguments: { featureId: 2 } });
      expect(isErrorResult(omitted), errorText(omitted)).toBe(false);
      const legacyTrue = await client.callTool({ name: "creo_get_feature_tree", arguments: { featureId: 2, includeXml: true } });
      // The schema omits the unsafe option; whether the transport rejects the
      // unknown field or strips it, no XML request may reach the bridge.
      expect(isErrorResult(legacyTrue) || treeCalls.length === 2).toBe(true);
      expect(treeCalls).toHaveLength(isErrorResult(legacyTrue) ? 1 : 2);
      expect(treeCalls.every((params) => params["includeXml"] === false)).toBe(true);
      expect(readdirSync(workingDirectory).sort()).toEqual(beforeFiles);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("binds copy-mode edits to a verified copy and leaves the source unchanged", async () => {
    const bridge = new MockBridgeTransport({ connected: true });
    const methods: { method: string; params?: Record<string, unknown> }[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      methods.push({ method, params });
      return originalCall(method, params);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 140 },
      });
      expect(isErrorResult(result), errorText(result)).toBe(false);
      const output = structured(result);
      expect(output.verified).toBe(true);
      const targetName = (output.model as { name: string }).name;
      expect(targetName).not.toBe("BRACKET");
      expect(methods.some((call) => call.method === "model.copy" && call.params?.["newName"] === targetName)).toBe(true);
      expect(methods.some((call) => call.method === "model.set_dimension" && call.params?.["name"] === targetName)).toBe(true);
      const source = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      const copy = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: targetName });
      expect(source.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
      expect(copy.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(140);
    } finally {
      await close();
    }
  });

  it("fails closed for copy-mode persistence until live close/reopen verification is complete", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-copy-persist-unverified-"));
    const sourcePath = path.join(workingDirectory, "bracket.prt");
    const sourceBytes = "disposable source model fixture";
    writeFileSync(sourcePath, sourceBytes, "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    Object.defineProperty(bridge, "kind", { value: "stdio-otk" });
    const methods: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      methods.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const originalSource = await bridge.call<{ model: { name: string; fileName: string; fullName: string; isModified: boolean } }>("model.info", { name: "BRACKET" });
    const originalHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const config = makeConfig({ tools: { packs: ["core", "modeling"] }, safety: { mode: "copy" } });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const edited = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 },
      });
      expect(isErrorResult(edited), errorText(edited)).toBe(false);
      const editedModel = structured(edited).model as { name: string };
      expect(editedModel.name).not.toBe("BRACKET");

      methods.length = 0;
      const saved = await client.callTool({ name: "creo_save_model", arguments: { name: editedModel.name } });
      expect(isErrorResult(saved)).toBe(true);
      expect(errorText(saved)).toContain("SAFE_WRITE_UNAVAILABLE");
      expect(errorText(saved)).toContain("copy/save/close/reopen acceptance is verified");
      expect(methods).toEqual([]);

      const sourceAfter = await bridge.call<{ model: { name: string; fileName: string; fullName: string; isModified: boolean } }>("model.info", { name: "BRACKET" });
      expect(sourceAfter.model).toEqual(originalSource.model);
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(originalHash);
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
      const sourceDimensions = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      expect(sourceDimensions.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("bounds nested Creo copy names and avoids existing versioned targets", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-copy-name-bounds-"));
    const sourcePath = path.join(workingDirectory, "bracket.prt");
    const versionPath = path.join(workingDirectory, "BRACKET_MCP_COPY.prt.1");
    writeFileSync(sourcePath, "source bytes unchanged", "utf8");
    writeFileSync(versionPath, "preserve existing Creo version", "utf8");
    const originalHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const versionBytes = readFileSync(versionPath, "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    const config = makeConfig({ tools: { packs: ["core", "modeling"] }, safety: { mode: "copy" } });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const first = await client.callTool({ name: "creo_set_dimension", arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 125 } });
      expect(isErrorResult(first), errorText(first)).toBe(false);
      const firstModel = structured(first).model as { name: string };
      expect(firstModel.name).toBe("BRACKET_MCP_COPY_2");
      const second = await client.callTool({ name: "creo_set_dimension", arguments: { name: firstModel.name, dimensionId: 10, expectedOldValue: 125, value: 130 } });
      expect(isErrorResult(second), errorText(second)).toBe(false);
      const secondModel = structured(second).model as { name: string };
      expect(secondModel.name).not.toBe(firstModel.name);
      expect([firstModel.name, secondModel.name].every((name) => name.length <= 31)).toBe(true);
      expect(readFileSync(versionPath, "utf8")).toBe(versionBytes);
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(originalHash);
      expect((await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" })).dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("serializes concurrent copy-mode writes so each targets a unique verified copy", async () => {
    const bridge = new MockBridgeTransport({ connected: true });
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const [first, second] = await Promise.all([
        client.callTool({ name: "creo_set_dimension", arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 125 } }),
        client.callTool({ name: "creo_set_dimension", arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 130 } }),
      ]);
      expect(isErrorResult(first), errorText(first)).toBe(false);
      expect(isErrorResult(second), errorText(second)).toBe(false);
      const names = [first, second].map((result) => (structured(result).model as { name: string }).name);
      expect(new Set(names).size).toBe(2);
      const source = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      expect(source.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
    } finally {
      await close();
    }
  });

  it("returns a dry-run plan without calling any mutating bridge or filesystem operation", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-dry-run-"));
    writeFileSync(path.join(workingDirectory, "bracket.prt"), "dry-run fixture", "utf8");
    const beforeFiles = readdirSync(workingDirectory).sort();
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    const methods: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      methods.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      methods.length = 0;
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 130, dryRun: true },
      });
      expect(isErrorResult(result), errorText(result)).toBe(false);
      expect(structured(result)).toMatchObject({ dryRun: true, planned: true, executed: false, mode: "copy", source: { name: "BRACKET" } });
      expect(methods.some((method) => /^(model\.(copy|set_dimension|save|rename|regenerate|create_)|feature\.create_|drawing\.(create|save|add_|set_|delete|rename|translate|regenerate)|model\.export_)/.test(method))).toBe(false);
      expect(readdirSync(workingDirectory).sort()).toEqual(beforeFiles);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("returns dry-run plans for every write class without mutating the bridge", async () => {
    const bridge = new MockBridgeTransport({ connected: true });
    const methods: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      methods.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "read", "export", "modeling", "drawing", "features"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      methods.length = 0;
      for (const [name, args] of Object.entries(WRITE_CALLS)) {
        const result = await client.callTool({ name, arguments: { ...args, dryRun: true } });
        const plan = structured(result);
        expect(plan.dryRun, `${name}: ${errorText(result)}`).toBe(true);
        expect(plan.planned, name).toBe(true);
        expect(plan.executed, name).toBe(false);
        expect(plan.tool, name).toBe(name);
      }
      const mutating = methods.filter((method) =>
        /^(session\.(connect|launch)|model\.(open|close|copy|save|rename|regenerate|set_|create_|export_)|model\.features\.(suppress|resume|delete|reorder)|assembly\.assemble_component|feature\.create_|drawing\.(create|save|add_sheet|set_|delete_|rename_|translate_|regenerate_))/.test(method),
      );
      expect(mutating).toEqual([]);
    } finally {
      await close();
    }
  });

  it("enforces parameter allowlist, expected-old-value, relation and range guards before copying", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const bridge = new MockBridgeTransport({ connected: true });
    const writes: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      if (method === "model.copy" || method === "model.set_parameter" || method === "model.set_dimension") writes.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const wrongIdentity = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", expectedModelName: "GEARBOX", dimensionId: 10, expectedOldValue: 120, value: 130 },
      });
      expect(errorText(wrongIdentity)).toContain("MODEL_IDENTITY_MISMATCH");
      const deniedParameter = await client.callTool({
        name: "creo_set_parameter",
        arguments: { paramName: "WIDTH", expectedOldValue: 120, value: 130 },
      });
      expect(errorText(deniedParameter)).toContain("parameterAllowlist");
      const staleDimension = await client.callTool({
        name: "creo_set_dimension",
        arguments: { dimensionId: 10, expectedOldValue: 110, value: 130 },
      });
      expect(errorText(staleDimension)).toContain("EXPECTED_OLD_VALUE_MISMATCH");
      const relationDimension = await client.callTool({
        name: "creo_set_dimension",
        arguments: { dimensionId: 11, expectedOldValue: 60, value: 60 },
      });
      expect(errorText(relationDimension)).toContain("Relation-driven");
      const outOfRange = await client.callTool({
        name: "creo_set_dimension",
        arguments: { dimensionId: 10, expectedOldValue: 120, value: 300 },
      });
      expect(errorText(outOfRange)).toContain("0.5x and 2x");
      expect(writes).toEqual([]);
    } finally {
      await close();
    }
  });

  it("closes a failed copy-mode target after injected post-mutation readback failure", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-copy-readback-failure-"));
    const sourcePath = path.join(workingDirectory, "bracket.prt");
    writeFileSync(sourcePath, "source bytes unchanged", "utf8");
    const originalHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    let targetName = "";
    let corruptReadback = false;
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      const params = rest[0] as Record<string, unknown> | undefined;
      if (method === "model.copy") targetName = String(params?.["newName"] ?? "");
      if (method === "model.set_dimension") {
        const result = await originalCall(method, ...rest);
        corruptReadback = true;
        return result;
      }
      const result = await originalCall(method, ...rest);
      if (method === "model.dimensions" && corruptReadback && params?.["name"] === targetName) {
        corruptReadback = false;
        const record = result as { dimensions: { id: number; value: number }[] };
        return { ...record, dimensions: record.dimensions.map((dimension) => dimension.id === 10 ? { ...dimension, value: 999 } : dimension) };
      }
      return result;
    }) as typeof bridge.call;
    const config = makeConfig({ tools: { packs: ["core", "modeling"] }, safety: { mode: "copy" } });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const sourceBefore = await bridge.call("model.info", { name: "BRACKET" });
      const result = await client.callTool({ name: "creo_set_dimension", arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 } });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("VERIFY_FAILED");
      expect(targetName).not.toBe("");
      const models = await bridge.call<{ models: { name: string }[] }>("model.list");
      expect(models.models.some((model) => model.name === targetName)).toBe(false);
      expect(existsSync(path.join(workingDirectory, `${targetName}.prt`))).toBe(false);
      expect(await bridge.call("model.info", { name: "BRACKET" })).toEqual(sourceBefore);
      const sourceDimensions = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      expect(sourceDimensions.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(originalHash);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("closes failed copy targets and surfaces cleanup errors explicitly", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-copy-cleanup-failure-"));
    const sourcePath = path.join(workingDirectory, "bracket.prt");
    writeFileSync(sourcePath, "source bytes unchanged", "utf8");
    const originalHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    let targetName = "";
    let copyFilePath = "";
    let versionFilePath = "";
    let corruptReadback = false;
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      const params = rest[0] as Record<string, unknown> | undefined;
      if (method === "model.copy") {
        targetName = String(params?.["newName"] ?? "");
        copyFilePath = path.join(workingDirectory, `${targetName}.prt`);
        versionFilePath = `${copyFilePath}.1`;
      }
      if (method === "model.set_dimension") {
        const result = await originalCall(method, ...rest);
        mkdirSync(copyFilePath);
        writeFileSync(versionFilePath, "preserve versioned transaction artifact", "utf8");
        corruptReadback = true;
        return result;
      }
      const result = await originalCall(method, ...rest);
      if (method === "model.dimensions" && corruptReadback && params?.["name"] === targetName) {
        corruptReadback = false;
        const record = result as { dimensions: { id: number; value: number }[] };
        return { ...record, dimensions: record.dimensions.map((dimension) => dimension.id === 10 ? { ...dimension, value: 999 } : dimension) };
      }
      return result;
    }) as typeof bridge.call;
    const config = makeConfig({ tools: { packs: ["core", "modeling"] }, safety: { mode: "copy" } });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({ name: "creo_set_dimension", arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 } });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("ROLLBACK_FAILED");
      expect(errorText(result)).toContain("unsafe target file type");
      expect(errorText(result)).toContain("version-file cleanup is outside the approved transaction contract");
      expect(targetName).not.toBe("");
      const models = await bridge.call<{ models: { name: string }[] }>("model.list");
      expect(models.models.some((model) => model.name === targetName)).toBe(false);
      expect(existsSync(copyFilePath)).toBe(true);
      expect(readFileSync(versionFilePath, "utf8")).toBe("preserve versioned transaction artifact");
      const sourceDimensions = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      expect(sourceDimensions.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(originalHash);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed when a numeric axis reference cannot be re-resolved", async () => {
    const bridge = new MockBridgeTransport({ connected: true });
    const methods: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      methods.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "features"] },
      safety: { mode: "copy" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_create_hole",
        arguments: {
          name: "BRACKET",
          placement: { type: "coaxial", axis: { axisId: 42 }, surface: { surfaceId: 2 } },
          diameter: 5,
          depth: { type: "through" },
        },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("SAFE_WRITE_UNAVAILABLE");
      expect(methods.some((method) => method === "model.copy" || method === "feature.create_hole")).toBe(false);
    } finally {
      await close();
    }
  });

  it("allows an explicitly configured live edit after verifying a clean backup", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-success-"));
    const modelFile = path.join(workingDirectory, "bracket.prt");
    writeFileSync(modelFile, "live-write fixture", "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    reportModelPath(bridge, "BRACKET", modelFile);
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "live" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 },
      });
      expect(isErrorResult(result), errorText(result)).toBe(false);
      expect(structured(result)).toMatchObject({ verified: true, dimension: { value: 135 } });
      const dimensions = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      expect(dimensions.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(135);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a live target whose reported path is external despite a same-named working file", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-path-target-"));
    const externalDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-path-source-"));
    const workingFile = path.join(workingDirectory, "bracket.prt");
    const externalFile = path.join(externalDirectory, "bracket.prt");
    writeFileSync(workingFile, "same-named decoy fixture", "utf8");
    writeFileSync(externalFile, "actual external model fixture", "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    reportModelPath(bridge, "BRACKET", externalFile);
    const calls: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      calls.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "live" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("LIVE_BACKUP_UNAVAILABLE");
      expect(calls.some((method) => ["model.copy", "model.set_dimension", "model.save"].includes(method))).toBe(false);
      expect(readFileSync(workingFile, "utf8")).toBe("same-named decoy fixture");
      expect(readFileSync(externalFile, "utf8")).toBe("actual external model fixture");
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
      rmSync(externalDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed when the open model path is unavailable despite a same-named working file", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-path-missing-"));
    const workingFile = path.join(workingDirectory, "bracket.prt");
    writeFileSync(workingFile, "decoy working-directory fixture", "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    const calls: string[] = [];
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      calls.push(method);
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "live" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("LIVE_BACKUP_UNAVAILABLE");
      expect(calls.some((method) => ["model.copy", "model.set_dimension", "model.save"].includes(method))).toBe(false);
      expect(readFileSync(workingFile, "utf8")).toBe("decoy working-directory fixture");
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("binds all generated drawing views to the planned source after active-model change", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-drawing-source-bind-"));
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    let createSourceName = "";
    let frontViewSourceName = "";
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, ...rest: Parameters<typeof bridge.call>) => {
      const params = rest[0] as Record<string, unknown> | undefined;
      if (method === "drawing.create") {
        createSourceName = String(params?.["modelName"] ?? "");
        // Simulate a concurrent session selection change at the mutation seam.
        bridge.setActiveModel("GEARBOX");
      }
      if (method === "drawing.create_general_view") {
        frontViewSourceName = String(params?.["modelName"] ?? "");
      }
      return originalCall(method, ...rest);
    }) as typeof bridge.call;
    const config = makeConfig({ tools: { packs: ["core", "drawing"] }, safety: { mode: "copy" } });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({ name: "creo_generate_standard_drawing", arguments: { drawingName: "BOUND_DRAWING", templateName: "a4.frm" } });
      expect(createSourceName).toBe("BRACKET");
      expect(frontViewSourceName).toBe("BRACKET");
      expect(isErrorResult(result), errorText(result)).toBe(false);
      const output = structured(result);
      expect(output.verified).toBe(true);
      expect((output.sourceModel as { name: string }).name).toBe("BRACKET");
      const views = output.views as { model?: { name?: string } }[];
      expect(views.length).toBeGreaterThan(1);
      expect(views.every((view) => view.model?.name === "BRACKET")).toBe(true);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("uses a verified backup for an explicitly enabled live drawing edit", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-drawing-"));
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    const created = await bridge.call<{ drawing: { name: string; fileName: string } }>("drawing.create", {
      drawingName: "LIVE_DRAWING",
      templateName: "a4.frm",
      modelName: "BRACKET",
      createView: false,
      save: true,
    });
    const drawingName = created.drawing.name;
    await bridge.call("drawing.create_general_view", {
      name: drawingName,
      modelName: "BRACKET",
      sheetNumber: 1,
      locationX: 0,
      locationY: 0,
      viewName: "FRONT",
    });
    await bridge.call("drawing.save", { name: drawingName });
    const drawingPath = path.join(workingDirectory, created.drawing.fileName);
    writeFileSync(drawingPath, "drawing backup fixture", "utf8");
    reportModelPath(bridge, drawingName, drawingPath);
    const config = makeConfig({
      tools: { packs: ["core", "drawing"] },
      safety: { mode: "live" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_rename_drawing_view",
        arguments: { name: drawingName, viewId: 100, viewName: "FRONT_LIVE" },
      });
      expect(isErrorResult(result), errorText(result)).toBe(false);
      expect(structured(result)).toMatchObject({ verified: true, view: { name: "FRONT_LIVE" } });
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("restores a live model from its verified file backup after post-mutation readback failure", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-recovery-"));
    const modelFile = path.join(workingDirectory, "bracket.prt");
    const originalBytes = "mock model backup bytes";
    writeFileSync(modelFile, originalBytes, "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    reportModelPath(bridge, "BRACKET", modelFile);
    let corruptReadback = false;
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "model.set_dimension") {
        const result = await originalCall(method, params);
        corruptReadback = true;
        return result;
      }
      const result = await originalCall(method, params);
      if (method === "model.dimensions" && corruptReadback) {
        corruptReadback = false;
        const record = result as { dimensions: { id: number; value: number }[] };
        return { ...record, dimensions: record.dimensions.map((dimension) => dimension.id === 10 ? { ...dimension, value: 999 } : dimension) };
      }
      return result;
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "live" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("SAFE_WRITE_FAILED");
      expect(errorText(result)).toContain("restored");
      expect(readFileSync(modelFile, "utf8")).toBe(originalBytes);
      const info = await bridge.call<{ model: { name: string; isModified: boolean } }>("model.info", { name: "BRACKET" });
      expect(info.model).toMatchObject({ name: "BRACKET", isModified: false });
      const dimensions = await bridge.call<{ dimensions: { id: number; value: number }[] }>("model.dimensions", { name: "BRACKET" });
      expect(dimensions.dimensions.find((dimension) => dimension.id === 10)?.value).toBe(120);
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("reports rollback failure and retains the verified backup after recovery cannot close the target", async () => {
    const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "creo-mcp-live-rollback-failure-"));
    const modelFile = path.join(workingDirectory, "bracket.prt");
    writeFileSync(modelFile, "rollback-failure fixture", "utf8");
    const bridge = new MockBridgeTransport({ connected: true, workingDirectory });
    reportModelPath(bridge, "BRACKET", modelFile);
    let afterMutation = false;
    const originalCall = bridge.call.bind(bridge);
    bridge.call = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "model.set_dimension") {
        const result = await originalCall(method, params);
        afterMutation = true;
        return result;
      }
      if (method === "model.dimensions" && afterMutation) {
        const result = await originalCall(method, params) as { dimensions: { id: number; value: number }[] };
        return { ...result, dimensions: result.dimensions.map((dimension) => dimension.id === 10 ? { ...dimension, value: -1 } : dimension) };
      }
      if (method === "model.close" && afterMutation) throw new Error("injected recovery close failure");
      return originalCall(method, params);
    }) as typeof bridge.call;
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "live" },
    });
    const { client, close } = await connectTestClient(config, bridge);
    try {
      const result = await client.callTool({
        name: "creo_set_dimension",
        arguments: { name: "BRACKET", dimensionId: 10, expectedOldValue: 120, value: 135 },
      });
      expect(isErrorResult(result)).toBe(true);
      expect(errorText(result)).toContain("ROLLBACK_FAILED");
      const payload = JSON.parse(errorText(result)) as { error?: { details?: { backupRetainedAt?: string } } };
      const backupPath = payload.error?.details?.backupRetainedAt;
      expect(backupPath).toBeTypeOf("string");
      if (backupPath) rmSync(path.dirname(backupPath), { recursive: true, force: true });
    } finally {
      await close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("keeps audit failures non-fatal and records success and policy failure accurately", async () => {
    const config = makeConfig({
      tools: { packs: ["core", "modeling"] },
      safety: { mode: "copy" },
    });
    const { client, context, close } = await connectTestClient(config);
    const records: { ok: boolean; code?: string }[] = [];
    context.audit.record = async (record) => {
      records.push({ ok: record.ok, ...(record.code ? { code: record.code } : {}) });
      throw new Error("injected audit sink failure");
    };
    try {
      const success = await client.callTool({
        name: "creo_set_dimension",
        arguments: { dimensionId: 10, expectedOldValue: 120, value: 130 },
      });
      expect(isErrorResult(success)).toBe(false);
      expect(structured(success).verified).toBe(true);
      const failure = await client.callTool({
        name: "creo_set_parameter",
        arguments: { paramName: "WIDTH", expectedOldValue: 120, value: 130 },
      });
      expect(isErrorResult(failure)).toBe(true);
      expect(errorText(failure)).toContain("POLICY_BLOCKED");
      const blockedPlan = await client.callTool({
        name: "creo_set_dimension",
        arguments: { dimensionId: 11, expectedOldValue: 60, value: 60, dryRun: true },
      });
      expect(structured(blockedPlan)).toMatchObject({ dryRun: true, planned: true, allowed: false, executed: false });
      expect(records).toEqual([
        { ok: true },
        { ok: false, code: "POLICY_BLOCKED" },
        { ok: false, code: "POLICY_BLOCKED" },
      ]);
    } finally {
      await close();
    }
  });
});
