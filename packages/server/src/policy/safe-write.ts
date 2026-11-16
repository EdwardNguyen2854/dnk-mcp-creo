// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdtemp,
  readdir,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  drawingSheetsResultSchema,
  drawingViewsResultSchema,
  modelCopyResultSchema,
  modelDimensionsResultSchema,
  modelFeaturesResultSchema,
  modelInfoResultSchema,
  modelListResultSchema,
  modelParametersResultSchema,
  modelRelationsResultSchema,
  sessionInfoSchema,
  type ModelInfo,
  type SessionInfo,
} from "../bridge/protocol.js";
import { CreoMcpError, isCreoMcpError } from "../errors.js";
import type { ToolContext, ToolDefinition, ToolResult } from "../tools/registry.js";

const NEW_MODEL_TOOLS = new Set([
  "creo_create_part",
  "creo_create_assembly",
  "creo_create_part_from_template",
]);
const NEW_DRAWING_TOOLS = new Set([
  "creo_create_drawing",
  "creo_generate_standard_drawing",
]);
const EXPLICIT_COPY_TOOLS = new Set(["creo_copy_model"]);
const EXPORT_TOOLS = new Set([
  "creo_export_step",
  "creo_export_iges",
  "creo_export_stl",
  "creo_export_pdf",
  "creo_export_dxf",
]);
const DRAWING_EDIT_TOOLS = new Set([
  "creo_save_drawing",
  "creo_add_drawing_sheet",
  "creo_set_drawing_sheet_scale",
  "creo_create_drawing_view",
  "creo_create_projection_view",
  "creo_set_drawing_view_scale",
  "creo_rename_drawing_view",
  "creo_delete_drawing_view",
  "creo_translate_drawing_view",
  "creo_regenerate_drawing_view",
]);
const MODEL_EDIT_TOOLS = new Set([
  "creo_save_model",
  "creo_rename_model",
  "creo_regenerate_model",
  "creo_set_parameter",
  "creo_set_dimension",
  "creo_suppress_features",
  "creo_resume_features",
  "creo_delete_features",
  "creo_reorder_feature",
  "creo_assemble_component",
  "creo_create_extrude",
  "creo_create_revolve",
  "creo_create_round",
  "creo_create_chamfer",
  "creo_create_shell",
  "creo_create_datum_plane",
  "creo_create_datum_axis",
  "creo_create_datum_point",
  "creo_create_hole",
  "creo_create_pattern",
]);

interface WritePlan {
  kind: "new-model" | "new-drawing" | "copy-model" | "model-edit" | "drawing-edit" | "export";
  mode: string;
  allowed?: boolean;
  blockedReason?: Record<string, unknown>;
  target: string;
  source?: ModelInfo;
  copyName?: string;
  filePath?: string;
  outputFile?: string;
  outputExists?: boolean;
  ownedOutputs?: string[];
  checks: string[];
}

interface VerifiedBackup {
  originalPath: string;
  backupPath: string;
  directory: string;
  digest: string;
  size: number;
  model?: ModelInfo;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function requireStringArg(
  args: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = stringArg(args, key);
  if (!value) {
    throw new CreoMcpError("INVALID_ARGUMENT", `${label} is required.`);
  }
  return value;
}

function fileExtension(model: ModelInfo): string {
  if (model.type === "assembly") return ".asm";
  if (model.type === "drawing") return ".drw";
  return ".prt";
}

function isBareFileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/.test(value) &&
    !value.includes("..") &&
    !/[\\/]/.test(value) &&
    path.basename(value) === value;
}

function assertModelToken(value: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new CreoMcpError("INVALID_ARGUMENT", `${label} must be a plain Creo model token without a path or extension.`);
  }
}

function assertDrawingName(value: string): void {
  if (value.includes("..") || (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.drw$/i.test(value)) || /[\\/]/.test(value)) {
    throw new CreoMcpError("INVALID_ARGUMENT", "drawingName must be a plain Creo drawing token or .drw file name.");
  }
}

function canonicalChildPath(directory: string, fileName: string): string {
  if (!isBareFileName(fileName)) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      "Safe writes accept only a plain direct-child file name.",
      { details: { fileName } },
    );
  }
  const base = path.resolve(directory);
  const candidate = path.resolve(base, fileName);
  if (path.dirname(candidate).toLowerCase() !== base.toLowerCase()) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      "The write target must remain directly inside Creo's working directory.",
      { details: { fileName, directory } },
    );
  }
  return candidate;
}

function modelFileName(name: string, extension: string): string {
  return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}${extension}`;
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0 ||
    left.toUpperCase() === right.toUpperCase();
}

function identityMatches(model: ModelInfo, expected: string): boolean {
  return [model.name, model.fullName, model.fileName].some((candidate) =>
    sameName(candidate, expected),
  );
}

function throwIfNoModel(model: ModelInfo | null, name?: string): ModelInfo {
  if (!model) {
    throw new CreoMcpError(
      "MODEL_NOT_FOUND",
      name
        ? `Model '${name}' was not found in the current Creo session.`
        : "There is no active model in the current Creo session.",
    );
  }
  return model;
}

async function resolveModel(
  context: ToolContext,
  name?: string,
): Promise<ModelInfo> {
  const params = name ? { name } : {};
  const raw = await context.bridge.call("model.info", params);
  const result = modelInfoResultSchema.parse(raw);
  return throwIfNoModel(result.model, name);
}

async function listModels(context: ToolContext): Promise<ModelInfo[]> {
  const result = modelListResultSchema.parse(
    await context.bridge.call("model.list", { type: "all" }),
  );
  return result.models;
}

function assertExpectedIdentity(
  args: Record<string, unknown>,
  model: ModelInfo,
): void {
  const expected = stringArg(args, "expectedModelName");
  if (expected && !identityMatches(model, expected)) {
    throw new CreoMcpError(
      "MODEL_IDENTITY_MISMATCH",
      `Expected model '${expected}', but the resolved target is '${model.name}'.`,
      { details: { expected, actual: model } },
    );
  }
}

async function sessionForWrite(
  context: ToolContext,
  dryRun: boolean,
): Promise<SessionInfo> {
  const session = dryRun
    ? sessionInfoSchema.parse(await context.bridge.call("session.info"))
    : await context.ensureSession();
  if (!session.connected) {
    throw new CreoMcpError(
      "SESSION_NOT_CONNECTED",
      dryRun
        ? "dryRun does not attach to Creo; connect an existing session before requesting a write plan."
        : "The Creo session is not connected.",
      { retryable: true },
    );
  }
  if (!session.workingDirectory) {
    throw new CreoMcpError(
      "SAFE_WRITE_UNAVAILABLE",
      "Creo did not report a working directory; safe path containment cannot be verified.",
    );
  }
  return session;
}

async function assertUniqueModelFile(
  context: ToolContext,
  session: SessionInfo,
  name: string,
  extension: string,
  except?: ModelInfo,
): Promise<string> {
  const fileName = modelFileName(name, extension);
  const filePath = canonicalChildPath(session.workingDirectory as string, fileName);
  const openModels = await listModels(context);
  const collision = openModels.find(
    (model) =>
      model !== except &&
      (sameName(model.name, name) || sameName(model.fileName, fileName)),
  );
  if (collision) {
    throw new CreoMcpError(
      "FILE_EXISTS",
      `A Creo model named '${name}' is already open; safe creation requires a unique target.`,
      { details: { name, collision } },
    );
  }
  if (await pathExists(filePath)) {
    throw new CreoMcpError(
      "FILE_EXISTS",
      `The target file '${fileName}' already exists in Creo's working directory.`,
      { details: { filePath } },
    );
  }
  const versionedFiles = await creoVersionedSiblings(filePath);
  if (versionedFiles.length > 0) {
    throw new CreoMcpError(
      "FILE_EXISTS",
      `Creo version files already exist for '${fileName}'; safe creation requires an unused target name.`,
      { details: { filePath, versionedFiles } },
    );
  }
  return filePath;
}

async function assertUniqueDrawingFile(
  context: ToolContext,
  session: SessionInfo,
  name: string,
): Promise<string> {
  const modelName = name.replace(/\.drw$/i, "");
  const fileName = /\.drw$/i.test(name) ? name : `${name}.drw`;
  const filePath = canonicalChildPath(session.workingDirectory as string, fileName);
  const openModels = await listModels(context);
  const collision = openModels.find((model) => sameName(model.name, modelName) || sameName(model.fileName, fileName));
  if (collision) {
    throw new CreoMcpError("FILE_EXISTS", `A Creo model named '${modelName}' is already open; safe drawing creation requires a unique target.`, { details: { name: modelName, collision } });
  }
  if (await pathExists(filePath)) throw new CreoMcpError("FILE_EXISTS", `The target drawing file '${fileName}' already exists in Creo's working directory.`, { details: { filePath } });
  const versionedFiles = await creoVersionedSiblings(filePath);
  if (versionedFiles.length > 0) {
    throw new CreoMcpError(
      "FILE_EXISTS",
      `Creo version files already exist for '${fileName}'; safe creation requires an unused target name.`,
      { details: { filePath, versionedFiles } },
    );
  }
  return filePath;
}

