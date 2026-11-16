// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "read.h"

#include <string>

#include <pfcBase.h>
#include <pfcDimension.h>
#include <pfcExceptions.h>
#include <pfcFamily.h>
#include <pfcFeature.h>
#include <pfcLayer.h>
#include <pfcModelItem.h>
#include <pfcGeometry.h>
#include <pfcPart.h>
#include <pfcSolid.h>
#include <pfcUnits.h>
#include <wfcGeometry.h>
#include <wfcSession.h>

namespace creo {

namespace {

const char* paramValueTypeName(pfcParamValueType type) {
  switch (type) {
    case pfcPARAM_STRING:
      return "string";
    case pfcPARAM_INTEGER:
      return "integer";
    case pfcPARAM_BOOLEAN:
      return "boolean";
    case pfcPARAM_DOUBLE:
      return "double";
    case pfcPARAM_NOTE:
      return "note";
    case pfcPARAM_VOID:
      return "void";
    case pfcPARAM_NOT_SET:
      return "not_set";
    default:
      return "unknown";
  }
}

const char* driverTypeName(pfcParameterDriverType type) {
  switch (type) {
    case pfcPARAMDRIVER_PARAM:
      return "parameter";
    case pfcPARAMDRIVER_FUNCTION:
      return "function";
    case pfcPARAMDRIVER_RELATION:
      return "relation";
    default:
      return "unknown";
  }
}

const char* dimensionTypeName(pfcDimensionType type) {
  switch (type) {
    case pfcDIM_LINEAR:
      return "linear";
    case pfcDIM_RADIAL:
      return "radial";
    case pfcDIM_DIAMETER:
      return "diameter";
    case pfcDIM_ANGULAR:
      return "angular";
    default:
      return "unknown";
  }
}

const char* toleranceTypeName(pfcDimToleranceType type) {
  switch (type) {
    case pfcDIMTOL_LIMITS:
      return "limits";
    case pfcDIMTOL_PLUS_MINUS:
      return "plus_minus";
    case pfcDIMTOL_SYMMETRIC:
      return "symmetric";
    case pfcDIMTOL_SYMMETRIC_SUPERSCRIPT:
      return "symmetric_superscript";
    case pfcDIMTOL_ISODIN:
      return "iso_din";
    default:
      return "unknown";
  }
}

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

const char* displayStatusName(pfcDisplayStatus status) {
  switch (status) {
    case pfcLAYER_NORMAL:
      return "normal";
    case pfcLAYER_DISPLAY:
      return "display";
    case pfcLAYER_BLANK:
      return "blank";
    case pfcLAYER_HIDDEN:
      return "hidden";
    default:
      return "unknown";
  }
}

const char* unitTypeName(pfcUnitType type) {
  switch (type) {
    case pfcUNIT_LENGTH:
      return "length";
    case pfcUNIT_MASS:
      return "mass";
    case pfcUNIT_FORCE:
      return "force";
    case pfcUNIT_TIME:
      return "time";
    case pfcUNIT_TEMPERATURE:
      return "temperature";
    case pfcUNIT_ANGLE:
      return "angle";
    default:
      return "unknown";
  }
}

const char* unitSystemTypeName(pfcUnitSystemType type) {
  switch (type) {
    case pfcUNIT_SYSTEM_MASS_LENGTH_TIME:
      return "mass_length_time";
    case pfcUNIT_SYSTEM_FORCE_LENGTH_TIME:
      return "force_length_time";
    default:
      return "unknown";
  }
}

const char* familyColumnTypeName(pfcFamilyColumnType type) {
  switch (type) {
    case pfcFAM_USER_PARAM:
      return "user_parameter";
    case pfcFAM_DIMENSION:
      return "dimension";
    case pfcFAM_IPAR_NOTE:
      return "note";
    case pfcFAM_FEATURE:
      return "feature";
    case pfcFAM_ASMCOMP:
      return "component";
    case pfcFAM_UDF:
      return "udf";
    case pfcFAM_ASMCOMP_MODEL:
      return "component_model";
    case pfcFAM_GTOL:
      return "gtol";
    case pfcFAM_TOL_PLUS:
      return "tolerance_plus";
    case pfcFAM_TOL_MINUS:
      return "tolerance_minus";
    case pfcFAM_TOL_PLUSMINUS:
      return "tolerance_plus_minus";
    case pfcFAM_SYSTEM_PARAM:
      return "system_parameter";
    case pfcFAM_EXTERNAL_REFERENCE:
      return "external_reference";
    case pfcFAM_MERGE_PART_REF:
      return "merge_part_reference";
    default:
      return "unknown";
  }
}

const char* familyVerifyName(pfcFaminstanceVerifyStatus status) {
  switch (status) {
    case pfcFAMINST_SUCCESS_VERIFIED:
      return "verified";
    case pfcFAMINST_FAILED_VERIFIED:
      return "failed";
    case pfcFAMINST_NOT_VERIFIED:
      return "not_verified";
    default:
      return "unknown";
  }
}

int countItems(pfcModel_ptr model, pfcModelItemType type) {
  pfcModelItems_ptr items = model->ListItems(type);
  return items ? static_cast<int>(items->getarraysize()) : 0;
}

nlohmann::json featureIds(pfcFeatures_ptr features) {
  nlohmann::json out = nlohmann::json::array();
  if (!features) {
    return out;
  }
  const int count = features->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcFeature_ptr feature = features->get(i);
    if (feature) {
      out.push_back(static_cast<int>(feature->GetId()));
    }
  }
  return out;
}

nlohmann::json outlineToJson(pfcOutline3D_ptr outline) {
  if (!outline) {
    return nullptr;
  }
  pfcPoint3D_ptr first = outline->get(0);
  pfcPoint3D_ptr second = outline->get(1);
  if (!first || !second) {
    return nullptr;
  }
  nlohmann::json minimum = nlohmann::json::array();
  nlohmann::json maximum = nlohmann::json::array();
  for (int axis = 0; axis < 3; ++axis) {
    const double a = first->get(axis);
    const double b = second->get(axis);
    minimum.push_back(a < b ? a : b);
    maximum.push_back(a < b ? b : a);
  }
  return {{"min", minimum}, {"max", maximum}};
}

nlohmann::json describeUnit(pfcUnit_ptr unit) {
  if (!unit) {
    return nullptr;
  }
  nlohmann::json out;
  out["name"] = toUtf8(unit->GetName());
  out["expression"] = toUtf8(unit->GetExpression());
  out["isStandard"] = static_cast<bool>(unit->GetIsStandard());
  pfcUnitConversionFactor_ptr factor = unit->GetConversionFactor();
  if (factor) {
    out["conversion"] = {{"scale", factor->GetScale()},
                         {"offset", factor->GetOffset()}};
  }
  pfcUnit_ptr reference = unit->GetReferenceUnit();
  if (reference) {
    out["referenceUnit"] = toUtf8(reference->GetName());
  }
  return out;
}

// pfcPart::GetCurrentMaterial can return null and ListMaterials throws
// pfcXToolkitNotFound when a part has no materials; both are normal states.

pfcMaterial_ptr safeCurrentMaterial(pfcPart_ptr part) {
  try {
    return part->GetCurrentMaterial();
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (const std::exception&) {
    return nullptr;
  }
  catch (...) {
    return nullptr;
  }
}

pfcMaterials_ptr safeListMaterials(pfcPart_ptr part) {
  try {
    return part->ListMaterials();
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (const std::exception&) {
    return nullptr;
  }
  catch (...) {
    return nullptr;
  }
}

// Runs fn and returns `fallback` when the runtime throws an OTK exception.
// Used for accessors that individual Creo builds leave unimplemented or that
// throw when the underlying data is absent (e.g. no material assigned).
template <typename Result, typename Fn>
Result safeValue(Fn fn, Result fallback) {
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

nlohmann::json describeMaterial(pfcMaterial_ptr material) {
  if (!material) {
    return nullptr;
  }
  nlohmann::json out;
  const std::string name = safeValue<std::string>(
      [&material]() { return toUtf8(material->GetName()); }, std::string());
  out["name"] = name;
  const int id =
      safeValue<int>([&material]() { return static_cast<int>(material->GetId()); }, -1);
  if (id >= 0) {
    out["id"] = id;
  }
  const bool hasDensity = safeValue<bool>(
      [&]() {
        out["massDensity"] = material->GetMassDensity();
        return true;
      },
      false);
  (void)hasDensity;
  const std::string description = safeValue<std::string>(
      [&material]() { return toUtf8(material->GetDescription()); },
      std::string());
  if (!description.empty()) {
    out["description"] = description;
  }
  const std::string materialModel = safeValue<std::string>(
      [&material]() { return toUtf8(material->GetMaterialModel()); },
      std::string());
  if (!materialModel.empty()) {
    out["materialModel"] = materialModel;
  }
  return out;
}

nlohmann::json safeCell(pfcFamilyMember_ptr member,
                        pfcFamilyTableColumn_ptr column,
                        pfcFamilyTableRow_ptr row) {
  try {
    return paramValueToJson(member->GetCell(column, row));
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (const std::exception&) {
    return nullptr;
  }
  catch (...) {
    return nullptr;
  }
}

// Some Creo builds throw XUnimplemented for individual pfcBaseParameter
// accessors (observed: IsDesignated on dimensions in Creo 9). Report the flag
// only when the runtime supports it.

struct FlagResult {
  bool available;
  bool value;
};

FlagResult safeDesignated(pfcBaseParameter_ptr parameter) {
  try {
    return FlagResult{true, static_cast<bool>(parameter->GetIsDesignated())};
  }
  xcatchbegin
    xcatchall { return FlagResult{false, false}; }
  xcatchend
  catch (const std::exception&) {
    return FlagResult{false, false};
  }
  catch (...) {
    return FlagResult{false, false};
  }
}

FlagResult safeRelationDriven(pfcBaseParameter_ptr parameter) {
  try {
    return FlagResult{true, static_cast<bool>(parameter->GetIsRelationDriven())};
  }
  xcatchbegin
    xcatchall { return FlagResult{false, false}; }
  xcatchend
  catch (const std::exception&) {
    return FlagResult{false, false};
  }
  catch (...) {
    return FlagResult{false, false};
  }
}

FlagResult safeModified(pfcBaseParameter_ptr parameter) {
  try {
    return FlagResult{true, static_cast<bool>(parameter->GetIsModified())};
  }
  xcatchbegin
    xcatchall { return FlagResult{false, false}; }
  xcatchend
  catch (const std::exception&) {
    return FlagResult{false, false};
  }
  catch (...) {
    return FlagResult{false, false};
  }
}

void appendDimensions(pfcModel_ptr model, pfcModelItemType type,
                      nlohmann::json& out) {
  pfcModelItems_ptr items = model->ListItems(type);
  if (!items) {
    return;
  }
  const int count = items->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcModelItem_ptr item = items->get(i);
    if (!item) {
      continue;
    }
    pfcBaseDimension_ptr base = pfcBaseDimension::cast(item);
    if (!base) {
      continue;
    }
    nlohmann::json entry;
    entry["id"] = static_cast<int>(item->GetId());
    const xstring name = item->GetName();
    if (!name.IsNull()) {
      entry["name"] = toUtf8(name);
    }
    entry["symbol"] = toUtf8(base->GetSymbol());
    entry["value"] = base->GetDimValue();
    entry["dimensionType"] = dimensionTypeName(base->GetDimType());

    pfcBaseParameter_ptr asParameter = pfcBaseParameter::cast(item);
    const FlagResult designated = safeDesignated(asParameter);
    if (designated.available) {
      entry["isDesignated"] = designated.value;
    }
    const FlagResult relationDriven = safeRelationDriven(asParameter);
    if (relationDriven.available) {
      entry["isRelationDriven"] = relationDriven.value;
    }
    const FlagResult modified = safeModified(asParameter);
    if (modified.available) {
      entry["isModified"] = modified.value;
    }

    pfcDimension_ptr dimension = pfcDimension::cast(item);
    if (dimension) {
      entry["isReference"] = static_cast<bool>(dimension->IsReference());
      pfcDimTolerance_ptr tolerance = dimension->GetTolerance();
      entry["tolerance"] = tolerance ? toleranceTypeName(tolerance->GetType())
                                     : nlohmann::json(nullptr);
    } else {
      entry["isReference"] = true;
      entry["tolerance"] = nullptr;
    }
    out.push_back(entry);
  }
}

}  // namespace

nlohmann::json paramValueToJson(pfcParamValue_ptr value) {
  if (!value) {
    return nullptr;
  }
  const pfcParamValueType type = value->Getdiscr();
  nlohmann::json out;
  out["type"] = paramValueTypeName(type);
  switch (type) {
    case pfcPARAM_STRING: {
      const xstring text = value->GetStringValue();
      if (text.IsNull()) {
        out["value"] = nullptr;
      } else {
        out["value"] = toUtf8(text);
      }
      break;
    }
    case pfcPARAM_INTEGER:
      out["value"] = static_cast<int>(value->GetIntValue());
      break;
    case pfcPARAM_BOOLEAN:
      out["value"] = static_cast<bool>(value->GetBoolValue());
      break;
    case pfcPARAM_DOUBLE:
      out["value"] = value->GetDoubleValue();
      break;
    case pfcPARAM_NOTE:
      out["value"] = static_cast<int>(value->GetNoteId());
      break;
    default:
      out["value"] = nullptr;
      break;
  }
  return out;
}

nlohmann::json describeModelInfo(pfcModel_ptr model) {
  if (!model) {
    return nullptr;
  }
  nlohmann::json out;
  const xstring fullName = model->GetFullName();
  out["name"] = toUtf8(fullName);
  out["type"] = modelTypeName(model->GetType());
  out["fileName"] = toUtf8(model->GetFileName());
  out["fullName"] = toUtf8(fullName);
  pfcModelDescriptor_ptr descriptor = model->GetDescr();
  if (descriptor) {
    out["path"] = toUtf8(descriptor->GetPath());
  }
  out["isModified"] = static_cast<bool>(model->GetIsModified());
  out["isNative"] = static_cast<bool>(model->IsNativeModel());

  const xstring version = model->GetVersion();
  if (!version.IsNull()) {
    out["version"] = toUtf8(version);
  }
  const xstring revision = model->GetRevision();
  if (!revision.IsNull()) {
    out["revision"] = toUtf8(revision);
  }
  const xstring instanceName = model->GetInstanceName();
  if (!instanceName.IsNull()) {
    out["instanceName"] = toUtf8(instanceName);
  }
  const xstring genericName = model->GetGenericName();
  if (!genericName.IsNull()) {
    out["genericName"] = toUtf8(genericName);
  }
  return out;
}

nlohmann::json describeParameters(pfcModel_ptr model) {
  nlohmann::json out = nlohmann::json::array();
  pfcParameters_ptr params = model->ListParams();
  if (!params) {
    return out;
  }
  const int count = params->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcParameter_ptr param = params->get(i);
    if (!param) {
      continue;
    }
    nlohmann::json entry;
    const xstring name = param->GetName();
    entry["name"] = name.IsNull() ? std::string() : toUtf8(name);
    entry["value"] = paramValueToJson(param->GetValue());

    pfcBaseParameter_ptr asParameter = pfcBaseParameter::cast(param);
    const FlagResult designated = safeDesignated(asParameter);
    if (designated.available) {
      entry["isDesignated"] = designated.value;
    }
    const FlagResult relationDriven = safeRelationDriven(asParameter);
    if (relationDriven.available) {
      entry["isRelationDriven"] = relationDriven.value;
    }
    const FlagResult modified = safeModified(asParameter);
    if (modified.available) {
      entry["isModified"] = modified.value;
    }
    entry["driverType"] = driverTypeName(param->GetDriverType());
    const xstring description = param->GetDescription();
    if (!description.IsNull()) {
      entry["description"] = toUtf8(description);
    }
    pfcUnit_ptr units = param->GetUnits();
    if (units) {
      entry["units"] = toUtf8(units->GetName());
    }
    out.push_back(entry);
  }
  return out;
}

nlohmann::json describeDimensions(pfcModel_ptr model) {
  nlohmann::json out = nlohmann::json::array();
  appendDimensions(model, pfcITEM_DIMENSION, out);
  appendDimensions(model, pfcITEM_REF_DIMENSION, out);
  return out;
}

nlohmann::json describeFeatures(pfcModel_ptr model) {
  nlohmann::json out = nlohmann::json::array();
  pfcModelItems_ptr items = model->ListItems(pfcITEM_FEATURE);
  if (!items) {
    return out;
  }
  const int count = items->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcFeature_ptr feature = pfcFeature::cast(items->get(i));
    if (!feature) {
      continue;
    }
    nlohmann::json entry;
    entry["id"] = static_cast<int>(feature->GetId());
    const xstring name = feature->GetName();
    if (!name.IsNull()) {
      entry["name"] = toUtf8(name);
    }
    const xint number = feature->GetNumber();
    if (number != xintnil) {
      entry["number"] = static_cast<int>(number);
    }
    entry["type"] = toUtf8(feature->GetFeatTypeName());
    const xstring subType = feature->GetFeatSubType();
    if (!subType.IsNull()) {
      entry["subType"] = toUtf8(subType);
    }
    entry["status"] = featureStatusName(feature->GetStatus());
    entry["isVisible"] = static_cast<bool>(feature->GetIsVisible());
    entry["isReadOnly"] = static_cast<bool>(feature->GetIsReadonly());
    entry["isGroupMember"] = static_cast<bool>(feature->GetIsGroupMember());
    entry["isEmbedded"] = static_cast<bool>(feature->GetIsEmbedded());
    entry["parentIds"] = featureIds(feature->ListParents());
    entry["childIds"] = featureIds(feature->ListChildren());
    out.push_back(entry);
  }
  return out;
}

nlohmann::json describeRelations(pfcModel_ptr model) {
  nlohmann::json out = nlohmann::json::array();
  xstringsequence_ptr relations = model->GetRelations();
  if (!relations) {
    return out;
  }
  const int count = relations->getarraysize();
  for (int i = 0; i < count; ++i) {
    const xstring text = relations->get(i);
    if (!text.IsNull()) {
      out.push_back(toUtf8(text));
    }
  }
  return out;
}

nlohmann::json describeMassProperties(pfcModel_ptr model,
                                      const std::string& coordSys) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    return nullptr;
  }
  pfcMassProperty_ptr props =
      coordSys.empty()
          ? solid->GetMassPropertyWithDensity(xstringnil,
                                              pfcMP_DENSITY_USE_IF_MISSING, 1.0)
          : solid->GetMassPropertyWithDensity(coordSys.c_str(),
                                              pfcMP_DENSITY_USE_IF_MISSING,
                                              1.0);
  if (!props) {
    return nullptr;
  }
  nlohmann::json out;
  out["volume"] = props->GetVolume();
  out["surfaceArea"] = props->GetSurfaceArea();
  out["density"] = props->GetDensity();
  out["mass"] = props->GetMass();
  pfcPoint3D_ptr center = props->GetGravityCenter();
  if (center) {
    out["gravityCenter"] =
        nlohmann::json::array({center->get(0), center->get(1), center->get(2)});
  }
  return out;
}

