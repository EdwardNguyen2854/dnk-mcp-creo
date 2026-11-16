# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live detail-feature demo: build a plate and finish it through the MCP tools.
//
// Exercises the reference-addressing and detail-feature tool set end to end:
//   creo_create_part_from_template   template part with datum planes
//   creo_create_extrude              plate body
//   creo_get_edges                   addressable edges
//   creo_create_round                two vertical edges
//   creo_create_chamfer              one vertical edge
//   creo_get_surfaces                addressable faces with sample points
//   creo_create_shell                hollow the plate, removing one face
//
// Every creation is verified from Creo readback: the tool's own volume decrease
// plus an analytic comparison computed from the same numbers.
//
// Usage (from the repository root, with a running Creo session):
//   node scripts/build-detail-part.mjs
//   node scripts/build-detail-part.mjs --name demo_plate
//   node scripts/build-detail-part.mjs --keep
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

// Plate dimensions (mm). TOP is the XY datum plane, so the sketch rectangle
// spans X/Y and the extrude runs along Z here.
const DIM = {
  length: 100,
  width: 60,
  depth: 20,
  roundRadius: 3,
  chamferDistance: 2,
  shellThickness: 2,
};

function parseArgs(argv) {
  const options = { name: "mcp_detail", keep: false };
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
const client = new Client({ name: "build-detail-part", version: "1.0.0" });

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

let workingDirectory;
try {
  await client.connect(transport);

  const working = await call("creo_get_working_directory");
  workingDirectory = working.workingDirectory;
  const status = await call("creo_status");
  console.log(
    `Creo ${status.session?.creoVersion ?? "?"} | working directory: ${workingDirectory}\n`,
  );

  // Close leftovers and remove stale files so the run is deterministic.
  await call("creo_close_model", { name: options.name, force: true }).catch(() => {});
  for (const entry of readdirSync(workingDirectory)) {
    if (
      new RegExp(`^${options.name}\\.(prt|stp|stl|log)(\\.\\d+)?$`, "i").test(entry)
    ) {
      unlinkSync(path.join(workingDirectory, entry));
    }
  }

  // 1. Seed the part from a Creo template (this is the new template tool; the
  //    old workflow copied the file by hand and opened it).
  const created = await call("creo_create_part_from_template", {
    modelName: options.name,
    template: "mmns_part_solid_abs.prt",
  });
  check(
    "create part from template",
    created.verified === true &&
      String(created.model?.name ?? "").toUpperCase() === options.name.toUpperCase(),
    created.model ? `${created.model.name} (${created.model.fileName})` : "no model",
  );

  const seeded = await call("creo_get_features", { name: options.name });
  const datumNames = seeded.features
    .filter((feature) => feature.type === "DATUM PLANE")
    .map((feature) => feature.name);
  check(
    "template datum planes",
    ["TOP", "FRONT", "RIGHT"].every((name) => datumNames.includes(name)),
    datumNames.join(", "),
  );

  // 2. Plate body.
  const extrude = await call("creo_create_extrude", {
    name: options.name,
    sketchPlane: "TOP",
    orientRef: "FRONT",
    depth: DIM.depth,
    featureName: "PLATE_BODY",
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

  const mass0 = await call("creo_get_mass_properties", { name: options.name });
  const volume0 = mass0.massProperties?.volume ?? 0;
  const boxVolume = DIM.length * DIM.width * DIM.depth;
  check("plate volume", Math.abs(volume0 - boxVolume) < 1, `${volume0} (expect ${boxVolume})`);

  // The four corner edges run along the extrude direction; round/chamfer need
  // their ids, which only the edge listing can provide.
  const pickVerticalEdges = async () => {
    const listed = await call("creo_get_edges", { name: options.name });
    return listed.edges.filter(
      (edge) =>
        edge.edgeTypeName === "line" &&
        Math.abs(edge.start[1] - edge.end[1]) > DIM.depth - 0.01,
    );
  };

  const verticals = await pickVerticalEdges();
  check(
    "four vertical edges",
    verticals.length === 4,
    verticals.map((edge) => edge.id).join(", "),
  );
  const edgeLength = verticals[0]?.length ?? DIM.depth;

  // 3. Rounds on two corner edges.
  const roundEdgeIds = verticals.slice(0, 2).map((edge) => edge.id);
  const round = await call(
    "creo_create_round",
    {
      name: options.name,
      edgeIds: roundEdgeIds,
      radius: DIM.roundRadius,
      featureName: "EDGE_ROUNDS",
    },
    180000,
  );
  const expectedRound =
    2 * (1 - Math.PI / 4) * DIM.roundRadius ** 2 * edgeLength;
  check("round two edges", round.verified === true, `feature ${round.feature?.id}`);
  check(
    "round volume delta",
    Math.abs(round.volumeChange - expectedRound) < expectedRound * 0.01,
    `${round.volumeChange?.toFixed(3)} (expect ${expectedRound.toFixed(3)})`,
  );

  // 4. Chamfer one more corner edge (re-list so the ids are fresh).
  const verticalsAfterRound = await pickVerticalEdges();
  const usedIds = new Set(roundEdgeIds);
  const chamferEdge =
    verticalsAfterRound.find((edge) => !usedIds.has(edge.id)) ??
    verticalsAfterRound[0];
  const chamfer = await call(
    "creo_create_chamfer",
    {
      name: options.name,
      edgeIds: [chamferEdge.id],
      distance: DIM.chamferDistance,
      featureName: "EDGE_CHAMFER",
    },
    180000,
  );
  // A symmetric chamfer on a 90-degree edge removes a right triangle with
  // legs equal to the distance.
  const expectedChamfer = 0.5 * DIM.chamferDistance ** 2 * edgeLength;
  check("chamfer one edge", chamfer.verified === true, `feature ${chamfer.feature?.id}`);
  check(
    "chamfer volume delta",
    Math.abs(chamfer.volumeChange - expectedChamfer) < expectedChamfer * 0.01,
    `${chamfer.volumeChange?.toFixed(3)} (expect ${expectedChamfer.toFixed(3)})`,
  );

  // 5. Faces carry a sample point (closest point to the model center), so the
  //    far face can be picked without guessing ids.
  const surfaces = await call("creo_get_surfaces", { name: options.name });
  const withPoints = surfaces.surfaces.filter((surface) =>
    Array.isArray(surface.samplePoint),
  );
  check(
    "surfaces carry sample points",
    withPoints.length > 0,
    `${surfaces.count} surface(s)`,
  );
  const plateFaces = withPoints.filter((surface) =>
    String(surface.featureName ?? "").includes("PLATE") ||
    surface.featureType === "PROTRUSION",
  );
  const faceCandidates = plateFaces.length > 0 ? plateFaces : withPoints;
  const faceToRemove = faceCandidates.reduce((best, surface) =>
    surface.samplePoint[1] > best.samplePoint[1] ? surface : best,
  );
  check(
    "picked the far face",
    typeof faceToRemove?.id === "number",
    `surface ${faceToRemove?.id} at y=${faceToRemove?.samplePoint?.[1]?.toFixed(2)}`,
  );

  // 6. Shell.
  const beforeShell = await call("creo_get_mass_properties", { name: options.name });
  const shell = await call(
    "creo_create_shell",
    {
      name: options.name,
      surfaceIds: [faceToRemove.id],
      thickness: DIM.shellThickness,
      featureName: "PLATE_SHELL",
    },
    180000,
  );
  const afterShell = await call("creo_get_mass_properties", { name: options.name });
  const cavity =
    (DIM.length - 2 * DIM.shellThickness) *
    (DIM.width - 2 * DIM.shellThickness) *
    (DIM.depth - DIM.shellThickness);
  const predicted = boxVolume - cavity;
  const actual = afterShell.massProperties?.volume ?? 0;
  check("shell verified", shell.verified === true, `feature ${shell.feature?.id}`);
  check(
    "shell volume near prediction",
    Math.abs(actual - predicted) < predicted * 0.1,
    `${actual.toFixed(1)} (expect ~${predicted.toFixed(1)})`,
  );
  check(
    "shell removed material",
    actual < (beforeShell.massProperties?.volume ?? 0),
    `before=${beforeShell.massProperties?.volume} after=${actual}`,
  );

  // 7. The model tree carries all four features.
  const finalFeatures = await call("creo_get_features", { name: options.name });
  const featureNames = finalFeatures.features.map((feature) => feature.name);
  check(
    "feature tree",
    ["PLATE_BODY", "EDGE_ROUNDS", "EDGE_CHAMFER", "PLATE_SHELL"].every((name) =>
      featureNames.includes(name),
    ),
    featureNames.filter(Boolean).join(", "),
  );

  const saved = await call("creo_save_model", { name: options.name });
  check("save", saved.verified === true, options.keep ? partFileName : "cleaned up");
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
      if (
        new RegExp(`^${options.name}\\.(prt|stp|stl|log)(\\.\\d+)?$`, "i").test(entry)
      ) {
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

console.log(failures === 0 ? "\nDETAIL_PART_OK" : `\nDETAIL_PART_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
