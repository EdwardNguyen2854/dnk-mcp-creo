// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "util.h"

#include <chrono>
#include <string>

#include <pfcAsyncConnection.h>
#include <pfcDrawing.h>
#include <pfcModel.h>
#include <pfcSession.h>

namespace creo {

class CreoBridge {
 public:
  CreoBridge();
  ~CreoBridge();

  nlohmann::json dispatch(const std::string& method,
                          const nlohmann::json& params);
  void shutdown();

 private:
  nlohmann::json dispatchInternal(const std::string& method,
                                  const nlohmann::json& params);

  nlohmann::json cmdBridgeHello();
  nlohmann::json cmdBridgePing();
  nlohmann::json cmdSessionConnect(const nlohmann::json& params);
  nlohmann::json cmdSessionDisconnect(const nlohmann::json& params);
  nlohmann::json cmdSessionInfo();
  nlohmann::json cmdModelActive();
  nlohmann::json cmdModelList(const nlohmann::json& params);
  nlohmann::json cmdModelInfo(const nlohmann::json& params);
  nlohmann::json cmdModelParameters(const nlohmann::json& params);
  nlohmann::json cmdModelDimensions(const nlohmann::json& params);
  nlohmann::json cmdModelFeatures(const nlohmann::json& params);
  nlohmann::json cmdModelRelations(const nlohmann::json& params);
  nlohmann::json cmdModelMassProperties(const nlohmann::json& params);
  nlohmann::json cmdModelMaterials(const nlohmann::json& params);
  nlohmann::json cmdModelLayers(const nlohmann::json& params);
  nlohmann::json cmdModelUnits(const nlohmann::json& params);
  nlohmann::json cmdModelGeometry(const nlohmann::json& params);
  nlohmann::json cmdModelSurfaces(const nlohmann::json& params);
  nlohmann::json cmdModelEdges(const nlohmann::json& params);
  nlohmann::json cmdModelFamilyTable(const nlohmann::json& params);
   nlohmann::json cmdModelOpen(const nlohmann::json& params);
   nlohmann::json cmdModelClose(const nlohmann::json& params);
  nlohmann::json cmdModelSave(const nlohmann::json& params);
  nlohmann::json cmdModelRename(const nlohmann::json& params);
  nlohmann::json cmdModelCopy(const nlohmann::json& params);
  nlohmann::json cmdModelRegenerate(const nlohmann::json& params);
  nlohmann::json cmdModelSetParameter(const nlohmann::json& params);
  nlohmann::json cmdModelSetDimension(const nlohmann::json& params);
  nlohmann::json cmdModelSuppressFeatures(const nlohmann::json& params);
  nlohmann::json cmdModelResumeFeatures(const nlohmann::json& params);
  nlohmann::json cmdModelDeleteFeatures(const nlohmann::json& params);
  nlohmann::json cmdModelReorderFeature(const nlohmann::json& params);
  nlohmann::json cmdModelCreatePart(const nlohmann::json& params);
  nlohmann::json cmdModelCreateAssembly(const nlohmann::json& params);
  nlohmann::json cmdModelCreateFromTemplate(const nlohmann::json& params);
  nlohmann::json cmdAssemblyAssembleComponent(const nlohmann::json& params);

  nlohmann::json cmdFeatureTree(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateExtrude(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateRevolve(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateRound(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateChamfer(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateShell(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateDatumPlane(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateDatumAxis(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateDatumPoint(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateHole(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreatePattern(const nlohmann::json& params);
  nlohmann::json cmdFeatureCreateMirror(const nlohmann::json& params);

  nlohmann::json cmdDrawingCreate(const nlohmann::json& params);
  nlohmann::json cmdDrawingListSheets(const nlohmann::json& params);
  nlohmann::json cmdDrawingAddSheet(const nlohmann::json& params);
  nlohmann::json cmdDrawingSetSheetScale(const nlohmann::json& params);
  nlohmann::json cmdDrawingListViews(const nlohmann::json& params);
  nlohmann::json cmdDrawingSave(const nlohmann::json& params);
  nlohmann::json cmdDrawingCreateGeneralView(const nlohmann::json& params);
  nlohmann::json cmdDrawingCreateProjectionView(const nlohmann::json& params);
  nlohmann::json cmdDrawingSetViewScale(const nlohmann::json& params);
  nlohmann::json cmdDrawingRenameView(const nlohmann::json& params);
  nlohmann::json cmdDrawingDeleteView(const nlohmann::json& params);
  nlohmann::json cmdDrawingTranslateView(const nlohmann::json& params);
  nlohmann::json cmdDrawingRegenerateView(const nlohmann::json& params);

  nlohmann::json cmdModelExportStep(const nlohmann::json& params);
  nlohmann::json cmdModelExportIges(const nlohmann::json& params);
  nlohmann::json cmdModelExportStl(const nlohmann::json& params);
  nlohmann::json cmdModelExportPdf(const nlohmann::json& params);
  nlohmann::json cmdModelExportDxf(const nlohmann::json& params);

  void connectSession(const std::string& mode, const std::string& creoCommand,
                      const std::string& textPath, int timeoutSec,
                      const std::string& display, const std::string& user);
  void disconnectSession(int timeoutSec);
  pfcSession_ptr requireSession();
  pfcModel_ptr resolveModel(const std::string& name);
  pfcDrawing_ptr resolveDrawing(const nlohmann::json& params);
  void fillVersionInfo(nlohmann::json& out, pfcSession_ptr session);
  nlohmann::json describeSession();

  pfcAsyncConnection_ptr conn_;
  bool launched_;
  std::chrono::steady_clock::time_point startedAt_;
};

}  // namespace creo
