// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";

import type { AuditLog } from "../audit/audit-log.js";
import type { SessionInfo } from "../bridge/protocol.js";
import type { BridgeTransport } from "../bridge/transport.js";
import type { ResolvedConfig } from "../config.js";
import { toToolErrorPayload } from "../errors.js";
import type { Logger } from "../logging.js";
import type { PolicyEngine } from "../policy/engine.js";
import { runSafeWrite } from "../policy/safe-write.js";

export interface ToolContext {
  bridge: BridgeTransport;
  config: ResolvedConfig;
  logger: Logger;
  audit: AuditLog;
  policy: PolicyEngine;
  ensureSession(): Promise<SessionInfo>;
}

export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  structuredContent?: Record<string, unknown>;
  content: ToolTextContent[];
  isError?: boolean;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  outputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
  // Internal marker used by the policy engine. When true, the tool is blocked
  // when safety.mode === "read-only". This is independent of the MCP-standard
  // `readOnlyHint` annotation so that session-mutating tools (which set
  // `readOnlyHint: false` for MCP clients but do not modify files or model
  // data) can still run under "read-only" safety mode.
  writeTool?: boolean;
  handler: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolResult>;
}

export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function ok(structuredContent: Record<string, unknown>): ToolResult {
  return {
    structuredContent,
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
  };
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function writeOutputShape(shape?: ZodRawShape): ZodRawShape {
  const optionalFields = Object.fromEntries(
    Object.entries(shape ?? {}).map(([key, field]) => [
      key,
      (field as z.ZodTypeAny).optional(),
    ]),
  );
  return {
    ...optionalFields,
    dryRun: z.boolean().optional(),
    planned: z.boolean().optional(),
    allowed: z.boolean().optional(),
    blockedReason: z.unknown().optional(),
    mode: z.string().optional(),
    tool: z.string().optional(),
    target: z.string().optional(),
    source: z.unknown().optional(),
    change: z.unknown().optional(),
    checks: z.array(z.string()).optional(),
    executed: z.boolean().optional(),
  };
}

export function registerTool(
  server: McpServer,
  definition: ToolDefinition,
  context: ToolContext,
): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.writeTool
        ? {
            ...definition.inputSchema,
            dryRun: z
              .boolean()
              .optional()
              .describe("Return a safety plan without invoking any write operation."),
            expectedModelName: z
              .string()
              .min(1)
              .optional()
              .describe("Optional identity assertion for the model being written."),
          }
        : definition.inputSchema,
      ...(definition.outputSchema || definition.writeTool
        ? {
            outputSchema: definition.writeTool
              ? writeOutputShape(definition.outputSchema)
              : definition.outputSchema,
          }
        : {}),
      ...(definition.annotations
        ? { annotations: definition.annotations }
        : {}),
    },
    async (args): Promise<ToolResult> => {
      const started = Date.now();
      const callArgs = (args ?? {}) as Record<string, unknown>;
      try {
        context.policy.assertAllowed(definition.name, definition.writeTool === true);
        const result = definition.writeTool
          ? await runSafeWrite(definition, callArgs, context)
          : await definition.handler(callArgs, context);
        try {
          const blockedReason = result.structuredContent?.["blockedReason"];
          const blockedCode = blockedReason && typeof blockedReason === "object"
            ? (blockedReason as Record<string, unknown>)["code"]
            : undefined;
          await context.audit.record({
            ts: new Date().toISOString(),
            tool: definition.name,
            ok: !result.isError,
            ...(typeof blockedCode === "string" ? { code: blockedCode } : {}),
            durationMs: Date.now() - started,
            args: callArgs,
          });
        } catch (auditError) {
          context.logger.warn("Could not write audit record", {
            tool: definition.name,
            error: auditError instanceof Error ? auditError.message : String(auditError),
          });
        }
        return result;
      } catch (error) {
        const payload = toToolErrorPayload(error);
        context.logger.warn(`Tool ${definition.name} failed`, {
          code: payload.error.code,
          message: payload.error.message,
        });
        try {
          await context.audit.record({
            ts: new Date().toISOString(),
            tool: definition.name,
            ok: false,
            code: payload.error.code,
            durationMs: Date.now() - started,
            args: callArgs,
          });
        } catch (auditError) {
          context.logger.warn("Could not write audit failure record", {
            tool: definition.name,
            error: auditError instanceof Error ? auditError.message : String(auditError),
          });
        }
        return {
          isError: true,
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
        };
      }
    },
  );
}