nlohmann::json describeMaterials(pfcModel_ptr model) {
  nlohmann::json out;
  if (model->GetType() != pfcMDL_PART) {
    out["supported"] = false;
    out["currentMaterial"] = nullptr;
    out["materials"] = nlohmann::json::array();
    return out;
  }
  pfcPart_ptr part = pfcPart::cast(model);
  if (!part) {
    out["supported"] = false;
    out["currentMaterial"] = nullptr;
    out["materials"] = nlohmann::json::array();
    return out;
  }
  out["supported"] = true;
  pfcMaterial_ptr current = safeCurrentMaterial(part);
  out["currentMaterial"] =
      current ? describeMaterial(current) : nlohmann::json(nullptr);

  nlohmann::json list = nlohmann::json::array();
  pfcMaterials_ptr materials = safeListMaterials(part);
  if (materials) {
    const int count = materials->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcMaterial_ptr material = materials->get(i);
      if (material) {
        list.push_back(describeMaterial(material));
      }
    }
  }
  out["materials"] = list;
  return out;
}

nlohmann::json describeLayers(pfcModel_ptr model) {
  nlohmann::json out = nlohmann::json::array();
  pfcModelItems_ptr items = model->ListItems(pfcITEM_LAYER);
  if (!items) {
    return out;
  }
  const int count = items->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcLayer_ptr layer = pfcLayer::cast(items->get(i));
    if (!layer) {
      continue;
    }
    nlohmann::json entry;
    entry["id"] = static_cast<int>(layer->GetId());
    const xstring name = layer->GetName();
    if (!name.IsNull()) {
      entry["name"] = toUtf8(name);
    }
    entry["status"] = displayStatusName(layer->GetStatus());
    pfcModelItems_ptr layerItems = layer->ListItems();
    entry["itemCount"] =
        layerItems ? static_cast<int>(layerItems->getarraysize()) : 0;
    entry["hasUnsupportedItems"] =
        static_cast<bool>(layer->HasUnsupportedItems());
    entry["unsupportedItemCount"] =
        static_cast<int>(layer->CountUnsupportedItems());
    out.push_back(entry);
  }
  return out;
}

