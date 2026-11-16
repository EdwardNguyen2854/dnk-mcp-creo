# Roadmap

## Near-term focus: ISO engineering definition

The immediate product priority is complete, traceable engineering definition in
both the Creo 3D model and its 2D drawings. Treat ISO conformity as a declared,
configurable standards profile—not a blanket claim: confirm the applicable ISO
GPS / technical-product-documentation standards and editions, customer or company
conventions, and approval authority before release. Keep semantic PMI and its
model references distinct from display-only graphics; do not infer design
intent, tolerances, datums, material, process, fits, or surface requirements.
Unconfirmed requirements must remain explicit and block manufacturing release.

Priority sequence for the next engineering-definition increment:

1. Define the standards profile and validation contract (units, projection,
   sheet formats, title-block/revision fields, tolerance and datum policy,
   required approvals, and the exact standard editions adopted).
2. Add 3D annotation / product manufacturing information (PMI): create and read
   back model-associated dimensions, datum references, geometric tolerances,
   surface-texture indications, and notes/symbols supported by Creo. Preserve
   semantic associations to named features or geometry; distinguish semantic
   PMI from cosmetic/display annotations.
3. Complete ISO-profiled 2D drawing authoring: sheet and title-block setup,
   projection and view layout, sections/details, dimensions and tolerances,
   datum/GD&T annotations, notes, revision data, and links back to model intent.
4. Gate both workflows with saved/reopened Creo fixtures, association and unit
   readback, annotation coverage checks, full-sheet raster review, and verified
   native/PDF export (DXF when required). A generated drawing is not released
   until the selected profile, design-authority inputs, and human approvals are
   satisfied.

Candidate standards to validate against current editions and the selected
contract before implementation include ISO 8015 (GPS fundamentals), ISO 16792
(digital product definition data practices), ISO 1101 (geometrical tolerancing),
ISO 129-1 (dimensioning), ISO 128 (technical drawing presentation), ISO 5456-2
(projection), ISO 5457 (drawing-sheet sizes/layout), ISO 7200 (title-block data),
ISO 22081 (general geometrical specifications), ISO 2768-1 (where adopted for
general linear/angular tolerances), and the ISO 21920 series (surface texture).
This candidate list is not itself a compliance declaration; confirm applicability,
status, edition, and any customer-specific overlays at standards-profile sign-off.

This focus takes precedence over remaining feature-breadth, SDK-knowledge, and
nonessential assembly work; their roadmap entries remain planned unless explicitly
re-scoped below.

| Milestone | Scope | Acceptance | Status |
|---|---|---|---|
| **M0** | Toolchain spike: build SDK async example, minimal bridge, attach/launch validation | Compiles with VS 2022, attaches to Creo 9.0.2.0, reads active model/session | **done** |
| **M1** | Walking skeleton: TS MCP server, framed bridge protocol, config/audit/policy, 7 core tools, tests, docs, client templates | Client lists tools over stdio; mock tests pass; live attach smoke passes | **done** |
| **M2.0** | Read pack: parameters, dimensions, features, relations, mass properties, units, geometry outline, materials, layers, family tables, plus selectable edge/surface listings for reference-aware writes; and `model.open`/`model.close` for fixture workflows | 14 tools registered by the `read` pack; mock tests pass; live smoke returns non-empty data for the fixture corpus; path escapes rejected | **done** — `read-pack-smoke` green against Creo 9.0.2.0 (slider_crank.asm + base.prt); `creo_get_edges`/`creo_get_surfaces` verified live (owner, coordinates, sample points) |
| **M2.1** | Export pack: STEP, IGES, STL (ASCII/binary), PDF, raster image, drawing DXF/PDF | Exports verified on disk from a fixture model; all outputs contained to the working directory | **done** — `creo_export_step`, `creo_export_iges`, `creo_export_stl` (ascii/binary), `creo_export_pdf` (drawing), `creo_export_dxf` shipped. Raster image export deferred to M5 (requires display window). |
| **M2.2** | Knowledge pack: build-time index of the installed `Common Files\otk_cpp_doc` (method index + API pages) exposed as MCP resources + `creo_search_sdk` | Offline SDK answers; no PTC content committed to the repo | planned |
| **M3** | Safe write engine: policy enforcement, copy-modify-verify, dry-run, rollback, audit; parameter/dimension/suppress/regenerate/rename/cleanup tools | Every write guarded and verified; failed operations leave state unchanged | **partial** — `modeling` pack ships guarded, readback-verified lifecycle, parameter, dimension, feature-state, and part-from-template tools; copy-modify rollback remains for the next increment |
| **M4** | Features pack: sketch, extrude, revolve, hole, round, chamfer, shell, draft, datum, pattern, mirror | Each creation verified by invariant + readback; source model untouched | **partial** — `features` pack ships extrude, revolve, round, chamfer, shell, datum plane/axis/point, straight holes, linear/axis-driven patterns, and feature-tree inspection. Detail/hole features verify volume deltas; datums verify their geometry items; patterns verify Creo member/instance readback. Linear and axis patterns have passed live acceptance with `scripts/build-pattern-part.mjs`. The mirror prototype timed out in a live Creo call and is withheld from MCP registration pending payload investigation; do not invoke its raw bridge method. Drafts, sweeps, sketch-plane offsets, and feature redefinition remain planned, as do angled/parallel datum-plane constraints and radial/on-point hole placement. Other live acceptance: `scripts/build-showcase-model.mjs`, `scripts/build-detail-part.mjs`, `scripts/build-datum-part.mjs`, and `scripts/build-hole-part.mjs`. |
| **M5** | Assembly + engineering definition: prioritize model-associated 3D annotations / semantic PMI and ISO-profiled 2D drawings; retain component placement and later assembly breadth | 3D PMI is semantically associated and verified by Creo readback; 2D drawings pass the selected ISO-profile checks, saved/reopened fixture checks, annotation coverage, full-sheet visual review, and required native/PDF/DXF export | **partial** — `drawing` pack creates drawings from templates, adds sheets, creates general/projection views, manages view readback, and ships `creo_generate_standard_drawing` (verified front/projection views + optional PDF/DXF) and `creo_save_drawing`; these are foundational capabilities, not yet a complete ISO-release-qualified workflow. `creo_assemble_component` supports retrieval + optional translation with feature readback. Semantic 3D PMI, advanced drawing annotations, standards-profile validation, assembly constraints, and visibility/skeleton remain planned; prioritize PMI and ISO drawing completion first |
| **M6** | Hardening: installer, doctor polish, full integration suite, docs, tagged release | Fresh-machine setup <= 15 min; doctor green | planned |

