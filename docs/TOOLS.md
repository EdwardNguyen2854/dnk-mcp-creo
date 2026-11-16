# Tool Catalog

Tool names are snake_case with a `creo_` prefix. Read-only tools carry the
`readOnlyHint: true` annotation. Write tools carry `destructiveHint: true` and
are gated by `safety.mode`.

## Core pack (implemented, M1)

| Tool | Input | Output | Notes |
|---|---|---|---|
| `creo_status` | – | `bridge`, `session` | Never fails on a missing Creo session; reports `connected: false` |
| `creo_get_working_directory` | – | `connected`, `workingDirectory`, `creoVersion?` | All file operations are resolved against this directory |
| `creo_list_models` | `type?` | `count`, `models[]` | Filter: `all`, `part`, `assembly`, `drawing`, `manufacturing` |
| `creo_get_active_model` | – | `connected`, `model` | `model` is `null` when no window is active |
| `creo_get_model_info` | `name?` | `model` | Accepts model name, file name, or full name; defaults to active |
| `creo_capabilities` | – | safety mode, packs, bridge capabilities | Use to discover what is enabled |
| `creo_self_test` | – | `ok`, `checks[]` | Bridge/ping/session/model read diagnostics |

Every model tool auto-attaches to a running Creo session (`mode=attach`) unless one
is already connected.

## Read pack (implemented, M2.0)

Enabled with `tools.packs: ["core", "read"]` (env `DNK_MCP_CREO_PACKS=core,read`).
All tools accept an optional `name` (model name, file name, or full name) and
default to the active model.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `creo_get_parameters` | `name?` | `model`, `count`, `parameters[]` | Typed values plus designated / relation-driven / modified flags, driver type, description, units |
| `creo_get_dimensions` | `name?` | `model`, `count`, `dimensions[]` | Id, symbol, value, type, tolerance type, relation-driven and reference flags |
| `creo_get_features` | `name?` | `model`, `count`, `features[]` | Id, number, type, subtype, status (active/suppressed/…), visibility, parent/child ids |
| `creo_get_relations` | `name?` | `model`, `count`, `relations[]` | Relation text lines |
| `creo_get_mass_properties` | `name?`, `csys?` | `model`, `massProperties` | Volume, surface area, density, mass, center of gravity (native units) |
| `creo_get_materials` | `name?` | `model`, `supported`, `currentMaterial`, `materials[]` | Parts only; assemblies report `supported: false` |
| `creo_get_layers` | `name?` | `model`, `count`, `layers[]` | Display status (normal/display/blank/hidden) and item counts |
| `creo_get_units` | `name?` | `model`, `units` | Principal unit system and the principal unit per quantity |
| `creo_get_geometry` | `name?` | `model`, `geometry` | Outline (min/max corner points) and surface/edge/body counts; not a tessellation |
| `creo_get_edges` | `name?`, `ids?` | `model`, `count`, `edges[]` | PRO_EDGE ids with curve type, length, start/end/midpoint, owning feature, adjoining surface ids |
| `creo_get_surfaces` | `name?` | `model`, `count`, `surfaces[]` | PRO_SURFACE ids for solid faces and datum planes, with surface type, owner, and a sample point near the model center |
| `creo_get_family_table` | `name?` | `model`, `hasFamilyTable`, `familyTable` | Columns, rows, cell values; `null` when the model has no table |
| `creo_open_model` | `fileName` | `opened`, `alreadyOpen`, `model` | Retrieves a plain file name from Creo's working directory; paths are rejected |
| `creo_close_model` | `name?`, `force?` | `closed`, `name`, `verified` | Erases from the session (never touches the file); refuses modified models without `force`; verifies by readback |

`creo_open_model` and `creo_close_model` mutate session state only. They are
annotated non-read-only, audited like every tool, and never write to disk.

## Modeling pack (partial, M3)

