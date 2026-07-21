# Plan format

Write the approved implementation instructions to `.codepatrol/packages/<work-id>/plan.md`. It implements the adjacent `spec.md` and must be usable without conversation history. Execution state belongs in `implementation.md`, so implementation never changes this file.

## Header and coverage

```markdown
# Plan — <name>

- Work id: `<work-id>`
- Governing spec: `spec.md`
- Target baseline: <same baseline as spec>

## Goal and approach

<Goal plus the chosen architecture in enough detail to orient every task.>

## Global constraints

<Project requirements, version floors, naming, compatibility, security,
performance, accessibility, operability, and forbidden scope that apply to all tasks.>

## Simplicity proof

- Selected rung: <the approved spec decision>
- Reused capabilities: <existing module, runtime, platform, or dependency>
- Forbidden speculative surface: <options, abstractions, dependencies, or configuration with no current criterion>
- Expected surface delta: <files, dependencies, public interfaces, configuration, and runtime state>

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T3 | `<exact command or inspection>` |

## Dependency order

`T1 → T2`; `T3` is independent of `T2` and owns different files.
```

## Plan-stage content check

Before sealing a producer handoff, run `codepatrol artifact validate --stage plan`. The checker parses the prescribed `### T<id> — ` task headings, `Depends on:` clauses, and backticked `Create:`/`Modify:`/`Delete:` file markers. Keep those markers exact when the rule should be enforced; unclassified lines are ignored conservatively. Placeholder names inside fenced code blocks and inline code spans are exempt from the placeholder scan so the format may document the tokens without failing itself. The gate enforces structural format rules only and does not replace semantic review.

## Task structure

````markdown
### T3 — Note store

**Purpose:** Satisfies AC-1 by persisting and listing notes.

**Depends on:** T2

**Files:**

- Create: `src/store/note-store.ts`
- Create: `src/store/note-store.test.ts`
- Modify: `src/cli.ts` — command registration

**Interfaces:**

- Consumes: `parseNote(raw: string): Note` from T2
- Produces: `class NoteStore { add(note: Note): void; list(): Note[] }`
- Invariants/errors: insertion order is stable; invalid notes fail before storage

**Simplicity proof:** Reuse the existing `Note` parser and CLI registration seam;
new storage is required because no earlier ladder rung persists AC-1.

**Surface delta:** +2 files; one existing registration changes; no dependency,
public configuration, or external runtime state is added.

**Steps:**

1. Add the test below at the public store seam.

   ```typescript
   test("add then list returns the note", () => {
     const store = new NoteStore();
     store.add({ id: "1", body: "hi" });
     assert.deepEqual(store.list(), [{ id: "1", body: "hi" }]);
   });
   ```

2. Run `node --test src/store/note-store.test.ts`.
   Expected red: `NoteStore` is missing; a setup or syntax failure is not accepted.
3. Implement the smallest store satisfying the declared interface and invariant.
4. Run `node --test src/store/note-store.test.ts`.
   Expected green: the new test passes.
5. Run `<graph-identified affected checks>` and then `<broader gate>`.
   Expected: all pass with no new warnings.

**Task result:** changed paths, red/green evidence, deviations, and assessment are appended to `implementation.md`.
````

## Final tasks

End with explicit migration/rollout and documentation tasks when applicable, then a final verification task that:

- maps delivered paths and checks back to every `AC-N`;
- runs the complete relevant test/type/lint/build/security/performance/accessibility gate;
- inspects the final diff for undeclared work;
- reconciles actual surface delta with the spec forecast and explains every difference;
- records whether a `DC-N` trigger was activated and follows its approved upgrade path if so;
- syncs the graph and refreshes affected wiki/domain artifacts;
- states rollback and residual-risk checks.

## Rules

- Exact create/modify/delete paths and public interface names are mandatory. Use line locations only when stable enough to help.
- Tasks include enough pseudocode or complete snippets to remove architectural guessing, but may leave local syntax to the implementer when existing patterns are cited precisely.
- Every command has an expected signal, including what a valid red failure looks like.
- Dependencies and file ownership make concurrency safe; two independent tasks never write the same file or module.
- Every acceptance criterion is covered; every task points back to purpose and scope.
- Every task justifies new owned surface against the selected sufficiency rung and names reusable capabilities first.
- No placeholders, mutable checkboxes, execution results, or unconditional commit commands appear in the approved plan.
