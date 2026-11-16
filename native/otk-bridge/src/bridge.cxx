// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "bridge.h"

#include "export.h"
#include "drawing.h"
#include "features.h"
#include "modeling.h"
#include "read.h"

#include <string>
#include <vector>

#include <pfcExceptions.h>
#include <pfcGlobal.h>
#include <pfcModel2D.h>
#include <pfcSolid.h>
#include <wfcSession.h>

#ifndef BRIDGE_OTK_LIB
#define BRIDGE_OTK_LIB "unknown"
#endif

namespace creo {

namespace {

std::string messageOf(const xstring& value) {
  return toUtf8(value);
}

}  // namespace

CreoBridge::CreoBridge() : conn_(nullptr), launched_(false) {
  startedAt_ = std::chrono::steady_clock::now();
}

CreoBridge::~CreoBridge() { shutdown(); }

void CreoBridge::shutdown() {
  if (!conn_) {
    return;
  }
  try {
    if (launched_) {
      conn_->End();
    } else {
      conn_->Disconnect(30);
    }
  } catch (...) {
    // Best effort only.
  }
  conn_ = nullptr;
  launched_ = false;
}

nlohmann::json CreoBridge::dispatch(const std::string& method,
                                    const nlohmann::json& params) {
  try {
    return dispatchInternal(method, params);
  }
  xcatchbegin
    xcatch(pfcXToolkitBusy, e) {
      throw BridgeError("CREO_BUSY",
                        messageOf(e->GetMessage()) +
                            " (Creo is busy; retry after the current operation completes)",
                        true);
    }
    xcatch(pfcXToolkitDeadLock, e) {
      throw BridgeError("CREO_BUSY", messageOf(e->GetMessage()), true);
    }
    xcatch(pfcXToolkitNoLicense, e) {
      throw BridgeError("LICENSE_UNAVAILABLE", messageOf(e->GetMessage()),
                        false, {{"hint", "A Creo TOOLKIT/OTK license was not available."}});
    }
    xcatch(pfcXToolkitAppNoLicense, e) {
      throw BridgeError("LICENSE_UNAVAILABLE", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitAppVersionMismatch, e) {
      throw BridgeError("APP_VERSION_MISMATCH", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitAppStartupFailed, e) {
      throw BridgeError("CREO_NOT_RUNNING", messageOf(e->GetMessage()), true);
    }
    xcatch(pfcXToolkitAppCommunicationFailure, e) {
      throw BridgeError("CREO_COMMUNICATION_FAILURE", messageOf(e->GetMessage()),
                        true);
    }
    xcatch(pfcXToolkitNotFound, e) {
      throw BridgeError("NOT_FOUND", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitNotExist, e) {
      throw BridgeError("NOT_FOUND", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitNotValid, e) {
      throw BridgeError("INVALID_ARGUMENT", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitBadInputs, e) {
      throw BridgeError("INVALID_ARGUMENT", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitCantModify, e) {
      throw BridgeError("PERMISSION_DENIED", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitNoPermission, e) {
      throw BridgeError("PERMISSION_DENIED", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitCantAccess, e) {
      throw BridgeError("PERMISSION_DENIED", messageOf(e->GetMessage()));
    }
    xcatch(pfcXToolkitError, e) {
      const int toolkitCode = e->GetErrorCode();
      throw BridgeError(
          "CREO_API_ERROR",
          messageOf(e->GetMessage()) + " (toolkit error " +
              std::to_string(toolkitCode) + ")",
          false,
          {{"toolkitErrorCode", toolkitCode},
           {"toolkitFunction", toUtf8(e->GetToolkitFunctionName())}});
    }
    xcatch(pfcXPFC, e) {
      throw BridgeError("CREO_API_ERROR", messageOf(e->GetMessage()));
    }
    xcatchall { throw BridgeError("INTERNAL", "Unhandled OTK exception"); }
  xcatchend
  catch (const BridgeError&) {
    throw;
  }
  catch (const std::exception& e) {
    throw BridgeError("INTERNAL", e.what());
  }
  catch (...) {
    throw BridgeError("INTERNAL", "Unknown native bridge failure");
  }
}

nlohmann::json CreoBridge::dispatchInternal(const std::string& method,
                                            const nlohmann::json& params) {
  if (method == "bridge.hello") {
    return cmdBridgeHello();
  }
  if (method == "bridge.ping") {
    return cmdBridgePing();
  }
  if (method == "session.connect") {
    return cmdSessionConnect(params);
  }
  if (method == "session.disconnect") {
    return cmdSessionDisconnect(params);
  }
  if (method == "session.info") {
    return cmdSessionInfo();
  }
  if (method == "model.active") {
    return cmdModelActive();
  }
  if (method == "model.list") {
    return cmdModelList(params);
  }
  if (method == "model.info") {
    return cmdModelInfo(params);
  }
  if (method == "model.parameters") {
    return cmdModelParameters(params);
  }
  if (method == "model.dimensions") {
    return cmdModelDimensions(params);
  }
  if (method == "model.features") {
    return cmdModelFeatures(params);
  }
  if (method == "model.relations") {
    return cmdModelRelations(params);
  }
  if (method == "model.mass_properties") {
    return cmdModelMassProperties(params);
  }
  if (method == "model.materials") {
    return cmdModelMaterials(params);
  }
  if (method == "model.layers") {
    return cmdModelLayers(params);
  }
  if (method == "model.units") {
    return cmdModelUnits(params);
  }
  if (method == "model.geometry") {
    return cmdModelGeometry(params);
  }
  if (method == "model.surfaces") {
    return cmdModelSurfaces(params);
  }
  if (method == "model.edges") {
    return cmdModelEdges(params);
  }
  if (method == "model.family_table") {
    return cmdModelFamilyTable(params);
  }
  if (method == "model.open") {
    return cmdModelOpen(params);
  }
  if (method == "model.close") {
    return cmdModelClose(params);
  }
  if (method == "model.save") {
    return cmdModelSave(params);
  }
  if (method == "model.rename") {
    return cmdModelRename(params);
  }
  if (method == "model.copy") {
    return cmdModelCopy(params);
  }
  if (method == "model.regenerate") {
    return cmdModelRegenerate(params);
  }
  if (method == "model.set_parameter") {
    return cmdModelSetParameter(params);
  }
  if (method == "model.set_dimension") {
    return cmdModelSetDimension(params);
  }
  if (method == "model.features.suppress") {
    return cmdModelSuppressFeatures(params);
  }
  if (method == "model.features.resume") {
    return cmdModelResumeFeatures(params);
  }
  if (method == "model.features.delete") {
    return cmdModelDeleteFeatures(params);
  }
  if (method == "model.features.reorder") {
    return cmdModelReorderFeature(params);
  }
  if (method == "model.create_part") {
    return cmdModelCreatePart(params);
  }
  if (method == "model.create_assembly") {
    return cmdModelCreateAssembly(params);
  }
  if (method == "model.create_from_template") {
    return cmdModelCreateFromTemplate(params);
  }
  if (method == "assembly.assemble_component") {
    return cmdAssemblyAssembleComponent(params);
  }
  if (method == "feature.tree") {
    return cmdFeatureTree(params);
  }
  if (method == "feature.create_extrude") {
    return cmdFeatureCreateExtrude(params);
  }
  if (method == "feature.create_revolve") {
    return cmdFeatureCreateRevolve(params);
  }
  if (method == "feature.create_round") {
    return cmdFeatureCreateRound(params);
  }
  if (method == "feature.create_chamfer") {
    return cmdFeatureCreateChamfer(params);
  }
  if (method == "feature.create_shell") {
    return cmdFeatureCreateShell(params);
  }
  if (method == "feature.create_datum_plane") {
    return cmdFeatureCreateDatumPlane(params);
  }
  if (method == "feature.create_datum_axis") {
    return cmdFeatureCreateDatumAxis(params);
  }
  if (method == "feature.create_datum_point") {
    return cmdFeatureCreateDatumPoint(params);
  }
  if (method == "feature.create_hole") {
    return cmdFeatureCreateHole(params);
  }
  if (method == "feature.create_pattern") {
    return cmdFeatureCreatePattern(params);
  }
  if (method == "drawing.create") {
    return cmdDrawingCreate(params);
  }
  if (method == "drawing.list_sheets") {
    return cmdDrawingListSheets(params);
  }
  if (method == "drawing.add_sheet") {
    return cmdDrawingAddSheet(params);
  }
  if (method == "drawing.set_sheet_scale") {
    return cmdDrawingSetSheetScale(params);
  }
  if (method == "drawing.list_views") {
    return cmdDrawingListViews(params);
  }
  if (method == "drawing.save") {
    return cmdDrawingSave(params);
  }
  if (method == "drawing.create_general_view") {
    return cmdDrawingCreateGeneralView(params);
  }
  if (method == "drawing.create_projection_view") {
    return cmdDrawingCreateProjectionView(params);
  }
  if (method == "drawing.set_view_scale") {
    return cmdDrawingSetViewScale(params);
  }
  if (method == "drawing.rename_view") {
    return cmdDrawingRenameView(params);
  }
  if (method == "drawing.delete_view") {
    return cmdDrawingDeleteView(params);
  }
  if (method == "drawing.translate_view") {
    return cmdDrawingTranslateView(params);
  }
  if (method == "drawing.regenerate_view") {
    return cmdDrawingRegenerateView(params);
  }
  if (method == "model.export_step") {
    return cmdModelExportStep(params);
  }
  if (method == "model.export_iges") {
    return cmdModelExportIges(params);
  }
  if (method == "model.export_stl") {
    return cmdModelExportStl(params);
  }
  if (method == "model.export_pdf") {
    return cmdModelExportPdf(params);
  }
  if (method == "model.export_dxf") {
    return cmdModelExportDxf(params);
  }
  throw BridgeError("METHOD_NOT_FOUND", "Unknown bridge method: " + method);
}

nlohmann::json CreoBridge::cmdBridgeHello() {
  nlohmann::json out;
  out["protocolVersion"] = "1.0";
  out["bridge"] = {{"name", "creo-otk-bridge"},
                   {"version", "0.1.0"},
                   {"build", std::string(__DATE__) + " " + std::string(__TIME__)}};
  out["platform"] = "win64";
  out["otkLibrary"] = BRIDGE_OTK_LIB;
  const bool connected = conn_ && conn_->IsRunning();
  out["connected"] = connected;
  out["capabilities"] = nlohmann::json::array(
      {"bridge.hello", "bridge.ping", "session.connect", "session.disconnect",
       "session.info", "model.active", "model.list", "model.info",
       "model.parameters", "model.dimensions", "model.features",
       "model.relations", "model.mass_properties", "model.materials",
       "model.layers", "model.units", "model.geometry", "model.surfaces",
       "model.edges",
       "model.family_table",
        "model.open", "model.close", "model.export_step", "model.export_iges",
        "model.export_stl", "model.export_pdf", "model.export_dxf",
        "model.save", "model.rename", "model.copy", "model.regenerate",
        "model.set_parameter", "model.set_dimension",
        "model.features.suppress", "model.features.resume",
        "model.features.delete", "model.features.reorder",
        "model.create_part", "model.create_assembly",
        "model.create_from_template", "assembly.assemble_component",
        "feature.tree",
        "feature.create_extrude", "feature.create_revolve",
        "feature.create_round", "feature.create_chamfer",
         "feature.create_shell", "feature.create_datum_plane",
         "feature.create_datum_axis", "feature.create_datum_point",
          "feature.create_hole", "feature.create_pattern", "drawing.create",
        "drawing.list_sheets", "drawing.add_sheet",
        "drawing.set_sheet_scale", "drawing.list_views",
        "drawing.save",
        "drawing.create_general_view", "drawing.create_projection_view",
        "drawing.set_view_scale", "drawing.rename_view",
        "drawing.delete_view", "drawing.translate_view",
        "drawing.regenerate_view"});
  if (connected) {
    fillVersionInfo(out, conn_->GetSession());
  }
  return out;
}

nlohmann::json CreoBridge::cmdBridgePing() {
  const bool connected = conn_ && conn_->IsRunning();
  const auto uptime = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::steady_clock::now() - startedAt_)
                          .count();
  return {{"pong", true}, {"connected", connected}, {"uptimeMs", uptime}};
}

void CreoBridge::connectSession(const std::string& mode,
                                const std::string& creoCommand,
                                const std::string& textPath, int timeoutSec,
                                const std::string& display,
                                const std::string& user) {
  if (conn_ && conn_->IsRunning()) {
    return;
  }
  conn_ = nullptr;
  launched_ = false;

  if (mode == "launch") {
    if (creoCommand.empty()) {
      throw BridgeError("INVALID_ARGUMENT",
                        "session.connect with mode=launch requires creoCommand");
    }
    const std::wstring wideCommand = toWide(creoCommand);
    if (textPath.empty()) {
      conn_ = pfcAsyncConnection::Start(xstring(wideCommand.c_str()));
    } else {
      const std::wstring wideText = toWide(textPath);
      conn_ = pfcAsyncConnection::Start(xstring(wideCommand.c_str()),
                                        xstring(wideText.c_str()));
    }
    launched_ = true;
  } else if (mode == "attach" || mode.empty()) {
    const int timeout = timeoutSec > 0 ? timeoutSec : 20;
    const std::wstring wideDisplay = toWide(display);
    const std::wstring wideUser = toWide(user);
    try {
      const xstring displayArg =
          display.empty() ? xstring(xstringnil) : xstring(wideDisplay.c_str());
      const xstring userArg =
          user.empty() ? xstring(xstringnil) : xstring(wideUser.c_str());
      if (textPath.empty()) {
        conn_ = pfcAsyncConnection::Connect(displayArg, userArg, xstringnil,
                                            timeout);
      } else {
        const std::wstring wideText = toWide(textPath);
        conn_ = pfcAsyncConnection::Connect(displayArg, userArg,
                                            xstring(wideText.c_str()), timeout);
      }
    }
    xcatchbegin
      xcatch(pfcXToolkitNotFound, e) {
        throw BridgeError(
            "CREO_NOT_RUNNING",
            "No running Creo Parametric session was found. Start Creo "
            "Parametric and retry, or use mode=launch.",
            true);
      }
      xcatch(pfcXToolkitError, e) {
        throw BridgeError(
            "CREO_NOT_RUNNING",
            "Could not attach to Creo Parametric: " +
                messageOf(e->GetMessage()),
            true);
      }
      xcatch(pfcXPFC, e) {
        throw BridgeError("CREO_NOT_RUNNING", messageOf(e->GetMessage()),
                          true);
      }
    xcatchend
    catch (const BridgeError&) {
      throw;
    }
    catch (const std::exception& e) {
      throw BridgeError("CREO_NOT_RUNNING", e.what(), true);
    }
    catch (...) {
      throw BridgeError("CREO_NOT_RUNNING",
                        "Unknown failure while contacting Creo Parametric",
                        true);
    }
  } else {
    throw BridgeError("INVALID_ARGUMENT",
                      "session.connect mode must be 'attach' or 'launch'");
  }

  if (!conn_ || !conn_->IsRunning()) {
    conn_ = nullptr;
    throw BridgeError(
        "CREO_NOT_RUNNING",
        "No running Creo Parametric session could be reached. Start Creo "
        "Parametric and retry, or use mode=launch with an explicit command line.",
        true);
  }
  startedAt_ = std::chrono::steady_clock::now();
}

void CreoBridge::disconnectSession(int timeoutSec) {
  if (!conn_) {
    return;
  }
  try {
    if (launched_) {
      conn_->End();
    } else {
      conn_->Disconnect(timeoutSec > 0 ? timeoutSec : 30);
    }
  }
  xcatchbegin
    xcatchall {
      // Ignore teardown errors; the session may already be gone.
    }
  xcatchend
  catch (...) {
    // Ignore teardown errors.
  }
  conn_ = nullptr;
  launched_ = false;
}

pfcSession_ptr CreoBridge::requireSession() {
  if (!conn_ || !conn_->IsRunning()) {
    throw BridgeError(
        "SESSION_NOT_CONNECTED",
        "The bridge is not attached to a Creo session. Call session.connect first.",
        true);
  }
  pfcSession_ptr session = conn_->GetSession();
  if (!session) {
    throw BridgeError("SESSION_NOT_CONNECTED",
                      "Creo session handle is not available", true);
  }
  return session;
}

void CreoBridge::fillVersionInfo(nlohmann::json& out, pfcSession_ptr session) {
  if (!session) {
    return;
  }
  try {
    wfcWSession_ptr wsession = wfcWSession::cast(session);
    if (!wsession) {
      return;
    }
    const xint major = wsession->GetReleaseNumericVersion();
    const xstring dateCode = wsession->GetDisplayDateCode();
    if (major > 0) {
      out["creoMajorVersion"] = static_cast<int>(major);
    }
    if (!dateCode.IsNull()) {
      out["creoDateCode"] = toUtf8(dateCode);
      out["creoVersion"] = toUtf8(dateCode);
    } else if (major > 0) {
      out["creoVersion"] = std::to_string(static_cast<int>(major));
    }
  }
  xcatchbegin
    xcatchall { return; }
  xcatchend
  catch (...) {
    return;
  }
}

pfcModel_ptr CreoBridge::resolveModel(const std::string& name) {
  pfcSession_ptr session = requireSession();
  if (name.empty()) {
    pfcModel_ptr current = session->GetCurrentModel();
    if (!current) {
      throw BridgeError("MODEL_NOT_FOUND",
                        "No active model is open in the Creo session.");
    }
    return current;
  }

  const std::wstring wanted = toWide(name);
  pfcModels_ptr models = session->ListModels();
  if (models) {
    const int count = models->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcModel_ptr model = models->get(i);
      if (!model) {
        continue;
      }
      const std::wstring modelName(
          static_cast<cWStringT>(model->GetFullName()));
      const std::wstring fileName(static_cast<cWStringT>(model->GetFileName()));
      const std::wstring instanceName(
          static_cast<cWStringT>(model->GetInstanceName()));
      if (equalsIgnoreCase(modelName, wanted) ||
          equalsIgnoreCase(fileName, wanted) ||
          equalsIgnoreCase(instanceName, wanted)) {
        return model;
      }
    }
  }
  throw BridgeError("MODEL_NOT_FOUND",
                    "Model '" + name + "' is not open in the Creo session.");
}

nlohmann::json CreoBridge::describeSession() {
  pfcSession_ptr session = requireSession();
  nlohmann::json out;
  out["connected"] = true;
  out["launched"] = launched_;
  fillVersionInfo(out, session);
  out["workingDirectory"] = toUtf8(session->GetCurrentDirectory());

  pfcModel_ptr active = session->GetCurrentModel();
  out["activeModel"] = active ? describeModelInfo(active) : nlohmann::json(nullptr);

  nlohmann::json models = nlohmann::json::array();
  pfcModels_ptr all = session->ListModels();
  if (all) {
    const int count = all->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcModel_ptr model = all->get(i);
      if (model) {
        models.push_back(describeModelInfo(model));
      }
    }
  }
  out["modelCount"] = models.size();
  out["models"] = std::move(models);
  return out;
}

nlohmann::json CreoBridge::cmdSessionConnect(const nlohmann::json& params) {
  const std::string mode = params.value("mode", "attach");
  const std::string creoCommand = params.value("creoCommand", std::string());
  const std::string textPath = params.value("textPath", std::string());
  const std::string display = params.value("display", std::string());
  const std::string user = params.value("user", std::string());
  const int timeoutSec = params.value("timeoutSec", 0);
  connectSession(mode, creoCommand, textPath, timeoutSec, display, user);
  nlohmann::json out = describeSession();
  out["connectionMode"] = mode;
  return out;
}

nlohmann::json CreoBridge::cmdSessionDisconnect(const nlohmann::json& params) {
  const int timeoutSec = params.value("timeoutSec", 0);
  disconnectSession(timeoutSec);
  return {{"connected", false}};
}

nlohmann::json CreoBridge::cmdSessionInfo() {
  if (!conn_ || !conn_->IsRunning()) {
    return {{"connected", false}};
  }
  return describeSession();
}

nlohmann::json CreoBridge::cmdModelActive() {
  pfcSession_ptr session = requireSession();
  pfcModel_ptr current = session->GetCurrentModel();
  return {{"model", current ? describeModelInfo(current) : nlohmann::json(nullptr)}};
}

nlohmann::json CreoBridge::cmdModelList(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  const std::string typeFilter = params.value("type", "all");
  nlohmann::json models = nlohmann::json::array();
  pfcModels_ptr all = session->ListModels();
  if (all) {
    const int count = all->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcModel_ptr model = all->get(i);
      if (!model) {
        continue;
      }
      if (typeFilter != "all" && modelTypeName(model->GetType()) != typeFilter) {
        continue;
      }
      models.push_back(describeModelInfo(model));
    }
  }
  const auto modelCount = models.size();
  return {{"models", std::move(models)}, {"count", modelCount}};
}

nlohmann::json CreoBridge::cmdModelInfo(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)}};
}

nlohmann::json CreoBridge::cmdModelParameters(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"parameters", describeParameters(model)}};
}

