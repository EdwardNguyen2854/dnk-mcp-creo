# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Integration smoke test for the Creo MCP bridge.
//
// Usage (from the repository root):
//   node scripts/integration-smoke.mjs                 # attach to a running Creo
//   node scripts/integration-smoke.mjs --launch        # start Creo, test, then end it
//   node scripts/integration-smoke.mjs --keep-running  # with --launch, do not end Creo
//
// Requires a built native bridge (npm run build:native) and a built server
// (npm run build).

import { StdioOtkTransport } from "../packages/server/dist/bridge/stdio-otk.js";
import { buildBridgeEnv, loadConfig } from "../packages/server/dist/config.js";
import { createLogger } from "../packages/server/dist/logging.js";

const args = process.argv.slice(2);
const useLaunch = args.includes("--launch");
const keepRunning = args.includes("--keep-running");

const config = loadConfig({});
const logger = createLogger("warn", "integration-smoke");

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
  if (!condition) failures += 1;
};

try {
  console.log(`Bridge:   ${config.creo.bridgePath}`);
  console.log(`Creo:     ${config.creo.installDir}`);
  console.log(`Mode:     ${useLaunch ? "launch" : "attach"}\n`);

  const hello = await bridge.hello();
  check(
    "bridge.hello",
    hello.protocolVersion === "1.0",
    `protocol ${hello.protocolVersion}, otk ${hello.otkLibrary}`,
  );

  const params = {
    mode: useLaunch ? "launch" : "attach",
    timeoutSec: useLaunch ? 300 : 15,
  };
  if (useLaunch && config.creo.creoCommand) {
    params.creoCommand = config.creo.creoCommand;
  }
  if (config.creo.textPath) {
    params.textPath = config.creo.textPath;
  }

  if (useLaunch) {
    console.log("Launching Creo Parametric (this can take several minutes)...");
  }
  const info = await bridge.call("session.connect", params, {
    timeoutMs: useLaunch ? 330000 : 30000,
  });
  check("session.connect", info.connected === true, `Creo ${info.creoVersion ?? "unknown"}${info.creoDateCode ? ` (datecode ${info.creoDateCode})` : ""}`);
  check(
    "session.info working directory",
    typeof info.workingDirectory === "string" && info.workingDirectory.length > 0,
    info.workingDirectory,
  );

  const models = await bridge.call("model.list", { type: "all" });
  check("model.list", typeof models.count === "number", `${models.count} model(s) open`);

  if (info.activeModel) {
    check("model.active", info.activeModel.name.length > 0, info.activeModel.name);
  } else {
    console.log("[--] model.active: no active model (open one to test read tools)");
  }

  if (!keepRunning) {
    await bridge.call("session.disconnect", { timeoutSec: 60 });
    console.log("[ok] session.disconnect");
  }
} catch (error) {
  console.error(`\n[FAIL] ${error?.message ?? error}`);
  if (error?.code) {
    console.error(`       code: ${error.code}`);
  }
  failures += 1;
} finally {
  await bridge.close();
}

console.log(failures === 0 ? "\nSMOKE_OK" : `\nSMOKE_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
