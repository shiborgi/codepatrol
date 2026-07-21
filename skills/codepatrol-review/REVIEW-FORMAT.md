# Handoff review format

Write `docs/codepatrol/<work-id>/review.md` when reviewing an artifact package.

```markdown
# Review — <name>

- Package: `<work-id>`
- Incoming revision: <N>
- Reviewed revision: <N or N+1 after adjustments>
- Reviewer: <harness or actor>
- Evidence date: <ISO timestamp>

## Scope and evidence

<Files, graph/ref evidence, baseline, and limitations actually checked.>

## Findings

### <critical|major|minor> — <contract|architecture|plan|evidence>

<Verified problem, exact location, impact, and required correction.>

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `spec.md` | <exact adjustment or “none”> | <reason> | <AC-N> |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T1, T3 | yes — <loop> | covered |

## Simplicity axis

- Selected rung: <confirmed | corrected, with evidence>
- Safety floor: <requirements retained and verification that protects them>
- Surface delta: <expected additions/removals and whether they are necessary>

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| remove | <artifact section or changed path> | <exact deletion> | <none or AC-N impact> | <adjusted | required correction> |

<Use `remove`, `reuse`, `built-in`, `speculative`, or `simplify`. Confirm that every
deferred constraint has a known ceiling, observable trigger, and bounded upgrade
path. Say “already sufficient” with evidence when no finding survives validation.>

## Executability audit

<Confirm paths/interfaces/dependencies/commands/expected red and green signals,
rollback, and context independence. List any unresolved assumption.>

## Verdict

`approve` | `fix-first` | `rework`

<One paragraph explaining the verdict and the manifest status it permits.>

## External evidence sufficiency

<State one of: `not required` (with reason), `required and sufficient` (naming the governing Reference Concept Analysis and the load-bearing claims checked), or `required and missing` (a finding).>

## Residual concerns and evidence gaps

<Mandatory record of what you could not check and why any noted concern does not block this decision.>
```

`approve` means the resulting revision is complete enough for an independent implementer and sets status `approved`. `fix-first` means bounded corrections remain; `rework` means the contract or architecture is materially unsound. Both non-approving verdicts set `changes-requested` and must identify the next owner/action.

`merge` is a deprecated alias for `approve` — it will still validate with a deprecation warning, but new reviews must use `approve`.

The sections defined above are enforced at the implementation stage. The simplicity axis reports only observable artifact or change surface. Do not claim counterfactual savings without a controlled baseline.