nlohmann::json CreoBridge::cmdModelDimensions(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"dimensions", describeDimensions(model)}};
}

nlohmann::json CreoBridge::cmdModelFeatures(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"features", describeFeatures(model)}};
}

nlohmann::json CreoBridge::cmdModelRelations(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"relations", describeRelations(model)}};
}

nlohmann::json CreoBridge::cmdModelMassProperties(
    const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  const std::string csys = params.value("csys", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"massProperties", describeMassProperties(model, csys)}};
}

nlohmann::json CreoBridge::cmdModelMaterials(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  nlohmann::json materials = describeMaterials(model);
  return {{"model", describeModelInfo(model)},
          {"supported", materials["supported"]},
          {"currentMaterial", materials["currentMaterial"]},
          {"materials", materials["materials"]}};
}

nlohmann::json CreoBridge::cmdModelLayers(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"layers", describeLayers(model)}};
}

nlohmann::json CreoBridge::cmdModelUnits(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"units", describeUnits(model)}};
}

nlohmann::json CreoBridge::cmdModelGeometry(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"geometry", describeGeometry(model)}};
}

nlohmann::json CreoBridge::cmdModelSurfaces(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  nlohmann::json out = {{"model", describeModelInfo(model)},
                        {"surfaces", describeSurfaces(model)}};
  if (params.contains("ids") && params["ids"].is_array()) {
    std::vector<int> ids;
    for (const nlohmann::json& value : params["ids"]) {
      if (value.is_number_integer()) {
        ids.push_back(value.get<int>());
      }
    }
    out["byId"] = describeSurfaceById(model, ids);
  }
  return out;
}

