# AGENTS.md

**DNK MCP Creo** (`dnk-mcp-creo`) is an open-source MCP server for PTC Creo
Parametric 9 on Windows: a TypeScript MCP server (`packages/server`) talking to a
thin C++17 OTK async bridge
(`native/otk-bridge`). Current state: **M3/M4/M5 partial** — 7 core tools plus
opt-in `read` (14), `export` (5), `modeling` (14), `drawing` (14), and
`features` (11) packs. Enable packs via
`tools.packs: ["core","read","export","modeling","drawing","features"]` (env
`DNK_MCP_CREO_PACKS=core,read,export,modeling,drawing,features`). Read covers the
model plus selectable edges/surfaces (`creo_get_edges`, `creo_get_surfaces`) for
reference-aware writes; modeling covers lifecycle/parameter/dimension/feature-
state writes, part-from-template (`creo_create_part_from_template`), and
component assembly (`creo_assemble_component`); the
drawing pack ships verified standard 2D drawing generation
(`creo_generate_standard_drawing`) with optional PDF/DXF export; the features
pack authors and finishes real solid geometry (`creo_create_extrude`,
`creo_create_revolve`, `creo_create_round`, `creo_create_chamfer`,
`creo_create_shell`, `creo_create_datum_plane`, `creo_create_datum_axis`,
`creo_create_datum_point`, `creo_create_hole`, `creo_create_pattern`,
`creo_get_feature_tree`). Linear/axis patterns are live-verified; the mirror
prototype is withheld after a live Creo timeout. Copy-modify rollback, drafts,
mirrors, sweeps, sketch-plane offsets,
assembly constraints, and advanced drawing annotations remain planned. Check
`docs/ROADMAP.md` before assuming a tool exists.

`creo_create_datum_plane` supports offset/through constraints,
`creo_create_datum_axis` two planes/edge/cylindrical surface,
`creo_create_datum_point` on-edge/edge center, and `creo_create_hole` linear or
coaxial placement with blind/through/symmetric depth and optional
counterbore/countersink heads.

## Commands (verified)

- `npm run build:native` — builds `native/otk-bridge/build/creo-otk-bridge.exe`
  (auto-detects Creo + VS 2022; `-UseNo222` for license fallback)
- `npm run build` — tsc to `packages/server/dist`; **required before any
  `node .../dist/...js` script or CLI will work**
- `npm run typecheck` / `npm test` — tsc no-emit / vitest (mock bridge only,
  never touches Creo)