nlohmann::json describeUnits(pfcModel_ptr model) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    return nullptr;
  }
  pfcUnitSystem_ptr system = solid->GetPrincipalUnits();
  if (!system) {
    return nullptr;
  }
  nlohmann::json out;
  out["name"] = toUtf8(system->GetName());
  out["type"] = unitSystemTypeName(system->GetType());
  out["isStandard"] = static_cast<bool>(system->GetIsStandard());

  nlohmann::json units = nlohmann::json::object();
  const pfcUnitType types[] = {pfcUNIT_LENGTH,   pfcUNIT_MASS, pfcUNIT_FORCE,
                               pfcUNIT_TIME,     pfcUNIT_TEMPERATURE,
                               pfcUNIT_ANGLE};
  for (const pfcUnitType type : types) {
    pfcUnit_ptr unit = system->GetUnit(type);
    if (unit) {
      units[unitTypeName(type)] = describeUnit(unit);
    }
  }
  out["units"] = units;
  return out;
}

nlohmann::json describeGeometry(pfcModel_ptr model) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    return nullptr;
  }
  nlohmann::json out;
  out["outline"] = outlineToJson(solid->GetGeomOutline());
  out["counts"] = {{"surfaces", countItems(model, pfcITEM_SURFACE)},
                   {"edges", countItems(model, pfcITEM_EDGE)},
                   {"bodies", countItems(model, pfcITEM_BODY)}};
  return out;
}

