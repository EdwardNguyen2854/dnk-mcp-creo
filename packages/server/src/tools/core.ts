// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import {
  bridgeHelloSchema,
  bridgePingSchema,
  modelInfoResultSchema,
  modelInfoSchema,
  modelListResultSchema,
  sessionInfoSchema,
} from "../bridge/protocol.js";
import {
  asString,
  ok,
  READ_ONLY_ANNOTATIONS,
  type ToolDefinition,
  type ToolResult,
} from "./registry.js";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const statusTool: ToolDefinition = {
  name: "creo_status",
  title: "Creo bridge status",
  description:
    "Report the bridge protocol version, native bridge build, OTK library, " +
    "Creo version when connected, and the current session summary. This tool " +
    "does not auto-attach; model tools do. Read-only.",
  inputSchema: {},
  outputSchema: {
    bridge: bridgeHelloSchema,
    session: sessionInfoSchema,
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (_args, ctx): Promise<ToolResult> => {
    const hello = await ctx.bridge.hello();
    let session: Record<string, unknown> = {
      connected: false,
      hint: "Model tools auto-attach to a running Creo session (mode: attach).",
    };
    try {
      const info = sessionInfoSchema.parse(await ctx.bridge.call("session.info"));
      session = info as Record<string, unknown>;
    } catch (error) {
      session = { connected: false, error: describeError(error) };
    }
    return ok({
      bridge: hello as unknown as Record<string, unknown>,
      session,
    });
  },
};

const workingDirectoryTool: ToolDefinition = {
  name: "creo_get_working_directory",
  title: "Get Creo working directory",
  description:
    "Return the working directory of the live Creo session. All file paths " +
    "used by Creo tools are resolved against this directory. Read-only.",
  inputSchema: {},
  outputSchema: {
    connected: z.boolean(),
    workingDirectory: z.string(),
    creoVersion: z.string().optional(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (_args, ctx): Promise<ToolResult> => {
    const session = await ctx.ensureSession();
    return ok({
      connected: true,
      workingDirectory: session.workingDirectory ?? "",
      ...(session.creoVersion ? { creoVersion: session.creoVersion } : {}),
    });
  },
};

const listModelsTool: ToolDefinition = {
  name: "creo_list_models",
  title: "List open Creo models",
  description:
    "List all models currently open in the Creo session, optionally filtered " +
    "by type. Read-only.",
  inputSchema: {
    type: z
      .enum(["all", "part", "assembly", "drawing", "manufacturing"])
      .optional()
      .describe("Only return models of this type (default: all)."),
  },
  outputSchema: {
    count: z.number(),
    models: z.array(modelInfoSchema),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    const session = await ctx.ensureSession();
    void session;
    const type = asString(args["type"]) ?? "all";
    const result = modelListResultSchema.parse(
      await ctx.bridge.call("model.list", { type }),
    );
    return ok({ count: result.count, models: result.models });
  },
};

const activeModelTool: ToolDefinition = {
  name: "creo_get_active_model",
  title: "Get active Creo model",
  description:
    "Return the model currently active in the Creo session (name, type, file " +
    "name, path, modified/native flags, revision). Read-only.",
  inputSchema: {},
  outputSchema: {
    connected: z.boolean(),
    model: modelInfoSchema.nullable(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (_args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const result = modelInfoResultSchema.parse(
      await ctx.bridge.call("model.active"),
    );
    return ok({ connected: true, model: result.model });
  },
};

const modelInfoTool: ToolDefinition = {
  name: "creo_get_model_info",
  title: "Get Creo model info",
  description:
    "Return detailed information about a named model that is open in the Creo " +
    "session, or about the active model when no name is given. Read-only.",
  inputSchema: {
    name: z
      .string()
      .optional()
      .describe(
        "Model name, file name, or full name (e.g. BRACKET or bracket.prt). " +
          "Defaults to the active model.",
      ),
  },
  outputSchema: {
    model: modelInfoSchema.nullable(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const name = asString(args["name"]);
    const result = modelInfoResultSchema.parse(
      await ctx.bridge.call("model.info", name ? { name } : {}),
    );
    return ok({ model: result.model });
  },
};

const capabilitiesTool: ToolDefinition = {
  name: "creo_capabilities",
  title: "Describe enabled Creo MCP capabilities",
  description:
    "Explain which tool packs and safety mode this server is running with, " +
    "and which bridge commands the native bridge supports. Read-only.",
  inputSchema: {},
  outputSchema: {
    safetyMode: z.string(),
    packs: z.array(z.string()),
    connectMode: z.string(),
    bridgePath: z.string(),
    protocolVersion: z.string(),
    bridgeCapabilities: z.array(z.string()),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (_args, ctx): Promise<ToolResult> => {
    const hello = await ctx.bridge.hello();
    return ok({
      safetyMode: ctx.config.safety.mode,
      packs: ctx.config.tools.packs,
      connectMode: ctx.config.creo.connectMode,
      bridgePath: ctx.config.creo.bridgePath,
      protocolVersion: hello.protocolVersion,
      bridgeCapabilities: hello.capabilities,
    });
  },
};

interface SelfTestCheck {
  name: string;
  ok: boolean;
  details?: string;
}

const selfTestTool: ToolDefinition = {
  name: "creo_self_test",
  title: "Run Creo MCP self test",
  description:
    "Verify the MCP server can reach the native bridge, ping it, query the " +
    "session, and list models when Creo is connected. Read-only diagnostics.",
  inputSchema: {},
  outputSchema: {
    ok: z.boolean(),
    checks: z.array(
      z.object({
        name: z.string(),
        ok: z.boolean(),
        details: z.string().optional(),
      }),
    ),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (_args, ctx): Promise<ToolResult> => {
    const checks: SelfTestCheck[] = [];

    try {
      const hello = await ctx.bridge.hello();
      checks.push({
        name: "bridge.hello",
        ok: true,
        details: `protocol ${hello.protocolVersion}, otk ${hello.otkLibrary}, bridge ${hello.bridge.version}`,
      });
      const ping = bridgePingSchema.parse(await ctx.bridge.call("bridge.ping"));
      checks.push({
        name: "bridge.ping",
        ok: ping.pong,
        details: `connected=${String(ping.connected)}, uptimeMs=${ping.uptimeMs}`,
      });
    } catch (error) {
      checks.push({
        name: "bridge.hello",
        ok: false,
        details: describeError(error),
      });
      return ok({ ok: false, checks });
    }

    try {
      const info = sessionInfoSchema.parse(
        await ctx.bridge.call("session.info"),
      );
      checks.push({
        name: "session.info",
        ok: true,
        details: info.connected
          ? `connected to Creo ${info.creoVersion ?? "unknown"}`
          : "no Creo session attached",
      });
      if (info.connected) {
        const models = modelListResultSchema.parse(
          await ctx.bridge.call("model.list", { type: "all" }),
        );
        checks.push({
          name: "model.list",
          ok: true,
          details: `${models.count} model(s) open`,
        });
      }
    } catch (error) {
      checks.push({
        name: "session.info",
        ok: false,
        details: describeError(error),
      });
    }

    return ok({ ok: checks.every((check) => check.ok), checks });
  },
};

export function coreTools(): ToolDefinition[] {
  return [
    statusTool,
    workingDirectoryTool,
    listModelsTool,
    activeModelTool,
    modelInfoTool,
    capabilitiesTool,
    selfTestTool,
  ];
}
