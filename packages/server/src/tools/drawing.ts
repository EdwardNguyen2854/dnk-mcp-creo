// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import {
  drawingCreateResultSchema,
  drawingGenerateResultSchema,
  drawingMutationResultSchema,
  drawingSaveResultSchema,
  drawingSheetsResultSchema,
  drawingViewsResultSchema,
  modelExportResultSchema,
} from "../bridge/protocol.js";
import { CreoMcpError } from "../errors.js";
import {
  asString,
  ok,
  type ToolAnnotations,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./registry.js";

const DRAWING_WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const DRAWING_DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = {
  ...DRAWING_WRITE_ANNOTATIONS,
  destructiveHint: true,
};

const modelName = z
  .string()
  .optional()
  .describe("Drawing model name, file name, or full name. Defaults to the active model.");

const BARE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/;
const MODEL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

const standardViewSpec = z.object({
  kind: z.enum(["front", "top", "right", "left", "bottom"]),
  locationX: z.number().finite(),
  locationY: z.number().finite(),
  locationZ: z.number().finite().optional(),
  viewName: z.string().min(1).optional(),
});

interface StandardViewSpec {
  kind: "front" | "top" | "right" | "left" | "bottom";
  locationX: number;
  locationY: number;
  locationZ?: number | undefined;
  viewName?: string | undefined;
}

const defaultStandardViews = [
  { kind: "front" as const, locationX: 100, locationY: 100, viewName: "FRONT" },
  { kind: "top" as const, locationX: 100, locationY: 180, viewName: "TOP" },
  { kind: "right" as const, locationX: 180, locationY: 100, viewName: "RIGHT" },
];

function requireBareFileName(value: unknown, label: string): string {
  const fileName = asString(value);
  if (!fileName || !BARE_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      `${label} must be a plain file name in Creo's working directory.`,
    );
  }
  return fileName;
}

function requireDrawingName(value: unknown): string {
  const name = asString(value);
  if (!name || name.includes("..") || (!BARE_FILE_NAME.test(name) && !MODEL_NAME.test(name))) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      "drawingName must be a Creo drawing name or plain file name without a path.",
    );
  }
  return name;
}

async function callDrawing<T>(
  ctx: ToolContext,
  method: string,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  await ctx.ensureSession();
  return schema.parse(await ctx.bridge.call(method, params));
}

function selectedDrawingParams(args: Record<string, unknown>): Record<string, unknown> {
  const name = asString(args["name"]);
  return name ? { name } : {};
}

