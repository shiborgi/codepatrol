# Contributing

CodePatrol is TypeScript for Node.js 22. Install with `npm ci`.

```bash
npm run verify
npm run release-check
```

`verify` runs type checking, Biome, unit/integration tests, the full multi-option
golden path, and CLI loading. `release-check` packs and installs the npm artifact,
then runs the same end-to-end flow through the installed binary.

Changes must preserve task recovery, immutable candidate identity, typed failure
boundaries, explicit Ship authority, and cleanup of every managed branch/worktree.
Do not add compatibility code for pre-1.0 state or couple core lifecycle code to a
specific agent or context provider.
