// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { CreoMcpError } from "../errors.js";
import type { Logger } from "../logging.js";
import {
  bridgeHelloSchema,
  BRIDGE_FRAME_PREFIX,
  parseBridgeFrame,
  type BridgeErrorPayload,
  type BridgeHello,
} from "./protocol.js";
import type { BridgeCallOptions, BridgeTransport } from "./transport.js";

interface PendingCall {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface StdioOtkTransportOptions {
  bridgePath: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  logger: Logger;
}

export class StdioOtkTransport implements BridgeTransport {
  readonly kind = "stdio-otk";

  private readonly bridgePath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs: number;
  private readonly logger: Logger;

  private child?: ChildProcessWithoutNullStreams;
  private spawnPromise?: Promise<ChildProcessWithoutNullStreams>;
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private closing = false;

  constructor(options: StdioOtkTransportOptions) {
    this.bridgePath = options.bridgePath;
    this.env = options.env ?? process.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.logger = options.logger.child("bridge");
  }

  isAlive(): boolean {
    return Boolean(
      this.child && this.child.exitCode === null && !this.child.killed,
    );
  }

  async hello(): Promise<BridgeHello> {
    const raw = await this.call("bridge.hello");
    return bridgeHelloSchema.parse(raw);
  }

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: BridgeCallOptions,
  ): Promise<T> {
    if (this.closing) {
      throw new CreoMcpError("BRIDGE_CLOSED", "Bridge transport is closed");
    }
    const child = await this.ensureChild();
    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CreoMcpError(
            "TIMEOUT",
            `Bridge call '${method}' timed out after ${timeoutMs} ms`,
            { retryable: true, details: { method, timeoutMs } },
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      const frame = `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: params ?? {},
      })}\n`;

      child.stdin.write(frame, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(
          new CreoMcpError(
            "BRIDGE_WRITE_FAILED",
            `Failed to send '${method}' to the bridge: ${error.message}`,
            { cause: error, retryable: true },
          ),
        );
      });
    });
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    const child = this.child;
    this.child = undefined;
    this.spawnPromise = undefined;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new CreoMcpError("BRIDGE_CLOSED", "Bridge transport is closing"),
      );
    }
    this.pending.clear();

    if (!child || child.exitCode !== null || child.killed) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }

  private ensureChild(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return Promise.resolve(this.child);
    }
    if (this.spawnPromise) {
      return this.spawnPromise;
    }
    if (!existsSync(this.bridgePath)) {
      return Promise.reject(
        new CreoMcpError(
          "BRIDGE_NOT_FOUND",
          `Bridge executable not found at ${this.bridgePath}. Build it with: npm run build:native`,
          { details: { bridgePath: this.bridgePath } },
        ),
      );
    }

    this.spawnPromise = new Promise<ChildProcessWithoutNullStreams>(
      (resolve, reject) => {
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawn(this.bridgePath, [], {
            cwd: path.dirname(this.bridgePath),
            env: this.env,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (error) {
          reject(
            new CreoMcpError(
              "BRIDGE_SPAWN_FAILED",
              `Could not spawn the bridge: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { cause: error },
            ),
          );
          return;
        }

        const onSpawnError = (error: Error): void => {
          this.spawnPromise = undefined;
          reject(
            new CreoMcpError(
              "BRIDGE_SPAWN_FAILED",
              `Could not start the bridge: ${error.message}`,
              { cause: error },
            ),
          );
        };

        child.once("error", onSpawnError);
        child.once("spawn", () => {
          child.off("error", onSpawnError);
          this.child = child;
          this.attachChild(child);
          this.logger.debug("bridge process started", {
            bridgePath: this.bridgePath,
            pid: child.pid,
          });
          resolve(child);
        });
      },
    );

    this.spawnPromise.catch(() => {
      this.spawnPromise = undefined;
    });
    return this.spawnPromise;
  }

  private attachChild(child: ChildProcessWithoutNullStreams): void {
    const reader = readline.createInterface({ input: child.stdout });
    reader.on("line", (line) => this.handleLine(line));

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        this.logger.debug("bridge stderr", { text });
      }
    });

    child.on("exit", (code, signal) => {
      this.logger.warn("bridge process exited", { code, signal });
      this.child = undefined;
      this.spawnPromise = undefined;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new CreoMcpError(
            "BRIDGE_EXITED",
            `Bridge exited while '${pending.method}' was in flight (code=${String(
              code,
            )}, signal=${String(signal)})`,
            { retryable: true, details: { method: pending.method } },
          ),
        );
      }
      this.pending.clear();
    });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = parseBridgeFrame(line);
    } catch (error) {
      this.logger.warn("Could not parse bridge frame", {
        error: error instanceof Error ? error.message : String(error),
        line: line.slice(0, 200),
      });
      return;
    }
    if (parsed === undefined) {
      this.logger.debug("Ignoring non-protocol bridge output", {
        line: line.slice(0, 200),
      });
      return;
    }

    const response = parsed as {
      id?: unknown;
      result?: unknown;
      error?: BridgeErrorPayload;
    };
    if (typeof response.id !== "number") {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.logger.debug("Received response for unknown request", {
        id: response.id,
      });
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(
        new CreoMcpError(
          response.error.code || "BRIDGE_ERROR",
          response.error.message || "Unknown bridge error",
          {
            retryable: response.error.retryable,
            ...(response.error.details
              ? { details: response.error.details }
              : {}),
          },
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }
}
