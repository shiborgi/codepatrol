# Specification — Minor improvements, push option, token count logic, and legacy cleanup

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main
- Governing constraints: None
- Substrate state: absent
- Problem: The `close` step requires a manual push of the branch after committing. Step token counts rely on LLM API metrics which do not reflect local proxy interactions, and the `actor` field does not surface the harness or model. There is also a legacy test for the old `workflow prime` command.
- Outcome: `AGENTS.md` and `codepatrol-close` are amended to allow git pushes; `close` accepts an optional push flag; tokens are approximated locally via character count division; the `actor` field records the harness and model; and the legacy `workflow prime` test is removed.

## Scope

### In scope

- Amend `AGENTS.md` and `skills/codepatrol-close/SKILL.md` to permit optional remote push.
- Add `push?: boolean` to `CloseInput` and implement `git push` during `completeFinalization`.
- Modify `sumPiUsage` in `.pi/index.ts` to calculate tokens approximately (`Math.ceil(chars / 4)`).
- Modify the `codepatrol_record_run` Pi tool to inject the harness and model into the `actor` string of the transition intent.
- Remove the legacy `workflow prime` CLI test assertions in `src/cli/cli.test.ts`.

### Out of scope

- Renaming metric fields (e.g., `tokens` to `characters`). We will retain the existing `TokenUsage` interface to preserve compatibility.

## Current evidence

- `AGENTS.md` restricts remote operations. `skills/codepatrol-close/SKILL.md` says "never fetch, push...".
- `.pi/index.ts` records runs using `actor: "pi"` and tracks tokens from API returns.
- `src/cli/cli.test.ts` line 39 contains `run(["workflow", "prime", ...])` which tests a legacy naming scheme.

## Proposed design

1. **Policy update**: Update `AGENTS.md` to remove the prohibition on remote operations for `Close`. Update `codepatrol-close/SKILL.md` to explicitly allow pushing when requested.
2. **Push feature**: Add `push` to `CloseInput`. If `push: true` and outcome is `commit`, call `git.push(targetBranch)`. Add `push(branch: string)` to `GitAdapter`.
3. **Token approximation**: In `.pi/index.ts`'s `sumPiUsage`, sum the string length of `message.content`, divide by 4, and use `Math.ceil` to estimate tokens. This preserves the `RunUsage.tokens` schema and avoids massive YAML fixture migrations.
4. **Actor tracking**: In `.pi/index.ts`, when transitioning usage, format the `actor` field as `` `${harness} (${model || 'unknown'})` `` or similar, surfacing this metadata in the workflow.
5. **Legacy cleanup**: Delete the `workflow` test block in `cli.test.ts`.

## Alternatives

- Renaming `tokens` to `characters`: Rejected because it requires widespread schema and fixture migrations and violates the semantic of standard token logging.
- Keeping push out of scope: Rejected because the user specifically requested modifying the governance to allow it.

## Simplicity decision

- Selected rung: direct local change
- Earlier rungs: N/A, modifying core CLI logic and policy docs directly.
- Irreducible complexity: Minimal parsing for token approximation and conditional branching for git push.
- Safety floor: Push only occurs if the commit succeeds. Token approximation guarantees a safe integer.
- Expected surface delta: ~5 files modified (`AGENTS.md`, `SKILL.md`, `git.ts`, `orchestrator.ts`, `.pi/index.ts`, `cli.test.ts`).

## Deferred constraints

None — No deferred constraints.

## Compatibility and rollout

- Retaining the `tokens` schema guarantees 100% backward compatibility for all existing YAML change records. The `actor` field is a free-form string, so adding model info is fully backward-compatible.

## Risks and mitigations

- Push might fail if remote has advanced. Mitigation: let git throw and user handles resolution.

## Acceptance criteria

- AC-1: Policy documents allow push, and `CloseInput` implements a `push: boolean` capability that pushes to the target branch.
- AC-2: Token metrics are approximated locally by character length / 4, avoiding API reliance while retaining the `tokens` schema field.
- AC-3: The `actor` string recorded for the run includes both the harness and model name.
- AC-4: The legacy `workflow` command test code is successfully removed from `src/cli/cli.test.ts`.

## Decisions and open questions

None.
