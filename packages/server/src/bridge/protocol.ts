// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

export const BRIDGE_PROTOCOL_VERSION = "1.0";
export const BRIDGE_FRAME_PREFIX = "__CREOBRIDGE__ ";

export const modelInfoSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    fileName: z.string(),
    fullName: z.string(),
    path: z.string().optional(),
    isModified: z.boolean(),
    isNative: z.boolean(),
    version: z.string().optional(),
    revision: z.string().optional(),
    instanceName: z.string().optional(),
    genericName: z.string().optional(),
  })
  .passthrough();

export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const bridgeHelloSchema = z
  .object({
    protocolVersion: z.string(),
    bridge: z
      .object({
        name: z.string(),
        version: z.string(),
        build: z.string().optional(),
      })
      .passthrough(),
    platform: z.string(),
    otkLibrary: z.string(),
    connected: z.boolean(),
    capabilities: z.array(z.string()),
    creoVersion: z.string().optional(),
    creoMajorVersion: z.number().optional(),
    creoDateCode: z.string().optional(),
  })
  .passthrough();

export type BridgeHello = z.infer<typeof bridgeHelloSchema>;

export const bridgePingSchema = z
  .object({
    pong: z.boolean(),
    connected: z.boolean(),
    uptimeMs: z.number(),
  })
  .passthrough();

export const sessionInfoSchema = z
  .object({
    connected: z.boolean(),
    launched: z.boolean().optional(),
    creoVersion: z.string().optional(),
    creoMajorVersion: z.number().optional(),
    creoDateCode: z.string().optional(),
    workingDirectory: z.string().optional(),
    activeModel: modelInfoSchema.nullable().optional(),
    modelCount: z.number().optional(),
    models: z.array(modelInfoSchema).optional(),
    connectionMode: z.string().optional(),
  })
  .passthrough();

export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const modelListResultSchema = z
  .object({
    models: z.array(modelInfoSchema),
    count: z.number(),
  })
  .passthrough();

export const modelInfoResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
  })
  .passthrough();

export const paramValueSchema = z
  .object({
    type: z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .passthrough();

export type ParamValue = z.infer<typeof paramValueSchema>;

export const parameterInfoSchema = z
  .object({
    name: z.string(),
    value: paramValueSchema.nullable(),
    isDesignated: z.boolean().optional(),
    isRelationDriven: z.boolean().optional(),
    isModified: z.boolean().optional(),
    driverType: z.string(),
    description: z.string().optional(),
    units: z.string().optional(),
  })
  .passthrough();

export const dimensionInfoSchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    symbol: z.string(),
    value: z.number(),
    dimensionType: z.string(),
    isRelationDriven: z.boolean().optional(),
    isDesignated: z.boolean().optional(),
    isModified: z.boolean().optional(),
    isReference: z.boolean(),
    tolerance: z.string().nullable().optional(),
  })
  .passthrough();

export const featureInfoSchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    number: z.number().optional(),
    type: z.string(),
    subType: z.string().optional(),
    status: z.string(),
    isVisible: z.boolean(),
    isReadOnly: z.boolean(),
    isGroupMember: z.boolean(),
    isEmbedded: z.boolean(),
    parentIds: z.array(z.number()),
    childIds: z.array(z.number()),
  })
  .passthrough();

export const massPropertiesSchema = z
  .object({
    volume: z.number(),
    surfaceArea: z.number(),
    density: z.number(),
    mass: z.number(),
    gravityCenter: z.array(z.number()).length(3).optional(),
  })
  .passthrough();

export const materialInfoSchema = z
  .object({
    name: z.string(),
    id: z.number().optional(),
    massDensity: z.number().optional(),
    description: z.string().optional(),
    materialModel: z.string().optional(),
  })
  .passthrough();

export const layerInfoSchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    status: z.string(),
    itemCount: z.number(),
    hasUnsupportedItems: z.boolean(),
    unsupportedItemCount: z.number(),
  })
  .passthrough();

export const unitsInfoSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    isStandard: z.boolean(),
    units: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const outlineSchema = z.object({
  min: z.array(z.number()).length(3),
  max: z.array(z.number()).length(3),
});

export const geometryInfoSchema = z
  .object({
    outline: outlineSchema.nullable(),
    counts: z.object({
      surfaces: z.number(),
      edges: z.number(),
      bodies: z.number(),
    }),
  })
  .passthrough();

