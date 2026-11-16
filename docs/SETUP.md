# Setup

## Prerequisites

| Component | Requirement |
|---|---|
| PTC Creo Parametric | 9.0.2.0 with Pro/TOOLKIT / OTK C++ (verified), other 9.x/10.x should work pending SDK path checks |
| Visual Studio | 2022 with the C++ workload (`cl`, `link`) |
| Node.js | 20 or newer (verified on 22.17) |
| Creo license | A license containing OTK feature `222`, or build with `-UseNo222` |

The Creo installation is auto-detected by scanning `C:\Program Files\PTC`,
`D:\PTC`, `D:\Program Files\PTC`, and `C:\PTC`. Override with `CREO_INSTALL_DIR`.

## Build

```powershell
npm install
npm run build:native     # produces native/otk-bridge/build/creo-otk-bridge.exe
npm run build            # compiles packages/server/dist
```

`build-native.ps1` mirrors PTC's own `make_otk_async_examples` link recipe:

- includes: `Common Files\protoolkit\includes`, `Common Files\otk\otk_cpp\include`
- libs: `otk_cpp_async.lib`, `otk_222.lib` (or `otk_no222.lib`), `pt_asynchronous.lib`,
  `protoolkit_NU.lib`, `ucore.lib`, `udata.lib`
- flags: `-DPRO_MACHINE=36 -DPRO_OS=4 -DPRO_USE_VAR_ARGS -EHsc` (C++14, matching the SDK)

If the build is fine but the executable exits with `0xC0000135`, the Creo runtime
directories are missing from `PATH`. The MCP server sets them automatically; the
standalone smoke tests do too via `buildBridgeEnv()`.

## Configuration

The server looks for configuration in this order:

1. `--config <path>`
2. `DNK_MCP_CREO_CONFIG`
3. `./dnk-mcp-creo.json` (working directory)
4. `~/.dnk-mcp-creo/config.json`
5. built-in defaults

Legacy names `CREO_MCP_CONFIG`, `./creo-mcp.json`, and `~/.creo-mcp/config.json`
are still read as fallbacks.

See [`config/dnk-mcp-creo.example.json`](../config/dnk-mcp-creo.example.json).

| Setting | Default | Meaning |
|---|---|---|
| `creo.installDir` | auto-detected | Creo installation root |
| `creo.bridgePath` | `native/otk-bridge/build/creo-otk-bridge.exe` | Native bridge executable |
| `creo.connectMode` | `attach` | `attach` to a running Creo, or `launch` a new one |
| `creo.creoCommand` | `<install>\Parametric\bin\parametric.exe` | Command used by `launch` mode |
| `creo.textPath` | `<install>\Common Files\text` | Text directory passed to OTK |
| `creo.connectTimeoutSec` | `20` | Attach timeout |
| `bridge.requestTimeoutMs` | `30000` | Per-call transport timeout |
| `safety.mode` | `read-only` | `read-only` \| `copy` \| `live` |
| `tools.packs` | `["core"]` | Enabled tool packs; add `read`, `export`, `modeling`, `drawing`, or `features` as needed, e.g. `["core", "read", "modeling", "drawing", "features"]` |
| `audit.enabled` / `audit.path` | `true` / `logs/audit.jsonl` | Audit trail |
| `logging.level` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |

Environment overrides: `CREO_INSTALL_DIR`, `DNK_MCP_CREO_BRIDGE_PATH`,
`DNK_MCP_CREO_SAFETY_MODE`, `DNK_MCP_CREO_PACKS`, `DNK_MCP_CREO_LOG_LEVEL`,
`DNK_MCP_CREO_CONFIG`. The old `CREO_MCP_*` names remain supported as
fallbacks.

## Verify

```powershell
# With Creo running:
node packages/server/dist/cli/doctor.js

# Without Creo (mock bridge):
node packages/server/dist/cli/doctor.js --mock --json

# End-to-end bridge test against a running Creo:
node scripts/integration-smoke.mjs

# Read-pack smoke (copies Creo's demo corpus into its working directory):
node scripts/fixture-models.mjs
node scripts/read-pack-smoke.mjs

# Unit + contract tests:
npm test
```

Expected doctor output with a live session:

```
[ok]    config               built-in defaults
[ok]    creo install         <CREO_INSTALL_DIR>
[ok]    bridge executable    ...\creo-otk-bridge.exe
[ok]    safety mode          read-only
[ok]    bridge hello         protocol 1.0, otk otk_222, win64
[ok]    creo session         Creo 9.0.2.0 at <working directory>
[ok]    model access         2 model(s) open
```

## Wire into a client

Copy the matching template from [`config/clients/`](../config/clients/) and replace
`<REPO_ROOT>`/`<CREO_INSTALL_DIR>`:

- **Claude Desktop**: `claude_desktop_config.json`
- **Codex CLI**: `codex.toml` (`~/.codex/config.toml`)
- **opencode**: `opencode.json`
- **Cursor**: `cursor.mcp.json` (`.cursor/mcp.json`)

All templates run:

```
node <REPO_ROOT>/packages/server/dist/index.js
```

The server speaks stdio MCP; no ports or services are required.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `BRIDGE_NOT_FOUND` | Run `npm run build:native` |
| Bridge exits `0xC0000135` | Creo runtime DLLs not on `PATH`; use the server or `buildBridgeEnv()` |
| `CREO_NOT_RUNNING` / `XToolkitCantModify` | `PRO_COMM_MSG_EXE` missing, or Creo not running. The server sets it automatically from `creo.installDir` |
| `LICENSE_UNAVAILABLE` | Toolkit license missing; rebuild with `-UseNo222` (restricted) |
| `APP_VERSION_MISMATCH` | Bridge built against a different Creo version; rebuild with the matching SDK |
| `CREO_BUSY` / `TIMEOUT` | A modal dialog is blocking Creo; dismiss it and retry |
| Tool list is empty in client | Check stderr logs; run the doctor; ensure absolute `node` path is used in the client config |
| `npm run doctor -- --mock` ignores flags in PowerShell | Invoke directly: `node packages/server/dist/cli/doctor.js --mock` |
