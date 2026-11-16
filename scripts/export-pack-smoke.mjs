# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live export-pack smoke test: bridge -> Creo, exercising every M2.1 export
// command against a fixture part or assembly.
//
// Usage (from the repository root):
//   node scripts/fixture-models.mjs   # one-time sandbox preparation
//   node scripts/export-pack-smoke.mjs
//   node scripts/export-pack-smoke.mjs --keep-files
//
// Requires a built native bridge (npm run build:native) and a built server
// (npm run build). Never part of `npm test`.

import { copyFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioOtkTransport } from "../packages/server/dist/bridge/stdio-otk.js";
import { buildBridgeEnv, loadConfig } from "../packages/server/dist/config.js";
import { createLogger } from "../packages/server/dist/logging.js";

const args = process.argv.slice(2);
const keepFiles = args.includes("--keep-files");
const partFile = args.find((a) => !a.startsWith("--")) ?? null;
const assemblyFile = args.find((a, i) => i > 0 && !a.startsWith("--")) ?? null;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const config = loadConfig({});
const logger = createLogger("warn", "export-pack-smoke");

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

const sandboxDir = path.join(repoRoot, "fixtures", "sandbox");
if (!existsSync(sandboxDir)) {
  console.error(
    "FAIL: fixtures/sandbox is missing. Run: node scripts/fixture-models.mjs",
  );
  process.exit(1);
}

const bridge = new StdioOtkTransport({
  bridgePath: config.creo.bridgePath,
  env: buildBridgeEnv(config),
  requestTimeoutMs: 180000,
  logger,
});

let failures = 0;
const check = (label, condition, details) => {
  const mark = condition ? "[ok]" : "[FAIL]";
  console.log(`${mark} ${label}${details ? ` - ${details}` : ""}`);
  if (!condition) {
    failures += 1;
  }
};

const copiesByUs = [];
const exportsByUs = [];

async function ensureInWorkspace(fileName) {
  const source = path.join(sandboxDir, fileName);
  const target = path.join(
    config.creo.installDir ? "" : "",
    fileName,
  );
  // Always work inside Creo's working directory, which session.info reports.
  void target;
  if (!existsSync(source)) {
    return null;
  }
  return source;
}

