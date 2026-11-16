# Support

## Documentation

- [README](README.md) — overview and quick start
- [docs/SETUP.md](docs/SETUP.md) — install, configure, wire clients, troubleshoot
- [docs/TOOLS.md](docs/TOOLS.md) — tool catalog
- [docs/SAFETY.md](docs/SAFETY.md) — safety model and write policy
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — bridge protocol
- [docs/ROADMAP.md](docs/ROADMAP.md) — milestone status

## Questions and bugs

- **Bug or unexpected behavior**: open an issue with the bug report template.
- **Feature request**: open an issue with the feature request template.
- **Setup help**: include your Creo version, Windows version, Node version,
  `doctor` output, and the relevant stderr logs.
- **Security issue**: follow [SECURITY.md](SECURITY.md); do not open a public
  issue.

This is a single-maintainer, best-effort project. There is no commercial support
or SLA.

## What to include

```powershell
node packages/server/dist/cli/doctor.js --json
npm test
```

Also include the client you use (Claude Desktop, Codex, opencode, Cursor) and
whether the bridge was built with `-UseNo222`.