const CREO_MODEL_NAME_LIMIT = 31;
const COPY_NAME_SUFFIX = "_MCP_COPY";
const COPY_ATTEMPT_SUFFIX_LIMIT = "_100".length;
const COPY_NAME_BASE_LIMIT =
  CREO_MODEL_NAME_LIMIT - COPY_NAME_SUFFIX.length - COPY_ATTEMPT_SUFFIX_LIMIT;

function safeCopyName(source: ModelInfo, attempt: number): string {
  const base =
    source.name
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .replace(/^[^A-Za-z]+/, "MODEL_")
      .slice(0, COPY_NAME_BASE_LIMIT) || "MODEL";
  return `${base}${COPY_NAME_SUFFIX}${attempt === 1 ? "" : `_${attempt}`}`;
}

async function allocateCopyName(
  context: ToolContext,
  session: SessionInfo,
  source: ModelInfo,
  reservedNames: string[] = [],
): Promise<{ name: string; filePath: string }> {
  const openModels = await listModels(context);
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const name = safeCopyName(source, attempt);
    if (reservedNames.some((reserved) => sameName(reserved, name))) continue;
    const fileName = modelFileName(name, fileExtension(source));
    if (openModels.some((model) => sameName(model.name, name) || sameName(model.fileName, fileName))) {
      continue;
    }
    const filePath = canonicalChildPath(session.workingDirectory as string, fileName);
    if (await pathExists(filePath)) continue;
    if ((await creoVersionedSiblings(filePath)).length > 0) continue;
    return { name, filePath };
  }
  throw new CreoMcpError(
    "SAFE_WRITE_UNAVAILABLE",
    `Could not allocate a unique isolated copy name for '${source.name}'.`,
  );
}

function outputPathForName(session: SessionInfo, fileName: string): string {
  return canonicalChildPath(session.workingDirectory as string, fileName);
}

function canonicalModelPath(model: ModelInfo, session: SessionInfo): string {
  if (!session.workingDirectory || !model.fileName) {
    throw new CreoMcpError("LIVE_BACKUP_UNAVAILABLE", "Creo did not report a model file name and working directory for a canonical backup target.", { details: { model, workingDirectory: session.workingDirectory } });
  }
  const targetPath = canonicalChildPath(session.workingDirectory, modelFileName(model.fileName, fileExtension(model)));
  // `fullName` is a Creo identity/name field, not proof of the file actually
  // backing the open object. Only the bridge's explicit `path` readback may
  // authorize a live backup of a working-directory file.
  const reportedPath = typeof model.path === "string" ? model.path.trim() : "";
  if (!reportedPath) {
    throw new CreoMcpError("LIVE_BACKUP_UNAVAILABLE", "Creo did not report the open model's actual path; live backup cannot be safely bound to a same-named working-directory file.", { details: { model, targetPath } });
  }
  const resolvedReportedPath = path.resolve(path.isAbsolute(reportedPath) ? reportedPath : path.join(session.workingDirectory, reportedPath));
  if (resolvedReportedPath.toLowerCase() !== path.resolve(targetPath).toLowerCase()) {
    throw new CreoMcpError("LIVE_BACKUP_UNAVAILABLE", "The open model's reported path does not match the canonical backup target.", { details: { model: model.name, reportedPath, resolvedReportedPath, targetPath } });
  }
  return targetPath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const entry = await lstat(filePath);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink > 1) {
      throw new CreoMcpError(
        "SAFE_WRITE_UNAVAILABLE",
        "Safe writes reject symbolic links, non-regular files, and hard-linked targets.",
        { details: { filePath, symbolicLink: entry.isSymbolicLink(), regularFile: entry.isFile(), links: entry.nlink } },
      );
    }
    return true;
  } catch (error) {
    if (isCreoMcpError(error)) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function creoVersionedSiblings(filePath: string): Promise<string[]> {
  const directory = path.dirname(filePath);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new CreoMcpError(
      "SAFE_WRITE_UNAVAILABLE",
      `Cannot inspect Creo version files beside '${filePath}'.`,
      { cause: error, details: { filePath, directory } },
    );
  }
  const baseName = path.basename(filePath).toLowerCase();
  const versionPrefix = `${baseName}.`;
  return entries
    .filter((entry) => {
      const candidate = entry.toLowerCase();
      if (!candidate.startsWith(versionPrefix)) return false;
      return /^\d+$/.test(candidate.slice(versionPrefix.length));
    })
    .map((entry) => path.join(directory, entry));
}

function classify(toolName: string): WritePlan["kind"] {
  if (NEW_MODEL_TOOLS.has(toolName)) return "new-model";
  if (NEW_DRAWING_TOOLS.has(toolName)) return "new-drawing";
  if (EXPLICIT_COPY_TOOLS.has(toolName)) return "copy-model";
  if (EXPORT_TOOLS.has(toolName)) return "export";
  if (DRAWING_EDIT_TOOLS.has(toolName)) return "drawing-edit";
  if (MODEL_EDIT_TOOLS.has(toolName)) return "model-edit";
  throw new CreoMcpError(
    "SAFE_WRITE_UNAVAILABLE",
    `No approved safe-write strategy is registered for '${toolName}'.`,
    { details: { tool: toolName } },
  );
}

