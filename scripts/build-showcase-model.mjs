# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live showcase: build a complex 3D part from scratch through the MCP tools.
//
// The part is a six-spoke belt pulley with a keyed bore, built entirely with
// the features pack (creo_create_revolve + creo_create_extrude):
//
//   1  revolve       pulley cross-section (hub, web, V-grooved rim, bore)
//   2-7 six cuts     spoke windows, symmetric through-cuts about the web
//   8  cut           keyway notch in the bore
//
// Everything is verified from Creo readback: the script compares the reported
// volume against an analytic value computed from the same numbers, checks the
// feature tree, and exports STEP/STL (and optionally a drawing).
//
// Usage (from the repository root, with a running Creo session):
//   node scripts/build-showcase-model.mjs
//   node scripts/build-showcase-model.mjs --name demo_pulley
//   node scripts/build-showcase-model.mjs --drawing
//
// Requires: npm run build, npm run build:native, and a Creo install with
// Common Files\templates\mmns_part_solid_abs.prt.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../packages/server/dist/config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pulley dimensions (mm). The wheel axis is Z; the revolve profile is drawn on
// the TOP datum plane with x = radius and y = axial position.
const DIM = {
  boreRadius: 12,
  hubRadius: 22,
  hubHalfHeight: 22,
  webRadius: 62,
  webHalfThickness: 5,
  rimRadius: 80,
  rimHalfWidth: 16,
  grooveRadius: 70,
  spokes: 6,
  windowInner: 24,
  windowOuter: 60,
  windowWidth: 14,
  keywayHalfWidth: 2,
  keywayOuter: 13,
};

function parseArgs(argv) {
  const options = { name: "mcp_pulley", drawing: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--name") options.name = argv[++i];
    else if (arg === "--drawing") options.drawing = true;
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

// Material extent along the wheel axis (Z) at a given radius. The rim carries a
// V-groove, so beyond grooveRadius the material splits into two bands.
function axialExtent(radius) {
  const d = DIM;
  if (radius < d.boreRadius || radius > d.rimRadius) return 0;
  if (radius <= d.hubRadius) return 2 * d.hubHalfHeight;
  if (radius <= d.webRadius) return 2 * d.webHalfThickness;
  if (radius <= d.grooveRadius) return 2 * d.rimHalfWidth;
  const grooveDepth =
    ((radius - d.grooveRadius) / (d.rimRadius - d.grooveRadius)) * d.rimHalfWidth;
  return 2 * (d.rimHalfWidth - grooveDepth);
}

// The revolve profile as a closed polyline in (radius, axial) coordinates.
function pulleyProfile() {
  const d = DIM;
  return {
    type: "polyline",
    points: [
      [d.boreRadius, -d.hubHalfHeight],
      [d.hubRadius, -d.hubHalfHeight],
      [d.hubRadius, -d.webHalfThickness],
      [d.webRadius, -d.webHalfThickness],
      [d.webRadius, -d.rimHalfWidth],
      [d.rimRadius, -d.rimHalfWidth],
      [d.grooveRadius, 0],
      [d.rimRadius, d.rimHalfWidth],
      [d.webRadius, d.rimHalfWidth],
      [d.webRadius, d.webHalfThickness],
      [d.hubRadius, d.webHalfThickness],
      [d.hubRadius, d.hubHalfHeight],
      [d.boreRadius, d.hubHalfHeight],
      [d.boreRadius, -d.hubHalfHeight],
    ],
  };
}

const axisCenterline = { type: "centerline", x1: 0, y1: -30, x2: 0, y2: 30 };

// One spoke window: a rectangle spanning windowInner..windowOuter at the given
// angle, expressed as a closed polyline so it can be rotated.
function windowPolyline(angleDeg) {
  const d = DIM;
  const half = d.windowWidth / 2;
  const local = [
    [d.windowInner, -half],
    [d.windowOuter, -half],
    [d.windowOuter, half],
    [d.windowInner, half],
    [d.windowInner, -half],
  ];
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    type: "polyline",
    points: local.map(([r, t]) => [
      Number((r * cos - t * sin).toFixed(6)),
      Number((r * sin + t * cos).toFixed(6)),
    ]),
  };
}

// Analytic volume of the pulley, by shells around the Z axis:
//   V = 2*pi * integral(r * axialExtent(r) dr) - windows - keyway
function expectedVolume() {
  const d = DIM;
  const steps = 200000;
  const dr = (d.rimRadius - d.boreRadius) / steps;
  let volume = 0;
  for (let i = 0; i < steps; i += 1) {
    const r = d.boreRadius + (i + 0.5) * dr;
    volume += 2 * Math.PI * r * axialExtent(r) * dr;
  }
  // Each spoke window is a straight prism fully inside the web annulus.
  const windowVolume =
    (d.windowOuter - d.windowInner) * d.windowWidth * 2 * d.webHalfThickness;
  volume -= d.spokes * windowVolume;
  // The keyway only removes hub material beyond the bore wall.
  volume -=
    (d.keywayOuter - d.boreRadius) *
    (2 * d.keywayHalfWidth) *
    (2 * d.hubHalfHeight);
  return volume;
}

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
    DNK_MCP_CREO_PACKS: "core,read,export,modeling,features,drawing",
    DNK_MCP_CREO_SAFETY_MODE: "copy",
    DNK_MCP_CREO_LOG_LEVEL: "warn",
  },
});
const client = new Client({ name: "build-showcase-model", version: "1.0.0" });

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

