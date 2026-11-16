# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Semantic 3D PMI and ISO-profiled drawing completion
- Copy-modify rollback, drafts, sweeps, and feature redefinition
- Assembly constraints, visibility, and skeleton support

## [0.1.0] - 2026-11-16

First public release.

### Added

- TypeScript MCP server (`dnk-mcp-creo`) with stdio transport, zod schemas, tool
  annotations, config resolution, audit logging, and safety policy.
- C++17 asynchronous Object TOOLKIT bridge (`creo-otk-bridge`) with a versioned
  framed JSON-RPC protocol and structured error taxonomy.
- `core` pack: session status, working directory, model listing, active model,
  model info, capabilities, and self-test.
- `read` pack: parameters, dimensions, features, relations, mass properties,
  materials, layers, units, geometry, edges, surfaces, family tables, and model
  open/close.
- `export` pack: STEP, IGES, STL (ASCII/binary), drawing PDF, and DXF.
- `modeling` pack: save, rename, copy, regenerate, parameters, dimensions,
  feature state, feature ordering, part/assembly creation, part from template,
  and component assembly with readback verification.
- `drawing` pack: drawing creation from templates, sheets, general and
  projection views, standard drawing generation with optional PDF/DXF, and save.
- `features` pack: extrude, revolve, round, chamfer, shell, datum plane, datum
  axis, datum point, straight and counterbored/countersunk holes, linear and
  axis-driven patterns, and feature-tree inspection.
- Safe-write engine with read-only/copy/live modes, path containment, value
  guards, copy-modify-verify, rollback support, and JSONL audit.
- Client configuration templates for Claude Desktop, Codex CLI, opencode, and
  Cursor.
- Mock bridge with 122 unit and contract tests.
- Live acceptance scripts for the showcase pulley, detail part, datum part,
  hole part, pattern part, and assembly.
- Documentation: setup, architecture, protocol, tools, safety, roadmap, prior
  art, standards profile inputs, research notes, and attribution.
- Apache-2.0 licensing, NOTICE, citation metadata, and trademark policy.
- GitHub CI, issue forms, pull request template, Dependabot, and CODEOWNERS.

[Unreleased]: https://github.com/EdwardNguyen2854/dnk-mcp-creo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/EdwardNguyen2854/dnk-mcp-creo/releases/tag/v0.1.0
