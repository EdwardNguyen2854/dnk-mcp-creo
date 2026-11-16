# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Live read-pack smoke test: bridge -> Creo, exercising every M2.0 read command
// against Creo's demo tutorial corpus.
//
// Usage (from the repository root):
//   node scripts/fixture-models.mjs        # one-time sandbox preparation
//   node scripts/read-pack-smoke.mjs       # attach to a running Creo
//   node scripts/read-pack-smoke.mjs --launch
//   node scripts/read-pack-smoke.mjs --keep-open --keep-files
//   node scripts/read-pack-smoke.mjs --launch --keep-running
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
const useLaunch = args.includes("--launch");
const keepOpen = args.includes("--keep-open");
const keepFiles = args.includes("--keep-files");

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const config = loadConfig({});
const logger = createLogger("warn", "read-pack-smoke");

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
  requestTimeoutMs: 120000,
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

const copiedByUs = [];
const openedByUs = [];

async function readModel(label, name, isPart) {
  const target = name ? { name } : {};

  const attempt = async (suffix, fn) => {
    try {
      await fn();
    } catch (error) {
      check(
        `${label} ${suffix}`,
        false,
        error?.message ?? String(error),
      );
    }
  };

  await attempt("parameters", async () => {
    const result = await bridge.call("model.parameters", target);
    check(
      `${label} parameters`,
      Array.isArray(result.parameters),
      `${result.parameters.length} parameter(s)`,
    );
  });

  await attempt("dimensions", async () => {
    const result = await bridge.call("model.dimensions", target);
    check(
      `${label} dimensions`,
      Array.isArray(result.dimensions),
      `${result.dimensions.length} dimension(s)`,
    );
  });

  await attempt("features", async () => {
    const result = await bridge.call("model.features", target);
    check(
      `${label} features`,
      Array.isArray(result.features) && result.features.length > 0,
      `${result.features.length} feature(s)`,
    );
  });

  await attempt("relations", async () => {
    const result = await bridge.call("model.relations", target);
    check(
      `${label} relations`,
      Array.isArray(result.relations),
      `${result.relations.length} relation(s)`,
    );
  });

  await attempt("mass properties", async () => {
    const result = await bridge.call("model.mass_properties", target);
    check(
      `${label} mass properties`,
      result.massProperties !== null && result.massProperties.volume > 0,
      result.massProperties
        ? `volume=${result.massProperties.volume} mass=${result.massProperties.mass}`
        : "no mass properties",
    );
  });

  await attempt("materials", async () => {
    const result = await bridge.call("model.materials", target);
    check(
      `${label} materials`,
      isPart
        ? result.supported === true && Array.isArray(result.materials)
        : result.supported === false,
      isPart
        ? `${result.materials.length} material(s)`
        : "not a part (supported=false)",
    );
  });

  await attempt("layers", async () => {
    const result = await bridge.call("model.layers", target);
    check(
      `${label} layers`,
      Array.isArray(result.layers),
      `${result.layers.length} layer(s)`,
    );
  });

  await attempt("units", async () => {
    const result = await bridge.call("model.units", target);
    check(
      `${label} units`,
      result.units !== null && typeof result.units.name === "string",
      result.units ? result.units.name : "no unit system",
    );
  });

  await attempt("geometry", async () => {
    const result = await bridge.call("model.geometry", target);
    check(
      `${label} geometry`,
      result.geometry !== null &&
        (isPart ? result.geometry.counts.edges > 0 : true),
      result.geometry
        ? `edges=${result.geometry.counts.edges} surfaces=${result.geometry.counts.surfaces}`
        : "no geometry summary",
    );
  });

  await attempt("family table", async () => {
    const result = await bridge.call("model.family_table", target);
    check(
      `${label} family table`,
      result.familyTable === null ||
        (Array.isArray(result.familyTable.columns) &&
          Array.isArray(result.familyTable.rows)),
      result.familyTable === null ? "none" : "present",
    );
  });
}

