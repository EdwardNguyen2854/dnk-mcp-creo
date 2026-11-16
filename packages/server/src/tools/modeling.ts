// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import path from "node:path";

import { z } from "zod";

import {
  assemblyAssembleResultSchema,
  modelCopyResultSchema,
  modelCreateFromTemplateResultSchema,
  modelCreateResultSchema,
  modelDimensionWriteResultSchema,
  modelFeatureMutationResultSchema,
  modelMutationResultSchema,
  modelParameterWriteResultSchema,
  modelRenameResultSchema,
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

const MODEL_WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE_WRITE_ANNOTATIONS: ToolAnnotations = {
  ...MODEL_WRITE_ANNOTATIONS,
  destructiveHint: true,
};

const modelName = z
  .string()
  .optional()
  .describe("Model name, file name, or full name. Defaults to the active model.");

const MODEL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function requireModelToken(value: unknown, label: string): string {
  const token = asString(value);
  if (!token || !MODEL_NAME.test(token)) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      `${label} must be a Creo model name without a path or extension.`,
    );
  }
  return token;
}

async function callModel<T>(
  ctx: ToolContext,
  method: string,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  await ctx.ensureSession();
  return schema.parse(await ctx.bridge.call(method, params));
}

function selectedModelParams(args: Record<string, unknown>): Record<string, unknown> {
  const name = asString(args["name"]);
  return name ? { name } : {};
}

const saveModelTool: ToolDefinition = {
  name: "creo_save_model",
  title: "Save Creo model",
  description:
    "Save a Creo model and verify that Creo clears its modified flag. " +
    "Blocked when safety.mode is read-only.",
  inputSchema: { name: modelName },
  outputSchema: { model: z.unknown(), verified: z.boolean() },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> =>
    ok(
      (await callModel(ctx, "model.save", selectedModelParams(args), modelMutationResultSchema)) as unknown as Record<string, unknown>,
    ),
};