async function buildPlan(
  context: ToolContext,
  definition: ToolDefinition,
  args: Record<string, unknown>,
  session: SessionInfo,
): Promise<WritePlan> {
  const kind = classify(definition.name);
  const mode = context.config.safety.mode;
  const checks = ["write-tool policy", "target identity", "readback verification"];
  if (kind === "drawing-edit" && mode === "copy") {
    throw new CreoMcpError(
      "SAFE_WRITE_UNAVAILABLE",
      `Copy mode cannot safely edit an existing drawing because the bridge has no verified drawing-copy operation; '${definition.name}' was blocked before mutation.`,
      { details: { tool: definition.name, mode } },
    );
  }

  if (kind === "new-model") {
    const name = requireStringArg(args, "modelName", "modelName");
    assertModelToken(name, "modelName");
    if (definition.name === "creo_create_part_from_template" && !context.config.creo.installDir) {
      throw new CreoMcpError("SAFE_WRITE_UNAVAILABLE", "Part-template creation requires a configured Creo install directory.");
    }
    const expectedNewName = stringArg(args, "expectedModelName");
    if (expectedNewName && !sameName(expectedNewName, name)) {
      throw new CreoMcpError("MODEL_IDENTITY_MISMATCH", `Expected new model name '${expectedNewName}' does not match requested target '${name}'.`, { details: { expected: expectedNewName, requested: name } });
    }
    const extension = definition.name === "creo_create_assembly" ? ".asm" : ".prt";
    const filePath = await assertUniqueModelFile(context, session, name, extension);
    checks.push("new model name and file are non-colliding");
    return { kind, mode, target: name, filePath, checks };
  }

  if (kind === "new-drawing") {
    const drawingName = requireStringArg(args, "drawingName", "drawingName");
    assertDrawingName(drawingName);
    const templateName = requireStringArg(args, "templateName", "templateName");
    if (!isBareFileName(templateName) || !/\.(drw|frm)$/i.test(templateName)) throw new CreoMcpError("INVALID_ARGUMENT", "templateName must be a plain .drw/.frm template file name.");
    if (definition.name === "creo_generate_standard_drawing") {
      const views = args["views"];
      if (!Array.isArray(views) || !views.some((view) => view && typeof view === "object" && (view as Record<string, unknown>)["kind"] === "front")) {
        throw new CreoMcpError("INVALID_ARGUMENT", "Standard drawing generation requires a front view to anchor projections.");
      }
      const hasExports = [args["pdfFileName"], args["dxfFileName"]].some((value) => typeof value === "string" && value.length > 0);
      if (hasExports && (!context.config.tools.packs.includes("export") || args["save"] === false)) {
        throw new CreoMcpError("INVALID_ARGUMENT", "PDF/DXF generation requires the export pack and save=true.");
      }
    }
    const source = await resolveModel(context, stringArg(args, "modelName"));
    assertExpectedIdentity(args, source);
    if (source.type !== "part" && source.type !== "assembly") {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "A new drawing must reference a part or assembly model.",
        { details: { source } },
      );
    }
    const filePath = await assertUniqueDrawingFile(context, session, drawingName);
    const embeddedExports = [
      ...(typeof args["pdfFileName"] === "string" && args["pdfFileName"].length > 0 ? [["pdfFileName", args["pdfFileName"]] as const] : []),
      ...(typeof args["dxfFileName"] === "string" && args["dxfFileName"].length > 0 ? [["dxfFileName", args["dxfFileName"]] as const] : []),
    ];
    const ownedOutputs: string[] = [];
    if (args["overwrite"] === true && embeddedExports.length > 0) {
      throw new CreoMcpError(
        "SAFE_WRITE_UNAVAILABLE",
        "Generated-drawing PDF/DXF overwrites are blocked because a multi-output transaction cannot guarantee atomic recovery; use fresh output filenames.",
      );
    }
    for (const [field, output] of embeddedExports) {
      if (!isBareFileName(output)) {
        throw new CreoMcpError("INVALID_ARGUMENT", `Unsafe export file name '${output}'.`);
      }
      const extension = field === "pdfFileName" ? ".pdf" : ".dxf";
      if (!output.toLowerCase().endsWith(extension)) {
        throw new CreoMcpError("INVALID_ARGUMENT", `${field} must use the ${extension} extension.`);
      }
      const outputPath = outputPathForName(session, output);
      if (await pathExists(outputPath)) {
        throw new CreoMcpError("FILE_EXISTS", `Generated output '${output}' already exists.`, { details: { outputPath } });
      }
      ownedOutputs.push(outputPath);
    }
    checks.push("source model identity resolved", "new drawing name and file are non-colliding");
    if (ownedOutputs.length > 0) checks.push("all optional export outputs are fresh paths and will be cleaned on failure");
    return { kind, mode, target: drawingName, source, filePath, ...(ownedOutputs.length > 0 ? { ownedOutputs } : {}), checks };
  }

  if (kind === "copy-model") {
    const source = await resolveModel(context, stringArg(args, "name"));
    assertExpectedIdentity(args, source);
    if (source.type !== "part" && source.type !== "assembly") {
      throw new CreoMcpError("SAFE_WRITE_UNAVAILABLE", "Only parts and assemblies may be copied through the approved model-copy path.");
    }
    const newName = requireStringArg(args, "newName", "newName");
    assertModelToken(newName, "newName");
    const filePath = await assertUniqueModelFile(context, session, newName, fileExtension(source));
    checks.push("source identity resolved", "copy name and file are non-colliding", "copy result must identify a distinct model");
    return { kind, mode, target: newName, source, filePath, checks };
  }

  if (kind === "export") {
    const source = await resolveModel(context, stringArg(args, "name"));
    assertExpectedIdentity(args, source);
    const requiresDrawing = definition.name === "creo_export_pdf" || definition.name === "creo_export_dxf";
    if (requiresDrawing ? source.type !== "drawing" : source.type !== "part" && source.type !== "assembly") {
      throw new CreoMcpError("INVALID_ARGUMENT", `Export tool '${definition.name}' requires ${requiresDrawing ? "a drawing" : "a part or assembly"} model; the target has type '${source.type}'.`, { details: { model: source.name, type: source.type } });
    }
    if (definition.name === "creo_export_stl" && source.type !== "part") {
      throw new CreoMcpError("INVALID_ARGUMENT", "STL export requires a part model.", { details: { model: source.name, type: source.type } });
    }
    const fileName = requireStringArg(args, "fileName", "fileName");
    if (!isBareFileName(fileName)) {
      throw new CreoMcpError("INVALID_ARGUMENT", `Unsafe export file name '${fileName}'.`);
    }
    const outputFile = outputPathForName(session, fileName);
    const outputExists = await pathExists(outputFile);
    if (outputExists && args["overwrite"] !== true) {
      throw new CreoMcpError(
        "FILE_EXISTS",
        `Export target '${fileName}' already exists; set overwrite=true only when a verified backup can be made.`,
        { details: { outputFile } },
      );
    }
    checks.push("source identity resolved", "export path is contained in Creo's working directory");
    if (outputExists) checks.push("existing output will be backed up and restored on failure");
    else checks.push("export target is new; source model is not modified");
    return { kind, mode, target: source.name, source, outputFile, outputExists, checks };
  }

  const targetName = stringArg(args, "name");
  const source = await resolveModel(context, targetName);
  assertExpectedIdentity(args, source);
  if (kind === "drawing-edit" && source.type !== "drawing") {
    throw new CreoMcpError("INVALID_ARGUMENT", "The selected target is not a drawing.", { details: { source } });
  }
  if (kind === "model-edit" && (source.type === "drawing" || source.type === "unknown")) {
    throw new CreoMcpError("INVALID_ARGUMENT", "The selected target is not an editable part or assembly.", { details: { source } });
  }
  if (kind === "model-edit" && definition.name === "creo_assemble_component" && source.type !== "assembly") {
    throw new CreoMcpError("INVALID_ARGUMENT", "Component assembly requires an assembly target.", { details: { source } });
  }
  if (kind === "model-edit" && definition.name.startsWith("creo_create_") && source.type !== "part") {
    throw new CreoMcpError("INVALID_ARGUMENT", "Feature creation requires a part target.", { details: { source } });
  }

  let renameTarget: { name: string } | undefined;
  if (definition.name === "creo_rename_model") {
    const newName = requireStringArg(args, "newName", "newName");
    assertModelToken(newName, "newName");
    await assertUniqueModelFile(context, session, newName, fileExtension(source), source);
    if (sameName(newName, source.name)) {
      throw new CreoMcpError("INVALID_ARGUMENT", "newName must differ from the current model name.");
    }
    renameTarget = { name: newName };
    checks.push("rename destination is non-colliding");
  }

  await assertWriteGuards(context, definition.name, args, source);
  checks.push("expected-old-value and relation/range/allowlist guards");
  await assertReferences(context, definition.name, args, source);
  checks.push("session-scoped references re-listed against target identity");

  if (kind === "model-edit" && mode === "copy") {
    const allocated = await allocateCopyName(context, session, source, renameTarget ? [renameTarget.name] : []);
    checks.push("operation will run against a verified new model copy", "source state will be checked after mutation");
    return {
      kind,
      mode,
      target: allocated.name,
      source,
      copyName: allocated.name,
      filePath: allocated.filePath,
      checks,
    };
  }

  const filePath = canonicalModelPath(source, session);
  if (mode === "live") {
    if (source.isModified) {
      throw new CreoMcpError(
        "LIVE_BACKUP_UNSAFE",
        `Live mode refuses to modify '${source.name}' because it already has unsaved changes that cannot be represented by a disk backup.`,
        { details: { source } },
      );
    }
    if (!(await pathExists(filePath))) {
      throw new CreoMcpError(
        "LIVE_BACKUP_UNAVAILABLE",
        `Live mode requires an existing, readable model file before '${definition.name}' can run.`,
        { details: { filePath, model: source } },
      );
    }
    checks.push("unmodified source file is available for verified backup and rollback");
  }
  return { kind, mode, target: source.name, source, filePath, checks };
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return value;
}

async function snapshotModel(context: ToolContext, model: ModelInfo): Promise<string> {
  const name = model.name;
  const info = modelInfoResultSchema.parse(await context.bridge.call("model.info", { name })).model;
  const snapshot = model.type === "drawing"
    ? {
        info,
        sheets: drawingSheetsResultSchema.parse(await context.bridge.call("drawing.list_sheets", { name })).sheets,
        views: drawingViewsResultSchema.parse(await context.bridge.call("drawing.list_views", { name })).views,
      }
    : {
        info,
        parameters: modelParametersResultSchema.parse(await context.bridge.call("model.parameters", { name })).parameters,
        dimensions: modelDimensionsResultSchema.parse(await context.bridge.call("model.dimensions", { name })).dimensions,
        features: modelFeaturesResultSchema.parse(await context.bridge.call("model.features", { name })).features,
        relations: modelRelationsResultSchema.parse(await context.bridge.call("model.relations", { name })).relations,
        geometry: await context.bridge.call("model.geometry", { name }),
        massProperties: await context.bridge.call("model.mass_properties", { name }),
      };
  return JSON.stringify(normalizeJson(snapshot));
}

function expectedOldMatches(actualValue: unknown, expected: unknown): boolean {
  if (actualValue && typeof actualValue === "object" && "value" in actualValue) {
    const actual = actualValue as { type?: unknown; value?: unknown };
    if (expected && typeof expected === "object" && "value" in expected) {
      const wanted = expected as { type?: unknown; value?: unknown };
      return actual.value === wanted.value &&
        (wanted.type === undefined || actual.type === wanted.type);
    }
    return actual.value === expected;
  }
  return actualValue === expected;
}

