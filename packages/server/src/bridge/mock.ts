// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { CreoMcpError } from "../errors.js";
import type { BridgeErrorPayload, BridgeHello, ModelInfo } from "./protocol.js";
import type { BridgeCallOptions, BridgeTransport } from "./transport.js";

export interface MockBridgeOptions {
  connected?: boolean;
  creoVersion?: string;
  workingDirectory?: string;
  activeModel?: string | null;
  models?: ModelInfo[];
  failures?: Record<string, BridgeErrorPayload>;
}

function defaultModel(
  name: string,
  type: string,
  fileName: string,
): ModelInfo {
  return {
    name,
    type,
    fileName,
    fullName: name,
    isModified: false,
    isNative: true,
  };
}

const MOCK_FIXTURES: ModelInfo[] = [
  defaultModel("COVER", "part", "cover.prt"),
  defaultModel("BRACKET_DRW", "drawing", "bracket.drw"),
];

// A simple 60x40x12 box: four bottom edges, four top edges, four verticals.
const MOCK_EDGES = (() => {
  const corners = [
    [-60, -40],
    [60, -40],
    [60, 40],
    [-60, 40],
  ];
  const edges: Record<string, unknown>[] = [];
  let id = 101;
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = corners[i] as [number, number];
    const [x2, y2] = corners[(i + 1) % 4] as [number, number];
    edges.push({
      id,
      edgeType: 2,
      edgeTypeName: "line",
      length: Math.hypot(x2 - x1, y2 - y1),
      start: [x1, y1, 0],
      end: [x2, y2, 0],
      midpoint: [(x1 + x2) / 2, (y1 + y2) / 2, 0],
      featureId: 2,
      featureName: "Extrude 1",
      featureType: "PROTRUSION",
      surfaceIds: [1, id + 100],
    });
    id += 1;
  }
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = corners[i] as [number, number];
    const [x2, y2] = corners[(i + 1) % 4] as [number, number];
    edges.push({
      id,
      edgeType: 2,
      edgeTypeName: "line",
      length: Math.hypot(x2 - x1, y2 - y1),
      start: [x1, y1, 12],
      end: [x2, y2, 12],
      midpoint: [(x1 + x2) / 2, (y1 + y2) / 2, 12],
      featureId: 2,
      featureName: "Extrude 1",
      featureType: "PROTRUSION",
      surfaceIds: [2, id + 100],
    });
    id += 1;
  }
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = corners[i] as [number, number];
    edges.push({
      id,
      edgeType: 2,
      edgeTypeName: "line",
      length: 12,
      start: [x, y, 0],
      end: [x, y, 12],
      midpoint: [x, y, 6],
      featureId: 2,
      featureName: "Extrude 1",
      featureType: "PROTRUSION",
      surfaceIds: [1, 2],
    });
    id += 1;
  }
  return edges;
})();

export class MockBridgeTransport implements BridgeTransport {
  readonly kind = "mock";

  private readonly options: Required<
    Pick<MockBridgeOptions, "creoVersion" | "workingDirectory">
  > &
    MockBridgeOptions;
  private connected: boolean;
  private models: ModelInfo[];
  private activeModelName: string | null;
  private readonly exportedFiles = new Set<string>();
  private readonly parameterOverrides = new Map<string, Map<string, unknown>>();
  private readonly dimensionOverrides = new Map<string, Map<number, number>>();
  private readonly suppressedFeatures = new Map<string, Set<number>>();
  private readonly resumedFeatures = new Map<string, Set<number>>();
  private readonly drawingViews = new Map<string, Record<string, unknown>[]>();
  private readonly drawingSources = new Map<string, ModelInfo>();
  private readonly createdFeatures = new Map<string, Record<string, unknown>[]>();
  private readonly featureOrderOverrides = new Map<string, number[]>();
  private readonly deletedFeatures = new Map<string, Set<number>>();
  private readonly volumeLoss = new Map<string, number>();
  private readonly closedModels = new Map<string, ModelInfo>();
  private readonly drawingSheets = new Map<string, Record<string, unknown>[]>();
  private nextViewId = 100;
  private nextFeatureId = 10;

