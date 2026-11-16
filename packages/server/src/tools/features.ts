// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import {
  datumFeatureResultSchema,
  featureTreeResultSchema,
  modelMassPropertiesResultSchema,
  replicationFeatureResultSchema,
  solidFeatureResultSchema,
} from "../bridge/protocol.js";
import { CreoMcpError } from "../errors.js";
import {
  asString,
  ok,
  READ_ONLY_ANNOTATIONS,
  type ToolAnnotations,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./registry.js";

// Additive model writes: a new feature is appended and Creo can undo it, so
// these are not marked destructive even though cut=true removes material.
const FEATURE_WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const modelName = z
  .string()
  .optional()
  .describe("Model name, file name, or full name. Defaults to the active model.");

const sketchPlane = z
  .string()
  .min(1)
  .describe(
    "Datum plane to sketch on: its Creo feature name, e.g. TOP, FRONT, RIGHT, " +
      "or a custom datum plane name such as DTM1.",
  );

const orientRef = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional datum plane used as the sketch's up direction (e.g. FRONT when " +
      "sketching on TOP). Without it Creo picks the orientation itself.",
  );

const direction = z
  .enum(["sideOne", "sideTwo"])
  .optional()
  .describe("Which side of the sketch plane the feature grows to (default sideTwo).");

const featureName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .optional()
  .describe("Optional Creo feature name; paths and spaces are rejected.");

const section = z
  .array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("line"),
        x1: z.number().finite(),
        y1: z.number().finite(),
        x2: z.number().finite(),
        y2: z.number().finite(),
      }),
      z.object({
        type: z.literal("centerline"),
        x1: z.number().finite(),
        y1: z.number().finite(),
        x2: z.number().finite(),
        y2: z.number().finite(),
      }),
      z.object({
        type: z.literal("rectangle"),
        x1: z.number().finite(),
        y1: z.number().finite(),
        x2: z.number().finite(),
        y2: z.number().finite(),
      }),
      z.object({
        type: z.literal("circle"),
        x: z.number().finite(),
        y: z.number().finite(),
        radius: z.number().positive(),
      }),
      z.object({
        type: z.literal("arc"),
        x: z.number().finite(),
        y: z.number().finite(),
        radius: z.number().positive(),
        startAngle: z.number().finite().describe("Degrees."),
        endAngle: z.number().finite().describe("Degrees."),
      }),
      z.object({
        type: z.literal("point"),
        x: z.number().finite(),
        y: z.number().finite(),
      }),
      z.object({
        type: z.literal("ellipse"),
        x: z.number().finite(),
        y: z.number().finite(),
        xRadius: z.number().positive(),
        yRadius: z.number().positive(),
      }),
      z.object({
        type: z.literal("polyline"),
        points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2),
      }),
    ]),
  )
  .min(1)
  .describe(
    "2D sketch entities in sketch-plane coordinates (model units). Closed " +
      "loops add material; a revolve needs exactly one centerline entity to " +
      "act as its axis.",
  );

async function callFeature<T>(
  ctx: ToolContext,
  method: string,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  await ctx.ensureSession();
  return schema.parse(await ctx.bridge.call(method, params));
}

function baseFeatureParams(args: Record<string, unknown>): Record<string, unknown> {
  const name = asString(args["name"]);
  const orientRefValue = asString(args["orientRef"]);
  const featureNameValue = asString(args["featureName"]);
  const directionValue = args["direction"];
  const depth = args["depth"];
  const angle = args["angle"];
  return {
    ...(name ? { name } : {}),
    sketchPlane: String(args["sketchPlane"]),
    ...(typeof depth === "number" ? { depth } : {}),
    ...(typeof angle === "number" ? { angle } : {}),
    ...(orientRefValue ? { orientRef: orientRefValue } : {}),
    ...(directionValue === "sideOne"
      ? { direction: -1 }
      : directionValue === "sideTwo"
        ? { direction: 1 }
        : {}),
    ...(args["cut"] === true ? { removeMaterial: true } : {}),
    ...(args["symmetric"] === true ? { symmetric: true } : {}),
    ...(featureNameValue ? { featureName: featureNameValue } : {}),
    entities: args["section"],
  };
}

