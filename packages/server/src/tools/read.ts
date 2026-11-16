// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import {
  modelCloseResultSchema,
  modelDimensionsResultSchema,
  modelEdgesResultSchema,
  modelFamilyTableResultSchema,
  modelFeaturesResultSchema,
  modelGeometryResultSchema,
  modelInfoResultSchema,
  modelLayersResultSchema,
  modelListResultSchema,
  modelMassPropertiesResultSchema,
  modelMaterialsResultSchema,
  modelOpenResultSchema,
  modelParametersResultSchema,
  modelRelationsResultSchema,
  modelSurfacesResultSchema,
  modelUnitsResultSchema,
} from "../bridge/protocol.js";
import { CreoMcpError } from "../errors.js";
import {
  asString,
  ok,
  READ_ONLY_ANNOTATIONS,
  type ToolAnnotations,
  type ToolDefinition,
  type ToolResult,
} from "./registry.js";

const SESSION_MUTATING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const MODEL_CLOSE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const nameInput = z
  .string()
  .optional()
  .describe(
    "Model name, file name, or full name (e.g. BRACKET or bracket.prt). " +
      "Defaults to the active model.",
  );

const BARE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/;

function assertBareFileName(fileName: string): void {
  if (!BARE_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      `'${fileName}' is not a plain file name. Creo tools only accept files ` +
        "that are direct children of Creo's live working directory; " +
        "separators, '..', absolute paths, and UNC paths are rejected.",
      { details: { fileName } },
    );
  }
}

const parametersTool: ToolDefinition = {
  name: "creo_get_parameters",
  title: "Get Creo model parameters",
  description:
    "List the parameters of a model (name, typed value, designated / " +
    "relation-driven / modified flags, driver type, description, units). " +
    "Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    parameters: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelParametersResultSchema.parse(
      await ctx.bridge.call("model.parameters", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      count: result.parameters.length,
      parameters: result.parameters,
    });
  },
};

const dimensionsTool: ToolDefinition = {
  name: "creo_get_dimensions",
  title: "Get Creo model dimensions",
  description:
    "List dimensions of a model or its features (id, symbol, value, type, " +
    "tolerance type, relation-driven / reference flags). Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    dimensions: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelDimensionsResultSchema.parse(
      await ctx.bridge.call("model.dimensions", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      count: result.dimensions.length,
      dimensions: result.dimensions,
    });
  },
};

const featuresTool: ToolDefinition = {
  name: "creo_get_features",
  title: "Get Creo model features",
  description:
    "List the feature tree of a model (id, number, type, subtype, status, " +
    "visibility, parent/child ids). Status distinguishes active, suppressed, " +
    "family-table-suppressed, and unregenerated features. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    features: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelFeaturesResultSchema.parse(
      await ctx.bridge.call("model.features", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      count: result.features.length,
      features: result.features,
    });
  },
};

const relationsTool: ToolDefinition = {
  name: "creo_get_relations",
  title: "Get Creo model relations",
  description:
    "Return the relation text lines of a model. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    relations: z.array(z.string()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelRelationsResultSchema.parse(
      await ctx.bridge.call("model.relations", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      count: result.relations.length,
      relations: result.relations,
    });
  },
};

const massPropertiesTool: ToolDefinition = {
  name: "creo_get_mass_properties",
  title: "Get Creo mass properties",
  description:
    "Return volume, surface area, density, mass, and center of gravity of a " +
    "part or assembly. Density defaults to 1.0 when no material is assigned. " +
    "Read-only.",
  inputSchema: {
    name: nameInput,
    csys: z
      .string()
      .optional()
      .describe("Coordinate system name for the reported values."),
  },
  outputSchema: {
    model: z.unknown(),
    massProperties: z.unknown().nullable(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const csys = asString(args["csys"]);
    const params: Record<string, unknown> = {};
    if (name) params["name"] = name;
    if (csys) params["csys"] = csys;
    const result = modelMassPropertiesResultSchema.parse(
      await ctx.bridge.call("model.mass_properties", params),
    );
    return ok({
      model: result.model,
      massProperties: result.massProperties,
    });
  },
};

const materialsTool: ToolDefinition = {
  name: "creo_get_materials",
  title: "Get Creo model materials",
  description:
    "Return the assigned material and the materials available in a part " +
    "(name, id, mass density, description). Only parts carry material " +
    "assignments; assemblies report supported=false. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    supported: z.boolean(),
    currentMaterial: z.unknown().nullable(),
    materials: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelMaterialsResultSchema.parse(
      await ctx.bridge.call("model.materials", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      supported: result.supported,
      currentMaterial: result.currentMaterial,
      materials: result.materials,
    });
  },
};

