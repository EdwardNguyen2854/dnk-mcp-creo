// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "util.h"

#include <string>

#include <pfcDrawing.h>
#include <pfcSession.h>

namespace creo {

struct DrawingCreateRequest {
  std::string drawingName;
  std::string templateName;
  bool createView = true;
  std::string viewName;
  int sheetNumber = 1;
  double locationX = 0.0;
  double locationY = 0.0;
  double locationZ = 0.0;
  double scale = 0.0;
  bool save = true;
};

nlohmann::json createDrawing(pfcSession_ptr session, pfcModel_ptr source,
                             const DrawingCreateRequest& request);
nlohmann::json listDrawingSheets(pfcDrawing_ptr drawing);
nlohmann::json addDrawingSheet(pfcDrawing_ptr drawing);
nlohmann::json setDrawingSheetScale(pfcDrawing_ptr drawing, int sheetNumber,
                                    double scale);
nlohmann::json listDrawingViews(pfcDrawing_ptr drawing);
nlohmann::json saveDrawing(pfcDrawing_ptr drawing);
nlohmann::json createGeneralDrawingView(pfcDrawing_ptr drawing,
                                        pfcModel_ptr source, int sheetNumber,
                                        double locationX, double locationY,
                                        double locationZ, double scale,
                                        const std::string& viewName);
nlohmann::json createProjectionDrawingView(pfcDrawing_ptr drawing,
                                           int parentViewId, int sheetNumber,
                                           double locationX, double locationY,
                                           double locationZ,
                                           const std::string& viewName);
nlohmann::json setDrawingViewScale(pfcDrawing_ptr drawing, int viewId,
                                   double scale);
nlohmann::json renameDrawingView(pfcDrawing_ptr drawing, int viewId,
                                 const std::string& name);
nlohmann::json deleteDrawingView(pfcDrawing_ptr drawing, int viewId);
nlohmann::json translateDrawingView(pfcDrawing_ptr drawing, int viewId,
                                    double x, double y, double z);
nlohmann::json regenerateDrawingView(pfcDrawing_ptr drawing, int viewId);

}  // namespace creo
