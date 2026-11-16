// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "drawing.h"

#include "read.h"

#include <cmath>
#include <cctype>
#include <string>

#include <pfcBase.h>
#include <pfcDrawingFormat.h>
#include <pfcModel2D.h>
#include <pfcObject.h>
#include <pfcSheet.h>
#include <pfcSolid.h>
#include <pfcView2D.h>
#include <pfcWindow.h>

namespace creo {

namespace {

pfcModel_ptr asModel(pfcDrawing_ptr drawing) {
  return pfcModel::cast(static_cast<pfcDrawing*>(drawing));
}

pfcModel_ptr asModel(pfcDrawingFormat_ptr format) {
  return pfcModel::cast(static_cast<pfcDrawingFormat*>(format));
}

bool isBareName(const std::string& name, bool requireExtension) {
  if (name.empty() || name.size() > 128 || name.find("..") != std::string::npos) {
    return false;
  }
  bool sawLeadingAlpha = false;
  bool sawExtension = false;
  for (size_t i = 0; i < name.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(name[i]);
    if (i == 0 && std::isalnum(c) != 0) {
      sawLeadingAlpha = true;
    }
    if (c == '.') {
      sawExtension = true;
    }
    if (std::isalnum(c) == 0 && c != '.' && c != '_' && c != '-' &&
        c != ' ' && c != '(' && c != ')') {
      return false;
    }
  }
  return sawLeadingAlpha && (!requireExtension || sawExtension);
}

const char* paperSizeName(pfcPlotPaperSize size) {
  switch (size) {
    case pfcASIZEPLOT:
      return "A";
    case pfcBSIZEPLOT:
      return "B";
    case pfcCSIZEPLOT:
      return "C";
    case pfcDSIZEPLOT:
      return "D";
    case pfcESIZEPLOT:
      return "E";
    case pfcA4SIZEPLOT:
      return "A4";
    case pfcA3SIZEPLOT:
      return "A3";
    case pfcA2SIZEPLOT:
      return "A2";
    case pfcA1SIZEPLOT:
      return "A1";
    case pfcA0SIZEPLOT:
      return "A0";
    case pfcFSIZEPLOT:
      return "F";
    case pfcVARIABLESIZEPLOT:
      return "variable";
    case pfcVARIABLESIZE_IN_MM_PLOT:
      return "variable_mm";
    default:
      return "unknown";
  }
}

const char* orientationName(pfcSheetOrientation orientation) {
  switch (orientation) {
    case pfcORIENT_PORTRAIT:
      return "portrait";
    case pfcORIENT_LANDSCAPE:
      return "landscape";
    default:
      return "unknown";
  }
}

// OTK's asynchronous layer does not implement pfcChild::GetOId
// (pfcObject::Child::OId<get> raises XUnimplemented), so views are addressed by
// their 1-based position in pfcModel2D::List2DViews(). Positions are stable for
// the read-create-read flows used by the tools; callers should re-list views
// after structural changes.
int viewIndexOf(pfcDrawing_ptr drawing, pfcView2D_ptr target) {
  pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
  if (!model2d) {
    return -1;
  }
  pfcView2Ds_ptr views = model2d->List2DViews();
  if (!views) {
    return -1;
  }
  const int count = views->getarraysize();
  for (int i = 0; i < count; ++i) {
    pfcView2D_ptr view = views->get(i);
    if (view && view == target) {
      return i + 1;
    }
  }
  return -1;
}

pfcView2D_ptr findViewById(pfcDrawing_ptr drawing, int id) {
  pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
  if (!model2d) {
    throw BridgeError("INVALID_ARGUMENT", "Model is not a drawing.");
  }
  pfcView2Ds_ptr views = model2d->List2DViews();
  if (views && id >= 1 && id <= views->getarraysize()) {
    pfcView2D_ptr view = views->get(id - 1);
    if (view) {
      return view;
    }
  }
  throw BridgeError("NOT_FOUND", "Drawing view " + std::to_string(id) +
                                  " is not present in the drawing.");
}

nlohmann::json describeSheet(pfcDrawing_ptr drawing, int sheetNumber) {
  nlohmann::json out = { {"number", sheetNumber} };
  const xreal scale = drawing->GetSheetScale(sheetNumber);
  if (scale != xrealnil) {
    out["scale"] = scale;
  }
  pfcSheetInfo_ptr info = drawing->GetSheetInfo(sheetNumber);
  if (info) {
    out["width"] = info->GetWidth();
    out["height"] = info->GetHeight();
    out["orientation"] = orientationName(info->GetOrientation());
    out["paperSize"] = paperSizeName(info->GetSheetSize());
    pfcLengthUnits_ptr units = info->GetUnits();
    if (units) {
      out["units"] = toUtf8(units->GetUnitName());
    }
  }
  pfcDrawingFormat_ptr format = drawing->GetSheetFormat(sheetNumber);
  if (format) {
    out["format"] = describeModelInfo(asModel(format));
  }
  return out;
}

nlohmann::json describeView(pfcView2D_ptr view, int id) {
  nlohmann::json out = { {"id", id},
                         {"sheetNumber", static_cast<int>(view->GetSheetNumber())},
                         {"isBackground", static_cast<bool>(view->GetIsBackground())},
                         {"scale", view->GetScale()} };
  const xstring name = view->GetName();
  if (!name.IsNull()) {
    out["name"] = toUtf8(name);
  }
  pfcModel_ptr model = view->GetModel();
  if (model) {
    out["model"] = describeModelInfo(model);
  }
  pfcOutline3D_ptr outline = view->GetOutline();
  if (outline) {
    nlohmann::json points = nlohmann::json::array();
    for (int i = 0; i < 2; ++i) {
      pfcPoint3D_ptr point = outline->get(i);
      if (!point) {
        continue;
      }
      points.push_back(
          nlohmann::json::array({point->get(0), point->get(1), point->get(2)}));
    }
    if (!points.empty()) {
      out["outline"] = points;
    }
  }
  return out;
}

pfcPoint3D_ptr makePoint(double x, double y, double z) {
  pfcPoint3D_ptr point = pfcPoint3D::create();
  if (!point) {
    throw BridgeError("CREO_API_ERROR", "Could not construct a drawing point.");
  }
  point->set(0, x);
  point->set(1, y);
  point->set(2, z);
  return point;
}

// View creation in the OTK async layer fails with pfcXToolkitBadInputs unless
// the drawing is displayed in a model window (and that window is current).
void ensureDrawingWindow(pfcDrawing_ptr drawing) {
  pfcSession_ptr session = pfcGetCurrentSession();
  if (!session) {
    return;
  }
  pfcModel_ptr model = asModel(drawing);
  pfcWindow_ptr window = session->GetModelWindow(model);
  if (!window) {
    window = session->CreateModelWindow(model);
  }
  if (window) {
    session->SetCurrentWindow(window);
  }
}

void ensureSheet(pfcDrawing_ptr drawing, int sheetNumber) {
  const int sheets = static_cast<int>(drawing->GetNumberOfSheets());
  if (sheetNumber < 1 || sheetNumber > sheets) {
    throw BridgeError("INVALID_ARGUMENT",
                      "sheetNumber must identify an existing drawing sheet.");
  }
}

// The 2D view list can lag a CreateView call until the drawing regenerates, and
// handle comparison is not guaranteed, so fall back to a name match.
int resolveNewViewIndex(pfcDrawing_ptr drawing, pfcView2D_ptr view,
                        const std::string& name) {
  int id = viewIndexOf(drawing, view);
  if (id >= 1) {
    return id;
  }
  try {
    drawing->Regenerate();
  } xcatchbegin
    xcatchall {
      // Regeneration may raise; the fallbacks below still apply.
    }
  xcatchend
  catch (...) {
    // Non-OTK exception; continue with the fallback.
  }
  id = viewIndexOf(drawing, view);
  if (id >= 1) {
    return id;
  }
  if (!name.empty()) {
    pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
    pfcView2Ds_ptr views = model2d ? model2d->List2DViews() : nullptr;
    if (views) {
      const int count = views->getarraysize();
      for (int i = 0; i < count; ++i) {
        pfcView2D_ptr candidate = views->get(i);
        if (!candidate) {
          continue;
        }
        const xstring candidateName = candidate->GetName();
        if (!candidateName.IsNull() &&
            equalsIgnoreCase(toWide(toUtf8(candidateName)), toWide(name))) {
          return i + 1;
        }
      }
    }
  }
  return -1;
}

nlohmann::json viewMutation(pfcDrawing_ptr drawing, int viewIdValue,
                            const std::string& operation) {
  pfcView2D_ptr view = findViewById(drawing, viewIdValue);
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"operation", operation},
          {"view", describeView(view, viewIdValue)},
          {"verified", true}};
}

}  // namespace

