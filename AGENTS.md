# AGENTS.md — Codepatrol development policy

> Scope: every harness working in this repository.

## Sources of truth

- `README.md` is the functional product contract.
- `skills/catalog.yaml` owns roles, lifecycle order, invocation edges, inputs,
  outputs and mutation policy.
- `.codepatrol/changes/<work-id>/change.yaml` plus its declared stage artifacts
  is the sole durable lifecycle truth.
- Git owns branch/ref/checkpoint identity and recovery.
- `.codepatrol/runtime/sessions/` is rebuildable progress, never governing
  state.

Do not create a root progress file, a mutable status mirror, a global workflow
ledger, harness-specific worktrees or provider candidate trees.

## Choose one primary workflow

| Intent | Workflow | Owned path | Production mutation |
|---|---|---|---|
| New project, feature, architecture scan or bug correction | `codepatrol-plan` | `plan/` | never |
| Plan awaiting a verdict | `codepatrol-review` | `review/` | never |
| Approved current Change | `codepatrol-apply` | `apply/` plus planned source | authorized |
| Candidate awaiting delivery verdict | `codepatrol-verify` | `verify/` | never source |
| Verified Change awaiting commit or rollback | `codepatrol-close` | `close/`, local refs | explicitly authorized |
| Lifecycle inspection | `codepatrol-status` | none | never |

Each lifecycle workflow records its owned artifact/run event before returning
and stops. Supporting skills add bounded evidence to the invoking stage; they
do not create competing workflows.

## Start and resume

Always begin known work with:

```bash
codepatrol change inspect --id <work-id> --workspace "$PWD" --format json
```

Reconcile the projection with Git and declared artifacts. Stop on wrong branch,
hash drift, unexpected dirty paths, target advance or invalid events. Never
select by recency. If the runtime session is missing or corrupt, rebuild it from
the accepted Change artifacts; do not repair lifecycle by editing YAML.

For a new Plan, require a clean trusted Git checkout and run `change start`.
It creates `codepatrol/<work-id>` from the exact target head. One Change maps to
one branch, and one active branch maps to one Change.

## Lifecycle and ownership

The only forward route is Plan → Review → Apply → Verify → Close. Review
defects return to Plan. Verify implementation defects return to Apply; contract
defects return to Plan. Returns create a new attempt and invalidate downstream
accepted attempts without erasing history.

Only write files owned by the current stage. Declare and hash every durable
file. Keep raw logs, conversations, prompts, credentials and scratch payloads
out of Changes. Durable ADRs live in `docs/adr/`; ignored state lives only in
`.codepatrol/runtime/`.

Every attempt records finished or interrupted runs. Finished runs contain
start/finish, elapsed milliseconds and either actual provider/harness tokens or
explicit unavailable reason. Never estimate tokens. Keep active duration and
end-to-end cycle time distinct.

## Investigation and implementation

- Trace the real flow before proposing or changing it. Sync/query the graph and
  verify every cited location. Record an absent wiki rather than inventing one.
- Pin external revisions, separate fact/inference/recommendation and require an
  explicit project decision for dependencies or protocols.
- Prefer the earliest sufficient solution without weakening validation, data
  protection, security, accessibility, reliability or acceptance.
- Apply requires an approved current attempt. Claim one scoped session item,
  establish the planned red/characterization loop, mutate, verify, journal and
  close it in dependency order.
- A semantic deviation returns to Plan. Never conceal it in an Apply journal.
- Preserve unrelated user changes. Never reset, force, rebase, fetch/push or
  resolve integration conflicts automatically.

## Checkpoints and Close

Stage checkpoints are created only through `change transition`. They bind owned
artifacts and, for Apply, every production path; unexpected dirty paths fail.
Verify binds the exact candidate commit/tree.

Close requires new explicit authority, Verify `commit`, unchanged target and
a clean tree. Commit is fast-forward-only. Rollback proves the target tree
unchanged. Create the recoverable terminal tag before deleting the feature
branch. Remote operations remain out of scope.

## Completion

Before sealing a stage, run its focused checks and every applicable typecheck,
test, build, skill lint, package and smoke gate. State commands actually run,
residual risks, Change path, branch/checkpoint and metric coverage.

Apply ends at a clean implemented candidate. Verify ends at a delivery verdict.
Close ends at committed or rolled-back with a clean target checkout. The
v1-release bootstrap cutover in `README.md` requires independent Verify and a
separate explicit user instruction; Apply must not execute it.

<!-- codepatrol:wiki:begin -->
## Project wiki

Run `codepatrol wiki status --format json` before trusting `docs/wiki/`. A
reported absent wiki is a valid substrate state.
<!-- codepatrol:wiki:end -->
