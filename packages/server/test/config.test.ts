// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "creo-mcp-config-"));
}

describe("loadConfig", () => {
  it("applies defaults with an explicit empty config", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "empty.json");
    writeFileSync(configPath, "{}", "utf8");

    const config = loadConfig({ cwd: dir, configPath, env: {} });
    expect(config.safety.mode).toBe("read-only");
    expect(config.creo.connectMode).toBe("attach");
    expect(config.tools.packs).toEqual(["core"]);
    expect(config.audit.enabled).toBe(true);
    expect(config.creo.bridgePath.endsWith("creo-otk-bridge.exe")).toBe(true);
  });

  it("defaults parameter writes to an empty allowlist and reads authorized names from the environment", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "empty.json");
    writeFileSync(configPath, "{}", "utf8");
    const defaults = loadConfig({ cwd: dir, configPath, env: {} });
    expect(defaults.safety.parameterAllowlist).toEqual([]);

    const allowed = loadConfig({
      cwd: dir,
      configPath,
      env: { CREO_MCP_PARAMETER_ALLOWLIST: "width, material" },
    });
    expect(allowed.safety.parameterAllowlist).toEqual(["WIDTH", "MATERIAL"]);
  });

  it("reads creo-mcp.json from the working directory", () => {
    const dir = makeTempDir();
    writeFileSync(
      path.join(dir, "creo-mcp.json"),
      JSON.stringify({
        creo: { connectMode: "launch", connectTimeoutSec: 42 },
        safety: { mode: "copy" },
        tools: { packs: ["core", "read"] },
      }),
      "utf8",
    );

    const config = loadConfig({ cwd: dir, env: {} });
    expect(config.creo.connectMode).toBe("launch");
    expect(config.creo.connectTimeoutSec).toBe(42);
    expect(config.safety.mode).toBe("copy");
    expect(config.tools.packs).toEqual(["core", "read"]);
    expect(config.configFile).toBe(path.join(dir, "creo-mcp.json"));
  });

  it("reads dnk-mcp-creo.json from the working directory", () => {
    const dir = makeTempDir();
    writeFileSync(
      path.join(dir, "dnk-mcp-creo.json"),
      JSON.stringify({
        creo: { connectMode: "launch" },
        safety: { mode: "live" },
        tools: { packs: ["core", "features"] },
      }),
      "utf8",
    );

    const config = loadConfig({ cwd: dir, env: {} });
    expect(config.creo.connectMode).toBe("launch");
    expect(config.safety.mode).toBe("live");
    expect(config.tools.packs).toEqual(["core", "features"]);
    expect(config.configFile).toBe(path.join(dir, "dnk-mcp-creo.json"));
  });

  it("prefers DNK_MCP_CREO_* environment variables over the legacy names", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "empty.json");
    writeFileSync(configPath, "{}", "utf8");
    const config = loadConfig({
      cwd: dir,
      configPath,
      env: {
        DNK_MCP_CREO_PACKS: "core,read",
        CREO_MCP_PACKS: "core,export",
      },
    });
    expect(config.tools.packs).toEqual(["core", "read"]);
  });

  it("rejects an invalid safety mode in the config file", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "bad.json");
    writeFileSync(
      configPath,
      JSON.stringify({ safety: { mode: "yolo" } }),
      "utf8",
    );
    expect(() => loadConfig({ cwd: dir, configPath, env: {} })).toThrowError(
      /invalid/i,
    );
  });

  it("lets environment variables override the packs", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "empty.json");
    writeFileSync(configPath, "{}", "utf8");
    const config = loadConfig({
      cwd: dir,
      configPath,
      env: { CREO_MCP_PACKS: "core, export , read " },
    });
    expect(config.tools.packs).toEqual(["core", "export", "read"]);
  });

  it("rejects a bogus CREO_INSTALL_DIR", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "empty.json");
    writeFileSync(configPath, "{}", "utf8");
    expect(() =>
      loadConfig({
        cwd: dir,
        configPath,
        env: { CREO_INSTALL_DIR: path.join(dir, "not-creo") },
      }),
    ).toThrowError(/does not look like/i);
  });

  it("resolves a relative bridge path against the config file", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "creo-mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({ creo: { bridgePath: "bin/bridge.exe" } }),
      "utf8",
    );
    const config = loadConfig({ cwd: dir, configPath, env: {} });
    expect(config.creo.bridgePath).toBe(path.join(dir, "bin", "bridge.exe"));
  });
});
