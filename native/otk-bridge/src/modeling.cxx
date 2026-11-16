// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "modeling.h"

#include "read.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <string>
#include <vector>

#include <pfcDimension.h>
#include <pfcAssembly.h>
#include <pfcBase.h>
#include <pfcFeature.h>
#include <pfcModelItem.h>
#include <pfcPart.h>
#include <pfcSolid.h>

namespace creo {

namespace {

std::string lowerAscii(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) {
                   return static_cast<char>(std::tolower(c));
                 });
  return value;
}

bool isBareModelName(const std::string& name) {
  if (name.empty() || name.size() > 80 || name.find("..") != std::string::npos) {
    return false;
  }
  for (size_t i = 0; i < name.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(name[i]);
    if ((i == 0 && std::isalpha(c) == 0) ||
        (std::isalnum(c) == 0 && c != '_' && c != '-')) {
      return false;
    }
  }
  return true;
}

pfcFeature_ptr findFeature(pfcModel_ptr model, int id) {
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
  throw BridgeError("NOT_FOUND", "Feature " + std::to_string(id) +
                                  " is not present in the model.");
}

pfcBaseDimension_ptr findDimension(pfcModel_ptr model, int id) {
  const pfcModelItemType types[] = {pfcITEM_DIMENSION, pfcITEM_REF_DIMENSION};
  for (const pfcModelItemType type : types) {
    pfcModelItems_ptr items = model->ListItems(type);
    if (!items) {
      continue;
    }
    const int count = items->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcBaseDimension_ptr dimension =
          pfcBaseDimension::cast(items->get(i));
      if (dimension && static_cast<int>(dimension->GetId()) == id) {
        return dimension;
      }
    }
  }
  throw BridgeError("NOT_FOUND", "Dimension " + std::to_string(id) +
                                  " is not present in the model.");
}

pfcParamValue_ptr parseParamValue(const nlohmann::json& raw) {
  std::string type;
  const nlohmann::json* value = &raw;
  if (raw.is_object()) {
    type = raw.value("type", std::string());
    if (!raw.contains("value")) {
      throw BridgeError("INVALID_ARGUMENT",
                        "Parameter value objects require a 'value' field.");
    }
    value = &raw.at("value");
  }
  if (type.empty()) {
    if (value->is_boolean()) {
      type = "boolean";
    } else if (value->is_number_integer()) {
      type = "integer";
    } else if (value->is_number()) {
      type = "double";
    } else if (value->is_string()) {
      type = "string";
    } else {
      throw BridgeError(
          "INVALID_ARGUMENT",
          "Parameter value must be a string, integer, number, boolean, or "
          "{type,value} object.");
    }
  }

  const std::string normalized = lowerAscii(type);
  if (normalized == "string" || normalized == "str") {
    if (!value->is_string()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A string parameter value must contain text.");
    }
    return pfcCreateStringParamValue(value->get<std::string>().c_str());
  }
  if (normalized == "integer" || normalized == "int") {
    if (!value->is_number_integer()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "An integer parameter value must be an integer.");
    }
    return pfcCreateIntParamValue(value->get<int>());
  }
  if (normalized == "boolean" || normalized == "bool") {
    if (!value->is_boolean()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A boolean parameter value must be true or false.");
    }
    return pfcCreateBoolParamValue(value->get<bool>() ? xtrue : xfalse);
  }
  if (normalized == "double" || normalized == "real" ||
      normalized == "number") {
    if (!value->is_number()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A numeric parameter value must be a number.");
    }
    const double number = value->get<double>();
    if (!std::isfinite(number)) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A numeric parameter value must be finite.");
    }
    return pfcCreateDoubleParamValue(number);
  }
  if (normalized == "note") {
    if (!value->is_number_integer()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A note parameter value must be an integer id.");
    }
    return pfcCreateNoteParamValue(value->get<int>());
  }
  throw BridgeError("INVALID_ARGUMENT", "Unsupported parameter value type '" +
                                             type + "'.");
}

