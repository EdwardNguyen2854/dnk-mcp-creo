# Bridge Protocol v1

The native bridge (`creo-otk-bridge.exe`) speaks JSON-RPC 2.0 over stdin/stdout,
one JSON object per line.

## Framing

Every response line is prefixed:

```
__CREOBRIDGE__ {"jsonrpc":"2.0","id":7,"result":{...}}
```

- Lines without the prefix are non-protocol output from PTC runtimes and are ignored
  by the transport (logged at debug level).
- Requests are one JSON object per line, UTF-8, `\n` terminated.
- The bridge processes one request at a time.
- Responses are matched to requests by numeric `id`.
- The bridge exits cleanly on stdin EOF (disconnecting from Creo first).

## Request

```jsonc
{ "jsonrpc": "2.0", "id": 7, "method": "model.list", "params": { "type": "part" } }
```

## Success response

```jsonc
{ "jsonrpc": "2.0", "id": 7, "result": { "models": [], "count": 0 } }
```

## Error response

```jsonc
{
  "jsonrpc": "2.0",
  "id": 7,
  "error": {
    "code": "CREO_NOT_RUNNING",
    "message": "No running Creo Parametric session was found.",
    "retryable": true,
    "details": {}
  }
}
```

## Methods

| Method | Params | Result |
|---|---|---|
| `bridge.hello` | – | protocolVersion, bridge info, platform, otkLibrary, connected, capabilities, optional Creo version/datecode |
| `bridge.ping` | – | `pong`, `connected`, `uptimeMs` |
| `session.connect` | `mode` (`attach`\|`launch`), `creoCommand?`, `textPath?`, `display?`, `user?`, `timeoutSec?` | full session info + `connectionMode` |
| `session.disconnect` | `timeoutSec?` | `{ connected: false }` |
| `session.info` | – | `{ connected: false }` or full session info |
| `model.active` | – | `{ model: ModelInfo \| null }` |
| `model.list` | `type?` (`all`\|`part`\|`assembly`\|`drawing`\|`manufacturing`) | `{ models: ModelInfo[], count }` |
| `model.info` | `name?` (model/file/full name; defaults to active) | `{ model: ModelInfo \| null }` |
| `model.parameters` | `name?` | `{ model, parameters: ParameterInfo[] }` |
| `model.dimensions` | `name?` | `{ model, dimensions: DimensionInfo[] }` |
| `model.features` | `name?` | `{ model, features: FeatureInfo[] }` |
| `model.relations` | `name?` | `{ model, relations: string[] }` |
| `model.mass_properties` | `name?`, `csys?` | `{ model, massProperties: MassProperties \| null }` |
| `model.materials` | `name?` | `{ model, supported, currentMaterial, materials[] }` |
| `model.layers` | `name?` | `{ model, layers: LayerInfo[] }` |
| `model.units` | `name?` | `{ model, units: UnitSystem \| null }` |
| `model.geometry` | `name?` | `{ model, geometry: { outline, counts } \| null }` |
| `model.family_table` | `name?` | `{ model, familyTable: { columns, rows } \| null }` |
| `model.open` | `fileName` (plain file name) | `{ opened, alreadyOpen, model }` |
| `model.close` | `name?` (defaults to active) | `{ closed, name, verified }` |
| `model.save` | `name?` | `{ model, verified }` |
| `model.rename` | `name?`, `newName` | `{ model, newName, verified }` |
| `model.copy` | `name?`, `newName` | `{ sourceModel, copyModel, verified }` |
| `model.regenerate` | `name?` | `{ model, features, verified }` |
| `model.set_parameter` | `name?`, `paramName`, `value`, `createIfMissing?` | `{ model, parameter, created, verified }` |
| `model.set_dimension` | `name?`, `dimensionId`, `value` | `{ model, dimension, verified }` |
| `model.features.suppress` | `name?`, `featureIds[]` | `{ model, operation, features, verified }` |
| `model.features.resume` | `name?`, `featureIds[]` | `{ model, operation, features, verified }` |
| `model.features.delete` | `name?`, `featureIds[]` | `{ model, operation, features, verified }` |
| `model.features.reorder` | `name?`, `featureId`, `referenceFeatureId`, `before?` | `{ model, operation, features, verified }` |
| `model.create_part` | `name` | `{ model, verified }` |
| `model.create_assembly` | `name` | `{ model, verified }` |
| `model.create_from_template` | `templateDir`, `template` (plain .prt/.asm name), `name` | `{ created, template, targetFileName, model, verified }` |
| `assembly.assemble_component` | `name?`, `component` (model name or plain file name), `x?`, `y?`, `z?` | `{ assembly, component, feature, features, verified }` |
| `model.surfaces` | `name?`, `ids?[]` | `{ model, surfaces: { bodySurfaces[], itemSurfaces[] }, byId?[] }` |
| `model.edges` | `name?`, `ids?[]` | `{ model, edges[] }` |
| `feature.tree` | `name?`, `featureId`, `includeXml?`, `maxChars?` | `{ model, feature, elementCount, elements[], xml? }` |
| `feature.create_extrude` | `name?`, `sketchPlane`, `sketchPlaneSurfaceId?`, `sketchPlaneFeatureId?`, `orientRef?`, `orientRefSurfaceId?`, `orientRefFeatureId?`, `depth`, `symmetric?`, `direction?`, `removeMaterial?`, `featureName?`, `entities[]` | `{ model, feature, geometry, massProperties, request }` |
| `feature.create_revolve` | same as extrude, with `angle?` instead of `depth` | `{ model, feature, geometry, massProperties, request }` |
| `feature.create_round` | `name?`, `edgeIds[]`, `radius`, `featureName?` | `{ model, feature, geometry, massProperties, request }` |
| `feature.create_chamfer` | `name?`, `edgeIds[]`, `schema` (601–604), `distance1`, `distance2?`, `angle?`, `featureName?` | `{ model, feature, geometry, massProperties, request }` |
| `feature.create_shell` | `name?`, `surfaceIds[]`, `thickness`, `flip?`, `featureName?` | `{ model, feature, geometry, massProperties, request }` |
| `feature.create_datum_plane` | `name?`, `type` (`offset` \| `through`), `reference` (name or `surfaceId`/`featureId`/`edgeId`), `distance?`, `flip?`, `featureName?` | `{ model, feature, datum: { featureId, name?, surfaceId }, geometry, massProperties, request }` |
| `feature.create_datum_axis` | `name?`, `type` (`twoPlanes` \| `edge` \| `surface`), `plane1?`/`plane2?`, `edgeId?`, `surfaceId?`, `featureName?` | `{ model, feature, datum: { featureId, name?, axisId }, geometry, massProperties, request }` |
| `feature.create_datum_point` | `name?`, `type` (`onEdge` \| `edgeCenter`), `edgeId`, `ratio?`, `featureName?` | `{ model, feature, datum: { featureId, name?, pointId }, geometry, massProperties, request }` |
| `feature.create_hole` | `name?`, `placement` (`linear` \| `coaxial` with references), `diameter`, `depth` (`blind` \| `through` \| `symmetric`), `head?` (`counterbore` \| `countersink`), `drillAngle?`, `featureName?` | `{ model, feature, geometry, massProperties, request }` |
| `model.export_step` | `name?`, `fileName`, `overwrite?` | `{ model, path, sizeBytes, verified }` |
| `model.export_iges` | `name?`, `fileName`, `overwrite?` | `{ model, path, sizeBytes, verified }` |
| `model.export_stl` | `name?`, `fileName`, `overwrite?`, `mode?` (`ascii` \| `binary`) | `{ model, path, sizeBytes, verified }` |
| `model.export_pdf` | `name?`, `fileName`, `overwrite?`, `mode?` (`auto` \| `drawing`) | `{ model, path, sizeBytes, verified }` |
| `model.export_dxf` | `name?`, `fileName`, `overwrite?` | `{ model, path, sizeBytes, verified }` |
| `drawing.create` | `modelName?`, `drawingName`, `templateName`, view placement options | `{ created, drawing, sourceModel, sheets, views, verified }` |
| `drawing.list_sheets` | `name?` | `{ drawing, currentSheet, sheets, count }` |
| `drawing.add_sheet` | `name?` | `{ drawing, sheet, verified }` |
| `drawing.set_sheet_scale` | `name?`, `sheetNumber`, `scale` | `{ drawing, sheet, verified }` |
| `drawing.list_views` | `name?` | `{ drawing, views, count }` |
| `drawing.save` | `name?` | `{ drawing, verified }` |
| `drawing.create_general_view` | `name?`, `modelName?`, `sheetNumber`, `locationX/Y/Z`, `scale?`, `viewName?` | `{ drawing, view, verified }` |
| `drawing.create_projection_view` | `name?`, `parentViewId`, `sheetNumber`, `locationX/Y/Z`, `viewName?` | `{ drawing, view, verified }` |
| `drawing.set_view_scale` | `name?`, `viewId`, `scale` | `{ drawing, operation, view, verified }` |
| `drawing.rename_view` | `name?`, `viewId`, `viewName` | `{ drawing, operation, view, verified }` |
| `drawing.delete_view` | `name?`, `viewId` | `{ drawing, deletedViewId, verified }` |
| `drawing.translate_view` | `name?`, `viewId`, `x`, `y`, `z?` | `{ drawing, operation, view, verified }` |
| `drawing.regenerate_view` | `name?`, `viewId` | `{ drawing, operation, view, verified }` |

