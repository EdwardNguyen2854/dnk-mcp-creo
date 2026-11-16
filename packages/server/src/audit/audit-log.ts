// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logging.js";

export interface AuditRecord {
  ts: string;
  tool: string;
  ok: boolean;
  durationMs: number;
  code?: string;
  args?: unknown;
}

export class AuditLog {
  private readonly enabled: boolean;
  private readonly filePath: string;
  private readonly logger: Logger;
  private ready: Promise<void> | undefined;

  constructor(enabled: boolean, filePath: string, logger: Logger) {
    this.enabled = enabled;
    this.filePath = filePath;
    this.logger = logger.child("audit");
  }

  async record(record: AuditRecord): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      if (!this.ready) {
        this.ready = mkdir(path.dirname(this.filePath), { recursive: true }).then(
          () => undefined,
        );
      }
      await this.ready;
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      this.logger.warn("Could not write audit record", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