nlohmann::json findParameterReadback(pfcModel_ptr model,
                                     const std::string& name) {
  const std::string wanted = lowerAscii(name);
  nlohmann::json parameters = describeParameters(model);
  for (const nlohmann::json& parameter : parameters) {
    if (lowerAscii(parameter.value("name", std::string())) == wanted) {
      return parameter;
    }
  }
  return nullptr;
}

nlohmann::json findDimensionReadback(pfcModel_ptr model, int id) {
  nlohmann::json dimensions = describeDimensions(model);
  for (const nlohmann::json& dimension : dimensions) {
    if (dimension.value("id", -1) == id) {
      return dimension;
    }
  }
  return nullptr;
}

nlohmann::json featureMutationResult(pfcModel_ptr model,
                                     const std::string& operation,
                                     const std::vector<int>& ids) {
  nlohmann::json selected = nlohmann::json::array();
  const nlohmann::json features = describeFeatures(model);
  for (const nlohmann::json& feature : features) {
    const int id = feature.value("id", -1);
    if (std::find(ids.begin(), ids.end(), id) != ids.end()) {
      selected.push_back(feature);
    }
  }
  return {{"model", describeModelInfo(model)},
          {"operation", operation},
          {"features", selected},
          {"verified", selected.size() == ids.size()}};
}

void executeFeatureOperations(pfcModel_ptr model, pfcFeatureOperations_ptr ops) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Feature operations require a solid model.");
  }
  if (!ops || ops->getarraysize() == 0) {
    throw BridgeError("INVALID_ARGUMENT", "At least one feature is required.");
  }
  solid->ExecuteFeatureOps(ops);
}

pfcFeatureOperation_ptr asOperation(pfcFeatureOperation_ptr operation) {
  if (!operation) {
    throw BridgeError("CREO_API_ERROR", "Creo could not create a feature operation.");
  }
  return operation;
}

}  // namespace

nlohmann::json saveModel(pfcModel_ptr model) {
  const bool saveAllowed = static_cast<bool>(model->CheckIsSaveAllowed(false));
  model->Save();
  const bool verified = !static_cast<bool>(model->GetIsModified());
  if (!verified) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo saved the model but it is still marked modified.",
                      false, {{"saveAllowed", saveAllowed}});
  }
  return {{"model", describeModelInfo(model)}, {"verified", true}};
}

nlohmann::json renameModel(pfcModel_ptr model, const std::string& newName) {
  if (!isBareModelName(newName)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "newName must be a plain Creo model name.");
  }
  model->Rename(newName.c_str(), xfalse);
  const std::string actual = toUtf8(model->GetFullName());
  const bool verified = equalsIgnoreCase(toWide(actual), toWide(newName));
  if (!verified) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not report the requested model name after rename.");
  }
  return {{"model", describeModelInfo(model)},
          {"newName", actual},
          {"verified", true}};
}

nlohmann::json copyModel(pfcModel_ptr model, const std::string& newName) {
  if (!isBareModelName(newName)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "newName must be a plain Creo model name.");
  }
  pfcModel_ptr copy = model->CopyAndRetrieve(newName.c_str());
  if (!copy) {
    throw BridgeError("CREO_API_ERROR", "Creo did not return the copied model.");
  }
  const std::string sourceName = toUtf8(model->GetFullName());
  const std::string copyName = toUtf8(copy->GetFullName());
  const bool verified = !equalsIgnoreCase(toWide(sourceName), toWide(copyName));
  if (!verified) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo returned the source model instead of a copy.");
  }
  return {{"sourceModel", describeModelInfo(model)},
          {"copyModel", describeModelInfo(copy)},
          {"verified", true}};
}

nlohmann::json regenerateModel(pfcModel_ptr model) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Regeneration requires a solid model.");
  }
  solid->Regenerate();
  return {{"model", describeModelInfo(model)},
          {"features", describeFeatures(model)},
          {"verified", true}};
}

