---
name: codebase-wiki
description: (codepatrol) Generate or refresh docs/wiki as an OKF v0.1 bundle using graph evidence and Codepatrol's transactional wiki commands.
---

# Codebase Wiki

Maintain `docs/wiki/` as a portable Open Knowledge Format v0.1 bundle. Agents synthesize knowledge; the [Codepatrol CLI](../_shared/CODEPATROL-CLI.md) owns validation, source hashes, staging, rollback, and the freshness manifest at `.codepatrol/runtime/wiki/manifest.json`.

The coordinator owns graph sync, the final JSON payload, and the only wiki write. Workers are read-only and follow [EXECUTION.md](../_shared/EXECUTION.md). Record the graph revision, updated concepts, warnings and safe next action in the invoking [Stage Session](../_shared/SESSION.md) without copying page content.

## Process

### 1. Determine the update mode

Run:

```bash
codepatrol wiki status --workspace "$PWD" --format json
```

- Wiki absent, `rewriteRequired: true`, or incompatible manifest: use the graph-backed full generation path described below. It rewrites the complete bundle without reusing old wiki content or metadata.
- Valid compatible wiki: use `mode: "incremental"`; update stale concepts, add uncovered concepts, and remove only concepts proven obsolete.
- Nothing stale or uncovered: report that the wiki is current and stop.

If the graph is absent or source code changed, the coordinator runs one graph sync before exploration. Read a project brief from `docs/wiki-brief.md` when present. Legacy material under `docs/wiki/` may reveal which external canonical sources to consult, but its prose, paths, and metadata are never inputs to a rewrite.

For the standard clean-workspace or full-rewrite path, run:

```bash
codepatrol graph sync --workspace "$PWD" --format json
codepatrol wiki generate --workspace "$PWD" --format json
codepatrol wiki validate --workspace "$PWD" --format json
```

`wiki generate` groups files by graph cluster and commits architecture/module concepts with entry points, interfaces, cross-module dependencies, tests, and workspace `path:line` citations through the recoverable wiki transaction. Use the synthesis process below only when project-specific knowledge or an incremental refresh must refine that deterministic baseline.

### 2. Choose concepts

Use graph overview clusters as candidates, then verify boundaries by reading. Small repositories may need only `architecture.md`; larger ones add `modules/<slug>.md` concepts covering cohesive modules rather than individual files.

Every concept uses [PAGE-FORMAT.md](PAGE-FORMAT.md), lists its source paths in the record payload, and backs structural claims with CLI graph results plus verified `path:line` reads.

### 3. Synthesize independently

Define one read-only unit per concept. Each unit receives its source-file scope, the page format, relevant project brief, and the fact that the graph is already synced. Its output is:

- complete concept Markdown;
- exact `sources` array;
- verified evidence and uncertainties;
- suggested cross-links.

Delegate independent units in parallel when the harness supports it; otherwise run them sequentially. At the barrier, the coordinator verifies citations, resolves contradictions, fixes cross-links, and writes the root `index.md` last. Workers never call graph sync or write wiki files.

### 4. Commit transactionally

Build one JSON payload:

```json
{
  "version": 1,
  "mode": "rewrite",
  "files": [
    { "path": "index.md", "content": "---\nokf_version: \"0.1\"\n---\n\n# Project wiki\n\n- [Architecture](architecture.md) - System map.\n" },
    { "path": "architecture.md", "content": "---\ntype: Software Architecture\ntitle: Architecture\ndescription: System modules and their relationships.\n---\n\n# Architecture\n", "sources": ["src/main.ts"] }
  ],
  "remove": [],
  "updateAgentsPointer": true
}
```

Use `mode: "incremental"` for a compatible bundle. Include only changed files plus `remove` entries; unchanged concepts and unknown frontmatter fields remain untouched. Concept files must provide `sources`, even when empty. Reserved `index.md` and `log.md` do not.

Save the payload to a temporary result file or pipe it through stdin, then run:

```bash
codepatrol wiki record --input result.json --workspace "$PWD" --format json
codepatrol wiki validate --workspace "$PWD" --format json
```

Report written/removed paths and every warning. A validation failure leaves the previous bundle and manifest intact.

## Review relationship

A fresh wiki is the map for architecture review. Documentation friction is evidence: if one concept cannot be explained without describing several unrelated modules, carry that coupling into the review candidate list. After implementation, refresh affected concepts only after graph sync.