async function assertWriteGuards(
  context: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  model: ModelInfo,
): Promise<void> {
  if (toolName === "creo_set_parameter") {
    const name = requireStringArg(args, "paramName", "paramName");
    const allowlist = (context.config.safety.parameterAllowlist ?? []).map((value) => value.toUpperCase());
    if (!allowlist.includes(name.toUpperCase())) {
      throw new CreoMcpError(
        "POLICY_BLOCKED",
        `Parameter '${name}' is not in safety.parameterAllowlist; parameter writes are deny-all by default.`,
        { details: { parameter: name, allowlist } },
      );
    }
    if (!Object.hasOwn(args, "expectedOldValue")) {
      throw new CreoMcpError("EXPECTED_OLD_VALUE_REQUIRED", "Parameter writes require expectedOldValue.");
    }
    const result = modelParametersResultSchema.parse(
      await context.bridge.call("model.parameters", { name: model.name }),
    );
    const parameter = result.parameters.find((candidate) => sameName(candidate.name, name));
    const current = parameter?.value ?? null;
    if (!parameter && args["createIfMissing"] !== true) {
      throw new CreoMcpError("NOT_FOUND", `Parameter '${name}' is not present on '${model.name}'.`);
    }
    if (parameter && (parameter.isRelationDriven === true || parameter.driverType.toLowerCase() === "relation")) {
      throw new CreoMcpError("POLICY_BLOCKED", `Relation-driven parameter '${name}' cannot be assigned directly.`);
    }
    if (!parameter && args["expectedOldValue"] !== null) {
      throw new CreoMcpError("EXPECTED_OLD_VALUE_MISMATCH", `New parameter '${name}' must use expectedOldValue=null.`);
    }
    if (parameter && !expectedOldMatches(current, args["expectedOldValue"])) {
      throw new CreoMcpError(
        "EXPECTED_OLD_VALUE_MISMATCH",
        `Parameter '${name}' changed since it was read; expectedOldValue does not match.`,
        { details: { expected: args["expectedOldValue"], actual: current } },
      );
    }
    return;
  }

  if (toolName === "creo_set_dimension") {
    if (!Object.hasOwn(args, "expectedOldValue")) {
      throw new CreoMcpError("EXPECTED_OLD_VALUE_REQUIRED", "Dimension writes require expectedOldValue.");
    }
    const id = args["dimensionId"];
    const result = modelDimensionsResultSchema.parse(
      await context.bridge.call("model.dimensions", { name: model.name }),
    );
    const dimension = result.dimensions.find((candidate) => candidate.id === id);
    if (!dimension) throw new CreoMcpError("NOT_FOUND", `Dimension '${String(id)}' is not present on '${model.name}'.`);
    if (dimension.isRelationDriven === true) {
      throw new CreoMcpError("POLICY_BLOCKED", `Relation-driven dimension '${dimension.name ?? dimension.id}' cannot be assigned directly.`);
    }
    if (dimension.isReference) {
      throw new CreoMcpError("POLICY_BLOCKED", `Reference dimension '${dimension.name ?? dimension.id}' cannot be assigned directly.`);
    }
    if (!expectedOldMatches(dimension.value, args["expectedOldValue"])) {
      throw new CreoMcpError(
        "EXPECTED_OLD_VALUE_MISMATCH",
        `Dimension ${dimension.id} changed since it was read; expectedOldValue does not match.`,
        { details: { expected: args["expectedOldValue"], actual: dimension.value } },
      );
    }
    const value = args["value"];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CreoMcpError("INVALID_ARGUMENT", "Dimension value must be finite.");
    }
    const minRatio = context.config.safety.dimensionRange?.minRatio ?? 0.5;
    const maxRatio = context.config.safety.dimensionRange?.maxRatio ?? 2;
    if (!(dimension.value > 0) || value < dimension.value * minRatio || value > dimension.value * maxRatio) {
      throw new CreoMcpError(
        "POLICY_BLOCKED",
        `Dimension ${dimension.id} value must remain between ${minRatio}x and ${maxRatio}x its current value.`,
        { details: { current: dimension.value, requested: value, minRatio, maxRatio } },
      );
    }
  }
}

function collectIds(
  value: unknown,
  key = "",
  result: { features: number[]; edges: number[]; surfaces: number[]; axes: number[]; names: string[] } = {
    features: [], edges: [], surfaces: [], axes: [], names: [],
  },
): typeof result {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, key, result);
    if (key === "featureIds" && value.every((item) => typeof item === "number")) result.features.push(...value as number[]);
    if (key === "edgeIds" && value.every((item) => typeof item === "number")) result.edges.push(...value as number[]);
    if (key === "surfaceIds" && value.every((item) => typeof item === "number")) result.surfaces.push(...value as number[]);
    return result;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      collectIds(child, childKey, result);
    }
    return result;
  }
  if (typeof value === "number") {
    if (key === "featureId" || key === "axisFeatureId" || key === "referenceFeatureId" || key === "seedFeatureId" || key === "plane1FeatureId" || key === "plane2FeatureId") result.features.push(value);
    else if (key === "edgeId" || key.endsWith("EdgeId")) result.edges.push(value);
    else if (key === "surfaceId" || key.endsWith("SurfaceId")) result.surfaces.push(value);
    else if (key === "axisId") result.axes.push(value);
  } else if (typeof value === "string" && ["sketchPlane", "orientRef", "reference", "plane1", "plane2", "axis", "surface", "ref1", "ref2"].includes(key)) {
    result.names.push(value);
  }
  return result;
}