nlohmann::json setModelParameter(pfcModel_ptr model, const std::string& name,
                                 const nlohmann::json& rawValue,
                                 bool createIfMissing) {
  pfcParamValue_ptr value = parseParamValue(rawValue);
  if (!value) {
    throw BridgeError("CREO_API_ERROR", "Could not construct parameter value.");
  }
  pfcParameter_ptr parameter = model->GetParam(name.c_str());
  bool created = false;
  if (!parameter) {
    if (!createIfMissing) {
      throw BridgeError("NOT_FOUND", "Parameter '" + name + "' is not present.");
    }
    parameter = model->CreateParam(name.c_str(), value);
    created = true;
  } else {
    parameter->SetValue(value);
  }
  if (!parameter) {
    throw BridgeError("CREO_API_ERROR", "Creo did not return the parameter.");
  }
  const nlohmann::json readback = findParameterReadback(model, name);
  const bool verified = !readback.is_null();
  if (!verified) {
    throw BridgeError("CREO_API_ERROR",
                      "Parameter write completed without a readable parameter.");
  }
  return {{"model", describeModelInfo(model)},
          {"parameter", readback},
          {"created", created},
          {"verified", true}};
}

nlohmann::json setModelDimension(pfcModel_ptr model, int dimensionId,
                                 double value) {
  if (!std::isfinite(value)) {
    throw BridgeError("INVALID_ARGUMENT", "Dimension value must be finite.");
  }
  pfcBaseDimension_ptr dimension = findDimension(model, dimensionId);
  dimension->SetDimValue(value);
  const nlohmann::json readback = findDimensionReadback(model, dimensionId);
  const bool verified = !readback.is_null() &&
                        std::abs(readback.value("value", 0.0) - value) < 1e-9;
  if (!verified) {
    throw BridgeError("CREO_API_ERROR",
                      "Dimension write completed with an unexpected value.");
  }
  return {{"model", describeModelInfo(model)},
          {"dimension", readback},
          {"verified", true}};
}

nlohmann::json suppressFeatures(pfcModel_ptr model,
                                const std::vector<int>& featureIds) {
  pfcFeatureOperations_ptr ops = pfcFeatureOperations::create();
  for (const int id : featureIds) {
    pfcFeature_ptr feature = findFeature(model, id);
    pfcSuppressOperation_ptr operation = feature->CreateSuppressOp();
    if (!operation) {
      throw BridgeError("CREO_API_ERROR", "Could not create suppress operation.");
    }
    operation->SetClip(xfalse);
    ops->append(asOperation(pfcFeatureOperation::cast(
        static_cast<pfcSuppressOperation*>(operation))));
  }
  executeFeatureOperations(model, ops);
  return featureMutationResult(model, "suppress", featureIds);
}

nlohmann::json resumeFeatures(pfcModel_ptr model,
                              const std::vector<int>& featureIds) {
  pfcFeatureOperations_ptr ops = pfcFeatureOperations::create();
  for (const int id : featureIds) {
    pfcFeature_ptr feature = findFeature(model, id);
    pfcResumeOperation_ptr operation = feature->CreateResumeOp();
    if (!operation) {
      throw BridgeError("CREO_API_ERROR", "Could not create resume operation.");
    }
    operation->SetWithParents(xfalse);
    ops->append(asOperation(pfcFeatureOperation::cast(
        static_cast<pfcResumeOperation*>(operation))));
  }
  executeFeatureOperations(model, ops);
  return featureMutationResult(model, "resume", featureIds);
}