nlohmann::json listDrawingSheets(pfcDrawing_ptr drawing) {
  nlohmann::json sheets = nlohmann::json::array();
  const int count = static_cast<int>(drawing->GetNumberOfSheets());
  for (int i = 1; i <= count; ++i) {
    sheets.push_back(describeSheet(drawing, i));
  }
  const xint current = drawing->GetCurrentSheetNumber();
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"currentSheet", current == xintnil ? nullptr : nlohmann::json(current)},
          {"sheets", sheets},
          {"count", sheets.size()}};
}

nlohmann::json addDrawingSheet(pfcDrawing_ptr drawing) {
  const int number = static_cast<int>(drawing->AddSheet());
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"sheet", describeSheet(drawing, number)},
          {"verified", number > 0}};
}

nlohmann::json setDrawingSheetScale(pfcDrawing_ptr drawing, int sheetNumber,
                                    double scale) {
  if (!std::isfinite(scale) || scale <= 0.0) {
    throw BridgeError("INVALID_ARGUMENT", "Sheet scale must be positive.");
  }
  ensureSheet(drawing, sheetNumber);
  drawing->SetSheetScale(sheetNumber, scale);
  const xreal readback = drawing->GetSheetScale(sheetNumber);
  if (readback == xrealnil || std::abs(readback - scale) > 1e-9) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not report the requested sheet scale.");
  }
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"sheet", describeSheet(drawing, sheetNumber)},
          {"verified", true}};
}