const renameModelTool: ToolDefinition = {
  name: "creo_rename_model",
  title: "Rename Creo model",
  description:
    "Rename an open Creo model without renaming the file on disk, then verify " +
    "the model name by readback. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    newName: z.string().describe("New Creo model name; paths and extensions are rejected."),
  },
  outputSchema: {
    model: z.unknown(),
    newName: z.string(),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const newName = requireModelToken(args["newName"], "newName");
    const result = await callModel(
      ctx,
      "model.rename",
      { ...selectedModelParams(args), newName },
      modelRenameResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const copyModelTool: ToolDefinition = {
  name: "creo_copy_model",
  title: "Copy Creo model",
  description:
    "Copy an open Creo model into a newly retrieved model with a new name. " +
    "The source remains open and the returned copy is verified by readback.",
  inputSchema: {
    name: modelName,
    newName: z.string().describe("New model name; paths and extensions are rejected."),
  },
  outputSchema: {
    sourceModel: z.unknown(),
    copyModel: z.unknown(),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const newName = requireModelToken(args["newName"], "newName");
    const result = await callModel(
      ctx,
      "model.copy",
      { ...selectedModelParams(args), newName },
      modelCopyResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const regenerateModelTool: ToolDefinition = {
  name: "creo_regenerate_model",
  title: "Regenerate Creo model",
  description:
    "Regenerate a part or assembly and return the regenerated feature tree. " +
    "Blocked in read-only safety mode.",
  inputSchema: { name: modelName },
  outputSchema: {
    model: z.unknown(),
    features: z.array(z.unknown()),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callModel(
      ctx,
      "model.regenerate",
      selectedModelParams(args),
      modelMutationResultSchema.extend({ features: z.array(z.unknown()) }),
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const setParameterTool: ToolDefinition = {
  name: "creo_set_parameter",
  title: "Set Creo model parameter",
  description:
    "Set an existing Creo parameter, or create it when createIfMissing=true, " +
    "then return its typed readback value. Accepts a primitive or {type,value}. " +
    "Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    paramName: z.string().min(1),
    expectedOldValue: z
      .union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.object({ type: z.string().optional(), value: z.unknown() }),
      ])
      .describe("Current value observed before this write; use null only when creating an allowlisted missing parameter."),
    value: z.unknown().describe("String, number, boolean, or {type,value} parameter value."),
    createIfMissing: z.boolean().optional().describe("Create the parameter if it does not exist."),
  },
  outputSchema: {
    model: z.unknown(),
    parameter: z.unknown().nullable(),
    created: z.boolean(),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    if (args["value"] === undefined) {
      throw new CreoMcpError("INVALID_ARGUMENT", "value is required.");
    }
    const result = await callModel(
      ctx,
      "model.set_parameter",
      {
        ...selectedModelParams(args),
        paramName: String(args["paramName"]),
        value: args["value"],
        ...(args["createIfMissing"] === true ? { createIfMissing: true } : {}),
      },
      modelParameterWriteResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

const setDimensionTool: ToolDefinition = {
  name: "creo_set_dimension",
  title: "Set Creo dimension",
  description:
    "Set a model dimension by Creo item id and verify the numeric value by " +
    "readback. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    dimensionId: z.number().int().positive(),
    expectedOldValue: z.number().finite().describe("Current dimension value observed before this write."),
    value: z.number().finite(),
  },
  outputSchema: {
    model: z.unknown(),
    dimension: z.unknown().nullable(),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callModel(
      ctx,
      "model.set_dimension",
      {
        ...selectedModelParams(args),
        dimensionId: args["dimensionId"],
        value: args["value"],
      },
      modelDimensionWriteResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

function featureMutationTool(
  name: string,
  title: string,
  method: string,
  operation: string,
  annotations: ToolAnnotations = MODEL_WRITE_ANNOTATIONS,
): ToolDefinition {
  return {
    name,
    title,
    description:
      `${operation} one or more model features by Creo feature id and verify ` +
      "their status by readback. Blocked in read-only safety mode.",
    inputSchema: {
      name: modelName,
      featureIds: z.array(z.number().int().positive()).min(1),
    },
    outputSchema: {
      model: z.unknown(),
      operation: z.string(),
      features: z.array(z.unknown()),
      verified: z.boolean(),
    },
    annotations,
    writeTool: true,
    handler: async (args, ctx): Promise<ToolResult> => {
      const result = await callModel(
        ctx,
        method,
        { ...selectedModelParams(args), featureIds: args["featureIds"] },
        modelFeatureMutationResultSchema,
      );
      return ok(result as unknown as Record<string, unknown>);
    },
  };
}

const reorderFeatureTool: ToolDefinition = {
  name: "creo_reorder_feature",
  title: "Reorder Creo feature",
  description:
    "Move one feature before or after another feature and verify the affected " +
    "feature by readback. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    featureId: z.number().int().positive(),
    referenceFeatureId: z.number().int().positive(),
    before: z.boolean().optional().describe("Place before the reference (default: after)."),
  },
  outputSchema: {
    model: z.unknown(),
    operation: z.string(),
    features: z.array(z.unknown()),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const result = await callModel(
      ctx,
      "model.features.reorder",
      {
        ...selectedModelParams(args),
        featureId: args["featureId"],
        referenceFeatureId: args["referenceFeatureId"],
        ...(args["before"] === true ? { before: true } : {}),
      },
      modelFeatureMutationResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

function createModelTool(
  name: string,
  title: string,
  method: string,
  description: string,
): ToolDefinition {
  return {
    name,
    title,
    description: `${description} Blocked in read-only safety mode.`,
    inputSchema: {
      modelName: z.string().describe("New model name; paths and extensions are rejected."),
    },
    outputSchema: { model: z.unknown(), verified: z.boolean() },
    annotations: MODEL_WRITE_ANNOTATIONS,
    writeTool: true,
    handler: async (args, ctx): Promise<ToolResult> => {
      const nameValue = requireModelToken(args["modelName"], "modelName");
      const result = await callModel(
        ctx,
        method,
        { name: nameValue },
        modelCreateResultSchema,
      );
      return ok(result as unknown as Record<string, unknown>);
    },
  };
}

const PART_TEMPLATES = [
  "mmns_part_solid_abs.prt",
  "mmns_part_solid_rel.prt",
  "inlbs_part_solid_abs.prt",
  "inlbs_part_solid_rel.prt",
] as const;

const createPartFromTemplateTool: ToolDefinition = {
  name: "creo_create_part_from_template",
  title: "Create Creo part from template",
  description:
    "Create a new part by copying a whitelisted Creo solid-part template " +
    "into Creo's working directory and retrieving it. Template parts carry " +
    "the default datum planes, so sketch-based features (extrude, revolve) " +
    "work immediately. Blocked in read-only safety mode.",
  inputSchema: {
    modelName: z
      .string()
      .describe("New model name; paths and extensions are rejected."),
    template: z
      .enum(PART_TEMPLATES)
      .optional()
      .describe("Part template file (default mmns_part_solid_abs.prt)."),
  },
  outputSchema: {
    created: z.boolean(),
    template: z.string(),
    model: z.unknown().nullable(),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const nameValue = requireModelToken(args["modelName"], "modelName");
    const template =
      asString(args["template"]) ?? "mmns_part_solid_abs.prt";
    if (!(PART_TEMPLATES as readonly string[]).includes(template)) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        `${template} is not a permitted Creo part template.`,
        { details: { allowed: [...PART_TEMPLATES] } },
      );
    }
    const installDir = ctx.config.creo.installDir;
    if (!installDir) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "The Creo install directory is not configured; template retrieval " +
          "is unavailable. Set creo.installDir or CREO_INSTALL_DIR.",
      );
    }
    const templateDir = path.join(installDir, "Common Files", "templates");
    const result = await callModel(
      ctx,
      "model.create_from_template",
      { templateDir, template, name: nameValue },
      modelCreateFromTemplateResultSchema,
    );
    if (!result.verified || !result.model) {
      throw new CreoMcpError(
        "VERIFY_FAILED",
        `Creo did not report the model created from ${template}.`,
        { details: { result } },
      );
    }
    return ok({
      created: result.created,
      template: result.template,
      model: result.model,
      verified: true,
    });
  },
};

const assembleComponentTool: ToolDefinition = {
  name: "creo_assemble_component",
  title: "Assemble Creo component",
  description:
    "Assemble an open part or subassembly into an assembly, optionally " +
    "translated by x/y/z in model units, and verify the component by readback. " +
    "The component is retrieved from Creo's working directory when it is not " +
    "already open. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    component: z
      .string()
      .min(1)
      .describe(
        "Component model name or plain file name (e.g. base or base.prt). " +
          "Paths are rejected.",
      ),
    x: z.number().finite().optional().describe("X offset in model units."),
    y: z.number().finite().optional().describe("Y offset in model units."),
    z: z.number().finite().optional().describe("Z offset in model units."),
  },
  outputSchema: {
    assembly: z.unknown(),
    component: z.unknown(),
    feature: z.unknown(),
    features: z.array(z.unknown()),
    verified: z.boolean(),
  },
  annotations: MODEL_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    const component = asString(args["component"]);
    if (!component || component.includes("..") || /[\\/]/.test(component)) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "component must be a model name or plain file name without a path.",
      );
    }
    const result = await callModel(
      ctx,
      "assembly.assemble_component",
      {
        ...selectedModelParams(args),
        component,
        ...(args["x"] !== undefined ? { x: args["x"] } : {}),
        ...(args["y"] !== undefined ? { y: args["y"] } : {}),
        ...(args["z"] !== undefined ? { z: args["z"] } : {}),
      },
      assemblyAssembleResultSchema,
    );
    return ok(result as unknown as Record<string, unknown>);
  },
};

export function modelingTools(): ToolDefinition[] {
  return [
    saveModelTool,
    renameModelTool,
    copyModelTool,
    regenerateModelTool,
    setParameterTool,
    setDimensionTool,
    featureMutationTool(
      "creo_suppress_features",
      "Suppress Creo features",
      "model.features.suppress",
      "Suppress",
    ),
    featureMutationTool(
      "creo_resume_features",
      "Resume Creo features",
      "model.features.resume",
      "Resume",
    ),
    featureMutationTool(
      "creo_delete_features",
      "Delete Creo features",
      "model.features.delete",
      "Delete",
      DESTRUCTIVE_WRITE_ANNOTATIONS,
    ),
    reorderFeatureTool,
    createModelTool(
      "creo_create_part",
      "Create Creo part",
      "model.create_part",
      "Create a new empty Creo part and return its model information.",
    ),
    createModelTool(
      "creo_create_assembly",
      "Create Creo assembly",
      "model.create_assembly",
      "Create a new empty Creo assembly and return its model information.",
    ),
    createPartFromTemplateTool,
    assembleComponentTool,
  ];
}