nlohmann::json CreoBridge::cmdModelEdges(const nlohmann::json& params) {
  pfcModel_ptr model = resolveModel(params.value("name", std::string()));
  std::vector<int> ids;
  if (params.contains("ids") && params["ids"].is_array()) {
    for (const nlohmann::json& value : params["ids"]) {
      if (value.is_number_integer()) {
        ids.push_back(value.get<int>());
      }
    }
  }
  return {{"model", describeModelInfo(model)},
          {"edges", describeEdges(model, ids)}};
}

nlohmann::json CreoBridge::cmdModelFamilyTable(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return {{"model", describeModelInfo(model)},
          {"familyTable", describeFamilyTable(model)}};
}

nlohmann::json CreoBridge::cmdModelOpen(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  const std::string fileName = params.value("fileName", std::string());
  if (fileName.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.open requires a fileName parameter");
  }
  return openModel(session, fileName);
}

nlohmann::json CreoBridge::cmdModelClose(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  const std::string name = params.value("name", std::string());
  pfcModel_ptr model = resolveModel(name);
  return closeModel(session, model);
}

nlohmann::json CreoBridge::cmdModelSave(const nlohmann::json& params) {
  return saveModel(resolveModel(params.value("name", std::string())));
}

nlohmann::json CreoBridge::cmdModelRename(const nlohmann::json& params) {
  const std::string newName = params.value("newName", std::string());
  if (newName.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.rename requires a newName parameter");
  }
  return renameModel(resolveModel(params.value("name", std::string())),
                     newName);
}