// The point on the surface closest to a reference point (the model bounding
// box center). For a planar face one point is enough to tell top from bottom,
// which is what shell face selection needs. Note EvalClosestPointOnSurface has
// different semantics (it tests whether a point lies on the surface).
pfcPoint3D_ptr closestSurfacePoint(pfcSurface_ptr surface,
                                   pfcPoint3D_ptr reference) {
  if (!surface || !reference) {
    return nullptr;
  }
  return safeValue<pfcPoint3D_ptr>(
      [&]() { return surface->EvalClosestPoint(reference); }, nullptr);
}

pfcPoint3D_ptr modelCenterPoint(pfcModel_ptr model) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    return nullptr;
  }
  pfcOutline3D_ptr outline = safeValue<pfcOutline3D_ptr>(
      [&]() { return solid->GetGeomOutline(); }, nullptr);
  if (!outline) {
    return nullptr;
  }
  pfcPoint3D_ptr first = outline->get(0);
  pfcPoint3D_ptr second = outline->get(1);
  if (!first || !second) {
    return nullptr;
  }
  try {
    return wfcCreatePoint3D((first->get(0) + second->get(0)) / 2.0,
                            (first->get(1) + second->get(1)) / 2.0,
                            (first->get(2) + second->get(2)) / 2.0);
  }
  xcatchbegin
    xcatchall { return nullptr; }
  xcatchend
  catch (...) {
    return nullptr;
  }
}

