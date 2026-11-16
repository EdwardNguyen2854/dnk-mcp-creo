// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "features.h"

#include "modeling.h"
#include "read.h"

#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>

#include <cmath>

#include <pfcExceptions.h>
#include <pfcFeature.h>
#include <pfcGeometry.h>
#include <pfcModelItem.h>
#include <pfcSelect.h>
#include <pfcSolid.h>
#include <wfcCollection.h>
#include <wfcElemIds.h>
#include <wfcElementTree.h>
#include <wfcFeature.h>
#include <wfcFeatureInstructions.h>
#include <wfcGlobal.h>
#include <wfcSection.h>
#include <wfcSession.h>
#include <wfcSolid.h>
#include <wfcSolidInstructions.h>

namespace creo {

namespace {

const char* featureStatusName(pfcFeatureStatus status) {
  switch (status) {
    case pfcFEAT_ACTIVE:
      return "active";
    case pfcFEAT_INACTIVE:
      return "inactive";
    case pfcFEAT_FAMILY_TABLE_SUPPRESSED:
      return "family_table_suppressed";
    case pfcFEAT_SIMP_REP_SUPPRESSED:
      return "simplified_rep_suppressed";
    case pfcFEAT_PROGRAM_SUPPRESSED:
      return "program_suppressed";
    case pfcFEAT_SUPPRESSED:
      return "suppressed";
    case pfcFEAT_UNREGENERATED:
      return "unregenerated";
    default:
      return "unknown";
  }
}

const char* modelItemTypeName(pfcModelItemType type) {
  switch (type) {
    case pfcITEM_FEATURE:
      return "feature";
    case pfcITEM_SURFACE:
      return "surface";
    case pfcITEM_EDGE:
      return "edge";
    case pfcITEM_COORD_SYS:
      return "coord_sys";
    case pfcITEM_AXIS:
      return "axis";
    case pfcITEM_POINT:
      return "point";
    case pfcITEM_QUILT:
      return "quilt";
    case pfcITEM_CURVE:
      return "curve";
    case pfcITEM_LAYER:
      return "layer";
    case pfcITEM_DIMENSION:
      return "dimension";
    case pfcITEM_REF_DIMENSION:
      return "ref_dimension";
    case pfcITEM_SOLID_GEOMETRY:
      return "solid_geometry";
    case pfcITEM_BODY:
      return "body";
    default:
      return "unknown";
  }
}

nlohmann::json describeSelection(pfcSelection_ptr selection) {
  nlohmann::json out;
  if (!selection) {
    return out;
  }
  pfcModelItem_ptr item;
  try {
    item = selection->GetSelItem();
  }
  xcatchbegin
    xcatchall { item = nullptr; }
  xcatchend
  catch (...) {
    item = nullptr;
  }
  if (!item) {
    return out;
  }
  out["itemType"] = static_cast<int>(item->GetType());
  out["itemTypeName"] = modelItemTypeName(item->GetType());
  out["itemId"] = static_cast<int>(item->GetId());
  return out;
}

nlohmann::json describeSelectionValue(pfcArgValue_ptr value) {
  nlohmann::json out;
  try {
    out = describeSelection(value->GetSelectionValue());
  }
  xcatchbegin
    xcatchall { return nlohmann::json(); }
  xcatchend
  catch (...) {
    return nlohmann::json();
  }
  return out;
}

nlohmann::json argValueToJson(pfcArgValue_ptr value) {
  if (!value) {
    return nullptr;
  }
  const pfcArgValueType type = value->Getdiscr();
  switch (type) {
    case pfcARG_V_INTEGER:
      return value->GetIntValue();
    case pfcARG_V_DOUBLE:
      return value->GetDoubleValue();
    case pfcARG_V_BOOLEAN:
      return static_cast<bool>(value->GetBoolValue());
    case pfcARG_V_ASCII_STRING:
    case pfcARG_V_STRING:
    case pfcARG_V_WSTRING: {
      const xstring text = value->GetStringValue();
      return text.IsNull() ? std::string() : toUtf8(text);
    }
    case pfcARG_V_SELECTION:
      return describeSelectionValue(value);
    default:
      return nlohmann::json{{"unsupportedValueType", static_cast<int>(type)}};
  }
}

nlohmann::json describeSpecialValue(wfcSpecialValue_ptr special) {
  nlohmann::json out;
  if (!special) {
    return out;
  }
  out["present"] = true;

  pfcSolid_ptr component = nullptr;
  try {
    component = special->GetComponentModel();
  }
  xcatchbegin
    xcatchall { component = nullptr; }
  xcatchend
  catch (...) {
    component = nullptr;
  }
  if (component) {
    out["hasComponentModel"] = true;
  }

  wfcSection_ptr section = nullptr;
  try {
    section = special->GetSectionValue();
  }
  xcatchbegin
    xcatchall { section = nullptr; }
  xcatchend
  catch (...) {
    section = nullptr;
  }
  if (section) {
    out["hasSection"] = true;
    try {
      wfcSectionEntities_ptr entities = section->ListSectionEntities();
      if (entities) {
        out["sectionEntityCount"] = entities->getarraysize();
      }
    }
    xcatchbegin
      xcatchall { out["sectionEntityCount"] = nullptr; }
    xcatchend
    catch (...) {
      out["sectionEntityCount"] = nullptr;
    }
  }
  return out;
}

nlohmann::json describeElement(wfcElement_ptr element, int depth = 0) {
  nlohmann::json out;
  if (!element) {
    return out;
  }
  out["id"] = static_cast<int>(element->GetId());
  out["level"] = static_cast<int>(element->GetLevel());

  xstring idName;
  try {
    idName = element->GetIdAsString();
  }
  xcatchbegin
    xcatchall { idName = xstring(xstringnil); }
  xcatchend
  catch (...) {
    idName = xstring(xstringnil);
  }
  if (!idName.IsNull()) {
    out["idName"] = toUtf8(idName);
  }

  try {
    if (element->GetIsArray()) {
      out["isArray"] = true;
    }
  }
  xcatchbegin
    xcatchall {}
  xcatchend
  catch (...) {
  }

  try {
    out["value"] = argValueToJson(element->GetValue());
  }
  xcatchbegin
    xcatchall { out["value"] = nullptr; }
  xcatchend
  catch (...) {
    out["value"] = nullptr;
  }

  xstring valueString;
  try {
    valueString = element->GetValueAsString();
  }
  xcatchbegin
    xcatchall { valueString = xstring(xstringnil); }
  xcatchend
  catch (...) {
    valueString = xstring(xstringnil);
  }
  if (!valueString.IsNull()) {
    out["valueString"] = toUtf8(valueString);
  }

  const nlohmann::json special = describeSpecialValue(element->GetSpecialValueElem());
  if (!special.empty()) {
    out["specialValue"] = special;
  }

  wfcCollection_ptr collection = nullptr;
  try {
    collection = element->GetElemCollection();
  }
  xcatchbegin
    xcatchall { collection = nullptr; }
  xcatchend
  catch (...) {
    collection = nullptr;
  }
  if (collection) {
    out["collection"] = {{"present", true}};
  }

  pfcSelections_ptr selections = nullptr;
  try {
    selections = element->GetSelections();
  }
  xcatchbegin
    xcatchall { selections = nullptr; }
  xcatchend
  catch (...) {
    selections = nullptr;
  }
  if (selections && selections->getarraysize() > 0) {
    nlohmann::json list = nlohmann::json::array();
    const int count = selections->getarraysize();
    for (int i = 0; i < count; ++i) {
      list.push_back(describeSelection(selections->get(i)));
    }
    out["selections"] = std::move(list);
  }

  try {
    if (element->GetIsCompound()) {
      out["isCompound"] = true;
    }
    if (element->GetIsMultival()) {
      out["isMultival"] = true;
    }
  }
  xcatchbegin
    xcatchall {}
  xcatchend
  catch (...) {
  }

  // Array and compound values only show up through GetChildren; the flat
  // ListTreeElements result deliberately omits them. A bounded depth keeps a
  // malformed tree from recursing forever.
  if (depth < 16) {
    wfcElements_ptr children = nullptr;
    try {
      children = element->GetChildren();
    }
    xcatchbegin
      xcatchall { children = nullptr; }
    xcatchend
    catch (...) {
      children = nullptr;
    }
    if (children && children->getarraysize() > 0) {
      nlohmann::json list = nlohmann::json::array();
      const int count = children->getarraysize();
      for (int i = 0; i < count; ++i) {
        list.push_back(describeElement(children->get(i), depth + 1));
      }
      out["children"] = std::move(list);
    }
  }
  return out;
}

pfcFeature_ptr findFeatureById(pfcModel_ptr model, int id) {
  pfcModelItems_ptr items = model->ListItems(pfcITEM_FEATURE);
  if (!items) {
    return nullptr;
  }
  const int count = items->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcFeature_ptr feature = pfcFeature::cast(items->get(i));
    if (feature && static_cast<int>(feature->GetId()) == id) {
      return feature;
    }
  }
  return nullptr;
}

std::string readTextFile(const std::wstring& path, int maxChars,
                         bool& truncated) {
  std::ifstream stream(path.c_str(), std::ios::binary);
  if (!stream) {
    return std::string();
  }
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  std::string text = buffer.str();
  if (maxChars > 0 && static_cast<int>(text.size()) > maxChars) {
    text.resize(static_cast<size_t>(maxChars));
    truncated = true;
  }
  return text;
}

std::string joinPath(const std::string& directory, const std::string& fileName) {
  if (directory.empty()) {
    return fileName;
  }
  const char last = directory[directory.size() - 1];
  if (last == '\\' || last == '/') {
    return directory + fileName;
  }
  return directory + "\\" + fileName;
}

}  // namespace

nlohmann::json describeFeatureTree(pfcSession_ptr session, pfcModel_ptr model,
                                   int featureId, bool includeXml, int maxChars) {
  if (!model) {
    throw BridgeError("MODEL_NOT_FOUND", "No model is open in the session.");
  }
  if (featureId <= 0) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A positive featureId is required to dump an element tree.");
  }
  pfcFeature_ptr feature = findFeatureById(model, featureId);
  if (!feature) {
    throw BridgeError("NOT_FOUND", "Feature " + std::to_string(featureId) +
                                      " is not present in the model.");
  }
  wfcWFeature_ptr wfeature = wfcWFeature::cast(feature);
  if (!wfeature) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Feature " + std::to_string(featureId) +
                          " does not expose an OTK element tree.");
  }

  nlohmann::json out;
  out["model"] = describeModelInfo(model);

  nlohmann::json featureInfo;
  featureInfo["id"] = static_cast<int>(feature->GetId());
  const xstring name = feature->GetName();
  if (!name.IsNull()) {
    featureInfo["name"] = toUtf8(name);
  }
  featureInfo["type"] = toUtf8(feature->GetFeatTypeName());
  const xstring subType = feature->GetFeatSubType();
  if (!subType.IsNull()) {
    featureInfo["subType"] = toUtf8(subType);
  }
  featureInfo["status"] = featureStatusName(feature->GetStatus());
  out["feature"] = featureInfo;

  wfcElementTree_ptr tree =
      wfeature->GetElementTree(0, wfcFEAT_EXTRACT_NO_OPTS);
  if (!tree) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo returned no element tree for feature " +
                          std::to_string(featureId) + ".");
  }

  nlohmann::json elements = nlohmann::json::array();
  wfcElements_ptr listed = tree->ListTreeElements();
  if (listed) {
    const int count = listed->getarraysize();
    for (int i = 0; i < count; ++i) {
      elements.push_back(describeElement(listed->get(i)));
    }
  }
  out["elementCount"] = elements.size();
  out["elements"] = std::move(elements);

  if (includeXml) {
    const std::string fileName =
        "mcp_feature_" + std::to_string(featureId) + "_tree.xml";
    const std::string directory = toUtf8(session->GetCurrentDirectory());
    const std::string fullPath = joinPath(directory, fileName);

    const bool wrote = [&]() {
      try {
        tree->WriteElementTreeToFile(wfcELEMTREE_XML,
                                     xstring(toWide(fullPath).c_str()));
        return true;
      }
      xcatchbegin
        xcatchall { return false; }
      xcatchend
      catch (...) {
        return false;
      }
    }();

    nlohmann::json xmlInfo;
    xmlInfo["file"] = fullPath;
    xmlInfo["written"] = wrote;
    if (wrote) {
      bool truncated = false;
      const std::string text =
          readTextFile(toWide(fullPath),
                       maxChars > 0 ? maxChars : 262144, truncated);
      xmlInfo["chars"] = static_cast<int>(text.size());
      xmlInfo["truncated"] = truncated;
      xmlInfo["text"] = text;
    }
    out["xml"] = std::move(xmlInfo);
  }
  return out;
}

