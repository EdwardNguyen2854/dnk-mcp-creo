// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "util.h"

#include <string>

#include <pfcModel.h>
#include <pfcSession.h>

namespace creo {

// Serialization primitives (read-only, thin; policy lives in TypeScript).

nlohmann::json describeModelInfo(pfcModel_ptr model);

nlohmann::json paramValueToJson(pfcParamValue_ptr value);

nlohmann::json describeParameters(pfcModel_ptr model);
nlohmann::json describeDimensions(pfcModel_ptr model);
nlohmann::json describeFeatures(pfcModel_ptr model);
nlohmann::json describeRelations(pfcModel_ptr model);
nlohmann::json describeMassProperties(pfcModel_ptr model,
                                      const std::string& coordSys);
nlohmann::json describeMaterials(pfcModel_ptr model);
nlohmann::json describeLayers(pfcModel_ptr model);
nlohmann::json describeUnits(pfcModel_ptr model);
nlohmann::json describeGeometry(pfcModel_ptr model);
nlohmann::json describeSurfaces(pfcModel_ptr model);
nlohmann::json describeSurfaceById(pfcModel_ptr model,
                                   const std::vector<int>& ids);
nlohmann::json describeEdges(pfcModel_ptr model,
                             const std::vector<int>& ids);
nlohmann::json describeFamilyTable(pfcModel_ptr model);

nlohmann::json openModel(pfcSession_ptr session, const std::string& fileName);
nlohmann::json closeModel(pfcSession_ptr session, pfcModel_ptr model);

// Retrieves a model by plain file name from Creo's working directory (or
// returns the already-open model). Used where a command needs the model handle
// rather than the JSON readback that openModel returns.
pfcModel_ptr retrieveModel(pfcSession_ptr session, const std::string& fileName);

}  // namespace creo