nlohmann::json describeSurface(pfcSurface_ptr surface,
                               pfcPoint3D_ptr reference) {
  nlohmann::json entry;
  if (!surface) {
    return entry;
  }
  entry["id"] = static_cast<int>(surface->GetId());
  entry["surfaceType"] = safeValue<int>(
      [&]() { return static_cast<int>(surface->GetSurfaceType()); }, -1);
  pfcPoint3D_ptr closest = closestSurfacePoint(surface, reference);
  if (closest) {
    nlohmann::json point = nlohmann::json::array();
    for (int axis = 0; axis < 3; ++axis) {
      point.push_back(closest->get(axis));
    }
    entry["samplePoint"] = point;
  }
  pfcFeature_ptr owner = safeValue<pfcFeature_ptr>(
      [&]() { return surface->GetFeature(); }, nullptr);
  if (owner) {
    entry["featureId"] = static_cast<int>(owner->GetId());
    const xstring name = owner->GetName();
    if (!name.IsNull()) {
      entry["featureName"] = toUtf8(name);
    }
    entry["featureType"] = toUtf8(owner->GetFeatTypeName());
  }
  return entry;
}

// Surfaces reachable two ways: per solid body (Creo 7+ multi-body API) and
// through the model item list. Datum planes only appear in one of them on
// Creo 9, so both are reported.
nlohmann::json describeSurfaceById(pfcModel_ptr model,
                                   const std::vector<int>& ids) {
  nlohmann::json out = nlohmann::json::array();
  pfcPoint3D_ptr reference = modelCenterPoint(model);
  for (const int id : ids) {
    pfcModelItem_ptr item = safeValue<pfcModelItem_ptr>(
        [&]() { return model->GetItemById(pfcITEM_SURFACE, id); }, nullptr);
    nlohmann::json entry = describeSurface(pfcSurface::cast(item), reference);
    if (!entry.empty()) {
      entry["requestedId"] = id;
      out.push_back(std::move(entry));
    }
  }
  return out;
}