async function assertReferences(
  context: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  model: ModelInfo,
): Promise<void> {
  if (DRAWING_EDIT_TOOLS.has(toolName)) {
    const viewIds = [args["viewId"], args["parentViewId"]].filter((id): id is number => typeof id === "number");
    if (viewIds.length > 0) {
      const views = drawingViewsResultSchema.parse(await context.bridge.call("drawing.list_views", { name: model.name }));
      const found = new Set(views.views.map((view) => view.id));
      const missing = [...new Set(viewIds)].filter((id) => !found.has(id));
      if (missing.length > 0) throw new CreoMcpError("NOT_FOUND", "One or more drawing view references are not present on the bound drawing.", { details: { drawing: model.name, missing } });
    }
    if (typeof args["sheetNumber"] === "number") {
      const sheets = drawingSheetsResultSchema.parse(await context.bridge.call("drawing.list_sheets", { name: model.name }));
      if (!sheets.sheets.some((sheet) => sheet.number === args["sheetNumber"])) {
        throw new CreoMcpError("NOT_FOUND", `Drawing sheet ${args["sheetNumber"]} is not present on the bound drawing.`, { details: { drawing: model.name, sheetNumber: args["sheetNumber"] } });
      }
    }
    return;
  }
  if (!toolName.startsWith("creo_create_") && !toolName.includes("features") && toolName !== "creo_reorder_feature" && toolName !== "creo_assemble_component") return;
  if (toolName === "creo_assemble_component") {
    const component = await resolveModel(context, requireStringArg(args, "component", "component"));
    if (component.type !== "part" && component.type !== "assembly") {
      throw new CreoMcpError("INVALID_ARGUMENT", "The component identity must resolve to a part or subassembly.", { details: { component } });
    }
  }
  const ids = collectIds(args);
  if (ids.axes.length > 0) {
    throw new CreoMcpError(
      "SAFE_WRITE_UNAVAILABLE",
      "Numeric axisId references cannot be re-resolved by the current bridge; use a datum axis name or axisFeatureId instead.",
      { details: { axisIds: ids.axes, model: model.name } },
    );
  }
  if (ids.features.length > 0) {
    const { features } = modelFeaturesResultSchema.parse(
      await context.bridge.call("model.features", { name: model.name }),
    );
    const found = new Set(features.map((feature) => feature.id));
    const missing = [...new Set(ids.features)].filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new CreoMcpError("NOT_FOUND", "One or more feature references are not present on the bound target model.", { details: { model: model.name, missing } });
    }
  }
  if (ids.edges.length > 0) {
    const result = await context.bridge.call<{ edges?: { id: number }[] }>("model.edges", { name: model.name, ids: [...new Set(ids.edges)] });
    const found = new Set((result.edges ?? []).map((edge) => edge.id));
    const missing = [...new Set(ids.edges)].filter((id) => !found.has(id));
    if (missing.length > 0) throw new CreoMcpError("NOT_FOUND", "One or more edge references are not present on the bound target model.", { details: { model: model.name, missing } });
  }
  if (ids.surfaces.length > 0) {
    const result = await context.bridge.call<{
      surfaces?: { bodySurfaces?: { id: number }[]; itemSurfaces?: { id: number }[] };
      byId?: { id: number }[];
    }>("model.surfaces", { name: model.name, ids: [...new Set(ids.surfaces)] });
    const found = new Set([
      ...(result.byId ?? []),
      ...(result.surfaces?.bodySurfaces ?? []),
      ...(result.surfaces?.itemSurfaces ?? []),
    ].map((surface) => surface.id));
    const missing = [...new Set(ids.surfaces)].filter((id) => !found.has(id));
    if (missing.length > 0) throw new CreoMcpError("NOT_FOUND", "One or more surface references are not present on the bound target model.", { details: { model: model.name, missing } });
  }
  if (ids.names.length > 0) {
    const [features, surfaces] = await Promise.all([
      modelFeaturesResultSchema.parse(await context.bridge.call("model.features", { name: model.name })),
      context.bridge.call<{ surfaces?: { bodySurfaces?: { featureName?: string }[]; itemSurfaces?: { featureName?: string }[] } }>("model.surfaces", { name: model.name }),
    ]);
    const names = new Set([
      ...features.features.map((feature) => feature.name).filter((name): name is string => Boolean(name)).map((name) => name.toUpperCase()),
      ...(surfaces.surfaces?.bodySurfaces ?? []).map((surface) => surface.featureName?.toUpperCase()).filter((name): name is string => Boolean(name)),
      ...(surfaces.surfaces?.itemSurfaces ?? []).map((surface) => surface.featureName?.toUpperCase()).filter((name): name is string => Boolean(name)),
    ]);
    const missing = [...new Set(ids.names)].filter((name) => !names.has(name.toUpperCase()));
    if (missing.length > 0) throw new CreoMcpError("NOT_FOUND", "One or more named datum references are not present on the bound target model.", { details: { model: model.name, missing } });
  }
}

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function makeVerifiedBackup(
  originalPath: string,
  model?: ModelInfo,
): Promise<VerifiedBackup> {
  const sourceStat = await lstat(originalPath);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile() || sourceStat.nlink > 1) {
    throw new CreoMcpError("LIVE_BACKUP_UNSAFE", "Backup source must be a single-link regular file, not a symbolic link or special file.", { details: { originalPath, symbolicLink: sourceStat.isSymbolicLink(), regularFile: sourceStat.isFile(), links: sourceStat.nlink } });
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "dnk-mcp-creo-safe-write-"));
  const backupPath = path.join(directory, path.basename(originalPath));
  try {
    await copyFile(originalPath, backupPath);
    const [originalDigest, backupDigest, backupStat] = await Promise.all([
      sha256(originalPath),
      sha256(backupPath),
      stat(backupPath),
    ]);
    if (originalDigest !== backupDigest || sourceStat.size !== backupStat.size) {
      throw new CreoMcpError("BACKUP_VERIFY_FAILED", "The backup does not match the original file.", { details: { originalPath, backupPath } });
    }
    return { originalPath, backupPath, directory, digest: originalDigest, size: sourceStat.size, ...(model ? { model } : {}) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function restoreFile(backup: VerifiedBackup): Promise<void> {
  const target = await lstat(backup.originalPath);
  if (target.isSymbolicLink() || !target.isFile() || target.nlink > 1) {
    throw new CreoMcpError("ROLLBACK_FAILED", "Rollback target is no longer a single-link regular file.", { details: { originalPath: backup.originalPath, symbolicLink: target.isSymbolicLink(), regularFile: target.isFile(), links: target.nlink } });
  }
  await copyFile(backup.backupPath, backup.originalPath);
  const [digest, fileStat] = await Promise.all([sha256(backup.originalPath), stat(backup.originalPath)]);
  if (digest !== backup.digest || fileStat.size !== backup.size) {
    throw new CreoMcpError("ROLLBACK_FAILED", "Restored file verification did not match the verified backup.", { details: { originalPath: backup.originalPath } });
  }
}

async function cleanupBackup(backup: VerifiedBackup, context: ToolContext): Promise<void> {
  await rm(backup.directory, { recursive: true, force: true }).catch((error: unknown) => {
    context.logger.warn("Could not remove a safe-write backup", {
      path: backup.backupPath,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function errorSummary(error: unknown): Record<string, unknown> {
  if (isCreoMcpError(error)) {
    return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  return { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) };
}

function throwCleanupFailure(primaryError: unknown, cleanupFailures: string[], label: string): void {
  if (cleanupFailures.length > 0) {
    throw new CreoMcpError("ROLLBACK_FAILED", label, { details: { primaryError: errorSummary(primaryError), cleanupFailures } });
  }
}

async function rollbackModel(
  context: ToolContext,
  backup: VerifiedBackup,
  session: SessionInfo,
): Promise<void> {
  const model = backup.model;
  if (!model) throw new CreoMcpError("ROLLBACK_FAILED", "Model identity is missing from the verified backup.");
  const fileName = model.fileName;
  const closeNames = [fileName, model.name];
  let closed = false;
  let closeError: unknown;
  for (const name of closeNames) {
    try {
      const result = await context.bridge.call<{ closed?: boolean }>("model.close", { name, force: true });
      if (result.closed === true) {
        closed = true;
        break;
      }
    } catch (error) {
      closeError = error;
    }
  }
  if (!closed) {
    throw new CreoMcpError("ROLLBACK_FAILED", "Could not close the mutated in-memory model before restoring its backup.", { details: { model, closeError: errorSummary(closeError) } });
  }
  await restoreFile(backup);
  const opened = await context.bridge.call<{ opened?: boolean; alreadyOpen?: boolean; model?: ModelInfo | null }>("model.open", { fileName });
  if (!opened.model || (!opened.opened && !opened.alreadyOpen)) {
    throw new CreoMcpError("ROLLBACK_FAILED", "The backed-up model file was restored but Creo did not reopen it.", { details: { fileName, opened } });
  }
  const restored = await resolveModel(context, model.name);
  if (!sameName(restored.name, model.name) || !sameName(restored.fileName, fileName) || restored.isModified) {
    throw new CreoMcpError("ROLLBACK_FAILED", "The reopened model identity or save state did not match the verified backup.", { details: { expected: model, actual: restored, workingDirectory: session.workingDirectory } });
  }
}

function cleanHandlerArgs(args: Record<string, unknown>, targetName?: string): Record<string, unknown> {
  const clean = { ...args };
  delete clean["dryRun"];
  delete clean["expectedModelName"];
  delete clean["expectedOldValue"];
  if (targetName) clean["name"] = targetName;
  return clean;
}

function outputContent(result: ToolResult, toolName: string): Record<string, unknown> {
  if (result.isError) throw new CreoMcpError("VERIFY_FAILED", `Tool '${toolName}' returned an error result.`);
  const output = result.structuredContent;
  if (!output || output["verified"] !== true) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `Tool '${toolName}' did not return verified:true after its write.`,
      { details: { output } },
    );
  }
  return output;
}

function resultModelName(output: Record<string, unknown>): string | undefined {
  const candidates = [output["model"], output["drawing"], output["assembly"], output["copyModel"]];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const name = (candidate as Record<string, unknown>)["name"];
      if (typeof name === "string" && name.length > 0) return name;
    }
  }
  return undefined;
}

async function verifyModelReadback(
  context: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  plan: WritePlan,
  output: Record<string, unknown>,
): Promise<ModelInfo> {
  let targetName = plan.target;
  if (toolName === "creo_rename_model") targetName = stringArg(args, "newName") ?? targetName;
  const returnedName = resultModelName(output);
  if (plan.kind === "copy-model" && returnedName) targetName = returnedName;
  const model = await resolveModel(context, targetName);
  if (toolName === "creo_set_parameter") {
    const name = requireStringArg(args, "paramName", "paramName");
    const result = modelParametersResultSchema.parse(await context.bridge.call("model.parameters", { name: model.name }));
    const parameter = result.parameters.find((candidate) => sameName(candidate.name, name));
    if (!parameter || !expectedOldMatches(parameter.value, args["value"])) {
      throw new CreoMcpError("VERIFY_FAILED", `Parameter '${name}' did not read back the requested value.`, { details: { parameter, expected: args["value"] } });
    }
  } else if (toolName === "creo_set_dimension") {
    const result = modelDimensionsResultSchema.parse(await context.bridge.call("model.dimensions", { name: model.name }));
    const dimension = result.dimensions.find((candidate) => candidate.id === args["dimensionId"]);
    if (!dimension || dimension.value !== args["value"]) throw new CreoMcpError("VERIFY_FAILED", `Dimension ${String(args["dimensionId"])} did not read back the requested value.`, { details: { dimension, expected: args["value"] } });
  } else if (toolName.includes("features") || toolName === "creo_reorder_feature" || toolName === "creo_assemble_component" || toolName.startsWith("creo_create_")) {
    const result = modelFeaturesResultSchema.parse(await context.bridge.call("model.features", { name: model.name }));
    const ids = collectIds(args);
    const createdId = (output["feature"] as { id?: unknown } | undefined)?.id;
    if (typeof createdId === "number" && !result.features.some((feature) => feature.id === createdId)) {
      throw new CreoMcpError("VERIFY_FAILED", `Created feature ${createdId} was not present in model.features readback.`);
    }
    if (toolName === "creo_delete_features") {
      const stillPresent = ids.features.filter((id) => result.features.some((feature) => feature.id === id));
      if (stillPresent.length > 0) throw new CreoMcpError("VERIFY_FAILED", "Deleted features remain in model.features readback.", { details: { stillPresent } });
    }
    if (toolName === "creo_suppress_features" || toolName === "creo_resume_features") {
      const expectedStatus = toolName === "creo_suppress_features" ? "suppressed" : "active";
      const statusesMatch = ids.features.every((id) => result.features.find((feature) => feature.id === id)?.status === expectedStatus);
      if (!statusesMatch) throw new CreoMcpError("VERIFY_FAILED", `Feature status readback did not match '${expectedStatus}'.`);
    }
    if (toolName === "creo_reorder_feature") {
      const featureId = args["featureId"];
      const referenceId = args["referenceFeatureId"];
      const featureIndex = result.features.findIndex((feature) => feature.id === featureId);
      const referenceIndex = result.features.findIndex((feature) => feature.id === referenceId);
      const ordered = args["before"] === true ? featureIndex < referenceIndex : featureIndex > referenceIndex;
      if (featureIndex < 0 || referenceIndex < 0 || !ordered) throw new CreoMcpError("VERIFY_FAILED", "Feature reorder position did not match the requested before/after relationship.", { details: { featureId, referenceId, featureIndex, referenceIndex, before: args["before"] === true } });
    }
    if (toolName === "creo_assemble_component") {
      const component = output["component"] as { name?: unknown } | undefined;
      const feature = output["feature"] as { id?: unknown; name?: unknown; type?: unknown } | undefined;
      const readback = result.features.find((candidate) => candidate.id === feature?.id);
      if (!readback || String(readback.type).toUpperCase() !== "COMPONENT" || !component?.name || !sameName(readback.name ?? "", String(component.name))) {
        throw new CreoMcpError("VERIFY_FAILED", "Assembled component feature identity did not match model.features readback.", { details: { component, feature, readback } });
      }
    }
  }
  return model;
}

function linkedModelName(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const field of ["name", "fullName", "fileName"]) {
    if (typeof record[field] === "string" && record[field]) return record[field] as string;
  }
  return undefined;
}

function drawingSourceNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const names = ["sourceModelName", "referencedModelName", "linkedModelName", "modelName"]
    .map((field) => record[field])
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  for (const field of ["sourceModel", "referencedModel", "linkedModel", "source", "model"]) {
    const name = linkedModelName(record[field]);
    if (name) names.push(name);
  }
  return names;
}

async function verifyDrawingReadback(
  context: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  plan: WritePlan,
  output: Record<string, unknown>,
): Promise<void> {
  const returnedName = resultModelName(output);
  const targetName = returnedName ?? plan.target;
  const drawing = await resolveModel(context, targetName);
  if (drawing.type !== "drawing") throw new CreoMcpError("VERIFY_FAILED", `Target '${targetName}' did not read back as a drawing.`);
  if (toolName === "creo_save_drawing" && drawing.isModified) throw new CreoMcpError("VERIFY_FAILED", "Creo still reports the drawing as modified after save.");
  const [sheets, views] = await Promise.all([
    drawingSheetsResultSchema.parse(await context.bridge.call("drawing.list_sheets", { name: drawing.name })),
    drawingViewsResultSchema.parse(await context.bridge.call("drawing.list_views", { name: drawing.name })),
  ]);
  if (plan.kind === "new-drawing") {
    if (!plan.source) throw new CreoMcpError("VERIFY_FAILED", "New drawing has no preflight source identity to verify.");
    const sourceCandidates: unknown[] = [
      output["sourceModelName"],
      output["sourceModel"],
      output["referencedModel"],
      output["linkedModel"],
    ];
    const viewCandidates: unknown[] = [
      ...(Array.isArray(output["views"]) ? output["views"] : []),
      ...views.views,
    ];
    const drawingOutput = output["drawing"];
    if (drawingOutput && typeof drawingOutput === "object") sourceCandidates.push(...drawingSourceNames(drawingOutput));
    const sourceNames = [
      ...sourceCandidates.flatMap((candidate) => {
        const directName = linkedModelName(candidate);
        return [...(directName ? [directName] : []), ...drawingSourceNames(candidate)];
      }),
      ...viewCandidates.flatMap((candidate) => drawingSourceNames(candidate)),
    ];
    const mismatchedSources = sourceNames.filter((name) => !identityMatches(plan.source as ModelInfo, name));
    if (sourceNames.length === 0 || mismatchedSources.length > 0) {
      throw new CreoMcpError("VERIFY_FAILED", "Created drawing source-model association could not be verified against the planned source.", { details: { expectedSource: plan.source, sourceNames, mismatchedSources, output, readbackViews: views.views } });
    }
  }
  const view = output["view"] as { id?: unknown; name?: unknown; scale?: unknown; locationX?: unknown; locationY?: unknown; sheetNumber?: unknown } | undefined;
  if (toolName === "creo_delete_drawing_view") {
    const id = output["deletedViewId"];
    if (views.views.some((candidate) => candidate.id === id)) throw new CreoMcpError("VERIFY_FAILED", `Deleted drawing view ${String(id)} remains after readback.`);
  } else if (typeof view?.id === "number") {
    const readbackView = views.views.find((candidate) => candidate.id === view.id);
    if (!readbackView) throw new CreoMcpError("VERIFY_FAILED", `Drawing view ${view.id} is not present in drawing.list_views readback.`);
    if (toolName === "creo_set_drawing_view_scale" && readbackView.scale !== args["scale"]) throw new CreoMcpError("VERIFY_FAILED", `Drawing view ${view.id} scale did not read back as requested.`);
    if (toolName === "creo_rename_drawing_view" && readbackView.name !== args["viewName"]) throw new CreoMcpError("VERIFY_FAILED", `Drawing view ${view.id} name did not read back as requested.`);
    if (toolName === "creo_translate_drawing_view" && (readbackView.locationX !== view.locationX || readbackView.locationY !== view.locationY)) throw new CreoMcpError("VERIFY_FAILED", `Drawing view ${view.id} translation readback was inconsistent.`);
    if ((toolName === "creo_create_drawing_view" || toolName === "creo_create_projection_view") && (readbackView.sheetNumber !== args["sheetNumber"] || (typeof args["locationX"] === "number" && readbackView.locationX !== args["locationX"]) || (typeof args["locationY"] === "number" && readbackView.locationY !== args["locationY"]))) throw new CreoMcpError("VERIFY_FAILED", `New drawing view ${view.id} did not match its requested sheet location.`);
  }
  const sheet = output["sheet"] as { number?: unknown; scale?: unknown } | undefined;
  if (toolName === "creo_add_drawing_sheet" && typeof sheet?.number === "number" && !sheets.sheets.some((candidate) => candidate.number === sheet.number)) {
    throw new CreoMcpError("VERIFY_FAILED", `Drawing sheet ${sheet.number} is not present in drawing.list_sheets readback.`);
  }
  if (toolName === "creo_set_drawing_sheet_scale" && typeof sheet?.number === "number" && !sheets.sheets.some((candidate) => candidate.number === sheet.number && candidate.scale === args["scale"])) {
    throw new CreoMcpError("VERIFY_FAILED", `Drawing sheet scale did not read back for sheet ${sheet.number}.`);
  }
  if (toolName === "creo_create_drawing" || toolName === "creo_generate_standard_drawing") {
    const returnedViews = Array.isArray(output["views"]) ? output["views"] as Record<string, unknown>[] : [];
    const returnedSheets = Array.isArray(output["sheets"]) ? output["sheets"] as Record<string, unknown>[] : [];
    const mismatchedViews = returnedViews.filter((candidate) => {
      const readback = views.views.find((item) => item.id === candidate["id"]);
      if (!readback) return true;
      const fields = ["name", "sheetNumber", "scale", "locationX", "locationY"] as const;
      return fields.some((field) => candidate[field] !== undefined && (readback as unknown as Record<string, unknown>)[field] !== candidate[field]);
    });
    const mismatchedSheets = returnedSheets.filter((candidate) => {
      const readback = sheets.sheets.find((item) => item.number === candidate["number"]);
      return !readback || (candidate["scale"] !== undefined && readback.scale !== candidate["scale"]);
    });
    if (mismatchedViews.length > 0 || mismatchedSheets.length > 0) {
      throw new CreoMcpError("VERIFY_FAILED", "The created drawing's exact sheets or views did not read back completely.", { details: { mismatchedViews, mismatchedSheets, actualViews: views.views, actualSheets: sheets.sheets } });
    }
  }
}

async function verifyWrite(
  context: ToolContext,
  definition: ToolDefinition,
  args: Record<string, unknown>,
  plan: WritePlan,
  result: ToolResult,
): Promise<{ output: Record<string, unknown>; model?: ModelInfo }> {
  const output = outputContent(result, definition.name);
  if (plan.kind === "export") {
    const pathValue = output["path"];
    const sizeBytes = output["sizeBytes"];
    if (typeof pathValue !== "string" || typeof sizeBytes !== "number" || sizeBytes <= 0) {
      throw new CreoMcpError("VERIFY_FAILED", "Export did not return a valid path and positive readback size.", { details: { output } });
    }
    const expected = plan.outputFile;
    if (!expected || path.resolve(pathValue).toLowerCase() !== path.resolve(expected).toLowerCase()) {
      throw new CreoMcpError("VERIFY_FAILED", "Export readback path did not match the contained requested output path.", { details: { expected, actual: pathValue } });
    }
    return { output };
  }
  if (plan.kind === "drawing-edit" || plan.kind === "new-drawing") {
    await verifyDrawingReadback(context, definition.name, args, plan, output);
    return { output };
  }
  const model = await verifyModelReadback(context, definition.name, args, plan, output);
  return { output, model };
}

async function invokeHandler(
  definition: ToolDefinition,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  return definition.handler(args, context);
}

async function cleanupOwnedOutputs(context: ToolContext, outputPaths: string[] | undefined): Promise<string[]> {
  const failures: string[] = [];
  for (const filePath of outputPaths ?? []) {
    try {
      const entry = await lstat(filePath);
      if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink > 1) {
        failures.push(`${filePath}: unsafe output file type`);
        continue;
      }
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function cleanupOwnedTarget(
  context: ToolContext,
  targetName: string,
  filePath?: string,
): Promise<string[]> {
  const failures: string[] = [];
  try {
    const models = await listModels(context);
    const openTarget = models.find((model) => sameName(model.name, targetName) || sameName(model.fileName, targetName));
    if (openTarget) {
      const result = await context.bridge.call<{ closed?: boolean }>("model.close", { name: openTarget.name, force: true });
      if (result.closed !== true) failures.push(`${targetName}: close was not verified`);
      const remaining = await listModels(context);
      if (remaining.some((model) => sameName(model.name, targetName) || sameName(model.fileName, targetName))) failures.push(`${targetName}: model remains open`);
    }
  } catch (error) {
    failures.push(`${targetName}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (filePath) {
    try {
      const entry = await lstat(filePath);
      if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink > 1) {
        failures.push(`${filePath}: unsafe target file type`);
      } else {
        await unlink(filePath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const versionedFiles = await creoVersionedSiblings(filePath);
      failures.push(...versionedFiles.map((versionedFile) => `${versionedFile}: Creo version-file cleanup is outside the approved transaction contract; left untouched.`));
    } catch (error) {
      failures.push(`${filePath}: could not verify Creo version-file cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

function plannedResult(plan: WritePlan, toolName: string, args: Record<string, unknown>): ToolResult {
  const structuredContent = {
    dryRun: true,
    planned: true,
    allowed: plan.allowed ?? true,
    mode: plan.mode,
    tool: toolName,
    target: plan.target,
    ...(plan.source ? { source: { name: plan.source.name, type: plan.source.type, fileName: plan.source.fileName } } : {}),
    change: Object.fromEntries(Object.entries(args).filter(([key]) => !["dryRun", "expectedModelName"].includes(key))),
    checks: plan.checks,
    ...(plan.blockedReason ? { blockedReason: plan.blockedReason } : {}),
    executed: false,
  };
  return {
    ...(plan.allowed === false ? { isError: true } : {}),
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
  };
}

async function runSafeWriteUnlocked(
  definition: ToolDefinition,
  originalArgs: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  if (!definition.writeTool) return invokeHandler(definition, originalArgs, context);
  if (context.config.safety.mode === "read-only") {
    throw new CreoMcpError(
      "POLICY_BLOCKED",
      `Tool '${definition.name}' is blocked because safety.mode is 'read-only'.`,
      { details: { tool: definition.name, mode: "read-only" } },
    );
  }

  const dryRun = originalArgs["dryRun"] === true;
  if (dryRun) {
    try {
      const session = await sessionForWrite(context, true);
      const plan = await buildPlan(context, definition, originalArgs, session);
      if (plan.mode === "live" && ["creo_save_model", "creo_save_drawing"].includes(definition.name)) {
        return plannedResult({
          ...plan,
          allowed: false,
          blockedReason: { code: "SAFE_WRITE_UNAVAILABLE", message: `${definition.name} is blocked in live mode because Creo version-file cleanup is outside the approved transaction contract.` },
          checks: [...plan.checks, "live save refused before mutation"],
        }, definition.name, originalArgs);
      }
      if (plan.mode === "copy" && definition.name === "creo_save_model" && context.bridge.kind !== "mock") {
        return plannedResult({
          ...plan,
          allowed: false,
          blockedReason: { code: "SAFE_WRITE_UNAVAILABLE", message: "Copy-mode model persistence remains disabled until live disposable copy/save/close/reopen acceptance is verified." },
          checks: [...plan.checks, "copy-mode persistence refused before mutation; live close/reopen verification is pending"],
        }, definition.name, originalArgs);
      }
      return plannedResult(plan, definition.name, originalArgs);
    } catch (error) {
      const blocked = {
        kind: classify(definition.name),
        mode: context.config.safety.mode,
        target: stringArg(originalArgs, "name") ?? stringArg(originalArgs, "modelName") ?? stringArg(originalArgs, "drawingName") ?? stringArg(originalArgs, "fileName") ?? "unresolved",
        allowed: false,
        blockedReason: errorSummary(error),
        checks: ["dry-run preflight refused; no write or file mutation was invoked"],
      } satisfies WritePlan;
      return plannedResult(blocked, definition.name, originalArgs);
    }
  }
  if (context.config.safety.mode === "copy" && definition.name === "creo_save_model" && context.bridge.kind !== "mock") {
    throw new CreoMcpError(
      "SAFE_WRITE_UNAVAILABLE",
      "Copy-mode model persistence is disabled until live disposable copy/save/close/reopen acceptance is verified.",
      { details: { tool: definition.name, mode: "copy", recovery: "copy persistence unverified; no mutation attempted" } },
    );
  }
  const session = await sessionForWrite(context, false);
  const args = cleanHandlerArgs(originalArgs);
  const plan = await buildPlan(context, definition, originalArgs, session);
  if (plan.mode === "live" && ["creo_save_model", "creo_save_drawing"].includes(definition.name)) {
    throw new CreoMcpError(
      "SAFE_WRITE_UNAVAILABLE",
      `Live mode blocks '${definition.name}' because Creo version-file cleanup is outside the approved transaction contract.`,
      { details: { tool: definition.name, mode: "live", recovery: "version-file cleanup is not implemented" } },
    );
  }

  if (plan.kind === "model-edit" && plan.mode === "copy") {
    const source = plan.source;
    const copyName = plan.copyName;
    if (!source || !copyName) throw new CreoMcpError("SAFE_WRITE_UNAVAILABLE", "The copy transaction is missing its source or destination identity.");
    const sourceSnapshot = await snapshotModel(context, source);
    let copyAttempted = false;
    try {
      copyAttempted = true;
      const copy = modelCopyResultSchema.parse(await context.bridge.call("model.copy", { name: source.name, newName: copyName }));
      if (copy.verified !== true || !copy.copyModel || !copy.sourceModel || !sameName(copy.sourceModel.name, source.name) || !sameName(copy.sourceModel.fileName, source.fileName) || !sameName(copy.copyModel.name, copyName) || sameName(copy.copyModel.name, source.name) || sameName(copy.copyModel.fileName, source.fileName)) {
        throw new CreoMcpError("VERIFY_FAILED", "Creo did not verify a distinct isolated copy before mutation.", { details: { source: copy.sourceModel, copy: copy.copyModel, verified: copy.verified } });
      }
      const sourceAfterCopy = await snapshotModel(context, source);
      if (sourceAfterCopy !== sourceSnapshot) throw new CreoMcpError("SOURCE_MUTATION_DETECTED", "Creo's copy operation changed the source model.", { details: { source: source.name } });
      const copiedModel = copy.copyModel;
      await assertWriteGuards(context, definition.name, originalArgs, copiedModel);
      await assertReferences(context, definition.name, originalArgs, copiedModel);
      const invokeArgs = cleanHandlerArgs(originalArgs, copiedModel.name);
      const result = await invokeHandler(definition, invokeArgs, context);
      await verifyWrite(context, definition, invokeArgs, { ...plan, target: copiedModel.name }, result);
      const sourceAfterWrite = await snapshotModel(context, source);
      if (sourceAfterWrite !== sourceSnapshot) throw new CreoMcpError("SOURCE_MUTATION_DETECTED", "A copy-mode write changed the original source model.", { details: { source: source.name, target: copiedModel.name } });
      return result;
    } catch (error) {
      let sourceAfterFailure: string | undefined;
      try {
        sourceAfterFailure = await snapshotModel(context, source);
      } catch {
        // Preserve the original failure below but explicitly mark that the source could not be re-verified.
      }
      const cleanupFailures: string[] = [];
      if (copyAttempted) {
        cleanupFailures.push(...await cleanupOwnedTarget(context, copyName, plan.filePath));
      }
      if (sourceAfterFailure === undefined || sourceAfterFailure !== sourceSnapshot) {
        throw new CreoMcpError(
          "SOURCE_PRESERVATION_UNVERIFIED",
          "Copy-mode write failed and the original source could not be proven unchanged.",
          { details: { primaryError: errorSummary(error), source: source.name, sourceState: sourceAfterFailure === undefined ? "unavailable" : "changed", cleanupFailures } },
        );
      }
      throwCleanupFailure(error, cleanupFailures, "Copy-mode write failed and its transaction-owned target could not be fully removed.");
      throw error;
    }
  }

  if (plan.kind === "copy-model") {
    const source = plan.source;
    if (!source) throw new CreoMcpError("SAFE_WRITE_UNAVAILABLE", "The explicit copy operation has no resolved source model.");
    const sourceSnapshot = await snapshotModel(context, source);
    try {
      const result = await invokeHandler(definition, args, context);
      const verified = await verifyWrite(context, definition, args, plan, result);
      if (!verified.model || !sameName(verified.model.name, plan.target)) throw new CreoMcpError("VERIFY_FAILED", "Explicit model copy did not read back under its requested unique name.");
      const sourceAfter = await snapshotModel(context, source);
      if (sourceAfter !== sourceSnapshot) throw new CreoMcpError("SOURCE_MUTATION_DETECTED", "The explicit copy operation changed its source model.", { details: { source: source.name } });
      return result;
    } catch (error) {
      let sourceAfterFailure: string | undefined;
      try {
        sourceAfterFailure = await snapshotModel(context, source);
      } catch {
        // The primary failure will be reported with explicit preservation status.
      }
      const cleanupFailures = await cleanupOwnedTarget(context, plan.target, plan.filePath);
      if (sourceAfterFailure === undefined || sourceAfterFailure !== sourceSnapshot) {
        throw new CreoMcpError("SOURCE_PRESERVATION_UNVERIFIED", "Model copy failed and source preservation could not be proven.", { details: { primaryError: errorSummary(error), source: source.name, sourceState: sourceAfterFailure === undefined ? "unavailable" : "changed", cleanupFailures } });
      }
      throwCleanupFailure(error, cleanupFailures, "Model copy failed and its transaction-owned target could not be fully removed.");
      throw error;
    }
  }

  if (plan.kind === "export") {
    let backup: VerifiedBackup | undefined;
    const sourceSnapshot = plan.source ? await snapshotModel(context, plan.source) : undefined;
    if (plan.outputExists && plan.outputFile) backup = await makeVerifiedBackup(plan.outputFile);
    try {
      if (plan.source && sourceSnapshot !== undefined) {
        const current = await resolveModel(context, plan.source.name);
        if (!sameName(current.name, plan.source.name) || !sameName(current.fileName, plan.source.fileName) || current.type !== plan.source.type || sourceSnapshot !== await snapshotModel(context, current)) {
          throw new CreoMcpError("LIVE_TARGET_CHANGED", "Export source identity or data changed after preflight; export was not attempted.", { details: { expected: plan.source, actual: current } });
        }
      }
    } catch (preMutationError) {
      if (backup) await cleanupBackup(backup, context);
      throw preMutationError;
    }
    try {
      const result = await invokeHandler(definition, args, context);
      await verifyWrite(context, definition, args, plan, result);
      if (plan.source && sourceSnapshot !== await snapshotModel(context, plan.source)) {
        throw new CreoMcpError("SOURCE_MUTATION_DETECTED", "Export changed the source model; output is verified but source preservation failed.", { details: { source: plan.source.name } });
      }
      if (backup) await cleanupBackup(backup, context);
      return result;
    } catch (error) {
      if (!backup && isCreoMcpError(error) && error.code === "FILE_EXISTS") {
        // The bridge rejected a no-overwrite collision before changing the file.
        throw error;
      }
      try {
        if (backup) await restoreFile(backup);
        else if (plan.outputFile) {
          const cleanupFailures = await cleanupOwnedOutputs(context, [plan.outputFile]);
          if (cleanupFailures.length > 0) throw new CreoMcpError("ROLLBACK_FAILED", "Could not safely remove the incomplete export output.", { details: { cleanupFailures } });
        }
        if (backup) await cleanupBackup(backup, context);
      } catch (rollbackError) {
        throw new CreoMcpError(
          "ROLLBACK_FAILED",
          `Export failed and output recovery failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { details: { primaryError: errorSummary(error), rollbackError: errorSummary(rollbackError), outputFile: plan.outputFile } },
        );
      }
      if (plan.source && sourceSnapshot !== undefined) {
        let sourceAfterFailure: string | undefined;
        try { sourceAfterFailure = await snapshotModel(context, plan.source); } catch { /* report preservation as unverified */ }
        if (sourceAfterFailure === undefined || sourceAfterFailure !== sourceSnapshot) {
          throw new CreoMcpError("SOURCE_PRESERVATION_UNVERIFIED", "Export failed and source preservation could not be proven.", { details: { primaryError: errorSummary(error), source: plan.source.name, sourceState: sourceAfterFailure === undefined ? "unavailable" : "changed", outputRecovery: backup ? "restored" : "new-output-removed" } });
        }
      }
      throw new CreoMcpError("SAFE_WRITE_FAILED", "Export failed; output recovery completed.", { details: { primaryError: errorSummary(error), recovery: backup ? "restored" : "new-output-removed" } });
    }
  }

  if (plan.mode === "live" && (plan.kind === "model-edit" || plan.kind === "drawing-edit")) {
    if (!plan.filePath || !plan.source) throw new CreoMcpError("LIVE_BACKUP_UNAVAILABLE", "Live write is missing a verified target file.");
    const backup = await makeVerifiedBackup(plan.filePath, plan.source);
    try {
      const current = await resolveModel(context, plan.source.name);
      if (!sameName(current.name, plan.source.name) || !sameName(current.fileName, plan.source.fileName) || current.type !== plan.source.type || current.isModified) {
        throw new CreoMcpError("LIVE_TARGET_CHANGED", "Live target identity or save state changed after preflight.", { details: { expected: plan.source, actual: current } });
      }
      await assertWriteGuards(context, definition.name, originalArgs, current);
      await assertReferences(context, definition.name, originalArgs, current);
      const currentPath = canonicalModelPath(current, session);
      if (path.resolve(currentPath).toLowerCase() !== path.resolve(plan.filePath).toLowerCase()) {
        throw new CreoMcpError("LIVE_TARGET_CHANGED", "The re-resolved model path no longer matches the backed-up target; mutation was not attempted.", { details: { expected: plan.filePath, actual: currentPath } });
      }
      if (!(await pathExists(plan.filePath)) || await sha256(plan.filePath) !== backup.digest) {
        throw new CreoMcpError("LIVE_TARGET_CHANGED", "Live target file changed after the verified backup was created; mutation was not attempted.", { details: { filePath: plan.filePath, backupDigest: backup.digest } });
      }
    } catch (preMutationError) {
      await cleanupBackup(backup, context);
      throw preMutationError;
    }
    try {
      const result = await invokeHandler(definition, cleanHandlerArgs(originalArgs, plan.source.name), context);
      await verifyWrite(context, definition, cleanHandlerArgs(originalArgs, plan.source.name), plan, result);
      await cleanupBackup(backup, context);
      return result;
    } catch (error) {
      try {
        await rollbackModel(context, backup, session);
        await cleanupBackup(backup, context);
      } catch (rollbackError) {
        throw new CreoMcpError(
          "ROLLBACK_FAILED",
          `Live write failed and the original model could not be fully restored: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { details: { primaryError: errorSummary(error), rollbackError: errorSummary(rollbackError), backupRetainedAt: backup.backupPath, model: plan.source } },
        );
      }
      throw new CreoMcpError("SAFE_WRITE_FAILED", "Live write failed; the verified backup was restored and reopened.", { details: { primaryError: errorSummary(error), recovery: "restored", model: plan.source.name } });
    }
  }

  const invokeTarget = plan.kind === "model-edit" || plan.kind === "drawing-edit" ? plan.source?.name : undefined;
  const newDrawingSourceSnapshot = plan.kind === "new-drawing" && plan.source
    ? await snapshotModel(context, plan.source)
    : undefined;
  let writeStarted = false;
  try {
    const handlerArgs = cleanHandlerArgs(originalArgs, invokeTarget);
    if (plan.kind === "new-drawing" && plan.source) {
      const current = await resolveModel(context, plan.source.name);
      if (!sameName(current.name, plan.source.name) || !sameName(current.fileName, plan.source.fileName) || current.type !== plan.source.type || newDrawingSourceSnapshot !== await snapshotModel(context, current)) {
        throw new CreoMcpError("SOURCE_IDENTITY_CHANGED", "The planned drawing source changed after preflight; drawing creation was not attempted.", { details: { plannedSource: plan.source, currentSource: current } });
      }
      handlerArgs["modelName"] = plan.source.name;
    }
    writeStarted = true;
    const result = await invokeHandler(definition, handlerArgs, context);
    await verifyWrite(context, definition, handlerArgs, plan, result);
    if (plan.kind === "new-drawing" && plan.source && newDrawingSourceSnapshot !== await snapshotModel(context, plan.source)) {
      throw new CreoMcpError("SOURCE_MUTATION_DETECTED", "New-drawing generation changed its source model.", { details: { source: plan.source.name } });
    }
    if (plan.kind === "new-model" || plan.kind === "new-drawing") {
      const readbackName = resultModelName(outputContent(result, definition.name));
      if (!readbackName || !sameName(readbackName, plan.target.replace(/\.drw$/i, ""))) {
        throw new CreoMcpError("VERIFY_FAILED", `New target '${plan.target}' did not match model identity readback.`, { details: { readbackName, expected: plan.target } });
      }
    }
    return result;
  } catch (error) {
    const cleanupFailures: string[] = [];
    if (writeStarted && (plan.kind === "new-model" || plan.kind === "new-drawing")) {
      // Preflight proved these names absent; clean partial results even when a handler throws before returning.
      const targetName = plan.target.replace(/\.drw$/i, "");
      cleanupFailures.push(...await cleanupOwnedTarget(context, targetName, plan.filePath));
      if (plan.kind === "new-drawing") cleanupFailures.push(...await cleanupOwnedOutputs(context, plan.ownedOutputs));
    }
    if (plan.kind === "new-drawing" && plan.source && newDrawingSourceSnapshot !== undefined) {
      let afterFailure: string | undefined;
      try { afterFailure = await snapshotModel(context, plan.source); } catch { /* report preservation as unverified */ }
      if (afterFailure === undefined || afterFailure !== newDrawingSourceSnapshot) {
        throw new CreoMcpError("SOURCE_PRESERVATION_UNVERIFIED", "Drawing creation failed and the source model could not be proven unchanged.", { details: { primaryError: errorSummary(error), source: plan.source.name, sourceState: afterFailure === undefined ? "unavailable" : "changed", cleanupFailures } });
      }
    }
    throwCleanupFailure(error, cleanupFailures, "New target creation failed and its transaction-owned artifacts could not be fully removed.");
    throw error;
  }
}

const bridgeWriteLocks = new WeakMap<object, Promise<void>>();

async function withBridgeWriteLock<T>(bridge: object, operation: () => Promise<T>): Promise<T> {
  const previous = bridgeWriteLocks.get(bridge) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  bridgeWriteLocks.set(bridge, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (bridgeWriteLocks.get(bridge) === current) bridgeWriteLocks.delete(bridge);
  }
}

async function runSafeWrite(
  definition: ToolDefinition,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  if (!definition.writeTool) return invokeHandler(definition, args, context);
  return withBridgeWriteLock(context.bridge as object, () =>
    runSafeWriteUnlocked(definition, args, context),
  );
}

export { runSafeWrite };