function promoteNewestVersion(directory, baseFileName) {
  const prefix = `${baseFileName}.`;
  const candidates = readdirSync(directory).filter(
    (entry) => entry.startsWith(prefix) && /^\d+$/.test(entry.slice(prefix.length)),
  );
  if (candidates.length === 0) return undefined;
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
  if (newestTime <= primaryTime) return undefined;
  copyFileSync(path.join(directory, newest), primaryPath);
  unlinkSync(path.join(directory, newest));
  return newest;
}

const written = [];
try {
  await client.connect(transport);

  const working = await call("creo_get_working_directory");
  const status = await call("creo_status");
  const workingDirectory = working.workingDirectory;
  console.log(
    `Creo ${status.session?.creoVersion ?? "?"} | working directory: ${workingDirectory}\n`,
  );

  // Close leftovers and remove stale files so the run is deterministic.
  await call("creo_close_model", { name: options.name, force: true }, 120000).catch(() => {});
  for (const entry of readdirSync(workingDirectory)) {
    if (
      new RegExp(`^${options.name}\\.(prt|stp|stl|drw|pdf)(\\.\\d+)?$`, "i").test(entry)
    ) {
      unlinkSync(path.join(workingDirectory, entry));
    }
  }

  // Seed: a template part gives the datum planes and mmNs units.
  const partPath = path.join(workingDirectory, partFileName);
  copyFileSync(templatePath, partPath);
  const opened = await call("creo_open_model", { fileName: partFileName }, 120000);
  check("seed part", opened.opened === true || opened.alreadyOpen === true, opened.model?.name);

  const planes = await call("creo_get_features", { name: options.name });
  const datumNames = planes.features.map((feature) => feature.name);
  check(
    "datum planes",
    ["TOP", "FRONT", "RIGHT"].every((name) => datumNames.includes(name)),
    datumNames.join(", "),
  );

  // Feature 1: the revolved pulley body.
  const revolve = await call(
    "creo_create_revolve",
    {
      name: options.name,
      sketchPlane: "TOP",
      orientRef: "FRONT",
      angle: 360,
      featureName: "PULLEY_BODY",
      section: [axisCenterline, pulleyProfile()],
    },
    180000,
  );
  check("revolve pulley body", revolve.verified === true, `feature ${revolve.feature?.id}`);

  // Features 2-7: spoke windows, cut through the web symmetrically.
  for (let index = 0; index < DIM.spokes; index += 1) {
    const angle = (360 / DIM.spokes) * index;
    const cut = await call(
      "creo_create_extrude",
      {
        name: options.name,
        sketchPlane: "FRONT",
        orientRef: "TOP",
        depth: 40,
        symmetric: true,
        cut: true,
        featureName: `SPOKE_WINDOW_${index + 1}`,
        section: [windowPolyline(angle)],
      },
      180000,
    );
    check(
      `spoke window ${index + 1} (${angle} deg)`,
      cut.verified === true,
      `feature ${cut.feature?.id}, surfaces ${cut.geometry?.counts?.surfaces}`,
    );
  }

  // Feature 8: keyway notch in the bore.
  const keyway = await call(
    "creo_create_extrude",
    {
      name: options.name,
      sketchPlane: "FRONT",
      orientRef: "TOP",
      depth: 44,
      symmetric: true,
      cut: true,
      featureName: "KEYWAY",
      section: [
        {
          type: "rectangle",
          x1: DIM.boreRadius - 4,
          y1: -DIM.keywayHalfWidth,
          x2: DIM.keywayOuter,
          y2: DIM.keywayHalfWidth,
        },
      ],
    },
    180000,
  );
  check("keyway cut", keyway.verified === true, `feature ${keyway.feature?.id}`);

  // Verification from Creo readback.
  const mass = await call("creo_get_mass_properties", { name: options.name });
  const geometry = await call("creo_get_geometry", { name: options.name });
  const features = await call("creo_get_features", { name: options.name });
  const solidFeatures = features.features.filter(
    (feature) => !/DATUM|COORDINATE/i.test(feature.type),
  );
  const expected = expectedVolume();
  const actual = mass.massProperties?.volume ?? 0;
  const delta = Math.abs(actual - expected) / expected;

  check(
    "feature tree",
    solidFeatures.length === 1 + DIM.spokes + 1,
    `${solidFeatures.length} solid feature(s): ${solidFeatures.map((f) => f.name ?? f.type).join(", ")}`,
  );
  check(
    "volume matches analytic value",
    delta < 0.01,
    `Creo ${actual.toFixed(1)} mm^3 vs expected ${expected.toFixed(1)} mm^3 (${(delta * 100).toFixed(3)}%)`,
  );
  check(
    "topology",
    (geometry.geometry?.counts?.surfaces ?? 0) >= 40 &&
      (geometry.geometry?.counts?.edges ?? 0) >= 200,
    `surfaces=${geometry.geometry?.counts?.surfaces} edges=${geometry.geometry?.counts?.edges}`,
  );
  const outline = geometry.geometry?.outline;
  check(
    "outline",
    outline !== undefined &&
      Math.abs(outline.max[2] - DIM.hubHalfHeight) < 0.01 &&
      Math.abs(outline.min[2] + DIM.hubHalfHeight) < 0.01 &&
      Math.abs(outline.max[0] - DIM.rimRadius) < 0.01,
    outline ? `min=${outline.min} max=${outline.max}` : "none",
  );

  const saved = await call("creo_save_model", { name: options.name }, 180000);
  check("save", saved.verified === true);
  const promoted = promoteNewestVersion(workingDirectory, partFileName);
  if (promoted) console.log(`     promoted ${promoted} -> ${partFileName}`);
  written.push(partPath);

  const step = await call(
    "creo_export_step",
    { name: options.name, fileName: `${options.name}.stp`, overwrite: true },
    180000,
  );
  check("STEP export", statSync(step.path).size > 0, `${step.path} (${step.sizeBytes} bytes)`);
  written.push(step.path);

  const stl = await call(
    "creo_export_stl",
    { name: options.name, fileName: `${options.name}.stl`, mode: "binary", overwrite: true },
    180000,
  );
  check("STL export", statSync(stl.path).size > 0, `${stl.path} (${stl.sizeBytes} bytes)`);
  written.push(stl.path);

  if (options.drawing) {
    const templateInWorkdir = path.join(workingDirectory, "a3_drawing.drw");
    const templateSource = path.join(
      config.creo.installDir,
      "Common Files",
      "templates",
      "a3_drawing.drw",
    );
    if (!existsSync(templateInWorkdir) && existsSync(templateSource)) {
      copyFileSync(templateSource, templateInWorkdir);
    }
    const drawing = await call(
      "creo_generate_standard_drawing",
      {
        modelName: options.name,
        drawingName: `${options.name}_drw`,
        templateName: "a3_drawing.drw",
        sheetNumber: 1,
        save: true,
        pdfFileName: `${options.name}.pdf`,
        dxfFileName: `${options.name}.dxf`,
        overwrite: true,
      },
      300000,
    );
    check("drawing", drawing.verified === true, `${(drawing.views ?? []).length} view(s)`);
    written.push(path.join(workingDirectory, `${options.name}.pdf`));
  }

  console.log(`\nModel: ${options.name.toUpperCase()} (part)`);
  console.log(`Artifacts:\n  ${written.join("\n  ")}`);
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  failures += 1;
} finally {
  // The part is left open in Creo for inspection.
  await client.close().catch(() => {});
}

console.log(failures === 0 ? "\nSHOWCASE_MODEL_OK" : `\nSHOWCASE_MODEL_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