  constructor(options: MockBridgeOptions = {}) {
    this.options = {
      creoVersion: "9.0.2.0",
      workingDirectory: "C:\\creo-workspace\\demo",
      ...options,
    };
    this.connected = options.connected ?? false;
    this.models = options.models ?? [
      defaultModel("BRACKET", "part", "bracket.prt"),
      defaultModel("GEARBOX", "assembly", "gearbox.asm"),
    ];    this.activeModelName =
      options.activeModel === undefined ? "BRACKET" : options.activeModel;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  setActiveModel(name: string | null): void {
    this.activeModelName = name;
  }

  isAlive(): boolean {
    return true;
  }

  async hello(): Promise<BridgeHello> {
    return {
      protocolVersion: "1.0",
      bridge: { name: "creo-otk-bridge(mock)", version: "0.1.0" },
      platform: "win64",
      otkLibrary: "otk_222",
      connected: this.connected,
      capabilities: [
        "bridge.hello",
        "bridge.ping",
        "session.connect",
        "session.disconnect",
        "session.info",
        "model.active",
        "model.list",
        "model.info",
        "model.parameters",
        "model.dimensions",
        "model.features",
        "model.relations",
        "model.mass_properties",
        "model.materials",
        "model.layers",
        "model.units",
        "model.geometry",
        "model.family_table",
         "model.open",
         "model.close",
         "model.save",
         "model.rename",
         "model.copy",
         "model.regenerate",
         "model.set_parameter",
         "model.set_dimension",
         "model.features.suppress",
         "model.features.resume",
         "model.features.delete",
          "model.features.reorder",
          "model.create_part",
          "model.create_assembly",
          "model.surfaces",
          "model.edges",
          "model.create_from_template",
          "feature.tree",
          "feature.create_extrude",
          "feature.create_revolve",
          "feature.create_round",
          "feature.create_chamfer",
          "feature.create_shell",
          "feature.create_datum_plane",
          "feature.create_datum_axis",
           "feature.create_datum_point",
           "feature.create_hole",
           "feature.create_pattern",
          "drawing.create",
         "drawing.list_sheets",
         "drawing.add_sheet",
         "drawing.set_sheet_scale",
          "drawing.list_views",
          "drawing.save",
          "drawing.create_general_view",
         "drawing.create_projection_view",
         "drawing.set_view_scale",
         "drawing.rename_view",
         "drawing.delete_view",
         "drawing.translate_view",
         "drawing.regenerate_view",
         "model.export_step",
        "model.export_iges",
        "model.export_stl",
        "model.export_pdf",
        "model.export_dxf",
      ],
      ...(this.connected ? { creoVersion: this.options.creoVersion } : {}),
    };
  }

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    _options?: BridgeCallOptions,
  ): Promise<T> {
    void _options;
    const failure = this.options.failures?.[method];
    if (failure) {
      throw new CreoMcpError(failure.code, failure.message, {
        retryable: failure.retryable,
        details: failure.details,
      });
    }

    switch (method) {
      case "bridge.hello":
        return (await this.hello()) as T;
      case "bridge.ping":
        return { pong: true, connected: this.connected, uptimeMs: 1000 } as T;
      case "session.info":
        return this.sessionInfo() as T;
      case "session.connect":
        this.connected = true;
        return {
          ...this.sessionInfo(),
          connectionMode: (params?.["mode"] as string | undefined) ?? "attach",
        } as T;
      case "session.disconnect":
        this.connected = false;
        return { connected: false } as T;
      case "model.active":
        this.requireConnected();
        return { model: this.activeModel() } as T;
      case "model.list": {
        this.requireConnected();
        const typeFilter = (params?.["type"] as string | undefined) ?? "all";
        const models =
          typeFilter === "all"
            ? this.models
            : this.models.filter((model) => model.type === typeFilter);
        return { models, count: models.length } as T;
      }
      case "model.info": {
        this.requireConnected();
        const name = params?.["name"] as string | undefined;
        const model = name
          ? (this.models.find(
              (candidate) =>
                candidate.name.toUpperCase() === name.toUpperCase() ||
                candidate.fileName.toUpperCase() === name.toUpperCase(),
            ) ?? null)
          : this.activeModel();
        if (name && !model) {
          throw new CreoMcpError(
            "MODEL_NOT_FOUND",
            `Model '${name}' is not open in the Creo session.`,
          );
        }
        return { model } as T;
      }
      case "model.parameters": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, parameters: this.parametersFor(model) } as T;
      }
      case "model.dimensions": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, dimensions: this.dimensionsFor(model) } as T;
      }
      case "model.features": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, features: this.featuresFor(model) } as T;
      }
      case "model.relations": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, relations: this.relationsFor(model) } as T;
      }
      case "model.mass_properties": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, massProperties: this.massPropertiesFor(model) } as T;
      }
      case "model.materials": {
        this.requireConnected();
        const model = this.resolve(params);
        if (model.type !== "part") {
          return {
            model,
            supported: false,
            currentMaterial: null,
            materials: [],
          } as T;
        }
        return {
          model,
          supported: true,
          currentMaterial: {
            name: "STEEL",
            id: 1,
            massDensity: 7.85e-9,
            description: "Steel",
          },
          materials: [
            { name: "STEEL", id: 1, massDensity: 7.85e-9 },
            { name: "ALUMINUM", id: 2, massDensity: 2.7e-9 },
          ],
        } as T;
      }
      case "model.layers": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, layers: this.layersFor(model) } as T;
      }
      case "model.units": {
        this.requireConnected();
        const model = this.resolve(params);
        return {
          model,
          units: {
            name: "Millimeter Newton Second",
            type: "mass_length_time",
            isStandard: true,
            units: {
              length: {
                name: "mm",
                expression: "mm",
                isStandard: true,
                conversion: { scale: 0.001, offset: 0 },
                referenceUnit: "m",
              },
              mass: { name: "tonne", expression: "tonne", isStandard: true },
            },
          },
        } as T;
      }
      case "model.geometry": {
        this.requireConnected();
        const model = this.resolve(params);
        return {
          model,
          geometry: {
            outline: { min: [-60, -40, 0], max: [60, 40, 12] },
            counts: { surfaces: 12, edges: 30, bodies: 1 },
          },
        } as T;
      }
      case "model.edges": {
        this.requireConnected();
        const model = this.resolve(params);
        const requested = Array.isArray(params?.["ids"])
          ? (params["ids"] as unknown[]).filter(
              (value): value is number => typeof value === "number",
            )
          : [];
        const edges = MOCK_EDGES.filter(
          (edge) =>
            requested.length === 0 ||
            requested.includes(Number(edge["id"])),
        );
        return { model, edges } as T;
      }
      case "model.surfaces": {
        this.requireConnected();
        const model = this.resolve(params);
        const surfaces = [
          {
            id: 2,
            surfaceType: 0,
            featureId: 1,
            featureName: "RIGHT",
            featureType: "DATUM PLANE",
          },
          {
            id: 4,
            surfaceType: 0,
            featureId: 3,
            featureName: "TOP",
            featureType: "DATUM PLANE",
          },
          {
            id: 6,
            surfaceType: 0,
            featureId: 5,
            featureName: "FRONT",
            featureType: "DATUM PLANE",
          },
        ];
        const ids = Array.isArray(params?.["ids"])
          ? (params["ids"] as unknown[]).filter(
              (value): value is number => typeof value === "number",
            )
          : [];
        return {
          model,
          surfaces: { bodySurfaces: [], itemSurfaces: surfaces },
          ...(ids.length > 0
            ? { byId: surfaces.filter((surface) => ids.includes(surface.id)) }
            : {}),
        } as T;
      }
      case "feature.tree": {
        this.requireConnected();
        const model = this.resolve(params);
        const featureId = Number(params?.["featureId"]);
        const feature = this.featuresFor(model).find(
          (candidate) => Number((candidate as { id: number }).id) === featureId,
        );
        if (!feature) {
          throw new CreoMcpError(
            "NOT_FOUND",
            `Feature ${featureId} is not present in the model.`,
          );
        }
        const elements = [
          { id: 386, level: 0, idName: "PRO_E_FEATURE_TREE" },
          {
            id: 387,
            level: 1,
            idName: "PRO_E_FEATURE_TYPE",
            value: 917,
          },
          {
            id: 388,
            level: 1,
            idName: "PRO_E_FEATURE_FORM",
            value: 1,
          },
          {
            id: 451,
            level: 3,
            idName: "PRO_E_STD_SEC_PLANE",
            value: { itemId: 4, itemType: 1, itemTypeName: "surface" },
          },
          {
            id: 458,
            level: 2,
            idName: "PRO_E_SKETCHER",
            specialValue: {
              present: true,
              hasSection: true,
              sectionEntityCount: 4,
            },
          },
        ];
        if (params?.["includeXml"] === true) {
          return {
            model,
            feature,
            elementCount: elements.length,
            elements,
            xml: {
              file: `${this.options.workingDirectory}\\mcp_feature_${featureId}_tree.xml`,
              written: true,
              chars: 128,
              truncated: false,
              text: "<PRO_E_FEATURE_TREE/>",
            },
          } as T;
        }
        return { model, feature, elementCount: elements.length, elements } as T;
      }
      case "feature.create_extrude":
      case "feature.create_revolve": {
        this.requireConnected();
        const model = this.resolve(params);
        const entities = params?.["entities"];
        if (!Array.isArray(entities) || entities.length === 0) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "At least one section entity is required.",
          );
        }
        const sketchPlane = params?.["sketchPlane"];
        if (
          typeof sketchPlane !== "string" ||
          !/^(TOP|FRONT|RIGHT|DTM\d+)$/i.test(sketchPlane)
        ) {
          throw new CreoMcpError(
            "NOT_FOUND",
            `Sketch plane '${String(sketchPlane)}' was not found as a datum plane in the model.`,
          );
        }
        if (method === "feature.create_revolve") {
          const hasCenterline = (entities as { type?: string }[]).some(
            (entity) => entity.type === "centerline",
          );
          if (!hasCenterline) {
            throw new CreoMcpError(
              "CREO_API_ERROR",
              "Stage 'RedefineFeature' failed (toolkit error -1)",
              { details: { stage: "RedefineFeature" } },
            );
          }
        }
        const featureId = this.nextFeatureId++;
        const feature: Record<string, unknown> = {
          id: featureId,
          type: "Protrusion",
          subType: method.endsWith("revolve") ? "Revolve" : "Extrude",
          name: params?.["featureName"] ?? `MCP_FEATURE_${featureId}`,
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
          ...(params?.["removeMaterial"] === true ? { type: "Cut" } : {}),
        };
        let created = this.createdFeatures.get(model.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(model.name, created);
        }
        created.push(feature);
        const cut = params?.["removeMaterial"] === true;
        return {
          model,
          feature,
          geometry: {
            outline: { min: [-25, -12, -18], max: [25, 0, 18] },
            counts: cut
              ? { surfaces: 12, edges: 30, bodies: 1 }
              : { surfaces: 6, edges: 12, bodies: 1 },
          },
          request: {
            sketchPlane,
            depth: params?.["depth"] ?? 0,
            angle: params?.["angle"] ?? 0,
            direction: params?.["direction"] ?? 1,
            removeMaterial: cut,
            entityCount: entities.length,
          },
        } as T;
      }
      case "feature.create_round":
      case "feature.create_chamfer":
      case "feature.create_shell": {
        this.requireConnected();
        const model = this.resolve(params);
        const kind = method.split("_").at(-1) ?? "detail";
        const inputIds =
          kind === "shell"
            ? (params?.["surfaceIds"] as unknown[] | undefined)
            : (params?.["edgeIds"] as unknown[] | undefined);
        if (!Array.isArray(inputIds) || inputIds.length === 0) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            kind === "shell"
              ? "At least one surface id is required."
              : "At least one edge id is required.",
          );
        }
        if (kind === "round" && !(Number(params?.["radius"]) > 0)) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "A round radius greater than zero is required.",
          );
        }
        if (kind === "chamfer" && !(Number(params?.["distance1"]) > 0)) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "A chamfer distance greater than zero is required.",
          );
        }
        if (kind === "shell" && !(Number(params?.["thickness"]) > 0)) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "A shell thickness greater than zero is required.",
          );
        }
        const featureId = this.nextFeatureId++;
        const feature: Record<string, unknown> = {
          id: featureId,
          type: kind.toUpperCase(),
          subType: kind === "round" ? "General" : "Edge",
          name:
            params?.["featureName"] ?? `${kind.toUpperCase()}_ID_${featureId}`,
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        };
        let created = this.createdFeatures.get(model.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(model.name, created);
        }
        created.push(feature);
        const loss =
          kind === "shell"
            ? 1000
            : kind === "round"
              ? Number(params?.["radius"]) * 100
              : Number(params?.["distance1"]) * 100;
        this.volumeLoss.set(model.name, (this.volumeLoss.get(model.name) ?? 0) + loss);
        const countDelta = kind === "round" ? 4 : 3;
        return {
          model,
          feature,
          geometry: {
            outline: { min: [-60, -40, 0], max: [60, 40, 12] },
            counts: { surfaces: 12 + countDelta, edges: 30 + countDelta, bodies: 1 },
          },
          massProperties: this.massPropertiesFor(model),
          request: { kind, ...Object.fromEntries(Object.entries(params ?? {})) },
        } as T;
      }
      case "feature.create_datum_plane": {
        this.requireConnected();
        const model = this.resolve(params);
        const type = String(params?.["type"] ?? "");
        if (type !== "offset" && type !== "through") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `Datum plane type must be offset or through, got '${type}'.`,
          );
        }
        if (type === "offset" && typeof params?.["distance"] !== "number") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "An offset datum plane requires a distance.",
          );
        }
        const reference = params?.["reference"];
        const hasReferenceId = [
          params?.["referenceSurfaceId"],
          params?.["referenceFeatureId"],
          params?.["referenceEdgeId"],
        ].some((value) => typeof value === "number");
        if (typeof reference === "string" && reference.length > 0) {
          if (!/^(TOP|FRONT|RIGHT|DTM\d+)$/i.test(reference)) {
            throw new CreoMcpError(
              "NOT_FOUND",
              `Datum plane reference '${reference}' was not found as a datum plane in the model.`,
            );
          }
        } else if (!hasReferenceId) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "A datum plane requires a reference (datum plane name, surface id, or feature id).",
          );
        }
        const featureId = this.nextFeatureId++;
        const name = String(params?.["featureName"] ?? `DTM${featureId}`);
        const feature: Record<string, unknown> = {
          id: featureId,
          name,
          type: "DATUM PLANE",
          subType: "Plane",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        };
        let created = this.createdFeatures.get(model.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(model.name, created);
        }
        created.push(feature);
        return {
          model,
          feature,
          datum: { featureId, name, surfaceId: featureId + 1 },
          geometry: {
            outline: { min: [-60, -40, 0], max: [60, 40, 12] },
            counts: { surfaces: 13, edges: 30, bodies: 1 },
          },
          massProperties: this.massPropertiesFor(model),
          request: { ...Object.fromEntries(Object.entries(params ?? {})) },
        } as T;
      }
      case "feature.create_datum_axis": {
        this.requireConnected();
        const model = this.resolve(params);
        const type = String(params?.["type"] ?? "");
        if (type === "twoPlanes") {
          const planes = [params?.["plane1"], params?.["plane2"]];
          const planeIds = [
            params?.["plane1SurfaceId"],
            params?.["plane2SurfaceId"],
            params?.["plane1FeatureId"],
            params?.["plane2FeatureId"],
          ];
          if (
            planes.some((plane) => typeof plane !== "string") &&
            !planeIds.some((value) => typeof value === "number")
          ) {
            throw new CreoMcpError(
              "INVALID_ARGUMENT",
              "A two-plane datum axis requires plane1 and plane2.",
            );
          }
          for (const plane of planes) {
            if (
              typeof plane === "string" &&
              plane.length > 0 &&
              !/^(TOP|FRONT|RIGHT|DTM\d+)$/i.test(plane)
            ) {
              throw new CreoMcpError(
                "NOT_FOUND",
                `Datum axis plane '${plane}' was not found as a datum plane in the model.`,
              );
            }
          }
        } else if (type === "edge") {
          if (typeof params?.["edgeId"] !== "number") {
            throw new CreoMcpError(
              "INVALID_ARGUMENT",
              "An edge datum axis requires an edgeId.",
            );
          }
        } else if (type === "surface") {
          if (typeof params?.["surfaceId"] !== "number") {
            throw new CreoMcpError(
              "INVALID_ARGUMENT",
              "A surface datum axis requires a surfaceId.",
            );
          }
        } else {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `Datum axis type must be twoPlanes, edge, or surface; got '${type}'.`,
          );
        }
        const featureId = this.nextFeatureId++;
        const name = String(params?.["featureName"] ?? `A_${featureId}`);
        const feature: Record<string, unknown> = {
          id: featureId,
          name,
          type: "DATUM AXIS",
          subType: "Axis",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        };
        let created = this.createdFeatures.get(model.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(model.name, created);
        }
        created.push(feature);
        return {
          model,
          feature,
          datum: { featureId, name, axisId: featureId + 1 },
          geometry: {
            outline: { min: [-60, -40, 0], max: [60, 40, 12] },
            counts: { surfaces: 12, edges: 30, bodies: 1 },
          },
          massProperties: this.massPropertiesFor(model),
          request: { ...Object.fromEntries(Object.entries(params ?? {})) },
        } as T;
      }
      case "feature.create_datum_point": {
        this.requireConnected();
        const model = this.resolve(params);
        const type = String(params?.["type"] ?? "");
        if (type !== "onEdge" && type !== "edgeCenter") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `Datum point type must be onEdge or edgeCenter; got '${type}'.`,
          );
        }
        if (typeof params?.["edgeId"] !== "number") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "A datum point requires an edgeId.",
          );
        }
        if (
          type === "onEdge" &&
          params?.["ratio"] !== undefined &&
          !(Number(params["ratio"]) >= 0 && Number(params["ratio"]) <= 1)
        ) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "An onEdge datum point ratio must be between 0 and 1.",
          );
        }
        const featureId = this.nextFeatureId++;
        const name = String(params?.["featureName"] ?? `PNT${featureId}`);
        const feature: Record<string, unknown> = {
          id: featureId,
          name,
          type: "DATUM POINT",
          subType: "General",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        };
        let created = this.createdFeatures.get(model.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(model.name, created);
        }
        created.push(feature);
        return {
          model,
          feature,
          datum: { featureId, name, pointId: featureId + 1 },
          geometry: {
            outline: { min: [-60, -40, 0], max: [60, 40, 12] },
            counts: { surfaces: 12, edges: 30, bodies: 1 },
          },
          massProperties: this.massPropertiesFor(model),
          request: { ...Object.fromEntries(Object.entries(params ?? {})) },
        } as T;
      }
      case "feature.create_hole": {
        this.requireConnected();
        const model = this.resolve(params);
        const placement = String(params?.["placement"] ?? "");
        if (placement === "linear") {
          const hasSurface = [params?.["plane"], params?.["planeSurfaceId"], params?.["planeFeatureId"]].some(
            (value) => value !== undefined,
          );
          const hasRefs = ["ref1", "ref2"].every(
            (name) =>
              params?.[name] !== undefined ||
              params?.[`${name}SurfaceId`] !== undefined ||
              params?.[`${name}FeatureId`] !== undefined ||
              params?.[`${name}EdgeId`] !== undefined,
          );
          if (!hasSurface || !hasRefs) {
            throw new CreoMcpError(
              "INVALID_ARGUMENT",
              "A linear hole requires a placement surface and two dimension references.",
            );
          }
        } else if (placement === "coaxial") {
          if (
            typeof params?.["axis"] !== "string" &&
            typeof params?.["axisId"] !== "number" &&
            typeof params?.["axisFeatureId"] !== "number"
          ) {
            throw new CreoMcpError(
              "NOT_FOUND",
              "A coaxial hole requires a datum axis (name, axisId, or featureId).",
            );
          }
        } else {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `Hole placement must be linear or coaxial; got '${placement}'.`,
          );
        }
        const diameter = Number(params?.["diameter"]);
        if (!(diameter > 0)) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "A hole diameter greater than zero is required.",
          );
        }
        const depth = String(params?.["depth"] ?? "");
        if (!["blind", "through", "symmetric"].includes(depth)) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "Hole depth must be blind, through, or symmetric.",
          );
        }
        if (depth !== "through" && !(Number(params?.["depthValue"]) > 0)) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `A ${depth} hole requires a positive depth value.`,
          );
        }
        const head = String(params?.["head"] ?? "");
        if (head === "counterbore") {
          if (
            !(Number(params?.["headDiameter"]) > diameter) ||
            !(Number(params?.["headDepth"]) > 0)
          ) {
            throw new CreoMcpError(
              "INVALID_ARGUMENT",
              "A counterbore needs a diameter larger than the hole and a positive depth.",
            );
          }
        } else if (head === "countersink") {
          if (
            !(Number(params?.["headDiameter"]) > diameter) ||
            !(Number(params?.["headAngle"]) > 0 && Number(params?.["headAngle"]) < 180)
          ) {
            throw new CreoMcpError(
              "INVALID_ARGUMENT",
              "A countersink needs a diameter larger than the hole and an angle in (0, 180).",
            );
          }
        } else if (head !== "") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `Hole head must be counterbore or countersink; got '${head}'.`,
          );
        }
        const radius = diameter / 2;
        const thickness = depth === "through" ? 12 : Number(params?.["depthValue"]);
        let loss = Math.PI * radius * radius * thickness;
        if (head === "counterbore") {
          const outer = Number(params?.["headDiameter"]) / 2;
          loss +=
            Math.PI * (outer * outer - radius * radius) * Number(params?.["headDepth"]);
        } else if (head === "countersink") {
          const outer = Number(params?.["headDiameter"]) / 2;
          loss += Math.PI * (outer * outer - radius * radius) * ((outer - radius) / 2);
        }
        this.volumeLoss.set(model.name, (this.volumeLoss.get(model.name) ?? 0) + loss);
        const featureId = this.nextFeatureId++;
        const feature: Record<string, unknown> = {
          id: featureId,
          name: String(params?.["featureName"] ?? `HOLE_ID_${featureId}`),
          type: "HOLE",
          subType: "Straight",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        };
        let created = this.createdFeatures.get(model.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(model.name, created);
        }
        created.push(feature);
        return {
          model,
          feature,
          geometry: {
            outline: { min: [-60, -40, 0], max: [60, 40, 12] },
            counts: { surfaces: 14, edges: 31, bodies: 1 },
          },
          massProperties: this.massPropertiesFor(model),
          request: { ...Object.fromEntries(Object.entries(params ?? {})) },
        } as T;
      }
      case "feature.create_pattern": {
        this.requireConnected();
        const model = this.resolve(params);
        const seedFeatureId = Number(params?.["seedFeatureId"]);
        const seedFeature = this.featuresFor(model).find(
          (feature) => Number((feature as { id: number }).id) === seedFeatureId,
        );
        if (!Number.isInteger(seedFeatureId) || seedFeatureId <= 0 || !seedFeature) {
          throw new CreoMcpError("NOT_FOUND", `Seed feature '${seedFeatureId}' is not present.`);
        }
        const type = String(params?.["type"] ?? "");
        let instanceCount: number;
        if (type === "linear") {
          const first = params?.["direction1"] as Record<string, unknown> | undefined;
          if (!first || Number(first["count"]) < 2 || Number(first["spacing"]) === 0 || first["reference"] === undefined) {
            throw new CreoMcpError("INVALID_ARGUMENT", "A linear pattern requires direction1 reference, count >= 2, and non-zero spacing.");
          }
          instanceCount = Number(first["count"]);
          const second = params?.["direction2"] as Record<string, unknown> | undefined;
          if (second) {
            if (Number(second["count"]) < 2 || Number(second["spacing"]) === 0 || second["reference"] === undefined) {
              throw new CreoMcpError("INVALID_ARGUMENT", "Pattern direction2 requires reference, count >= 2, and non-zero spacing.");
            }
            instanceCount *= Number(second["count"]);
          }
        } else if (type === "axis") {
          if (params?.["axis"] === undefined || Number(params?.["count"]) < 2 || !(Number(params?.["angle"]) > 0)) {
            throw new CreoMcpError("INVALID_ARGUMENT", "An axis pattern requires axis, count >= 2, and positive angle.");
          }
          instanceCount = Number(params?.["count"]);
        } else {
          throw new CreoMcpError("INVALID_ARGUMENT", `Pattern type must be linear or axis; got '${type}'.`);
        }
        const featureId = this.nextFeatureId++;
        const feature: Record<string, unknown> = {
          id: featureId,
          name: params?.["featureName"] ?? `PATTERN_${featureId}`,
          type: "PATTERN",
          subType: type,
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [seedFeatureId],
          childIds: [],
        };
        const members: Record<string, unknown>[] = [
          { ...(seedFeature as Record<string, unknown>) },
          ...Array.from({ length: instanceCount - 1 }, (_, index) => ({
          id: this.nextFeatureId++,
          name: `PATTERN_MEMBER_${featureId}_${index + 1}`,
          type: "PATTERN MEMBER",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [featureId],
          childIds: [],
          })),
        ];
        let created = this.createdFeatures.get(model.name);
        if (!created) { created = []; this.createdFeatures.set(model.name, created); }
        created.push(feature, ...members.slice(1));
        return {
          model, feature, seedFeatureId, members,
          memberCount: members.length, instanceCount,
          geometry: { outline: { min: [-60, -40, 0], max: [60, 40, 12] }, counts: { surfaces: 12 + members.length * 4, edges: 30 + members.length * 8, bodies: 1 } },
          request: { ...Object.fromEntries(Object.entries(params ?? {})) },
        } as T;
      }
      case "model.create_from_template": {
        this.requireConnected();
        const name = String(params?.["name"] ?? "");
        if (!name) {
          throw new CreoMcpError("INVALID_ARGUMENT", "name is required");
        }
        const existing = this.models.find(
          (candidate) => candidate.name.toUpperCase() === name.toUpperCase(),
        );
        if (existing) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            `The working directory already has '${existing.fileName}'.`,
          );
        }
        const template = String(params?.["template"] ?? "mmns_part_solid_abs.prt");
        const model = defaultModel(name, "part", `${name.toLowerCase()}.prt`);
        this.models.push(model);
        this.activeModelName = model.name;
        return {
          created: true,
          template,
          targetFileName: model.fileName,
          model,
          verified: true,
        } as T;
      }
      case "model.family_table": {
        this.requireConnected();
        const model = this.resolve(params);
        return { model, familyTable: this.familyTableFor(model) } as T;
      }
      case "model.open": {
        this.requireConnected();
        const fileName = String(params?.["fileName"] ?? "");
        if (!fileName) {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "model.open requires a fileName parameter",
          );
        }
        const existing = this.models.find(
          (candidate) =>
            candidate.fileName.toUpperCase() === fileName.toUpperCase(),
        );
        if (existing) {
          return { opened: false, alreadyOpen: true, model: existing } as T;
        }
        const fixture =
          this.closedModels.get(fileName.toLowerCase()) ??
          MOCK_FIXTURES.find(
            (candidate) =>
              candidate.fileName.toUpperCase() === fileName.toUpperCase(),
          );
        if (!fixture) {
          throw new CreoMcpError(
            "MODEL_NOT_FOUND",
            `Model file '${fileName}' was not found in Creo's working directory.`,
          );
        }
        const reopened = { ...fixture, isModified: false };
        this.closedModels.delete(fileName.toLowerCase());
        this.models.push(reopened);
        this.activeModelName = reopened.name;
        return { opened: true, alreadyOpen: false, model: reopened } as T;
      }
      case "model.close": {
        this.requireConnected();
        const name = params?.["name"] as string | undefined;
        const index = this.models.findIndex(
          (candidate) =>
            !name
              ? candidate.name === this.activeModelName
              : candidate.name.toUpperCase() === name.toUpperCase() ||
                candidate.fileName.toUpperCase() === name.toUpperCase(),
        );
        if (index < 0) {
          throw new CreoMcpError(
            "MODEL_NOT_FOUND",
            `Model '${name ?? this.activeModelName ?? ""}' is not open in the Creo session.`,
          );
        }
        const [removed] = this.models.splice(index, 1);
        if (removed) {
          const restoredState = { ...removed, isModified: false };
          this.closedModels.set(removed.fileName.toLowerCase(), restoredState);
          if (params?.["force"] === true) {
            this.parameterOverrides.delete(removed.name);
            this.dimensionOverrides.delete(removed.name);
            this.suppressedFeatures.delete(removed.name);
            this.resumedFeatures.delete(removed.name);
            this.createdFeatures.delete(removed.name);
            this.featureOrderOverrides.delete(removed.name);
            this.deletedFeatures.delete(removed.name);
            this.volumeLoss.delete(removed.name);
            this.drawingViews.delete(removed.name);
            this.drawingSources.delete(removed.name);
            this.drawingSheets.delete(removed.name);
          }
        }
        if (this.activeModelName === removed?.name) {
          this.activeModelName = this.models[0]?.name ?? null;
        }
        return {
          closed: true,
          name: removed?.name ?? "",
          verified: true,
        } as T;
      }
      case "model.save": {
        this.requireConnected();
        const model = this.resolve(params);
        model.isModified = false;
        return { model, verified: true } as T;
      }
      case "model.rename": {
        this.requireConnected();
        const model = this.resolve(params);
        const newName = String(params?.["newName"] ?? "");
        if (!newName) {
          throw new CreoMcpError("INVALID_ARGUMENT", "newName is required");
        }
        model.name = newName;
        model.fullName = newName;
        return { model, newName, verified: true } as T;
      }
      case "model.copy": {
        this.requireConnected();
        const source = this.resolve(params);
        const newName = String(params?.["newName"] ?? "");
        if (!newName) {
          throw new CreoMcpError("INVALID_ARGUMENT", "newName is required");
        }
        const copy: ModelInfo = {
          ...source,
          name: newName,
          fullName: newName,
          fileName: `${newName}.${source.type === "assembly" ? "asm" : "prt"}`,
          isModified: false,
        };
        this.models.push(copy);
        this.copyModelState(source.name, copy.name);
        this.activeModelName = copy.name;
        return { sourceModel: source, copyModel: copy, verified: true } as T;
      }
      case "model.regenerate": {
        this.requireConnected();
        const model = this.resolve(params);
        return {
          model,
          features: this.featuresFor(model),
          verified: true,
        } as T;
      }
      case "model.set_parameter": {
        this.requireConnected();
        const model = this.resolve(params);
        const paramName = String(params?.["paramName"] ?? "");
        if (!paramName || !params || !("value" in params)) {
          throw new CreoMcpError("INVALID_ARGUMENT", "paramName and value are required");
        }
        const base = this.parametersFor(model);
        const exists = base.some(
          (parameter) =>
            (parameter as { name?: string }).name?.toUpperCase() === paramName.toUpperCase(),
        );
        if (!exists && params["createIfMissing"] !== true) {
          throw new CreoMcpError("NOT_FOUND", `Parameter '${paramName}' is not present.`);
        }
        let values = this.parameterOverrides.get(model.name);
        if (!values) {
          values = new Map();
          this.parameterOverrides.set(model.name, values);
        }
        values.set(paramName.toUpperCase(), params["value"]);
        model.isModified = true;
        const parameter = {
          name: paramName,
          value: this.typedParamValue(params["value"]),
          driverType: "parameter",
        };
        return {
          model,
          parameter,
          created: !exists,
          verified: true,
        } as T;
      }
      case "model.set_dimension": {
        this.requireConnected();
        const model = this.resolve(params);
        const id = Number(params?.["dimensionId"]);
        const value = Number(params?.["value"]);
        const dimension = this.dimensionsFor(model).find(
          (candidate) => (candidate as { id?: number }).id === id,
        );
        if (!dimension) {
          throw new CreoMcpError("NOT_FOUND", `Dimension '${id}' is not present.`);
        }
        let values = this.dimensionOverrides.get(model.name);
        if (!values) {
          values = new Map();
          this.dimensionOverrides.set(model.name, values);
        }
        values.set(id, value);
        model.isModified = true;
        return {
          model,
          dimension: { ...(dimension as Record<string, unknown>), value },
          verified: true,
        } as T;
      }
      case "model.features.suppress":
      case "model.features.resume":
      case "model.features.delete": {
        this.requireConnected();
        const model = this.resolve(params);
        const ids = this.featureIds(params);
        const operation = method.split(".").at(-1) ?? "feature";
        let suppressed = this.suppressedFeatures.get(model.name);
        if (!suppressed) {
          suppressed = new Set();
          this.suppressedFeatures.set(model.name, suppressed);
        }
        for (const id of ids) {
          if (operation === "suppress") {
            suppressed.add(id);
            this.resumedFeatures.get(model.name)?.delete(id);
          }
          if (operation === "resume") {
            suppressed.delete(id);
            let resumed = this.resumedFeatures.get(model.name);
            if (!resumed) {
              resumed = new Set<number>();
              this.resumedFeatures.set(model.name, resumed);
            }
            resumed.add(id);
          }
        }
        const features = this.featuresFor(model).filter((feature) =>
          ids.includes(Number((feature as { id: number }).id)),
        );
        if (operation === "delete") {
          let deleted = this.deletedFeatures.get(model.name);
          if (!deleted) {
            deleted = new Set<number>();
            this.deletedFeatures.set(model.name, deleted);
          }
          for (const id of ids) deleted.add(id);
        }
        model.isModified = true;
        return { model, operation, features, verified: true } as T;
      }
      case "model.features.reorder": {
        this.requireConnected();
        const model = this.resolve(params);
        const featureId = Number(params?.["featureId"]);
        const referenceFeatureId = Number(params?.["referenceFeatureId"]);
        if (featureId === referenceFeatureId) {
          throw new CreoMcpError("INVALID_ARGUMENT", "A feature cannot be reordered relative to itself.");
        }
        const featureList = this.featuresFor(model) as Record<string, unknown>[];
        const fromIndex = featureList.findIndex((candidate) => Number(candidate["id"]) === featureId);
        const referenceIndex = featureList.findIndex((candidate) => Number(candidate["id"]) === referenceFeatureId);
        if (fromIndex < 0) throw new CreoMcpError("NOT_FOUND", `Feature '${featureId}' is not present.`);
        if (referenceIndex < 0) throw new CreoMcpError("NOT_FOUND", `Reference feature '${referenceFeatureId}' is not present.`);
        const [feature] = featureList.splice(fromIndex, 1);
        const targetIndex = featureList.findIndex((candidate) => Number(candidate["id"]) === referenceFeatureId);
        featureList.splice(targetIndex + (params?.["before"] === true ? 0 : 1), 0, feature as Record<string, unknown>);
        this.featureOrderOverrides.set(model.name, featureList.map((candidate) => Number(candidate["id"])));
        model.isModified = true;
        return {
          model,
          operation: params?.["before"] === true ? "reorder_before" : "reorder_after",
          features: [feature],
          verified: true,
        } as T;
      }
      case "model.create_part":
      case "model.create_assembly": {
        this.requireConnected();
        const name = String(params?.["name"] ?? "");
        if (!name) throw new CreoMcpError("INVALID_ARGUMENT", "name is required");
        const type = method.endsWith("part") ? "part" : "assembly";
        const model = defaultModel(name, type, `${name}.${type === "part" ? "prt" : "asm"}`);
        this.models.push(model);
        this.activeModelName = model.name;
        return { model, verified: true } as T;
      }
      case "assembly.assemble_component": {
        this.requireConnected();
        const assembly = this.resolve(params);
        if (assembly.type !== "assembly") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "The target model is not an assembly.",
          );
        }
        const componentName = String(params?.["component"] ?? "");
        if (!componentName) {
          throw new CreoMcpError("INVALID_ARGUMENT", "component is required");
        }
        const wanted = componentName.toLowerCase();
        const component = this.models.find(
          (model) =>
            model.name.toLowerCase() === wanted ||
            model.fileName.toLowerCase() === wanted ||
            model.fileName.toLowerCase() === `${wanted}.prt` ||
            model.fileName.toLowerCase() === `${wanted}.asm`,
        );
        if (!component) {
          throw new CreoMcpError(
            "MODEL_NOT_FOUND",
            `Component '${componentName}' is not open in the Creo session.`,
          );
        }
        if (component.type === "drawing") {
          throw new CreoMcpError(
            "INVALID_ARGUMENT",
            "The component must be a part or an assembly.",
          );
        }
        const featureId = this.nextFeatureId++;
        const feature = {
          id: featureId,
          name: component.name,
          number: featureId,
          type: "Component",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        };
        let created = this.createdFeatures.get(assembly.name);
        if (!created) {
          created = [];
          this.createdFeatures.set(assembly.name, created);
        }
        created.push(feature);
        const features = this.featuresFor(assembly);
        return {
          assembly,
          component,
          feature,
          features,
          verified: features.some(
            (item) => Number((item as { id: number }).id) === featureId,
          ),
        } as T;
      }
      case "drawing.create": {
        this.requireConnected();
        const source = this.resolve({ name: params?.["modelName"] as string | undefined });
        const drawingName = String(params?.["drawingName"] ?? "");
        if (!drawingName) throw new CreoMcpError("INVALID_ARGUMENT", "drawingName is required");
        const fileName = drawingName.toLowerCase().endsWith(".drw") ? drawingName : `${drawingName}.drw`;
        const drawing = defaultModel(drawingName.replace(/\.drw$/i, ""), "drawing", fileName);
        drawing.isModified = params?.["save"] === false;
        this.models.push(drawing);
        this.activeModelName = drawing.name;
        const views: Record<string, unknown>[] = [];
        const sheets: Record<string, unknown>[] = [{ number: 1, scale: 1 }];
        this.drawingViews.set(drawing.name, views);
        this.drawingSheets.set(drawing.name, sheets);
        this.drawingSources.set(drawing.name, source);
        if (params?.["createView"] !== false) {
          views.push(this.makeView(source, drawing, params));
        }
        return {
          created: true,
          drawing,
          sourceModel: source,
          sheets,
          views,
          view: views[0] ?? null,
          saved: params?.["save"] !== false,
          verified: true,
        } as T;
      }
      case "drawing.list_sheets": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const sheets = this.drawingSheets.get(drawing.name) ?? [{ number: 1, scale: 1 }];
        return {
          drawing,
          currentSheet: Number(sheets[0]?.["number"] ?? 1),
          sheets,
          count: sheets.length,
        } as T;
      }
      case "drawing.add_sheet": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const sheets = this.drawingSheets.get(drawing.name) ?? [{ number: 1, scale: 1 }];
        const sheet = { number: sheets.length + 1, scale: 1 };
        sheets.push(sheet);
        this.drawingSheets.set(drawing.name, sheets);
        drawing.isModified = true;
        return { drawing, sheet, verified: true } as T;
      }
      case "drawing.set_sheet_scale": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const sheets = this.drawingSheets.get(drawing.name) ?? [{ number: 1, scale: 1 }];
        const sheet = sheets.find((candidate) => Number(candidate["number"]) === Number(params?.["sheetNumber"]));
        if (!sheet) throw new CreoMcpError("NOT_FOUND", `Drawing sheet '${String(params?.["sheetNumber"])}' was not found.`);
        sheet["scale"] = Number(params?.["scale"]);
        this.drawingSheets.set(drawing.name, sheets);
        drawing.isModified = true;
        return { drawing, sheet, verified: true } as T;
      }
      case "drawing.list_views": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const views = this.drawingViews.get(drawing.name) ?? [];
        return { drawing, views, count: views.length } as T;
      }
      case "drawing.save": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        drawing.isModified = false;
        return { drawing, verified: true } as T;
      }
      case "drawing.create_general_view": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const source = params?.["modelName"]
          ? this.resolve({ name: params["modelName"] as string })
          : this.drawingSources.get(drawing.name);
        if (!source) throw new CreoMcpError("MODEL_NOT_FOUND", "No source model is linked to the drawing.");
        const views = this.drawingViewsFor(drawing);
        const view = this.makeView(source, drawing, params);
        views.push(view);
        drawing.isModified = true;
        return { drawing, view, verified: true } as T;
      }
      case "drawing.create_projection_view": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const views = this.drawingViewsFor(drawing);
        const parent = views.find((view) => Number(view["id"]) === Number(params?.["parentViewId"]));
        if (!parent) throw new CreoMcpError("NOT_FOUND", "Parent drawing view was not found.");
        const view = {
          ...parent,
          id: this.nextViewId++,
          name: params?.["viewName"] ?? "PROJECTION",
          sheetNumber: Number(params?.["sheetNumber"] ?? parent["sheetNumber"]),
          locationX: Number(params?.["locationX"] ?? parent["locationX"] ?? 0),
          locationY: Number(params?.["locationY"] ?? parent["locationY"] ?? 0),
        };
        views.push(view);
        drawing.isModified = true;
        return { drawing, view, verified: true } as T;
      }
      case "drawing.set_view_scale":
      case "drawing.rename_view":
      case "drawing.translate_view":
      case "drawing.regenerate_view": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const view = this.findMockView(drawing, Number(params?.["viewId"]));
        const operation = method.replace("drawing.", "");
        if (operation === "set_view_scale") view["scale"] = Number(params?.["scale"]);
        if (operation === "rename_view") view["name"] = params?.["viewName"];
        if (operation === "translate_view") {
          view["locationX"] = Number(view["locationX"] ?? 0) + Number(params?.["x"] ?? 0);
          view["locationY"] = Number(view["locationY"] ?? 0) + Number(params?.["y"] ?? 0);
          if (params?.["z"] !== undefined) view["locationZ"] = Number(view["locationZ"] ?? 0) + Number(params["z"]);
        }
        drawing.isModified = true;
        return { drawing, operation, view, verified: true } as T;
      }
      case "drawing.delete_view": {
        this.requireConnected();
        const drawing = this.resolveDrawing(params);
        const views = this.drawingViewsFor(drawing);
        const viewId = Number(params?.["viewId"]);
        const index = views.findIndex((view) => Number(view["id"]) === viewId);
        if (index < 0) throw new CreoMcpError("NOT_FOUND", "Drawing view was not found.");
        views.splice(index, 1);
        drawing.isModified = true;
        return { drawing, deletedViewId: viewId, verified: true } as T;
      }
      case "model.export_step":
      case "model.export_iges":
        return this.fakeExport(params, { kinds: ["part", "assembly"] }) as T;
      case "model.export_stl":
        return this.fakeExport(params, { kinds: ["part"] }) as T;
      case "model.export_pdf":
        return this.fakeExport(params, { kinds: ["drawing"] }) as T;
      case "model.export_dxf":
        return this.fakeExport(params, { kinds: ["drawing"] }) as T;
      default:
        throw new CreoMcpError(
          "METHOD_NOT_FOUND",
          `Unknown bridge method: ${method}`,
        );
    }
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  private copyModelState(sourceName: string, targetName: string): void {
    const parameters = this.parameterOverrides.get(sourceName);
    if (parameters) this.parameterOverrides.set(targetName, new Map(parameters));
    const dimensions = this.dimensionOverrides.get(sourceName);
    if (dimensions) this.dimensionOverrides.set(targetName, new Map(dimensions));
    const suppressed = this.suppressedFeatures.get(sourceName);
    if (suppressed) this.suppressedFeatures.set(targetName, new Set(suppressed));
    const resumed = this.resumedFeatures.get(sourceName);
    if (resumed) this.resumedFeatures.set(targetName, new Set(resumed));
    const deleted = this.deletedFeatures.get(sourceName);
    if (deleted) this.deletedFeatures.set(targetName, new Set(deleted));
    const created = this.createdFeatures.get(sourceName);
    if (created) this.createdFeatures.set(targetName, created.map((feature) => ({ ...feature })));
    const order = this.featureOrderOverrides.get(sourceName);
    if (order) this.featureOrderOverrides.set(targetName, [...order]);
    const loss = this.volumeLoss.get(sourceName);
    if (loss !== undefined) this.volumeLoss.set(targetName, loss);
  }

  private requireConnected(): void {
    if (!this.connected) {
      throw new CreoMcpError(
        "SESSION_NOT_CONNECTED",
        "The bridge is not attached to a Creo session. Call session.connect first.",
        { retryable: true },
      );
    }
  }

  private resolve(params?: Record<string, unknown>): ModelInfo {
    const name = params?.["name"] as string | undefined;
    const model = name
      ? this.models.find(
          (candidate) =>
            candidate.name.toUpperCase() === name.toUpperCase() ||
            candidate.fileName.toUpperCase() === name.toUpperCase(),
        )
      : this.activeModel();
    if (!model) {
      throw new CreoMcpError(
        "MODEL_NOT_FOUND",
        name
          ? `Model '${name}' is not open in the Creo session.`
          : "No active model is open in the Creo session.",
      );
    }
    return model;
  }

  private typedParamValue(raw: unknown): { type: string; value: unknown } {
    if (raw && typeof raw === "object" && "type" in raw && "value" in raw) {
      const value = raw as { type: unknown; value: unknown };
      return { type: String(value.type), value: value.value };
    }
    if (typeof raw === "boolean") return { type: "boolean", value: raw };
    if (typeof raw === "string") return { type: "string", value: raw };
    if (typeof raw === "number") {
      return Number.isInteger(raw)
        ? { type: "integer", value: raw }
        : { type: "double", value: raw };
    }
    return { type: "void", value: null };
  }

  private featureIds(params?: Record<string, unknown>): number[] {
    const raw = params?.["featureIds"];
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((id) => !Number.isInteger(id))) {
      throw new CreoMcpError("INVALID_ARGUMENT", "featureIds must be a non-empty integer array");
    }
    return raw as number[];
  }

  private resolveDrawing(params?: Record<string, unknown>): ModelInfo {
    const model = this.resolve(params);
    if (model.type !== "drawing") {
      throw new CreoMcpError("INVALID_ARGUMENT", "The selected model is not a drawing.");
    }
    return model;
  }

  private drawingViewsFor(drawing: ModelInfo): Record<string, unknown>[] {
    let views = this.drawingViews.get(drawing.name);
    if (!views) {
      views = [];
      this.drawingViews.set(drawing.name, views);
    }
    return views;
  }

  private makeView(
    source: ModelInfo,
    drawing: ModelInfo,
    params?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      id: this.nextViewId++,
      sheetNumber: Number(params?.["sheetNumber"] ?? 1),
      isBackground: false,
      scale: Number(params?.["scale"] ?? 1),
      locationX: Number(params?.["locationX"] ?? 0),
      locationY: Number(params?.["locationY"] ?? 0),
      ...(params?.["locationZ"] !== undefined ? { locationZ: Number(params["locationZ"]) } : {}),
      name: String(params?.["viewName"] ?? `VIEW_${this.nextViewId}`),
      model: source,
      drawing,
    };
  }

  private findMockView(drawing: ModelInfo, id: number): Record<string, unknown> {
    const view = this.drawingViewsFor(drawing).find(
      (candidate) => Number(candidate["id"]) === id,
    );
    if (!view) {
      throw new CreoMcpError("NOT_FOUND", `Drawing view '${id}' was not found.`);
    }
    return view;
  }

  private parametersFor(model: ModelInfo): unknown[] {
    if (model.type !== "part") {
      return [];
    }
    const parameters = [
      {
        name: "WIDTH",
        value: { type: "double", value: 120 },
        isDesignated: true,
        isRelationDriven: false,
        isModified: false,
        driverType: "parameter",
      },
      {
        name: "MATERIAL",
        value: { type: "string", value: "STEEL" },
        isDesignated: true,
        isRelationDriven: false,
        isModified: false,
        driverType: "parameter",
      },
      {
        name: "HEIGHT",
        value: { type: "double", value: 60 },
        isDesignated: false,
        isRelationDriven: true,
        isModified: false,
        driverType: "relation",
      },
      {
        name: "IS_MACHINED",
        value: { type: "boolean", value: true },
        isDesignated: false,
        isRelationDriven: false,
        isModified: false,
        driverType: "parameter",
      },
    ];
    const overrides = this.parameterOverrides.get(model.name);
    if (overrides) {
      for (const parameter of parameters as { name: string; value: unknown }[]) {
        const override = overrides.get(parameter.name.toUpperCase());
        if (override !== undefined) {
          parameter.value = this.typedParamValue(override);
        }
      }
    }
    return parameters;
  }

  private dimensionsFor(model: ModelInfo): unknown[] {
    if (model.type !== "part") {
      return [];
    }
    const dimensions = [
      {
        id: 10,
        name: "d0",
        symbol: "d0",
        value: 120,
        dimensionType: "linear",
        isRelationDriven: false,
        isDesignated: true,
        isReference: false,
        tolerance: "plus_minus",
      },
      {
        id: 11,
        name: "d1",
        symbol: "d1",
        value: 60,
        dimensionType: "linear",
        isRelationDriven: true,
        isDesignated: false,
        isReference: false,
        tolerance: "symmetric",
      },
      {
        id: 12,
        name: "d2",
        symbol: "d2",
        value: 20,
        dimensionType: "diameter",
        isRelationDriven: false,
        isDesignated: false,
        isReference: false,
        tolerance: null,
      },
    ];
    const overrides = this.dimensionOverrides.get(model.name);
    if (overrides) {
      for (const dimension of dimensions as { id: number; value: number }[]) {
        const override = overrides.get(dimension.id);
        if (override !== undefined) dimension.value = override;
      }
    }
    return dimensions;
  }

  private featuresFor(model: ModelInfo): unknown[] {
    if (model.type === "assembly") {
      return this.applyFeatureOrder(model, [
        {
          id: 1,
          name: "GEARBOX",
          number: 1,
          type: "Component",
          status: "active",
          isVisible: true,
          isReadOnly: false,
          isGroupMember: false,
          isEmbedded: false,
          parentIds: [],
          childIds: [],
        },
        ...(this.createdFeatures.get(model.name) ?? []),
      ]);
    }
    const features = [
      {
        id: 1,
        number: 1,
        type: "Datum Plane",
        status: "active",
        isVisible: true,
        isReadOnly: false,
        isGroupMember: false,
        isEmbedded: false,
        parentIds: [],
        childIds: [2],
      },
      {
        id: 2,
        name: "Extrude 1",
        number: 2,
        type: "Protrusion",
        subType: "Extrude",
        status: "active",
        isVisible: true,
        isReadOnly: false,
        isGroupMember: false,
        isEmbedded: false,
        parentIds: [1],
        childIds: [3, 4],
      },
      {
        id: 3,
        name: "Hole 1",
        number: 3,
        type: "Hole",
        subType: "Simple",
        status: "active",
        isVisible: true,
        isReadOnly: false,
        isGroupMember: false,
        isEmbedded: false,
        parentIds: [2],
        childIds: [],
      },
      {
        id: 4,
        name: "Round 1",
        number: 4,
        type: "Round",
        status: "suppressed",
        isVisible: false,
        isReadOnly: false,
        isGroupMember: false,
        isEmbedded: false,
        parentIds: [2],
        childIds: [],
      },
    ];
    const suppressed = this.suppressedFeatures.get(model.name);
    const resumed = this.resumedFeatures.get(model.name);
    for (const feature of features as { id: number; status: string; isVisible: boolean }[]) {
      if (suppressed?.has(feature.id)) {
        feature.status = "suppressed";
        feature.isVisible = false;
      } else if (resumed?.has(feature.id)) {
        feature.status = "active";
        feature.isVisible = true;
      }
    }
    const deleted = this.deletedFeatures.get(model.name);
    const visible = [...features, ...(this.createdFeatures.get(model.name) ?? [])].filter(
      (feature) => !deleted?.has(Number((feature as { id?: number }).id)),
    );
    return this.applyFeatureOrder(model, visible);
  }

  private applyFeatureOrder(model: ModelInfo, features: unknown[]): unknown[] {
    const order = this.featureOrderOverrides.get(model.name);
    if (!order) return features;
    const byId = new Map(features.map((feature) => [Number((feature as { id?: number }).id), feature]));
    const ordered = order.map((id) => byId.get(id)).filter((feature): feature is unknown => feature !== undefined);
    const included = new Set(order);
    return [...ordered, ...features.filter((feature) => !included.has(Number((feature as { id?: number }).id)))];
  }

  private relationsFor(model: ModelInfo): string[] {
    if (model.type !== "part") {
      return [];
    }
    return ["HEIGHT = WIDTH / 2", "d1 = d0 / 2"];
  }

  private massPropertiesFor(model: ModelInfo): unknown {
    const base =
      model.type === "assembly"
        ? {
            volume: 5e5,
            surfaceArea: 2.2e4,
            density: 7.85e-9,
            mass: 0.0039,
          }
        : {
            volume: 2.88e5,
            surfaceArea: 1.45e4,
            density: 7.85e-9,
            mass: 0.0023,
          };
    const loss = this.volumeLoss.get(model.name) ?? 0;
    return { ...base, volume: base.volume - loss, gravityCenter: [0, 0, 6] };
  }

  private layersFor(model: ModelInfo): unknown[] {
    if (model.type !== "part") {
      return [];
    }
    return [
      {
        id: 1,
        name: "PRT_ALL",
        status: "normal",
        itemCount: 0,
        hasUnsupportedItems: false,
        unsupportedItemCount: 0,
      },
      {
        id: 2,
        name: "DTM",
        status: "display",
        itemCount: 1,
        hasUnsupportedItems: false,
        unsupportedItemCount: 0,
      },
      {
        id: 3,
        name: "HIDDEN_STUFF",
        status: "hidden",
        itemCount: 2,
        hasUnsupportedItems: true,
        unsupportedItemCount: 1,
      },
    ];
  }

  private familyTableFor(model: ModelInfo): unknown {
    if (model.name !== "BRACKET") {
      return null;
    }
    return {
      columns: [
        { symbol: "WIDTH", type: "dimension" },
        { symbol: "MATERIAL", type: "user_parameter" },
      ],
      rows: [
        {
          instanceName: "BRACKET_A",
          isLocked: false,
          isExtLocked: false,
          verifyStatus: "verified",
          cells: {
            WIDTH: { type: "double", value: 120 },
            MATERIAL: { type: "string", value: "STEEL" },
          },
        },
        {
          instanceName: "BRACKET_B",
          isLocked: true,
          isExtLocked: false,
          verifyStatus: "not_verified",
          cells: {
            WIDTH: { type: "double", value: 180 },
            MATERIAL: { type: "string", value: "ALUMINUM" },
          },
        },
      ],
    };
  }

  private activeModel(): ModelInfo | null {
    if (!this.activeModelName) {
      return null;
    }
    return (
      this.models.find((model) => model.name === this.activeModelName) ?? null
    );
  }

  private fakeExport(
    params: Record<string, unknown> | undefined,
    config: { kinds: string[] },
  ): Record<string, unknown> {
    this.requireConnected();
    const fileName = String(params?.["fileName"] ?? "");
    if (!fileName) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        "Export command requires a fileName parameter",
      );
    }
    const bareFileName = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/;
    if (!bareFileName.test(fileName) || fileName.includes("..")) {
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        `'${fileName}' is not a plain file name. Export tools only accept files that are direct children of Creo's live working directory; separators, '..', absolute paths, and UNC paths are rejected.`,
      );
    }
    const model = this.resolve(params);
    if (!config.kinds.includes(model.type)) {
      const allowed = config.kinds.join("/");
      throw new CreoMcpError(
        "INVALID_ARGUMENT",
        `Export requires a ${allowed} model; the active model is ${model.type}.`,
      );
    }
    const path = `${this.options.workingDirectory}\\${fileName}`;
    const pathKey = path.toLowerCase();
    const overwrite = params?.["overwrite"] === true;
    if (this.exportedFiles.has(pathKey) && !overwrite) {
      throw new CreoMcpError(
        "FILE_EXISTS",
        `'${fileName}' already exists in Creo's working directory. Pass overwrite=true to replace it.`,
        { details: { path } },
      );
    }
    this.exportedFiles.add(pathKey);
    const size =
      fileName.toLowerCase().endsWith(".stl") && params?.["mode"] === "binary"
        ? 4096
        : 1024 + fileName.length * 8;
    const out: Record<string, unknown> = {
      model,
      path,
      sizeBytes: size,
      verified: true,
    };
    return out;
  }

  private sessionInfo(): Record<string, unknown> {
    if (!this.connected) {
      return { connected: false };
    }
    return {
      connected: true,
      launched: false,
      creoVersion: this.options.creoVersion,
      workingDirectory: this.options.workingDirectory,
      activeModel: this.activeModel(),
      modelCount: this.models.length,
      models: this.models,
    };
  }
}
