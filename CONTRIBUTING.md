# Contributing to DNK MCP Creo

Thanks for taking the time to contribute. This project drives a live CAD system,
so changes are reviewed with extra care around safety and path containment.

## Before you start

- Read [docs/SAFETY.md](docs/SAFETY.md) and [AGENTS.md](AGENTS.md).
- Check [docs/ROADMAP.md](docs/ROADMAP.md) before assuming a tool exists.
- For a large change, open an issue first so the design can be discussed.

## Prerequisites

| Component | Requirement |
|---|---|
| PTC Creo Parametric | 9.0.2.0 (verified); other 9.x/10.x pending SDK path checks |
| Visual Studio | 2022 with the C++ workload (native bridge only) |
| Node.js | 20 or newer |
| PTC license | OTK feature `222`, or build with `-UseNo222` |

You do **not** need Creo to work on the TypeScript server. Unit and contract
tests run against an in-process mock bridge.

## Setup

```powershell
npm install
npm run build        # TypeScript server
npm test             # mock bridge tests; no Creo required
```

With Creo installed and running:

```powershell
npm run build:native
npm run doctor
node scripts/integration-smoke.mjs
```

## Checks before a pull request

```powershell
npm run typecheck
npm test
npm run build
npm run doctor:mock
```

- Keep `stdout` free of logs. It is reserved for MCP; use `createLogger`.
- Add or update tests for every behavior change. Extend `MockBridgeTransport`
  when you add a bridge command.
- Do not commit `logs/`, `fixtures/sandbox/`, `.agent-teams/`, `dist/`, or
  native build output.
- Do not commit PTC SDK files, Creo binaries, or PTC documentation.

## Adding a TypeScript tool

1. Define it in `packages/server/src/tools/*.ts` as a `ToolDefinition`.
2. Register it in `packages/server/src/server.ts` (and call
   `registerWriteTools()` for write tools).
3. Use zod for `inputSchema` and `outputSchema`.
4. Add `READ_ONLY_ANNOTATIONS` for read-only tools.
5. Extend the mock bridge and add a test in `packages/server/test/`.

## Changing the native bridge

- Keep the bridge thin: primitives and readback only. Safety policy belongs in
  TypeScript.
- Native code compiles as C++14. Do not add `/std:c++17`.
- Never use `std::optional` in files that include OTK headers.
- Add new `.cxx` files to the explicit source list in
  `scripts/build-native.ps1`.
- Capture real payloads with `node scripts/payload-discovery.mjs` before
  guessing OTK element trees.

## Commit messages

Use a short imperative subject and a conventional prefix:

```
feat(read): add mass-property readback
fix(native): handle missing material
docs: clarify setup on Creo 10
chore: bump dependencies
```

Sign-off (`git commit -s`) is welcome but not required.

## Pull request checklist

- [ ] The change is focused and described in the PR template.
- [ ] Typecheck, tests, and build pass locally.
- [ ] New behavior is covered by tests.
- [ ] Safety implications are explained (especially for write tools).
- [ ] Docs are updated when behavior or configuration changes.
- [ ] No secrets, machine paths, logs, or fixtures are included.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as described in [LICENSE](LICENSE).