try {
  console.log(`Bridge:   ${config.creo.bridgePath}`);
  console.log(`Creo:     ${config.creo.installDir}`);

  const hello = await bridge.hello();
  const caps = Array.isArray(hello.capabilities) ? hello.capabilities : [];
  check(
    "bridge.hello",
    hello.protocolVersion === "1.0",
    `protocol ${hello.protocolVersion}, otk ${hello.otkLibrary}`,
  );
  check(
    "export commands advertised",
    [
      "model.export_step",
      "model.export_iges",
      "model.export_stl",
      "model.export_pdf",
      "model.export_dxf",
    ].every((name) => caps.includes(name)),
    `capabilities list has ${caps.length} entries`,
  );

  const session = await bridge.call("session.connect", {
    mode: "attach",
    timeoutSec: 15,
  });
  check("session.connect", session.connected === true, session.creoVersion ?? "");

  const workingDirectory = session.workingDirectory;
  if (typeof workingDirectory !== "string" || workingDirectory.length === 0) {
    throw new Error("Creo did not report a working directory");
  }
  console.log(`Working dir: ${workingDirectory}\n`);

  const corpus = readdirSync(sandboxDir).filter((entry) =>
    /\.(prt|asm|drw)$/i.test(entry),
  );
  if (corpus.length === 0) {
    throw new Error(`No fixture models found in ${sandboxDir}`);
  }

  const assembly =
    assemblyFile ?? corpus.find((entry) => /\.asm$/i.test(entry));
  const part =
    partFile ??
    corpus.find((entry) => /\.prt$/i.test(entry));
  const drawing = corpus.find((entry) => /\.drw$/i.test(entry));

  async function copyToWorkingDir(fileName) {
    const target = path.join(workingDirectory, fileName);
    if (!existsSync(target)) {
      copyFileSync(path.join(sandboxDir, fileName), target);
      copiesByUs.push(target);
    }
    return target;
  }

  async function openModel(fileName) {
    const result = await bridge.call("model.open", { fileName });
    return result;
  }

  async function exportAndCheck(label, method, params, expectedExtension) {
    // Smoke-test runs re-use the working directory; always overwrite so a prior
    // failed run doesn't trip FILE_EXISTS and mask a real regression.
    const finalParams = { overwrite: true, ...params };
    try {
      const result = await bridge.call(method, finalParams);
      const ok =
        typeof result.path === "string" &&
        result.path.toLowerCase().endsWith(expectedExtension.toLowerCase()) &&
        typeof result.sizeBytes === "number" &&
        result.sizeBytes > 0 &&
        result.verified === true;
      check(
        `${label}`,
        ok,
        ok ? `path=${result.path} size=${result.sizeBytes}` : "see error above",
      );
      if (typeof result.path === "string") {
        exportsByUs.push(result.path);
      }
    } catch (error) {
      check(`${label}`, false, error?.message ?? String(error));
    }
  }

  if (assembly) {
    await copyToWorkingDir(assembly);
    const open = await openModel(assembly);
    check(
      `model.open ${assembly}`,
      Boolean(open.model) && (open.opened || open.alreadyOpen),
      open.model?.name ?? "",
    );
    const baseName = assembly.replace(/\.[^.]+$/, "");
    await exportAndCheck(
      `model.export_step on ${baseName}`,
      "model.export_step",
      { name: baseName, fileName: `${baseName}.stp` },
      ".stp",
    );
    await exportAndCheck(
      `model.export_iges on ${baseName}`,
      "model.export_iges",
      { name: baseName, fileName: `${baseName}.igs` },
      ".igs",
    );
  }

  if (part) {
    await copyToWorkingDir(part);
    const open = await openModel(part);
    check(
      `model.open ${part}`,
      Boolean(open.model) && (open.opened || open.alreadyOpen),
      open.model?.name ?? "",
    );
    const baseName = part.replace(/\.[^.]+$/, "");
    await exportAndCheck(
      `model.export_stl ascii on ${baseName}`,
      "model.export_stl",
      { name: baseName, fileName: `${baseName}.stl`, mode: "ascii" },
      ".stl",
    );
    await exportAndCheck(
      `model.export_stl binary on ${baseName}`,
      "model.export_stl",
      { name: baseName, fileName: `${baseName}-bin.stl`, mode: "binary" },
      ".stl",
    );
  }

  if (drawing) {
    await copyToWorkingDir(drawing);
    const open = await openModel(drawing);
    check(
      `model.open ${drawing}`,
      Boolean(open.model) && (open.opened || open.alreadyOpen),
      open.model?.name ?? "",
    );
    const baseName = drawing.replace(/\.[^.]+$/, "");
    await exportAndCheck(
      `model.export_pdf on ${baseName}`,
      "model.export_pdf",
      { name: baseName, fileName: `${baseName}.pdf` },
      ".pdf",
    );
    await exportAndCheck(
      `model.export_dxf on ${baseName}`,
      "model.export_dxf",
      { name: baseName, fileName: `${baseName}.dxf` },
      ".dxf",
    );
  }

  if (!part && !assembly && !drawing) {
    throw new Error(
      "Sandbox contains no part/assembly/drawing fixtures to export.",
    );
  }
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  if (error?.code) {
    console.error(`       code: ${error.code}`);
  }
  failures += 1;
} finally {
  if (!keepFiles && copiesByUs.length > 0) {
    for (const file of copiesByUs) {
      try {
        unlinkSync(file);
      } catch {
        // Best effort.
      }
    }
  }
  if (!keepFiles && exportsByUs.length > 0) {
    for (const file of exportsByUs) {
      try {
        unlinkSync(file);
      } catch {
        // Best effort; the user kept it.
      }
    }
  }
  try {
    await bridge.call("session.disconnect", { timeoutSec: 30 });
  } catch {
    // Ignore teardown failures.
  }
  await bridge.close();
}

console.log(
  failures === 0 ? "\nEXPORT_PACK_OK" : `\nEXPORT_PACK_FAILED (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
