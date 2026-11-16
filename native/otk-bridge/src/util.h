// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <windows.h>

#include <xstring.h>
#include <pfcModel.h>

namespace creo {

struct BridgeError {
  std::string code;
  std::string message;
  bool retryable;
  nlohmann::json details;

  BridgeError(const std::string& inCode, const std::string& inMessage,
              bool inRetryable = false,
              const nlohmann::json& inDetails = nlohmann::json::object())
      : code(inCode), message(inMessage), retryable(inRetryable), details(inDetails) {}
};

std::string toUtf8(const std::wstring& value);
std::string toUtf8(const xstring& value);
std::wstring toWide(const std::string& value);
std::string modelTypeName(pfcModelType type);
std::wstring lowerWide(const std::wstring& value);
bool equalsIgnoreCase(const std::wstring& a, const std::wstring& b);

}  // namespace creo
