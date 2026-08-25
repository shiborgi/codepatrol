# Patrol Family

CodePatrol, ContextPatrol, and AgentPatrol are independent npm packages. No
runtime or package dependency among the three products is allowed. Each product
is separately installable and useful on its own.

Complementarity is optional and out-of-process. When configured, the complete
`argv` is invoked directly without a shell and without appended arguments. There
is no sibling discovery, network lookup, or knowledge of another product's
storage layout. Typed resolver failures do not fall back.

## Advisory Authority

Agent catalog instructions are an immutable snapshot. They do not extend or
override task `input`, `resultContract`, submitted result schemas, verification,
review, or Ship gates.

Context provider reports are immutable snapshots. A report does not change task
inputs, result contracts, verification, review selection, or Ship authority.

Neither integration is required to run CodePatrol.

## Shared CLI

- Success writes one JSON object to stdout.
- Failures write one JSON object `{error,message}` to stderr and nothing to
  stdout.
- Exit codes are `0` success, `1` workflow or internal failure, and `2` usage,
  configuration, or contract failure.
- `--help` and `--version` succeed with plain text.
- `--verbose` and `--quiet` are optional, mutually exclusive globals. Verbose
  writes `[product] level: message` lines to `process.stderr` and must not
  change stdout.

## Digests

Digests use `sha256:` followed by 64 lowercase hexadecimal characters over
sorted-key canonical JSON.

## Repository Quality Bar

Each product independently implements:

- `npm run verify` for the quality gate and `npm run release-check` for the
  release gate
- `.github/workflows/verify.yml` with `ubuntu-latest` and `macos-latest` verify
  plus a separate `release-check` job on Node 22
- `CHANGELOG.md`, Contributor Covenant 2.1 `CODE_OF_CONDUCT.md`,
  `CONTRIBUTING.md`, `SECURITY.md`
- GitHub issue and pull-request templates
- `package.json` `repository`, `homepage`, and `bugs`
- English documentation, comments, contracts, and generated GitHub artifacts

Language choice stays product-specific. CodePatrol and ContextPatrol use
TypeScript and Biome. AgentPatrol must remain free of runtime dependencies and
uses dependency-free Node ESM.
