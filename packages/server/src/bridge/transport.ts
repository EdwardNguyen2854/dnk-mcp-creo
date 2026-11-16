// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import type { BridgeHello } from "./protocol.js";

export interface BridgeCallOptions {
  timeoutMs?: number;
}

export interface BridgeTransport {
  readonly kind: string;
  hello(): Promise<BridgeHello>;
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: BridgeCallOptions,
  ): Promise<T>;
  close(): Promise<void>;
  isAlive(): boolean;
}