namespace {

// Values come from the Pro/TOOLKIT headers (ProExtrude.h, ProRevolve.h,
// ProStdSection.h, ProFeatType.h, ProFeatForm.h, ProBodyOpts.h); the OTK
// headers do not restate them.
const int kProFeatProtrusion = 917;       // PRO_FEAT_PROTRUSION
const int kProFeatRound = 913;            // PRO_FEAT_ROUND
const int kProFeatChamfer = 914;          // PRO_FEAT_CHAMFER
const int kProFeatShell = 928;            // PRO_FEAT_SHELL
// ProChamfer.h ProChmSchema values.
const int kProChmSchema45xD = 601;        // PRO_CHM_45_X_D
const int kProChmSchemaDxD = 602;         // PRO_CHM_D_X_D
const int kProChmSchemaD1xD2 = 603;       // PRO_CHM_D1_X_D2
const int kProChmSchemaAngxD = 604;       // PRO_CHM_ANG_X_D
// ProChamfer.h ProChamferShape values.
const int kProChmShapeTangentLegs = 0;    // PRO_CHM_TANGENT_LEGS
const int kProChmShapeOffsetSurface = 1;  // PRO_CHM_OFFSET_SURFACE
// ProRound.h ProRoundRadiusType: a leg carries an explicit value.
const int kProRoundRadiusTypeValue = 1;   // PRO_ROUND_RADIUS_TYPE_VALUE
// wfcCurveCollectionInstrType (wfcCollection.h): add one selected curve/edge.
const int kProCurvCollAddOne = 1;         // wfcCURVCOLL_ADD_ONE_INSTR
// wfcPRO_E_RNDCH_REFERENCE_TYPE values, read back from native Creo 9 trees:
// 1 selects a curve collection, 4 stores explicit EDGE1/EDGE2 references.
const int kProRndchRefCurveCollection = 1;
const int kProRndchLegUnused = 0;
const int kProExtFeatTypeSolid = 917;     // PRO_EXT_FEAT_TYPE_SOLID
const int kProExtrudeForm = 1;            // PRO_EXTRUDE (ProFeatForm.h)
const int kProRevolveForm = 2;            // PRO_REVOLVE (ProFeatForm.h)
const int kProExtMaterialAdd = -1;        // PRO_EXT_MATERIAL_ADD
const int kProExtMaterialRemove = 916;    // PRO_EXT_MATERIAL_REMOVE
const int kProExtDepthFromNone = 1 << 12;   // PRO_EXT_DEPTH_FROM_NONE
const int kProExtDepthToBlind = 1 << 18;    // PRO_EXT_DEPTH_TO_BLIND
const int kProExtDepthSymmetric = 1 << 28;  // PRO_EXT_DEPTH_SYMMETRIC
const int kProExtFeatFormNoThin = 0;      // PRO_EXT_FEAT_FORM_NO_THIN
const int kProExtMaterialSideOne = 1;     // PRO_EXT_MATERIAL_SIDE_ONE
const int kProExtDraftNone = -1;          // PRO_EXT_DRFT_ANG_NO_DRAFT
const int kProSecSketch = 25;             // PRO_SEC_SKETCH
const int kProSecViewDirSideTwo = -1;     // PRO_SEC_VIEW_DIR_SIDE_TWO
const int kProSecOrientDirUp = 1;         // PRO_SEC_ORIENT_DIR_UP
const int kProRevAxisInternal = 1;        // PRO_REV_AXIS_INT_REF
const int kProRevAngleFromAngle = 1 << 12; // PRO_REV_ANG_FROM_ANGLE
const int kProRevAngleFromNone = 1 << 18;  // PRO_REV_ANG_FROM_NONE
const int kProRevAngleToAngle = 1 << 22;   // PRO_REV_ANG_TO_ANGLE
const int kProRevAngleSymmetric = 1 << 29; // PRO_REV_ANG_SYMMETRIC
// PRO_REV_ANG_TO_360 was removed from the Creo 9 header enum (bit 26 is the gap
// between TO_270 and TO_REF) but Creo still accepts it as a full revolution.
const int kProRevAngleTo360 = 1 << 26;

// Creo 9's multi-body elements have no wfcPRO_E_* constants; these ids were
// read back from a native Creo 9 extrusion element tree (feature.tree).
const int kProEBody = 6314;
const int kProEBodyUse = 6315;
const int kProEBodySelect = 6316;

const int kProBodyUseNew = 0;       // PRO_BODY_USE_NEW
const int kProBodyUseAll = 1;       // PRO_BODY_USE_ALL
const int kProBodyUseSelected = 2;  // PRO_BODY_USE_SELECTED

std::string messageOf(const xstring& value) {
  return value.IsNull() ? std::string() : toUtf8(value);
}

// OTK exceptions surface as empty pfcXToolkitGeneralError messages; naming the
// step that failed is the only reliable diagnostic once an element tree is in
// flight.
template <typename Fn>
auto runStage(const std::string& stage, Fn&& fn) -> decltype(fn()) {
  try {
    return fn();
  }
  xcatchbegin
    xcatch(pfcXToolkitError, e) {
      const int code = static_cast<int>(e->GetErrorCode());
      const std::string message = messageOf(e->GetMessage());
      throw BridgeError("CREO_API_ERROR",
                        "Stage '" + stage + "' failed" +
                            (message.empty() ? std::string() : ": " + message) +
                            " (toolkit error " + std::to_string(code) + ")",
                        false, {{"stage", stage}, {"toolkitErrorCode", code}});
    }
    xcatch(pfcXPFC, e) {
      throw BridgeError("CREO_API_ERROR",
                        "Stage '" + stage + "' failed: " +
                            messageOf(e->GetMessage()),
                        false, {{"stage", stage}});
    }
    xcatchall {
      throw BridgeError("CREO_API_ERROR",
                        "Stage '" + stage +
                            "' failed with an unhandled OTK exception.",
                        false, {{"stage", stage}});
    }
  xcatchend
  catch (const BridgeError&) {
    throw;
  }
  catch (const std::exception& e) {
    throw BridgeError("CREO_API_ERROR",
                      "Stage '" + stage + "' failed: " + e.what(), false,
                      {{"stage", stage}});
  }
  catch (...) {
    throw BridgeError("CREO_API_ERROR",
                      "Stage '" + stage +
                          "' failed with an unknown exception.",
                      false, {{"stage", stage}});
  }
}

double requireNumber(const nlohmann::json& object, const char* key,
                     const char* context) {
  if (!object.contains(key) || !object.at(key).is_number()) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string(context) + " requires a numeric '" + key +
                          "' field.");
  }
  return object.at(key).get<double>();
}

class ElementBuilder {
 public:
  ElementBuilder() : elements_(wfcElements::create()) {}

  void compound(int id, int level) {
    elements_->append(wfcElement::Create(id, 0, level));
  }
  void intValue(int id, int value, int level) {
    elements_->append(wfcElement::Create(id, pfcCreateIntArgValue(value), level));
  }
  void doubleValue(int id, double value, int level) {
    elements_->append(
        wfcElement::Create(id, pfcCreateDoubleArgValue(value), level));
  }
  void stringValue(int id, const std::string& value, int level) {
    elements_->append(
        wfcElement::Create(id, pfcCreateStringArgValue(value.c_str()), level));
  }
  void selection(int id, pfcSelection_ptr selection, int level) {
    elements_->append(
        wfcElement::Create(id, pfcCreateSelectionArgValue(selection), level));
  }
  // Multivalue elements (e.g. PRO_E_SHELL_SRF) carry their references as a
  // selection list rather than one selection element each.
  void selections(int id, pfcSelections_ptr selections, int level) {
    wfcElement_ptr element = wfcElement::Create(id, 0, level);
    element->SetSelections(selections);
    elements_->append(element);
  }
  void collection(int id, wfcCollection_ptr collection, int level) {
    wfcElement_ptr element = wfcElement::Create(id, 0, level);
    element->SetElemCollection(collection);
    elements_->append(element);
  }
  wfcElements_ptr elements() const { return elements_; }

 private:
  wfcElements_ptr elements_;
};

