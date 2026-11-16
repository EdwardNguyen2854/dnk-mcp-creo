// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import os from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "../src/config.js";

export function makeConfig(
  overrides: Partial<ResolvedConfig> = {},
): ResolvedConfig {
  return {
    rootDir: process.cwd(),
    creo: {
      bridgePath: path.join(
        process.cwd(),
        "native",
        "otk-bridge",
        "build",
        "creo-otk-bridge.exe",
      ),
      bridgePathExists: false,
      connectMode: "attach",
      connectTimeoutSec: 5,
      runtimePaths: [],
    },
    bridge: { requestTimeoutMs: 5000 },
    safety: { mode: "read-only" },
    tools: { packs: ["core"] },
    audit: {
      enabled: false,
      path: path.join(os.tmpdir(), "creo-mcp-test-audit.jsonl"),
    },
    logging: { level: "silent" },
    ...overrides,
  };
}

export function structured(result: unknown): Record<string, unknown> {
  return (
    (result as { structuredContent?: Record<string, unknown> })
      .structuredContent ?? {}
  );
}

export function isErrorResult(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

export function errorText(result: unknown): string {
  const content = (result as { content?: { type: string; text: string }[] })
    .content;
  return content?.map((item) => item.text).join("\n") ?? "";
}