// Verification is readback-based: the created feature must exist, be active,
// and (for material-adding features) the model must report solid geometry.
function verifySolidFeature(
  result: Record<string, unknown>,
  cut: boolean,
  label: string,
): boolean {
  const feature = result["feature"] as
    | { id?: number; status?: string }
    | undefined;
  if (!feature || typeof feature.id !== "number" || feature.id <= 0) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} did not report a created feature id.`,
    );
  }
  if (feature.status !== undefined && feature.status !== "active") {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} left feature ${feature.id} in status '${feature.status}'.`,
      { details: { feature } },
    );
  }
  if (!cut) {
    const geometry = result["geometry"] as
      | { counts?: { surfaces?: number } }
      | undefined;
    if ((geometry?.counts?.surfaces ?? 0) <= 0) {
      throw new CreoMcpError(
        "VERIFY_FAILED",
        `${label} created feature ${feature.id} but the model reports no solid surfaces.`,
        { details: { geometry } },
      );
    }
  }
  return true;
}

function solidFeatureTool(
  name: string,
  title: string,
  method: string,
  description: string,
  extraInput: z.ZodRawShape,
): ToolDefinition {
  return {
    name,
    title,
    description: `${description} Blocked in read-only safety mode.`,
    inputSchema: {
      name: modelName,
      sketchPlane,
      orientRef,
      direction,
      cut: z
        .boolean()
        .optional()
        .describe("Remove material instead of adding it (default false)."),
      featureName,
      section,
      ...extraInput,
    },
    outputSchema: {
      model: z.unknown(),
      feature: z.unknown(),
      geometry: z.unknown().optional(),
      verified: z.boolean(),
    },
    annotations: FEATURE_WRITE_ANNOTATIONS,
    writeTool: true,
    handler: async (args, ctx): Promise<ToolResult> => {
      const result = await callFeature(
        ctx,
        method,
        baseFeatureParams(args),
        solidFeatureResultSchema,
      );
      const record = result as unknown as Record<string, unknown>;
      const verified = verifySolidFeature(record, args["cut"] === true, title);
      return ok({
        model: record["model"],
        feature: record["feature"],
        ...(record["geometry"] !== undefined
          ? { geometry: record["geometry"] }
          : {}),
        verified,
      });
    },
  };
}

const createExtrudeTool = solidFeatureTool(
  "creo_create_extrude",
  "Create Creo extrude",
  "feature.create_extrude",
  "Create a sketch-based extrude: sketch a 2D section on a datum plane and " +
    "extrude it to a blind depth. The part must already contain datum planes " +
    "(create it from a Creo template part). Set cut=true to remove material " +
    "instead of adding it.",
  {
    depth: z.number().positive().describe("Depth in model units."),
    symmetric: z
      .boolean()
      .optional()
      .describe(
        "Extrude half the depth to each side of the sketch plane " +
          "(default false). Use for mid-plane through cuts.",
      ),
  },
);

const createRevolveTool = solidFeatureTool(
  "creo_create_revolve",
  "Create Creo revolve",
  "feature.create_revolve",
  "Create a sketch-based revolve: the section must contain exactly one " +
    "centerline, which becomes the revolve axis. 360 degrees produces a full " +
    "revolution. Set cut=true to remove material instead of adding it.",
  {
    angle: z
      .number()
      .positive()
      .max(360)
      .optional()
      .describe("Revolve angle in degrees (default 360)."),
    symmetric: z
      .boolean()
      .optional()
      .describe("Revolve symmetrically about the sketch plane (default false)."),
  },
);

const edgeIds = z
  .array(z.number().int().positive())
  .min(1)
  .max(200)
  .describe(
    "Edge ids from creo_get_edges. Ids are session-scoped, so list the edges " +
      "again after any model change.",
  );

const surfaceIds = z
  .array(z.number().int().positive())
  .min(1)
  .max(200)
  .describe(
    "Surface (face) ids from creo_get_surfaces. Ids are session-scoped, so " +
      "list the surfaces again after any model change.",
  );

async function solidVolume(
  ctx: ToolContext,
  name: string | undefined,
): Promise<number> {
  const result = modelMassPropertiesResultSchema.parse(
    await ctx.bridge.call("model.mass_properties", name ? { name } : {}),
  );
  const volume = result.massProperties?.volume;
  if (typeof volume !== "number" || !(volume > 0)) {
    throw new CreoMcpError(
      "INVALID_ARGUMENT",
      "This feature needs an existing solid body with mass properties.",
      { details: { massProperties: result.massProperties } },
    );
  }
  return volume;
}