const layersTool: ToolDefinition = {
  name: "creo_get_layers",
  title: "Get Creo model layers",
  description:
    "List layers of a model with their display status (normal, display, " +
    "blank, hidden) and item counts. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    layers: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelLayersResultSchema.parse(
      await ctx.bridge.call("model.layers", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      count: result.layers.length,
      layers: result.layers,
    });
  },
};

const unitsTool: ToolDefinition = {
  name: "creo_get_units",
  title: "Get Creo model units",
  description:
    "Return the principal unit system of a model (name, type, standard flag) " +
    "and the principal unit per physical quantity. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    units: z.unknown().nullable(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelUnitsResultSchema.parse(
      await ctx.bridge.call("model.units", name ? { name } : {}),
    );
    return ok({ model: result.model, units: result.units });
  },
};

const geometryTool: ToolDefinition = {
  name: "creo_get_geometry",
  title: "Get Creo model geometry summary",
  description:
    "Return the model outline (min/max corner points) and surface/edge/body " +
    "counts. This is a summary, not a tessellation. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    geometry: z.unknown().nullable(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelGeometryResultSchema.parse(
      await ctx.bridge.call("model.geometry", name ? { name } : {}),
    );
    return ok({ model: result.model, geometry: result.geometry });
  },
};

const edgesTool: ToolDefinition = {
  name: "creo_get_edges",
  title: "List Creo model edges",
  description:
    "List selectable model edges with their PRO_EDGE ids: curve type, length, " +
    "start/end/midpoint coordinates, the owning feature, and the adjoining " +
    "surface ids. Pass the ids to creo_create_round or creo_create_chamfer. " +
    "Edge ids are session-scoped: list again after any model change. Read-only.",
  inputSchema: {
    name: nameInput,
    ids: z
      .array(z.number().int().positive())
      .max(200)
      .optional()
      .describe("Only return these edge ids (optional)."),
  },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    edges: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const ids = Array.isArray(args["ids"])
      ? (args["ids"] as number[])
      : undefined;
    const result = modelEdgesResultSchema.parse(
      await ctx.bridge.call("model.edges", {
        ...(name ? { name } : {}),
        ...(ids && ids.length > 0 ? { ids } : {}),
      }),
    );
    return ok({
      model: result.model,
      count: result.edges.length,
      edges: result.edges,
    });
  },
};

const surfacesTool: ToolDefinition = {
  name: "creo_get_surfaces",
  title: "List Creo model surfaces",
  description:
    "List selectable surfaces (solid faces and datum planes) with their " +
    "PRO_SURFACE ids, surface type, and owning feature. Pass face ids to " +
    "creo_create_shell. Surface ids are session-scoped: list again after any " +
    "model change. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    count: z.number(),
    surfaces: z.array(z.unknown()),
    bodySurfaces: z.array(z.unknown()),
    itemSurfaces: z.array(z.unknown()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelSurfacesResultSchema.parse(
      await ctx.bridge.call("model.surfaces", name ? { name } : {}),
    );
    const merged = new Map<number, Record<string, unknown>>();
    for (const surface of [
      ...result.surfaces.bodySurfaces,
      ...result.surfaces.itemSurfaces,
    ]) {
      const record = surface as Record<string, unknown>;
      const id = Number(record["id"]);
      const existing = merged.get(id);
      merged.set(id, existing ? { ...existing, ...record } : record);
    }
    const surfaces = [...merged.values()];
    return ok({
      model: result.model,
      count: surfaces.length,
      surfaces,
      bodySurfaces: result.surfaces.bodySurfaces,
      itemSurfaces: result.surfaces.itemSurfaces,
    });
  },
};

