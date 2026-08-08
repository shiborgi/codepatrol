# Capabilities and execution composition

CodePatrol records the execution composition that the harness **declares** at
attempt start. It cannot prove what the harness actually loaded at runtime.

## Declared vs. proven

CodePatrol trusts the harness declaration. The recorded composition fields
(`profile`, `capabilities`, `compositionDigest`) are populated by the CLI
from local repository files. The harness itself is responsible for loading
the declared capabilities. CodePatrol records **what was declared**, not
**what was loaded**.

## Loading contract

A method invoked with `--profile <name>` follows this order. The harness
templates for OpenCode, Pi and Claude Code all state it, and a structural test
asserts they do.

```
resolve profile
    ↓
record profile + capabilities + compositionDigest on the attempt
    ↓
load the primary method SKILL.md
    ↓
load the SKILL.md of each capability declared for THIS method
    ↓
execute the method contract
```

Four rules govern it:

1. The primary method contract is mandatory and **prevails** over any
   capability instruction.
2. Capabilities are auxiliary. They sharpen observation, reasoning and
   reporting; they never replace the method.
3. Only the capabilities of the current method are loaded. A capability
   assigned to Plan is never loaded by Review.
4. On conflict, the method wins, and the conflict is reported rather than
   silently resolved.

## Content policy

A capability is exactly two files:

```
skills/capabilities/<id>/
├── capability.json
└── SKILL.md
```

No scripts directory, no references directory, no MCP servers, no downloads, no external
dependencies. A test asserts every catalogued capability carries only those
two files.

## Writing convention

Every auxiliary `SKILL.md` declares, in this order:

- **Purpose** — the failure it prevents.
- **Applicable methods** — which primary methods may load it.
- **Observable inputs** — what counts as an observation; nothing else does.
- **Procedure** — the steps, in order.
- **Evidence format** — the exact shape of what it reports.
- **Limits and prohibitions** — what it must never do.
- **When evidence is insufficient** — how to say so instead of guessing.

Each capability also references `skills/capabilities/CONSTITUTION.md`, whose
clauses bind it regardless of its own content.

## Profile resolution

When `--profile <name>` is given to a stage start or spec start command,
CodePatrol resolves the effective composition for the current method from
the repository:

1. Reads `skills/profiles/<name>.json` and validates the manifest
   (schemaVersion 1, id matches filename).
2. Takes only `profile.methods[<method>]` — each method has its own
   capability list. Capabilities assigned only to Plan do not appear in
   Review or other methods.
3. Rejects duplicate capability IDs within the method list.
4. Reads `skills/catalog.json`. Rejects capability IDs not found in the
   catalog.
5. For each capability, reads `skills/capabilities/<id>/capability.json`
   and validates the manifest (schemaVersion 1, id matches directory name,
   version is a positive integer). The `version` field comes from the
   manifest, not hardcoded.
6. Capability content digest = `SHA-256(canonicalJson({ manifest, instructions }))`
   where `manifest` is the normalized capability.json content (parsed then
   canonicalized) and `instructions` is the raw text of
   `skills/capabilities/<id>/SKILL.md` (absent SKILL.md is empty string).
7. Capabilities are sorted canonically by id.
8. `compositionDigest = SHA-256(canonicalJson({ profile, method, capabilities }))`.

Empty capability lists produce a stable non-null digest.

## Consistency requirement

Composition fields (`profile`, `capabilities`, `compositionDigest`) must
be **all present or all absent**. Partial composition is refused as
`STATE_CORRUPT`. This is enforced by both execution parsers at read time.

## Resume contract

The composition is part of the resume contract. Resuming an active attempt
with a different profile, compositionDigest, or any change to the
capabilities array (id, version, digest) is refused. This prevents
accidental execution drift during resumed runs.

## Improve report time window

The `--since` flag passed to `codepatrol improve inspect` filters the
observation window:
- Attempts are included when `attempt.startedAt >= since`.
- Completions are counted when `completion.finalizedAt >= since`.
- Works are never dropped for old `createdAt` — a scoped work always appears
  in the report, regardless of creation time.

When `--since` is absent, the window is unbounded (lifetime = in-window).

## Evolution Review trigger

Evolution Review runs only when the operator explicitly requests it. Keywords
recognized by the Spec skill: "review the backlog," "evaluate the framework,"
"propose the next improvement," "run evolution review," "find the next
Initiative," "self-improvement analysis," "roadmap discovery." Evolution Review
is never triggered automatically or inferred from an Initiative description.
Normal Spec does not run Evolution Review.
