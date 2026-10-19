# claude-hermes-subagents

Claude Code plugin that lets Claude run copies of the Hermes agent as subagents, in parallel, over SSH.

It ships a zero-dependency MCP server (Node 18+) with two tools:

- `hermes_run` - one Hermes subagent (`hermes chat --query-file - -Q`); returns the final answer and a `session_id`.
- `hermes_run_many` - several independent subagents in parallel.

Plus a `hermes-subagent` skill with usage rules.

## Install

```
/plugin marketplace add itaskaev2/claude-hermes-subagents
/plugin install hermes-subagents@hermes-subagents
```

Requires passwordless SSH (BatchMode) to the Hermes host.

## Targets

Each call takes an optional `target`: `ssh` (remote Hermes host), `local` (Hermes installed on this computer) or `wsl` (Hermes inside WSL). Different targets can be mixed in one `hermes_run_many`. Every result prints `session_id (target: X)`; resume with the same target.

## Config (env in `.mcp.json`)

| Var | Default | Meaning |
|---|---|---|
| `HERMES_SSH_HOST` | `hermes.home.local` | SSH alias of the Hermes host |
| `HERMES_BIN` | `~/.local/bin/hermes` | Hermes CLI path on that host |
| `HERMES_DEFAULT_TARGET` | `ssh` | Default target: `ssh`, `local` or `wsl` |
| `HERMES_LOCAL` | unset | `1` = alias for `HERMES_DEFAULT_TARGET=local` |
| `HERMES_LOCAL_BIN` | `hermes` | Native local Hermes executable (must be on PATH) |
| `HERMES_WSL_DISTRO` | `Ubuntu` | WSL distro for the `wsl` target |
| `HERMES_WSL_BIN` | `~/.local/bin/hermes` | Hermes path inside WSL |
| `HERMES_TIMEOUT_SEC` | 600 | Per-task hard timeout |
| `HERMES_MAX_PARALLEL` | 6 | Concurrency cap for `hermes_run_many` |

## Notes

Prompts go through stdin (`--query-file -`), so there are no shell-quoting issues. `yolo` (auto-approve) is off unless explicitly passed.
