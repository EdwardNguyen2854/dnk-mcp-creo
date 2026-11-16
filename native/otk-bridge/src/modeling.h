// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "util.h"

#include <string>
#include <vector>

#include <pfcAssembly.h>
#include <pfcModel.h>
#include <pfcSession.h>

namespace creo {

// Thin model-editing primitives. Validation, safety policy, and verification
// decisions belong in the TypeScript layer; these functions only perform the
// OTK operation and return fresh readback data.

nlohmann::json saveModel(pfcModel_ptr model);
nlohmann::json renameModel(pfcModel_ptr model, const std::string& newName);
nlohmann::json copyModel(pfcModel_ptr model, const std::string& newName);
nlohmann::json regenerateModel(pfcModel_ptr model);
nlohmann::json setModelParameter(pfcModel_ptr model, const std::string& name,
                                 const nlohmann::json& value,
                                 bool createIfMissing);
nlohmann::json setModelDimension(pfcModel_ptr model, int dimensionId,
                                 double value);
nlohmann::json suppressFeatures(pfcModel_ptr model,
                                const std::vector<int>& featureIds);
nlohmann::json resumeFeatures(pfcModel_ptr model,
                              const std::vector<int>& featureIds);
nlohmann::json deleteFeatures(pfcModel_ptr model,
                              const std::vector<int>& featureIds);
nlohmann::json reorderFeature(pfcModel_ptr model, int featureId,
                              int referenceFeatureId, bool before);

nlohmann::json createPart(pfcSession_ptr session, const std::string& name);
nlohmann::json createAssembly(pfcSession_ptr session, const std::string& name);

// Assembles a part or subassembly into an assembly, translated by an optional
// offset in model units. The component must already be open in the session.
// Returns fresh feature readback so the caller can verify the component.
nlohmann::json assembleComponent(pfcAssembly_ptr assembly,
                                 pfcSolid_ptr component, double x, double y,
                                 double z, bool hasOffset);

// OTK has no create-part-from-template call, so this copies a whitelisted
// template file from the Creo templates directory into the session working
// directory and retrieves it as a new model. The caller supplies the template
// directory; this function only validates the file names.
nlohmann::json createModelFromTemplate(pfcSession_ptr session,
                                       const std::string& templateDir,
                                       const std::string& templateName,
                                       const std::string& name);

}  // namespace creo
