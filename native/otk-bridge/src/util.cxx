// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "util.h"

#include <algorithm>
#include <cwctype>

namespace creo {

std::string toUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }
  const int size = ::WideCharToMultiByte(CP_UTF8, 0, value.data(),
                                         static_cast<int>(value.size()), nullptr,
                                         0, nullptr, nullptr);
  if (size <= 0) {
    return {};
  }
  std::string out(static_cast<size_t>(size), '\0');
  ::WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                        &out[0], size, nullptr, nullptr);
  return out;
}

std::string toUtf8(const xstring& value) {
  if (value.IsNull()) {
    return {};
  }
  return toUtf8(std::wstring(static_cast<cWStringT>(value)));
}

std::wstring toWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  const int size = ::MultiByteToWideChar(CP_UTF8, 0, value.data(),
                                         static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) {
    return {};
  }
  std::wstring out(static_cast<size_t>(size), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                        &out[0], size);
  return out;
}

std::string modelTypeName(pfcModelType type) {
  switch (type) {
    case pfcMDL_ASSEMBLY:
      return "assembly";
    case pfcMDL_PART:
      return "part";
    case pfcMDL_DRAWING:
      return "drawing";
    case pfcMDL_2D_SECTION:
      return "section";
    case pfcMDL_LAYOUT:
      return "layout";
    case pfcMDL_DWG_FORMAT:
      return "format";
    case pfcMDL_MFG:
      return "manufacturing";
    case pfcMDL_REPORT:
      return "report";
    case pfcMDL_MARKUP:
      return "markup";
    case pfcMDL_DIAGRAM:
      return "diagram";
    case pfcMDL_CE_SOLID:
      return "ce_solid";
    case pfcMDL_CE_DRAWING:
      return "ce_drawing";
    case pfcMDL_UNSPECIFIED:
      return "unspecified";
    default:
      return "unknown";
  }
}

std::wstring lowerWide(const std::wstring& value) {
  std::wstring out = value;
  std::transform(out.begin(), out.end(), out.begin(),
                 [](wchar_t c) { return static_cast<wchar_t>(::towlower(c)); });
  return out;
}

bool equalsIgnoreCase(const std::wstring& a, const std::wstring& b) {
  return lowerWide(a) == lowerWide(b);
}

}  // namespace creo