pfcFeature_ptr safeSurfaceFeature(pfcSurface_ptr surface) {
  try {
    return surface->GetFeature();
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

pfcFeature_ptr findFeatureByName(pfcModel_ptr model, const std::string& name) {
  pfcModelItems_ptr items = model->ListItems(pfcITEM_FEATURE);
  if (!items) {
    return nullptr;
  }
  const int count = items->getarraysize();
  const std::wstring wanted = toWide(name);
  for (int i = 0; i < count; ++i) {
    pfcFeature_ptr feature = pfcFeature::cast(items->get(i));
    if (!feature) {
      continue;
    }
    const xstring featureName = feature->GetName();
    if (featureName.IsNull()) {
      continue;
    }
    if (equalsIgnoreCase(std::wstring(static_cast<cWStringT>(featureName)),
                         wanted)) {
      return feature;
    }
  }
  return nullptr;
}

pfcModelItem_ptr safeSurfaceItem(pfcModel_ptr model, int surfaceId) {
  try {
    return model->GetItemById(pfcITEM_SURFACE, surfaceId);
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

// Datum plane surfaces do not appear in the surface list APIs, but they are
// reachable by id: on Creo 9 a datum plane's PRO_SURFACE is allocated directly
// after its feature, so `featureId + 1` resolves first; a bounded scan covers
// builds that allocate further away. The owner check makes the match exact.
pfcModelItem_ptr findDatumSurfaceItem(pfcModel_ptr model,
                                      pfcFeature_ptr feature) {
  const int featureId = static_cast<int>(feature->GetId());
  const int candidates[] = {featureId + 1, featureId + 2, featureId,
                            featureId + 3, featureId - 1};
  for (const int id : candidates) {
    if (id <= 0) {
      continue;
    }
    pfcModelItem_ptr item = safeSurfaceItem(model, id);
    pfcFeature_ptr owner = item ? safeSurfaceFeature(pfcSurface::cast(item))
                                : nullptr;
    if (owner && static_cast<int>(owner->GetId()) == featureId) {
      return item;
    }
  }
  for (int id = featureId + 4; id <= featureId + 32; ++id) {
    pfcModelItem_ptr item = safeSurfaceItem(model, id);
    pfcFeature_ptr owner = item ? safeSurfaceFeature(pfcSurface::cast(item))
                                : nullptr;
    if (owner && static_cast<int>(owner->GetId()) == featureId) {
      return item;
    }
  }
  return nullptr;
}

// Builds the sketch plane / orientation reference selection that the section
// elements store. The element is documented to hold a PRO_SURFACE reference
// (ProStdSection.h), and only a surface selection survives feature creation.
pfcSelection_ptr resolvePlaneSelection(pfcModel_ptr model,
                                       const std::string& name, int surfaceId,
                                       int featureId, const char* role) {
  if (surfaceId > 0) {
    pfcModelItem_ptr item = safeSurfaceItem(model, surfaceId);
    if (!item || !pfcSurface::cast(item)) {
      throw BridgeError("NOT_FOUND", std::string(role) + " surface " +
                                        std::to_string(surfaceId) +
                                        " was not found in the model.");
    }
    return pfcCreateModelItemSelection(item);
  }
  if (featureId > 0) {
    pfcModelItem_ptr featureItem = model->GetItemById(pfcITEM_FEATURE, featureId);
    pfcFeature_ptr feature = pfcFeature::cast(featureItem);
    if (!feature) {
      throw BridgeError("NOT_FOUND", std::string(role) + " feature " +
                                        std::to_string(featureId) +
                                        " was not found in the model.");
    }
    pfcModelItem_ptr surface = findDatumSurfaceItem(model, feature);
    if (!surface) {
      throw BridgeError("NOT_FOUND", std::string(role) + " feature " +
                                        std::to_string(featureId) +
                                        " has no resolvable datum surface.");
    }
    return pfcCreateModelItemSelection(surface);
  }
  if (name.empty()) {
    return nullptr;
  }
  // Prefer an explicit PRO_SURFACE whose owning feature carries the name.
  pfcModelItems_ptr items = model->ListItems(pfcITEM_SURFACE);
  if (items) {
    const int count = items->getarraysize();
    const std::wstring wanted = toWide(name);
    for (int i = 0; i < count; ++i) {
      pfcModelItem_ptr item = items->get(i);
      pfcSurface_ptr surface = pfcSurface::cast(item);
      if (!surface) {
        continue;
      }
      pfcFeature_ptr owner = safeSurfaceFeature(surface);
      if (!owner) {
        continue;
      }
      const xstring featureName = owner->GetName();
      if (featureName.IsNull()) {
        continue;
      }
      if (equalsIgnoreCase(std::wstring(static_cast<cWStringT>(featureName)),
                           wanted)) {
        return pfcCreateModelItemSelection(item);
      }
    }
  }
  // Datum planes are not enumerated above; resolve the feature and its surface.
  pfcFeature_ptr feature = findFeatureByName(model, name);
  if (feature) {
    pfcModelItem_ptr surface = findDatumSurfaceItem(model, feature);
    if (surface) {
      return pfcCreateModelItemSelection(surface);
    }
  }
  throw BridgeError("NOT_FOUND", std::string(role) + " '" + name +
                                    "' was not found as a datum plane in the "
                                    "model.");
}

void addSectionEntities(wfcSection_ptr section, const nlohmann::json& entities) {
  if (!entities.is_array() || entities.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "At least one section entity is required.");
  }
  for (const nlohmann::json& entity : entities) {
    if (!entity.is_object()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "Each section entity must be an object.");
    }
    const std::string type = entity.value("type", std::string());
    if (type == "line" || type == "centerline") {
      pfcOutline2D_ptr outline = wfcCreateOutline2D(
          requireNumber(entity, "x1", type.c_str()),
          requireNumber(entity, "y1", type.c_str()),
          requireNumber(entity, "x2", type.c_str()),
          requireNumber(entity, "y2", type.c_str()));
      wfcSectionEntity_ptr created =
          type == "line"
              ? wfcSectionEntity::cast(wfcSectionEntityLine::Create(outline))
              : wfcSectionEntity::cast(
                    wfcSectionEntityCenterLine::Create(outline));
      section->AddEntity(created);
    } else if (type == "rectangle") {
      const double x1 = requireNumber(entity, "x1", "rectangle");
      const double y1 = requireNumber(entity, "y1", "rectangle");
      const double x2 = requireNumber(entity, "x2", "rectangle");
      const double y2 = requireNumber(entity, "y2", "rectangle");
      const double corners[4][4] = {{x1, y1, x2, y1},
                                    {x2, y1, x2, y2},
                                    {x2, y2, x1, y2},
                                    {x1, y2, x1, y1}};
      for (const auto& corner : corners) {
        pfcOutline2D_ptr outline = wfcCreateOutline2D(
            corner[0], corner[1], corner[2], corner[3]);
        section->AddEntity(
            wfcSectionEntity::cast(wfcSectionEntityLine::Create(outline)));
      }
    } else if (type == "circle") {
      pfcPoint2D_ptr center = wfcCreatePoint2D(
          requireNumber(entity, "x", "circle"),
          requireNumber(entity, "y", "circle"));
      section->AddEntity(wfcSectionEntity::cast(wfcSectionEntityCircle::Create(
          center, requireNumber(entity, "radius", "circle"))));
    } else if (type == "arc") {
      pfcPoint2D_ptr center = wfcCreatePoint2D(
          requireNumber(entity, "x", "arc"),
          requireNumber(entity, "y", "arc"));
      const double pi = 3.14159265358979323846;
      const double startAngle =
          requireNumber(entity, "startAngle", "arc") * pi / 180.0;
      const double endAngle = requireNumber(entity, "endAngle", "arc") * pi / 180.0;
      section->AddEntity(wfcSectionEntity::cast(wfcSectionEntityArc::Create(
          center, startAngle, endAngle,
          requireNumber(entity, "radius", "arc"))));
    } else if (type == "point") {
      pfcPoint2D_ptr point = wfcCreatePoint2D(
          requireNumber(entity, "x", "point"),
          requireNumber(entity, "y", "point"));
      section->AddEntity(
          wfcSectionEntity::cast(wfcSectionEntityPoint::Create(point)));
    } else if (type == "ellipse") {
      pfcPoint2D_ptr center = wfcCreatePoint2D(
          requireNumber(entity, "x", "ellipse"),
          requireNumber(entity, "y", "ellipse"));
      section->AddEntity(
          wfcSectionEntity::cast(wfcSectionEntityEllipse::Create(
              center, requireNumber(entity, "xRadius", "ellipse"),
              requireNumber(entity, "yRadius", "ellipse"))));
    } else if (type == "polyline") {
      if (!entity.contains("points") || !entity.at("points").is_array() ||
          entity.at("points").size() < 2) {
        throw BridgeError("INVALID_ARGUMENT",
                          "polyline requires a 'points' array of [x,y] pairs.");
      }
      pfcPoint2Ds_ptr points = pfcPoint2Ds::create();
      for (const nlohmann::json& pair : entity.at("points")) {
        if (!pair.is_array() || pair.size() != 2 || !pair[0].is_number() ||
            !pair[1].is_number()) {
          throw BridgeError("INVALID_ARGUMENT",
                            "polyline points must be [x,y] number pairs.");
        }
        points->append(
            wfcCreatePoint2D(pair[0].get<double>(), pair[1].get<double>()));
      }
      section->AddEntity(wfcSectionEntity::cast(
          wfcSectionEntityPolyline::Create(points)));
    } else {
      throw BridgeError("INVALID_ARGUMENT",
                        "Unsupported section entity type '" + type +
                            "'. Use line, rectangle, circle, arc, point, "
                            "ellipse, polyline, or centerline.");
    }
  }
}

wfcElement_ptr findSketcherElement(wfcElementTree_ptr tree) {
  wfcElements_ptr elements = tree->ListTreeElements();
  if (!elements) {
    return nullptr;
  }
  wfcElement_ptr candidate = nullptr;
  const int count = elements->getarraysize();
  for (int i = 0; i < count; ++i) {
    wfcElement_ptr element = elements->get(i);
    if (!element || static_cast<int>(element->GetId()) != wfcPRO_E_SKETCHER) {
      continue;
    }
    wfcSpecialValue_ptr special = element->GetSpecialValueElem();
    if (special && special->GetSectionValue()) {
      return element;
    }
    if (!candidate ||
        static_cast<int>(element->GetLevel()) >
            static_cast<int>(candidate->GetLevel())) {
      candidate = element;
    }
  }
  return candidate;
}

nlohmann::json describeFeatureEntry(pfcFeature_ptr feature) {
  nlohmann::json out;
  out["id"] = static_cast<int>(feature->GetId());
  const xstring name = feature->GetName();
  if (!name.IsNull()) {
    out["name"] = toUtf8(name);
  }
  out["type"] = toUtf8(feature->GetFeatTypeName());
  out["status"] = featureStatusName(feature->GetStatus());
  return out;
}

pfcModelItem_ptr safeEdgeItem(pfcModel_ptr model, int edgeId) {
  try {
    return model->GetItemById(pfcITEM_EDGE, edgeId);
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

// GetItemById does not resolve every item type on every build (datum plane
// surfaces have the same quirk), so fall back to a list scan.
pfcSelection_ptr resolveEdgeSelection(pfcModel_ptr model, int edgeId) {
  if (edgeId <= 0) {
    throw BridgeError("INVALID_ARGUMENT", "Edge ids must be positive integers.");
  }
  pfcModelItem_ptr item = safeEdgeItem(model, edgeId);
  if (!item || !pfcEdge::cast(item)) {
    pfcModelItems_ptr items = model->ListItems(pfcITEM_EDGE);
    if (items) {
      const int count = items->getarraysize();
      for (int i = 0; i < count; ++i) {
        pfcModelItem_ptr candidate = items->get(i);
        if (candidate && static_cast<int>(candidate->GetId()) == edgeId &&
            pfcEdge::cast(candidate)) {
          item = candidate;
          break;
        }
      }
    }
  }
  if (!item || !pfcEdge::cast(item)) {
    throw BridgeError("NOT_FOUND", "Edge " + std::to_string(edgeId) +
                                      " is not present in the model.");
  }
  return pfcCreateModelItemSelection(item);
}

pfcSelections_ptr resolveEdgeSelections(pfcModel_ptr model,
                                        const std::vector<int>& edgeIds) {
  if (edgeIds.empty()) {
    throw BridgeError("INVALID_ARGUMENT", "At least one edge id is required.");
  }
  pfcSelections_ptr selections = pfcSelections::create();
  for (const int id : edgeIds) {
    selections->append(resolveEdgeSelection(model, id));
  }
  return selections;
}

pfcSelections_ptr resolveSurfaceSelections(pfcModel_ptr model,
                                           const std::vector<int>& surfaceIds) {
  if (surfaceIds.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "At least one surface id is required.");
  }
  pfcSelections_ptr selections = pfcSelections::create();
  for (const int id : surfaceIds) {
    if (id <= 0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "Surface ids must be positive integers.");
    }
    pfcModelItem_ptr item = safeSurfaceItem(model, id);
    if (!item || !pfcSurface::cast(item)) {
      throw BridgeError("NOT_FOUND", "Surface " + std::to_string(id) +
                                        " is not present in the model.");
    }
    selections->append(pfcCreateModelItemSelection(item));
  }
  return selections;
}

wfcCollection_ptr edgeCurveCollection(pfcSelections_ptr selections) {
  wfcCurveCollectionInstruction_ptr instruction =
      wfcCurveCollectionInstruction::Create(
          static_cast<wfcCurveCollectionInstrType>(kProCurvCollAddOne),
          selections);
  if (!instruction) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not build the edge curve collection.");
  }
  wfcCurveCollectionInstructions_ptr instructions =
      wfcCurveCollectionInstructions::create();
  instructions->append(instruction);
  wfcCurveCollection_ptr curve = wfcCurveCollection::Create(instructions);
  if (!curve) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not create the edge curve collection.");
  }
  wfcCollection_ptr collection = wfcCollection::Create();
  if (!collection) {
    throw BridgeError("CREO_API_ERROR", "Could not create the collection.");
  }
  collection->SetCrvCollection(curve);
  return collection;
}

// createOption is a wfcFeatCreateOptions flag. PTC's round/chamfer samples use
// wfcFEAT_CR_DEFINE_MISS_ELEMS so Creo fills unspecified elements with
// defaults instead of failing; that keeps the payloads small and robust.
wfcWFeature_ptr commitFeature(pfcModel_ptr model, const ElementBuilder& builder,
                              const std::string& label,
                              wfcFeatCreateOption createOption) {
  wfcWSolid_ptr solid = wfcWSolid::cast(model);
  if (!solid) {
    throw BridgeError("INVALID_ARGUMENT",
                      label + " requires a part or assembly solid.");
  }
  wfcWSession_ptr session = wfcWSession::cast(pfcGetCurrentSession());
  if (!session) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not reach the OTK session object.");
  }
  wfcElementTree_ptr tree = runStage("CreateElementTree", [&]() {
    return session->CreateElementTree(builder.elements());
  });
  if (!tree) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo rejected the " + label + " element tree.");
  }
  wfcFeatCreateOptions_ptr options = wfcFeatCreateOptions::create();
  options->append(createOption);
  wfcWRegenInstructions_ptr regen = wfcWRegenInstructions::Create();
  wfcWFeature_ptr feature = runStage("WCreateFeature", [&]() {
    return solid->WCreateFeature(tree, options, regen);
  });
  if (!feature) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not create the " + label + " feature.");
  }
  return feature;
}

nlohmann::json detailFeatureResult(pfcModel_ptr model, int featureId,
                                   const nlohmann::json& request) {
  nlohmann::json out;
  out["model"] = describeModelInfo(model);
  pfcFeature_ptr created = findFeatureById(model, featureId);
  out["feature"] = created ? describeFeatureEntry(created)
                           : nlohmann::json{{"id", featureId}};
  out["geometry"] = describeGeometry(model);
  out["massProperties"] = describeMassProperties(model, std::string());
  out["request"] = request;
  return out;
}

}  // namespace

