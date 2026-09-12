# ModelPatrol gateway integration

Configure the packaged Pi executor to load the separately installed ModelPatrol
provider extension. Add to `codepatrol.json`:

```json
{
  "modelpatrol": {
    "baseUrl": "http://127.0.0.1:4318",
    "harness": "pi",
    "project": "my-project",
    "model": "auto",
    "api": "chat",
    "apiKeyEnv": "MODELPATROL_API_KEY"
  },
  "executor": ["codepatrol-pi-executor"]
}
```

The gateway credential must be set in the environment. Executor stdin remains
Patrol Protocol 1.0; stage metadata travels through child environment variables
to the adapter and then through `X-Patrol-*` request headers. Provider
`modelpatrol`, model `auto` in Pi delegates model selection to the gateway. Pin
an alias via `model` to disable automatic choice.

See ModelPatrol's packaged `docs/integrations.md` for adapter installation.
Set `api: "responses"` for Responses-only models, including applicable Codex
API models. `auto` cannot make a Chat Completions harness speak Responses.

Install Pi separately with the current official package, and install ModelPatrol
so `modelpatrol integration-path pi` is available on `PATH`. Install CodePatrol's
Pi package globally once with `pi install /absolute/path/to/codepatrol` (or
`pi install npm:codepatrol@1.0.0` after publication). Then start Pi in the root
of any configured, clean repository and use `/patrol <feature description>`.
`MODELPATROL_API_KEY` must be exported before Pi starts; for the local deployment
it can be loaded into the current shell from the operator-owned
`modelpatrol/deploy/local.env`.

The package switches capability by process context: interactive Pi receives only
`/patrol`, while a CodePatrol-launched stage receives only the structured
`codepatrol_result` completion tool. Successful Ship remains in the detached
worktree at `awaiting-approval`. This configuration does not start the gateway,
provide credentials, merge, commit, push, publish or deploy. Verification and
review gates retain their existing semantics.

`/patrol` consumes bounded progress events from CodePatrol stderr and updates the
Pi status while each stage is running. ModelPatrol forwards the native Chat
events available from Codex, Claude, OpenCode, Grok, Ollama and Antigravity;
CodePatrol also emits a ten-second heartbeat during provider silence. Configure
`progress.detail` as `safe` (default) or `verbose`. The stage Pi process disables
automatic retry so an ambiguous or partially streamed executor dispatch is never
replayed.