nlohmann::json describeSurfaces(pfcModel_ptr model) {
  nlohmann::json out;
  nlohmann::json bodySurfaces = nlohmann::json::array();
  nlohmann::json itemSurfaces = nlohmann::json::array();
  pfcPoint3D_ptr reference = modelCenterPoint(model);

  pfcModelItems_ptr bodies = model->ListItems(pfcITEM_BODY);
  if (bodies) {
    const int bodyCount = bodies->getarraysize();
    for (int b = 0; b < bodyCount; ++b) {
      pfcSolidBody_ptr body = pfcSolidBody::cast(bodies->get(b));
      if (!body) {
        continue;
      }
      pfcSurfaces_ptr surfaces = safeValue<pfcSurfaces_ptr>(
          [&]() { return body->ListSurfaces(); }, nullptr);
      if (!surfaces) {
        continue;
      }
      const int count = surfaces->getarraysize();
      for (int i = 0; i < count; ++i) {
        nlohmann::json entry = describeSurface(surfaces->get(i), reference);
        if (!entry.empty()) {
          entry["bodyId"] = static_cast<int>(body->GetId());
          bodySurfaces.push_back(std::move(entry));
        }
      }
    }
  }

  pfcModelItems_ptr items = model->ListItems(pfcITEM_SURFACE);
  if (items) {
    const int count = items->getarraysize();
    for (int i = 0; i < count; ++i) {
      nlohmann::json entry =
          describeSurface(pfcSurface::cast(items->get(i)), reference);
      if (!entry.empty()) {
        itemSurfaces.push_back(std::move(entry));
      }
    }
  }

  out["bodySurfaces"] = std::move(bodySurfaces);
  out["itemSurfaces"] = std::move(itemSurfaces);
  return out;
}

