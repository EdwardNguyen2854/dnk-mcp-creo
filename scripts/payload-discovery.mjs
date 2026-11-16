# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Payload discovery helper: opens one or more models in the live Creo session
// and dumps feature lists plus element trees for the requested feature types.
// This is the discovery protocol documented in the feature-authoring plan:
// learn the exact element ids, levels, and reference payloads Creo 9 stores
// before writing a native builder for a new feature type.
//
// Usage:
//   node scripts/payload-discovery.mjs <file.prt> [Type ...] [--list]
//   node scripts/payload-discovery.mjs end_cap.prt HOLE DATUM
//   node scripts/payload-discovery.mjs end_cap.prt '#113'
//   node scripts/payload-discovery.mjs 'a.prt,b.prt' --list
//
// A bare Type matches feature types case-insensitively (HOLE, DATUM, PATTERN);
// '#<id>' selects exact feature ids. Without filters every feature's tree is
// dumped. Requires npm run build and a running Creo; not part of npm test.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../packages/server/dist/config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig({});
const serverEntry = path.join(repoRoot, "packages", "server", "dist", "index.js");
if (!existsSync(serverEntry)) {
  console.error("server build missing; run npm run build");
  process.exit(1);
}

const fileName = process.argv[2];
if (!fileName) {
  console.error("usage: node scripts/payload-discovery.mjs <file.prt> [Type|#id ...] [--list]");
  process.exit(2);
}
const listOnly = process.argv.includes("--list");
const filters = process.argv
  .slice(3)
  .filter((value) => value !== "--list")
  .map((value) => value.toUpperCase());
const wantedIds = filters
  .filter((value) => value.startsWith("#"))
  .map((value) => Number(value.slice(1)));
const wantedTypes = filters.filter((value) => !value.startsWith("#"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: {
    CREO_INSTALL_DIR: config.creo.installDir,
    DNK_MCP_CREO_PACKS: "core,read,modeling,features",
    DNK_MCP_CREO_SAFETY_MODE: "copy",
    DNK_MCP_CREO_LOG_LEVEL: "warn",
  },
});
const client = new Client({ name: "payload-discovery", version: "1.0.0" });

async function call(name, args = {}, timeoutMs = 120000) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: timeoutMs,
    resetTimeoutOnProgress: true,
  });
  if (result.isError) {
    throw new Error(
      `${name} failed: ${(result.content ?? []).map((item) => item.text ?? "").join("\n")}`,
    );
  }
  return result.structuredContent ?? {};
}

try {
  await client.connect(transport);
  const working = await call("creo_get_working_directory");
  console.log(`working directory: ${working.workingDirectory}`);

  for (const currentFile of fileName.split(",")) {
    const opened = await call("creo_open_model", { fileName: currentFile }).catch(
      async (error) => {
        console.log(`open failed (${error.message}); listing models`);
        const list = await call("creo_list_models", {});
        console.log(list.models.map((model) => `${model.name} (${model.fileName})`).join("\n"));
        throw error;
      },
    );
    console.log(`opened: ${opened.model?.name} (${opened.model?.fileName})`);

    const listed = await call("creo_get_features", { name: opened.model.name });
    console.log(`\nfeatures (${listed.count}):`);
    for (const feature of listed.features) {
      console.log(
        `  ${feature.id}\t${feature.type}\t${feature.subType ?? ""}\t${feature.name ?? ""}\t${feature.status}`,
      );
    }

    const targets = listOnly
      ? []
      : listed.features.filter(
          (feature) =>
            (wantedTypes.length === 0 && wantedIds.length === 0) ||
            wantedIds.includes(feature.id) ||
            wantedTypes.some((want) =>
              String(feature.type).toUpperCase().includes(want),
            ),
        );
    for (const feature of targets) {
      console.log(
        `\n=== tree for feature ${feature.id} (${feature.type} ${feature.name ?? ""}) ===`,
      );
      const tree = await call("creo_get_feature_tree", {
        name: opened.model.name,
        featureId: feature.id,
      });
      const lines = [];
      for (const element of tree.elements) {
        const value = JSON.stringify(element.value ?? null);
        const extra = [
          element.valueString ? `str=${JSON.stringify(element.valueString)}` : "",
          element.selections ? `sel=${JSON.stringify(element.selections)}` : "",
          element.collection ? "collection" : "",
          element.specialValue ? `special=${JSON.stringify(element.specialValue)}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        lines.push(
          `${"  ".repeat(Math.max(0, element.level - 1))}${element.id} ${element.idName ?? "?"} = ${value}${extra ? " " + extra : ""}`,
        );
      }
      console.log(lines.join("\n"));
    }
  }
} catch (error) {
  console.error(`FAILED: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