nlohmann::json deleteFeatures(pfcModel_ptr model,
                              const std::vector<int>& featureIds) {
  pfcFeatureOperations_ptr ops = pfcFeatureOperations::create();
  for (const int id : featureIds) {
    pfcFeature_ptr feature = findFeature(model, id);
    pfcDeleteOperation_ptr operation = feature->CreateDeleteOp();
    if (!operation) {
      throw BridgeError("CREO_API_ERROR", "Could not create delete operation.");
    }
    operation->SetClip(xfalse);
    ops->append(asOperation(pfcFeatureOperation::cast(
        static_cast<pfcDeleteOperation*>(operation))));
  }
  executeFeatureOperations(model, ops);
  return featureMutationResult(model, "delete", featureIds);
}

nlohmann::json reorderFeature(pfcModel_ptr model, int featureId,
                              int referenceFeatureId, bool before) {
  pfcFeature_ptr feature = findFeature(model, featureId);
  pfcFeature_ptr reference = findFeature(model, referenceFeatureId);
  if (featureId == referenceFeatureId) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A feature cannot be reordered relative to itself.");
  }
  pfcFeatureOperations_ptr ops = pfcFeatureOperations::create();
  if (before) {
    pfcReorderBeforeOperation_ptr operation =
        feature->CreateReorderBeforeOp(reference);
    if (!operation) {
      throw BridgeError("CREO_API_ERROR",
                        "Could not create reorder-before operation.");
    }
    ops->append(asOperation(pfcFeatureOperation::cast(
        static_cast<pfcReorderBeforeOperation*>(operation))));
  } else {
    pfcReorderAfterOperation_ptr operation =
        feature->CreateReorderAfterOp(reference);
    if (!operation) {
      throw BridgeError("CREO_API_ERROR",
                        "Could not create reorder-after operation.");
    }
    ops->append(asOperation(pfcFeatureOperation::cast(
        static_cast<pfcReorderAfterOperation*>(operation))));
  }
  executeFeatureOperations(model, ops);
  return featureMutationResult(
      model, before ? "reorder_before" : "reorder_after", {featureId});
}

nlohmann::json createPart(pfcSession_ptr session, const std::string& name) {
  if (!isBareModelName(name)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "name must be a plain Creo model name.");
  }
  pfcPart_ptr part = session->CreatePart(name.c_str());
  if (!part) {
    throw BridgeError("CREO_API_ERROR", "Creo did not create the part.");
  }
  return {{"model", describeModelInfo(pfcModel::cast(static_cast<pfcPart*>(part)))},
          {"verified", true}};
}

nlohmann::json createAssembly(pfcSession_ptr session, const std::string& name) {
  if (!isBareModelName(name)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "name must be a plain Creo model name.");
  }
  pfcAssembly_ptr assembly = session->CreateAssembly(name.c_str());
  if (!assembly) {
    throw BridgeError("CREO_API_ERROR", "Creo did not create the assembly.");
  }
  return {{"model", describeModelInfo(pfcModel::cast(static_cast<pfcAssembly*>(assembly)))},
          {"verified", true}};
}

nlohmann::json assembleComponent(pfcAssembly_ptr assembly,
                                 pfcSolid_ptr component, double x, double y,
                                 double z, bool hasOffset) {
  if (!assembly) {
    throw BridgeError("INVALID_ARGUMENT",
                      "assemble_component requires an assembly model.");
  }
  if (!component) {
    throw BridgeError("INVALID_ARGUMENT",
                      "assemble_component requires a component model.");
  }
  if (hasOffset &&
      (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z))) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Component offset must be finite.");
  }
  pfcMatrix3D_ptr identity = pfcMatrix3D::create();
  if (!identity) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct the component orientation matrix.");
  }
  for (int row = 0; row < 4; ++row) {
    for (int column = 0; column < 4; ++column) {
      identity->set(row, column, row == column ? 1.0 : 0.0);
    }
  }
  pfcTransform3D_ptr position = pfcTransform3D::Create(identity);
  if (!position) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct the component placement transform.");
  }
  if (hasOffset) {
    pfcPoint3D_ptr origin = pfcPoint3D::create();
    if (!origin) {
      throw BridgeError("CREO_API_ERROR",
                        "Could not construct the component offset point.");
    }
    origin->set(0, x);
    origin->set(1, y);
    origin->set(2, z);
    position->SetOrigin(origin);
  }
  pfcModel_ptr assemblyModel = pfcModel::cast(static_cast<pfcAssembly*>(assembly));
  pfcFeature_ptr feature = assembly->AssembleComponent(component, position);
  if (!feature) {
    throw BridgeError("CREO_API_ERROR", "Creo did not assemble the component.");
  }
  const nlohmann::json features = describeFeatures(assemblyModel);
  const int featureId = static_cast<int>(feature->GetId());
  const nlohmann::json* created = nullptr;
  for (const auto& item : features) {
    if (item.value("id", -1) == featureId) {
      created = &item;
      break;
    }
  }
  if (!created) {
    throw BridgeError(
        "CREO_API_ERROR",
        "The assembled component did not appear in the assembly feature list.");
  }
  return {
      {"assembly", describeModelInfo(assemblyModel)},
      {"component", describeModelInfo(pfcModel::cast(static_cast<pfcSolid*>(component)))},
      {"feature", *created},
      {"features", features},
      {"verified", true}};
}