nlohmann::json CreoBridge::cmdModelCopy(const nlohmann::json& params) {
  const std::string newName = params.value("newName", std::string());
  if (newName.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.copy requires a newName parameter");
  }
  return copyModel(resolveModel(params.value("name", std::string())), newName);
}

nlohmann::json CreoBridge::cmdModelRegenerate(const nlohmann::json& params) {
  return regenerateModel(resolveModel(params.value("name", std::string())));
}

nlohmann::json CreoBridge::cmdModelSetParameter(const nlohmann::json& params) {
  const std::string parameterName = params.value("paramName", std::string());
  if (parameterName.empty() || !params.contains("value")) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.set_parameter requires paramName and value");
  }
  return setModelParameter(resolveModel(params.value("name", std::string())),
                           parameterName, params.at("value"),
                           params.value("createIfMissing", false));
}

nlohmann::json CreoBridge::cmdModelSetDimension(const nlohmann::json& params) {
  if (!params.contains("dimensionId") || !params["dimensionId"].is_number_integer() ||
      !params.contains("value") || !params["value"].is_number()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.set_dimension requires integer dimensionId and numeric value");
  }
  return setModelDimension(resolveModel(params.value("name", std::string())),
                           params.at("dimensionId").get<int>(),
                           params.at("value").get<double>());
}

