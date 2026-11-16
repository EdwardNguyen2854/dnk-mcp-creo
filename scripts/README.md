# Scripts

The scripts in this directory fall into three groups.

## Build

| Script | Purpose |
|---|---|
| `build-native.ps1` | Compiles `native/otk-bridge` into `creo-otk-bridge.exe` |
| `install.ps1` | Installs dependencies, builds the bridge and server, runs the mock doctor |

## Acceptance and smoke tests (need a live Creo)

| Script | Pack | What it proves |
|---|---|---|
| `integration-smoke.mjs` | core | Bridge attach, session read, model access |
| `mcp-live-check.mjs` | core | MCP tool listing and calls over stdio |
| `fixture-models.mjs` | read | Copies Creo's demo corpus into the fixture sandbox |
| `read-pack-smoke.mjs` | read | Exercises every read-pack bridge command |
| `export-pack-smoke.mjs` | export | STEP, IGES, STL, PDF, DXF exports on disk |
| `build-showcase-model.mjs` | features | Builds the six-spoke pulley and verifies volume |
| `build-detail-part.mjs` | features | Template → extrude → round/chamfer → shell |
| `build-datum-part.mjs` | features | Offset plane, sketch, axis, point, coaxial hole |
| `build-hole-part.mjs` | features | Through hole and counterbore with volume checks |
| `build-pattern-part.mjs` | features | Linear and axis-driven patterns |
| `build-assembly.mjs` | modeling | Assembles components and exports STEP |
| `model-to-drawing-demo.mjs` | drawing | Model → standard drawing → PDF/DXF |

These are not part of `npm test`; they require a running Creo session and the
native bridge.

## Development helpers

| Script | Purpose |
|---|---|
| `payload-discovery.mjs` | Dumps native feature element trees from a live Creo |
| `dev-bridge-call.mjs` | Calls one raw bridge method with a JSON file |

They are debugging aids, not acceptance tests. Inline JSON on PowerShell mangles
quotes, so pass parameters through a file.

## Conventions

- Run scripts from the repository root.
- Build the server first (`npm run build`); scripts import from
  `packages/server/dist`.
- Do not rely on `npm run <script> -- --flags` to forward flags in this
  PowerShell setup; invoke the Node entrypoint directly.