const createDrawingTool: ToolDefinition = {
  name: "creo_create_drawing",
  title: "Create 2D drawing from Creo model",
  description:
    "Create a drawing from a plain Creo template file, link it to a part or " +
    "assembly, and optionally create a general view. The drawing is saved by " +
    "default and all created objects are verified by readback. Blocked in " +
    "read-only safety mode.",
  inputSchema: {
    modelName: z.string().optional().describe("Source part or assembly; defaults to the active model."),
    drawingName: z.string().describe("New drawing name or plain .drw file name."),
    templateName: z.string().describe("Plain .drw/.frm template file name in Creo's working directory."),
    createView: z.boolean().optional().describe("Create a general view on the first sheet (default: true)."),
    viewName: z.string().optional(),
    sheetNumber: z.number().int().positive().optional(),
    locationX: z.number().finite().optional(),
    locationY: z.number().finite().optional(),
    locationZ: z.number().finite().optional(),
    scale: z.number().positive().finite().optional(),
    save: z.boolean().optional().describe("Save the new drawing (default: true)."),
  },
  outputSchema: {
    created: z.boolean(),
    drawing: z.unknown(),
    sourceModel: z.unknown(),
    sheets: z.array(z.unknown()),
    views: z.array(z.unknown()),
    view: z.unknown().nullable(),
    saved: z.boolean(),
    verified: z.boolean(),
  },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const drawingName = requireDrawingName(args["drawingName"]);
    const templateName = requireBareFileName(args["templateName"], "templateName");
    const sourceModelName = asString(args["modelName"]);
    if (!sourceModelName) {
      throw new CreoMcpError(
        "SAFE_WRITE_UNAVAILABLE",
        "Drawing creation requires the safe-write gateway to bind a resolved source model identity.",
      );
    }
    const result = await callDrawing(
      ctx,
      "drawing.create",
      {
        drawingName,
        templateName,
        modelName: sourceModelName,
        ...(args["createView"] !== undefined ? { createView: args["createView"] } : {}),
        ...(asString(args["viewName"]) ? { viewName: args["viewName"] } : {}),
        ...(args["sheetNumber"] !== undefined ? { sheetNumber: args["sheetNumber"] } : {}),
        ...(args["locationX"] !== undefined ? { locationX: args["locationX"] } : {}),
        ...(args["locationY"] !== undefined ? { locationY: args["locationY"] } : {}),
        ...(args["locationZ"] !== undefined ? { locationZ: args["locationZ"] } : {}),
        ...(args["scale"] !== undefined ? { scale: args["scale"] } : {}),
        ...(args["save"] !== undefined ? { save: args["save"] } : {}),
      },
      drawingCreateResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const saveDrawingTool: ToolDefinition = {
  name: "creo_save_drawing",
  title: "Save Creo drawing",
  description:
    "Save an open Creo drawing and verify that Creo clears its modified flag. " +
    "Blocked when safety.mode is read-only.",
  inputSchema: { name: modelName },
  outputSchema: { drawing: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.save",
      selectedDrawingParams(args),
      drawingSaveResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const generateStandardDrawingTool: ToolDefinition = {
  name: "creo_generate_standard_drawing",
  title: "Generate standard 2D drawing from Creo model",
  description:
    "Create a template-based 2D drawing, add a verified front view and " +
    "projection views, then optionally save and export PDF/DXF. The source " +
    "model is never modified. Automatic dimensions are intentionally not added.",
  inputSchema: {
    modelName: z.string().optional().describe("Source part or assembly; defaults to the active model."),
    drawingName: z.string().describe("New drawing name or plain .drw file name."),
    templateName: z.string().describe("Plain .drw/.frm template file name in Creo's working directory."),
    sheetNumber: z.number().int().positive().optional().default(1),
    scale: z.number().positive().finite().optional(),
    views: z.array(standardViewSpec).min(1).optional().default(defaultStandardViews),
    save: z.boolean().optional().default(true),
    pdfFileName: z.string().optional().describe("Optional plain PDF filename; requires the export pack."),
    dxfFileName: z.string().optional().describe("Optional plain DXF filename; requires the export pack."),
    overwrite: z.boolean().optional().describe("Allow replacing requested PDF/DXF files."),
  },
  outputSchema: {
    created: z.boolean(),
    drawing: z.unknown(),
    sourceModel: z.unknown(),
    sheets: z.array(z.unknown()),
    views: z.array(z.unknown()),
    exports: z.array(z.unknown()),
    saved: z.boolean(),
    verified: z.boolean(),
  },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const drawingName = requireDrawingName(args["drawingName"]);
    const templateName = requireBareFileName(args["templateName"], "templateName");
    const plannedSourceName = asString(args["modelName"]);
    if (!plannedSourceName) {
      throw new CreoMcpError(
        "SAFE_WRITE_UNAVAILABLE",
        "Standard drawing generation requires the safe-write gateway to bind a resolved source model identity.",
      );
    }
    const viewSpecs: StandardViewSpec[] =
      (args["views"] as StandardViewSpec[] | undefined) ?? defaultStandardViews;
    const frontSpec = viewSpecs.find((view) => view.kind === "front");
    if (!frontSpec) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "views must include exactly one front view to anchor projections.",
      );
    }

    const pdfFileName = args["pdfFileName"] === undefined
      ? undefined
      : requireBareFileName(args["pdfFileName"], "pdfFileName");
    const dxfFileName = args["dxfFileName"] === undefined
      ? undefined
      : requireBareFileName(args["dxfFileName"], "dxfFileName");
    const save = args["save"] !== false;
    if ((pdfFileName || dxfFileName) && !ctx.config.tools.packs.includes("export")) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "PDF/DXF output requires the 'export' tool pack to be enabled.",
      );
    }
    if ((pdfFileName || dxfFileName) && !save) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "PDF/DXF output requires save=true so Creo has a committed drawing.",
      );
    }

    let createdName: string | undefined;
    let committed = false;
    try {
      const created = await callDrawing(
        ctx,
        "drawing.create",
        {
          drawingName,
          templateName,
          modelName: plannedSourceName,
          createView: false,
          sheetNumber: args["sheetNumber"] ?? 1,
          save: false,
        },
        drawingCreateResultSchema,
      );
      createdName = created.drawing?.name;
      if (!createdName) {
        throw new CreoMcpError("CREO_API_ERROR", "Creo did not return the created drawing name.");
      }
      const createdSourceName = created.sourceModel?.name;
      if (!createdSourceName || createdSourceName.toUpperCase() !== plannedSourceName.toUpperCase()) {
        throw new CreoMcpError(
          "VERIFY_FAILED",
          "Creo linked the new drawing to a source model other than the planned identity.",
          { details: { plannedSourceName, createdSource: created.sourceModel } },
        );
      }

      const frontResult = await callDrawing(
        ctx,
        "drawing.create_general_view",
        {
          name: createdName,
          modelName: createdSourceName,
          sheetNumber: args["sheetNumber"] ?? 1,
          locationX: frontSpec.locationX,
          locationY: frontSpec.locationY,
          ...(frontSpec.locationZ !== undefined ? { locationZ: frontSpec.locationZ } : {}),
          ...(args["scale"] !== undefined ? { scale: args["scale"] } : {}),
          ...(frontSpec.viewName ? { viewName: frontSpec.viewName } : {}),
        },
        drawingMutationResultSchema.extend({ view: z.unknown() }),
      );
      const frontView = frontResult.view as { id?: unknown };
      if (typeof frontView.id !== "number") {
        throw new CreoMcpError("CREO_API_ERROR", "Creo did not return a usable front view id.");
      }

      for (const spec of viewSpecs) {
        if (spec.kind === "front") {
          continue;
        }
        await callDrawing(
          ctx,
          "drawing.create_projection_view",
          {
            name: createdName,
            parentViewId: frontView.id,
            sheetNumber: args["sheetNumber"] ?? 1,
            locationX: spec.locationX,
            locationY: spec.locationY,
            ...(spec.locationZ !== undefined ? { locationZ: spec.locationZ } : {}),
            ...(spec.viewName ? { viewName: spec.viewName } : {}),
          },
          drawingMutationResultSchema.extend({ view: z.unknown() }),
        );
      }

      const sheets = await callDrawing(
        ctx,
        "drawing.list_sheets",
        { name: createdName },
        drawingSheetsResultSchema,
      );
      const views = await callDrawing(
        ctx,
        "drawing.list_views",
        { name: createdName },
        drawingViewsResultSchema,
      );
      if (save) {
        await callDrawing(ctx, "drawing.save", { name: createdName }, drawingSaveResultSchema);
        committed = true;
      }

      const exports: unknown[] = [];
      if (pdfFileName) {
        exports.push(
          await callDrawing(
            ctx,
            "model.export_pdf",
            { name: createdName, fileName: pdfFileName, overwrite: args["overwrite"] === true, mode: "drawing" },
            modelExportResultSchema,
          ),
        );
      }
      if (dxfFileName) {
        exports.push(
          await callDrawing(
            ctx,
            "model.export_dxf",
            { name: createdName, fileName: dxfFileName, overwrite: args["overwrite"] === true },
            modelExportResultSchema,
          ),
        );
      }

      return ok(
        drawingGenerateResultSchema.parse({
          created: true,
          drawing: views.drawing,
          sourceModel: created.sourceModel,
          sheets: sheets.sheets,
          views: views.views,
          exports,
          saved: save,
          verified: true,
        }) as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (createdName && !committed) {
        try {
          await ctx.bridge.call("model.close", { name: createdName, force: true });
        } catch (cleanupError) {
          ctx.logger.warn("Could not clean up an incomplete generated drawing", {
            drawing: createdName,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
      throw error;
    }
  },
};

const listSheetsTool: ToolDefinition = {
  name: "creo_list_drawing_sheets",
  title: "List Creo drawing sheets",
  description: "List drawing sheets, sizes, formats, scales, and the current sheet. Read-only.",
  inputSchema: { name: modelName },
  outputSchema: {
    drawing: z.unknown(),
    currentSheet: z.number().nullable(),
    sheets: z.array(z.unknown()),
    count: z.number(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(ctx, "drawing.list_sheets", selectedDrawingParams(args), drawingSheetsResultSchema);
    return ok(result as unknown as Record<string, unknown>);
  },
};

const addSheetTool: ToolDefinition = {
  name: "creo_add_drawing_sheet",
  title: "Add Creo drawing sheet",
  description: "Add a sheet to an open drawing and verify the resulting sheet. Blocked in read-only safety mode.",
  inputSchema: { name: modelName },
  outputSchema: { drawing: z.unknown(), sheet: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.add_sheet",
      selectedDrawingParams(args),
      drawingMutationResultSchema.extend({ sheet: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const setSheetScaleTool: ToolDefinition = {
  name: "creo_set_drawing_sheet_scale",
  title: "Set Creo drawing sheet scale",
  description: "Set and verify a drawing sheet scale. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    sheetNumber: z.number().int().positive(),
    scale: z.number().positive().finite(),
  },
  outputSchema: { drawing: z.unknown(), sheet: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.set_sheet_scale",
      { ...selectedDrawingParams(args), sheetNumber: args["sheetNumber"], scale: args["scale"] },
      drawingMutationResultSchema.extend({ sheet: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const listViewsTool: ToolDefinition = {
  name: "creo_list_drawing_views",
  title: "List Creo drawing views",
  description: "List drawing views, linked models, sheets, scales, and outlines. Read-only.",
  inputSchema: { name: modelName },
  outputSchema: { drawing: z.unknown(), views: z.array(z.unknown()), count: z.number() },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(ctx, "drawing.list_views", selectedDrawingParams(args), drawingViewsResultSchema);
    return ok(result as unknown as Record<string, unknown>);
  },
};

const createGeneralViewTool: ToolDefinition = {
  name: "creo_create_drawing_view",
  title: "Create Creo general drawing view",
  description: "Create a general view of a part or assembly on a drawing sheet and verify it. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    modelName: z.string().optional().describe("Source model; defaults to the drawing's current solid."),
    sheetNumber: z.number().int().positive(),
    locationX: z.number().finite(),
    locationY: z.number().finite(),
    locationZ: z.number().finite().optional(),
    scale: z.number().positive().finite().optional(),
    viewName: z.string().optional(),
  },
  outputSchema: { drawing: z.unknown(), view: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.create_general_view",
      {
        ...selectedDrawingParams(args),
        ...(asString(args["modelName"]) ? { modelName: args["modelName"] } : {}),
        sheetNumber: args["sheetNumber"],
        locationX: args["locationX"],
        locationY: args["locationY"],
        ...(args["locationZ"] !== undefined ? { locationZ: args["locationZ"] } : {}),
        ...(args["scale"] !== undefined ? { scale: args["scale"] } : {}),
        ...(asString(args["viewName"]) ? { viewName: args["viewName"] } : {}),
      },
      drawingMutationResultSchema.extend({ view: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const createProjectionViewTool: ToolDefinition = {
  name: "creo_create_projection_view",
  title: "Create Creo projection view",
  description: "Create a projection view from an existing drawing view and verify it. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    parentViewId: z.number().int().positive(),
    sheetNumber: z.number().int().positive(),
    locationX: z.number().finite(),
    locationY: z.number().finite(),
    locationZ: z.number().finite().optional(),
    viewName: z.string().optional(),
  },
  outputSchema: { drawing: z.unknown(), view: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.create_projection_view",
      {
        ...selectedDrawingParams(args),
        parentViewId: args["parentViewId"],
        sheetNumber: args["sheetNumber"],
        locationX: args["locationX"],
        locationY: args["locationY"],
        ...(args["locationZ"] !== undefined ? { locationZ: args["locationZ"] } : {}),
        ...(asString(args["viewName"]) ? { viewName: args["viewName"] } : {}),
      },
      drawingMutationResultSchema.extend({ view: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const setViewScaleTool: ToolDefinition = {
  name: "creo_set_drawing_view_scale",
  title: "Set Creo drawing view scale",
  description: "Set and verify a drawing view scale. Blocked in read-only safety mode.",
  inputSchema: { name: modelName, viewId: z.number().int().positive(), scale: z.number().positive().finite() },
  outputSchema: { drawing: z.unknown(), operation: z.string(), view: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.set_view_scale",
      { ...selectedDrawingParams(args), viewId: args["viewId"], scale: args["scale"] },
      drawingMutationResultSchema.extend({ operation: z.string(), view: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const renameViewTool: ToolDefinition = {
  name: "creo_rename_drawing_view",
  title: "Rename Creo drawing view",
  description: "Rename a drawing view and verify the name. Blocked in read-only safety mode.",
  inputSchema: { name: modelName, viewId: z.number().int().positive(), viewName: z.string().min(1) },
  outputSchema: { drawing: z.unknown(), operation: z.string(), view: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.rename_view",
      { ...selectedDrawingParams(args), viewId: args["viewId"], viewName: args["viewName"] },
      drawingMutationResultSchema.extend({ operation: z.string(), view: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const deleteViewTool: ToolDefinition = {
  name: "creo_delete_drawing_view",
  title: "Delete Creo drawing view",
  description: "Delete a drawing view and verify it is gone. Blocked in read-only safety mode.",
  inputSchema: { name: modelName, viewId: z.number().int().positive() },
  outputSchema: { drawing: z.unknown(), deletedViewId: z.number(), verified: z.boolean() },
  annotations: DRAWING_DESTRUCTIVE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.delete_view",
      { ...selectedDrawingParams(args), viewId: args["viewId"] },
      drawingMutationResultSchema.extend({ deletedViewId: z.number() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const translateViewTool: ToolDefinition = {
  name: "creo_translate_drawing_view",
  title: "Translate Creo drawing view",
  description: "Translate a drawing view by a vector and return readback. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    viewId: z.number().int().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite().optional(),
  },
  outputSchema: { drawing: z.unknown(), operation: z.string(), view: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.translate_view",
      { ...selectedDrawingParams(args), viewId: args["viewId"], x: args["x"], y: args["y"], ...(args["z"] !== undefined ? { z: args["z"] } : {}) },
      drawingMutationResultSchema.extend({ operation: z.string(), view: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const regenerateViewTool: ToolDefinition = {
  name: "creo_regenerate_drawing_view",
  title: "Regenerate Creo drawing view",
  description: "Regenerate a drawing view and return verified readback. Blocked in read-only safety mode.",
  inputSchema: { name: modelName, viewId: z.number().int().positive() },
  outputSchema: { drawing: z.unknown(), operation: z.string(), view: z.unknown(), verified: z.boolean() },
  annotations: DRAWING_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callDrawing(
      ctx,
      "drawing.regenerate_view",
      { ...selectedDrawingParams(args), viewId: args["viewId"] },
      drawingMutationResultSchema.extend({ operation: z.string(), view: z.unknown() }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

export function drawingTools(): ToolDefinition[] {
  return [
    createDrawingTool,
    saveDrawingTool,
    generateStandardDrawingTool,
    listSheetsTool,
    addSheetTool,
    setSheetScaleTool,
    listViewsTool,
    createGeneralViewTool,
    createProjectionViewTool,
    setViewScaleTool,
    renameViewTool,
    deleteViewTool,
    translateViewTool,
    regenerateViewTool,
  ];
}