namespace {

bool isTemplateFileName(const std::string& name) {
  if (name.empty() || name.size() > 160 ||
      name.find("..") != std::string::npos) {
    return false;
  }
  for (size_t i = 0; i < name.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(name[i]);
    if (std::isalnum(c) != 0 || c == '_' || c == '-' || c == '.') {
      continue;
    }
    return false;
  }
  const std::string lower = lowerAscii(name);
  const size_t dot = lower.rfind('.');
  if (dot == std::string::npos) {
    return false;
  }
  const std::string extension = lower.substr(dot);
  return extension == ".prt" || extension == ".asm";
}

bool fileExists(const std::wstring& path) {
  return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

bool copyFileBytes(const std::wstring& source, const std::wstring& target) {
  std::ifstream input(source.c_str(), std::ios::binary);
  if (!input) {
    return false;
  }
  std::ofstream output(target.c_str(), std::ios::binary | std::ios::trunc);
  if (!output) {
    return false;
  }
  output << input.rdbuf();
  return output.good();
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

nlohmann::json createModelFromTemplate(pfcSession_ptr session,
                                       const std::string& templateDir,
                                       const std::string& templateName,
                                       const std::string& name) {
  if (templateDir.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A template directory is required.");
  }
  if (!isBareModelName(name)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "name must be a plain Creo model name.");
  }
  if (!isTemplateFileName(templateName)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "templateName must be a plain .prt or .asm file name.");
  }
  const std::string workingDirectory = toUtf8(session->GetCurrentDirectory());
  if (workingDirectory.empty()) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not report a working directory.");
  }
  const size_t dot = templateName.rfind('.');
  const std::string extension = templateName.substr(dot);
  const std::string targetFileName = name + extension;
  const std::string targetPath =
      joinPath(workingDirectory, targetFileName);
  if (fileExists(toWide(targetPath))) {
    throw BridgeError("INVALID_ARGUMENT", "The working directory already has '" +
                                              targetFileName + "'.");
  }
  const std::string sourcePath = joinPath(templateDir, templateName);
  if (!fileExists(toWide(sourcePath))) {
    throw BridgeError("NOT_FOUND", "Template '" + templateName +
                                       "' was not found in the Creo "
                                       "templates directory.");
  }
  if (!copyFileBytes(toWide(sourcePath), toWide(targetPath))) {
    throw BridgeError("CREO_API_ERROR", "Could not copy template '" +
                                            templateName +
                                            "' into the working directory.");
  }
  const nlohmann::json opened = openModel(session, targetFileName);
  return {{"created", true},
          {"template", templateName},
          {"targetFileName", targetFileName},
          {"model", opened.value("model", nlohmann::json())},
          {"verified", opened.value("model", nlohmann::json()) != nullptr}};
}

}  // namespace creo
