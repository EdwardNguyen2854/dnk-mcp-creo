# Architecture

## Components

```
packages/server/src/
  index.ts               stdio MCP entry point, CLI flags
  server.ts              McpServer wiring, session cache, tool registration
  config.ts              config file/env resolution, Creo/bridge discovery
  errors.ts              CreoMcpError taxonomy + tool error serialization
  logging.ts             stderr-only logger (stdout is reserved for MCP)
  bridge/
    protocol.ts          zod schemas for the bridge protocol
    transport.ts         BridgeTransport interface (the pluggable seam)
    stdio-otk.ts         spawns creo-otk-bridge.exe, framed JSON-RPC over stdio
    mock.ts              in-process bridge for tests and --mock
  policy/engine.ts       safety modes; write-tool gating
  policy/safe-write.ts   copy-modify-verify, guards, rollback
  audit/audit-log.ts     append-only JSONL audit trail
  tools/
    registry.ts          defineTool/registerTool, annotations, error handling
    core.ts              M1 core tools
    read.ts              M2.0 read pack (pack-gated)
    modeling.ts          M3 write pack (pack-gated)
    drawing.ts           M5 drawing pack (pack-gated)
    export.ts            M2.1 export pack (pack-gated)
    features.ts          M4 features pack (pack-gated)
  cli/doctor.ts          environment diagnostics

native/otk-bridge/src/
  main.cxx               stdio loop, framed responses, --self-test
  bridge.cxx/.h          CreoSession: connect/launch, commands, model/session JSON
  read.cxx/.h            read-pack primitives and JSON serialization
  modeling.cxx/.h        lifecycle/parameter/dimension/feature writes
  drawing.cxx/.h         drawing, sheet, and view operations
  features.cxx/.h        solid feature authoring (extrude, revolve, holes, datums, patterns)
  export.cxx/.h          STEP/IGES/STL/PDF/DXF export
  util.cxx/.h            UTF-8 <-> UTF-16, model type mapping
```

## Design decisions

1. **Async OTK C++ bridge instead of a resident in-process DLL.**
   PTC's OTK async apps run out-of-process and communicate over RPC. This avoids
   loading code into Creo, requires no Creo restart when the bridge changes, and
   keeps the MCP server language independent. Trade-off: RPC is slower than DLL
   mode, which is acceptable for interactive tool calls.

2. **Thin bridge, smart server.**
   The native side exposes primitives and always returns readback data. Copy-modify-verify
   workflows, value guards, allowlists, dry-run, rollback, and audit are implemented
   in TypeScript. Adding a safety rule never requires recompiling C++.

3. **Versioned bridge protocol.**
   `bridge.hello` reports `protocolVersion`, bridge version, OTK library, and
   capabilities. Future adapters (CREOSON HTTP, VB API COM) implement the same
   `BridgeTransport` interface.

4. **Framed stdio protocol.**
   Every protocol line is prefixed with `__CREOBRIDGE__ `. PTC runtimes occasionally
   print to stdout; the prefix lets the TypeScript transport ignore unrelated output
   instead of corrupting the JSON stream.

5. **Process environment requirements are handled by the server.**
   Async OTK apps require `PRO_COMM_MSG_EXE` to point at Creo's `pro_comm_msg.exe`
   (documented in PTC's asynchronous-mode manual). `buildBridgeEnv()` sets it, along
   with Creo runtime directories on `PATH`, for every bridge process. No system-wide
   environment changes are needed.

6. **Tool packs.**
   `tools.packs` in the config controls which tool groups are registered. The
   `core` pack is always on; `read`, `export`, `modeling`, `drawing`, and
   `features` are implemented and pack-gated. This keeps the model's tool
   context small. A pack is only registered when listed in `tools.packs`;
   `creo_capabilities` reports the active list. See
   [docs/TOOLS.md](TOOLS.md) for the current catalog and
   [docs/ROADMAP.md](ROADMAP.md) for what remains planned.

7. **stderr-only logging.**
   MCP uses stdout for protocol traffic. The server writes logs to stderr and the
   native bridge writes protocol frames to stdout with a strict prefix; bridge
   stderr is forwarded at debug level.

## Connection lifecycle

```
MCP tool call
  -> ensureSession(): bridge session.info
       connected? reuse
       not connected? session.connect(mode=attach|launch)
  -> bridge command
  -> structured result
  -> audit record
```

- `attach` (default): `pfcAsyncConnection::Connect()`. Requires Creo running.
- `launch`: `pfcAsyncConnection::Start(creoCommand, textPath)`. The bridge owns the
  session and ends it on `session.disconnect`/shutdown.
- The bridge process is spawned lazily on the first call and exits on EOF, which
  disconnects gracefully. If it crashes, the next call respawns and re-attaches.

## Verified environment facts

- Creo 9.0.2.0 ships OTK C++ with `otk_cpp_async.lib` and `pfcAsyncConnection`.
- Link recipe mirrors the SDK's own `make_otk_async_examples`.
- `pfcGetProEVersion()` is documented as synchronous-only for C++; async uses
  `wfcWSession::GetReleaseNumericVersion()` and `GetDisplayDateCode()`.
- The install's license carries OTK feature `222`; `otk_no222.lib` is available as a
  fallback (`build-native.ps1 -UseNo222`).
- Attach fails with `XToolkitCantModify` when `PRO_COMM_MSG_EXE` is missing — the
  single most important environment detail for async OTK.