Enabled with `tools.packs: ["core", "modeling"]` (usually also include
`read`). All mutating tools are gated by `safety.mode` and return readback
verification. The current pack uses native OTK model operations; full
copy-modify-rollback and first-class sketch/feature authoring remain planned.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `creo_save_model` | `name?` | `model`, `verified` | Saves and verifies the modified flag is cleared |
| `creo_rename_model` | `name?`, `newName` | `model`, `newName`, `verified` | Does not rename the file on disk |
| `creo_copy_model` | `name?`, `newName` | `sourceModel`, `copyModel`, `verified` | Retrieves a new copy and leaves the source open |
| `creo_regenerate_model` | `name?` | `model`, `features`, `verified` | Part/assembly regeneration |
| `creo_set_parameter` | `name?`, `paramName`, `value`, `createIfMissing?` | `model`, `parameter`, `created`, `verified` | Typed primitive or `{type,value}` |
| `creo_set_dimension` | `name?`, `dimensionId`, `value` | `model`, `dimension`, `verified` | Dimension value readback |
| `creo_suppress_features` / `creo_resume_features` | `name?`, `featureIds[]` | `model`, `operation`, `features`, `verified` | Feature state operations |
| `creo_delete_features` | `name?`, `featureIds[]` | `model`, `operation`, `features`, `verified` | Destructive feature operation |
| `creo_reorder_feature` | `name?`, `featureId`, `referenceFeatureId`, `before?` | `model`, `operation`, `features`, `verified` | Reorders relative to another feature |
| `creo_create_part` / `creo_create_assembly` | `modelName` | `model`, `verified` | Creates an empty model (no datum planes) |
| `creo_create_part_from_template` | `modelName`, `template?` | `created`, `template`, `model`, `verified` | Copies a whitelisted Creo solid template (`mmns_part_solid_abs.prt` and friends) into the live working directory and retrieves it; the new part carries TOP/FRONT/RIGHT |
| `creo_assemble_component` | `name?`, `component`, `x?`, `y?`, `z?` | `assembly`, `component`, `feature`, `features`, `verified` | Assembles an open part or subassembly into an assembly (retrieved from Creo's working directory when not open) with an optional translation in model units; the component feature is verified by readback |

## Features pack (partial, M4/P5)

Enabled with `tools.packs: ["core", "read", "features"]`. This pack authors
real solid geometry: sketch-based extrude and revolve, edge and face detail
features, datum planes/axes/points, straight holes, linear/axis patterns, and
feature mirrors. Sketch features are created as an incomplete
element tree, Creo allocates the 3D section, the section entities are added and
resolved, and the feature is completed by redefine — the flow PTC's own OTK
examples use. Round, chamfer, shell, datum, and hole features are created
complete from their native element families with `wfcFEAT_CR_DEFINE_MISS_ELEMS`
(PTC's `UgEdgeRoundCreate` / `UgDatumAxisCreate` / `UgHoleCreate` patterns).
Every creation is verified from Creo readback: feature status, solid surface
counts, a strict volume decrease measured against a pre-call
`creo_get_mass_properties` reading, and (for datums) a resolvable datum item
(plane surface, axis, or point).

The part must contain datum planes. Prefer
`creo_create_part_from_template` (modeling pack) over `creo_create_part`, which
creates a part with no datums.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `creo_create_extrude` | `name?`, `sketchPlane`, `orientRef?`, `depth`, `direction?`, `symmetric?`, `cut?`, `featureName?`, `section[]` | `model`, `feature`, `geometry`, `volumeChange`, `verified` | Blind or symmetric depth; `cut: true` removes material |
| `creo_create_revolve` | `name?`, `sketchPlane`, `orientRef?`, `angle?`, `direction?`, `symmetric?`, `cut?`, `featureName?`, `section[]` | `model`, `feature`, `geometry`, `volumeChange`, `verified` | `section` must contain exactly one centerline, which becomes the axis; 360 is a full revolution |
| `creo_create_round` | `name?`, `edgeIds[]`, `radius`, `featureName?` | `model`, `feature`, `geometry`, `volumeChange`, `verified` | Constant-radius round on one or more edges from `creo_get_edges` |
| `creo_create_chamfer` | `name?`, `edgeIds[]`, `distance`, `distance2?`, `angle?`, `featureName?` | `model`, `feature`, `geometry`, `volumeChange`, `verified` | Symmetric distance by default; `distance2` gives D1 x D2, `angle` gives angle x distance |
| `creo_create_shell` | `name?`, `surfaceIds[]`, `thickness`, `flip?`, `featureName?` | `model`, `feature`, `geometry`, `volumeChange`, `verified` | Removes the given faces (from `creo_get_surfaces`) and leaves a constant-thickness wall |
| `creo_create_datum_plane` | `name?`, `type` (`offset` \| `through`), `reference`, `distance?`, `flip?`, `featureName?` | `model`, `feature`, `datum`, `geometry`, `verified` | `reference` is a datum plane name, `{surfaceId}`, `{featureId}`, or (through) `{edgeId}`; the result carries the new plane's `surfaceId` |
| `creo_create_datum_axis` | `name?`, `type` (`twoPlanes` \| `edge` \| `surface`), `plane1?`, `plane2?`, `edgeId?`, `surfaceId?`, `featureName?` | `model`, `feature`, `datum`, `geometry`, `verified` | Two-plane intersection, along a straight edge, or along a cylindrical face; the result carries the `axisId` |
| `creo_create_datum_point` | `name?`, `type` (`onEdge` \| `edgeCenter`), `edgeId`, `ratio?`, `featureName?` | `model`, `feature`, `datum`, `geometry`, `verified` | Ratio 0 = edge start, 1 = edge end (default 0.5); the result carries the `pointId` |
| `creo_create_hole` | `name?`, `placement` (`linear` \| `coaxial`), `diameter`, `depth`, `head?`, `drillAngle?`, `featureName?` | `model`, `feature`, `geometry`, `volumeChange`, `verified` | `linear` takes an entry face plus two references/offsets; `coaxial` takes a datum axis and an entry face; depth `blind` \| `through` \| `symmetric`; heads are a real counterbore/countersink cut in the same feature |
| `creo_create_pattern` | `name?`, `seedFeatureId`, `type` (`linear` \| `axis`), `direction1?`, `direction2?`, `axis?`, `count?`, `angle?`, `flip?`, `featureName?` | `model`, `feature`, `members[]`, `memberCount`, `instanceCount`, `verified` | Linear patterns use 1–2 reference directions with count and spacing; axis patterns use a datum axis, count, and angular increment; Creo member readback is checked |
| `creo_get_feature_tree` | `name?`, `featureId`, `includeXml?` | `model`, `feature`, `elementCount`, `elements[]`, `xml?` | Read-only OTK element-tree dump (array/compound children included); use it to learn the payload of a native Creo feature |

Section entities are given in sketch-plane 2D coordinates in model units:
`line`, `centerline`, `rectangle`, `circle`, `arc` (angles in degrees),
`point`, `ellipse`, and `polyline` (a closed `points` list). Closed loops add
or remove material; Creo resolves the section with its intent manager.

Reference ids are session-scoped: list edges/surfaces immediately before the
write call and re-list after any model change. Known limits: the sketch plane
must be an existing datum plane (no sketch-plane offset yet); blind and
symmetric depths only (no up-to-reference, through-all, or drafted
extrusions); one section per feature; datum planes support offset and through
constraints (angled/parallel constraints are not verified yet); datum points
support on-edge placement only (no surface points/vertices yet); hole
placement is linear or coaxial (no radial/on-point); linear and axis-driven
linear and axis-driven patterns are implemented and live-verified; feature
mirroring is withheld after a live payload timeout and is not exposed as a tool.
Sweeps and feature redefinition are not implemented yet. Payloads are
validated against Creo 9.0.2.0; `docs/ROADMAP.md` tracks the rest.

`scripts/build-showcase-model.mjs` exercises the sketch features end to end: it
builds a six-spoke belt pulley (one revolve, six window cuts, one keyway cut),
verifies the volume against an analytic value, saves it, and exports STEP/STL
(plus a drawing with `--drawing`).

`scripts/build-detail-part.mjs` exercises this increment end to end: it creates
a part from a template, extrudes a plate, rounds two edges and chamfers one
(verifying the exact analytic volume deltas), then shells the plate against a
predicted cavity volume. Requires a running Creo; not part of `npm test`.

`scripts/build-datum-part.mjs` exercises the datum tools: it creates a template
part, adds DTM1 = TOP + 20, sketches an extrude on DTM1, creates a datum axis
through RIGHT x FRONT and a datum point on an edge, verifies every datum
resolves to its surface/axis/point id, and drills a coaxial hole on the new
axis (volume checked analytically).

`scripts/build-hole-part.mjs` exercises the hole tools: it drills a through
hole and a counterbore into a plate and checks the removed volume against the
analytic value including the 118 degree drill point, then regenerates and
re-verifies the references and feature states.

## Drawing pack (partial, M5)

Enabled with `tools.packs: ["core", "drawing"]`. `creo_create_drawing`
creates a drawing from a plain `.drw`/`.frm` template in Creo's live working
directory, links a part or assembly, and can create a general view. Subsequent
tools manage sheets and general/projection views. Use the existing export pack
to write PDF or DXF files.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `creo_create_drawing` | source, drawing name, template, view placement | `drawing`, `sourceModel`, `sheets`, `views`, `verified` | Saves by default; paths are rejected |
| `creo_generate_standard_drawing` | source, drawing name, template, `views[]`, `scale?`, `save?`, `pdfFileName?`, `dxfFileName?` | `drawing`, `sourceModel`, `sheets`, `views`, `exports`, `saved`, `verified` | Front view + projection views in one call; optional PDF/DXF export requires the `export` pack; incomplete drawings are erased on failure |
| `creo_save_drawing` | `name?` | `drawing`, `verified` | Saves and verifies the modified flag is cleared |
| `creo_list_drawing_sheets` / `creo_add_drawing_sheet` | `name?` | sheet data | Sheet count, scale, size, format |
| `creo_set_drawing_sheet_scale` | `name?`, `sheetNumber`, `scale` | sheet data | Readback-verified |
| `creo_list_drawing_views` | `name?` | view data | Linked model, sheet, scale, outline |
| `creo_create_drawing_view` | drawing, sheet, location, source? | view data | General view |
| `creo_create_projection_view` | drawing, parent view, sheet, location | view data | Projection from an existing view |
| `creo_set_drawing_view_scale` / `creo_rename_drawing_view` | drawing, view, value | view data | Readback-verified |
| `creo_translate_drawing_view` / `creo_regenerate_drawing_view` | drawing, view | view data | View maintenance |
| `creo_delete_drawing_view` | drawing, view | deleted id | Destructive and readback-verified |

`creo_generate_standard_drawing` never adds automatic dimensions: it produces
verified front/top/right (or caller-specified) views, optionally saves, and can
export PDF/DXF through the export pack. Section/detail views, model dimensions,
notes, and tables remain planned for M5.

## Planned packs

| Pack | Milestone | Highlights |
|---|---|---|
| `export` | M2.1 | STEP, IGES, STL (ascii/binary), drawing PDF, drawing DXF |
| `knowledge` | M2.2 | offline `otk_cpp_doc` index exposed as MCP resources + `creo_search_sdk` |
| `write` | M3 | copy-modify-verify, dry-run, rollback, expected-old-value guards, version cleanup |
| `features` (partial) | M4/P5 | shipped: extrude, revolve, round, chamfer, shell, datum plane/axis/point, hole, linear/axis pattern, feature-tree dump. Planned/withheld: draft, mirror (live timeout; payload investigation), sweep, blend, STEP import, feature redefine |
| `assembly` | M5 | create assembly, add components, constraints, visibility, skeleton |
| `sheetmetal` | post-v1 | planar/flat walls, cuts, bends |
| `drawing-advanced` | M5 | section/detail views, model dimensions, annotations, tables, drawing cleanup |

## Export pack (implemented, M2.1)

Enabled with `tools.packs: ["core", "read", "export"]` (env
`DNK_MCP_CREO_PACKS=core,read,export`). Every export tool accepts an optional
`name` (model name, file name, or full name), an optional `overwrite` boolean
(default `false`), and writes a file straight into Creo's live working
directory. Files must be plain file names — paths, escapes, and UNC prefixes
are rejected before the bridge is called, so no caller-controlled path ever
reaches the bridge. Outputs are verified by size readback after export.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `creo_export_step` | `name?`, `fileName`, `overwrite?` | `model`, `path`, `sizeBytes`, `verified` | Parts and assemblies. Uses `pfcSTEP3DExportInstructions` with `pfcEXPORT_ASM_SINGLE_FILE`. |
| `creo_export_iges` | `name?`, `fileName`, `overwrite?` | `model`, `path`, `sizeBytes`, `verified` | Parts and assemblies via `pfcIGES3DNewExportInstructions`. |
| `creo_export_stl` | `name?`, `fileName`, `overwrite?`, `mode?` (`ascii` \| `binary`, default `ascii`) | `model`, `path`, `sizeBytes`, `verified` | Solid-only (parts). Assemblies must be exported to STEP first. |
| `creo_export_pdf` | `name?`, `fileName`, `overwrite?`, `mode?` (`auto` \| `drawing`, default `auto`) | `model`, `path`, `sizeBytes`, `verified` | Drawing -> drawing PDF. 3D PDF is not exposed in this OTK build and returns `INVALID_ARGUMENT`. |
| `creo_export_dxf` | `name?`, `fileName`, `overwrite?` | `model`, `path`, `sizeBytes`, `verified` | Drawing-only. |

All five export tools are gated by `safety.mode`. Under
`safety.mode = read-only` (default), every export tool returns
`POLICY_BLOCKED` — exactly like the planned write pack. Raster image export
(PNG/JPEG/TIFF) is intentionally **not** in M2.1: OTK raster export relies on a
display window, which the read pack never opens. Raster image tools land when
drawing/snapshot infrastructure is added in M5.

## Tool design rules

1. One tool per user intent; composite workflows live inside the tool, not in the
   model's reasoning.
2. Inputs are validated with zod; outputs are structured and stable.
3. Write packs must add `dryRun` and identity/old-value guards as their safety
   surface matures; the currently shipped modeling/drawing increment verifies
   successful operations by readback.
4. File paths are always resolved against Creo's live working directory; tools never
   accept arbitrary absolute paths.
5. Errors are returned as structured payloads with codes from `docs/PROTOCOL.md`.
