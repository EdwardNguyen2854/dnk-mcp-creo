// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "export.h"
#include "read.h"

#include <algorithm>
#include <cctype>
#include <cwctype>
#include <string>

#include <pfcBase.h>
#include <pfcDrawing.h>
#include <pfcExceptions.h>
#include <pfcExport.h>
#include <pfcModel.h>
#include <pfcPart.h>
#include <pfcSolid.h>

namespace creo {

namespace {

bool isBareFileName(const std::string& fileName) {
  if (fileName.empty() || fileName.size() > 128) {
    return false;
  }
  if (fileName.find("..") != std::string::npos) {
    return false;
  }
  bool sawLeadingOk = false;
  for (size_t i = 0; i < fileName.size(); ++i) {
    const unsigned char c =
        static_cast<unsigned char>(fileName[i]);
    const bool isAlnum =
        std::isalnum(c) != 0;
    const bool isOther =
        c == '.' || c == '_' || c == '-' || c == ' ' || c == '(' || c == ')';
    if (!isAlnum && !isOther) {
      return false;
    }
    if (i == 0 && isAlnum) {
      sawLeadingOk = true;
    }
  }
  if (!sawLeadingOk) {
    return false;
  }
  if (fileName.find('.') == std::string::npos) {
    return false;
  }
  return true;
}

bool hasTrailingSeparator(const std::wstring& path) {
  if (path.empty()) {
    return false;
  }
  const wchar_t last = path.back();
  return last == L'\\' || last == L'/';
}

unsigned long long fileSize(const std::wstring& path) {
  WIN32_FILE_ATTRIBUTE_DATA info{};
  if (!::GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &info)) {
    return 0;
  }
  if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
    return 0;
  }
  ULARGE_INTEGER merged;
  merged.LowPart = info.nFileSizeLow;
  merged.HighPart = info.nFileSizeHigh;
  return static_cast<unsigned long long>(merged.QuadPart);
}

const char* stlMode(const std::string& mode) {
  std::string upper;
  upper.reserve(mode.size());
  for (const char c : mode) {
    upper.push_back(static_cast<char>(std::toupper(
        static_cast<unsigned char>(c))));
  }
  if (upper.empty() || upper == "ASCII") return "ascii";
  if (upper == "BINARY") return "binary";
  return nullptr;
}

pfcGeometryFlags_ptr defaultGeometryFlags() {
  pfcGeometryFlags_ptr flags = pfcGeometryFlags::Create();
  if (!flags) {
    throw BridgeError(
        "CREO_API_ERROR",
        "Could not construct default geometry flags for export.");
  }
  flags->SetAsWireframe(xfalse);
  flags->SetAsSolids(xtrue);
  flags->SetAsSurfaces(xfalse);
  flags->SetAsQuilts(xfalse);
  return flags;
}

}  // namespace

std::wstring resolveExportPath(pfcSession_ptr session,
                                const std::string& fileName, bool overwrite,
                                unsigned long long& outSize) {
  if (!isBareFileName(fileName)) {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "'" + fileName +
            "' is not a plain file name. Export tools only accept files that "
            "are direct children of Creo's live working directory; "
            "separators, '..', absolute paths, and UNC paths are rejected.");
  }
  const xstring working = session->GetCurrentDirectory();
  if (working.IsNull()) {
    throw BridgeError("CREO_API_ERROR",
                      "Creo did not report a current working directory.");
  }
  std::wstring base(static_cast<cWStringT>(working));
  if (!hasTrailingSeparator(base)) {
    base.push_back(L'\\');
  }
  const std::wstring wideFile = toWide(fileName);
  std::wstring combined;
  combined.reserve(base.size() + wideFile.size());
  combined.append(base);
  combined.append(wideFile);

  if (!overwrite) {
    WIN32_FILE_ATTRIBUTE_DATA info{};
    if (::GetFileAttributesExW(combined.c_str(), GetFileExInfoStandard,
                                &info)) {
      throw BridgeError(
          "FILE_EXISTS",
          "'" + fileName +
              "' already exists in Creo's working directory. Pass overwrite="
              "true to replace it.",
          false, {{"path", toUtf8(combined)}});
    }
  }

  outSize = fileSize(combined);
  return combined;
}

static nlohmann::json finalizeExport(const std::wstring& resolvedPath,
                                      pfcModel_ptr model) {
  const unsigned long long size = fileSize(resolvedPath);
  if (size == 0) {
    throw BridgeError(
        "CREO_API_ERROR",
        "Export finished but the file is missing or empty on disk: " +
            toUtf8(resolvedPath));
  }
  nlohmann::json out = {{"model", describeModelInfo(model)},
                        {"path", toUtf8(resolvedPath)},
                        {"sizeBytes", size},
                        {"verified", true}};
  return out;
}

nlohmann::json exportStep(pfcSession_ptr session, pfcModel_ptr model,
                          const ExportRequest& request) {
  unsigned long long existingSize = 0;
  const std::wstring resolvedPath =
      resolveExportPath(session, request.fileName, request.overwrite,
                       existingSize);
  pfcSTEP3DExportInstructions_ptr instr = pfcSTEP3DExportInstructions::Create(
      pfcEXPORT_ASM_SINGLE_FILE, defaultGeometryFlags());
  if (!instr) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct STEP export instructions.");
  }
  model->Export(xstring(resolvedPath.c_str()),
                pfcExportInstructions_ptr(pfcExportInstructions::cast(
                    (pfcSTEP3DExportInstructions*)instr)));
  return finalizeExport(resolvedPath, model);
}