## Post-v1 backlog

- CREOSON / J-Link breadth adapter behind the same `BridgeTransport` interface
  (reference: `preetamnegi7/Creoson_Claude_Creo_MCP`, see `docs/PRIOR-ART.md`)
- Live-edit mode with undo-aware snapshots (motivated by the sync-TOOLKIT
  undo-stack warning in `520-YM/codex-creo-mcp`)
- Sheet-metal pack
- Mapkey/UI automation tools
- Optional streamable HTTP transport with token auth for a self-hosted team server
- Windchill REST adapter (check-in/out, workspaces, attributes, BOM; reference:
  `rweisssieker-xp/GBL-CREO-WINDCHILL-MCP`)

## Open questions

1. Writable parameter allowlist and company conventions for the write pack (needed
   before M3).
2. ~~Fixture model corpus for regression tests~~ — **decided for M2.0**: copy
   Creo's demo tutorial models (`<creo>\Common Files\demos\demo\mdx\tutorial1`)
   into a gitignored sandbox / live working directory and open them with
   `model.open`; author a family-table fixture manually if the demo corpus lacks
   one. Revisit generated fixtures in M4.
3. Client configs to ship: currently Claude Desktop, Codex CLI, opencode, Cursor.
4. ~~M4 feature authoring~~ — **resolved (2026-09)**. The sketch plane must be
   written as a `PRO_SURFACE` selection, not a datum-plane feature selection.
   Creo 9 does **not** enumerate datum plane surfaces through
   `pfcModel::ListItems(pfcITEM_SURFACE)` or `pfcSolidBody::ListSurfaces()`
   (both return only solid faces), but `pfcModel::GetItemById(pfcITEM_SURFACE,
   id)` does resolve them: a datum plane's surface is allocated directly after
   its feature (`featureId + 1` on this build, with a bounded owner-verified
   scan as fallback). With that reference in `PRO_E_STD_SEC_PLANE`, Creo
   allocates the sketcher section (`wfcFEAT_CR_INCOMPLETE_FEAT`, extract
   `PRO_E_SKETCHER`, add entities, `SetIntentManagerMode`, `RedefineFeature`)
   and the historical "section never allocated" failure disappears. Two more
   payload facts were needed: the Creo 7+ multi-body elements
   (`PRO_E_BODY`/`PRO_E_BODY_USE`/`PRO_E_BODY_SELECT`, ids 6314-6316) have no
   `wfcPRO_E_*` constants and must be written by id; and a full 360 revolve
   cannot be expressed as a plain 0..360 angle (Creo rejects the coincident
   start/end faces), it needs the legacy `PRO_REV_ANG_TO_360` bit (`1 << 26`,
   removed from the Creo 9 header enum but still honored). Symmetric extrude
   depths use `PRO_EXT_DEPTH_SYMMETRIC` (`1 << 28`) with
   `PRO_EXT_DEPTH_FROM_NONE`. Element trees can be captured at any time with
   `feature.tree`; use it before guessing a payload.
5. ~~Part templates and datum features~~ — **resolved (2026-09)**. OTK has no
   create-part-from-template call, so `creo_create_part_from_template` copies a
   whitelisted template (`mmns_part_solid_abs.prt` and friends) from the Creo
   templates directory into the live working directory and retrieves it, giving
   the part TOP/FRONT/RIGHT in one step. Datum authoring landed in the same
   milestone series: `creo_create_datum_plane` (offset/through),
   `creo_create_datum_axis` (two planes/edge/cylindrical surface), and
   `creo_create_datum_point` (on-edge/edge center) are verified live; angled or
   parallel plane constraints and surface/vertex points remain open.
6. Which ISO GPS / technical-documentation editions and company/customer overlays
   define the release profile for 3D PMI and 2D drawings, and who owns approval?
   Keep the candidate list above provisional until this is answered.
7. Which Creo OTK APIs can create, persist, and read back semantic PMI with stable
   feature/geometry references, and what native fixtures will prove round-trip
   behavior before exposing write tools?
