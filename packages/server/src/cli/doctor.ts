#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { parseArgs } from "node:util";

import { MockBridgeTransport } from "../bridge/mock.js";
import { bridgeHelloSchema, sessionInfoSchema } from "../bridge/protocol.js";
import { StdioOtkTransport } from "../bridge/stdio-otk.js";
import type { BridgeTransport } from "../bridge/transport.js";
import { buildBridgeEnv, loadConfig } from "../config.js";
import { createLogger } from "../logging.js";
import { SERVER_VERSION } from "../server.js";

interface DoctorCheck {
  name: string;
  ok: boolean;
  details: string;
}

const HELP = `dnk-mcp-creo-doctor - diagnostics for the DNK MCP Creo server

Usage: dnk-mcp-creo-doctor [options]

Options:
  --config <path>   Config file path
  --mock            Diagnose using the mock bridge (no Creo required)
  --no-connect      Do not attempt to attach to a running Creo session
  --json            Print machine-readable results
  -h, --help        Show this help
`;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      mock: { type: "boolean", default: false },
      "no-connect": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const checks: DoctorCheck[] = [];
  const logger = createLogger(
    values.json === true ? "silent" : "warn",
    "dnk-mcp-creo-doctor",
  );

  const config = loadConfig(values.config ? { configPath: values.config } : {});
  checks.push({
    name: "config",
    ok: true,
    details: config.configFile ?? "built-in defaults",
  });
  checks.push({
    name: "creo install",
    ok: values.mock === true || Boolean(config.creo.installDir),
    details: config.creo.installDir ?? "not detected (set CREO_INSTALL_DIR)",
  });
  checks.push({
    name: "bridge executable",
    ok: values.mock === true || config.creo.bridgePathExists,
    details: config.creo.bridgePath,
  });
  checks.push({
    name: "safety mode",
    ok: true,
    details: config.safety.mode,
  });
  checks.push({
    name: "tool packs",
    ok: config.tools.packs.length > 0,
    details:
      config.tools.packs.length > 0
        ? config.tools.packs.join(", ")
        : "none enabled",
  });

  let bridge: BridgeTransport;
  if (values.mock === true) {
    bridge = new MockBridgeTransport({ connected: false });
  } else {
    bridge = new StdioOtkTransport({
      bridgePath: config.creo.bridgePath,
      env: buildBridgeEnv(config),
      requestTimeoutMs: config.bridge.requestTimeoutMs,
      logger,
    });
  }

  try {
    const hello = bridgeHelloSchema.parse(await bridge.call("bridge.hello"));
    checks.push({
      name: "bridge hello",
      ok: true,
      details: `protocol ${hello.protocolVersion}, otk ${hello.otkLibrary}, ${hello.platform}`,
    });

    let info = sessionInfoSchema.parse(await bridge.call("session.info"));
    if (!info.connected && values["no-connect"] !== true) {
      const params: Record<string, unknown> = {
        mode: config.creo.connectMode,
        timeoutSec: config.creo.connectTimeoutSec,
      };
      if (config.creo.creoCommand) {
        params["creoCommand"] = config.creo.creoCommand;
      }
      if (config.creo.textPath) {
        params["textPath"] = config.creo.textPath;
      }
      info = sessionInfoSchema.parse(
        await bridge.call("session.connect", params, {
          timeoutMs: (config.creo.connectTimeoutSec + 15) * 1000,
        }),
      );
    }

    checks.push({
      name: "creo session",
      ok: info.connected,
      details: info.connected
        ? `Creo ${info.creoVersion ?? "unknown"} at ${info.workingDirectory ?? "?"}`
        : "no session attached",
    });

    if (info.connected) {
      const models = await bridge.call<{ count: number }>("model.list", {
        type: "all",
      });
      checks.push({
        name: "model access",
        ok: true,
        details: `${models.count} model(s) open`,
      });
    }
  } catch (error) {
    checks.push({
      name: "bridge connection",
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await bridge.close();
  }

  const ok = checks.every((check) => check.ok);

  if (values.json === true) {
    process.stdout.write(
      `${JSON.stringify({ ok, version: SERVER_VERSION, checks }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`dnk-mcp-creo doctor ${SERVER_VERSION}\n\n`);
    for (const check of checks) {
      const mark = check.ok ? "[ok]" : "[FAIL]";
      process.stdout.write(`${mark.padEnd(7)} ${check.name.padEnd(20)} ${check.details}\n`);
    }
    process.stdout.write(`\n${ok ? "All checks passed." : "Some checks failed."}\n`);
  }

  return ok ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `[dnk-mcp-creo-doctor] fatal: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }\n`,
    );
    process.exit(1);
  });
