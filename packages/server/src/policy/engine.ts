// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import type { SafetyMode } from "../config.js";
import { CreoMcpError } from "../errors.js";
import type { Logger } from "../logging.js";

const writeTools = new Set<string>();

export function registerWriteTools(names: readonly string[]): void {
  for (const name of names) {
    writeTools.add(name);
  }
}

export function isWriteTool(name: string): boolean {
  return writeTools.has(name);
}

export class PolicyEngine {
  readonly mode: SafetyMode;
  private readonly logger: Logger;

  constructor(mode: SafetyMode, logger: Logger) {
    this.mode = mode;
    this.logger = logger.child("policy");
  }

  assertAllowed(toolName: string, declaredWrite = false): void {
    if ((declaredWrite || isWriteTool(toolName)) && this.mode === "read-only") {
      throw new CreoMcpError(
        "POLICY_BLOCKED",
        `Tool '${toolName}' can modify Creo data, but safety.mode is 'read-only'. ` +
          "Set safety.mode to 'copy' (recommended) or 'live' to enable it.",
        { details: { tool: toolName, mode: this.mode } },
      );
    }
  }
}