nlohmann::json createSolidFeature(pfcModel_ptr model,
                                  const SolidFeatureRequest& request) {
  wfcWSolid_ptr solid = wfcWSolid::cast(model);
  if (!solid) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Feature creation requires a part or assembly solid.");
  }
  const bool revolve = request.kind == "revolve";
  if (request.kind != "extrude" && !revolve) {
    throw BridgeError("INVALID_ARGUMENT",
                      "kind must be 'extrude' or 'revolve'.");
  }
  if (!revolve && !(request.depth > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT", "depth must be greater than zero.");
  }
  if (revolve && !(request.angle > 0.0 && request.angle <= 360.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "angle must be in the range (0, 360].");
  }
  if (request.direction != 1 && request.direction != -1) {
    throw BridgeError("INVALID_ARGUMENT", "direction must be 1 or -1.");
  }

  pfcSelection_ptr sketchPlane = resolvePlaneSelection(
      model, request.sketchPlane, request.sketchPlaneSurfaceId,
      request.sketchPlaneFeatureId, "Sketch plane");
  if (!sketchPlane) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A sketch plane (datum plane name, feature id, or "
                      "surface id) is required.");
  }
  pfcSelection_ptr orientRef = resolvePlaneSelection(
      model, request.orientRef, request.orientRefSurfaceId,
      request.orientRefFeatureId, "Sketch orientation reference");

  pfcModelItems_ptr bodies = model->ListItems(pfcITEM_BODY);
  const bool hasBody = bodies && bodies->getarraysize() > 0;
  const int bodyUse = request.removeMaterial
                          ? kProBodyUseAll
                          : (hasBody ? kProBodyUseSelected : kProBodyUseNew);

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatProtrusion, 1);
  builder.intValue(wfcPRO_E_FEATURE_FORM,
                   revolve ? kProRevolveForm : kProExtrudeForm, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.intValue(wfcPRO_E_EXT_SURF_CUT_SOLID_TYPE, kProExtFeatTypeSolid, 1);
  builder.intValue(wfcPRO_E_REMOVE_MATERIAL,
                   request.removeMaterial ? kProExtMaterialRemove
                                          : kProExtMaterialAdd,
                   1);
  builder.compound(kProEBody, 1);
  builder.intValue(kProEBodyUse, bodyUse, 2);
  if (bodyUse == kProBodyUseSelected && hasBody) {
    builder.selection(kProEBodySelect,
                      pfcCreateModelItemSelection(bodies->get(0)), 2);
  }
  builder.compound(wfcPRO_E_STD_SECTION, 1);
  builder.intValue(wfcPRO_E_STD_SEC_METHOD, kProSecSketch, 2);
  builder.compound(wfcPRO_E_STD_SEC_SETUP_PLANE, 2);
  builder.selection(wfcPRO_E_STD_SEC_PLANE, sketchPlane, 3);
  builder.intValue(wfcPRO_E_STD_SEC_PLANE_VIEW_DIR,
                   request.direction == 1 ? kProSecViewDirSideTwo : 1, 3);
  builder.intValue(wfcPRO_E_STD_SEC_PLANE_ORIENT_DIR, kProSecOrientDirUp, 3);
  if (orientRef) {
    builder.selection(wfcPRO_E_STD_SEC_PLANE_ORIENT_REF, orientRef, 3);
  }
  builder.intValue(wfcPRO_E_FEAT_FORM_IS_THIN, kProExtFeatFormNoThin, 1);
  builder.intValue(wfcPRO_E_STD_MATRLSIDE, kProExtMaterialSideOne, 1);
  builder.intValue(wfcPRO_E_STD_DIRECTION, request.direction, 1);
  if (revolve) {
    // The section's centerline acts as the revolve axis. A full 360 degree
    // revolve cannot be expressed as a plain 0..360 angle (Creo rejects the
    // coincident start/end faces close to closure), so full revolutions use
    // the symmetric form: +/- angle/2 about the sketch plane.
    builder.intValue(wfcPRO_E_REVOLVE_AXIS_OPT, kProRevAxisInternal, 1);
    const bool full = request.angle >= 359.5;
    const bool symmetric = request.symmetric && !full;
    builder.compound(wfcPRO_E_REV_ANGLE, 1);
    builder.compound(wfcPRO_E_REV_ANGLE_FROM, 2);
    builder.intValue(wfcPRO_E_REV_ANGLE_FROM_TYPE,
                     symmetric ? kProRevAngleFromNone : kProRevAngleFromAngle, 3);
    builder.doubleValue(wfcPRO_E_REV_ANGLE_FROM_VAL, 0.0, 3);
    builder.compound(wfcPRO_E_REV_ANGLE_TO, 2);
    builder.intValue(wfcPRO_E_REV_ANGLE_TO_TYPE,
                     full ? kProRevAngleTo360
                          : (symmetric ? kProRevAngleSymmetric
                                       : kProRevAngleToAngle),
                     3);
    builder.doubleValue(wfcPRO_E_REV_ANGLE_TO_VAL, full ? 0.0 : request.angle, 3);
  } else {
    builder.compound(wfcPRO_E_STD_EXT_DEPTH, 1);
    builder.compound(wfcPRO_E_EXT_DEPTH_FROM, 2);
    builder.intValue(wfcPRO_E_EXT_DEPTH_FROM_TYPE, kProExtDepthFromNone, 3);
    builder.doubleValue(wfcPRO_E_EXT_DEPTH_FROM_VALUE, 0.0, 3);
    builder.compound(wfcPRO_E_EXT_DEPTH_TO, 2);
    // A symmetric depth grows half the value to each side of the sketch plane,
    // which is how a mid-plane through-cut is expressed.
    builder.intValue(wfcPRO_E_EXT_DEPTH_TO_TYPE,
                     request.symmetric ? kProExtDepthSymmetric
                                       : kProExtDepthToBlind,
                     3);
    builder.doubleValue(wfcPRO_E_EXT_DEPTH_TO_VALUE, request.depth, 3);
    builder.compound(wfcPRO_E_EXT_COMP_DRFT_ANG, 1);
    builder.intValue(wfcPRO_E_EXT_DRFT_ANG, kProExtDraftNone, 2);
    builder.doubleValue(wfcPRO_E_EXT_DRFT_ANG_VAL, 0.0, 2);
  }

  wfcWSession_ptr session = wfcWSession::cast(pfcGetCurrentSession());
  if (!session) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not reach the OTK session object.");
  }
  wfcElementTree_ptr tree = runStage("CreateElementTree", [&]() {
    return session->CreateElementTree(builder.elements());
  });
  if (!tree) {
    throw BridgeError("CREO_API_ERROR", "Creo rejected the extrude element tree.");
  }

  wfcFeatCreateOptions_ptr incomplete = wfcFeatCreateOptions::create();
  incomplete->append(wfcFEAT_CR_INCOMPLETE_FEAT);
  wfcWRegenInstructions_ptr regen = wfcWRegenInstructions::Create();
  wfcWFeature_ptr feature = runStage("WCreateFeature", [&]() {
    return solid->WCreateFeature(tree, incomplete, regen);
  });
  if (!feature) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not create the incomplete extrude feature.");
  }
  const int featureId = static_cast<int>(feature->GetId());

  // Creo allocated a 3D section with the sketch plane's location/orientation;
  // fill it, resolve it, and redefine the feature to complete it.
  wfcElementTree_ptr extracted = runStage("GetElementTree", [&]() {
    return feature->GetElementTree(0, wfcFEAT_EXTRACT_NO_OPTS);
  });
  if (!extracted) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not extract the incomplete feature's element tree.");
  }
  wfcElement_ptr sketcher = findSketcherElement(extracted);
  if (!sketcher) {
    throw BridgeError("CREO_API_ERROR",
                      "The incomplete feature has no PRO_E_SKETCHER element.");
  }
  wfcSection_ptr section = runStage("GetSectionValue", [&]() {
    wfcSpecialValue_ptr special = sketcher->GetSpecialValueElem();
    return special ? special->GetSectionValue() : nullptr;
  });
  if (!section) {
    throw BridgeError(
        "CREO_API_ERROR",
        "Creo did not allocate a sketcher section for the sketch plane.");
  }
  runStage("AddSectionEntities",
           [&]() { addSectionEntities(section, request.entities); });
  runStage("ResolveSection", [&]() {
    section->SetIntentManagerMode(true);
    section->SetIntentManagerMode(false);
    return 0;
  });
  wfcSpecialValue_ptr updatedSpecial = sketcher->GetSpecialValueElem();
  if (updatedSpecial) {
    updatedSpecial->SetSectionValue(section);
    sketcher->SetSpecialValueElem(updatedSpecial);
  }

  wfcFeatCreateOptions_ptr complete = wfcFeatCreateOptions::create();
  complete->append(wfcFEAT_CR_NO_OPTS);
  runStage("RedefineFeature", [&]() {
    feature->RedefineFeature(0, extracted, complete, regen);
    return 0;
  });

  nlohmann::json out;
  out["model"] = describeModelInfo(model);
  pfcFeature_ptr created = findFeatureById(model, featureId);
  out["feature"] = created ? describeFeatureEntry(created)
                           : nlohmann::json{{"id", featureId}};
  out["geometry"] = describeGeometry(model);
  out["request"] = {{"sketchPlane", request.sketchPlane},
                    {"sketchPlaneSurfaceId", request.sketchPlaneSurfaceId},
                    {"orientRef", request.orientRef},
                    {"depth", request.depth},
                    {"direction", request.direction},
                    {"removeMaterial", request.removeMaterial},
                    {"entityCount", request.entities.size()}};
  return out;
}

