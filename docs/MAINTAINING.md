# Maintaining the repository

This note is for the maintainer. It covers repository settings, the release
process, and the checks that cannot run in CI.

## Repository settings

Set these once on GitHub:

- **Description**: "Model Context Protocol server for PTC Creo Parametric, built
  on an asynchronous Object TOOLKIT C++ bridge."
- **Topics**: `mcp`, `model-context-protocol`, `ptc-creo`, `creo-parametric`,
  `pro-toolkit`, `object-toolkit`, `cad`, `automation`, `typescript`, `cpp`.
- **Default branch**: `main`.
- **Branch protection** for `main`:
  - Require the CI workflow to pass.
  - Require a pull request before merging.
  - Require conversation resolution.
  - Do not allow force pushes.
- **Security**: enable Dependabot alerts, Dependabot security updates, secret
  scanning, and private vulnerability reporting.
- **Discussions**: enable if you want setup questions outside issues.
- **Social preview**: upload a 1280×640 image (the pulley render works well).

## CI

`.github/workflows/ci.yml` runs on Windows with Node 20 and 22:

```text
npm ci
npm run typecheck
npm test
npm run build
node packages/server/dist/cli/doctor.js --mock --json
```

The **native bridge is not built in CI**. It requires the PTC Creo SDK, a Creo
installation, and a Toolkit license, none of which can be redistributed or
installed on a hosted runner. Native changes must be verified locally with a
live Creo session before merging.

## Release checklist

1. Confirm `main` is green.
2. Update `CHANGELOG.md` and move `[Unreleased]` items into the new version.
3. Bump the version in:
   - `package.json`
   - `packages/server/package.json`
   - `CITATION.cff`
4. Run the full local verification:

   ```powershell
   npm ci
   npm run verify
   npm run doctor:mock
   ```

5. Commit: `chore(release): vX.Y.Z`.
6. Tag and push:

   ```powershell
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --follow-tags
   ```

7. Create a GitHub release from the tag. Summarize user-facing changes and link
   the changelog. Do not attach PTC binaries or SDK files.
8. Verify the release page, badges, and install instructions render correctly.

## Distribution

This project is distributed from GitHub. It is intentionally marked
`"private": true` in both `package.json` files to prevent an accidental
`npm publish`; that flag does not describe the repository's visibility.

To publish to npm later:

1. Remove `"private": true` from `packages/server/package.json`.
2. Add `"publishConfig": { "access": "public" }`.
3. Confirm the `dist/` build is complete before `npm publish`.
4. Document that the native bridge still has to be built locally.

## Dependency updates

Dependabot opens weekly npm and GitHub Actions updates. For each update:

```powershell
npm ci
npm run verify
npm run doctor:mock
```

Review native build changes manually if `@modelcontextprotocol/sdk` or zod
affect tool schemas.

## Secrets and local data

Before any push:

```powershell
git ls-files | Select-String -Pattern "logs/|sandbox/|\.agent-teams/|node_modules/|dist/|\.env"
```

The command must return nothing. The `.gitignore` already excludes these paths,
but the check catches accidental force-adds.
