// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import { modelExportResultSchema } from "../bridge/protocol.js";
import { CreoMcpError } from "../errors.js";
import {
  asString,
  ok,
  type ToolAnnotations,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./registry.js";

const SESSION_MUTATING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const BARE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/;

function assertBareFileName(fileName: string): void {
  if (!BARE_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      `'${fileName}' is not a plain file name. Export tools only accept files ` +
        "that are direct children of Creo's live working directory; " +
        "separators, '..', absolute paths, and UNC paths are rejected.",
      { details: { fileName } },
    );
  }
}

function buildExportCall(
  bridgeMethod: string,
  args: Record<string, unknown>,
  options: Record<string, unknown> = {},
): { bridgeMethod: string; params: Record<string, unknown> } {
  const name = asString(args["name"]);
  const fileName = asString(args["fileName"]);
  if (!fileName) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      `${bridgeMethod.replace("model.", "creo_export_")} requires a fileName ` +
        "parameter.",
    );
  }
  assertBareFileName(fileName);
  const params: Record<string, unknown> = { fileName };
  if (name) {
    params["name"] = name;
  }
  if (args["overwrite"] === true) {
    params["overwrite"] = true;
  }
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      params[key] = value;
    }
  }
  return { bridgeMethod, params };
}

async function runExport(
  ctx: ToolContext,
  call: { bridgeMethod: string; params: Record<string, unknown> },
): Promise<ToolResult> {
  await ctx.ensureSession();
  const raw = await ctx.bridge.call(call.bridgeMethod, call.params);
  const parsed = modelExportResultSchema.parse(raw);
  return ok({
    model: parsed.model,
    path: parsed.path,
    sizeBytes: parsed.sizeBytes,
    verified: parsed.verified,
  });
}

function describeExport(fileExtension: string, extraNotes: string): string {
  return (
    `Write a ${fileExtension} file in Creo's working directory from an open ` +
    `model. Output is verified by size readback after export. ${extraNotes} ` +
    `Gated by safety.mode; read-only mode blocks this tool.`
  );
}

const stepTool: ToolDefinition = {
  name: "creo_export_step",
  title: "Export Creo model to STEP",
  description:
    describeExport(".stp", "Accepts parts and assemblies."),
  inputSchema: {
    name: z
      .string()
      .optional()
      .describe(
        "Model name, file name, or full name. Defaults to the active model.",
      ),
    fileName: z
      .string()
      .describe(
        "Bare file name with extension, e.g. bracket.stp. Resolved against " +
          "Creo's working directory; paths are rejected.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .describe("Replace an existing file (default: false)."),
  },
  outputSchema: {
    model: z.unknown(),
    path: z.string(),
    sizeBytes: z.number(),
    verified: z.boolean(),
  },
  annotations: SESSION_MUTATING_ANNOTATIONS,
  writeTool: true,
  handler: (args, ctx) =>
    runExport(ctx, buildExportCall("model.export_step", args)),
};

const igesTool: ToolDefinition = {
  name: "creo_export_iges",
  title: "Export Creo model to IGES",
  description: describeExport(".igs", "Accepts parts and assemblies."),
  inputSchema: {
    name: z.string().optional(),
    fileName: z.string().describe("Bare file name, e.g. bracket.igs."),
    overwrite: z.boolean().optional(),
  },
  outputSchema: {
    model: z.unknown(),
    path: z.string(),
    sizeBytes: z.number(),
    verified: z.boolean(),
  },
  annotations: SESSION_MUTATING_ANNOTATIONS,
  writeTool: true,
  handler: (args, ctx) =>
    runExport(ctx, buildExportCall("model.export_iges", args)),
};

const stlTool: ToolDefinition = {
  name: "creo_export_stl",
  title: "Export Creo solid to STL",
  description: describeExport(
    ".stl",
    "Solid-only (parts). Assemblies must be exported to STEP first, then " +
      "meshed externally.",
  ),
  inputSchema: {
    name: z.string().optional(),
    fileName: z.string().describe("Bare file name, e.g. bracket.stl."),
    overwrite: z.boolean().optional(),
    mode: z
      .enum(["ascii", "binary"])
      .optional()
      .describe("STL encoding (default: ascii)."),
  },
  outputSchema: {
    model: z.unknown(),
    path: z.string(),
    sizeBytes: z.number(),
    verified: z.boolean(),
  },
  annotations: SESSION_MUTATING_ANNOTATIONS,
  writeTool: true,
  handler: (args, ctx) => {
    const mode = asString(args["mode"]);
    return runExport(
      ctx,
      buildExportCall("model.export_stl", args, { mode: mode ?? "ascii" }),
    );
  },
};

const pdfTool: ToolDefinition = {
  name: "creo_export_pdf",
  title: "Export Creo drawing to PDF",
  description: describeExport(
    ".pdf",
    "Drawing-only in this build (3D PDF is not exposed by the available " +
      "Pro/TOOLKIT for Creo 9.0.2.0). Pass mode='drawing' (default) for " +
      "the active drawing, or mode='auto' to let the bridge pick.",
  ),
  inputSchema: {
    name: z.string().optional(),
    fileName: z.string().describe("Bare file name, e.g. bracket.pdf."),
    overwrite: z.boolean().optional(),
    mode: z
      .enum(["auto", "drawing"])
      .optional()
      .describe(
        "Force a specific export (default: auto). 'drawing' requires a " +
          "drawing model.",
      ),
  },
  outputSchema: {
    model: z.unknown(),
    path: z.string(),
    sizeBytes: z.number(),
    verified: z.boolean(),
  },
  annotations: SESSION_MUTATING_ANNOTATIONS,
  writeTool: true,
  handler: (args, ctx) => {
    const mode = asString(args["mode"]);
    return runExport(
      ctx,
      buildExportCall("model.export_pdf", args, { mode: mode ?? "auto" }),
    );
  },
};

const dxfTool: ToolDefinition = {
  name: "creo_export_dxf",
  title: "Export Creo drawing to DXF",
  description: describeExport(
    ".dxf",
    "Drawing-only. Exports the default drawing view.",
  ),
  inputSchema: {
    name: z.string().optional(),
    fileName: z.string().describe("Bare file name, e.g. bracket.dxf."),
    overwrite: z.boolean().optional(),
  },
  outputSchema: {
    model: z.unknown(),
    path: z.string(),
    sizeBytes: z.number(),
    verified: z.boolean(),
  },
  annotations: SESSION_MUTATING_ANNOTATIONS,
  writeTool: true,
  handler: (args, ctx) =>
    runExport(ctx, buildExportCall("model.export_dxf", args)),
};

export function exportTools(): ToolDefinition[] {
  return [stepTool, igesTool, stlTool, pdfTool, dxfTool];
}
