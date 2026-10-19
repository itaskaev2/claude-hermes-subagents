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

## Config (env in `.mcp.json`)

| Var | Default | Meaning |
|---|---|---|
| `HERMES_SSH_HOST` | `hermes.home.local` | SSH alias of the Hermes host |
| `HERMES_BIN` | `~/.local/bin/hermes` | Hermes CLI path on that host |
| `HERMES_LOCAL` | unset | `1` = run Hermes locally, no SSH |
| `HERMES_TIMEOUT_SEC` | 600 | Per-task hard timeout |
| `HERMES_MAX_PARALLEL` | 6 | Concurrency cap for `hermes_run_many` |

## Notes

Prompts go through stdin (`--query-file -`), so there are no shell-quoting issues. `yolo` (auto-approve) is off unless explicitly passed.