namespace {

std::vector<int> featureIdsFromParams(const nlohmann::json& params) {
  if (!params.contains("featureIds") || !params["featureIds"].is_array() ||
      params["featureIds"].empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Feature operations require a non-empty featureIds array");
  }
  std::vector<int> ids;
  for (const nlohmann::json& value : params["featureIds"]) {
    if (!value.is_number_integer()) {
      throw BridgeError("INVALID_ARGUMENT", "featureIds must contain integers");
    }
    ids.push_back(value.get<int>());
  }
  return ids;
}

double numberParam(const nlohmann::json& params, const char* key,
                   double fallback) {
  if (!params.contains(key)) {
    return fallback;
  }
  if (!params.at(key).is_number()) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string("Parameter '") + key + "' must be numeric");
  }
  return params.at(key).get<double>();
}

int intParam(const nlohmann::json& params, const char* key, int fallback) {
  if (!params.contains(key)) {
    return fallback;
  }
  if (!params.at(key).is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string("Parameter '") + key + "' must be an integer");
  }
  return params.at(key).get<int>();
}

std::vector<int> intArrayParam(const nlohmann::json& params, const char* key) {
  std::vector<int> out;
  if (!params.contains(key)) {
    return out;
  }
  if (!params.at(key).is_array()) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string("Parameter '") + key +
                          "' must be an array of integers");
  }
  for (const nlohmann::json& value : params.at(key)) {
    if (!value.is_number_integer()) {
      throw BridgeError("INVALID_ARGUMENT",
                        std::string("Parameter '") + key +
                            "' must contain only integers");
    }
    out.push_back(value.get<int>());
  }
  return out;
}

}  // namespace

pfcDrawing_ptr CreoBridge::resolveDrawing(const nlohmann::json& params) {
  pfcDrawing_ptr drawing = pfcDrawing::cast(
      resolveModel(params.value("name", std::string())));
  if (!drawing) {
    throw BridgeError("INVALID_ARGUMENT",
                      "The selected model is not a drawing model.");
  }
  return drawing;
}

nlohmann::json CreoBridge::cmdModelSuppressFeatures(
    const nlohmann::json& params) {
  return suppressFeatures(resolveModel(params.value("name", std::string())),
                          featureIdsFromParams(params));
}

nlohmann::json CreoBridge::cmdModelResumeFeatures(
    const nlohmann::json& params) {
  return resumeFeatures(resolveModel(params.value("name", std::string())),
                        featureIdsFromParams(params));
}

nlohmann::json CreoBridge::cmdModelDeleteFeatures(
    const nlohmann::json& params) {
  return deleteFeatures(resolveModel(params.value("name", std::string())),
                        featureIdsFromParams(params));
}

nlohmann::json CreoBridge::cmdModelReorderFeature(
    const nlohmann::json& params) {
  if (!params.contains("featureId") || !params["featureId"].is_number_integer() ||
      !params.contains("referenceFeatureId") ||
      !params["referenceFeatureId"].is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.features.reorder requires featureId and referenceFeatureId");
  }
  const bool before = params.value("before", false);
  return reorderFeature(resolveModel(params.value("name", std::string())),
                        params.at("featureId").get<int>(),
                        params.at("referenceFeatureId").get<int>(), before);
}

nlohmann::json CreoBridge::cmdModelCreatePart(const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  if (name.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.create_part requires a name parameter");
  }
  return createPart(requireSession(), name);
}

nlohmann::json CreoBridge::cmdModelCreateAssembly(
    const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  if (name.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.create_assembly requires a name parameter");
  }
  return createAssembly(requireSession(), name);
}

nlohmann::json CreoBridge::cmdModelCreateFromTemplate(
    const nlohmann::json& params) {
  const std::string templateDir = params.value("templateDir", std::string());
  const std::string templateName = params.value("template", std::string());
  const std::string name = params.value("name", std::string());
  if (templateDir.empty() || templateName.empty() || name.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "model.create_from_template requires templateDir, "
                      "template, and name parameters");
  }
  return createModelFromTemplate(requireSession(), templateDir, templateName,
                                 name);
}

nlohmann::json CreoBridge::cmdAssemblyAssembleComponent(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  const std::string componentName = params.value("component", std::string());
  if (componentName.empty()) {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "assembly.assemble_component requires a component parameter");
  }
  pfcAssembly_ptr assembly =
      pfcAssembly::cast(resolveModel(params.value("name", std::string())));
  if (!assembly) {
    throw BridgeError("INVALID_ARGUMENT",
                      "The target model is not an assembly.");
  }
  pfcModel_ptr componentModel = nullptr;
  try {
    componentModel = resolveModel(componentName);
  } catch (const BridgeError& error) {
    if (error.code != "MODEL_NOT_FOUND") {
      throw;
    }
  }
  if (!componentModel) {
    std::string fileName = componentName;
    if (fileName.find('.') == std::string::npos) {
      fileName += ".prt";
    }
    componentModel = retrieveModel(session, fileName);
    if (!componentModel) {
      throw BridgeError(
          "MODEL_NOT_FOUND",
          "Component '" + componentName +
              "' is not open and could not be retrieved from the working directory.");
    }
  }
  pfcSolid_ptr component = pfcSolid::cast(componentModel);
  if (!component) {
    throw BridgeError("INVALID_ARGUMENT",
                      "The component must be a part or an assembly.");
  }
  const bool hasOffset =
      params.contains("x") || params.contains("y") || params.contains("z");
  return assembleComponent(assembly, component, numberParam(params, "x", 0.0),
                           numberParam(params, "y", 0.0),
                           numberParam(params, "z", 0.0), hasOffset);
}

nlohmann::json CreoBridge::cmdFeatureTree(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  const int featureId = intParam(params, "featureId", -1);
  if (featureId <= 0) {
    throw BridgeError("INVALID_ARGUMENT",
                      "feature.tree requires a positive featureId parameter");
  }
  return describeFeatureTree(session,
                             resolveModel(params.value("name", std::string())),
                             featureId, params.value("includeXml", true),
                             intParam(params, "maxChars", 262144));
}