nlohmann::json createRoundFeature(pfcModel_ptr model,
                                  const RoundFeatureRequest& request) {
  if (!(request.radius > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A round radius greater than zero is required.");
  }
  pfcSelections_ptr edges = resolveEdgeSelections(model, request.edgeIds);

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatRound, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.compound(wfcPRO_E_RNDCH_SETS, 1);
  builder.compound(wfcPRO_E_RNDCH_SET, 2);
  builder.intValue(wfcPRO_E_RNDCH_DIMENSIONAL_SCHEMA, 0, 3);
  builder.intValue(wfcPRO_E_RNDCH_CHAMFER_SHAPE, 0, 3);
  builder.intValue(wfcPRO_E_RNDCH_SHAPE_OPTIONS, 0, 3);
  builder.intValue(wfcPRO_E_RNDCH_VARIABLE_RADIUS, 0, 3);
  builder.compound(wfcPRO_E_RNDCH_COMPOUND_CONIC, 3);
  builder.intValue(wfcPRO_E_RNDCH_CONIC_TYPE, 0, 4);
  builder.doubleValue(wfcPRO_E_RNDCH_CONIC_VALUE, 0.0, 4);
  builder.intValue(wfcPRO_E_RNDCH_CONIC_DEP_OPT, 0, 4);
  builder.compound(wfcPRO_E_RNDCH_REFERENCES, 3);
  builder.intValue(wfcPRO_E_RNDCH_REFERENCE_TYPE,
                   kProRndchRefCurveCollection, 4);
  builder.collection(wfcPRO_E_STD_CURVE_COLLECTION_APPL,
                     edgeCurveCollection(edges), 4);
  builder.compound(wfcPRO_E_RNDCH_COMPOUND_SPINE, 3);
  builder.intValue(wfcPRO_E_RNDCH_BALL_SPINE, 0, 4);
  builder.compound(wfcPRO_E_RNDCH_COMPOUND_EXT_OPTIONS, 3);
  builder.intValue(wfcPRO_E_RNDCH_AUTO_BLEND, 0, 4);
  builder.compound(wfcPRO_E_RNDCH_RADII, 3);
  builder.compound(wfcPRO_E_RNDCH_RADIUS, 4);
  builder.compound(wfcPRO_E_RNDCH_LEG1, 5);
  builder.intValue(wfcPRO_E_RNDCH_LEG_TYPE, kProRoundRadiusTypeValue, 6);
  builder.doubleValue(wfcPRO_E_RNDCH_LEG_VALUE, request.radius, 6);
  builder.compound(wfcPRO_E_RNDCH_LEG2, 5);
  builder.intValue(wfcPRO_E_RNDCH_LEG_TYPE, kProRndchLegUnused, 6);
  builder.doubleValue(wfcPRO_E_RNDCH_LEG_VALUE, 0.0, 6);
  builder.intValue(wfcPRO_E_RNDCH_ATTACH_TYPE, 0, 1);
  builder.compound(wfcPRO_E_RNDCH_TRANSITIONS, 1);
  builder.intValue(wfcPRO_E_RNDCH_AUTO_CONTINUE, 0, 3);

  wfcWFeature_ptr feature =
      commitFeature(model, builder, "round", wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  return detailFeatureResult(
      model, featureId,
      {{"kind", "round"},
       {"edgeIds", request.edgeIds},
       {"radius", request.radius},
       {"featureName", request.featureName}});
}

nlohmann::json createChamferFeature(pfcModel_ptr model,
                                    const ChamferFeatureRequest& request) {
  if (!(request.distance1 > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A chamfer distance greater than zero is required.");
  }
  if (request.schema != kProChmSchema45xD &&
      request.schema != kProChmSchemaDxD &&
      request.schema != kProChmSchemaD1xD2 &&
      request.schema != kProChmSchemaAngxD) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Unsupported chamfer schema; use 601, 602, 603, or 604.");
  }
  if (request.schema == kProChmSchemaD1xD2 && !(request.distance2 > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A D1 x D2 chamfer requires a positive second distance.");
  }
  if (request.schema == kProChmSchemaAngxD &&
      !(request.angle > 0.0 && request.angle < 180.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "An ANG x D chamfer requires an angle in (0, 180).");
  }
  pfcSelections_ptr edges = resolveEdgeSelections(model, request.edgeIds);

  // PTC's UgEdgeChamferCreate sample builds chamfers from the round/chamfer
  // (RNDCH) element family: schema + shape + edge curve collection + legs.
  // LEG2 carries the second distance or the angle, depending on the schema.
  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatChamfer, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.compound(wfcPRO_E_RNDCH_SETS, 1);
  builder.compound(wfcPRO_E_RNDCH_SET, 2);
  builder.intValue(wfcPRO_E_RNDCH_DIMENSIONAL_SCHEMA, request.schema, 3);
  builder.intValue(wfcPRO_E_RNDCH_CHAMFER_SHAPE, kProChmShapeOffsetSurface, 3);
  builder.compound(wfcPRO_E_RNDCH_REFERENCES, 3);
  builder.collection(wfcPRO_E_STD_CURVE_COLLECTION_APPL,
                     edgeCurveCollection(edges), 4);
  builder.compound(wfcPRO_E_RNDCH_RADII, 3);
  builder.compound(wfcPRO_E_RNDCH_RADIUS, 4);
  builder.compound(wfcPRO_E_RNDCH_LEG1, 5);
  builder.intValue(wfcPRO_E_RNDCH_LEG_TYPE, kProRoundRadiusTypeValue, 6);
  builder.doubleValue(wfcPRO_E_RNDCH_LEG_VALUE, request.distance1, 6);
  if (request.schema == kProChmSchemaD1xD2) {
    builder.compound(wfcPRO_E_RNDCH_LEG2, 5);
    builder.intValue(wfcPRO_E_RNDCH_LEG_TYPE, kProRoundRadiusTypeValue, 6);
    builder.doubleValue(wfcPRO_E_RNDCH_LEG_VALUE, request.distance2, 6);
  } else if (request.schema == kProChmSchemaAngxD) {
    builder.compound(wfcPRO_E_RNDCH_LEG2, 5);
    builder.intValue(wfcPRO_E_RNDCH_LEG_TYPE, kProRoundRadiusTypeValue, 6);
    builder.doubleValue(wfcPRO_E_RNDCH_LEG_VALUE, request.angle, 6);
  }
  builder.intValue(wfcPRO_E_RNDCH_ATTACH_TYPE, 0, 1);
  builder.compound(wfcPRO_E_RNDCH_TRANSITIONS, 1);

  wfcWFeature_ptr feature =
      commitFeature(model, builder, "chamfer", wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  return detailFeatureResult(
      model, featureId,
      {{"kind", "chamfer"},
       {"edgeIds", request.edgeIds},
       {"schema", request.schema},
       {"distance1", request.distance1},
       {"distance2", request.distance2},
       {"angle", request.angle},
       {"featureName", request.featureName}});
}

nlohmann::json createShellFeature(pfcModel_ptr model,
                                  const ShellFeatureRequest& request) {
  if (!(request.thickness > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A shell thickness greater than zero is required.");
  }
  pfcSelections_ptr surfaces =
      resolveSurfaceSelections(model, request.surfaceIds);
  pfcModelItems_ptr bodies = model->ListItems(pfcITEM_BODY);
  const bool hasBody = bodies && bodies->getarraysize() > 0;
  const int bodyUse = hasBody ? kProBodyUseSelected : kProBodyUseNew;

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatShell, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.compound(kProEBody, 1);
  builder.intValue(kProEBodyUse, bodyUse, 2);
  if (bodyUse == kProBodyUseSelected && hasBody) {
    builder.selection(kProEBodySelect,
                      pfcCreateModelItemSelection(bodies->get(0)), 2);
  }
  builder.selections(wfcPRO_E_SHELL_SRF, surfaces, 1);
  builder.doubleValue(wfcPRO_E_SHELL_THICK, request.thickness, 1);
  builder.doubleValue(wfcPRO_E_STD_SMT_THICKNESS, 0.0, 1);
  builder.intValue(wfcPRO_E_STD_MATRLSIDE, 0, 1);
  builder.intValue(wfcPRO_E_STD_SMT_SWAP_DRV_SIDE, 0, 1);
  builder.intValue(wfcPRO_E_SHELL_FLIP, request.flip ? 1 : 0, 1);
  builder.compound(wfcPRO_E_ST_SHELL_LOCL_LIST, 1);
  builder.collection(wfcPRO_E_STD_SURF_COLLECTION_APPL,
                     wfcCollection::Create(), 1);
  builder.intValue(wfcPRO_E_SHELL_LACE_BNDRY, 0, 1);
  builder.intValue(wfcPRO_E_SHELL_ALT_CUT_METHOD, 0, 1);

  wfcWFeature_ptr feature =
      commitFeature(model, builder, "shell", wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  return detailFeatureResult(
      model, featureId,
      {{"kind", "shell"},
       {"surfaceIds", request.surfaceIds},
       {"thickness", request.thickness},
       {"flip", request.flip},
       {"featureName", request.featureName}});
}

namespace {

// ---------------------------------------------------------------------------
// Datum and hole features
//
// Element ids come from wfcElemIds.h; numeric values come from the Pro/TOOLKIT
// headers (ProDtmPln.h, ProDtmAxis.h, ProDtmPnt.h, ProHole.h, ProFeatType.h)
// and were confirmed against live Creo 9 element trees dumped with
// feature.tree (see scripts/payload-discovery.mjs).
// ---------------------------------------------------------------------------

const int kProFeatDatum = 923;        // PRO_FEAT_DATUM
const int kProFeatDatumAxis = 926;    // PRO_FEAT_DATUM_AXIS
const int kProFeatDatumPoint = 931;   // PRO_FEAT_DATUM_POINT
const int kProFeatHole = 911;         // PRO_FEAT_HOLE

const int kProDtmPlnThru = 0;         // PRO_DTMPLN_THRU
const int kProDtmPlnPrl = 2;          // PRO_DTMPLN_PRL
const int kProDtmPlnOffs = 3;         // PRO_DTMPLN_OFFS
const int kProDtmPlnAng = 4;          // PRO_DTMPLN_ANG
const int kProDtmPlnFlipYes = 1;      // PRO_DTMPLN_FLIP_DIR_YES

const int kProDtmAxisThru = 1;        // PRO_DTMAXIS_CONSTR_TYPE_THRU

const int kProDtmPntGeneral = -1;     // PRO_DPOINT_TYPE_GENERAL
const int kProDtmPntOn = 0;           // PRO_DTMPNT_CONSTR_TYPE_ON
const int kProDtmPntOffset = 1;       // PRO_DTMPNT_CONSTR_TYPE_OFFSET
const int kProDtmPntCenter = 2;       // PRO_DTMPNT_CONSTR_TYPE_CENTER
const int kProDtmPntRatio = 7;        // PRO_DTMPNT_CONSTR_TYPE_RATIO

const int kProHleStraight = 1;        // PRO_HLE_TYPE_STRAIGHT == PRO_EXTRUDE
const int kProHleNewStraight = 16;    // PRO_HLE_NEW_TYPE_STRAIGHT
const int kProHleBlindDepth = 1;      // PRO_HLE_STRGHT_BLIND_DEPTH
const int kProHleThruAllDepth = 3;    // PRO_HLE_STRGHT_THRU_ALL_DEPTH
const int kProHleSymDepth = 7;        // PRO_HLE_STRGHT_SYM_DEPTH
const int kProHleNoDepth = 6;         // PRO_HLE_STRGHT_NONE_DEPTH
const int kProHleNoThread = -1;       // PRO_HLE_NO_THREAD
const int kProHleNoCbore = -1;        // PRO_HLE_NO_CBORE
const int kProHleNoCsink = -1;        // PRO_HLE_NO_CSINK
const int kProHleRegular = -1;        // PRO_HLE_REGULAR
const int kProHleGenClearance = -1;   // PRO_HOLE_GEN_CLRNCE
const int kProHleCrSideOne = -1;      // PRO_HLE_CR_IN_SIDE_ONE
const int kProHlePlLin = 1;           // PRO_HLE_PL_TYPE_LIN
const int kProHlePlCoax = 5;          // PRO_HLE_PL_TYPE_COAX
const int kProHleAddCbore = 27;       // PRO_HLE_ADD_CBORE
const int kProHleAddCsink = 28;       // PRO_HLE_ADD_CSINK
const int kProHleDoNotAddNote = 0;    // PRO_HOLE_NO_NOTE_FLAG is 9; 0 = add
const int kProHleNoExitCsink = 0;     // PRO_HLE_NO_EXIT_CSINK value used by
                                      // native trees (not the enum -1)
const int kProHleCustomType = 7;      // PRO_HLE_CUSTOM_TYPE
const int kProHleStdVarDepth = 29;    // PRO_HLE_STD_VAR_DEPTH
const int kProHleStdThruAll = 31;     // PRO_HLE_STD_THRU_ALL_DEPTH
const int kProHleShoulderDim = -1;    // PRO_HLE_DEP_SHOULDER_DIM_SCHEME
const int kProHleTopClearance = -1;   // PRO_HOLE_GEN_CLRNCE (new value)
// PRO_E_HLE_TOP_CLEARANCE (6053) has no wfcPRO_E_* constant in the Creo 9
// headers; the id is taken from a native hole element tree (feature.tree).
const int kProEHleTopClearance = 6053;
// Same for the tapered-drill and hole-note elements (ids from native trees).
const int kProEHoleSkdpOptions = 6723;
const int kProEHleTaperedStrtDia = 6755;
const int kProEHleTaperedStrtDepth = 6756;
const int kProEHleTaperedTipAngle = 6757;
const int kProEHleTaperedStrtDepthOpt = 6758;
const int kProEHleAddTaperedTipAngle = 6765;
const int kProEHleFtDirOpt = 6052;  // PRO_E_HLE_FT_DIR_OPT

// Runs fn and returns `fallback` when the runtime throws an OTK exception.
// Local twin of the helper in read.cxx (kept out of its namespace on purpose).
template <typename Result, typename Fn>
Result guardedValue(Fn fn, Result fallback) {
  try {
    return fn();
  }
  xcatchbegin
    xcatchall { return fallback; }
  xcatchend
  catch (const std::exception&) {
    return fallback;
  }
  catch (...) {
    return fallback;
  }
}

pfcModelItem_ptr safeItemById(pfcModel_ptr model, pfcModelItemType type,
                              int id) {
  if (!model || id <= 0) {
    return nullptr;
  }
  try {
    return model->GetItemById(type, id);
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

template <typename Item>
pfcFeature_ptr ownerOfGeomItem(const Item& item) {
  if (!item) {
    return nullptr;
  }
  return guardedValue<pfcFeature_ptr>([&]() { return item->GetFeature(); },
                                      nullptr);
}

// Datum axes register their PRO_AXIS item near the feature; the exact offset
// varies with build state, so resolve by owner. ListItems returns real session
// items (GetItemById can hand back a handle whose GetId throws on this build),
// with a bounded GetItemById scan as fallback.
pfcModelItem_ptr findDatumAxisItem(pfcModel_ptr model, pfcFeature_ptr feature) {
  if (!model || !feature) {
    return nullptr;
  }
  const int featureId = static_cast<int>(feature->GetId());
  pfcModelItems_ptr items = guardedValue<pfcModelItems_ptr>(
      [&]() { return model->ListItems(pfcITEM_AXIS); }, nullptr);
  if (items) {
    const int count = items->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcAxis_ptr axis = pfcAxis::cast(items->get(i));
      pfcFeature_ptr owner = ownerOfGeomItem(axis);
      if (owner && static_cast<int>(owner->GetId()) == featureId) {
        return items->get(i);
      }
    }
  }
  const auto ownedBy = [&](int id) -> bool {
    pfcAxis_ptr axis = pfcAxis::cast(safeItemById(model, pfcITEM_AXIS, id));
    pfcFeature_ptr owner = ownerOfGeomItem(axis);
    return owner && static_cast<int>(owner->GetId()) == featureId;
  };
  const int candidates[] = {featureId + 1, featureId + 2, featureId,
                            featureId + 3, featureId - 1};
  for (const int id : candidates) {
    if (id > 0 && ownedBy(id)) {
      return safeItemById(model, pfcITEM_AXIS, id);
    }
  }
  for (int id = featureId + 4; id <= featureId + 64; ++id) {
    if (ownedBy(id)) {
      return safeItemById(model, pfcITEM_AXIS, id);
    }
  }
  return nullptr;
}

int findDatumAxisId(pfcModel_ptr model, pfcFeature_ptr feature) {
  pfcModelItem_ptr item = findDatumAxisItem(model, feature);
  if (!item) {
    return -1;
  }
  return guardedValue<int>([&]() { return static_cast<int>(item->GetId()); },
                          -1);
}

// Same idea for datum points: the PRO_POINT item belongs to the feature.
int findDatumPointId(pfcModel_ptr model, pfcFeature_ptr feature) {
  if (!model || !feature) {
    return -1;
  }
  const int featureId = static_cast<int>(feature->GetId());
  const auto ownedBy = [&](int id) -> bool {
    pfcModelItem_ptr item = safeItemById(model, pfcITEM_POINT, id);
    pfcPoint_ptr point = pfcPoint::cast(item);
    pfcFeature_ptr owner = ownerOfGeomItem(point);
    return owner && static_cast<int>(owner->GetId()) == featureId;
  };
  const int candidates[] = {featureId + 1, featureId + 2, featureId,
                            featureId + 3, featureId - 1};
  for (const int id : candidates) {
    if (id <= 0) {
      continue;
    }
    if (ownedBy(id)) {
      return id;
    }
  }
  for (int id = featureId + 4; id <= featureId + 64; ++id) {
    if (ownedBy(id)) {
      return id;
    }
  }
  return -1;
}

// Resolve a datum axis to the selection the hole placement stores: either by
// explicit PRO_AXIS item id, by datum axis feature id, or by feature name.
pfcSelection_ptr resolveAxisSelection(pfcModel_ptr model, int axisId,
                                      int axisFeatureId,
                                      const std::string& featureName,
                                      const char* role) {
  if (axisId > 0) {
    pfcModelItem_ptr item = safeItemById(model, pfcITEM_AXIS, axisId);
    if (!item) {
      // Some builds do not resolve axes by id; fall back to a list scan.
      pfcModelItems_ptr items = guardedValue<pfcModelItems_ptr>(
          [&]() { return model->ListItems(pfcITEM_AXIS); }, nullptr);
      if (items) {
        const int count = items->getarraysize();
        for (int i = 0; i < count; ++i) {
          pfcModelItem_ptr candidate = items->get(i);
          if (candidate &&
              static_cast<int>(candidate->GetId()) == axisId) {
            item = candidate;
            break;
          }
        }
      }
    }
    if (!item || !pfcAxis::cast(item)) {
      throw BridgeError("NOT_FOUND", std::string(role) + " axis " +
                                        std::to_string(axisId) +
                                        " is not present in the model.");
    }
    return pfcCreateModelItemSelection(item);
  }

  pfcModelItem_ptr item = nullptr;
  if (axisFeatureId > 0 || !featureName.empty()) {
    pfcFeature_ptr feature = axisFeatureId > 0
                                 ? findFeatureById(model, axisFeatureId)
                                 : findFeatureByName(model, featureName);
    if (!feature) {
      throw BridgeError("NOT_FOUND",
                        std::string(role) + " datum axis was not found in the "
                                            "model (give its feature name or "
                                            "PRO_AXIS id).");
    }
    item = findDatumAxisItem(model, feature);
  }
  if (!item || !pfcAxis::cast(item)) {
    throw BridgeError("NOT_FOUND",
                      std::string(role) +
                          " datum axis has no resolvable axis item.");
  }
  return pfcCreateModelItemSelection(item);
}

pfcSelection_ptr resolvePointSelection(pfcModel_ptr model, int pointId,
                                       const char* role) {
  pfcModelItem_ptr item = safeItemById(model, pfcITEM_POINT, pointId);
  if (!item) {
    pfcModelItems_ptr items = guardedValue<pfcModelItems_ptr>(
        [&]() { return model->ListItems(pfcITEM_POINT); }, nullptr);
    if (items) {
      const int count = items->getarraysize();
      for (int i = 0; i < count; ++i) {
        pfcModelItem_ptr candidate = items->get(i);
        if (candidate && static_cast<int>(candidate->GetId()) == pointId) {
          item = candidate;
          break;
        }
      }
    }
  }
  if (!item || !pfcPoint::cast(item)) {
    throw BridgeError("NOT_FOUND", std::string(role) + " point " +
                                      std::to_string(pointId) +
                                      " is not present in the model.");
  }
  return pfcCreateModelItemSelection(item);
}

// The reference selection for a datum/hole constraint: a datum plane (name,
// feature id), a PRO_SURFACE id, or (for through constraints) an edge.
pfcSelection_ptr resolveDatumReference(pfcModel_ptr model,
                                       const std::string& name,
                                       int surfaceId, int featureId,
                                       int edgeId, const char* role) {
  if (edgeId > 0) {
    return resolveEdgeSelection(model, edgeId);
  }
  pfcSelection_ptr selection =
      resolvePlaneSelection(model, name, surfaceId, featureId, role);
  if (!selection) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string(role) +
                          " requires a datum plane name, surface id, or edge "
                          "id.");
  }
  return selection;
}

std::string featureNameOf(pfcFeature_ptr feature) {
  if (!feature) {
    return std::string();
  }
  const xstring name = feature->GetName();
  return name.IsNull() ? std::string() : toUtf8(name);
}

nlohmann::json datumFeatureResult(pfcModel_ptr model, int featureId,
                                  const nlohmann::json& request,
                                  const nlohmann::json& datum) {
  nlohmann::json out;
  out["model"] = describeModelInfo(model);
  pfcFeature_ptr created = findFeatureById(model, featureId);
  out["feature"] = created ? describeFeatureEntry(created)
                           : nlohmann::json{{"id", featureId}};
  out["geometry"] = describeGeometry(model);
  out["massProperties"] = describeMassProperties(model, std::string());
  out["request"] = request;
  if (!datum.is_null() && !datum.empty()) {
    out["datum"] = datum;
  }
  return out;
}

// Datum features (and a freshly created hole) can come back unregenerated
// when Creo defers the regeneration to the next model update. Run that update
// so the returned feature status and geometry are current.
pfcFeature_ptr ensureActiveFeature(pfcModel_ptr model, int featureId) {
  pfcFeature_ptr feature = findFeatureById(model, featureId);
  if (feature && feature->GetStatus() != pfcFEAT_ACTIVE) {
    runStage("RegenerateAfterFeature", [&]() {
      regenerateModel(model);
      return 0;
    });
    feature = findFeatureById(model, featureId);
  }
  return feature;
}

}  // namespace

nlohmann::json createDatumPlaneFeature(pfcModel_ptr model,
                                       const DatumPlaneRequest& request) {
  int constraintType = kProDtmPlnOffs;
  if (request.type == "offset") {
    constraintType = kProDtmPlnOffs;
  } else if (request.type == "through") {
    constraintType = kProDtmPlnThru;
  } else if (request.type == "parallel" || request.type == "angle") {
    // The parallel/angle payloads are not settled yet: a lone parallel
    // constraint never regenerates, and an angle payload with the through
    // constraint first puts Creo into an interactive wait. Reject them until a
    // native fixture tree settles the payload.
    throw BridgeError("INVALID_ARGUMENT",
                      "Angle and parallel datum plane constraints are not "
                      "implemented yet; use offset or through.");
  } else {
    throw BridgeError("INVALID_ARGUMENT",
                      "Datum plane type must be offset or through.");
  }
  if (constraintType != kProDtmPlnThru && request.referenceEdgeId > 0) {
    throw BridgeError("INVALID_ARGUMENT",
                      "An edge reference is only valid for a through datum "
                      "plane.");
  }

  pfcSelection_ptr reference = resolveDatumReference(
      model, request.reference, request.referenceSurfaceId,
      request.referenceFeatureId, request.referenceEdgeId,
      "Datum plane reference");

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatDatum, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.compound(wfcPRO_E_DTMPLN_CONSTRAINTS, 1);
  builder.compound(wfcPRO_E_DTMPLN_CONSTRAINT, 2);
  builder.intValue(wfcPRO_E_DTMPLN_CONSTR_TYPE, constraintType, 3);
  builder.selection(wfcPRO_E_DTMPLN_CONSTR_REF, reference, 3);
  if (constraintType == kProDtmPlnOffs) {
    builder.doubleValue(wfcPRO_E_DTMPLN_CONSTR_REF_OFFSET, request.distance, 3);
  }
  if (request.flip) {
    builder.intValue(wfcPRO_E_DTMPLN_FLIP_DIR, kProDtmPlnFlipYes, 1);
  }

  wfcWFeature_ptr feature =
      commitFeature(model, builder, "datum plane", wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  pfcFeature_ptr created = ensureActiveFeature(model, featureId);

  nlohmann::json datum;
  datum["featureId"] = featureId;
  const std::string name = featureNameOf(created);
  if (!name.empty()) {
    datum["name"] = name;
  }
  pfcModelItem_ptr surface = findDatumSurfaceItem(model, created);
  if (surface) {
    datum["surfaceId"] = static_cast<int>(surface->GetId());
  }
  return datumFeatureResult(
      model, featureId,
      {{"kind", "datum_plane"},
       {"type", request.type},
       {"reference", request.reference},
       {"referenceSurfaceId", request.referenceSurfaceId},
       {"distance", request.distance},
       {"angle", request.angle},
       {"flip", request.flip},
       {"featureName", request.featureName}},
      datum);
}

nlohmann::json createDatumAxisFeature(pfcModel_ptr model,
                                      const DatumAxisRequest& request) {
  pfcSelections_ptr selections = pfcSelections::create();
  if (request.type == "twoPlanes") {
    selections->append(resolveDatumReference(
        model, request.plane1, request.plane1SurfaceId,
        request.plane1FeatureId, -1, "Datum axis plane 1"));
    selections->append(resolveDatumReference(
        model, request.plane2, request.plane2SurfaceId,
        request.plane2FeatureId, -1, "Datum axis plane 2"));
  } else if (request.type == "edge") {
    if (request.edgeId <= 0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "An edge datum axis requires an edgeId.");
    }
    selections->append(resolveEdgeSelection(model, request.edgeId));
  } else if (request.type == "surface") {
    if (request.surfaceId <= 0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A surface datum axis requires a surfaceId.");
    }
    pfcModelItem_ptr item = safeSurfaceItem(model, request.surfaceId);
    if (!item || !pfcSurface::cast(item)) {
      throw BridgeError("NOT_FOUND", "Surface " +
                                        std::to_string(request.surfaceId) +
                                        " is not present in the model.");
    }
    selections->append(pfcCreateModelItemSelection(item));
  } else if (request.type == "twoPoints") {
    selections->append(resolvePointSelection(model, request.point1Id,
                                             "Datum axis point 1"));
    selections->append(resolvePointSelection(model, request.point2Id,
                                             "Datum axis point 2"));
  } else {
    throw BridgeError("INVALID_ARGUMENT",
                      "Datum axis type must be twoPlanes, edge, surface, or "
                      "twoPoints.");
  }

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatDatumAxis, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.compound(wfcPRO_E_DTMAXIS_CONSTRAINTS, 1);
  // Both two-plane and two-point axes are two THRU constraints; a single
  // reference (edge or cylindrical surface) is one THRU constraint.
  if (request.type == "twoPlanes" || request.type == "twoPoints") {
    for (int i = 0; i < 2; ++i) {
      builder.compound(wfcPRO_E_DTMAXIS_CONSTRAINT, 2);
      builder.intValue(wfcPRO_E_DTMAXIS_CONSTR_TYPE, kProDtmAxisThru, 3);
      builder.selection(wfcPRO_E_DTMAXIS_CONSTR_REF, selections->get(i), 3);
    }
  } else {
    builder.compound(wfcPRO_E_DTMAXIS_CONSTRAINT, 2);
    builder.intValue(wfcPRO_E_DTMAXIS_CONSTR_TYPE, kProDtmAxisThru, 3);
    builder.selection(wfcPRO_E_DTMAXIS_CONSTR_REF, selections->get(0), 3);
  }
  builder.compound(wfcPRO_E_DTMAXIS_FIT, 1);
  builder.intValue(wfcPRO_E_DTMAXIS_FIT_TYPE, 0, 2);
  builder.doubleValue(wfcPRO_E_DTMAXIS_FIT_LEN, 0.0, 2);

  wfcWFeature_ptr feature = commitFeature(model, builder, "datum axis",
                                          wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());

  return runStage("DatumAxisResult", [&]() -> nlohmann::json {
    nlohmann::json datum;
    datum["featureId"] = featureId;
    pfcFeature_ptr created = ensureActiveFeature(model, featureId);
    const std::string name = featureNameOf(created);
    if (!name.empty()) {
      datum["name"] = name;
    }
    const int axisId = findDatumAxisId(model, created);
    if (axisId > 0) {
      datum["axisId"] = axisId;
    }
    return datumFeatureResult(
        model, featureId,
        {{"kind", "datum_axis"},
         {"type", request.type},
         {"plane1", request.plane1},
         {"plane2", request.plane2},
         {"edgeId", request.edgeId},
         {"surfaceId", request.surfaceId},
         {"point1Id", request.point1Id},
         {"point2Id", request.point2Id},
         {"featureName", request.featureName}},
        datum);
  });
}

nlohmann::json createDatumPointFeature(pfcModel_ptr model,
                                       const DatumPointRequest& request) {
  pfcSelection_ptr reference;
  int placementType = kProDtmPntOn;
  if (request.type == "onSurface") {
    if (request.surfaceId <= 0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "An onSurface datum point requires a surfaceId.");
    }
    pfcModelItem_ptr item = safeSurfaceItem(model, request.surfaceId);
    if (!item || !pfcSurface::cast(item)) {
      throw BridgeError("NOT_FOUND", "Surface " +
                                        std::to_string(request.surfaceId) +
                                        " is not present in the model.");
    }
    reference = pfcCreateModelItemSelection(item);
    placementType = kProDtmPntOn;
  } else if (request.type == "onEdge" || request.type == "edgeCenter") {
    if (request.edgeId <= 0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "An edge datum point requires an edgeId.");
    }
    reference = resolveEdgeSelection(model, request.edgeId);
    placementType =
        request.type == "edgeCenter" ? kProDtmPntCenter : kProDtmPntOn;
  } else {
    throw BridgeError("INVALID_ARGUMENT",
                      "Datum point type must be onSurface, onEdge, or "
                      "edgeCenter.");
  }

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatDatumPoint, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.intValue(wfcPRO_E_DPOINT_TYPE, kProDtmPntGeneral, 1);
  builder.compound(wfcPRO_E_DPOINT_POINTS_ARRAY, 1);
  builder.compound(wfcPRO_E_DPOINT_POINT, 2);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_DPOINT_POINT_NAME, request.featureName, 3);
  }
  builder.compound(wfcPRO_E_DPOINT_PLA_CONSTRAINTS, 3);
  builder.compound(wfcPRO_E_DPOINT_PLA_CONSTRAINT, 4);
  builder.selection(wfcPRO_E_DPOINT_PLA_CONSTR_REF, reference, 5);
  builder.intValue(wfcPRO_E_DPOINT_PLA_CONSTR_TYPE, placementType, 5);
  builder.doubleValue(wfcPRO_E_DPOINT_PLA_CONSTR_VAL, 0.0, 5);
  if (request.type == "onEdge") {
    builder.compound(wfcPRO_E_DPOINT_DIM_CONSTRAINTS, 3);
    builder.compound(wfcPRO_E_DPOINT_DIM_CONSTRAINT, 4);
    builder.selection(wfcPRO_E_DPOINT_DIM_CONSTR_REF, reference, 5);
    builder.intValue(wfcPRO_E_DPOINT_DIM_CONSTR_TYPE, kProDtmPntRatio, 5);
    builder.doubleValue(wfcPRO_E_DPOINT_DIM_CONSTR_VAL, request.ratio, 5);
  }

  wfcWFeature_ptr feature = commitFeature(model, builder, "datum point",
                                          wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  pfcFeature_ptr created = ensureActiveFeature(model, featureId);

  nlohmann::json datum;
  datum["featureId"] = featureId;
  const std::string name = featureNameOf(created);
  if (!name.empty()) {
    datum["name"] = name;
  }
  const int pointId = findDatumPointId(model, created);
  if (pointId > 0) {
    datum["pointId"] = pointId;
  }  return datumFeatureResult(
      model, featureId,
      {{"kind", "datum_point"},
       {"type", request.type},
       {"surfaceId", request.surfaceId},
       {"edgeId", request.edgeId},
       {"ratio", request.ratio},
       {"featureName", request.featureName}},
      datum);
}

nlohmann::json createHoleFeature(pfcModel_ptr model,
                                  const HoleFeatureRequest& request) {
  if (!(request.diameter > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A hole diameter greater than zero is required.");
  }
  const bool blind = request.depth == "blind";
  const bool through = request.depth == "through";
  const bool symmetric = request.depth == "symmetric";
  if (!blind && !through && !symmetric) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Hole depth must be blind, through, or symmetric.");
  }
  if (blind && !(request.depthValue > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A blind hole requires a positive depth value.");
  }
  if (symmetric && !(request.depthValue > 0.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A symmetric hole requires a positive depth value.");
  }

  const bool counterbore = request.head == "counterbore";
  const bool countersink = request.head == "countersink";
  if (counterbore) {
    if (!(request.headDiameter > request.diameter)) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A counterbore diameter must be larger than the hole "
                        "diameter.");
    }
    if (!(request.headDepth > 0.0)) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A counterbore requires a positive depth.");
    }
  }
  if (countersink &&
      !(request.headDiameter > request.diameter &&
        request.headAngle > 0.0 && request.headAngle < 180.0)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A countersink requires a diameter larger than the hole "
                      "and an angle in (0, 180).");
  }

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatHole, 1);
  builder.intValue(wfcPRO_E_FEATURE_FORM, kProHleStraight, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }

  // Element set mirrors Creo 9's own hole trees (dumped with feature.tree from
  // native features). A counterbore/countersink uses the custom-hole form:
  // PRO_E_HLE_TYPE_NEW = custom, the head flags, head dimensions, and
  // PRO_E_HLE_DEPTH; the drill diameter lives in PRO_E_HLE_HOLEDIAM.
  const bool custom = counterbore || countersink;
  builder.compound(wfcPRO_E_HLE_COM, 1);
  builder.intValue(wfcPRO_E_HLE_TYPE_NEW,
                   custom ? kProHleCustomType : kProHleNewStraight, 2);
  builder.intValue(wfcPRO_E_HLE_STAN_TYPE, 0, 2);
  builder.intValue(wfcPRO_E_HLE_THRDSERIS, 4, 2);
  builder.intValue(wfcPRO_E_HLE_FITTYPE, 0, 2);
  builder.intValue(wfcPRO_E_HLE_SCREWSIZE, 0, 2);
  builder.intValue(wfcPRO_E_HLE_ADD_THREAD, kProHleNoThread, 2);
  builder.intValue(wfcPRO_E_HLE_ADD_CBORE,
                   counterbore ? kProHleAddCbore : kProHleNoCbore, 2);
  builder.intValue(wfcPRO_E_HLE_ADD_CSINK,
                   countersink ? kProHleAddCsink : kProHleNoCsink, 2);
  builder.intValue(wfcPRO_E_HLE_MAKE_LIGHTWT, kProHleRegular, 2);
  builder.doubleValue(custom ? wfcPRO_E_HLE_HOLEDIAM : wfcPRO_E_DIAMETER,
                      request.diameter, 2);
  builder.compound(wfcPRO_E_HOLE_STD_DEPTH, 2);
  builder.compound(wfcPRO_E_HOLE_DEPTH_TO, 3);
  builder.intValue(wfcPRO_E_HOLE_DEPTH_TO_TYPE,
                   blind ? kProHleBlindDepth
                         : (symmetric ? kProHleSymDepth : kProHleThruAllDepth),
                   4);
  // The symmetric depth rides on the "to" side; Creo zeroes a value written to
  // the "from" side for this depth type.
  builder.doubleValue(wfcPRO_E_EXT_DEPTH_TO_VALUE,
                      blind || symmetric ? request.depthValue : 0.0, 4);
  builder.compound(wfcPRO_E_HOLE_DEPTH_FROM, 3);
  // For a symmetric hole the value moves to the "from" side (ProHole.h
  // note 6); every other form has no second side.
  builder.intValue(wfcPRO_E_HOLE_DEPTH_FROM_TYPE, kProHleNoDepth, 4);
  builder.doubleValue(wfcPRO_E_EXT_DEPTH_FROM_VALUE, 0.0, 4);
  if (custom) {
    builder.intValue(wfcPRO_E_HLE_DEPTH,
                     blind ? kProHleStdVarDepth : kProHleStdThruAll, 2);
    builder.intValue(wfcPRO_E_HLE_DEPTH_DIM_TYPE, kProHleShoulderDim, 2);
    builder.doubleValue(wfcPRO_E_HLE_DRILLANGLE, request.drillAngle, 2);
    builder.doubleValue(wfcPRO_E_HLE_DRILLDEPTH, request.depthValue, 2);
  } else {
    builder.doubleValue(wfcPRO_E_HLE_HOLEDIAM, 0.0, 2);
    builder.intValue(wfcPRO_E_HLE_DEPTH, 0, 2);
    builder.intValue(wfcPRO_E_HLE_DEPTH_DIM_TYPE, 0, 2);
    builder.doubleValue(wfcPRO_E_HLE_DRILLANGLE, 0.0, 2);
    builder.doubleValue(wfcPRO_E_HLE_DRILLDEPTH, 0.0, 2);
  }
  builder.doubleValue(wfcPRO_E_HLE_CSINKANGLE,
                      countersink ? request.headAngle : 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_CBOREDEPTH,
                      counterbore ? request.headDepth : 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_CBOREDIAM,
                      counterbore ? request.headDiameter : 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_CSINKDIAM,
                      countersink ? request.headDiameter : 0.0, 2);
  builder.intValue(wfcPRO_E_HLE_THRD_DEPTH, 0, 2);
  builder.doubleValue(wfcPRO_E_HLE_THRDDEPTH, 0.0, 2);
  builder.intValue(kProEHleTaperedStrtDepthOpt, 0, 2);
  builder.intValue(kProEHleAddTaperedTipAngle, 0, 2);
  builder.doubleValue(kProEHleTaperedStrtDia, 0.0, 2);
  builder.doubleValue(kProEHleTaperedStrtDepth, 0.0, 2);
  builder.doubleValue(kProEHleTaperedTipAngle, 0.0, 2);
  builder.intValue(wfcPRO_E_HLE_CRDIR_FLIP, kProHleCrSideOne, 2);
  builder.intValue(wfcPRO_E_HLE_ADD_EXIT_CSINK, kProHleNoExitCsink, 2);
  builder.doubleValue(wfcPRO_E_HLE_EXIT_CSINKDIAM, 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_EXIT_CSINKANGLE, 0.0, 2);
  builder.intValue(wfcPRO_E_HLE_ADD_NOTE, kProHleDoNotAddNote, 2);
  builder.intValue(kProEHleTopClearance, kProHleTopClearance, 2);

  builder.compound(wfcPRO_E_HLE_PLACEMENT, 1);
  if (request.placement == "coaxial") {
    pfcSelection_ptr axis = resolveAxisSelection(
        model, request.axisId, request.axisFeatureId, request.axis,
        "Hole coaxial");
    // Native Creo 9 coaxial holes store the entry surface in PRIM_REF and the
    // axis in PRO_E_HLE_AXIS (placement case G). Without an explicit surface
    // the axis itself is stored as the primary reference (case F).
    pfcSelection_ptr placement = nullptr;
    if (request.planeSurfaceId > 0 || request.planeFeatureId > 0 ||
        !request.plane.empty()) {
      placement = resolveDatumReference(
          model, request.plane, request.planeSurfaceId, request.planeFeatureId,
          -1, "Hole placement surface");
    }
    builder.selection(wfcPRO_E_HLE_PRIM_REF, placement ? placement : axis, 2);
    builder.intValue(wfcPRO_E_HLE_PL_TYPE, kProHlePlCoax, 2);
    builder.intValue(kProEHoleSkdpOptions, 0, 2);
    builder.intValue(wfcPRO_E_HLE_PLC_ALIGN_OPT1, 0, 2);
    builder.doubleValue(wfcPRO_E_HLE_DIM_DIST1, 0.0, 2);
    builder.intValue(wfcPRO_E_HLE_PLC_ALIGN_OPT2, 0, 2);
    builder.doubleValue(wfcPRO_E_HLE_DIM_DIST2, 0.0, 2);
    builder.selection(wfcPRO_E_HLE_AXIS, axis, 2);
  } else if (request.placement == "linear") {
    pfcSelection_ptr plane = resolveDatumReference(
        model, request.plane, request.planeSurfaceId, request.planeFeatureId,
        -1, "Hole placement plane");
    pfcSelection_ptr ref1 = resolveDatumReference(
        model, request.ref1, request.ref1SurfaceId, request.ref1FeatureId,
        request.ref1EdgeId, "Hole dimension reference 1");
    pfcSelection_ptr ref2 = resolveDatumReference(
        model, request.ref2, request.ref2SurfaceId, request.ref2FeatureId,
        request.ref2EdgeId, "Hole dimension reference 2");
    builder.selection(wfcPRO_E_HLE_PRIM_REF, plane, 2);
    builder.intValue(wfcPRO_E_HLE_PL_TYPE, kProHlePlLin, 2);
    builder.intValue(kProEHoleSkdpOptions, 0, 2);
    builder.selection(wfcPRO_E_HLE_DIM_REF1, ref1, 2);
    builder.intValue(wfcPRO_E_HLE_PLC_ALIGN_OPT1, 0, 2);
    builder.doubleValue(wfcPRO_E_HLE_DIM_DIST1, request.offset1, 2);
    builder.selection(wfcPRO_E_HLE_DIM_REF2, ref2, 2);
    builder.intValue(wfcPRO_E_HLE_PLC_ALIGN_OPT2, 0, 2);
    builder.doubleValue(wfcPRO_E_HLE_DIM_DIST2, request.offset2, 2);
  } else {
    throw BridgeError("INVALID_ARGUMENT",
                      "Hole placement must be linear or coaxial.");
  }
  builder.doubleValue(wfcPRO_E_HLE_REF_ANG, 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_DIM_DIA, 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_DIM_RAD, 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_DIM_LIN, 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_NORM_OFFST, 0.0, 2);
  builder.doubleValue(wfcPRO_E_HLE_REF_ANG_1, 0.0, 2);
  builder.intValue(kProEHleFtDirOpt, 0, 2);

  pfcModelItems_ptr bodies = model->ListItems(pfcITEM_BODY);
  const bool hasBody = bodies && bodies->getarraysize() > 0;
  const int bodyUse = hasBody ? kProBodyUseSelected : kProBodyUseNew;
  builder.compound(kProEBody, 1);
  builder.intValue(kProEBodyUse, bodyUse, 2);
  if (bodyUse == kProBodyUseSelected && hasBody) {
    builder.selection(kProEBodySelect,
                      pfcCreateModelItemSelection(bodies->get(0)), 2);
  }

  wfcWFeature_ptr feature =
      commitFeature(model, builder, "hole", wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  ensureActiveFeature(model, featureId);
  return detailFeatureResult(
      model, featureId,
      {{"kind", "hole"},
       {"placement", request.placement},
       {"plane", request.plane},
       {"ref1", request.ref1},
       {"ref2", request.ref2},
       {"offset1", request.offset1},
       {"offset2", request.offset2},
       {"axis", request.axis},
       {"diameter", request.diameter},
       {"depth", request.depth},
       {"depthValue", request.depthValue},
       {"head", request.head},
       {"headDiameter", request.headDiameter},
       {"headDepth", request.headDepth},
       {"headAngle", request.headAngle},
       {"featureName", request.featureName}});
}

