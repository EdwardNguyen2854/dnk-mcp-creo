# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live datum-feature demo: datums, sketch-plane offsets, and datum references.
//
// P3 acceptance flow:
//   creo_create_part_from_template   template part with TOP/FRONT/RIGHT
//   creo_create_datum_plane          DTM1 = TOP offset 20
//   creo_create_extrude              plate sketched on DTM1 (proves the plane
//                                    resolves as a sketch reference)
//   creo_create_datum_axis           A_1 through TOP x RIGHT
//   creo_create_datum_point          point on a plate edge
//   creo_get_features                all datums present and active
//
// Usage (from the repository root, with a running Creo session):
//   node scripts/build-datum-part.mjs
//   node scripts/build-datum-part.mjs --name demo_datum
//   node scripts/build-datum-part.mjs --keep
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
  length: 80,
  width: 50,
  depth: 15,
  planeOffset: 20,
};

function parseArgs(argv) {
  const options = { name: "mcp_datum", keep: false };
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
const client = new Client({ name: "build-datum-part", version: "1.0.0" });

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

  await call("creo_close_model", { name: options.name, force: true }).catch(() => {});
  for (const entry of readdirSync(workingDirectory)) {
    if (new RegExp(`^${options.name}\\.(prt|log)(\\.\\d+)?$`, "i").test(entry)) {
      unlinkSync(path.join(workingDirectory, entry));
    }
  }

  // 1. Template part with the three default datum planes.
  const created = await call("creo_create_part_from_template", {
    modelName: options.name,
    template: "mmns_part_solid_abs.prt",
  });
  check("create part from template", created.verified === true);

  // 2. Offset datum plane: DTM1 = TOP offset 20.
  const plane = await call("creo_create_datum_plane", {
    name: options.name,
    type: "offset",
    reference: "TOP",
    distance: DIM.planeOffset,
    featureName: "DTM1",
  });
  const planeDatum = plane.datum ?? {};
  check(
    "offset datum plane DTM1",
    plane.verified === true && planeDatum.name === "DTM1",
    `feature ${planeDatum.featureId}, surface ${planeDatum.surfaceId}`,
  );
  check(
    "datum plane resolves to a surface id",
    typeof planeDatum.surfaceId === "number" && planeDatum.surfaceId > 0,
    `surfaceId=${planeDatum.surfaceId}`,
  );

  // 3. Sketch the main body on the new plane: proves the datum resolves as a
  //    sketch plane reference by name.
  const extrude = await call("creo_create_extrude", {
    name: options.name,
    sketchPlane: "DTM1",
    orientRef: "FRONT",
    depth: DIM.depth,
    featureName: "DATUM_BODY",
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
  check("extrude sketched on DTM1", extrude.verified === true, `feature ${extrude.feature?.id}`);

  const mass = await call("creo_get_mass_properties", { name: options.name });
  const volume = mass.massProperties?.volume ?? 0;
  const expected = DIM.length * DIM.width * DIM.depth;
  check(
    "body volume matches the sketch",
    Math.abs(volume - expected) < 1,
    `${volume} (expect ${expected})`,
  );

  // 4. Datum axis through two default planes.
  const axis = await call("creo_create_datum_axis", {
    name: options.name,
    type: "twoPlanes",
    plane1: "RIGHT",
    plane2: "FRONT",
    featureName: "MCP_AXIS",
  });
  const axisDatum = axis.datum ?? {};
  check(
    "datum axis through RIGHT x FRONT",
    axis.verified === true && axisDatum.name === "MCP_AXIS",
    `feature ${axisDatum.featureId}, axis ${axisDatum.axisId}`,
  );
  check(
    "datum axis resolves to an axis id",
    typeof axisDatum.axisId === "number" && axisDatum.axisId > 0,
    `axisId=${axisDatum.axisId}`,
  );

  // 5. Datum point on an edge of the body.
  const edges = await call("creo_get_edges", { name: options.name });
  const lineEdges = edges.edges.filter((edge) => edge.edgeTypeName === "line");
  check("edges listed", lineEdges.length > 0, `${lineEdges.length} line edge(s)`);
  const point = await call("creo_create_datum_point", {
    name: options.name,
    type: "onEdge",
    edgeId: lineEdges[0].id,
    ratio: 0.5,
    featureName: "MCP_PNT",
  });
  const pointDatum = point.datum ?? {};
  check(
    "datum point on an edge",
    point.verified === true && pointDatum.name === "MCP_PNT",
    `feature ${pointDatum.featureId}, point ${pointDatum.pointId}`,
  );

  // 6. All datums present and active; the axis is usable (coaxial hole).
  const listed = await call("creo_get_features", { name: options.name });
  const names = listed.features.map((feature) => `${feature.name}:${feature.status}`);
  check(
    "feature tree carries the datums",
    ["DTM1:active", "MCP_AXIS:active", "MCP_PNT:active"].every((entry) =>
      names.includes(entry),
    ),
    names.filter((name) => !name.startsWith("no_name")).join(", "),
  );

  const surfaces = await call("creo_get_surfaces", { name: options.name });
  const bodyFaces = surfaces.surfaces.filter(
    (surface) =>
      Array.isArray(surface.samplePoint) &&
      (surface.featureType === "PROTRUSION" ||
        String(surface.featureName ?? "").includes("DATUM_BODY")),
  );
  const entryFace = bodyFaces.reduce(
    (best, surface) => (surface.samplePoint[1] > best.samplePoint[1] ? surface : best),
    bodyFaces[0],
  );
  check(
    "body entry face",
    typeof entryFace?.id === "number",
    `surface ${entryFace?.id} at y=${entryFace?.samplePoint?.[1]?.toFixed(2)}`,
  );

  const before = await call("creo_get_mass_properties", { name: options.name });
  const hole = await call("creo_create_hole", {
    name: options.name,
    placement: {
      type: "coaxial",
      axis: "MCP_AXIS",
      surface: { surfaceId: entryFace.id },
    },
    diameter: 8,
    depth: { type: "through" },
    featureName: "AXIS_HOLE",
  });
  const after = await call("creo_get_mass_properties", { name: options.name });
  const holeLoss = (before.massProperties?.volume ?? 0) - (after.massProperties?.volume ?? 0);
  const expectedHole = Math.PI * 16 * DIM.depth;
  check("coaxial hole on the datum axis", hole.verified === true, `feature ${hole.feature?.id}`);
  check(
    "coaxial hole volume",
    Math.abs(holeLoss - expectedHole) < expectedHole * 0.02,
    `${holeLoss.toFixed(3)} (expect ${expectedHole.toFixed(3)})`,
  );

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

console.log(failures === 0 ? "\nDATUM_PART_OK" : `\nDATUM_PART_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