nlohmann::json listDrawingViews(pfcDrawing_ptr drawing) {
  pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
  if (!model2d) {
    throw BridgeError("INVALID_ARGUMENT", "Model is not a drawing.");
  }
  nlohmann::json views = nlohmann::json::array();
  pfcView2Ds_ptr list = model2d->List2DViews();
  if (list) {
    const int count = list->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcView2D_ptr view = list->get(i);
      if (view) {
        views.push_back(describeView(view, i + 1));
      }
    }
  }
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"views", views},
          {"count", views.size()}};
}

nlohmann::json saveDrawing(pfcDrawing_ptr drawing) {
  drawing->Save();
  if (static_cast<bool>(drawing->GetIsModified())) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo saved the drawing but it is still marked modified.");
  }
  return { {"drawing", describeModelInfo(asModel(drawing))},
           {"verified", true} };
}

nlohmann::json createDrawing(pfcSession_ptr session, pfcModel_ptr source,
                             const DrawingCreateRequest& request) {
  if (!isBareName(request.drawingName, false) ||
      !isBareName(request.templateName, true)) {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "drawingName and templateName must be plain names in Creo's working directory.");
  }
  if (!pfcSolid::cast(source)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "drawing.create requires a part or assembly source model.");
  }
  pfcDrawingCreateOptions_ptr options = pfcDrawingCreateOptions::create();
  pfcDrawing_ptr drawing = session->CreateDrawingFromTemplate(
      request.drawingName.c_str(), request.templateName.c_str(),
      source->GetDescr(), options);
  if (!drawing) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not create a drawing from the template.");
  }

  pfcModels_ptr drawingModels = drawing->ListModels();
  bool linked = false;
  if (drawingModels) {
    const int count = drawingModels->getarraysize();
    for (int i = 0; i < count; ++i) {
      pfcModel_ptr model = drawingModels->get(i);
      if (model && equalsIgnoreCase(toWide(toUtf8(model->GetFullName())),
                                    toWide(toUtf8(source->GetFullName())))) {
        linked = true;
        break;
      }
    }
  }
  if (!linked) {
    drawing->AddModel(source);
  }
  pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
  if (model2d) {
    model2d->SetCurrentSolid(source);
  }

  int sheetNumber = request.sheetNumber;
  if (drawing->GetNumberOfSheets() == 0) {
    sheetNumber = static_cast<int>(drawing->AddSheet());
  }
  ensureSheet(drawing, sheetNumber);

  nlohmann::json view = nullptr;
  if (request.createView) {
    const nlohmann::json created = createGeneralDrawingView(
        drawing, source, sheetNumber, request.locationX, request.locationY,
        request.locationZ, request.scale, request.viewName);
    view = created.at("view");
  }
  // Drawing regeneration is not required after template creation and raises
  // pfcXToolkitGeneralError in the OTK async layer; views regenerate themselves.
  if (request.save) {
    drawing->Save();
  }

  const nlohmann::json sheets = listDrawingSheets(drawing);
  const nlohmann::json views = listDrawingViews(drawing);
  return {{"created", true},
          {"drawing", describeModelInfo(asModel(drawing))},
          {"sourceModel", describeModelInfo(source)},
          {"sheets", sheets.at("sheets")},
          {"views", views.at("views")},
          {"view", view},
          {"saved", request.save},
          {"verified", true}};
}

