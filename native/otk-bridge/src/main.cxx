// SPDX-FileCopyrightText: 2026 Edward Nguyen
// SPDX-License-Identifier: Apache-2.0
#include "bridge.h"

#include <iostream>
#include <string>

namespace {

const char* kFramePrefix = "__CREOBRIDGE__ ";

void writeFrame(const nlohmann::json& payload) {
  std::cout << kFramePrefix << payload.dump() << std::endl;
}

nlohmann::json makeError(const nlohmann::json& id, const std::string& code,
                         const std::string& message, bool retryable,
                         const nlohmann::json& details) {
  nlohmann::json error = {
      {"code", code}, {"message", message}, {"retryable", retryable}};
  if (details.is_object() && !details.empty()) {
    error["details"] = details;
  }
  return {{"jsonrpc", "2.0"}, {"id", id}, {"error", error}};
}

int runSelfTest(creo::CreoBridge& bridge) {
  int failures = 0;
  const auto expect = [&failures](bool condition, const char* label) {
    std::cout << (condition ? "[ok] " : "[FAIL] ") << label << std::endl;
    if (!condition) {
      ++failures;
    }
  };

  try {
    const nlohmann::json empty = nlohmann::json::object();
    const nlohmann::json hello = bridge.dispatch("bridge.hello", empty);
    expect(hello["protocolVersion"] == "1.0", "bridge.hello protocolVersion");
    expect(hello.contains("capabilities"), "bridge.hello capabilities");

    const nlohmann::json ping = bridge.dispatch("bridge.ping", empty);
    expect(ping["pong"] == true, "bridge.ping pong");

    const nlohmann::json info = bridge.dispatch("session.info", empty);
    expect(info["connected"] == false, "session.info reports offline");

    bool unknownThrew = false;
    try {
      bridge.dispatch("does.not.exist", empty);
    } catch (const creo::BridgeError& error) {
      unknownThrew = error.code == "METHOD_NOT_FOUND";
    }
    expect(unknownThrew, "unknown method -> METHOD_NOT_FOUND");

    bool sessionThrew = false;
    try {
      bridge.dispatch("model.active", empty);
    } catch (const creo::BridgeError& error) {
      sessionThrew = error.code == "SESSION_NOT_CONNECTED";
    }
    expect(sessionThrew, "model.active -> SESSION_NOT_CONNECTED");
  } catch (const std::exception& error) {
    std::cout << "[FAIL] unexpected exception: " << error.what() << std::endl;
    ++failures;
  }

  std::cout << (failures == 0 ? "SELFTEST_OK" : "SELFTEST_FAILED") << std::endl;
  return failures;
}

}  // namespace

int main(int argc, char** argv) {
  creo::CreoBridge bridge;

  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--self-test") {
      return runSelfTest(bridge) == 0 ? 0 : 1;
    }
    if (arg == "--version") {
      writeFrame(bridge.dispatch("bridge.hello", nlohmann::json::object()));
      return 0;
    }
  }

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    if (line.empty()) {
      continue;
    }

    nlohmann::json id = nullptr;
    nlohmann::json response;
    try {
      const nlohmann::json request = nlohmann::json::parse(line);
      id = request.contains("id") ? request["id"] : nlohmann::json(nullptr);
      const std::string method = request.value("method", std::string());
      if (method.empty()) {
        throw creo::BridgeError("INVALID_REQUEST",
                                "Request is missing the 'method' field");
      }
      const nlohmann::json params =
          request.value("params", nlohmann::json::object());
      response = {{"jsonrpc", "2.0"},
                  {"id", id},
                  {"result", bridge.dispatch(method, params)}};
    } catch (const nlohmann::json::parse_error& error) {
      response = makeError(id, "PARSE_ERROR", error.what(), false, nullptr);
    } catch (const creo::BridgeError& error) {
      response = makeError(id, error.code, error.message, error.retryable,
                           error.details);
    } catch (const std::exception& error) {
      response = makeError(id, "INTERNAL", error.what(), false, nullptr);
    } catch (...) {
      response = makeError(id, "INTERNAL", "Unknown bridge failure", false,
                           nullptr);
    }
    writeFrame(response);
  }

  bridge.shutdown();
  return 0;
}