// Detail features (round, chamfer, shell) all remove material, so the model
// volume must strictly decrease. Verifying the delta catches a feature that
// was created but did not actually cut.
function verifyDetailFeature(
  result: Record<string, unknown>,
  beforeVolume: number,
  label: string,
): number {
  const feature = result["feature"] as
    | { id?: number; status?: string }
    | undefined;
  if (!feature || typeof feature.id !== "number" || feature.id <= 0) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} did not report a created feature id.`,
    );
  }
  if (feature.status !== undefined && feature.status !== "active") {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} left feature ${feature.id} in status '${feature.status}'.`,
      { details: { feature } },
    );
  }
  const geometry = result["geometry"] as
    | { counts?: { surfaces?: number } }
    | undefined;
  if ((geometry?.counts?.surfaces ?? 0) <= 0) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} created feature ${feature.id} but the model reports no solid surfaces.`,
      { details: { geometry } },
    );
  }
  const afterVolume = (result["massProperties"] as { volume?: number } | null)
    ?.volume;
  if (typeof afterVolume !== "number" || !(afterVolume < beforeVolume)) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} did not remove material (volume ${beforeVolume} -> ${String(
        afterVolume,
      )}).`,
      { details: { beforeVolume, afterVolume } },
    );
  }
  return beforeVolume - afterVolume;
}

function detailFeatureTool(
  name: string,
  title: string,
  method: string,
  description: string,
  buildParams: (args: Record<string, unknown>) => Record<string, unknown>,
  extraInput: z.ZodRawShape,
): ToolDefinition {
  return {
    name,
    title,
    description: `${description} Blocked in read-only safety mode.`,
    inputSchema: {
      name: modelName,
      featureName,
      ...extraInput,
    },
    outputSchema: {
      model: z.unknown(),
      feature: z.unknown(),
      geometry: z.unknown().optional(),
      volumeChange: z.number().optional(),
      request: z.unknown().optional(),
      verified: z.boolean(),
    },
    annotations: FEATURE_WRITE_ANNOTATIONS,
    writeTool: true,
    handler: async (args, ctx): Promise<ToolResult> => {
      await ctx.ensureSession();
      const modelNameValue = asString(args["name"]);
      const beforeVolume = await solidVolume(ctx, modelNameValue);
      const result = await callFeature(
        ctx,
        method,
        {
          ...(modelNameValue ? { name: modelNameValue } : {}),
          ...buildParams(args),
        },
        solidFeatureResultSchema,
      );
      const record = result as unknown as Record<string, unknown>;
      const volumeChange = verifyDetailFeature(record, beforeVolume, title);
      return ok({
        model: record["model"],
        feature: record["feature"],
        ...(record["geometry"] !== undefined
          ? { geometry: record["geometry"] }
          : {}),
        volumeChange,
        ...(record["request"] !== undefined
          ? { request: record["request"] }
          : {}),
        verified: true,
      });
    },
  };
}

const createRoundTool = detailFeatureTool(
  "creo_create_round",
  "Create Creo round",
  "feature.create_round",
  "Round a set of model edges with one constant radius. Get edge ids from " +
    "creo_get_edges. All supplied edges share the radius.",
  (args) => {
    const featureNameValue = asString(args["featureName"]);
    return {
      edgeIds: args["edgeIds"],
      radius: args["radius"],
      ...(featureNameValue ? { featureName: featureNameValue } : {}),
    };
  },
  {
    edgeIds,
    radius: z.number().positive().describe("Round radius in model units."),
  },
);

const createChamferTool = detailFeatureTool(
  "creo_create_chamfer",
  "Create Creo chamfer",
  "feature.create_chamfer",
  "Chamfer a set of model edges. With only 'distance' the chamfer is " +
    "symmetric; add 'distance2' for a D1 x D2 chamfer or 'angle' for an " +
    "angle x distance chamfer. Get edge ids from creo_get_edges.",
  (args) => {
    const featureNameValue = asString(args["featureName"]);
    const distance = Number(args["distance"]);
    const distance2 =
      typeof args["distance2"] === "number" ? Number(args["distance2"]) : 0;
    const angle = typeof args["angle"] === "number" ? Number(args["angle"]) : 0;
    const schema = distance2 > 0 ? 603 : angle > 0 ? 604 : 602;
    return {
      edgeIds: args["edgeIds"],
      schema,
      distance1: distance,
      ...(distance2 > 0 ? { distance2 } : {}),
      ...(angle > 0 ? { angle } : {}),
      ...(featureNameValue ? { featureName: featureNameValue } : {}),
    };
  },
  {
    edgeIds,
    distance: z
      .number()
      .positive()
      .describe("Distance from the edge in model units."),
    distance2: z
      .number()
      .positive()
      .optional()
      .describe("Second distance for a D1 x D2 chamfer."),
    angle: z
      .number()
      .positive()
      .max(180)
      .optional()
      .describe("Angle in degrees for an angle x distance chamfer."),
  },
);