// Selectable model geometry. Edge and surface ids are session-scoped; callers
// list them, then pass the ids straight into a write tool.
export const edgeInfoSchema = z
  .object({
    id: z.number(),
    edgeType: z.number().optional(),
    edgeTypeName: z.string().optional(),
    length: z.number().optional(),
    start: z.array(z.number()).length(3).optional(),
    end: z.array(z.number()).length(3).optional(),
    midpoint: z.array(z.number()).length(3).optional(),
    featureId: z.number().optional(),
    featureName: z.string().optional(),
    featureType: z.string().optional(),
    surfaceIds: z.array(z.number()).optional(),
    requestedId: z.number().optional(),
  })
  .passthrough();

export const surfaceInfoSchema = z
  .object({
    id: z.number(),
    surfaceType: z.number().optional(),
    featureId: z.number().optional(),
    featureName: z.string().optional(),
    featureType: z.string().optional(),
    bodyId: z.number().optional(),
    requestedId: z.number().optional(),
    samplePoint: z.array(z.number()).length(3).optional(),
  })
  .passthrough();

export const familyTableColumnSchema = z.object({
  symbol: z.string(),
  type: z.string(),
});

export const familyTableRowSchema = z
  .object({
    instanceName: z.string(),
    isLocked: z.boolean(),
    isExtLocked: z.boolean(),
    verifyStatus: z.string(),
    cells: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const familyTableSchema = z
  .object({
    columns: z.array(familyTableColumnSchema),
    rows: z.array(familyTableRowSchema),
  })
  .passthrough();

export const modelParametersResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    parameters: z.array(parameterInfoSchema),
  })
  .passthrough();

export const modelDimensionsResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    dimensions: z.array(dimensionInfoSchema),
  })
  .passthrough();

export const modelFeaturesResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    features: z.array(featureInfoSchema),
  })
  .passthrough();

export const modelRelationsResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    relations: z.array(z.string()),
  })
  .passthrough();

export const modelMassPropertiesResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    massProperties: massPropertiesSchema.nullable(),
  })
  .passthrough();

export const modelMaterialsResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    supported: z.boolean(),
    currentMaterial: materialInfoSchema.nullable(),
    materials: z.array(materialInfoSchema),
  })
  .passthrough();

export const modelLayersResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    layers: z.array(layerInfoSchema),
  })
  .passthrough();

export const modelUnitsResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    units: unitsInfoSchema.nullable(),
  })
  .passthrough();

export const modelGeometryResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    geometry: geometryInfoSchema.nullable(),
  })
  .passthrough();

export const modelEdgesResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    edges: z.array(edgeInfoSchema),
  })
  .passthrough();

export const modelSurfacesResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    surfaces: z
      .object({
        bodySurfaces: z.array(surfaceInfoSchema),
        itemSurfaces: z.array(surfaceInfoSchema),
      })
      .passthrough(),
  })
  .passthrough();

export const modelCreateFromTemplateResultSchema = z
  .object({
    created: z.boolean(),
    template: z.string(),
    targetFileName: z.string().optional(),
    model: modelInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelFamilyTableResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    familyTable: familyTableSchema.nullable(),
  })
  .passthrough();

export const modelOpenResultSchema = z
  .object({
    opened: z.boolean(),
    alreadyOpen: z.boolean(),
    model: modelInfoSchema.nullable(),
  })
  .passthrough();