nlohmann::json exportIges(pfcSession_ptr session, pfcModel_ptr model,
                          const ExportRequest& request) {
  unsigned long long existingSize = 0;
  const std::wstring resolvedPath =
      resolveExportPath(session, request.fileName, request.overwrite,
                       existingSize);
  pfcIGES3DNewExportInstructions_ptr instr =
      pfcIGES3DNewExportInstructions::Create(pfcEXPORT_ASM_SINGLE_FILE,
                                              defaultGeometryFlags());
  if (!instr) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct IGES export instructions.");
  }
  model->Export(xstring(resolvedPath.c_str()),
                pfcExportInstructions_ptr(pfcExportInstructions::cast(
                    (pfcIGES3DNewExportInstructions*)instr)));
  return finalizeExport(resolvedPath, model);
}

nlohmann::json exportStl(pfcSession_ptr session, pfcModel_ptr model,
                         const ExportRequest& request,
                         const std::string& mode) {
  pfcSolid_ptr solid = pfcSolid::cast(model);
  if (!solid) {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "creo_export_stl requires a part with a solid body; the active model "
        "is not a solid (" +
            std::string(modelTypeName(model->GetType())) +
            "). Export assemblies to STEP first.");
  }
  const char* resolved = stlMode(mode);
  if (resolved == nullptr) {
    throw BridgeError("INVALID_ARGUMENT",
                      "creo_export_stl mode must be 'ascii' or 'binary'.");
  }
  unsigned long long existingSize = 0;
  const std::wstring resolvedPath =
      resolveExportPath(session, request.fileName, request.overwrite,
                       existingSize);
  if (resolved[0] == 'a') {
    pfcSTLASCIIExportInstructions_ptr instr =
        pfcSTLASCIIExportInstructions::Create(xstringnil);
    if (!instr) {
      throw BridgeError(
          "CREO_API_ERROR",
          "Could not construct STL ASCII export instructions.");
    }
    solid->Export(xstring(resolvedPath.c_str()),
                  pfcExportInstructions_ptr(pfcExportInstructions::cast(
                      (pfcSTLASCIIExportInstructions*)instr)));
  } else {
    pfcSTLBinaryExportInstructions_ptr instr =
        pfcSTLBinaryExportInstructions::Create(xstringnil);
    if (!instr) {
      throw BridgeError(
          "CREO_API_ERROR",
          "Could not construct STL binary export instructions.");
    }
    solid->Export(xstring(resolvedPath.c_str()),
                  pfcExportInstructions_ptr(pfcExportInstructions::cast(
                      (pfcSTLBinaryExportInstructions*)instr)));
  }
  return finalizeExport(resolvedPath, model);
}

nlohmann::json exportPdf(pfcSession_ptr session, pfcModel_ptr model,
                         const ExportRequest& request,
                         const std::string& mode) {
  pfcDrawing_ptr drawing = pfcDrawing::cast(model);
  if (!drawing) {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "creo_export_pdf currently supports drawing models only "
        "(3D PDF is not available in this Creo build's OTK). The active "
        "model is " +
            std::string(modelTypeName(model->GetType())) + ".");
  }
  const std::string upperMode = [&]() {
    std::string out;
    out.reserve(mode.size());
    for (const char c : mode) {
      out.push_back(static_cast<char>(std::toupper(
          static_cast<unsigned char>(c))));
    }
    return out;
  }();
  if (!upperMode.empty() && upperMode != "AUTO" &&
      upperMode != "DRAWING") {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "creo_export_pdf mode must be 'auto' or 'drawing' (3D PDF is not "
        "supported in this OTK build).");
  }
  unsigned long long existingSize = 0;
  const std::wstring resolvedPath =
      resolveExportPath(session, request.fileName, request.overwrite,
                       existingSize);
  pfcPDFExportInstructions_ptr instr = pfcPDFExportInstructions::Create();
  if (!instr) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct drawing PDF export instructions.");
  }
  model->Export(xstring(resolvedPath.c_str()),
                pfcExportInstructions_ptr(pfcExportInstructions::cast(
                    (pfcPDFExportInstructions*)instr)));
  return finalizeExport(resolvedPath, model);
}

nlohmann::json exportDxf(pfcSession_ptr session, pfcModel_ptr model,
                         const ExportRequest& request) {
  pfcDrawing_ptr drawing = pfcDrawing::cast(model);
  if (!drawing) {
    throw BridgeError(
        "INVALID_ARGUMENT",
        "creo_export_dxf requires a drawing model; the active model is " +
            std::string(modelTypeName(model->GetType())) + ".");
  }
  unsigned long long existingSize = 0;
  const std::wstring resolvedPath =
      resolveExportPath(session, request.fileName, request.overwrite,
                       existingSize);
  pfcDXFExportInstructions_ptr instr = pfcDXFExportInstructions::Create();
  if (!instr) {
    throw BridgeError("CREO_API_ERROR",
                      "Could not construct DXF export instructions.");
  }
  model->Export(xstring(resolvedPath.c_str()),
                pfcExportInstructions_ptr(pfcExportInstructions::cast(
                    (pfcDXFExportInstructions*)instr)));
  return finalizeExport(resolvedPath, model);
}

}  // namespace creo