const familyTableTool: ToolDefinition = {
  name: "creo_get_family_table",
  title: "Get Creo family table",
  description:
    "Return the family table of a generic part or assembly: columns " +
    "(symbol, type) and rows (instance name, locked/verified flags, cell " +
    "values). familyTable is null when the model has no table. Read-only.",
  inputSchema: { name: nameInput },
  outputSchema: {
    model: z.unknown(),
    hasFamilyTable: z.boolean(),
    familyTable: z.unknown().nullable(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelFamilyTableResultSchema.parse(
      await ctx.bridge.call("model.family_table", name ? { name } : {}),
    );
    return ok({
      model: result.model,
      hasFamilyTable: result.familyTable !== null,
      familyTable: result.familyTable,
    });
  },
};

const openModelTool: ToolDefinition = {
  name: "creo_open_model",
  title: "Open a Creo model",
  description:
    "Open (retrieve) a model file from Creo's live working directory into the " +
    "session. Accepts a plain file name only, never a path. The model is " +
    "retrieved without a window. Audited; does not modify model data.",
  inputSchema: {
    fileName: z
      .string()
      .describe(
        "File name with extension, e.g. bracket.prt. Resolved against " +
          "Creo's working directory; paths are rejected.",
      ),
  },
  outputSchema: {
    opened: z.boolean(),
    alreadyOpen: z.boolean(),
    model: z.unknown().nullable(),
  },
  annotations: SESSION_MUTATING_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const fileName = asString(args["fileName"]);
    if (!fileName) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "creo_open_model requires a fileName.",
      );
    }
    assertBareFileName(fileName);
    const result = modelOpenResultSchema.parse(
      await ctx.bridge.call("model.open", { fileName }),
    );
    return ok({
      opened: result.opened,
      alreadyOpen: result.alreadyOpen,
      model: result.model,
    });
  },
};

const closeModelTool: ToolDefinition = {
  name: "creo_close_model",
  title: "Close a Creo model",
  description:
    "Remove a model from the Creo session (Erase; the file on disk is not " +
    "touched). Refuses to close a modified model unless force=true, and " +
    "verifies by readback that the model is gone. Does not save the model.",
  inputSchema: {
    name: nameInput,
    force: z
      .boolean()
      .optional()
      .describe("Close even when the model has unsaved changes."),
  },
  outputSchema: {
    closed: z.boolean(),
    name: z.string(),
    verified: z.boolean(),
  },
  annotations: MODEL_CLOSE_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const force = args["force"] === true;

    const info = modelInfoResultSchema.parse(
      await ctx.bridge.call("model.info", name ? { name } : {}),
    );
    if (!info.model) {
      throw new CreoMcpError(
        "MODEL_NOT_FOUND",
        "No model is available to close in the Creo session.",
      );
    }
    if (info.model.isModified && !force) {
      throw new CreoMcpError(
        "MODEL_MODIFIED",
        `Model '${info.model.name}' has unsaved changes. Save it in Creo, or ` +
          "call creo_close_model with force=true to discard them.",
        { details: { model: info.model.name } },
      );
    }

    const closed = modelCloseResultSchema.parse(
      await ctx.bridge.call("model.close", name ? { name } : {}),
    );

    const listed = modelListResultSchema.parse(
      await ctx.bridge.call("model.list", { type: "all" }),
    );
    const stillOpen = listed.models.some(
      (model) =>
        model.fileName.length > 0 && model.fileName === info.model?.fileName,
    );
    if (stillOpen) {
      throw new CreoMcpError(
        "INTERNAL",
        `Model '${closed.name}' is still open after close.`,
      );
    }

    return ok({ closed: true, name: closed.name, verified: true });
  },
};

export function readTools(): ToolDefinition[] {
  return [
    parametersTool,
    dimensionsTool,
    featuresTool,
    relationsTool,
    massPropertiesTool,
    materialsTool,
    layersTool,
    unitsTool,
    geometryTool,
    edgesTool,
    surfacesTool,
    familyTableTool,
    openModelTool,
    closeModelTool,
  ];
}