nlohmann::json createGeneralDrawingView(pfcDrawing_ptr drawing,
                                        pfcModel_ptr source, int sheetNumber,
                                        double locationX, double locationY,
                                        double locationZ, double scale,
                                        const std::string& viewName) {
  ensureSheet(drawing, sheetNumber);
  drawing->SetCurrentSheetNumber(sheetNumber);
  if (!pfcSolid::cast(source)) {
    throw BridgeError("INVALID_ARGUMENT",
                      "A general drawing view requires a part or assembly source model.");
  }
  if (!std::isfinite(locationX) || !std::isfinite(locationY) ||
      !std::isfinite(locationZ) || !std::isfinite(scale)) {
    throw BridgeError("INVALID_ARGUMENT", "View coordinates and scale must be finite.");
  }
  pfcPoint3D_ptr location = makePoint(locationX, locationY, locationZ);
  pfcMatrix3D_ptr identity = pfcMatrix3D::create();
  if (!identity) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct the view orientation matrix.");
  }
  for (int row = 0; row < 4; ++row) {
    for (int column = 0; column < 4; ++column) {
      identity->set(row, column, row == column ? 1.0 : 0.0);
    }
  }
  pfcTransform3D_ptr orientation = pfcTransform3D::Create(identity);
  if (!orientation) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct the view orientation transform.");
  }
  pfcGeneralViewCreateInstructions_ptr instructions =
      pfcGeneralViewCreateInstructions::Create(source, sheetNumber, location,
                                                orientation);
  if (!instructions) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct general view instructions.");
  }
  if (scale > 0.0) {
    instructions->SetScale(scale);
  }
  pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
  pfcView2DCreateInstructions_ptr base = pfcView2DCreateInstructions::cast(
      static_cast<pfcGeneralViewCreateInstructions*>(instructions));
  ensureDrawingWindow(drawing);
  pfcView2D_ptr view = model2d->CreateView(base);
  if (!view) {
    throw BridgeError("CREO_API_ERROR", "Creo did not create the general view.");
  }
  if (!viewName.empty()) {
    view->SetName(viewName.c_str());
  }
  const int id = resolveNewViewIndex(drawing, view, viewName);
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"view", describeView(view, id)},
          {"verified", id >= 1}};
}