namespace {

const char* edgeTypeName(int type) {
  switch (type) {
    case 1:
      return "point";
    case 2:
      return "line";
    case 3:
      return "arc";
    case 6:
      return "circle";
    case 7:
      return "spline";
    case 8:
      return "b_spline";
    case 9:
      return "ellipse";
    case 10:
      return "polygon";
    case 11:
      return "composite_curve";
    case 12:
      return "surface_curve";
    case 13:
      return "parameterized_curve";
    default:
      return "unknown";
  }
}

nlohmann::json point3DToArray(pfcPoint3D_ptr point) {
  if (!point) {
    return nlohmann::json();
  }
  nlohmann::json out = nlohmann::json::array();
  for (int axis = 0; axis < 3; ++axis) {
    out.push_back(point->get(axis));
  }
  return out;
}

// Parameter 0 is the edge start, 1 the end; Creo normalizes every edge this
// way even when the underlying curve is a closed circle or a spline.
nlohmann::json safeCurvePoint(pfcEdge_ptr edge, double param) {
  try {
    pfcCurveXYZData_ptr data = edge->Eval3DData(param);
    return data ? point3DToArray(data->GetPoint()) : nlohmann::json();
  }
  xcatchbegin
    xcatchall { return nlohmann::json(); }
  xcatchend
  catch (...) {
    return nlohmann::json();
  }
}

nlohmann::json describeEdge(pfcModelItem_ptr item) {
  pfcEdge_ptr edge = pfcEdge::cast(item);
  if (!edge) {
    return nlohmann::json::object();
  }
  nlohmann::json entry;
  entry["id"] = static_cast<int>(edge->GetId());
  const int edgeType = safeValue<int>(
      [&]() {
        wfcWEdge_ptr wedge = wfcWEdge::cast(edge);
        return wedge ? static_cast<int>(wedge->GetEdgeType()) : -1;
      },
      -1);
  entry["edgeType"] = edgeType;
  entry["edgeTypeName"] = edgeTypeName(edgeType);
  const double length =
      safeValue<double>([&]() { return edge->EvalLength(); }, -1.0);
  if (length >= 0.0) {
    entry["length"] = length;
  }
  const nlohmann::json start = safeCurvePoint(edge, 0.0);
  const nlohmann::json end = safeCurvePoint(edge, 1.0);
  const nlohmann::json midpoint = safeCurvePoint(edge, 0.5);
  if (!start.is_null()) {
    entry["start"] = start;
  }
  if (!end.is_null()) {
    entry["end"] = end;
  }
  if (!midpoint.is_null()) {
    entry["midpoint"] = midpoint;
  }
  pfcFeature_ptr owner = safeValue<pfcFeature_ptr>(
      [&]() { return edge->GetFeature(); }, nullptr);
  if (owner) {
    entry["featureId"] = static_cast<int>(owner->GetId());
    const xstring name = owner->GetName();
    if (!name.IsNull()) {
      entry["featureName"] = toUtf8(name);
    }
    entry["featureType"] = toUtf8(owner->GetFeatTypeName());
  }
  nlohmann::json surfaceIds = nlohmann::json::array();
  pfcSurface_ptr surface1 = safeValue<pfcSurface_ptr>(
      [&]() { return edge->GetSurface1(); }, nullptr);
  pfcSurface_ptr surface2 = safeValue<pfcSurface_ptr>(
      [&]() { return edge->GetSurface2(); }, nullptr);
  if (surface1) {
    surfaceIds.push_back(static_cast<int>(surface1->GetId()));
  }
  if (surface2) {
    surfaceIds.push_back(static_cast<int>(surface2->GetId()));
  }
  if (!surfaceIds.empty()) {
    entry["surfaceIds"] = surfaceIds;
  }
  return entry;
}

}  // namespace

nlohmann::json describeEdges(pfcModel_ptr model, const std::vector<int>& ids) {
  nlohmann::json out = nlohmann::json::array();
  if (!model) {
    return out;
  }
  if (!ids.empty()) {
    for (const int id : ids) {
      pfcModelItem_ptr item = safeValue<pfcModelItem_ptr>(
          [&]() { return model->GetItemById(pfcITEM_EDGE, id); }, nullptr);
      nlohmann::json entry = describeEdge(item);
      if (!entry.empty()) {
        entry["requestedId"] = id;
        out.push_back(std::move(entry));
      }
    }
    return out;
  }
  pfcModelItems_ptr items = model->ListItems(pfcITEM_EDGE);
  if (!items) {
    return out;
  }
  const int count = items->getarraysize();
  for (int i = 0; i < count; ++i) {
    nlohmann::json entry = describeEdge(items->get(i));
    if (!entry.empty()) {
      out.push_back(std::move(entry));
    }
  }
  return out;
}

