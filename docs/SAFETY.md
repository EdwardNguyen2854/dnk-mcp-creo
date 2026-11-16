# Safety Model

## Defaults

- `safety.mode` defaults to **`read-only`**: any tool registered as a write tool is
  rejected with `POLICY_BLOCKED` before it reaches the bridge.
- Core and read-pack query tools are read-only by construction
  (`readOnlyHint: true`).
- The server never executes arbitrary code. There is no `eval`, no script execution
  tool, and no caller-provided file paths.

## Session-mutating tools (M2.0)

`creo_open_model` and `creo_close_model` change session state only; they are
annotated `readOnlyHint: false` and audited, but not blocked by
`safety.mode: read-only` because they never modify model data or files.

- `creo_open_model` accepts a plain file name only and resolves it against Creo's
  live working directory; separators, `..`, absolute paths, and UNC paths are
  rejected before the bridge is called.
- `creo_close_model` erases a model from the session (never the file on disk),
  refuses models with unsaved changes unless `force: true`, and verifies by
  readback that the model is gone.

## Modes

| Mode | Behavior |
|---|---|
| `read-only` (default) | Write tools are not callable |
| `copy` | Planned M3 default for writes: modifications are applied to a new copy, never the source model |
| `live` | Direct edits with mandatory backups and audit; opt-in only |

## Planned write guards (M3+)

Every write tool will require:

- **Model identity**: active model name/type/path must match expectations.
- **Expected old values**: parameter/dimension writes require `expectedOldValue`.
- **Relation awareness**: relation-driven dimensions are rejected.
- **Range policy**: e.g. dimensions limited to 0.5x–2x the previous value unless
  explicitly overridden.
- **Allowlists**: writable parameter names and feature types are configurable.
- **Path containment**: files must be direct children of Creo's live working
  directory; separators, `..`, and UNC escapes are rejected.
- **Readback verification**: after the operation, values are re-read and invariants
  checked (volume direction, feature count, envelope) before saving.
- **Rollback**: failed copy workflows delete the partial copy/feature; failed live
  workflows restore the automatic backup.
- **Version hygiene**: old versions of only the target family are moved to the
  Windows Recycle Bin.

## Audit trail

Every tool call appends a JSONL record to `audit.path` (default
`logs/audit.jsonl`):

```json
{"ts":"2026-09-25T15:47:10.982Z","tool":"creo_get_active_model","ok":true,"durationMs":42,"args":{}}
```

Audit writes never break a tool call; failures are logged at warn level.

## Untrusted data

All strings coming from Creo (model names, parameters, notes) are treated as data,
never as instructions. Tool outputs are JSON; they are not interpreted by the
server.

## Operating notes

- Async OTK calls are synchronous RPCs to Creo. A modal dialog in Creo can block a
  call until the dialog is dismissed; `CREO_BUSY`/`TIMEOUT` are surfaced instead of
  hanging the MCP server forever.
- Prefer `attach` mode for interactive use and `launch` for headless/automation
  scenarios.
- The bridge owns sessions it launched and ends them on shutdown; it only
  disconnects from sessions it attached to.
