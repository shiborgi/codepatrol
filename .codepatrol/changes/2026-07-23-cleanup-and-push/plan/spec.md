# Specification — Minor improvements, push option, token count logic, and legacy cleanup

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main
- Governing constraints: None — internal refactoring and metric field renaming
- Substrate state: absent
- Problem: The step token counts currently rely on LLM API output which does not accurately represent the character counts used by the local harness. Also, a legacy test block for the old `workflow prime` command is still in `cli.test.ts`, causing confusion.
- Outcome: Token metrics are calculated by character length instead of API tokens, and all corresponding metric fields in the typings are renamed from "tokens" to "characters" for semantic correctness. The legacy `workflow prime` leftover test is removed.

## Scope

### In scope

- Modify `sumPiUsage` in `.pi/index.ts` to calculate `input` and `output` characters based on message string length rather than API `totalTokens`.
- Rename `tokens` to `characters` in `RunUsage` and `UsageSummary`. Rename `TokenUsage` to `CharacterUsage` in `src/change/types.ts`.
- Remove the legacy `workflow prime` CLI test assertions in `src/cli/cli.test.ts`.

### Out of scope

- Automatic git push on close is out of scope (violates `AGENTS.md` remote-operations rule and `codepatrol-close` SKILL.md never-fetch/push rule).

## Current evidence

- `.pi/index.ts` calculates `sumPiUsage` using `message.usage.input` and `message.usage.output`.
- `src/change/types.ts` defines `TokenUsage` and uses a `tokens` field in `RunUsage` and `UsageSummary`.
- `src/cli/cli.test.ts` line 39 contains `run(["workflow", "prime", ...])` which tests a legacy naming scheme.

## Proposed design

1. **Token tracking rename and logic**: In `.pi/index.ts`, `sumPiUsage` will measure string character lengths of `message.content` instead of pulling `.usage`. In `src/change/types.ts` and `src/change/usage.ts`, rename `TokenUsage` to `CharacterUsage`, and rename the `tokens` property inside `RunUsage` and `UsageSummary` to `characters`. Update `usage.ts` logic to operate on the `characters` field.
2. **Legacy cleanup**: Delete the block in `src/cli/cli.test.ts` testing the `workflow` command.

## Alternatives

- Retaining the name `tokens` while counting characters: Rejected because it's semantically misleading (Review defect 4).
- Keeping `workflow prime` test: Rejected because the command was renamed and this is dead test code.

## Simplicity decision

- Selected rung: direct local change
- Earlier rungs: N/A, we are modifying local behaviors directly.
- Irreducible complexity: Typescript type adjustments across the pipeline (`usage.ts`, `types.ts`, `orchestrator.ts` if affected, `.pi/index.ts`).
- Safety floor: Metric collection must not crash if messages lack text content.
- Expected surface delta: ~4 files modified (`types.ts`, `usage.ts`, `.pi/index.ts`, `cli.test.ts`).

## Deferred constraints

None — No deferred constraints.

## Compatibility and rollout

- Metric records will shift from `tokens` to `characters` fields. `codepatrol status` might need slight adjustments if it references `usage.tokens`.

## Risks and mitigations

- Older change YAMLs might have `tokens` instead of `characters`, causing parsers to fail. Mitigation: update YAML parser mapping or safely fallback.

## Acceptance criteria

- AC-1: Step metric counting uses string lengths of inputs/outputs instead of API return metrics, and the metric field is correctly renamed to `characters` in the type definitions and aggregations.
- AC-2: The legacy `workflow` command test code is successfully removed from `src/cli/cli.test.ts`.

## Decisions and open questions

None.
