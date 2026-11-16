# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// End-to-end demo: 3D model -> standard 2D drawing via the Creo MCP server.
//
// Because M4 feature authoring is not implemented yet, the "3D model" is a
// file-level clone of a fixture part (same technique as read-pack-smoke), opened
// through creo_open_model, stamped with a provenance parameter, and saved.
// The drawing is a template-based A3 sheet with front/top/right projection
// views, saved and exported to PDF/DXF (creo_generate_standard_drawing).
//
// Note: creo_copy_model is intentionally NOT used here. CopyAndRetrieve copies
// have no on-disk identity, and Creo's Save() only writes numbered backups
// (name.prt.1, .2, ...) for them, never a primary object file. For the same
// reason the script promotes the newest name.ext.N file to the primary name
// after each save (Creo's Save() writes version files and leaves the base file
// untouched in this environment).
//
// The drawing name must differ from the part name: CreateDrawingFromTemplate
// rejects a drawing whose name is already loaded in the session.
//
// Usage (from the repository root, with a running Creo session):
//   node scripts/model-to-drawing-demo.mjs
//   node scripts/model-to-drawing-demo.mjs --source block.prt --name demo_block
//   node scripts/model-to-drawing-demo.mjs --scale 0.5
//
// Requires: npm run build, fixtures/sandbox populated
// (node scripts/fixture-models.mjs), and a built native bridge.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../packages/server/dist/config.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const options = {
    source: "base.prt",
    name: "demo_part",
    drawingName: undefined,
    template: "a3_drawing.drw",
    scale: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") options.source = argv[++i];
    else if (arg === "--name") options.name = argv[++i];
    else if (arg === "--drawing-name") options.drawingName = argv[++i];
    else if (arg === "--template") options.template = argv[++i];
    else if (arg === "--scale") options.scale = Number(argv[++i]);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  options.drawingName = options.drawingName ?? `${options.name}_drawing`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*\.(prt|asm)$/i.test(options.source)) {
    console.error(`--source must be a plain part/assembly file name, got '${options.source}'`);
    process.exit(2);
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.name)) {
    console.error(`--name must be a plain Creo model name, got '${options.name}'`);
    process.exit(2);
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.drawingName)) {
    console.error(`--drawing-name must be a plain Creo model name, got '${options.drawingName}'`);
    process.exit(2);
  }
  if (options.drawingName === options.name) {
    console.error(
      "Drawing name must differ from the part name: CreateDrawingFromTemplate " +
        "rejects a drawing whose name is already loaded in the session (XToolkitFound).",
    );
    process.exit(2);
  }
  if (options.scale !== undefined && !(Number.isFinite(options.scale) && options.scale > 0)) {
    console.error(`--scale must be a positive number, got '${options.scale}'`);
    process.exit(2);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const partFileName = `${options.name}.prt`;
const pdfName = `${options.drawingName}.pdf`;
const dxfName = `${options.drawingName}.dxf`;

const config = loadConfig({});
if (!config.creo.installDir) {
  console.error("FAIL: no Creo installation detected. Set CREO_INSTALL_DIR.");
  process.exit(1);
}
if (!config.creo.bridgePathExists) {
  console.error(
    `FAIL: bridge executable missing at ${config.creo.bridgePath}. Run: npm run build:native`,
  );
  process.exit(1);
}
const serverEntry = path.join(repoRoot, "packages", "server", "dist", "index.js");
if (!existsSync(serverEntry)) {
  console.error(`FAIL: server build missing at ${serverEntry}. Run: npm run build`);
  process.exit(1);
}
const sandboxSource = path.join(repoRoot, "fixtures", "sandbox", options.source);
if (!existsSync(sandboxSource)) {
  console.error(
    `FAIL: fixture ${sandboxSource} is missing. Run: node scripts/fixture-models.mjs`,
  );
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: {
    DNK_MCP_CREO_PACKS: "core,read,export,modeling,drawing",
    DNK_MCP_CREO_SAFETY_MODE: "copy",
    DNK_MCP_CREO_LOG_LEVEL: "warn",
  },
});

const client = new Client({ name: "model-to-drawing-demo", version: "1.0.0" });

async function call(name, args = {}, timeoutMs = 60000) {
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: timeoutMs, resetTimeoutOnProgress: true },
  );
  if (result.isError) {
    const text = (result.content ?? [])
      .map((item) => (item.type === "text" ? item.text : ""))
      .join("\n");
    throw new Error(`${name} failed: ${text || "unknown tool error"}`);
  }
  return result.structuredContent ?? {};
}

async function tryCall(name, args, timeoutMs = 60000) {
  try {
    return await call(name, args, timeoutMs);
  } catch {
    return undefined;
  }
}

