# Prior Art and Vision

## Mission

Build the best open-source MCP server for PTC Creo Parametric: deep native
control (Pro/TOOLKIT / OTK), a small safe tool surface, deterministic write
workflows, and offline SDK knowledge. SolidWorks is a possible future sibling
project; this repo stays Creo-first.

This document is the standing reference list. Read it when planning a milestone,
and re-verify a project before borrowing ideas from it.

## Verified references

Checked 2026-09-25 against GitHub.

| Project | Stack | Scope | License | Standing |
|---|---|---|---|---|
| [520-YM/codex-creo-mcp](https://github.com/520-YM/codex-creo-mcp) | Pro/TOOLKIT C + Node.js MCP | 60 tools: model read, parameters/dimensions, part features, assembly, skeleton, sheet metal, STEP export, version cleanup | **None** (no LICENSE file) | Inspiration from README/docs only. Never copy code. |
| [preetamnegi7/Creoson_Claude_Creo_MCP](https://github.com/preetamnegi7/Creoson_Claude_Creo_MCP) | Creoson / J-Link (Python) | Broad Creo automation via Creoson | None | Reference for the post-v1 CREOSON breadth adapter: catalog of what a J-Link bridge can expose. |
| [yangkunyi/creo-mcp](https://github.com/yangkunyi/creo-mcp) | Python 3.12 + uv | 3 tools: arbitrary Python execution, STEP import, Volcengine knowledge-base query | MIT | Mostly anti-patterns. Validates our no-eval rule and offline knowledge pack as differentiators. |
| [rweisssieker-xp/GBL-CREO-WINDCHILL-MCP](https://github.com/rweisssieker-xp/GBL-CREO-WINDCHILL-MCP) | TypeScript | Creo + Windchill enterprise workflow | MIT | Closest stack to ours. Informs the post-v1 Windchill REST adapter. Attribute if code is adapted. |

## Borrow-map

| Idea | Source | Where it lands |
|---|---|---|
| Tool taxonomy: model read, parameters/dimensions, features, assembly, skeleton, sheet metal, export, version cleanup | codex-creo-mcp | Pack vocabulary for M2–M5 (`read`, `export`, `features`, `assembly`, `drawing`, `sheetmetal`) |
| Safety invariants: re-read session working directory each call; direct children only; no caller-supplied paths; verify old values before write; roll back on failure | codex-creo-mcp | Confirms `docs/SAFETY.md`; write guards in M3 |
| Working-dir containment for file operations | codex-creo-mcp | `model.open`/`model.close` in M2.0 (TS layer) and all file tools |
| Sync Pro/TOOLKIT calls can clear Creo's undo stack | codex-creo-mcp (README warning) | Justifies our out-of-process async bridge; relevant to the post-v1 undo-aware live-edit idea |
| Creoson/J-Link command catalog | preetamnegi7/Creoson_Claude_Creo_MCP | Post-v1 `BridgeTransport` breadth adapter |
| Windchill check-in/out, attributes, BOM workflows | GBL-CREO-WINDCHILL-MCP | Post-v1 Windchill REST adapter |
| SDK knowledge retrieval as a tool | yangkunyi/creo-mcp (external KB) | M2.2 knowledge pack, but offline from `Common Files\otk_cpp_doc` |

## Anti-goals (do not build these)

- **Arbitrary code execution tools** (`execute_python_code`-style). The server
  never executes caller-provided code.
- **External knowledge services** for SDK docs. The knowledge index is built
  from the local Creo installation; no third-party upload.
- **Third-party binary dependencies** beyond Creo, the SDK, and vendored
  nlohmann/json.
- **Copying code from unlicensed repositories.** Design inspiration only.

## Our differentiators

- Out-of-process async OTK bridge: no code loaded into Creo, no undo-stack
  damage, no Creo restart when the bridge changes.
- Safety policy, guards, copy-modify-verify, and allowlists in TypeScript —
  adding a rule never requires recompiling C++.
- Versioned framed protocol with a structured error taxonomy.
- Offline SDK knowledge built from the installed `otk_cpp_doc`.
- Everything works through the same `BridgeTransport` seam, so additional CAD
  systems or adapters reuse the server.

## Refresh rule

Re-check stars, license, and scope of each reference when starting a milestone
that borrows from it, and update this file's date.
