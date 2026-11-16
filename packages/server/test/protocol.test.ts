// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  BRIDGE_FRAME_PREFIX,
  modelInfoSchema,
  parseBridgeFrame,
  sessionInfoSchema,
} from "../src/bridge/protocol.js";

describe("bridge protocol", () => {
  it("ignores output that is not framed", () => {
    expect(parseBridgeFrame("Creo startup noise")).toBeUndefined();
    expect(parseBridgeFrame("")).toBeUndefined();
  });

  it("parses a framed JSON line and tolerates CRLF", () => {
    const frame = `${BRIDGE_FRAME_PREFIX}{"jsonrpc":"2.0","id":1,"result":{"pong":true}}\r`;
    expect(parseBridgeFrame(frame)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { pong: true },
    });
  });

  it("accepts an offline session payload", () => {
    expect(sessionInfoSchema.parse({ connected: false })).toEqual({
      connected: false,
    });
  });

  it("requires essential model fields", () => {
    expect(() => modelInfoSchema.parse({ name: "X" })).toThrow();
    expect(() =>
      modelInfoSchema.parse({
        name: "X",
        type: "part",
        fileName: "x.prt",
        fullName: "X",
        isModified: false,
        isNative: true,
      }),
    ).not.toThrow();
  });
});
