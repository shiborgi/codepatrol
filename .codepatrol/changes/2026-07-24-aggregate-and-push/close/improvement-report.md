# Improvement report

## Summary
Change `2026-07-24-aggregate-and-push` recorded 224 trace entries, 2 stage returns, and 4 unique error codes.

## Per-stage attempts
| Stage | Attempts | Returns | Checkpoints |
|---|---|---|---|
| plan | 1 | 0 | 1 |
| review | 1 | 0 | 1 |
| apply | 3 | 0 | 3 |
| verify | 3 | 2 | 3 |
| close | 1 | 0 | 0 |

## Returns
| Stage | Attempt | Reason | At |
|---|---|---|---|
| verify | 1 | Verify found two critical, independently-reproduced defects: (1) no CONSOLIDATION_AFTER_SUBEVENTS guard - a stray no-persona checkpoint silently overrides an already-recorded persona fix-first return and advances the stage to apply with result approve, defeating the Change's core safety premise (spec.md risk 1, plan.md T3); (2) npm run verify fails - scripts/skills-contract.test.mjs:43 regression because T10 dropped the word push from the Never fetch, push, rebase, force phrase in skills/codepatrol-close/SKILL.md; apply/journal.md falsely claims all 144 tests passed. Also a minor doc/implementation ordering mismatch in AGENTS.md push-at-close section. Full evidence in verify/report.md. | 2026-07-24T11:57:23.789Z |
| verify | 2 | Attempt 2 correctly fixed the two critical findings from Verify attempt 1 in substance: the CONSOLIDATION_AFTER_SUBEVENTS guard genuinely rejects a stray no-persona checkpoint after a persona fix-first, and the skills-contract.test.mjs regression plus the AGENTS.md push-ordering note are both correctly reconciled. npm test now passes 144/144 for the first time in this Change. But the fix was never typechecked: CONSOLIDATION_AFTER_SUBEVENTS is not a member of the ErrorCode union in src/shared/errors.ts, and src/change/orchestrator-parallel.test.ts:80 references CodepatrolError in a type position without importing it. npm run typecheck and npm run build both fail (exit 2) as a direct result, so npm run verify - the exact command AC-4 requires - still does not pass, even though jiti's type-stripping lets npm test alone pass. This is a narrow two-line mechanical fix: add CONSOLIDATION_AFTER_SUBEVENTS to ErrorCode, and import CodepatrolError in the test file. Re-run npm run verify itself (not just npm test) to a clean exit before journaling success. Full evidence in verify/report.md. | 2026-07-24T12:37:10.597Z |

## Top errors
| Code | Count | Sample message |
|---|---|---|
| CHANGE_CONFLICT | 25 | Session item is not ready: T9. |
| INVALID_ARGUMENT | 10 | Session input is not valid JSON. |
| INVALID_WORKSPACE | 1 | Path does not exist in the workspace: {"action":"prime","stage":"apply","attempt":1} |
| CHANGE_INVALID | 1 | CHANGE_INVALID: Run is not for the current active attempt. |

## Elapsed per stage
| Stage | Elapsed (ms) |
|---|---|
| plan | 188153 |
| review | 129635 |
| apply | 9952499 |
| verify | 3328630 |
| close | 511795 |

## Artifact stats
- Files: 7
- Total bytes: 79758

## Recommendations
- Top error code: CHANGE_CONFLICT (25). Investigate the first occurrence's args and stage context.
- Command "change.session" was invoked 109 times — consider caching or batching repeated invocations.
