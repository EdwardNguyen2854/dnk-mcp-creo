// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(level: LogLevel, scope = "dnk-mcp-creo"): Logger {
  const threshold = RANK[level];
  const write = (
    entryLevel: Exclude<LogLevel, "silent">,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (RANK[entryLevel] < threshold) {
      return;
    }
    const timestamp = new Date().toISOString();
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    process.stderr.write(`[${timestamp}] [${entryLevel}] [${scope}] ${message}${suffix}\n`);
  };

  const logger: Logger = {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (childScope) => createLogger(level, `${scope}:${childScope}`),
  };
  return logger;
}
