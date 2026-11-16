# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
// Copies Creo's demo tutorial corpus into fixtures/sandbox for integration tests.
//
// Usage (from the repository root):
//   node scripts/fixture-models.mjs
//
// Requires a built server (npm run build) and a detected Creo installation.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../packages/server/dist/config.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = loadConfig({});

if (!config.creo.installDir) {
  console.error(
    "FAIL: no Creo installation detected. Set CREO_INSTALL_DIR or creo.installDir.",
  );
  process.exit(1);
}

const sourceDir = path.join(
  config.creo.installDir,
  "Common Files",
  "demos",
  "demo",
  "mdx",
  "tutorial1",
);
if (!existsSync(sourceDir)) {
  console.error(`FAIL: demo corpus not found at ${sourceDir}`);
  process.exit(1);
}

const targetDir = path.join(repoRoot, "fixtures", "sandbox");
mkdirSync(targetDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(sourceDir)) {
  if (!/\.(prt|asm|drw|frm|sec)$/i.test(entry)) {
    continue;
  }
  const target = path.join(targetDir, entry);
  if (existsSync(target)) {
    continue;
  }
  cpSync(path.join(sourceDir, entry), target);
  copied += 1;
}

console.log(`Fixtures ready: ${targetDir} (${copied} file(s) copied)`);
