// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "util.h"

#include <string>

#include <pfcModel.h>
#include <pfcSession.h>

namespace creo {

// Export primitives (write to disk; policy lives in TypeScript).
//
// All commands require the resolved output path to be a direct child of the
// session's current working directory. Bare file names are validated against
// the same BARE_FILE_NAME pattern the TypeScript layer uses; paths, escapes,
// UNC prefixes, and reserved characters are rejected up front.

struct ExportRequest {
  std::string fileName;
  bool overwrite = false;
};

struct ExportResult {
  nlohmann::json model;
  std::wstring path;
  unsigned long long sizeBytes = 0;
  bool verified = false;
};

nlohmann::json exportStep(pfcSession_ptr session, pfcModel_ptr model,
                          const ExportRequest& request);
nlohmann::json exportIges(pfcSession_ptr session, pfcModel_ptr model,
                          const ExportRequest& request);
nlohmann::json exportStl(pfcSession_ptr session, pfcModel_ptr model,
                         const ExportRequest& request,
                         const std::string& mode);
nlohmann::json exportPdf(pfcSession_ptr session, pfcModel_ptr model,
                         const ExportRequest& request,
                         const std::string& mode);
nlohmann::json exportDxf(pfcSession_ptr session, pfcModel_ptr model,
                         const ExportRequest& request);

// Resolves a bare file name against the session working directory and reports
// absolute path + size on disk. Throws BridgeError("FILE_EXISTS") when the
// file already exists and overwrite=false. Throws BridgeError("INVALID_ARGUMENT")
// when fileName is not a plain file name.
std::wstring resolveExportPath(pfcSession_ptr session,
                                const std::string& fileName, bool overwrite,
                                unsigned long long& outSize);

}  // namespace creo