nlohmann::json describeFamilyTable(pfcModel_ptr model) {
  pfcFamilyMember_ptr member = pfcFamilyMember::cast(model);
  if (!member) {
    return nullptr;
  }
  pfcFamilyTableColumns_ptr columns = member->ListColumns();
  pfcFamilyTableRows_ptr rows = member->ListRows();
  if (!columns || !rows || rows->getarraysize() == 0) {
    return nullptr;
  }

  nlohmann::json columnJson = nlohmann::json::array();
  const int columnCount = columns->getarraysize();
  for (int i = 0; i < columnCount; ++i) {
    pfcFamilyTableColumn_ptr column = columns->get(i);
    if (!column) {
      continue;
    }
    nlohmann::json entry;
    const xstring symbol = column->GetSymbol();
    entry["symbol"] = symbol.IsNull() ? std::string() : toUtf8(symbol);
    entry["type"] = familyColumnTypeName(column->GetType());
    columnJson.push_back(entry);
  }

  nlohmann::json rowJson = nlohmann::json::array();
  const int rowCount = rows->getarraysize();
  for (int r = 0; r < rowCount; ++r) {
    pfcFamilyTableRow_ptr row = rows->get(r);
    if (!row) {
      continue;
    }
    nlohmann::json entry;
    const xstring instanceName = row->GetInstanceName();
    entry["instanceName"] =
        instanceName.IsNull() ? std::string() : toUtf8(instanceName);
    entry["isLocked"] = static_cast<bool>(row->GetIsLocked());
    entry["isExtLocked"] = static_cast<bool>(row->GetIsExtLocked());
    entry["verifyStatus"] = familyVerifyName(row->GetIsVerified());

    nlohmann::json cells = nlohmann::json::object();
    for (int c = 0; c < columnCount; ++c) {
      pfcFamilyTableColumn_ptr column = columns->get(c);
      if (!column) {
        continue;
      }
      const xstring symbol = column->GetSymbol();
      const std::string key = symbol.IsNull() ? std::string() : toUtf8(symbol);
      cells[key] = safeCell(member, column, row);
    }
    entry["cells"] = cells;
    rowJson.push_back(entry);
  }
  return {{"columns", columnJson}, {"rows", rowJson}};
}

pfcModel_ptr retrieveModel(pfcSession_ptr session, const std::string& fileName) {
  pfcModel_ptr existing = session->GetModelFromFileName(fileName.c_str());
  if (existing) {
    return existing;
  }
  pfcModelDescriptor_ptr descriptor =
      pfcModelDescriptor::CreateFromFileName(fileName.c_str());
  pfcRetrieveModelOptions_ptr options = pfcRetrieveModelOptions::Create();
  if (options) {
    options->SetAskUserAboutReps(xfalse);
  }
  return session->RetrieveModelWithOpts(descriptor, options);
}

nlohmann::json openModel(pfcSession_ptr session, const std::string& fileName) {
  pfcModel_ptr existing = session->GetModelFromFileName(fileName.c_str());
  if (existing) {
    return {{"opened", false},
            {"alreadyOpen", true},
            {"model", describeModelInfo(existing)}};
  }
  pfcModel_ptr model = retrieveModel(session, fileName);
  if (!model) {
    throw BridgeError("MODEL_NOT_FOUND",
                      "Creo did not return a model for '" + fileName + "'.");
  }
  return {{"opened", true},
          {"alreadyOpen", false},
          {"model", describeModelInfo(model)}};
}

nlohmann::json closeModel(pfcSession_ptr session, pfcModel_ptr model) {
  if (!model) {
    throw BridgeError("MODEL_NOT_FOUND",
                      "No model was resolved to close.");
  }
  const std::string fullName = toUtf8(model->GetFullName());
  const std::string fileName = toUtf8(model->GetFileName());
  model->Erase();

  bool stillOpen = false;
  if (!fileName.empty()) {
    pfcModel_ptr remaining = session->GetModelFromFileName(fileName.c_str());
    stillOpen = static_cast<bool>(remaining);
  }
  if (stillOpen) {
    throw BridgeError("INTERNAL", "model.close did not remove '" + fullName +
                                      "' from the session.");
  }
  return {{"closed", true}, {"name", fullName}, {"verified", true}};
}

}  // namespace creo
