# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Dev helper: call one raw bridge method against the live Creo session.
//
// Usage:
//   node scripts/dev-bridge-call.mjs <method> [jsonParams]
//   node scripts/dev-bridge-call.mjs feature.create_datum_plane '{"name":"X","dtype":"offset"}'
//   node scripts/dev-bridge-call.mjs model.list
//
// Requires npm run build:native and a running Creo; not part of npm test.

import { readFileSync } from "node:fs";

import { loadConfig, buildBridgeEnv } from "../packages/server/dist/config.js";
import { createLogger } from "../packages/server/dist/logging.js";
import { StdioOtkTransport } from "../packages/server/dist/bridge/stdio-otk.js";

const method = process.argv[2];
if (!method) {
  console.error("usage: node scripts/dev-bridge-call.mjs <method> [jsonParams|@file]");
  process.exit(2);
}
const rawParams = process.argv[3] ?? "{}";
const params = rawParams.startsWith("@")
  ? JSON.parse(readFileSync(rawParams.slice(1), "utf8"))
  : JSON.parse(rawParams);

const config = loadConfig({});
if (!config.creo.installDir) {
  console.error("FAIL: no Creo installation detected.");
  process.exit(1);
}

const transport = new StdioOtkTransport({
  bridgePath: config.creo.bridgePath,
  env: { ...process.env, ...buildBridgeEnv(config) },
  requestTimeoutMs: Number(process.env.BRIDGE_TIMEOUT_MS ?? 300000),
  logger: createLogger("warn"),
});

try {
  const info = await transport.call("session.info");
  if (!info.connected) {
    const connected = await transport.call("session.connect", {
      mode: config.creo.connectMode,
      timeoutSec: config.creo.connectTimeoutSec,
    });
    console.log(`connected: ${connected.connected}`);
  } else {
    console.log(`already connected: ${info.connected}`);
  }
  const result = await transport.call(method, params);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`FAILED: ${error?.message ?? error}`);
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
} finally {
  await transport.close().catch(() => {});
}
