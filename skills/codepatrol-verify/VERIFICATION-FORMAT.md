# Verification report format

Write `docs/codepatrol/<work-id>/verification.md` when verifying an implemented package. Record executed evidence, never restated journal claims.

```markdown
# Verification — <name>

- Package: `<work-id>`
- Verified revision: <N>
- Verifier: <harness or actor>
- Base ref: <implementation.base_ref>
- Head ref: <ref or working tree>
- Evidence date: <ISO timestamp>

## Scope and instruments

<Artifacts read, diff range audited, commands available, environment limits, and
anything that could not be executed here.>

## Plan conformance

<Task-by-task comparison of the diff against `plan.md`. Name every difference and
whether `implementation.md` journaled it.>

## Acceptance re-verification

| Criterion | Command re-executed | Result | Independent of the journal |
|---|---|---|---|
| AC-1 | `<exact command>` | pass | yes |

## Wider suite

<The plan's final verification task and the full project gate: exact commands and
observed results, including warnings.>

## Blast radius

<`codepatrol graph impact --since-ref <base_ref>` output, affected callers and
tests, and confirmation that each was exercised. Name impacted seams the plan
did not list.>

## Regressions

<Checks run beyond the changed files and any behavior drift at surviving
interfaces, with verified locations.>

## Unplanned changes

| Path | Declared in spec/plan | Disposition |
|---|---|---|
| `<path>` | yes/no | <accepted as journaled deviation | finding> |

## Findings

### <critical|major|minor> — <conformance|acceptance|regression|scope|evidence>

<Verified problem, exact location, impact, and required correction.>

## Residual risks and evidence gaps

<Risks that survive a passing verification, checks that could not falsify the
behavior, and their consequence.>

## Verdict

`commit` | `improve`

<One paragraph explaining the verdict, the manifest status it sets, and the next
owner: no one for `commit`, `codepatrol-apply` for a bounded `improve`, or
`codepatrol-review` for a semantic `improve`.>
```

Rules:

- Every claim cites a command actually executed in this session or an exact verified location. A result copied from `implementation.md` is not evidence.
- Report each acceptance criterion by its stable `AC-N` from `spec.md`.
- Record whether a `DC-N` trigger from the spec activated during implementation.
- Keep commands and concise results, not full logs. Quote the shortest decisive output line.
- State evidence gaps explicitly. A `commit` verdict with an unstated gap is a false verdict.