namespace {

// Pattern and mirror values come from ProPattern.h, ProMirror.h, and
// ProFeatType.h in the Creo 9 SDK. The OTK headers expose the element ids but
// not these Pro/TOOLKIT enum values.
const int kProGenPatDimDriven = 1;       // PRO_GENPAT_DIM_DRIVEN
const int kProGenPatDirDriven = 5;       // PRO_GENPAT_DIR_DRIVEN
const int kProGenPatAxisDriven = 6;      // PRO_GENPAT_AXIS_DRIVEN
const int kProPatGeneral = 4;            // PRO_PAT_GENERAL
const int kProPatTranslational = -1;     // PRO_GENPAT_TRANSLATIONAL
const int kProSurfTransMirror = 1;       // PRO_SURF_TRANS_TYPE_MIRROR
const int kProFeatSurfaceModel = 950;    // PRO_FEAT_SRF_MDL
const int kProMirrorKeepOriginal = 0;   // PRO_MIRROR_KEEP_ORIGINAL

pfcSelection_ptr resolvePatternReferenceSelection(
    pfcModel_ptr model, const PatternReferenceRequest& reference,
    const char* role) {
  if (reference.axisId > 0 || reference.axisFeatureId > 0) {
    return resolveAxisSelection(model, reference.axisId,
                                reference.axisFeatureId, reference.name, role);
  }
  if (reference.edgeId > 0) {
    return resolveEdgeSelection(model, reference.edgeId);
  }
  if (reference.surfaceId > 0) {
    pfcModelItem_ptr item = safeSurfaceItem(model, reference.surfaceId);
    if (!item || !pfcSurface::cast(item)) {
      throw BridgeError("NOT_FOUND", std::string(role) + " surface " +
                                        std::to_string(reference.surfaceId) +
                                        " is not present in the model.");
    }
    return pfcCreateModelItemSelection(item);
  }
  if (reference.featureId > 0) {
    pfcFeature_ptr feature = findFeatureById(model, reference.featureId);
    if (!feature) {
      throw BridgeError("NOT_FOUND", std::string(role) + " feature " +
                                        std::to_string(reference.featureId) +
                                        " is not present in the model.");
    }
    const std::string type = toUtf8(feature->GetFeatTypeName());
    if (type.find("AXIS") != std::string::npos) {
      return resolveAxisSelection(model, -1, reference.featureId,
                                  std::string(), role);
    }
    pfcModelItem_ptr surface = findDatumSurfaceItem(model, feature);
    pfcModelItem_ptr item =
        surface ? surface : pfcModelItem::cast(feature);
    return pfcCreateModelItemSelection(item);
  }
  if (!reference.name.empty()) {
    pfcFeature_ptr feature = findFeatureByName(model, reference.name);
    if (feature) {
      const std::string type = toUtf8(feature->GetFeatTypeName());
      if (type.find("AXIS") != std::string::npos) {
        return resolveAxisSelection(model, -1, -1, reference.name, role);
      }
    }
    return resolvePlaneSelection(model, reference.name, -1, -1, role);
  }
  throw BridgeError("INVALID_ARGUMENT", std::string(role) +
                                        " requires a reference.");
}

// The public request stores only ids/names. The creator resolves each
// reference before calling this tree-building helper.
void addDirectionPatternElements(ElementBuilder& builder,
                                 const PatternDirectionRequest& direction,
                                 bool first, pfcSelection_ptr selection) {
  const int dirId = first ? wfcPRO_E_GENPAT_DIR1 : wfcPRO_E_GENPAT_DIR2;
  const int optionId = first ? wfcPRO_E_DIR_PAT_DIR1_OPT
                             : wfcPRO_E_DIR_PAT_DIR2_OPT;
  const int flipId = first ? wfcPRO_E_DIR_PAT_DIR1_FLIP
                           : wfcPRO_E_DIR_PAT_DIR2_FLIP;
  const int incrementId = first ? wfcPRO_E_GENPAT_DIR1_INC
                                : wfcPRO_E_GENPAT_DIR2_INC;
  const int dimensionsId = first ? wfcPRO_E_GENPAT_DIM_FIRST_DIR
                                 : wfcPRO_E_GENPAT_DIM_SECOND_DIR;
  const int instancesId = first
                              ? wfcPRO_E_GENPAT_DIM_FIRST_DIR_NUM_INST
                              : wfcPRO_E_GENPAT_DIM_SECOND_DIR_NUM_INST;

  builder.compound(dirId, 2);
  builder.compound(wfcPRO_E_DIRECTION_COMPOUND, 3);
  builder.selection(wfcPRO_E_DIRECTION_REFERENCE, selection, 4);
  builder.intValue(wfcPRO_E_DIRECTION_FLIP, 0, 4);
  builder.doubleValue(incrementId, direction.spacing, 2);
  builder.intValue(flipId, direction.flip ? 1 : 0, 2);
  builder.intValue(optionId, kProPatTranslational, 2);
  builder.compound(dimensionsId, 2);
  builder.intValue(instancesId, direction.count, 2);
}

void addEmptySecondDirection(ElementBuilder& builder) {
  builder.compound(wfcPRO_E_GENPAT_DIM_SECOND_DIR, 2);
  builder.intValue(wfcPRO_E_GENPAT_DIM_SECOND_DIR_NUM_INST, 1, 2);
}

pfcFeaturePattern_ptr safeFeaturePattern(pfcFeature_ptr feature) {
  if (!feature) {
    return nullptr;
  }
  try {
    return feature->GetPattern();
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

pfcFeatures_ptr safeFeatureChildren(pfcFeature_ptr feature) {
  if (!feature) {
    return nullptr;
  }
  try {
    return feature->ListChildren();
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

nlohmann::json describeFeatureSequence(pfcFeatures_ptr features,
                                       std::vector<int>& ids) {
  nlohmann::json out = nlohmann::json::array();
  if (!features) {
    return out;
  }
  const int count = features->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcFeature_ptr feature = pfcFeature::cast(features->get(i));
    if (!feature) {
      continue;
    }
    const int id = static_cast<int>(feature->GetId());
    if (std::find(ids.begin(), ids.end(), id) != ids.end()) {
      continue;
    }
    ids.push_back(id);
    out.push_back(describeFeatureEntry(feature));
  }
  return out;
}

nlohmann::json patternMembers(pfcFeature_ptr seed, pfcFeature_ptr created,
                              int& instanceCount) {
  std::vector<int> ids;
  nlohmann::json members = nlohmann::json::array();
  pfcFeaturePattern_ptr pattern = safeFeaturePattern(seed);
  if (!pattern) {
    pattern = safeFeaturePattern(created);
  }
  if (pattern) {
    pfcFeatures_ptr listed = nullptr;
    try {
      listed = pattern->ListMembers();
    }
    xcatchbegin
      xcatchall { listed = nullptr; }
    xcatchend
    catch (...) {
      listed = nullptr;
    }
    members = describeFeatureSequence(listed, ids);

    bool hasLeader = false;
    try {
      pfcFeature_ptr leader = pattern->GetPatternLeader();
      if (leader) {
        hasLeader = std::find(ids.begin(), ids.end(),
                              static_cast<int>(leader->GetId())) != ids.end();
      }
    }
    xcatchbegin
      xcatchall { hasLeader = false; }
    xcatchend
    catch (...) {
      hasLeader = false;
    }
    instanceCount = static_cast<int>(ids.size()) + (hasLeader ? 0 : 1);
  }

  if (members.empty()) {
    members = describeFeatureSequence(safeFeatureChildren(created), ids);
    instanceCount = static_cast<int>(ids.size()) + 1;
  }
  return members;
}

}  // namespace

nlohmann::json createPatternFeature(pfcModel_ptr model,
                                    const PatternFeatureRequest& request) {
  if (request.seedFeatureId <= 0) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A positive seedFeatureId is required for a pattern.");
  }
  pfcFeature_ptr seed = findFeatureById(model, request.seedFeatureId);
  if (!seed) {
    throw BridgeError("NOT_FOUND", "Seed feature " +
                                      std::to_string(request.seedFeatureId) +
                                      " is not present in the model.");
  }
  wfcWFeature_ptr wseed = wfcWFeature::cast(seed);
  if (!wseed) {
    throw BridgeError("INVALID_ARGUMENT",
                      "The seed feature does not support pattern creation.");
  }

  ElementBuilder builder;
  builder.compound(wfcPRO_E_PATTERN_ROOT, 0);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.intValue(wfcPRO_E_GENPAT_REGEN_METHOD, kProPatGeneral, 1);

  if (request.type == "linear") {
    if (request.direction1.count < 2 || request.direction1.spacing == 0.0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A linear pattern direction requires count >= 2 and a "
                        "non-zero spacing.");
    }
    builder.intValue(wfcPRO_E_GENPAT_TYPE, kProGenPatDirDriven, 1);
    builder.compound(wfcPRO_E_GENPAT_DIR, 1);
    pfcSelection_ptr direction1 = resolvePatternReferenceSelection(
        model, request.direction1.reference, "Pattern direction 1");
    addDirectionPatternElements(builder, request.direction1, true, direction1);
    if (request.hasDirection2) {
      if (request.direction2.count < 2 || request.direction2.spacing == 0.0) {
        throw BridgeError("INVALID_ARGUMENT",
                          "Pattern direction 2 requires count >= 2 and a "
                          "non-zero spacing.");
      }
      pfcSelection_ptr direction2 = resolvePatternReferenceSelection(
          model, request.direction2.reference, "Pattern direction 2");
      addDirectionPatternElements(builder, request.direction2, false, direction2);
    } else {
      addEmptySecondDirection(builder);
    }
  } else if (request.type == "axis") {
    if (request.axisCount < 2 || !(request.axisAngle > 0.0)) {
      throw BridgeError("INVALID_ARGUMENT",
                        "An axis pattern requires count >= 2 and a positive "
                        "angle increment.");
    }
    builder.intValue(wfcPRO_E_GENPAT_TYPE, kProGenPatAxisDriven, 1);
    builder.compound(wfcPRO_E_GENPAT_AXIS, 1);
    pfcSelection_ptr axis = resolvePatternReferenceSelection(
        model, request.axis, "Pattern axis");
    builder.selection(wfcPRO_E_GENPAT_AXIS_REF, axis, 2);
    builder.doubleValue(wfcPRO_E_GENPAT_AXIS1_INC, request.axisAngle, 2);
    builder.intValue(wfcPRO_E_AXIS_PAT_DIR1_FLIP,
                     request.axisFlip ? 1 : 0, 2);
    builder.doubleValue(wfcPRO_E_GENPAT_AXIS2_INC, 0.0, 2);
    builder.intValue(wfcPRO_E_AXIS_PAT_DIR2_FLIP, 0, 2);
    builder.doubleValue(wfcPRO_E_GENPAT_AXIS_ANG_WHOLE, 360.0, 2);
    builder.compound(wfcPRO_E_GENPAT_DIM_FIRST_DIR, 2);
    builder.intValue(wfcPRO_E_GENPAT_DIM_FIRST_DIR_NUM_INST,
                     request.axisCount, 2);
    addEmptySecondDirection(builder);
  } else {
    throw BridgeError("INVALID_ARGUMENT",
                      "Pattern type must be linear or axis.");
  }

  wfcWSession_ptr session = wfcWSession::cast(pfcGetCurrentSession());
  if (!session) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not reach the OTK session object.");
  }
  wfcElementTree_ptr tree = runStage("CreatePatternElementTree", [&]() {
    return session->CreateElementTree(builder.elements());
  });
  if (!tree) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo rejected the pattern element tree.");
  }
  wfcWFeature_ptr created = runStage("CreatePattern", [&]() {
    return wseed->CreatePattern(tree, wfcFEAT_PATTERN);
  });
  if (!created) {
    throw BridgeError("CREO_API_ERROR", "Creo did not create the pattern.");
  }
  const int featureId = static_cast<int>(created->GetId());
  pfcFeature_ptr active = ensureActiveFeature(model, featureId);
  int instanceCount = 0;
  nlohmann::json members = patternMembers(seed, active, instanceCount);

  nlohmann::json out = detailFeatureResult(
      model, featureId,
      {{"kind", "pattern"},
       {"type", request.type},
       {"seedFeatureId", request.seedFeatureId},
       {"featureName", request.featureName},
       {"requestedCount", request.type == "axis"
                              ? request.axisCount
                              : request.direction1.count}});
  out["seedFeatureId"] = request.seedFeatureId;
  out["members"] = members;
  out["memberCount"] = members.size();
  out["instanceCount"] = instanceCount;
  return out;
}

