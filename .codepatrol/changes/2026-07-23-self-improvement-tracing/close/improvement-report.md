# Improvement report

## Summary
Change `2026-07-23-self-improvement-tracing` recorded 41 trace entries, 0 stage returns, and 2 unique error codes.

## Per-stage attempts
| Stage | Attempts | Returns | Checkpoints |
|---|---|---|---|
| plan | 1 | 0 | 1 |
| review | 1 | 0 | 1 |
| apply | 1 | 0 | 1 |
| verify | 1 | 0 | 1 |
| close | 1 | 0 | 0 |

## Returns
None.

## Top errors
| Code | Count | Sample message |
|---|---|---|
| CHANGE_CONFLICT | 6 | Checkpoint has undeclared worktree paths: gitignore. |
| INVALID_WORKSPACE | 1 | Path must be workspace-relative: /tmp/apply-checkpoint.json |

## Elapsed per stage
| Stage | Elapsed (ms) |
|---|---|
| plan | 633883 |
| review | 37688 |
| apply | 1834820 |
| verify | 114638 |
| close | 12418 |

## Artifact stats
- Files: 7
- Total bytes: 85243

## Recommendations
- Top error code: CHANGE_CONFLICT (6). Investigate the first occurrence's args and stage context.
- Command "change.transition" was invoked 13 times — consider caching or batching repeated invocations.