const createShellTool = detailFeatureTool(
  "creo_create_shell",
  "Create Creo shell",
  "feature.create_shell",
  "Hollow the solid by removing the given faces, leaving a constant-thickness " +
    "wall. Get face ids from creo_get_surfaces. Set flip to reverse the " +
    "material side.",
  (args) => {
    const featureNameValue = asString(args["featureName"]);
    return {
      surfaceIds: args["surfaceIds"],
      thickness: args["thickness"],
      ...(args["flip"] === true ? { flip: true } : {}),
      ...(featureNameValue ? { featureName: featureNameValue } : {}),
    };
  },
  {
    surfaceIds,
    thickness: z
      .number()
      .positive()
      .describe("Wall thickness in model units."),
    flip: z
      .boolean()
      .optional()
      .describe("Flip the shell material side (default false)."),
  },
);

const getFeatureTreeTool: ToolDefinition = {
  name: "creo_get_feature_tree",
  title: "Get Creo feature element tree",
  description:
    "Read a feature's OTK element tree: element ids, levels, values, and " +
    "reference selections. Use it to learn the exact payload Creo stores for " +
    "a native feature before authoring new geometry. The read-only operation " +
    "never writes the XML form to disk.",
  inputSchema: {
    name: modelName,
    featureId: z.number().int().positive(),
  },
  outputSchema: {
    model: z.unknown(),
    feature: z.unknown(),
    elementCount: z.number(),
    elements: z.array(z.unknown()),
    xml: z.unknown().optional(),
  },
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async (args, ctx): Promise<ToolResult> => {
    const name = asString(args["name"]);
    const result = await callFeature(
      ctx,
      "feature.tree",
      {
        ...(name ? { name } : {}),
        featureId: args["featureId"],
        includeXml: false,
      },
      featureTreeResultSchema,
    );
    const record = result as unknown as Record<string, unknown>;
    return ok({
      model: record["model"],
      feature: record["feature"],
      elementCount: record["elementCount"],
      elements: record["elements"],
      ...(record["xml"] !== undefined ? { xml: record["xml"] } : {}),
    });
  },
};

// A reference to a datum plane, solid face, or edge. A string is a datum plane
// feature name (TOP, FRONT, DTM1, ...); the object forms take ids from
// creo_get_surfaces / creo_get_edges.
const referenceInput = z.union([
  z
    .string()
    .min(1)
    .describe("Datum plane feature name, e.g. TOP, FRONT, RIGHT, or DTM1."),
  z.object({ surfaceId: z.number().int().positive() }).describe("PRO_SURFACE id."),
  z.object({ featureId: z.number().int().positive() }).describe("Datum plane feature id."),
  z.object({ edgeId: z.number().int().positive() }).describe("PRO_EDGE id."),
]);

const axisInput = z.union([
  z.string().min(1).describe("Datum axis feature name, e.g. A_1."),
  z.object({ axisId: z.number().int().positive() }).describe("PRO_AXIS item id."),
  z.object({ featureId: z.number().int().positive() }).describe("Datum axis feature id."),
]);

const patternReferenceInput = z.union([
  z.string().min(1).describe("Datum plane or datum axis feature name."),
  z.object({ surfaceId: z.number().int().positive() }).describe("Planar surface id."),
  z.object({ featureId: z.number().int().positive() }).describe("Datum feature id."),
  z.object({ edgeId: z.number().int().positive() }).describe("Linear edge id."),
  z.object({ axisId: z.number().int().positive() }).describe("Datum axis item id."),
  z.object({ axisFeatureId: z.number().int().positive() }).describe("Datum axis feature id."),
]);

function assignReference(
  params: Record<string, unknown>,
  fields: {
    name: string;
    surfaceId: string;
    featureId?: string;
    edgeId?: string;
  },
  value: unknown,
): void {
  if (typeof value === "string") {
    params[fields.name] = value;
    return;
  }
  const record = value as { surfaceId?: number; featureId?: number; edgeId?: number };
  if (typeof record.surfaceId === "number") {
    params[fields.surfaceId] = record.surfaceId;
  }
  if (typeof record.featureId === "number" && fields.featureId) {
    params[fields.featureId] = record.featureId;
  }
  if (typeof record.edgeId === "number" && fields.edgeId) {
    params[fields.edgeId] = record.edgeId;
  }
}

