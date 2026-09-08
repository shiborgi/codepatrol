# ModelPatrol gateway integration

Configure an existing trusted executor to load the separately installed
ModelPatrol harness adapter. Add to `codepatrol.json`:

```json
{
  "modelpatrol": {
    "baseUrl": "http://127.0.0.1:4318",
    "harness": "opencode",
    "project": "my-project",
    "model": "auto",
    "api": "chat",
    "apiKeyEnv": "MODELPATROL_API_KEY"
  }
}
```

The gateway credential must be set in the environment. Executor stdin remains
Patrol Protocol 1.0; stage metadata travels through child environment variables
to the adapter and then through `X-Patrol-*` request headers. `modelpatrol/auto`
in OpenCode or provider `modelpatrol`, model `auto` in Pi delegates model
selection to the gateway. Pin an alias via `model` to disable automatic choice.

See ModelPatrol's packaged `docs/integrations.md` for adapter installation.
Set `api: "responses"` for Responses-only models, including applicable Codex
API models. `auto` cannot make a Chat Completions harness speak Responses.

This configuration does not install/start a gateway, install a harness, replace
the trusted executor's result adapter, or authorize remote release. Verification
and review gates retain their existing semantics.
