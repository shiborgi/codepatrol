# Coordinated v1.0.0 Release

All five packages start at 1.0.0 and require Patrol Protocol 1.0. AgentPatrol's
portable artifacts still target the independent Agent Plugins 1.0.0 format.
This source tree prepares the new release; running tests does not publish it.

## Local Acceptance

Use sibling checkouts named `codepatrol`, `agentpatrol`, `contextpatrol`,
`memorypatrol`, and `modelpatrol`. In
each checkout, run `npm ci`, `npm run verify`, and `npm run release-check`.
AgentPatrol's committed generated plugins must already match their authoring:
only use `npm run build` after an intentional content change, never to hide drift.

From CodePatrol run:

```bash
npm run test:family
```

For other layouts, set `AGENTPATROL_ROOT`, `CONTEXTPATROL_ROOT`,
`MEMORYPATROL_ROOT`, and `MODELPATROL_ROOT` to the provider
checkouts. No production code depends on these development-only variables.
The script packs all five projects, installs the tarballs together in a temporary
directory using the npm cache, and uses their installed public CLIs through PATH.
It neither imports sibling source modules nor uses fixture providers. Run `npm ci`
in each project first to populate the cache; no publication is required.

The only fake component is an explicitly labeled, deterministic executor. It
modifies temporary fixture repositories and creates fixture-only Git commits.
This is protocol/workflow validation, not a benchmark of model quality.

The acceptance suite verifies:

- Real portable skills and full-content catalog fingerprints.
- Persona eligibility and React/Python/MCP specialist composition.
- Local JS/TS/Python import edges and reverse impact.
- Fresh spec/plan/build evidence at reviewer boundaries.
- Seven-stage execution in a detached worktree without changing the original code.
- Objective verification, rejected reviews and explicit operator approval gates.
- Neutral reviewer learning, adaptive producer selection and private local telemetry.
- Telemetry opt-out and exclusion of retained execution state from future context.
- MemoryPatrol's installed recall/remember flow and exclusion from CodePatrol state.
- ModelPatrol's installed public gateway API and exact 1.0.0 artifact.

## CI And Publication

The `family` workflow is manually dispatchable and reusable by a release workflow.
Pass explicit v1 refs for all four sibling repositories; use immutable commit SHAs
for release evidence. Normal per-package CI remains independent of sibling repos.

After review, record the five source commits and package checksums, run all
per-package release gates and the family gate, then authorize publication of the
five exact 1.0.0 artifacts. This initial release is installed from immutable Git
SHAs; npm publication remains a separate future operator action. Release tags,
GitHub releases and publication are not side effects of CodePatrol approval.

## State

Use v1 configuration and `.codepatrol/v1` runs. Configure a trusted real executor
and an objective verification command before production execution; no model or
deployment adapter is installed implicitly.

Context extraction is bounded static analysis, not whole-program proof. Release
approval records consent but does not freeze, merge or publish worktree contents.
Review and protect the retained workspace before any external release action.
