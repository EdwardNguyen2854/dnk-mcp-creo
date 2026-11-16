// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { CreoMcpError } from "./errors.js";
import type { LogLevel } from "./logging.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const safetyModeSchema = z.enum(["read-only", "copy", "live"]);
export type SafetyMode = z.infer<typeof safetyModeSchema>;

export const connectModeSchema = z.enum(["attach", "launch"]);
export type ConnectMode = z.infer<typeof connectModeSchema>;

const logLevelSchema = z.enum(["debug", "info", "warn", "error", "silent"]);

const fileConfigSchema = z.object({
  creo: z
    .object({
      installDir: z.string().optional(),
      bridgePath: z.string().optional(),
      connectMode: connectModeSchema.optional(),
      creoCommand: z.string().optional(),
      textPath: z.string().optional(),
      connectTimeoutSec: z.number().int().positive().max(600).optional(),
    })
    .default({}),
  bridge: z
    .object({
      requestTimeoutMs: z.number().int().positive().max(600000).optional(),
    })
    .default({}),
  safety: z
    .object({
      mode: safetyModeSchema.optional(),
      // No parameter is authorized implicitly. Administrators must supply an
      // explicit allowlist after confirming their organization's rules.
      parameterAllowlist: z.array(z.string().min(1)).optional(),
      dimensionRange: z
        .object({
          minRatio: z.number().positive().optional(),
          maxRatio: z.number().positive().optional(),
        })
        .refine(
          (range) =>
            (range.minRatio ?? 0.5) <= (range.maxRatio ?? 2),
          "dimensionRange.minRatio must not exceed maxRatio",
        )
        .optional(),
    })
    .default({}),
  tools: z
    .object({
      packs: z.array(z.string()).optional(),
    })
    .default({}),
  audit: z
    .object({
      enabled: z.boolean().optional(),
      path: z.string().optional(),
    })
    .default({}),
  logging: z
    .object({
      level: logLevelSchema.optional(),
    })
    .default({}),
});

export type FileConfig = z.infer<typeof fileConfigSchema>;

export interface ResolvedConfig {
  configFile?: string;
  rootDir: string;
  creo: {
    installDir?: string;
    bridgePath: string;
    bridgePathExists: boolean;
    connectMode: ConnectMode;
    creoCommand?: string;
    textPath?: string;
    connectTimeoutSec: number;
    runtimePaths: string[];
    proCommMsgExe?: string;
  };
  bridge: {
    requestTimeoutMs: number;
  };
  safety: {
    mode: SafetyMode;
    parameterAllowlist?: string[];
    dimensionRange?: { minRatio?: number; maxRatio?: number };
  };
  tools: {
    packs: string[];
  };
  audit: {
    enabled: boolean;
    path: string;
  };
  logging: {
    level: LogLevel;
  };
}

const CREO_INSTALL_MARKER = path.join(
  "Common Files",
  "protoolkit",
  "x86e_win64",
  "obj",
  "protoolkit_NU.lib",
);

export function looksLikeCreoInstall(dir: string): boolean {
  return existsSync(path.join(dir, CREO_INSTALL_MARKER));
}

export function findCreoInstallDir(explicit?: string): string | undefined {
  if (explicit) {
    return looksLikeCreoInstall(explicit) ? explicit : undefined;
  }
  const roots = [
    path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "PTC"),
    "D:\\PTC",
    "D:\\Program Files\\PTC",
    "C:\\PTC",
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith("Creo")) {
        continue;
      }
      const full = path.join(root, entry);
      try {
        if (statSync(full).isDirectory() && looksLikeCreoInstall(full)) {
          candidates.push(full);
        }
      } catch {
        // ignore unreadable entries
      }
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return candidates[0];
}

function detectRootDir(cwd: string): string {
  let dir = moduleDir;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, "native", "otk-bridge"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return cwd;
}

