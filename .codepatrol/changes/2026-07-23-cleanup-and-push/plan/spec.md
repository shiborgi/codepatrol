# Specification — Minor improvements, token count logic, actor tracking, and legacy cleanup

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main
- Governing constraints: None
- Substrate state: absent
- Problem: Token metrics are based on LLM API output rather than characters. The actor field in metrics does not log the model/harness context. A legacy test block for the old `workflow prime` command remains in the suite. 
- Outcome: Token fields are renamed to `characters` to hold exact string lengths; the Pi runtime metric injector logs `actor` with harness and model metadata; legacy `workflow` test code is removed.

## Scope

### In scope

- Modify `sumPiUsage` in `.pi/index.ts` to calculate input and output characters based on message string length rather than API `totalTokens`, while retaining the reading of `message.model` for metadata.
- Modify `codepatrol_record_run` to inject the harness and model into the `actor` field.
- Rename `tokens` to `characters` in `RunUsage` and `UsageSummary`. Rename `TokenUsage` to `CharacterUsage` in `src/change/types.ts`.
- Update YAML fixtures and `board.ts` / tests to use the new `characters` property.
- Update `recordFromYaml` in `src/change/orchestrator.ts` to safely map legacy `tokens` keys to `characters` for backward compatibility.
- Remove the legacy `workflow prime` CLI test assertions in `src/cli/cli.test.ts`.

### Out of scope

- Automatic git push on close is out of scope (violates `AGENTS.md` remote-operations rule and `codepatrol-close` SKILL.md never-fetch/push rule).

## Current evidence

- `.pi/index.ts` relies on `.usage` object which we will replace for metrics but retain for `model` scraping.
- `src/change/types.ts` uses `tokens`. `src/change/board.ts` reads `usage.tokens.*`.
- `src/change/fixtures/*.yaml` hardcode `tokens:` keys.
- `src/cli/cli.test.ts` line 39 tests a legacy `workflow` command.

## Proposed design

1. **Token tracking rename and logic**: In `.pi/index.ts`, `sumPiUsage` will measure string character lengths of `message.content` instead of pulling `.usage` (except for extracting `message.model`). In `types.ts` and `usage.ts`, rename `TokenUsage` to `CharacterUsage`, and `tokens` to `characters`. Update `board.ts` to reflect these renames.
2. **Actor metadata**: Update the `actor` payload in the Pi extension's intent creation to format as `pi (${active.usage.model || 'unknown'})`.
3. **YAML Migration**: Update `src/change/orchestrator.ts` inside the `recordFromYaml` function to rewrite `.tokens` to `.characters` on loaded events to ensure old records don't crash the orchestrator. Update all static fixtures in `src/change/fixtures/`.
4. **Legacy cleanup**: Delete the `workflow` test block in `cli.test.ts`.

## Alternatives

- User suggested changing `AGENTS.md` to permit pushes: Rejected because `AGENTS.md` acts as the safety floor for remote state hermeticity; local tool-only rules govern all changes.
- User suggested approximating tokens via `Math.ceil(chars / 4)`: Rejected because it stores inaccurate data under the existing `tokens` field name, which creates semantic confusion compared to simply renaming the field to `characters` and storing the exact count.

## Simplicity decision

- Selected rung: direct local change
- Earlier rungs: N/A, we are modifying local behaviors directly.
- Irreducible complexity: Typescript type adjustments across the pipeline and providing backward compatibility for old YAMLs.
- Safety floor: Metric collection must not crash if messages lack text content; old workspaces must still load.
- Expected surface delta: ~10 files modified (`types.ts`, `usage.ts`, `board.ts`, `orchestrator.ts`, `.pi/index.ts`, `cli.test.ts`, tests, fixtures).

## Deferred constraints

None — No deferred constraints.

## Compatibility and rollout

- Metric records will shift from `tokens` to `characters` fields. `recordFromYaml` will automatically map legacy `tokens` objects to `characters` during read.

## Risks and mitigations

- Older change YAMLs might fail to parse. Mitigation: A robust mapping logic in `recordFromYaml` will translate legacy formats on-the-fly.

## Acceptance criteria

- AC-1: Step metric counting uses string lengths of inputs/outputs, the metric field is renamed to `characters`, and older YAML records still parse correctly.
- AC-2: The actor field injected for runs includes the harness and model (e.g. `pi (model-name)`).
- AC-3: The legacy `workflow` command test code is successfully removed from `src/cli/cli.test.ts`.

## Decisions and open questions

None.