function requireTrue(payload, field, label) {
  if (payload[field] !== true) {
    throw new Error(`${label}: expected ${field}=true, got ${JSON.stringify(payload)}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// CreateDrawingFromTemplate fails with XToolkitFound when a model with the
// drawing name is loaded OR a file with that name already exists on disk, so
// stale artifacts from an earlier run are removed first.
function cleanArtifacts(directory) {
  const partPattern = new RegExp(`^${escapeRegExp(options.name)}\\.prt(\\.\\d+)?$`, "i");
  const drawingPattern = new RegExp(
    `^${escapeRegExp(options.drawingName)}\\.(drw|pdf|dxf)(\\.\\d+)?$` +
      `|^${escapeRegExp(options.drawingName)}_(dxf__out\\.log\\.\\d+|img_\\d+\\.png)$`,
    "i",
  );
  let removed = 0;
  for (const entry of readdirSync(directory)) {
    if (partPattern.test(entry) || drawingPattern.test(entry)) {
      unlinkSync(path.join(directory, entry));
      removed += 1;
    }
  }
  return removed;
}

function fileSize(filePath) {
  return existsSync(filePath) ? statSync(filePath).size : 0;
}

// Creo's Save() writes a numbered version file (name.ext.N) and leaves the
// primary object file untouched in this setup, so promote the newest version
// file to the primary name for a clean, openable artifact.
function promoteNewestVersion(directory, baseFileName) {
  const prefix = `${baseFileName}.`;
  const candidates = readdirSync(directory).filter(
    (entry) => entry.startsWith(prefix) && /^\d+$/.test(entry.slice(prefix.length)),
  );
  if (candidates.length === 0) {
    return undefined;
  }
  let newest;
  let newestTime = 0;
  for (const entry of candidates) {
    const mtime = statSync(path.join(directory, entry)).mtimeMs;
    if (mtime > newestTime) {
      newest = entry;
      newestTime = mtime;
    }
  }
  const primaryPath = path.join(directory, baseFileName);
  const primaryTime = existsSync(primaryPath) ? statSync(primaryPath).mtimeMs : 0;
  if (newestTime <= primaryTime) {
    return undefined;
  }
  copyFileSync(path.join(directory, newest), primaryPath);
  unlinkSync(path.join(directory, newest));
  return newest;
}

function mmFactor(unitsName) {
  const text = String(unitsName ?? "").toLowerCase();
  if (text.includes("inch") || text.includes("inlb")) return 25.4;
  if (text.includes("foot") || text.includes("feet")) return 304.8;
  if (text.includes("centimeter")) return 10;
  if (text.includes("meter") && !text.includes("millimeter")) return 1000;
  return 1;
}

// The default demo layout puts FRONT at (100,100), TOP at (100,180) and RIGHT
// at (180,100) on the sheet in mm, so keep each projected extent below the
// 80 mm gap between view centers to avoid overlaps.
function fitScale(geometry, factor) {
  const outline = geometry?.outline;
  if (!outline) return undefined;
  const extent = Math.max(
    ...outline.max.map((value, index) => (value - outline.min[index]) * factor),
  );
  if (!Number.isFinite(extent) || extent <= 0) return undefined;
  const fit = 80 / extent;
  if (fit >= 1) return undefined;
  const candidates = [0.5, 0.4, 0.25, 0.2, 0.1];
  return candidates.find((value) => value <= fit) ?? 0.1;
}

const writtenFiles = [];
let failures = 0;
const check = (label, condition, details) => {
  const mark = condition ? "[ok]" : "[FAIL]";
  console.log(`${mark} ${label}${details ? ` - ${details}` : ""}`);
  if (!condition) failures += 1;
};

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  check(
    "tool inventory",
    ["creo_open_model", "creo_set_parameter", "creo_save_model", "creo_generate_standard_drawing"].every(
      (name) => toolNames.has(name),
    ),
    `${tools.tools.length} tool(s) registered`,
  );

  const status = await call("creo_status");
  console.log(
    `     bridge ${status.bridge?.protocolVersion ?? "?"} / otk ${status.bridge?.otkLibrary ?? "?"}` +
      (status.session?.connected === true
        ? ` / Creo ${status.session.creoVersion ?? "?"}`
        : " / session auto-attaches on first model tool"),
  );

  const working = await call("creo_get_working_directory");
  const workingDirectory = working.workingDirectory;
  check("session", typeof workingDirectory === "string" && workingDirectory.length > 0, workingDirectory);
  check("creo version", typeof working.creoVersion === "string", working.creoVersion ?? "unknown");

  // Clean up leftovers from an earlier run so the clone/open step is deterministic.
  const removedArtifacts = cleanArtifacts(workingDirectory);
  if (removedArtifacts > 0) {
    console.log(`     removed ${removedArtifacts} stale artifact(s)`);
  }
  for (const modelName of [options.drawingName, options.name]) {
    try {
      await call("creo_close_model", { name: modelName, force: true }, 120000);
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!/MODEL_NOT_FOUND|not open/i.test(message)) {
        const open = await tryCall("creo_list_models", {});
        const stillOpen = (open?.models ?? []).some(
          (model) => String(model.name).toLowerCase() === modelName.toLowerCase(),
        );
        if (stillOpen) {
          throw new Error(
            `'${modelName}' is open in Creo and could not be closed (${message}). ` +
              "Close its window in Creo and retry.",
          );
        }
      }
    }
  }

  // Stage the fixture part and the drawing template into Creo's working directory.
  const partPath = path.join(workingDirectory, partFileName);
  const templateSource = path.join(
    config.creo.installDir,
    "Common Files",
    "templates",
    options.template,
  );
  const templateInWorkdir = path.join(workingDirectory, options.template);
  copyFileSync(sandboxSource, partPath);
  console.log(`     cloned fixture ${options.source} -> ${partPath}`);
  if (!existsSync(templateSource)) {
    console.error(`FAIL: drawing template not found at ${templateSource}`);
    process.exit(1);
  }
  if (!existsSync(templateInWorkdir)) {
    copyFileSync(templateSource, templateInWorkdir);
    console.log(`     copied template ${options.template} -> ${workingDirectory}`);
  }

  const opened = await call("creo_open_model", { fileName: partFileName }, 120000);
  check(
    `open ${partFileName}`,
    opened.opened === true || opened.alreadyOpen === true,
    opened.model?.name ?? "no model",
  );

  const geometry = await call("creo_get_geometry", { name: options.name });
  const units = await call("creo_get_units", { name: options.name });
  check(
    `geometry ${options.name}`,
    (geometry.geometry?.counts?.edges ?? 0) > 0,
    geometry.geometry
      ? `edges=${geometry.geometry.counts.edges} surfaces=${geometry.geometry.counts.surfaces}`
      : "no geometry",
  );

  const stamped = await call("creo_set_parameter", {
    name: options.name,
    paramName: "MCP_SOURCE",
    value: options.source,
    createIfMissing: true,
  });
  check(
    "provenance parameter",
    stamped.verified === true && stamped.parameter?.value?.value === options.source,
    `MCP_SOURCE=${stamped.parameter?.value?.value}`,
  );

  const saved = await call("creo_save_model", { name: options.name }, 180000);
  requireTrue(saved, "verified", `save ${options.name}`);
  const promotedPart = promoteNewestVersion(workingDirectory, partFileName);
  check(
    "part file on disk",
    fileSize(partPath) > 0,
    `${partPath} (${fileSize(partPath)} bytes)` +
      (promotedPart ? ` [promoted ${promotedPart}]` : ""),
  );
  writtenFiles.push(partPath);

  const scale = options.scale ?? fitScale(geometry.geometry, mmFactor(units.units?.name));
  if (scale !== undefined) {
    console.log(`     view scale: ${scale} (auto=${options.scale === undefined})`);
  }

  const generated = await call(
    "creo_generate_standard_drawing",
    {
      modelName: options.name,
      drawingName: options.drawingName,
      templateName: options.template,
      sheetNumber: 1,
      ...(scale !== undefined ? { scale } : {}),
      save: true,
      pdfFileName: pdfName,
      dxfFileName: dxfName,
      overwrite: true,
    },
    300000,
  );
  requireTrue(generated, "created", "generate drawing");
  requireTrue(generated, "verified", "generate drawing");
  requireTrue(generated, "saved", "generate drawing");
  const viewNames = (generated.views ?? []).map((view) => view.name ?? view.id);
  check(
    "drawing views",
    (generated.views ?? []).length >= 3,
    `${(generated.views ?? []).length} view(s): ${viewNames.join(", ")}`,
  );
  check(
    "drawing exports",
    (generated.exports ?? []).length === 2,
    `${(generated.exports ?? []).length} export(s)`,
  );

  for (const fileName of [`${options.drawingName}.drw`, pdfName, dxfName]) {
    const filePath = path.join(workingDirectory, fileName);
    if (fileName.endsWith(".drw")) {
      const promotedDrawing = promoteNewestVersion(workingDirectory, fileName);
      if (promotedDrawing) {
        console.log(`     promoted ${promotedDrawing} -> ${fileName}`);
      }
    }
    check("output on disk", fileSize(filePath) > 0, `${filePath} (${fileSize(filePath)} bytes)`);
    if (fileSize(filePath) > 0) writtenFiles.push(filePath);
  }

  console.log(`\nOpen in Creo: ${options.name.toUpperCase()} (part) + ${options.drawingName.toUpperCase()} (drawing)`);
  console.log(`Artifacts:    ${writtenFiles.join("\n              ")}`);
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  failures += 1;
} finally {
  await client.close().catch(() => {});
}

console.log(failures === 0 ? "\nMODEL_DRAWING_OK" : `\nMODEL_DRAWING_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
