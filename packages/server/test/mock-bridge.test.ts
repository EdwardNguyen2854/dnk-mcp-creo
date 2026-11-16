// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import { MockBridgeTransport } from "../src/bridge/mock.js";
import { CreoMcpError } from "../src/errors.js";

describe("MockBridgeTransport", () => {
  it("reports offline session info before connecting", async () => {
    const bridge = new MockBridgeTransport();
    const info = await bridge.call<{ connected: boolean }>("session.info");
    expect(info.connected).toBe(false);
  });

  it("rejects model access before connecting", async () => {
    const bridge = new MockBridgeTransport();
    await expect(bridge.call("model.list")).rejects.toMatchObject({
      code: "SESSION_NOT_CONNECTED",
    });
  });

  it("connects and lists models", async () => {
    const bridge = new MockBridgeTransport();
    await bridge.call("session.connect", { mode: "attach" });
    const result = await bridge.call<{ count: number }>("model.list", {
      type: "all",
    });
    expect(result.count).toBe(2);
  });

  it("filters models by type", async () => {
    const bridge = new MockBridgeTransport();
    await bridge.call("session.connect");
    const result = await bridge.call<{ count: number }>("model.list", {
      type: "assembly",
    });
    expect(result.count).toBe(1);
  });

  it("returns the active model", async () => {
    const bridge = new MockBridgeTransport({ connected: true });
    const result = await bridge.call<{ model: { name: string } | null }>(
      "model.active",
    );
    expect(result.model?.name).toBe("BRACKET");
  });

  it("throws MODEL_NOT_FOUND for unknown model names", async () => {
    const bridge = new MockBridgeTransport({ connected: true });
    await expect(
      bridge.call("model.info", { name: "DOES_NOT_EXIST" }),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
  });

  it("honours injected failures", async () => {
    const bridge = new MockBridgeTransport({
      failures: {
        "session.connect": {
          code: "CREO_NOT_RUNNING",
          message: "no Creo",
          retryable: true,
        },
      },
    });
    await expect(bridge.call("session.connect")).rejects.toBeInstanceOf(
      CreoMcpError,
    );
  });
});