namespace {

SolidFeatureRequest solidFeatureRequest(const nlohmann::json& params,
                                        const std::string& kind) {
  SolidFeatureRequest request;
  request.kind = kind;
  request.sketchPlane = params.value("sketchPlane", std::string());
  request.sketchPlaneSurfaceId =
      params.value("sketchPlaneSurfaceId", static_cast<int>(-1));
  request.sketchPlaneFeatureId =
      params.value("sketchPlaneFeatureId", static_cast<int>(-1));
  request.orientRef = params.value("orientRef", std::string());
  request.orientRefSurfaceId =
      params.value("orientRefSurfaceId", static_cast<int>(-1));
  request.orientRefFeatureId =
      params.value("orientRefFeatureId", static_cast<int>(-1));
  request.depth = params.value("depth", 0.0);
  request.angle = params.value("angle", 360.0);
  request.symmetric = params.value("symmetric", false);
  request.direction = params.value("direction", 1);
  request.removeMaterial = params.value("removeMaterial", false);
  request.featureName = params.value("featureName", std::string());
  request.entities = params.contains("entities") ? params.at("entities")
                                                 : nlohmann::json::array();
  return request;
}

}  // namespace

nlohmann::json CreoBridge::cmdFeatureCreateExtrude(
    const nlohmann::json& params) {
  return createSolidFeature(
      resolveModel(params.value("name", std::string())),
      solidFeatureRequest(params, "extrude"));
}

nlohmann::json CreoBridge::cmdFeatureCreateRevolve(
    const nlohmann::json& params) {
  return createSolidFeature(
      resolveModel(params.value("name", std::string())),
      solidFeatureRequest(params, "revolve"));
}

nlohmann::json CreoBridge::cmdFeatureCreateRound(const nlohmann::json& params) {
  RoundFeatureRequest request;
  request.featureName = params.value("featureName", std::string());
  request.edgeIds = intArrayParam(params, "edgeIds");
  request.radius = numberParam(params, "radius", 0.0);
  return createRoundFeature(resolveModel(params.value("name", std::string())),
                            request);
}

nlohmann::json CreoBridge::cmdFeatureCreateChamfer(
    const nlohmann::json& params) {
  ChamferFeatureRequest request;
  request.featureName = params.value("featureName", std::string());
  request.edgeIds = intArrayParam(params, "edgeIds");
  request.schema = intParam(params, "schema", 601);
  request.distance1 = numberParam(params, "distance1", 0.0);
  request.distance2 = numberParam(params, "distance2", 0.0);
  request.angle = numberParam(params, "angle", 0.0);
  return createChamferFeature(resolveModel(params.value("name", std::string())),
                              request);
}

nlohmann::json CreoBridge::cmdFeatureCreateShell(const nlohmann::json& params) {
  ShellFeatureRequest request;
  request.featureName = params.value("featureName", std::string());
  request.surfaceIds = intArrayParam(params, "surfaceIds");
  request.thickness = numberParam(params, "thickness", 0.0);
  request.flip = params.value("flip", false);
  return createShellFeature(resolveModel(params.value("name", std::string())),
                            request);
}

namespace {

DatumPlaneRequest parseDatumPlaneRequest(const nlohmann::json& params) {
  DatumPlaneRequest request;
  request.featureName = params.value("featureName", std::string());
  request.type = params.value("type", std::string("offset"));
  request.reference = params.value("reference", std::string());
  request.referenceSurfaceId = intParam(params, "referenceSurfaceId", -1);
  request.referenceFeatureId = intParam(params, "referenceFeatureId", -1);
  request.referenceEdgeId = intParam(params, "referenceEdgeId", -1);
  request.about = params.value("about", std::string());
  request.aboutSurfaceId = intParam(params, "aboutSurfaceId", -1);
  request.aboutFeatureId = intParam(params, "aboutFeatureId", -1);
  request.distance = numberParam(params, "distance", 0.0);
  request.angle = numberParam(params, "angle", 0.0);
  request.flip = params.value("flip", false);
  return request;
}

DatumAxisRequest parseDatumAxisRequest(const nlohmann::json& params) {
  DatumAxisRequest request;
  request.featureName = params.value("featureName", std::string());
  request.type = params.value("type", std::string());
  request.plane1 = params.value("plane1", std::string());
  request.plane2 = params.value("plane2", std::string());
  request.plane1SurfaceId = intParam(params, "plane1SurfaceId", -1);
  request.plane2SurfaceId = intParam(params, "plane2SurfaceId", -1);
  request.plane1FeatureId = intParam(params, "plane1FeatureId", -1);
  request.plane2FeatureId = intParam(params, "plane2FeatureId", -1);
  request.edgeId = intParam(params, "edgeId", -1);
  request.surfaceId = intParam(params, "surfaceId", -1);
  request.point1Id = intParam(params, "point1Id", -1);
  request.point2Id = intParam(params, "point2Id", -1);
  return request;
}

DatumPointRequest parseDatumPointRequest(const nlohmann::json& params) {
  DatumPointRequest request;
  request.featureName = params.value("featureName", std::string());
  request.type = params.value("type", std::string());
  request.surfaceId = intParam(params, "surfaceId", -1);
  request.edgeId = intParam(params, "edgeId", -1);
  request.ratio = numberParam(params, "ratio", 0.5);
  return request;
}

HoleFeatureRequest parseHoleRequest(const nlohmann::json& params) {
  HoleFeatureRequest request;
  request.featureName = params.value("featureName", std::string());
  request.placement = params.value("placement", std::string());
  request.plane = params.value("plane", std::string());
  request.planeSurfaceId = intParam(params, "planeSurfaceId", -1);
  request.planeFeatureId = intParam(params, "planeFeatureId", -1);
  request.ref1 = params.value("ref1", std::string());
  request.ref2 = params.value("ref2", std::string());
  request.ref1SurfaceId = intParam(params, "ref1SurfaceId", -1);
  request.ref1FeatureId = intParam(params, "ref1FeatureId", -1);
  request.ref1EdgeId = intParam(params, "ref1EdgeId", -1);
  request.ref2SurfaceId = intParam(params, "ref2SurfaceId", -1);
  request.ref2FeatureId = intParam(params, "ref2FeatureId", -1);
  request.ref2EdgeId = intParam(params, "ref2EdgeId", -1);
  request.offset1 = numberParam(params, "offset1", 0.0);
  request.offset2 = numberParam(params, "offset2", 0.0);
  request.axis = params.value("axis", std::string());
  request.axisId = intParam(params, "axisId", -1);
  request.axisFeatureId = intParam(params, "axisFeatureId", -1);
  request.diameter = numberParam(params, "diameter", 0.0);
  request.depth = params.value("depth", std::string());
  request.depthValue = numberParam(params, "depthValue", 0.0);
  request.head = params.value("head", std::string());
  request.headDiameter = numberParam(params, "headDiameter", 0.0);
  request.headDepth = numberParam(params, "headDepth", 0.0);
  request.headAngle = numberParam(params, "headAngle", 0.0);
  request.drillAngle = numberParam(params, "drillAngle", 118.0);
  return request;
}

PatternReferenceRequest parsePatternReference(const nlohmann::json& value,
                                               const char* role) {
  PatternReferenceRequest reference;
  if (value.is_string()) {
    reference.name = value.get<std::string>();
    if (reference.name.empty()) {
      throw BridgeError("INVALID_ARGUMENT",
                        std::string(role) + " must not be empty.");
    }
    return reference;
  }
  if (!value.is_object()) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string(role) + " must be a name or id object.");
  }
  reference.name = value.value("name", std::string());
  reference.surfaceId = intParam(value, "surfaceId", -1);
  reference.featureId = intParam(value, "featureId", -1);
  reference.edgeId = intParam(value, "edgeId", -1);
  reference.axisId = intParam(value, "axisId", -1);
  reference.axisFeatureId = intParam(value, "axisFeatureId", -1);
  if (reference.surfaceId <= 0 && reference.featureId <= 0 &&
      reference.edgeId <= 0 && reference.axisId <= 0 &&
      reference.axisFeatureId <= 0) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string(role) + " must contain a positive id.");
  }
  return reference;
}

