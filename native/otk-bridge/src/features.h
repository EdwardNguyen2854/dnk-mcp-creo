// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "util.h"

#include <string>
#include <vector>

#include <pfcModel.h>
#include <pfcSession.h>

namespace creo {

// Read-only introspection of a feature's OTK element tree.
//
// wfcWSolid::WCreateFeature / wfcWFeature::RedefineFeature consume an element
// tree; dumping a native feature's tree is how the TypeScript layer learns the
// exact element ids, levels, and reference payloads Creo 9 expects before it
// authors new geometry. This primitive performs no mutation.

nlohmann::json describeFeatureTree(pfcSession_ptr session, pfcModel_ptr model,
                                   int featureId, bool includeXml, int maxChars);

// A sketch-based solid feature request (extrude or revolve). The sketch plane
// and (optional) orientation reference are resolved to the datum plane's
// PRO_SURFACE item, which is what PRO_E_STD_SEC_PLANE stores. Section entities
// are given in sketch-plane 2D coordinates; arc angles are degrees. A revolve
// uses the section's centerline as its axis (internal reference). This
// primitive performs the OTK operation and returns fresh readback; guards live
// in TypeScript.
struct SolidFeatureRequest {
  std::string kind = "extrude";       // "extrude" or "revolve"
  std::string sketchPlane;            // datum plane feature name, e.g. "TOP"
  int sketchPlaneSurfaceId = -1;      // explicit PRO_SURFACE id (alternative)
  int sketchPlaneFeatureId = -1;      // explicit datum plane feature id (alternative)
  std::string orientRef;              // optional datum plane name for sketch up
  int orientRefSurfaceId = -1;        // explicit PRO_SURFACE id (alternative)
  int orientRefFeatureId = -1;        // explicit datum plane feature id (alternative)
  double depth = 0.0;                 // extrude blind depth, model units
  double angle = 360.0;               // revolve angle, degrees
  bool symmetric = false;             // revolve symmetrically about the sketch
  int direction = 1;                  // 1 = side two, -1 = side one
  bool removeMaterial = false;        // false = protrusion, true = cut
  std::string featureName;            // optional explicit feature name
  nlohmann::json entities;            // section entities (validated here)
};

nlohmann::json createSolidFeature(pfcModel_ptr model,
                                  const SolidFeatureRequest& request);

// A constant-radius round on a set of edges. Edges are addressed by their
// PRO_EDGE ids (see describeEdges / the model.edges command). All edges share
// one radius; Creo stores them as one curve-collection set.
struct RoundFeatureRequest {
  std::string featureName;            // optional explicit feature name
  std::vector<int> edgeIds;           // PRO_EDGE ids, at least one
  double radius = 0.0;                // round radius, model units
};

nlohmann::json createRoundFeature(pfcModel_ptr model,
                                  const RoundFeatureRequest& request);

// A chamfer on a set of edges. schema selects the dimension scheme:
// 601 = 45 x D (equal legs), 602 = D x D, 603 = D1 x D2, 604 = ANG x D.
struct ChamferFeatureRequest {
  std::string featureName;            // optional explicit feature name
  std::vector<int> edgeIds;           // PRO_EDGE ids, at least one
  int schema = 601;                   // ProChmSchema value
  double distance1 = 0.0;             // leg 1 (all schemes)
  double distance2 = 0.0;             // leg 2 for D1 x D2
  double angle = 0.0;                 // angle for ANG x D, degrees
};

nlohmann::json createChamferFeature(pfcModel_ptr model,
                                    const ChamferFeatureRequest& request);

// A constant-thickness shell that removes the given faces. Faces are PRO_SURFACE
// ids (see describeSurfaces / the model.surfaces command).
struct ShellFeatureRequest {
  std::string featureName;            // optional explicit feature name
  std::vector<int> surfaceIds;        // PRO_SURFACE ids, at least one
  double thickness = 0.0;             // wall thickness, model units
  bool flip = false;                  // flip the material side
};

nlohmann::json createShellFeature(pfcModel_ptr model,
                                  const ShellFeatureRequest& request);

// A datum plane feature (PRO_FEAT_DATUM). The constraint is expressed the way
// Creo stores it: type (offset/through) plus a plane reference and, where
// applicable, a distance. Only datum planes and flat solid faces are accepted
// as references; the reference resolves to the plane's PRO_SURFACE item, the
// same selection the feature stores. Angle/parallel constraints (and the
// `about`/`angle` fields below) are planned but rejected until their payloads
// are settled against native fixture trees.
struct DatumPlaneRequest {
  std::string featureName;            // optional explicit feature name
  std::string type;                   // "offset" | "through"
  std::string reference;              // datum plane feature name
  int referenceSurfaceId = -1;        // explicit PRO_SURFACE id (alternative)
  int referenceFeatureId = -1;        // explicit feature id (alternative)
  int referenceEdgeId = -1;           // through: straight edge (alternative)
  std::string about;                  // reserved (angle/parallel)
  int aboutSurfaceId = -1;            // reserved (angle/parallel)
  int aboutFeatureId = -1;            // reserved (angle/parallel)
  double distance = 0.0;              // offset distance, model units
  double angle = 0.0;                 // reserved (angle)
  bool flip = false;                  // flip the plane normal
};

nlohmann::json createDatumPlaneFeature(pfcModel_ptr model,
                                       const DatumPlaneRequest& request);

// A datum axis feature (PRO_FEAT_DATUM_AXIS): through two planes, through a
// straight edge, or along the axis of a cylindrical surface.
struct DatumAxisRequest {
  std::string featureName;            // optional explicit feature name
  std::string type;                   // "twoPlanes" | "edge" | "surface" | "twoPoints"
  std::string plane1;                 // twoPlanes: first datum plane name
  std::string plane2;                 // twoPlanes: second datum plane name
  int plane1SurfaceId = -1;
  int plane2SurfaceId = -1;
  int plane1FeatureId = -1;
  int plane2FeatureId = -1;
  int edgeId = -1;                    // edge: PRO_EDGE id
  int surfaceId = -1;                 // surface: cylindrical PRO_SURFACE id
  int point1Id = -1;                  // twoPoints: PRO_POINT ids
  int point2Id = -1;
};

nlohmann::json createDatumAxisFeature(pfcModel_ptr model,
                                      const DatumAxisRequest& request);

// A datum point feature (PRO_FEAT_DATUM_POINT). Placement mirrors Creo's
// general point: on a surface, on an edge (ratio along the curve), or at an
// edge/curve endpoint.
struct DatumPointRequest {
  std::string featureName;            // optional explicit feature name
  std::string type;                   // "onSurface" | "onEdge" | "edgeCenter"
  int surfaceId = -1;                 // onSurface: PRO_SURFACE id
  int edgeId = -1;                    // onEdge / edgeCenter: PRO_EDGE id
  double ratio = 0.5;                 // onEdge: 0..1 along the edge
};

nlohmann::json createDatumPointFeature(pfcModel_ptr model,
                                       const DatumPointRequest& request);

// A straight hole feature (PRO_FEAT_HOLE, form PRO_HLE_TYPE_STRAIGHT). The
// placement is either linear on a plane (two dimension references) or coaxial
// on an axis. Depth is blind, through-all, or symmetric; an optional
// counterbore/countersink head switches the feature to the custom-hole form.
struct HoleFeatureRequest {
  std::string featureName;            // optional explicit feature name
  std::string placement;              // "linear" | "coaxial"
  // linear: placement plane
  std::string plane;                  // datum plane name
  int planeSurfaceId = -1;
  int planeFeatureId = -1;
  // linear: two dimension references (datum plane name, surface id, or edge id)
  std::string ref1;
  std::string ref2;
  int ref1SurfaceId = -1, ref1FeatureId = -1, ref1EdgeId = -1;
  int ref2SurfaceId = -1, ref2FeatureId = -1, ref2EdgeId = -1;
  double offset1 = 0.0;
  double offset2 = 0.0;
  // coaxial: datum axis feature name or explicit axis item id
  std::string axis;
  int axisId = -1;
  int axisFeatureId = -1;
  // shape
  double diameter = 0.0;
  std::string depth;                  // "blind" | "through" | "symmetric"
  double depthValue = 0.0;
  std::string head;                   // "" | "counterbore" | "countersink"
  double headDiameter = 0.0;
  double headDepth = 0.0;             // counterbore
  double headAngle = 0.0;             // countersink, degrees
  double drillAngle = 118.0;          // drill point angle, degrees
};

nlohmann::json createHoleFeature(pfcModel_ptr model,
                                 const HoleFeatureRequest& request);

// A pattern reference may be a datum plane/surface, edge, or datum axis. The
// string form is resolved by name; the explicit ids are session-scoped ids
// returned by the read tools. Keeping the reference fields separate mirrors
// the other feature requests and avoids guessing which model-item type an id
// belongs to.
struct PatternReferenceRequest {
  std::string name;
  int surfaceId = -1;
  int featureId = -1;
  int edgeId = -1;
  int axisId = -1;
  int axisFeatureId = -1;
};

struct PatternDirectionRequest {
  PatternReferenceRequest reference;
  int count = 0;
  double spacing = 0.0;
  bool flip = false;
};

// Direction-driven linear patterns and axis-driven angular patterns use the
// native wfcWFeature::CreatePattern operation on the seed feature. A second
// linear direction is optional; axis angle is the increment in degrees.
struct PatternFeatureRequest {
  std::string featureName;
  int seedFeatureId = -1;
  std::string type;  // "linear" | "axis"
  PatternDirectionRequest direction1;
  PatternDirectionRequest direction2;
  bool hasDirection2 = false;
  PatternReferenceRequest axis;
  int axisCount = 0;
  double axisAngle = 0.0;
  bool axisFlip = false;
};

nlohmann::json createPatternFeature(pfcModel_ptr model,
                                    const PatternFeatureRequest& request);

struct MirrorFeatureRequest {
  std::string featureName;
  std::vector<int> featureIds;
  PatternReferenceRequest plane;
};

nlohmann::json createMirrorFeature(pfcModel_ptr model,
                                   const MirrorFeatureRequest& request);

}  // namespace creo
