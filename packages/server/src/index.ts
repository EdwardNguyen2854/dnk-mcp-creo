#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { MockBridgeTransport } from "./bridge/mock.js";
import { StdioOtkTransport } from "./bridge/stdio-otk.js";
import type { BridgeTransport } from "./bridge/transport.js";
import { buildBridgeEnv, loadConfig } from "./config.js";
import type { LogLevel } from "./logging.js";
import { createLogger } from "./logging.js";
import { createCreoMcpServer, SERVER_VERSION } from "./server.js";

const HELP = `dnk-mcp-creo - MCP server for PTC Creo Parametric

Usage: dnk-mcp-creo [options]

Options:
  --config <path>       Path to a dnk-mcp-creo.json config file
  --log-level <level>   debug | info | warn | error | silent (default: info)
  --mock                Use the in-process mock bridge (development only)
  -h, --help            Show this help
  -v, --version         Print the server version

Environment:
  DNK_MCP_CREO_CONFIG        Config file path
  CREO_INSTALL_DIR           Creo Parametric installation directory
  DNK_MCP_CREO_BRIDGE_PATH   Path to creo-otk-bridge.exe
  DNK_MCP_CREO_SAFETY_MODE   read-only | copy | live
  DNK_MCP_CREO_PACKS         Comma-separated tool packs
  DNK_MCP_CREO_LOG_LEVEL     debug | info | warn | error | silent
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      "log-level": { type: "string" },
      mock: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`dnk-mcp-creo ${SERVER_VERSION}\n`);
    return;
  }

  const config = loadConfig(
    values.config ? { configPath: values.config } : {},
  );
  const logLevel = (values["log-level"] as LogLevel | undefined) ?? config.logging.level;
  const logger = createLogger(logLevel);

  let bridge: BridgeTransport;
  if (values.mock === true) {
    bridge = new MockBridgeTransport({ connected: false });
    logger.warn("Running with the in-process mock bridge (no Creo connection)");
  } else {
    bridge = new StdioOtkTransport({
      bridgePath: config.creo.bridgePath,
      env: buildBridgeEnv(config),
      requestTimeoutMs: config.bridge.requestTimeoutMs,
      logger,
    });
  }

  const { server } = await createCreoMcpServer({ config, logger, bridge });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("dnk-mcp-creo ready", {
    bridge: bridge.kind,
    bridgePath: config.creo.bridgePath,
    creoInstallDir: config.creo.installDir ?? "not detected",
    safetyMode: config.safety.mode,
    packs: config.tools.packs,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down`);
    try {
      await server.close();
    } catch {
      // ignore
    }
    try {
      await bridge.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[dnk-mcp-creo] fatal: ${message}\n`);
  process.exit(1);
});