function candidateBridgePaths(cwd: string): string[] {
  const relative = path.join(
    "native",
    "otk-bridge",
    "build",
    "creo-otk-bridge.exe",
  );
  const candidates = new Set<string>();
  candidates.add(path.join(cwd, relative));
  let dir = moduleDir;
  for (let i = 0; i < 6; i += 1) {
    candidates.add(path.join(dir, relative));
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return [...candidates];
}

function creoRuntimePaths(installDir?: string): string[] {
  if (!installDir) {
    return [];
  }
  const candidates = [
    path.join(installDir, "Common Files", "x86e_win64", "obj"),
    path.join(installDir, "Common Files", "x86e_win64", "lib"),
    path.join(installDir, "Common Files", "x86e_win64"),
    path.join(installDir, "Parametric", "bin"),
  ];
  return candidates.filter((candidate) => existsSync(candidate));
}

function defaultTextPath(installDir?: string): string | undefined {
  if (!installDir) {
    return undefined;
  }
  const candidate = path.join(installDir, "Common Files", "text");
  return existsSync(candidate) ? candidate : undefined;
}

function defaultCreoCommand(installDir?: string): string | undefined {
  if (!installDir) {
    return undefined;
  }
  const candidates = [
    path.join(installDir, "Parametric", "bin", "parametric.exe"),
    path.join(installDir, "Parametric", "bin", "xtop.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function findProCommMsgExe(installDir?: string): string | undefined {
  if (!installDir) {
    return undefined;
  }
  const candidate = path.join(
    installDir,
    "Common Files",
    "x86e_win64",
    "obj",
    "pro_comm_msg.exe",
  );
  return existsSync(candidate) ? candidate : undefined;
}

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function firstEnv(
  env: NodeJS.ProcessEnv,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const rootDir = detectRootDir(cwd);

  const explicitConfigPath =
    options.configPath ??
    firstEnv(env, ["DNK_MCP_CREO_CONFIG", "CREO_MCP_CONFIG"]);
  let configFile: string | undefined;
  let fileConfig = fileConfigSchema.parse({});

  const readConfigFile = (filePath: string): FileConfig => {
    try {
      const raw = readFileSync(filePath, "utf8");
      return fileConfigSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new CreoMcpError(
          "CONFIG_INVALID",
          `Config file ${filePath} is invalid: ${error.message}`,
          { details: { issues: error.issues } },
        );
      }
      if (error instanceof SyntaxError) {
        throw new CreoMcpError(
          "CONFIG_INVALID",
          `Config file ${filePath} is not valid JSON: ${error.message}`,
        );
      }
      throw error;
    }
  };

  if (explicitConfigPath) {
    const resolved = path.resolve(cwd, explicitConfigPath);
    if (!existsSync(resolved)) {
      throw new CreoMcpError(
        "CONFIG_NOT_FOUND",
        `Config file not found: ${resolved}`,
      );
    }
    configFile = resolved;
    fileConfig = readConfigFile(resolved);
  } else {
    const candidates = [
      path.join(cwd, "dnk-mcp-creo.json"),
      path.join(homedir(), ".dnk-mcp-creo", "config.json"),
      path.join(cwd, "creo-mcp.json"),
      path.join(homedir(), ".creo-mcp", "config.json"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        configFile = candidate;
        fileConfig = readConfigFile(candidate);
        break;
      }
    }
  }

  const installDirRaw = env["CREO_INSTALL_DIR"] ?? fileConfig.creo.installDir;
  let installDir: string | undefined;
  if (installDirRaw) {
    const resolved = path.resolve(installDirRaw);
    if (!looksLikeCreoInstall(resolved)) {
      throw new CreoMcpError(
        "CREO_INSTALL_INVALID",
        `'${resolved}' does not look like a Creo Parametric installation (missing Pro/TOOLKIT).`,
      );
    }
    installDir = resolved;
  } else {
    installDir = findCreoInstallDir();
  }

  const bridgePathRaw =
    firstEnv(env, ["DNK_MCP_CREO_BRIDGE_PATH", "CREO_MCP_BRIDGE_PATH"]) ??
    fileConfig.creo.bridgePath;
  let bridgePath: string;
  if (bridgePathRaw) {
    const base = configFile ? path.dirname(configFile) : cwd;
    bridgePath = path.resolve(base, bridgePathRaw);
  } else {
    bridgePath =
      candidateBridgePaths(cwd).find((candidate) => existsSync(candidate)) ??
      path.join(rootDir, "native", "otk-bridge", "build", "creo-otk-bridge.exe");
  }

  const packsRaw = firstEnv(env, ["DNK_MCP_CREO_PACKS", "CREO_MCP_PACKS"]);
  const packs = packsRaw
    ? packsRaw
        .split(",")
        .map((pack) => pack.trim())
        .filter((pack) => pack.length > 0)
    : (fileConfig.tools.packs ?? ["core"]);

  const modeRaw =
    firstEnv(env, ["DNK_MCP_CREO_SAFETY_MODE", "CREO_MCP_SAFETY_MODE"]) ??
    fileConfig.safety.mode ??
    "read-only";
  const modeParsed = safetyModeSchema.safeParse(modeRaw);
  if (!modeParsed.success) {
    throw new CreoMcpError(
      "CONFIG_INVALID",
      `Invalid safety mode '${modeRaw}'. Expected read-only, copy, or live.`,
    );
  }

  const parameterAllowlistRaw =
    firstEnv(env, [
      "DNK_MCP_CREO_PARAMETER_ALLOWLIST",
      "CREO_MCP_PARAMETER_ALLOWLIST",
    ]) ??
    fileConfig.safety.parameterAllowlist?.join(",") ??
    "";
  const parameterAllowlist = parameterAllowlistRaw
    .split(",")
    .map((name) => name.trim().toUpperCase())
    .filter((name) => name.length > 0);

  const logLevelRaw =
    (firstEnv(env, ["DNK_MCP_CREO_LOG_LEVEL", "CREO_MCP_LOG_LEVEL"]) as
      | LogLevel
      | undefined) ??
    fileConfig.logging.level ??
    "info";
  const logLevelParsed = logLevelSchema.safeParse(logLevelRaw);
  if (!logLevelParsed.success) {
    throw new CreoMcpError(
      "CONFIG_INVALID",
      `Invalid log level '${logLevelRaw}'`,
    );
  }

  const connectMode = fileConfig.creo.connectMode ?? "attach";
  const creoCommand =
    fileConfig.creo.creoCommand ?? defaultCreoCommand(installDir);
  const textPath = fileConfig.creo.textPath ?? defaultTextPath(installDir);
  const proCommMsgExe = findProCommMsgExe(installDir);

  const auditBase = configFile ? path.dirname(configFile) : rootDir;
  const auditPath = fileConfig.audit.path
    ? path.resolve(auditBase, fileConfig.audit.path)
    : path.join(rootDir, "logs", "audit.jsonl");

  return {
    ...(configFile ? { configFile } : {}),
    rootDir,
    creo: {
      ...(installDir ? { installDir } : {}),
      bridgePath,
      bridgePathExists: existsSync(bridgePath),
      connectMode,
      ...(creoCommand ? { creoCommand } : {}),
      ...(textPath ? { textPath } : {}),
      connectTimeoutSec: fileConfig.creo.connectTimeoutSec ?? 20,
      runtimePaths: creoRuntimePaths(installDir),
      ...(proCommMsgExe ? { proCommMsgExe } : {}),
    },
    bridge: {
      requestTimeoutMs: fileConfig.bridge.requestTimeoutMs ?? 30000,
    },
    safety: {
      mode: modeParsed.data,
      parameterAllowlist,
      ...(fileConfig.safety.dimensionRange
        ? { dimensionRange: fileConfig.safety.dimensionRange }
        : {}),
    },
    tools: { packs },
    audit: {
      enabled: fileConfig.audit.enabled ?? true,
      path: auditPath,
    },
    logging: { level: logLevelParsed.data },
  };
}

export function buildBridgeEnv(
  config: ResolvedConfig,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = Object.keys(baseEnv).find(
    (key) => key.toUpperCase() === "PATH",
  );
  const existing = pathKey ? (baseEnv[pathKey] ?? "") : "";
  const parts = [...config.creo.runtimePaths, existing].filter(
    (part) => part.length > 0,
  );
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH" && key !== "PATH") {
      delete env[key];
    }
  }
  env.PATH = parts.join(path.delimiter);
  if (config.creo.proCommMsgExe) {
    env.PRO_COMM_MSG_EXE = config.creo.proCommMsgExe;
  }
  return env;
}