nlohmann::json createMirrorFeature(pfcModel_ptr model,
                                   const MirrorFeatureRequest& request) {
  if (request.featureIds.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "At least one feature id is required for a mirror.");
  }
  pfcSelections_ptr items = pfcSelections::create();
  for (const int id : request.featureIds) {
    if (id <= 0) {
      throw BridgeError("INVALID_ARGUMENT",
                        "Mirror feature ids must be positive integers.");
    }
    pfcFeature_ptr feature = findFeatureById(model, id);
    if (!feature) {
      throw BridgeError("NOT_FOUND", "Mirror feature " + std::to_string(id) +
                                        " is not present in the model.");
    }
    items->append(
        pfcCreateModelItemSelection(pfcModelItem::cast(feature)));
  }
  pfcSelection_ptr plane = resolvePatternReferenceSelection(
      model, request.plane, "Mirror plane");

  ElementBuilder builder;
  builder.compound(wfcPRO_E_FEATURE_TREE, 0);
  builder.intValue(wfcPRO_E_FEATURE_TYPE, kProFeatSurfaceModel, 1);
  builder.intValue(wfcPRO_E_SRF_TRANS_TYPE, kProSurfTransMirror, 1);
  if (!request.featureName.empty()) {
    builder.stringValue(wfcPRO_E_STD_FEATURE_NAME, request.featureName, 1);
  }
  builder.selections(wfcPRO_E_MIRROR_REF_ITEMS, items, 1);
  builder.selection(wfcPRO_E_MIRROR_REF_PLANE, plane, 1);
  builder.intValue(wfcPRO_E_COPY_NO_COPY, kProMirrorKeepOriginal, 1);

  wfcWFeature_ptr feature =
      commitFeature(model, builder, "mirror", wfcFEAT_CR_DEFINE_MISS_ELEMS);
  const int featureId = static_cast<int>(feature->GetId());
  pfcFeature_ptr active = ensureActiveFeature(model, featureId);
  std::vector<int> memberIds;
  nlohmann::json members = describeFeatureSequence(
      safeFeatureChildren(active), memberIds);
  nlohmann::json out = detailFeatureResult(
      model, featureId,
      {{"kind", "mirror"},
       {"featureIds", request.featureIds},
       {"featureName", request.featureName}});
  out["members"] = members;
  out["memberCount"] = members.size();
  out["mirroredFeatureCount"] = request.featureIds.size();
  return out;
}

}  // namespace creo
