# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Build a live assembly through the MCP server: create an assembly, assemble
// fixture parts (with a computed side-by-side offset), save it, and export STEP.
//
// Usage (from the repository root, with a running Creo session):
//   node scripts/build-assembly.mjs
//   node scripts/build-assembly.mjs --assembly demo_asm --parts base,block
//   node scripts/build-assembly.mjs --no-export
//
// Requires: npm run build, fixtures/sandbox populated (node scripts/fixture-models.mjs),
// and a built native bridge. Creo's Save() writes a numbered version file in this
// environment, so the newest name.asm.N file is promoted to the primary name.

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
    assembly: "demo_asm",
    parts: ["base", "block"],
    exportStep: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--assembly") options.assembly = argv[++i];
    else if (arg === "--parts") options.parts = String(argv[++i]).split(",");
    else if (arg === "--no-export") options.exportStep = false;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.assembly)) {
    console.error(`--assembly must be a plain Creo model name, got '${options.assembly}'`);
    process.exit(2);
  }
  if (options.parts.length === 0 || options.parts.some((p) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(p))) {
    console.error("--parts must be a comma-separated list of plain Creo part names");
    process.exit(2);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const assemblyFile = `${options.assembly}.asm`;
const stepFile = `${options.assembly}.stp`;

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
for (const part of options.parts) {
  const fixture = path.join(repoRoot, "fixtures", "sandbox", `${part}.prt`);
  if (!existsSync(fixture)) {
    console.error(
      `FAIL: fixture ${fixture} is missing. Run: node scripts/fixture-models.mjs`,
    );
    process.exit(1);
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: {
    DNK_MCP_CREO_PACKS: "core,read,export,modeling",
    DNK_MCP_CREO_SAFETY_MODE: "copy",
    DNK_MCP_CREO_LOG_LEVEL: "warn",
  },
});

const client = new Client({ name: "build-assembly", version: "1.0.0" });

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

function fileSize(filePath) {
  return existsSync(filePath) ? statSync(filePath).size : 0;
}

function cleanArtifacts(directory) {
  const pattern = new RegExp(
    `^${options.assembly.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(asm|stp)(\\.\\d+)?$`,
    "i",
  );
  let removed = 0;
  for (const entry of readdirSync(directory)) {
    if (pattern.test(entry)) {
      unlinkSync(path.join(directory, entry));
      removed += 1;
    }
  }
  return removed;
}

// Promote the newest name.asm.N version file to the primary name.
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

// Place each component after the accumulated extent of the previous ones, with
// a 25 mm gap. Extents are converted into the assembly's units, since the
// demo fixtures use inches while assemblies may use other systems.
function mmFactor(unitsName) {
  const text = String(unitsName ?? "").toLowerCase();
  if (text.includes("inch") || /\bin\b/.test(text)) return 25.4;
  if (text.includes("foot") || text.includes("feet")) return 304.8;
  if (text.includes("centimeter")) return 10;
  if (text.includes("meter") && !text.includes("millimeter")) return 1000;
  return 1;
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

  const working = await call("creo_get_working_directory");
  const workingDirectory = working.workingDirectory;
  check("session", typeof workingDirectory === "string" && workingDirectory.length > 0, workingDirectory);

  const removed = cleanArtifacts(workingDirectory);
  if (removed > 0) {
    console.log(`     removed ${removed} stale artifact(s)`);
  }
  try {
    await call("creo_close_model", { name: options.assembly, force: true }, 120000);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!/MODEL_NOT_FOUND|not open/i.test(message)) {
      const open = await tryCall("creo_list_models", {});
      const stillOpen = (open?.models ?? []).some(
        (model) => String(model.name).toLowerCase() === options.assembly.toLowerCase(),
      );
      if (stillOpen) {
        throw new Error(
          `'${options.assembly}' is open in Creo and could not be closed (${message}). ` +
            "Close its window in Creo and retry.",
        );
      }
    }
  }

  const created = await call("creo_create_assembly", { modelName: options.assembly });
  check(
    "create assembly",
    created.verified === true,
    created.model?.name ?? "no model",
  );

  const assemblyUnits = await call("creo_get_units", { name: options.assembly });
  const assemblyMm = mmFactor(assemblyUnits.units?.name);
  const gap = 25 / assemblyMm;

  let placedRight;
  for (const [index, part] of options.parts.entries()) {
    const partPath = path.join(workingDirectory, `${part}.prt`);
    if (!existsSync(partPath)) {
      copyFileSync(path.join(repoRoot, "fixtures", "sandbox", `${part}.prt`), partPath);
      console.log(`     staged ${part}.prt -> ${workingDirectory}`);
    }
    const geometry = await call("creo_get_geometry", { name: part });
    const partUnits = await call("creo_get_units", { name: part });
    const partMm = mmFactor(partUnits.units?.name);
    const outline = geometry.geometry?.outline;
    const x = index === 0 ? undefined : placedRight + gap;
    const assembled = await call(
      "creo_assemble_component",
      {
        name: options.assembly,
        component: part,
        ...(x !== undefined ? { x } : {}),
      },
      180000,
    );
    check(
      `assemble ${part}`,
      assembled.verified === true,
      `feature ${assembled.feature?.id ?? "?"} (${assembled.feature?.type ?? "?"})` +
        (x !== undefined ? ` at x=${x.toFixed(3)}` : " at default position"),
    );
    const extentRight = outline ? outline.max[0] * (partMm / assemblyMm) : 0;
    placedRight = (x ?? 0) + extentRight;
  }

  const saved = await call("creo_save_model", { name: options.assembly }, 180000);
  check("save assembly", saved.verified === true, saved.model?.fileName ?? options.assembly);
  const promoted = promoteNewestVersion(workingDirectory, assemblyFile);
  const asmPath = path.join(workingDirectory, assemblyFile);
  check(
    "assembly file on disk",
    fileSize(asmPath) > 0,
    `${asmPath} (${fileSize(asmPath)} bytes)` + (promoted ? ` [promoted ${promoted}]` : ""),
  );
  if (fileSize(asmPath) > 0) writtenFiles.push(asmPath);

  if (options.exportStep) {
    const exported = await call(
      "creo_export_step",
      { name: options.assembly, fileName: stepFile, overwrite: true },
      180000,
    );
    const stepPath = path.join(workingDirectory, stepFile);
    check(
      "STEP export",
      exported.verified === true && fileSize(stepPath) > 0,
      `${stepPath} (${fileSize(stepPath)} bytes)`,
    );
    if (fileSize(stepPath) > 0) writtenFiles.push(stepPath);
  }

  const features = await call("creo_get_features", { name: options.assembly });
  const components = (features.features ?? []).filter(
    (feature) => String(feature.type).toLowerCase() === "component",
  );
  check(
    "component readback",
    components.length === options.parts.length,
    components.map((component) => `${component.id}:${component.name ?? component.type}`).join(", "),
  );

  console.log(`\nArtifacts: ${writtenFiles.join("\n           ")}`);
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  failures += 1;
} finally {
  await client.close().catch(() => {});
}

console.log(failures === 0 ? "\nASSEMBLY_OK" : `\nASSEMBLY_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
