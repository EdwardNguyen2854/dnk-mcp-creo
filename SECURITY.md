# Security policy

## Supported versions

| Version | Supported |
|---|---|
| `0.3.x` | Yes |
| `< 0.3` | No |

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private reporting flow:

1. Go to <https://github.com/EdwardNguyen2854/dnk-mcp-creo/security/advisories/new>.
2. Describe the issue, the affected version, and a minimal reproduction.
3. Include the impact you believe it has.

If you cannot use Security Advisories, open a minimal public issue asking for a
private contact channel, without disclosing the vulnerability.

You can expect an acknowledgement within a few days. This is a single-maintainer
project, so timelines are best-effort.

## Scope

Security-relevant areas include:

- **Path containment.** File tools must stay inside Creo's live working
  directory. Escapes via `..`, absolute paths, UNC paths, or symlinks are
  vulnerabilities.
- **Write safety.** `safety.mode` gating, allowlists, guards, copy-modify-verify,
  and rollback must not be bypassable through tool arguments or config.
- **Bridge protocol.** Framed stdio handling, request validation, and malformed
  frame handling.
- **Audit trail.** Audit records must not be silently skipped for writes.
- **Secrets and local data.** Logs and audit files must not leak credentials or
  unrelated machine data.

## Out of scope

- Vulnerabilities in PTC Creo, Pro/TOOLKIT, or the OTK SDK. Report those to PTC.
- Issues that require the attacker to already control the local machine or the
  Creo session.
- Deliberately enabling `safety.mode: live` and then modifying models. The
  safety model is documented; write-capable modes are opt-in.

## Safe use

The default mode is read-only. Before enabling `copy` or `live`:

- Read [docs/SAFETY.md](docs/SAFETY.md).
- Work on copies or version-controlled data.
- Keep the audit log enabled.
- Expect that a CAD write can be expensive or destructive if misconfigured.