function verifyDatumFeature(
  result: Record<string, unknown>,
  kind: "plane" | "axis" | "point",
  label: string,
): void {
  const feature = result["feature"] as
    | { id?: number; status?: string }
    | undefined;
  if (!feature || typeof feature.id !== "number" || feature.id <= 0) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} did not report a created feature id.`,
    );
  }
  if (feature.status !== undefined && feature.status !== "active") {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} left feature ${feature.id} in status '${feature.status}'.`,
      { details: { feature } },
    );
  }
  const datum = result["datum"] as Record<string, unknown> | undefined;
  const idField =
    kind === "plane" ? "surfaceId" : kind === "axis" ? "axisId" : "pointId";
  const id = datum?.[idField];
  if (typeof id !== "number" || id <= 0) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} created feature ${feature.id} but its datum has no resolvable ${idField}.`,
      { details: { feature, datum } },
    );
  }
}

function datumTool(
  name: string,
  title: string,
  method: string,
  kind: "plane" | "axis" | "point",
  description: string,
  inputSchema: z.ZodRawShape,
  buildParams: (args: Record<string, unknown>) => Record<string, unknown>,
): ToolDefinition {
  return {
    name,
    title,
    description: `${description} Blocked in read-only safety mode.`,
    inputSchema: {
      name: modelName,
      featureName,
      ...inputSchema,
    },
    outputSchema: {
      model: z.unknown(),
      feature: z.unknown(),
      datum: z.unknown().optional(),
      geometry: z.unknown().optional(),
      request: z.unknown().optional(),
      verified: z.boolean(),
    },
    annotations: FEATURE_WRITE_ANNOTATIONS,
    writeTool: true,
    handler: async (args, ctx): Promise<ToolResult> => {
      await ctx.ensureSession();
      const modelNameValue = asString(args["name"]);
      const result = await callFeature(
        ctx,
        method,
        {
          ...(modelNameValue ? { name: modelNameValue } : {}),
          ...buildParams(args),
        },
        datumFeatureResultSchema,
      );
      const record = result as unknown as Record<string, unknown>;
      verifyDatumFeature(record, kind, title);
      return ok({
        model: record["model"],
        feature: record["feature"],
        ...(record["datum"] !== undefined ? { datum: record["datum"] } : {}),
        ...(record["geometry"] !== undefined
          ? { geometry: record["geometry"] }
          : {}),
        ...(record["request"] !== undefined
          ? { request: record["request"] }
          : {}),
        verified: true,
      });
    },
  };
}

const createDatumPlaneTool = datumTool(
  "creo_create_datum_plane",
  "Create Creo datum plane",
  "feature.create_datum_plane",
  "plane",
  "Create a datum plane by offsetting an existing datum plane, or as a " +
    "reference plane through it. Use the created plane's name or surfaceId " +
    "as a sketchPlane in later feature calls.",
  {
    type: z
      .enum(["offset", "through"])
      .describe(
        "offset: a plane at 'distance' from the reference plane; through: a " +
          "plane that contains the reference plane.",
      ),
    reference: referenceInput.describe(
      "Reference plane to offset from or pass through.",
    ),
    distance: z
      .number()
      .finite()
      .optional()
      .describe("Offset distance in model units (required for offset; may be negative)."),
    flip: z
      .boolean()
      .optional()
      .describe("Flip the plane normal (default false)."),
  },
  (args) => {
    const featureNameValue = asString(args["featureName"]);
    const type = args["type"];
    const params: Record<string, unknown> = { type };
    assignReference(params, { name: "reference", surfaceId: "referenceSurfaceId", featureId: "referenceFeatureId", edgeId: "referenceEdgeId" }, args["reference"]);
    if (type === "offset") {
      if (typeof args["distance"] !== "number") {
        throw new CreoMcpError(
          "INVALID_ARGUMENT",
          "An offset datum plane requires a distance.",
        );
      }
      params["distance"] = args["distance"];
    }
    if (args["flip"] === true) {
      params["flip"] = true;
    }
    if (featureNameValue) {
      params["featureName"] = featureNameValue;
    }
    return params;
  },
);

const createDatumAxisTool = datumTool(
  "creo_create_datum_axis",
  "Create Creo datum axis",
  "feature.create_datum_axis",
  "axis",
  "Create a datum axis through two datum planes, along a straight edge, or " +
    "along the axis of a cylindrical face. Coaxial holes use the returned " +
    "axis name or axisId.",
  {
    type: z
      .enum(["twoPlanes", "edge", "surface"])
      .describe(
        "twoPlanes: intersection of two planes; edge: along a straight edge; " +
          "surface: the axis of a cylindrical face.",
      ),
    plane1: referenceInput.optional().describe("First plane (twoPlanes)."),
    plane2: referenceInput.optional().describe("Second plane (twoPlanes)."),
    edgeId: z.number().int().positive().optional().describe("Straight edge id (edge)."),
    surfaceId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cylindrical face id from creo_get_surfaces (surface)."),
  },
  (args) => {
    const featureNameValue = asString(args["featureName"]);
    const type = args["type"];
    const params: Record<string, unknown> = { type };
    if (type === "twoPlanes") {
      if (args["plane1"] === undefined || args["plane2"] === undefined) {
        throw new CreoMcpError(
          "INVALID_ARGUMENT",
          "A two-plane datum axis requires plane1 and plane2.",
        );
      }
      assignReference(params, { name: "plane1", surfaceId: "plane1SurfaceId", featureId: "plane1FeatureId" }, args["plane1"]);
      assignReference(params, { name: "plane2", surfaceId: "plane2SurfaceId", featureId: "plane2FeatureId" }, args["plane2"]);
    } else if (type === "edge") {
      if (typeof args["edgeId"] !== "number") {
        throw new CreoMcpError(
          "INVALID_ARGUMENT",
          "An edge datum axis requires edgeId.",
        );
      }
      params["edgeId"] = args["edgeId"];
    } else if (type === "surface") {
      if (typeof args["surfaceId"] !== "number") {
        throw new CreoMcpError(
          "INVALID_ARGUMENT",
          "A surface datum axis requires surfaceId.",
        );
      }
      params["surfaceId"] = args["surfaceId"];
    }
    if (featureNameValue) {
      params["featureName"] = featureNameValue;
    }
    return params;
  },
);

const createDatumPointTool = datumTool(
  "creo_create_datum_point",
  "Create Creo datum point",
  "feature.create_datum_point",
  "point",
  "Create a datum point on an edge, either at a ratio along it (0 = start, " +
    "1 = end) or at its center. The returned pointId can seed datum axes.",
  {
    type: z
      .enum(["onEdge", "edgeCenter"])
      .describe("onEdge: a ratio along the edge; edgeCenter: the edge midpoint."),
    edgeId: z.number().int().positive().describe("Edge id from creo_get_edges."),
    ratio: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Position along the edge for onEdge (default 0.5)."),
  },
  (args) => {
    const featureNameValue = asString(args["featureName"]);
    const params: Record<string, unknown> = {
      type: args["type"],
      edgeId: args["edgeId"],
    };
    if (args["type"] === "onEdge" && typeof args["ratio"] === "number") {
      params["ratio"] = args["ratio"];
    }
    if (featureNameValue) {
      params["featureName"] = featureNameValue;
    }
    return params;
  },
);

const holePlacement = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("linear"),
    surface: referenceInput.describe(
      "Planar face (or datum plane) the hole starts from.",
    ),
    ref1: referenceInput.describe(
      "First dimension reference: a plane, face, or straight edge.",
    ),
    offset1: z.number().finite().describe("Distance from ref1 in model units."),
    ref2: referenceInput.describe("Second dimension reference."),
    offset2: z.number().finite().describe("Distance from ref2 in model units."),
  }),
  z.object({
    type: z.literal("coaxial"),
    axis: axisInput.describe("Datum axis the hole is concentric with."),
    surface: referenceInput.describe(
      "Entry face (or datum plane) the hole starts from; must intersect the axis.",
    ),
  }),
]);

const holeDepth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("blind"), value: z.number().positive() }),
  z.object({ type: z.literal("through") }),
  z.object({
    type: z.literal("symmetric"),
    value: z.number().positive().describe("Total depth, split around the placement face."),
  }),
]);

const holeHead = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("counterbore"),
    diameter: z.number().positive(),
    depth: z.number().positive(),
  }),
  z.object({
    type: z.literal("countersink"),
    diameter: z.number().positive(),
    angle: z.number().positive().max(180).describe("Included angle in degrees."),
  }),
]);

const createHoleTool: ToolDefinition = {
  name: "creo_create_hole",
  title: "Create Creo hole",
  description:
    "Drill a straight hole into an existing solid: linear placement on a " +
    "face with two offsets, or coaxial with a datum axis. Depth is blind, " +
    "through, or symmetric; an optional counterbore or countersink head is " +
    "cut in the same feature. Verified by a strict volume decrease. Blocked " +
    "in read-only safety mode.",
  inputSchema: {
    name: modelName,
    featureName,
    placement: holePlacement,
    diameter: z.number().positive().describe("Hole diameter in model units."),
    depth: holeDepth,
    head: holeHead
      .optional()
      .describe("Optional counterbore or countersink head."),
    drillAngle: z
      .number()
      .positive()
      .max(180)
      .optional()
      .describe("Drill point angle in degrees for blind holes (default 118)."),
  },
  outputSchema: {
    model: z.unknown(),
    feature: z.unknown(),
    geometry: z.unknown().optional(),
    volumeChange: z.number().optional(),
    request: z.unknown().optional(),
    verified: z.boolean(),
  },
  annotations: FEATURE_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const modelNameValue = asString(args["name"]);
    const featureNameValue = asString(args["featureName"]);
    const placement = args["placement"] as Record<string, unknown>;
    const depth = args["depth"] as Record<string, unknown>;
    const head = args["head"] as Record<string, unknown> | undefined;
    const params: Record<string, unknown> = {
      placement: placement["type"],
      diameter: args["diameter"],
      depth: depth["type"],
    };
    if (depth["type"] !== "through") {
      params["depthValue"] = depth["value"];
    }
    if (placement["type"] === "linear") {
      assignReference(params, { name: "plane", surfaceId: "planeSurfaceId", featureId: "planeFeatureId" }, placement["surface"]);
      assignReference(params, { name: "ref1", surfaceId: "ref1SurfaceId", featureId: "ref1FeatureId", edgeId: "ref1EdgeId" }, placement["ref1"]);
      assignReference(params, { name: "ref2", surfaceId: "ref2SurfaceId", featureId: "ref2FeatureId", edgeId: "ref2EdgeId" }, placement["ref2"]);
      params["offset1"] = placement["offset1"];
      params["offset2"] = placement["offset2"];
    } else {
      const axisValue = placement["axis"];
      if (typeof axisValue === "string") {
        params["axis"] = axisValue;
      } else {
        const axisRecord = axisValue as { axisId?: number; featureId?: number };
        if (typeof axisRecord.axisId === "number") {
          params["axisId"] = axisRecord.axisId;
        } else if (typeof axisRecord.featureId === "number") {
          params["axisFeatureId"] = axisRecord.featureId;
        }
      }
      if (placement["surface"] !== undefined) {
        assignReference(params, { name: "plane", surfaceId: "planeSurfaceId", featureId: "planeFeatureId" }, placement["surface"]);
      }
    }
    if (head) {
      params["head"] = head["type"];
      params["headDiameter"] = head["diameter"];
      if (head["type"] === "counterbore") {
        params["headDepth"] = head["depth"];
      } else {
        params["headAngle"] = head["angle"];
      }
    }
    if (typeof args["drillAngle"] === "number") {
      params["drillAngle"] = args["drillAngle"];
    }
    if (featureNameValue) {
      params["featureName"] = featureNameValue;
    }

    const beforeVolume = await solidVolume(ctx, modelNameValue);
    const result = await callFeature(
      ctx,
      "feature.create_hole",
      {
        ...(modelNameValue ? { name: modelNameValue } : {}),
        ...params,
      },
      solidFeatureResultSchema,
    );
    const record = result as unknown as Record<string, unknown>;
    const volumeChange = verifyDetailFeature(record, beforeVolume, "creo_create_hole");
    return ok({
      model: record["model"],
      feature: record["feature"],
      ...(record["geometry"] !== undefined
        ? { geometry: record["geometry"] }
        : {}),
      volumeChange,
      ...(record["request"] !== undefined
        ? { request: record["request"] }
        : {}),
      verified: true,
    });
  },
};

type PatternReference =
  | string
  | { surfaceId?: number; featureId?: number; edgeId?: number; axisId?: number; axisFeatureId?: number };

function patternReferenceParams(reference: PatternReference): unknown {
  return reference;
}

function verifyReplication(
  result: Record<string, unknown>,
  expectedInstances: number,
  label: string,
): void {
  const feature = result["feature"] as
    | { id?: number; status?: string }
    | undefined;
  if (!feature || typeof feature.id !== "number" || feature.id <= 0) {
    throw new CreoMcpError("VERIFY_FAILED", `${label} did not report a created feature id.`);
  }
  if (feature.status !== undefined && feature.status !== "active") {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} left feature ${feature.id} in status '${feature.status}'.`,
      { details: { feature } },
    );
  }
  const instanceCount = result["instanceCount"];
  if (typeof instanceCount !== "number" || instanceCount !== expectedInstances) {
    throw new CreoMcpError(
      "VERIFY_FAILED",
      `${label} expected ${expectedInstances} instances but Creo read back ${String(instanceCount)}.`,
      { details: { expectedInstances, instanceCount, members: result["members"] } },
    );
  }
}