try {
  console.log(`Bridge:   ${config.creo.bridgePath}`);
  console.log(`Creo:     ${config.creo.installDir}`);
  console.log(`Mode:     ${useLaunch ? "launch" : "attach"}\n`);

  const hello = await bridge.hello();
  check(
    "bridge.hello",
    hello.protocolVersion === "1.0",
    `protocol ${hello.protocolVersion}, otk ${hello.otkLibrary}, bridge ${hello.bridge.version}`,
  );

  const connectParams = {
    mode: useLaunch ? "launch" : "attach",
    timeoutSec: useLaunch ? 300 : 15,
  };
  if (useLaunch && config.creo.creoCommand) {
    connectParams.creoCommand = config.creo.creoCommand;
  }
  if (config.creo.textPath) {
    connectParams.textPath = config.creo.textPath;
  }
  if (useLaunch) {
    console.log("Launching Creo Parametric (this can take several minutes)...");
  }
  const session = await bridge.call("session.connect", connectParams, {
    timeoutMs: useLaunch ? 330000 : 30000,
  });
  check("session.connect", session.connected === true, session.creoVersion ?? "");

  const workingDirectory = session.workingDirectory;
  if (typeof workingDirectory !== "string" || workingDirectory.length === 0) {
    throw new Error("Creo did not report a working directory");
  }
  console.log(`Working dir: ${workingDirectory}\n`);

  const corpus = readdirSync(sandboxDir).filter((entry) =>
    /\.(prt|asm)$/i.test(entry),
  );
  if (corpus.length === 0) {
    throw new Error(`No fixture models found in ${sandboxDir}`);
  }

  for (const entry of corpus) {
    const source = path.join(sandboxDir, entry);
    const target = path.join(workingDirectory, entry);
    if (existsSync(target)) {
      continue;
    }
    copyFileSync(source, target);
    copiedByUs.push(target);
  }
  check(
    "fixture files in working directory",
    true,
    `${corpus.length} file(s), ${copiedByUs.length} copied by this run`,
  );

  const assemblyFile = corpus.find((entry) => /\.asm$/i.test(entry));
  const partFile = corpus.find((entry) => /\.prt$/i.test(entry));
  const targets = [assemblyFile, partFile].filter(Boolean);

  for (const fileName of targets) {
    const result = await bridge.call("model.open", { fileName });
    const model = result.model;
    if (result.opened) {
      openedByUs.push(fileName);
    }
    check(
      `model.open ${fileName}`,
      Boolean(model) && (result.opened || result.alreadyOpen),
      model ? `${model.name} (${model.type})` : "no model",
    );
  }

  if (assemblyFile) {
    await readModel(
      `[assembly ${assemblyFile}]`,
      assemblyFile.replace(/\.[^.]+$/, ""),
      false,
    );
  }
  if (partFile) {
    await readModel(
      `[part ${partFile}]`,
      partFile.replace(/\.[^.]+$/, ""),
      true,
    );
  }

  if (!keepOpen) {
    for (const fileName of openedByUs) {
      const result = await bridge.call("model.close", { name: fileName });
      check(`model.close ${fileName}`, result.closed === true, result.name);
    }
  }
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  if (error?.code) {
    console.error(`       code: ${error.code}`);
  }
  failures += 1;
} finally {
  if (!keepFiles && copiedByUs.length > 0) {
    for (const file of copiedByUs) {
      try {
        unlinkSync(file);
      } catch {
        // Best effort; Creo may still hold the file if --keep-open was used.
      }
    }
  }
  if (!useLaunch || args.includes("--keep-running")) {
    await bridge.close();
  } else {
    try {
      await bridge.call("session.disconnect", { timeoutSec: 60 });
    } catch {
      // Ignore teardown failures.
    }
    await bridge.close();
  }
}

console.log(
  failures === 0 ? "\nREAD_PACK_OK" : `\nREAD_PACK_FAILED (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
