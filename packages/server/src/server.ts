// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AuditLog } from "./audit/audit-log.js";
import { sessionInfoSchema, type SessionInfo } from "./bridge/protocol.js";
import type { BridgeTransport } from "./bridge/transport.js";
import type { ResolvedConfig } from "./config.js";
import type { Logger } from "./logging.js";
import {
  isWriteTool,
  PolicyEngine,
  registerWriteTools,
} from "./policy/engine.js";
import { coreTools } from "./tools/core.js";
import { drawingTools } from "./tools/drawing.js";
import { exportTools } from "./tools/export.js";
import { featureTools } from "./tools/features.js";
import { modelingTools } from "./tools/modeling.js";
import { readTools } from "./tools/read.js";
import { registerTool, type ToolContext } from "./tools/registry.js";

export interface CreateServerDependencies {
  config: ResolvedConfig;
  logger: Logger;
  bridge: BridgeTransport;
}

export interface CreatedServer {
  server: McpServer;
  context: ToolContext;
}

export const SERVER_NAME = "dnk-mcp-creo";
export const SERVER_VERSION = "0.1.0";

export async function createCreoMcpServer(
  dependencies: CreateServerDependencies,
): Promise<CreatedServer> {
  const { config, logger, bridge } = dependencies;

  const audit = new AuditLog(config.audit.enabled, config.audit.path, logger);
  const policy = new PolicyEngine(config.safety.mode, logger);

  let sessionCache: SessionInfo | undefined;

  const ensureSession = async (): Promise<SessionInfo> => {
    if (sessionCache?.connected) {
      return sessionCache;
    }
    const current = sessionInfoSchema.parse(
      await bridge.call("session.info"),
    );
    if (current.connected) {
      sessionCache = current;
      return current;
    }

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

    const connected = sessionInfoSchema.parse(
      await bridge.call("session.connect", params, {
        timeoutMs: (config.creo.connectTimeoutSec + 15) * 1000,
      }),
    );
    sessionCache = connected;
    return connected;
  };

  const context: ToolContext = {
    bridge,
    config,
    logger,
    audit,
    policy,
    ensureSession,
  };

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const tools = coreTools();
  if (config.tools.packs.includes("read")) {
    tools.push(...readTools());
  }
  if (config.tools.packs.includes("export")) {
    tools.push(...exportTools());
  }
  if (config.tools.packs.includes("modeling")) {
    tools.push(...modelingTools());
  }
  if (config.tools.packs.includes("drawing")) {
    tools.push(...drawingTools());
  }
  if (config.tools.packs.includes("features")) {
    tools.push(...featureTools());
  }

  const writeToolNames = tools
    .filter((tool) => tool.writeTool === true)
    .map((tool) => tool.name);
  if (writeToolNames.length > 0) {
    registerWriteTools(writeToolNames);
    if (config.safety.mode === "read-only") {
      logger.warn(
        `Loaded ${writeToolNames.length} write tool(s) under safety.mode=read-only. ` +
          "Calls will be rejected with POLICY_BLOCKED until safety.mode is raised.",
        { writeTools: writeToolNames },
      );
    } else {
      logger.debug("Registered write tools", { writeTools: writeToolNames });
    }
  }

  for (const tool of tools) {
    registerTool(server, tool, context);
  }

  logger.debug("Registered tool packs", {
    packs: config.tools.packs,
    tools: tools.map((tool) => tool.name),
  });

  if (
    config.tools.packs.includes("export") &&
    writeToolNames.every((name) => !isWriteTool(name))
  ) {
    throw new Error("Internal: export tools were not registered as write tools.");
  }

  return { server, context };
}