export const modelCloseResultSchema = z
  .object({
    closed: z.boolean(),
    name: z.string(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelMutationResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelRenameResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    newName: z.string(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelCopyResultSchema = z
  .object({
    sourceModel: modelInfoSchema.nullable(),
    copyModel: modelInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelParameterWriteResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    parameter: parameterInfoSchema.nullable(),
    created: z.boolean(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelDimensionWriteResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    dimension: dimensionInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelFeatureMutationResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    operation: z.string(),
    features: z.array(featureInfoSchema),
    verified: z.boolean(),
  })
  .passthrough();

export const modelCreateResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const assemblyAssembleResultSchema = z
  .object({
    assembly: modelInfoSchema.nullable(),
    component: modelInfoSchema.nullable(),
    feature: featureInfoSchema,
    features: z.array(featureInfoSchema),
    verified: z.boolean(),
  })
  .passthrough();

export const drawingSheetSchema = z
  .object({
    number: z.number(),
    scale: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    orientation: z.string().optional(),
    paperSize: z.string().optional(),
    units: z.string().optional(),
    format: modelInfoSchema.optional(),
  })
  .passthrough();

export const drawingViewSchema = z
  .object({
    id: z.number(),
    sheetNumber: z.number(),
    isBackground: z.boolean(),
    scale: z.number(),
    name: z.string().optional(),
    model: modelInfoSchema.optional(),
    outline: z.array(z.array(z.number()).length(3)).optional(),
  })
  .passthrough();

export const drawingCreateResultSchema = z
  .object({
    created: z.boolean(),
    drawing: modelInfoSchema.nullable(),
    sourceModel: modelInfoSchema.nullable(),
    sheets: z.array(drawingSheetSchema),
    views: z.array(drawingViewSchema),
    view: drawingViewSchema.nullable(),
    saved: z.boolean(),
    verified: z.boolean(),
  })
  .passthrough();

export const drawingSheetsResultSchema = z
  .object({
    drawing: modelInfoSchema.nullable(),
    currentSheet: z.number().nullable(),
    sheets: z.array(drawingSheetSchema),
    count: z.number(),
  })
  .passthrough();

export const drawingViewsResultSchema = z
  .object({
    drawing: modelInfoSchema.nullable(),
    views: z.array(drawingViewSchema),
    count: z.number(),
  })
  .passthrough();

export const drawingMutationResultSchema = z
  .object({
    drawing: modelInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const drawingSaveResultSchema = z
  .object({
    drawing: modelInfoSchema.nullable(),
    verified: z.boolean(),
  })
  .passthrough();

export const modelExportResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    path: z.string(),
    sizeBytes: z.number(),
    verified: z.boolean(),
    format: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    dpi: z.number().optional(),
  })
  .passthrough();

export const drawingGenerateResultSchema = z
  .object({
    created: z.boolean(),
    drawing: modelInfoSchema.nullable(),
    sourceModel: modelInfoSchema.nullable(),
    sheets: z.array(drawingSheetSchema),
    views: z.array(drawingViewSchema),
    exports: z.array(modelExportResultSchema),
    saved: z.boolean(),
    verified: z.boolean(),
  })
  .passthrough();

// OTK element trees are the payload format behind feature creation. Dumps are
// diagnostics: they let a caller learn the exact ids, levels, and references
// Creo 9 expects before authoring new geometry.
export const featureTreeElementSchema = z
  .object({
    id: z.number(),
    level: z.number(),
    idName: z.string().optional(),
    isArray: z.boolean().optional(),
    value: z.unknown().optional(),
    valueString: z.string().optional(),
    specialValue: z.record(z.string(), z.unknown()).optional(),
    collection: z.record(z.string(), z.unknown()).optional(),
    selections: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const featureTreeResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    feature: z
      .object({
        id: z.number(),
        name: z.string().optional(),
        type: z.string(),
        subType: z.string().optional(),
        status: z.string(),
      })
      .passthrough(),
    elementCount: z.number(),
    elements: z.array(featureTreeElementSchema),
    xml: z
      .object({
        file: z.string(),
        written: z.boolean(),
        chars: z.number().optional(),
        truncated: z.boolean().optional(),
        text: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const solidFeatureResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    feature: z
      .object({
        id: z.number(),
        name: z.string().optional(),
        type: z.string().optional(),
        subType: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
    geometry: geometryInfoSchema.nullable().optional(),
    massProperties: massPropertiesSchema.nullable().optional(),
    request: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// Datum features (plane/axis/point) return the created feature plus the
// resolvable geometry item the datum owns: a datum plane's PRO_SURFACE, a
// datum axis's PRO_AXIS, or a datum point's PRO_POINT.
export const datumInfoSchema = z
  .object({
    featureId: z.number(),
    name: z.string().optional(),
    surfaceId: z.number().optional(),
    axisId: z.number().optional(),
    pointId: z.number().optional(),
  })
  .passthrough();

export const datumFeatureResultSchema = z
  .object({
    model: modelInfoSchema.nullable(),
    feature: z
      .object({
        id: z.number(),
        name: z.string().optional(),
        type: z.string().optional(),
        subType: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
    datum: datumInfoSchema.optional(),
    geometry: geometryInfoSchema.nullable().optional(),
    massProperties: massPropertiesSchema.nullable().optional(),
    request: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// Replication features add their member/readback counts to the common solid
// feature result. The schema remains passthrough so Creo can expose additional
// pattern metadata without a protocol bump.
export const replicationFeatureResultSchema = solidFeatureResultSchema
  .extend({
    seedFeatureId: z.number().optional(),
    members: z.array(z.record(z.string(), z.unknown())).optional(),
    memberCount: z.number().optional(),
    instanceCount: z.number().optional(),
    mirroredFeatureCount: z.number().optional(),
  })
  .passthrough();

export interface BridgeErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

interface BridgeSuccessResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

interface BridgeFailureResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  error: BridgeErrorPayload;
}

export type BridgeResponse = BridgeSuccessResponse | BridgeFailureResponse;

export function parseBridgeFrame(line: string): unknown | undefined {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed.startsWith(BRIDGE_FRAME_PREFIX)) {
    return undefined;
  }
  const payload = trimmed.slice(BRIDGE_FRAME_PREFIX.length);
  return JSON.parse(payload) as unknown;
}