PatternDirectionRequest parsePatternDirection(const nlohmann::json& value,
                                               const char* role) {
  if (!value.is_object() || !value.contains("reference")) {
    throw BridgeError("INVALID_ARGUMENT",
                      std::string(role) + " requires a reference.");
  }
  PatternDirectionRequest direction;
  direction.reference = parsePatternReference(value.at("reference"), role);
  direction.count = intParam(value, "count", 0);
  direction.spacing = numberParam(value, "spacing", 0.0);
  direction.flip = value.value("flip", false);
  return direction;
}

PatternFeatureRequest parsePatternRequest(const nlohmann::json& params) {
  PatternFeatureRequest request;
  request.featureName = params.value("featureName", std::string());
  request.seedFeatureId = intParam(params, "seedFeatureId", -1);
  request.type = params.value("type", std::string());
  if (request.type == "linear") {
    if (!params.contains("direction1")) {
      throw BridgeError("INVALID_ARGUMENT",
                        "A linear pattern requires direction1.");
    }
    request.direction1 =
        parsePatternDirection(params.at("direction1"), "Pattern direction 1");
    if (params.contains("direction2") && !params.at("direction2").is_null()) {
      request.direction2 = parsePatternDirection(params.at("direction2"),
                                                  "Pattern direction 2");
      request.hasDirection2 = true;
    }
  } else if (request.type == "axis") {
    if (!params.contains("axis")) {
      throw BridgeError("INVALID_ARGUMENT", "An axis pattern requires axis.");
    }
    request.axis = parsePatternReference(params.at("axis"), "Pattern axis");
    request.axisCount = intParam(params, "count", 0);
    request.axisAngle = numberParam(params, "angle", 0.0);
    if (request.axisAngle == 0.0 && params.contains("spacing")) {
      request.axisAngle = numberParam(params, "spacing", 0.0);
    }
    request.axisFlip = params.value("flip", false);
  }
  return request;
}

MirrorFeatureRequest parseMirrorRequest(const nlohmann::json& params) {
  MirrorFeatureRequest request;
  request.featureName = params.value("featureName", std::string());
  request.featureIds = intArrayParam(params, "featureIds");
  if (!params.contains("plane")) {
    throw BridgeError("INVALID_ARGUMENT", "A mirror requires a plane.");
  }
  request.plane = parsePatternReference(params.at("plane"), "Mirror plane");
  return request;
}

}  // namespace

nlohmann::json CreoBridge::cmdFeatureCreateDatumPlane(
    const nlohmann::json& params) {
  return createDatumPlaneFeature(
      resolveModel(params.value("name", std::string())),
      parseDatumPlaneRequest(params));
}

nlohmann::json CreoBridge::cmdFeatureCreateDatumAxis(
    const nlohmann::json& params) {
  return createDatumAxisFeature(
      resolveModel(params.value("name", std::string())),
      parseDatumAxisRequest(params));
}

nlohmann::json CreoBridge::cmdFeatureCreateDatumPoint(
    const nlohmann::json& params) {
  return createDatumPointFeature(
      resolveModel(params.value("name", std::string())),
      parseDatumPointRequest(params));
}

nlohmann::json CreoBridge::cmdFeatureCreateHole(const nlohmann::json& params) {
  return createHoleFeature(resolveModel(params.value("name", std::string())),
                           parseHoleRequest(params));
}

nlohmann::json CreoBridge::cmdFeatureCreatePattern(const nlohmann::json& params) {
  return createPatternFeature(resolveModel(params.value("name", std::string())),
                              parsePatternRequest(params));
}

nlohmann::json CreoBridge::cmdFeatureCreateMirror(const nlohmann::json& params) {
  return createMirrorFeature(resolveModel(params.value("name", std::string())),
                             parseMirrorRequest(params));
}

nlohmann::json CreoBridge::cmdDrawingCreate(const nlohmann::json& params) {
  const std::string drawingName =
      params.value("drawingName", std::string());
  const std::string templateName =
      params.value("templateName", std::string());
  if (drawingName.empty() || templateName.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.create requires drawingName and templateName");
  }
  DrawingCreateRequest request;
  request.drawingName = drawingName;
  request.templateName = templateName;
  request.createView = params.value("createView", true);
  request.viewName = params.value("viewName", std::string());
  request.sheetNumber = intParam(params, "sheetNumber", 1);
  request.locationX = numberParam(params, "locationX", 0.0);
  request.locationY = numberParam(params, "locationY", 0.0);
  request.locationZ = numberParam(params, "locationZ", 0.0);
  request.scale = numberParam(params, "scale", 0.0);
  request.save = params.value("save", true);
  pfcSession_ptr session = requireSession();
  pfcModel_ptr source =
      resolveModel(params.value("modelName", std::string()));
  return createDrawing(session, source, request);
}

nlohmann::json CreoBridge::cmdDrawingListSheets(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  return listDrawingSheets(resolveDrawing(params));
}

nlohmann::json CreoBridge::cmdDrawingAddSheet(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  return addDrawingSheet(resolveDrawing(params));
}