Read-pack payloads mirror the OTK fields; every list is present and empty when
there is nothing to report. `model.materials` reports `supported: false` for
assemblies. `model.geometry.outline` is normalized to `min`/`max` in the bridge.

### Session info payload

```jsonc
{
  "connected": true,
  "launched": false,
  "connectionMode": "attach",
  "creoVersion": "9.0.2.0",      // datecode when available
  "creoDateCode": "9.0.2.0",
  "creoMajorVersion": 41,         // PTC internal release number
  "workingDirectory": "D:\\work",
  "activeModel": { ... } | null,
  "modelCount": 2,
  "models": [ ... ]
}
```

### Model info payload

```jsonc
{
  "name": "BRACKET",
  "type": "part",
  "fileName": "bracket.prt",
  "fullName": "BRACKET",
  "path": "D:\\work",
  "isModified": false,
  "isNative": true,
  "version": "1",
  "revision": "A",
  "instanceName": "INST_A",
  "genericName": "BRACKET"
}
```

## Error taxonomy

| Code | Retryable | Meaning |
|---|---|---|
| `CREO_NOT_RUNNING` | yes | No running session could be reached, or launch failed |
| `SESSION_NOT_CONNECTED` | yes | A method requiring a session was called before `session.connect` |
| `CREO_BUSY` | yes | Creo is in a modal/busy state |
| `CREO_COMMUNICATION_FAILURE` | yes | RPC layer failed |
| `TIMEOUT` | yes | Transport-level call timeout |
| `BRIDGE_NOT_FOUND` | no | `creo-otk-bridge.exe` missing; run `npm run build:native` |
| `BRIDGE_SPAWN_FAILED` | no | Process could not start (missing DLLs show up here or as exit `0xC0000135`) |
| `BRIDGE_EXITED` | yes | Bridge died while a call was in flight; next call respawns |
| `BRIDGE_WRITE_FAILED` | yes | stdin write failed |
| `BRIDGE_CLOSED` | no | Transport is shutting down |
| `NOT_FOUND` | no | Toolkit object not found |
| `MODEL_NOT_FOUND` | no | Named model is not open in the session |
| `INVALID_ARGUMENT` | no | Bad bridge parameters |
| `FILE_EXISTS` | no | Export target already exists; pass `overwrite: true` to replace |
| `PERMISSION_DENIED` | no | Model locked / not modifiable |
| `LICENSE_UNAVAILABLE` | no | Toolkit license missing |
| `APP_VERSION_MISMATCH` | no | Toolkit/application version mismatch |
| `CREO_API_ERROR` | no | Any other OTK error; `details.toolkitErrorCode` is included when available. Feature authoring adds `details.stage` (e.g. `WCreateFeature`, `AddSectionEntities`, `RedefineFeature`) because OTK reports empty messages for element-tree failures |
| `INTERNAL` | no | Unhandled native failure |
| `METHOD_NOT_FOUND` | no | Unknown bridge method |
| `PARSE_ERROR` | no | Request was not valid JSON |

## Environment requirements

The async OTK application requires:

```
PRO_COMM_MSG_EXE = <Creo>\Common Files\x86e_win64\obj\pro_comm_msg.exe
PATH             = <Creo>\Common Files\x86e_win64\obj;... (plus the usual PATH)
```

`buildBridgeEnv()` in `packages/server/src/config.ts` sets these for every bridge
process. Attach fails with `XToolkitCantModify` when `PRO_COMM_MSG_EXE` is missing.

## Versioning

- `protocolVersion` is `MAJOR.MINOR`, currently `1.0`.
- Additive fields are allowed within a major version.
- Breaking changes require a major bump and a negotiated `bridge.hello`.
