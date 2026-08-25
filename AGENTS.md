# AGENTS

CodePatrol owns lifecycle contracts, state, Git candidates, review evidence, and
Ship. Harnesses execute tasks; they do not override schemas or gates.

## Workflow

```text
spec -> spec-review -> plan -> plan-review -> build -> build-review -> ship
```

- Multiple producer tasks may be opened in one Spec, Plan, or Build round.
- Complete, cancel, or fail every producer before opening Review.
- Review reports every proposal and explicitly selects the best passing option.
- Build changes are made only in the workspace returned by the task.
- Ship requires explicit operator confirmation.

## Gates

- Quality: `npm run verify`
- Release: `npm run release-check`

Never hand-edit CodePatrol refs. Keep documentation, code comments, contracts, and
generated GitHub artifacts in English.
