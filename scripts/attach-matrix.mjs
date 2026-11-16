# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
import { StdioOtkTransport } from "../packages/server/dist/bridge/stdio-otk.js";
import { buildBridgeEnv, loadConfig } from "../packages/server/dist/config.js";
import { createLogger } from "../packages/server/dist/logging.js";

const config = loadConfig({});
const bridge = new StdioOtkTransport({
  bridgePath: config.creo.bridgePath,
  env: buildBridgeEnv(config),
  requestTimeoutMs: 60000,
  logger: createLogger("error", "matrix"),
});

const combos = [
  ["text path only", { mode: "attach", textPath: config.creo.textPath, timeoutSec: 10 }],
  ["no optional args", { mode: "attach", timeoutSec: 10 }],
  ["no text, short timeout", { mode: "attach", timeoutSec: 5 }],
  ["display localhost:0", { mode: "attach", display: "localhost:0", timeoutSec: 10 }],
  ["display :0", { mode: "attach", display: ":0", timeoutSec: 10 }],
  ["empty display + user", { mode: "attach", display: " ", user: " ", timeoutSec: 10 }],
];

try {
  for (const [label, params] of combos) {
    try {
      const info = await bridge.call("session.connect", params, { timeoutMs: 60000 });
      console.log(`[OK]   ${label} -> Creo ${info.creoVersion}, cwd ${info.workingDirectory}`);
      await bridge.call("session.disconnect", {});
      break;
    } catch (error) {
      console.log(`[FAIL] ${label} -> ${error.code}: ${error.message}`);
    }
  }
} finally {
  await bridge.close();
}
