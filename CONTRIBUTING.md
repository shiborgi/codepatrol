# Contributing

CodePatrol v1 is strict TypeScript/ESM for Node.js 22.13+. Install with `npm ci`.

```bash
npm run verify
npm run release-check
```

`verify` runs type checking, Biome, a clean declaration build, tests, fixture CLI
smoke and help loading. `release-check` packs and installs the npm artifact in a
temporary directory, checks public exports and runs the installed binary through
all seven stages, real fixture verification and operator approval. CI uses Linux
and macOS; there is no dependency on sibling source trees or live model access.

For cross-package changes also run `npm run test:family` with v1 AgentPatrol,
ContextPatrol, MemoryPatrol, and ModelPatrol checkouts. It packs/installs the actual packages and tests the
default PATH integration, lifecycle gates and learning. This optional local gate
does not add runtime dependencies between the repos. The `family` workflow
accepts explicit provider refs for coordinated release acceptance; see
`docs/release.md`.

Read `AGENTS.md` and `docs/protocol.md` first. Keep changes small, modular and
v1-only. Providers own their catalogs/context algorithms; CodePatrol owns
schema validation, routing, execution boundaries, gates and local state.

Add isolated tests for new gates and failures. Fixture Git commits belong only in
temporary test repositories. Never run fixture executors against a real checkout
or claim they demonstrate model quality. Test executor rejection, objective
verification, malformed providers, writer conflicts and telemetry failure where
relevant. Preserve exact argv/no-shell behavior and no automatic write retries.

Keep README, architecture, security policy, schemas, tests and installed package
behavior consistent. The shared protocol is coordinated across all five packages.
Do not relax contracts to accommodate a provider bug. Never add fabricated usage,
task/source data to telemetry, automatic approval, publishing or pushing.