nlohmann::json CreoBridge::cmdDrawingSetSheetScale(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  return setDrawingSheetScale(resolveDrawing(params),
                              intParam(params, "sheetNumber", 1),
                              numberParam(params, "scale", 0.0));
}

nlohmann::json CreoBridge::cmdDrawingListViews(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  return listDrawingViews(resolveDrawing(params));
}

nlohmann::json CreoBridge::cmdDrawingSave(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  return saveDrawing(resolveDrawing(params));
}

nlohmann::json CreoBridge::cmdDrawingCreateGeneralView(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  pfcDrawing_ptr drawing = resolveDrawing(params);
  pfcModel_ptr source;
  const std::string sourceName = params.value("modelName", std::string());
  if (sourceName.empty()) {
    pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
    source = model2d ? model2d->GetCurrentSolid() : nullptr;
  } else {
    source = resolveModel(sourceName);
  }
  if (!source) {
    throw BridgeError("MODEL_NOT_FOUND",
                      "No source solid was supplied or linked to the drawing.");
  }
  return createGeneralDrawingView(
      drawing, source, intParam(params, "sheetNumber", 1),
      numberParam(params, "locationX", 0.0),
      numberParam(params, "locationY", 0.0),
      numberParam(params, "locationZ", 0.0), numberParam(params, "scale", 0.0),
      params.value("viewName", std::string()));
}

nlohmann::json CreoBridge::cmdDrawingCreateProjectionView(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  if (!params.contains("parentViewId") ||
      !params["parentViewId"].is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.create_projection_view requires parentViewId");
  }
  return createProjectionDrawingView(
      resolveDrawing(params), params.at("parentViewId").get<int>(),
      intParam(params, "sheetNumber", 1), numberParam(params, "locationX", 0.0),
      numberParam(params, "locationY", 0.0),
      numberParam(params, "locationZ", 0.0),
      params.value("viewName", std::string()));
}

nlohmann::json CreoBridge::cmdDrawingSetViewScale(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  if (!params.contains("viewId") || !params["viewId"].is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.set_view_scale requires viewId");
  }
  return setDrawingViewScale(resolveDrawing(params),
                             params.at("viewId").get<int>(),
                             numberParam(params, "scale", 0.0));
}

nlohmann::json CreoBridge::cmdDrawingRenameView(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  if (!params.contains("viewId") || !params["viewId"].is_number_integer() ||
      params.value("viewName", std::string()).empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.rename_view requires viewId and viewName");
  }
  return renameDrawingView(resolveDrawing(params),
                           params.at("viewId").get<int>(),
                           params.at("viewName").get<std::string>());
}

nlohmann::json CreoBridge::cmdDrawingDeleteView(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  if (!params.contains("viewId") || !params["viewId"].is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.delete_view requires viewId");
  }
  return deleteDrawingView(resolveDrawing(params),
                           params.at("viewId").get<int>());
}

nlohmann::json CreoBridge::cmdDrawingTranslateView(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  if (!params.contains("viewId") || !params["viewId"].is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.translate_view requires viewId");
  }
  return translateDrawingView(
      resolveDrawing(params), params.at("viewId").get<int>(),
      numberParam(params, "x", 0.0), numberParam(params, "y", 0.0),
      numberParam(params, "z", 0.0));
}

nlohmann::json CreoBridge::cmdDrawingRegenerateView(
    const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  if (!params.contains("viewId") || !params["viewId"].is_number_integer()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.regenerate_view requires viewId");
  }
  return regenerateDrawingView(resolveDrawing(params),
                               params.at("viewId").get<int>());
}

namespace {

ExportRequest parseExportRequest(const nlohmann::json& params) {
  const std::string fileName = params.value("fileName", std::string());
  if (fileName.empty()) {
    throw BridgeError("INVALID_ARGUMENT",
                      "Export command requires a fileName parameter");
  }
  ExportRequest request;
  request.fileName = fileName;
  request.overwrite = params.value("overwrite", false);
  return request;
}

pfcModel_ptr resolveExportModel(pfcSession_ptr session,
                                const nlohmann::json& params) {
  const std::string name = params.value("name", std::string());
  if (name.empty()) {
    pfcModel_ptr current = session->GetCurrentModel();
    if (!current) {
      throw BridgeError("MODEL_NOT_FOUND",
                        "No active model is open in the Creo session.");
    }
    return current;
  }
  pfcModels_ptr models = session->ListModels();
  if (models) {
    const std::wstring wanted = toWide(name);
    const int count = models->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcModel_ptr model = models->get(i);
      if (!model) {
        continue;
      }
      const std::wstring modelName(
          static_cast<cWStringT>(model->GetFullName()));
      const std::wstring fileName(
          static_cast<cWStringT>(model->GetFileName()));
      const std::wstring instanceName(
          static_cast<cWStringT>(model->GetInstanceName()));
      if (equalsIgnoreCase(modelName, wanted) ||
          equalsIgnoreCase(fileName, wanted) ||
          equalsIgnoreCase(instanceName, wanted)) {
        return model;
      }
    }
  }
  throw BridgeError("MODEL_NOT_FOUND",
                    "Model '" + name + "' is not open in the Creo session.");
}

}  // namespace

nlohmann::json CreoBridge::cmdModelExportStep(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  pfcModel_ptr model = resolveExportModel(session, params);
  const ExportRequest request = parseExportRequest(params);
  return exportStep(session, model, request);
}

nlohmann::json CreoBridge::cmdModelExportIges(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  pfcModel_ptr model = resolveExportModel(session, params);
  const ExportRequest request = parseExportRequest(params);
  return exportIges(session, model, request);
}

nlohmann::json CreoBridge::cmdModelExportStl(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  pfcModel_ptr model = resolveExportModel(session, params);
  const ExportRequest request = parseExportRequest(params);
  const std::string mode = params.value("mode", "ascii");
  return exportStl(session, model, request, mode);
}

nlohmann::json CreoBridge::cmdModelExportPdf(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  pfcModel_ptr model = resolveExportModel(session, params);
  const ExportRequest request = parseExportRequest(params);
  const std::string mode = params.value("mode", "auto");
  return exportPdf(session, model, request, mode);
}

nlohmann::json CreoBridge::cmdModelExportDxf(const nlohmann::json& params) {
  pfcSession_ptr session = requireSession();
  pfcModel_ptr model = resolveExportModel(session, params);
  const ExportRequest request = parseExportRequest(params);
  return exportDxf(session, model, request);
}

}  // namespace creo
