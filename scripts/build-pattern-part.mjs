# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live P5 acceptance: linear and axis-driven feature patterns.
// Requires a running Creo, a built server/native bridge, and a solid template.
// Usage: node scripts/build-pattern-part.mjs [--name mcp_patterns] [--keep]

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../packages/server/dist/config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { name: "mcp_patterns", keep: false };
for (let i = 0; i < process.argv.slice(2).length; i += 1) {
  const arg = process.argv.slice(2)[i];
  if (arg === "--name") options.name = process.argv.slice(2)[++i];
  else if (arg === "--keep") options.keep = true;
  else throw new Error(`Unknown argument: ${arg}`);
}
if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.name)) throw new Error("Invalid --name");

const config = loadConfig({});
if (!config.creo.installDir || !config.creo.bridgePathExists) {
  throw new Error("Creo install or native bridge missing; check setup and run npm run build:native.");
}
const serverEntry = path.join(repoRoot, "packages", "server", "dist", "index.js");
if (!existsSync(serverEntry)) throw new Error("Server build missing; run npm run build.");
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
const client = new Client({ name: "build-pattern-part", version: "1.0.0" });
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
    resetTimeoutOnProgress: true,
  });
  if (result.isError) {
    const message = (result.content ?? []).map((item) => item.type === "text" ? item.text : "").join("\n");
    throw new Error(`${name} failed: ${message}`);
  }
  return result.structuredContent ?? {};
}
let failures = 0;
let workingDirectory;
const check = (label, ok, details = "") => {
  console.log(`${ok ? "[ok]" : "[FAIL]"} ${label}${details ? ` - ${details}` : ""}`);
  if (!ok) failures += 1;
};
try {
  await client.connect(transport);
  workingDirectory = (await call("creo_get_working_directory")).workingDirectory;
  await call("creo_close_model", { name: options.name, force: true }).catch(() => {});
  const template = path.join(config.creo.installDir, "Common Files", "templates", "mmns_part_solid_abs.prt");
  if (!existsSync(template)) throw new Error(`Creo template missing: ${template}`);
  for (const entry of readdirSync(workingDirectory)) {
    if (new RegExp(`^${options.name}\\.(prt|log)(\\.\\d+)?$`, "i").test(entry)) unlinkSync(path.join(workingDirectory, entry));
  }

  const part = await call("creo_create_part_from_template", { modelName: options.name, template: "mmns_part_solid_abs.prt" });
  check("template part created", part.verified === true);
  const plate = await call("creo_create_extrude", {
    name: options.name, sketchPlane: "TOP", orientRef: "FRONT", depth: 20,
    featureName: "PLATE",
    section: [{ type: "rectangle", x1: -50, y1: -30, x2: 50, y2: 30 }],
  });
  check("plate extruded", plate.verified === true, `feature ${plate.feature?.id}`);
  const surfaces = await call("creo_get_surfaces", { name: options.name });
  const plateFaces = surfaces.surfaces.filter((item) =>
    Array.isArray(item.samplePoint) &&
    (item.featureType === "PROTRUSION" || String(item.featureName ?? "").includes("PLATE")),
  );
  const face = plateFaces.reduce((best, item) =>
    !best || item.samplePoint[1] > best.samplePoint[1] ? item : best,
  undefined);
  if (!face) throw new Error("Could not identify the plate's top face from surface readback.");
  const hole = await call("creo_create_hole", {
    name: options.name,
    placement: { type: "linear", surface: { surfaceId: face.id }, ref1: "RIGHT", offset1: 0, ref2: "FRONT", offset2: 12 },
    diameter: 6, depth: { type: "through" }, featureName: "SEED_HOLE",
  });
  check("seed hole created", hole.verified === true, `feature ${hole.feature?.id}`);

  const linear = await call("creo_create_pattern", {
    name: options.name, seedFeatureId: hole.feature.id, type: "linear",
    direction1: { reference: "RIGHT", count: 3, spacing: 20 }, featureName: "LINEAR_HOLE_PATTERN",
  });
  check("linear pattern member readback", linear.verified === true && linear.instanceCount === 3,
    `${linear.instanceCount} instances / ${linear.memberCount} members`);

  const refreshedSurfaces = await call("creo_get_surfaces", { name: options.name });
  const secondFace = refreshedSurfaces.surfaces
    .filter((item) => Array.isArray(item.samplePoint) &&
      (item.featureType === "PROTRUSION" || String(item.featureName ?? "").includes("PLATE")))
    .reduce((best, item) => !best || item.samplePoint[1] > best.samplePoint[1] ? item : best, undefined);
  if (!secondFace) throw new Error("Could not re-identify the plate face for the axis-pattern seed.");
  const axisSeed = await call("creo_create_hole", {
    name: options.name,
    placement: { type: "linear", surface: { surfaceId: secondFace.id }, ref1: "RIGHT", offset1: 0, ref2: "FRONT", offset2: -12 },
    diameter: 6, depth: { type: "through" }, featureName: "AXIS_SEED_HOLE",
  });
  check("axis-pattern seed hole created", axisSeed.verified === true, `feature ${axisSeed.feature?.id}`);

  const datumAxis = await call("creo_create_datum_axis", {
    name: options.name, type: "twoPlanes", plane1: "TOP", plane2: "FRONT", featureName: "PATTERN_AXIS",
  });
  check("datum axis created for angular pattern", datumAxis.verified === true);
  const angular = await call("creo_create_pattern", {
    name: options.name, seedFeatureId: hole.feature.id, type: "axis",
    axis: { axisId: datumAxis.datum.axisId }, count: 3, angle: 120, featureName: "AXIS_HOLE_PATTERN",
  });
  check("axis pattern member readback", angular.verified === true && angular.instanceCount === 3,
    `${angular.instanceCount} instances / ${angular.memberCount} members`);

  const regenerated = await call("creo_regenerate_model", { name: options.name });
  check("regenerate patterned part", regenerated.verified === true);
  const finalFeatures = await call("creo_get_features", { name: options.name });
  for (const [label, pattern] of [["linear", linear], ["axis", angular]]) {
    const memberIds = pattern.members.map((member) => member.id).filter((id) => typeof id === "number");
    const activeIds = new Set(finalFeatures.features.filter((item) => item.status === "active").map((item) => item.id));
    check(`${label} pattern members remain active`, memberIds.length === 3 && memberIds.every((id) => activeIds.has(id)),
      `members ${memberIds.join(", ")}`);
  }
  const saved = await call("creo_save_model", { name: options.name });
  check("save pattern showcase", saved.verified === true);
} catch (error) {
  console.error(`[FAIL] ${error?.message ?? error}`);
  failures += 1;
} finally {
  if (!options.keep) {
    try { await call("creo_close_model", { name: options.name, force: true }); } catch {}
  }
  if (!options.keep && workingDirectory) {
    for (const entry of readdirSync(workingDirectory)) {
      if (new RegExp(`^${options.name}\\.(prt|log)(\\.\\d+)?$`, "i").test(entry)) {
        try { unlinkSync(path.join(workingDirectory, entry)); } catch {}
      }
    }
  }
  await client.close().catch(() => {});
}
console.log(failures === 0 ? "\nPATTERN_PART_OK" : `\nPATTERN_PART_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