- Single test: `npx vitest run test/server.test.ts` from `packages/server`
- Live diagnostics (need a running Creo):
  `node packages/server/dist/cli/doctor.js [--mock] [--json]`,
  `node scripts/integration-smoke.mjs`, `node scripts/mcp-live-check.mjs`,
  `node scripts/fixture-models.mjs` + `node scripts/read-pack-smoke.mjs`
  (read pack; copies Creo's demo corpus into its working directory),
  `node scripts/build-showcase-model.mjs [--drawing]` (features pack; builds a
  six-spoke pulley from a Creo template part and verifies volume by readback),
  `node scripts/build-detail-part.mjs [--keep]` (features pack; template →
  extrude → round/chamfer → shell with analytic volume checks),
  `node scripts/build-datum-part.mjs [--keep]` (features pack; offset plane →
  sketch on it → two-plane axis → edge point → coaxial hole),
  `node scripts/build-hole-part.mjs [--keep]` (features pack; through hole +
  counterbore with analytic volume checks including the drill point),
  `node scripts/build-assembly.mjs [--assembly NAME] [--parts a,b]` (modeling
  pack; creates an assembly from fixture parts placed with computed,
  unit-aware offsets, saves it, and exports STEP)
- Dev helpers (not acceptance tests): `node scripts/payload-discovery.mjs
  <file.prt> [Type|#id...] [--list]` dumps native feature element trees from a
  live Creo (the payload-discovery protocol behind `feature.tree`), and
  `node scripts/dev-bridge-call.mjs <method> '@params.json'` calls one raw
  bridge method. Inline JSON on this PowerShell mangles quotes — use a file.
- CI (`.github/workflows/ci.yml`) runs typecheck, mock tests, build, and the
  mock doctor on Windows with Node 20 and 22. The native bridge is not built in
  CI because it needs the PTC SDK and a Creo license. No lint or formatter is
  configured; do not invent one.
- Do not rely on `npm run <script> -- --flags` to forward flags here (verified
  dropped on this PowerShell setup); invoke the node entrypoint directly.

## Hard constraints and gotchas

- **stdout is reserved for MCP.** Never `console.log`; use `createLogger`
  (stderr). Native bridge stdout frames carry the `__CREOBRIDGE__ ` prefix — keep
  it; the transport ignores unframed PTC output on purpose.
- **Async OTK needs `PRO_COMM_MSG_EXE`** pointing at
  `<creo>\Common Files\x86e_win64\obj\pro_comm_msg.exe`, plus Creo runtime dirs on
  `PATH`. `buildBridgeEnv()` in `src/config.ts` sets both. Missing it makes attach
  fail with `XToolkitCantModify`; missing PATH makes the bridge exit `0xC0000135`.
- **Native code compiles as default C++14.** `/std:c++17` breaks OTK headers
  (`byte` ambiguity with `std::byte`). OTK's `optional` is an empty macro — never
  use `std::optional` in files including OTK headers. Use `&out[0]`, not
  `.data()`, for non-const buffers.
- **OTK exceptions are `xthrowable*`** and only match PTC's `xcatch(...)` RTTI
  macros; plain `catch (pfcXToolkitError&)` silently misses them.
- `pfcGetProEVersion()` is synchronous-only; async version info uses
  `wfcWSession::GetReleaseNumericVersion()` + `GetDisplayDateCode()`.
- Keep nlohmann/json included before OTK headers (`util.h` does this).
- `pfcModel` has no `GetName`/`GetPath`; use `GetFullName`/`GetFileName` and
  `GetDescr()->GetPath()` (learned the hard way).
- Downcast OTK handles with the generated static cast, e.g.
  `pfcSolid::cast(model)`, `pfcDimension::cast(item)`; it returns null for
  incompatible types.
- Adding a `.cxx` file requires updating the explicit source list in
  `scripts/build-native.ps1` (no globbing).
- Round and chamfer features share the `PRO_E_RNDCH_*` element family. Create
  them complete with `wfcFEAT_CR_DEFINE_MISS_ELEMS`, not the incomplete-feature
  flow; the round reference is a curve collection (`wfcCURVCOLL_ADD_ONE_INSTR`),
  and the chamfer adds `PRO_E_RNDCH_DIMENSIONAL_SCHEMA` (ProChmSchema 601–604)
  plus `LEG1`/`LEG2`. PTC's manual chapter
  `<creo>\Common Files\protoolkit\protkdoc\manual0\Round_chamfer.html` and the
  `UgEdgeRoundCreate.c` / `UgEdgeChamferCreate.c` samples document the payload;
  create a feature natively and dump it with `feature.tree` to confirm.
- `pfcSurface::EvalClosestPoint(ToPoint)` returns the closest point on a
  surface; `EvalClosestPointOnSurface` is a different call that only tests
  whether a point already lies on the surface. Surface listings use the former
  for their `samplePoint`.
- There is no OTK create-from-template call. `model.create_from_template` copies
  `<install>\Common Files\templates\<file>` into the live working directory
  (C++ byte copy) and retrieves it; the target must not already exist.
- Datum axes/points: `pfcModel::GetItemById(pfcITEM_AXIS/POINT, id)` can return
  a handle whose `GetId()` throws `XToolkitBadInputs` on Creo 9. Resolve the
  item by scanning `ListItems(pfcITEM_AXIS/POINT)` and matching the owning
  feature id instead (`findDatumAxisItem`/`findDatumPointId` in `features.cxx`).
  Datum points come back `unregenerated` from `WCreateFeature`; the native
  creator regenerates the model (`ensureActiveFeature`) so the status and
  point id are current.
- Datum planes: `PRO_E_DTMPLN_CONSTRAINTS` with one constraint per plane;
  offset/through are verified, angled/parallel are not (a lone parallel
  constraint never regenerates, and about-first angle payloads can hang Creo —
  do not expose them until a fixture dump settles the payload).
- Holes: straight holes carry the diameter in `PRO_E_DIAMETER` plus the
  `PRO_E_HOLE_STD_DEPTH` subtree; counterbore/countersink switches to the
  custom form (`PRO_E_HLE_TYPE_NEW` 7, `PRO_E_HLE_HOLEDIAM`, `PRO_E_HLE_DEPTH`,
  `PRO_E_HLE_DRILLDEPTH`, CBORE/CSINK elements). A coaxial hole needs a
  placement face in `PRO_E_HLE_PRIM_REF` and the axis in `PRO_E_HLE_AXIS`
  (placement case G); storing the axis as the primary reference (case F) hangs
  Creo. `PRO_E_HLE_ADD_THREAD` and several other elements are normalized by
  Creo on creation, and some element ids (TOP_CLEARANCE, TAPERED_*, SKDP_*) have
  no `wfcPRO_E_*` constants — take raw ids from a native `feature.tree` dump.
- Saving can be a silent no-op: `pfcModel::Save()` returns without writing when
  `CheckIsSaveAllowed(false)` is false (observed session-wide in a long-running
  Creo). `model.save` reports the flag in the error details.
- `pfcAssembly::AssembleComponent(Solid, optional pfcTransform3D)` works in the
  OTK async layer. The transform is a translation in assembly units (identity
  matrix + optional `SetOrigin`); the component is resolved by session name and
  retrieved by plain file name when it is not open. The component feature comes
  back `active` with type `COMPONENT` and is verified through `model.features`.
  There is no constraint solver in the tool path: components are placed, not
  constrained.

## Architecture rules

- Bridge = thin primitives that return readback data. Safety policy, guards,
  copy-modify-verify, and allowlists live in TypeScript. Do not add business
  logic to C++.
- Adding a write tool? Register its name via `registerWriteTools()` or
  `safety.mode: read-only` will not block it.
- Tools live in `src/tools/*.ts` as `ToolDefinition[]`, registered in
  `src/server.ts`, with zod `inputSchema`/`outputSchema` and
  `READ_ONLY_ANNOTATIONS` for reads.
- Tests use `MockBridgeTransport` + `makeConfig()` from
  `test/helpers.ts`; extend the mock when adding bridge commands. Integration
  scripts require a live Creo and are not part of `npm test`.
- `config/clients/opencode.json` is an install template for MCP clients, not this
  repo's config.

## Skills

Creo agent skills use the `dnk-creo-<capability>` namespace (for example
`dnk-creo-drawing-standard`). No Creo skills are shipped in this repository
yet; do not reuse the SOLIDWORKS-oriented CAD skills as if they covered Creo.

## See also

- `docs/SETUP.md` — canonical setup and troubleshooting
- `docs/PROTOCOL.md` — bridge protocol and error taxonomy
- `docs/ROADMAP.md` — milestone state and open decisions (write allowlist, fixtures)
- `docs/PRIOR-ART.md` — vision, verified reference projects, borrow-map, and
  licensing guardrails; read before planning a milestone