const createPatternTool: ToolDefinition = {
  name: "creo_create_pattern",
  title: "Create Creo pattern",
  description:
    "Replicate a seed feature with a linear (one/two direction) or angular " +
    "datum-axis pattern. Direction references may be datum planes, edges, or " +
    "axes; refresh session-scoped ids after model changes. Verified by Creo " +
    "pattern-member readback. Blocked in read-only safety mode.",
  inputSchema: {
    name: modelName,
    featureName,
    seedFeatureId: z.number().int().positive(),
    type: z.enum(["linear", "axis"]),
    direction1: z.object({
      reference: patternReferenceInput,
      count: z.number().int().min(2).max(200),
      spacing: z.number().finite().refine((value) => value !== 0),
      flip: z.boolean().optional(),
    }).optional(),
    direction2: z.object({
      reference: patternReferenceInput,
      count: z.number().int().min(2).max(200),
      spacing: z.number().finite().refine((value) => value !== 0),
      flip: z.boolean().optional(),
    }).optional(),
    axis: patternReferenceInput.optional(),
    count: z.number().int().min(2).max(200).optional(),
    angle: z.number().positive().max(360).optional().describe("Angular increment in degrees."),
    flip: z.boolean().optional(),
  },
  outputSchema: {
    model: z.unknown(),
    feature: z.unknown(),
    seedFeatureId: z.number(),
    members: z.array(z.unknown()),
    memberCount: z.number(),
    instanceCount: z.number(),
    verified: z.boolean(),
  },
  annotations: FEATURE_WRITE_ANNOTATIONS,
  writeTool: true,
  handler: async (args, ctx): Promise<ToolResult> => {
    await ctx.ensureSession();
    const modelNameValue = asString(args["name"]);
    const params: Record<string, unknown> = {
      ...(modelNameValue ? { name: modelNameValue } : {}),
      seedFeatureId: args["seedFeatureId"],
      type: args["type"],
    };
    const featureNameValue = asString(args["featureName"]);
    if (featureNameValue) params["featureName"] = featureNameValue;
    let expectedInstances: number;
    if (args["type"] === "linear") {
      const first = args["direction1"] as Record<string, unknown> | undefined;
      if (!first) {
        throw new CreoMcpError("INVALID_ARGUMENT", "A linear pattern requires direction1.");
      }
      const firstParams: Record<string, unknown> = {
        count: first["count"],
        spacing: first["spacing"],
        ...(first["flip"] === true ? { flip: true } : {}),
      };
      firstParams["reference"] = first["reference"];
      params["direction1"] = firstParams;
      const second = args["direction2"] as Record<string, unknown> | undefined;
      if (second) {
        const secondParams: Record<string, unknown> = {
          count: second["count"],
          spacing: second["spacing"],
          ...(second["flip"] === true ? { flip: true } : {}),
        };
        secondParams["reference"] = second["reference"];
        params["direction2"] = secondParams;
        expectedInstances = Number(first["count"]) * Number(second["count"]);
      } else {
        expectedInstances = Number(first["count"]);
      }
    } else {
      const axis = args["axis"] as PatternReference | undefined;
      const count = args["count"];
      const angle = args["angle"];
      if (axis === undefined || typeof count !== "number" || typeof angle !== "number") {
        throw new CreoMcpError("INVALID_ARGUMENT", "An axis pattern requires axis, count, and angle.");
      }
      params["axis"] = patternReferenceParams(axis);
      params["count"] = count;
      params["angle"] = angle;
      if (args["flip"] === true) params["flip"] = true;
      expectedInstances = count;
    }
    const result = replicationFeatureResultSchema.parse(
      await ctx.bridge.call("feature.create_pattern", params),
    );
    const record = result as unknown as Record<string, unknown>;
    verifyReplication(record, expectedInstances, "creo_create_pattern");
    return ok({
      model: record["model"],
      feature: record["feature"],
      seedFeatureId: record["seedFeatureId"],
      members: record["members"] ?? [],
      memberCount: record["memberCount"] ?? 0,
      instanceCount: record["instanceCount"],
      verified: true,
    });
  },
};

export function featureTools(): ToolDefinition[] {
  return [
    createExtrudeTool,
    createRevolveTool,
    createRoundTool,
    createChamferTool,
    createShellTool,
    createDatumPlaneTool,
    createDatumAxisTool,
    createDatumPointTool,
    createHoleTool,
    createPatternTool,
    getFeatureTreeTool,
  ];
}
