# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live hole-feature demo: straight holes with analytic volume checks.
//
// P4 acceptance flow:
//   creo_create_part_from_template   template part
//   creo_create_extrude              plate body
//   creo_get_surfaces                pick the entry face by sample point
//   creo_create_hole                 through hole (linear placement)
//   creo_create_hole                 counterbore (linear placement + head)
//   creo_regenerate_model            regenerate, then re-verify references
//
// Every hole is verified twice: the tool's own pre/post mass-properties delta,
// and the analytic value computed here (including the 118 degree drill point).
//
// Usage (from the repository root, with a running Creo session):
//   node scripts/build-hole-part.mjs
//   node scripts/build-hole-part.mjs --name demo_holes
//   node scripts/build-hole-part.mjs --keep
//
// Requires: npm run build, npm run build:native, and a Creo install with
// Common Files\templates\mmns_part_solid_abs.prt.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../packages/server/dist/config.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const DIM = {
  length: 100,
  width: 60,
  depth: 20,
  throughDiameter: 10,
  cboreDiameter: 8,
  cboreDepth: 10,
  headDiameter: 16,
  headDepth: 5,
  drillAngle: 118,
};

function parseArgs(argv) {
  const options = { name: "mcp_holes", keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--name") options.name = argv[++i];
    else if (arg === "--keep") options.keep = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.name)) {
    console.error(`--name must be a plain Creo model name, got '${options.name}'`);
    process.exit(2);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const partFileName = `${options.name}.prt`;

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
const templatePath = path.join(
  config.creo.installDir,
  "Common Files",
  "templates",
  "mmns_part_solid_abs.prt",
);
if (!existsSync(templatePath)) {
  console.error(`FAIL: Creo template not found at ${templatePath}`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: {
    CREO_INSTALL_DIR: config.creo.installDir,
    DNK_MCP_CREO_PACKS: "core,read,modeling,features",
    DNK_MCP_CREO_SAFETY_MODE: "copy",
    DNK_MCP_CREO_LOG_LEVEL: "warn",
  },
});
const client = new Client({ name: "build-hole-part", version: "1.0.0" });

async function call(name, args = {}, timeoutMs = 120000) {
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

let failures = 0;
const check = (label, condition, details) => {
  console.log(`${condition ? "[ok]" : "[FAIL]"} ${label}${details ? ` - ${details}` : ""}`);
  if (!condition) failures += 1;
};

// Volume removed by a blind drill: the cylinder to the shoulder plus the
// conical tip beyond it (half angle = drillAngle / 2).
function drillVolume(diameter, depth, angleDeg) {
  const radius = diameter / 2;
  const half = (angleDeg / 2) * (Math.PI / 180);
  const tipDepth = radius / Math.tan(half);
  return Math.PI * radius * radius * depth + (Math.PI / 3) * radius * radius * tipDepth;
}

let workingDirectory;
try {
  await client.connect(transport);

  const working = await call("creo_get_working_directory");
  workingDirectory = working.workingDirectory;
  const status = await call("creo_status");
  console.log(
    `Creo ${status.session?.creoVersion ?? "?"} | working directory: ${workingDirectory}\n`,
  );

  await call("creo_close_model", { name: options.name, force: true }).catch(() => {});
  for (const entry of readdirSync(workingDirectory)) {
    if (new RegExp(`^${options.name}\\.(prt|log)(\\.\\d+)?$`, "i").test(entry)) {
      unlinkSync(path.join(workingDirectory, entry));
    }
  }

  // 1. Template part + plate body.
  const created = await call("creo_create_part_from_template", {
    modelName: options.name,
    template: "mmns_part_solid_abs.prt",
  });
  check("create part from template", created.verified === true);

  const extrude = await call("creo_create_extrude", {
    name: options.name,
    sketchPlane: "TOP",
    orientRef: "FRONT",
    depth: DIM.depth,
    featureName: "PLATE",
    section: [
      {
        type: "rectangle",
        x1: -DIM.length / 2,
        y1: -DIM.width / 2,
        x2: DIM.length / 2,
        y2: DIM.width / 2,
      },
    ],
  });
  check("extrude plate", extrude.verified === true, `feature ${extrude.feature?.id}`);
  const plateVolume = DIM.length * DIM.width * DIM.depth;

  // 2. Entry face: the face whose sample point is farthest along the extrude
  //    direction (the shallowest Y in this template orientation).
  const surfaces = await call("creo_get_surfaces", { name: options.name });
  const plateFaces = surfaces.surfaces.filter(
    (surface) =>
      Array.isArray(surface.samplePoint) &&
      (surface.featureType === "PROTRUSION" ||
        String(surface.featureName ?? "").includes("PLATE")),
  );
  check("entry faces listed", plateFaces.length > 0, `${surfaces.count} surface(s)`);
  const entryFace = plateFaces.reduce((best, surface) =>
    surface.samplePoint[1] > best.samplePoint[1] ? surface : best,
  );
  check(
    "picked the entry face",
    typeof entryFace?.id === "number",
    `surface ${entryFace?.id} at y=${entryFace?.samplePoint?.[1]?.toFixed(2)}`,
  );

  // 3. Through hole, linear placement, offsets from the RIGHT/FRONT datums.
  const beforeThrough = await call("creo_get_mass_properties", { name: options.name });
  const through = await call("creo_create_hole", {
    name: options.name,
    placement: {
      type: "linear",
      surface: { surfaceId: entryFace.id },
      ref1: "RIGHT",
      offset1: 25,
      ref2: "FRONT",
      offset2: 15,
    },
    diameter: DIM.throughDiameter,
    depth: { type: "through" },
    featureName: "HOLE_THRU",
  });
  const afterThrough = await call("creo_get_mass_properties", { name: options.name });
  const throughLoss =
    (beforeThrough.massProperties?.volume ?? 0) - (afterThrough.massProperties?.volume ?? 0);
  const expectedThrough = Math.PI * (DIM.throughDiameter / 2) ** 2 * DIM.depth;
  check("through hole created", through.verified === true, `feature ${through.feature?.id}`);
  check(
    "through hole volume",
    Math.abs(throughLoss - expectedThrough) < expectedThrough * 0.01,
    `${throughLoss.toFixed(3)} (expect ${expectedThrough.toFixed(3)})`,
  );

  // 4. Counterbore: 8 mm drill, 10 mm deep, 16 mm head, 5 mm deep. Reference
  //    edges are re-listed first: ids are session-scoped.
  const edges = await call("creo_get_edges", { name: options.name });
  const lineEdges = edges.edges.filter((edge) => edge.edgeTypeName === "line");
  check("edges re-listed after the through hole", lineEdges.length > 0, `${lineEdges.length}`);

  const beforeCbore = await call("creo_get_mass_properties", { name: options.name });
  const counterbore = await call("creo_create_hole", {
    name: options.name,
    placement: {
      type: "linear",
      surface: { surfaceId: entryFace.id },
      ref1: "RIGHT",
      offset1: -25,
      ref2: "FRONT",
      offset2: -15,
    },
    diameter: DIM.cboreDiameter,
    depth: { type: "blind", value: DIM.cboreDepth },
    head: { type: "counterbore", diameter: DIM.headDiameter, depth: DIM.headDepth },
    featureName: "HOLE_CBORE",
  });
  const afterCbore = await call("creo_get_mass_properties", { name: options.name });
  const cboreLoss =
    (beforeCbore.massProperties?.volume ?? 0) - (afterCbore.massProperties?.volume ?? 0);
  const annulus = Math.PI * ((DIM.headDiameter / 2) ** 2 - (DIM.cboreDiameter / 2) ** 2);
  const expectedCbore =
    drillVolume(DIM.cboreDiameter, DIM.cboreDepth, DIM.drillAngle) + annulus * DIM.headDepth;
  check("counterbore created", counterbore.verified === true, `feature ${counterbore.feature?.id}`);
  check(
    "counterbore volume",
    Math.abs(cboreLoss - expectedCbore) < expectedCbore * 0.01,
    `${cboreLoss.toFixed(3)} (expect ${expectedCbore.toFixed(3)})`,
  );

  // 5. Regenerate and re-verify: feature statuses and reference listings must
  //    stay valid, and the volume must not change.
  const regenerated = await call("creo_regenerate_model", { name: options.name });
  check("regenerate", regenerated.verified === true);
  const afterRegen = await call("creo_get_features", { name: options.name });
  const holeFeatures = afterRegen.features.filter(
    (feature) => feature.type === "HOLE" && feature.status !== "active",
  );
  check(
    "hole features active after regenerate",
    holeFeatures.length === 0,
    holeFeatures.map((feature) => `${feature.name}:${feature.status}`).join(", ") || "all active",
  );
  const massAfterRegen = await call("creo_get_mass_properties", { name: options.name });
  const finalVolume = massAfterRegen.massProperties?.volume ?? 0;
  const predicted = plateVolume - expectedThrough - expectedCbore;
  check(
    "final volume near prediction",
    Math.abs(finalVolume - predicted) < predicted * 0.01,
    `${finalVolume.toFixed(1)} (expect ~${predicted.toFixed(1)})`,
  );

  const edgesAfter = await call("creo_get_edges", { name: options.name });
  check("references remain addressable", edgesAfter.edges.length > 0, `${edgesAfter.count} edge(s)`);

  const saved = await call("creo_save_model", { name: options.name }).catch(
    (error) => {
      const message = String(error?.message ?? error);
      if (message.includes("still marked modified")) {
        console.log(`[warn] this Creo session disallows saving (${message})`);
        return null;
      }
      throw error;
    },
  );
  if (saved) {
    check("save", saved.verified === true, options.keep ? partFileName : "cleaned up");
  }
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  failures += 1;
} finally {
  try {
    await call("creo_close_model", { name: options.name, force: true });
  } catch {
    // Best effort; the model may already be closed.
  }
  if (!options.keep && workingDirectory) {
    for (const entry of readdirSync(workingDirectory)) {
      if (new RegExp(`^${options.name}\\.(prt|log)(\\.\\d+)?$`, "i").test(entry)) {
        try {
          unlinkSync(path.join(workingDirectory, entry));
        } catch {
          // Best effort.
        }
      }
    }
  }
  await client.close().catch(() => {});
}

console.log(failures === 0 ? "\nHOLE_PART_OK" : `\nHOLE_PART_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
