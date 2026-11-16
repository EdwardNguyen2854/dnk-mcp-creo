// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
export interface CreoMcpErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class CreoMcpError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, options: CreoMcpErrorOptions = {}) {
    super(message);
    this.name = "CreoMcpError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isCreoMcpError(error: unknown): error is CreoMcpError {
  return error instanceof CreoMcpError;
}

export interface ToolErrorPayload {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export function toToolErrorPayload(error: unknown): ToolErrorPayload {
  if (isCreoMcpError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  if (error instanceof Error) {
    return {
      error: {
        code: "INTERNAL",
        message: error.message,
        retryable: false,
      },
    };
  }
  return {
    error: {
      code: "INTERNAL",
      message: String(error),
      retryable: false,
    },
  };
}