nlohmann::json createProjectionDrawingView(pfcDrawing_ptr drawing,
                                           int parentViewId, int sheetNumber,
                                           double locationX, double locationY,
                                           double locationZ,
                                           const std::string& viewName) {
  ensureSheet(drawing, sheetNumber);
  drawing->SetCurrentSheetNumber(sheetNumber);
  pfcView2D_ptr parent = findViewById(drawing, parentViewId);
  pfcPoint3D_ptr location = makePoint(locationX, locationY, locationZ);
  pfcProjectionViewCreateInstructions_ptr instructions =
      pfcProjectionViewCreateInstructions::Create(parent, location);
  if (!instructions) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct projection view instructions.");
  }
  instructions->SetLocation(location);
  pfcModel2D_ptr model2d = pfcModel2D::cast(drawing);
  ensureDrawingWindow(drawing);
  pfcView2D_ptr view = model2d->CreateView(
      pfcView2DCreateInstructions::cast(
          static_cast<pfcProjectionViewCreateInstructions*>(instructions)));
  if (!view) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not create the projection view.");
  }
  if (!viewName.empty()) {
    view->SetName(viewName.c_str());
  }
  const int id = resolveNewViewIndex(drawing, view, viewName);
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"view", describeView(view, id)},
          {"verified", id >= 1}};
}

nlohmann::json setDrawingViewScale(pfcDrawing_ptr drawing, int viewIdValue,
                                   double scale) {
  if (!std::isfinite(scale) || scale <= 0.0) {
    throw BridgeError("INVALID_ARGUMENT", "View scale must be positive.");
  }
  pfcView2D_ptr view = findViewById(drawing, viewIdValue);
  view->SetScale(scale);
  if (std::abs(view->GetScale() - scale) > 1e-9) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not report the requested view scale.");
  }
  return viewMutation(drawing, viewIdValue, "set_scale");
}

nlohmann::json renameDrawingView(pfcDrawing_ptr drawing, int viewIdValue,
                                 const std::string& name) {
  pfcView2D_ptr view = findViewById(drawing, viewIdValue);
  view->SetName(name.c_str());
  const xstring actual = view->GetName();
  if (actual.IsNull() || !equalsIgnoreCase(toWide(toUtf8(actual)), toWide(name))) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not report the requested view name.");
  }
  return viewMutation(drawing, viewIdValue, "rename");
}

nlohmann::json deleteDrawingView(pfcDrawing_ptr drawing, int viewIdValue) {
  pfcView2D_ptr view = findViewById(drawing, viewIdValue);
  view->Delete(xfalse);
  const bool gone = viewIndexOf(drawing, view) < 0;
  if (!gone) {
    throw BridgeError("CREO_API_ERROR", "Drawing view was not removed.");
  }
  return {{"drawing", describeModelInfo(asModel(drawing))},
          {"deletedViewId", viewIdValue},
          {"verified", true}};
}

nlohmann::json translateDrawingView(pfcDrawing_ptr drawing, int viewIdValue,
                                    double x, double y, double z) {
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) {
    throw BridgeError("INVALID_ARGUMENT", "Translation values must be finite.");
  }
  pfcView2D_ptr view = findViewById(drawing, viewIdValue);
  pfcVector3D_ptr vector = pfcVector3D::create();
  if (!vector) {
    throw BridgeError("CREO_API_ERROR", "Could not construct a view translation.");
  }
  vector->set(0, x);
  vector->set(1, y);
  vector->set(2, z);
  view->Translate(vector);
  return viewMutation(drawing, viewIdValue, "translate");
}

nlohmann::json regenerateDrawingView(pfcDrawing_ptr drawing, int viewIdValue) {
  pfcView2D_ptr view = findViewById(drawing, viewIdValue);
  view->Regenerate();
  return viewMutation(drawing, viewIdValue, "regenerate");
}

}  // namespace creo
