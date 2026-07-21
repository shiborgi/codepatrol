# Portable artifact handoff

The artifact package is the stable interface between proposal, review, and implementation. It is committed with the target project and must be sufficient for a capable harness that has no access to the producing conversation or its private state.

Operational memory under `.codepatrol/workflows/` helps one harness resume. It is not the handoff source of truth and may be absent in another checkout or session. A receiving harness rebuilds its executable workflow from the approved plan when necessary.

## Canonical layout

```text
docs/codepatrol/<work-id>/
├── handoff.yaml
├── spec.md
├── plan.md
├── review.md             # created by codepatrol-review
├── implementation.md     # created by codepatrol-apply
├── verification.md       # created by codepatrol-verify
└── evidence/             # optional, only durable evidence used by the spec
```

Use `<YYYY-MM-DD>-<slug>` as the work id and append `-2`, `-3`, and so on on collision. One directory represents one independently reviewable change. Do not put unrelated candidates into one implementation package.

`codepatrol-plan` normalizes the selected change into the same `spec.md` and `plan.md` contract. Analysis is recorded by the internal artifact `origin` and optional evidence, never by making review or implementation parse different formats.

The producer also records one simplicity decision in `spec.md`: the earliest sufficient solution rung, rejected earlier rungs, retained safety floor, expected surface delta, and any deliberate constraint with a known ceiling, observable trigger, and upgrade path. `plan.md` preserves that choice task by task. Review may correct it through the normal revision protocol; implementation records actual surface delta in `implementation.md`. This is package evidence, not a provider-specific comment or a second debt store.

## Manifest v1

The producer creates this minimum manifest and then runs `artifact record`:

```yaml
schema_version: 1
work_id: 2026-07-18-bounded-cache
origin:
  skill: propose-codebase
  mode: feature
workflow_id: cpw-optional-local-memory-id
status: ready-for-review
revision: 1
artifacts:
  spec:
    path: spec.md
  plan:
    path: plan.md
  evidence:
    - path: evidence/reference-concepts.md
implementation:
  base_ref: 0123456789abcdef
  target: current-checkout
```

Valid origins are `propose-codebase` with mode `project` or `feature`, and `improve-codebase` with mode `architecture` or `bug`. `implementation.base_ref` records the project revision used to write the package when Git exists; `unborn` or an explanatory value is acceptable for greenfield work. Dirty baseline facts belong in `spec.md`.

`artifact record` validates containment and writes a SHA-256 beside every declared file. It never chooses a status, verdict, or revision. `artifact validate --stage plan` checks deterministic `spec.md` and `plan.md` format rules without adding a lifecycle status requirement. `artifact validate --stage review` proves a producer handoff is structurally sound and unchanged. `artifact validate --stage implementation` additionally requires a current approval.

After review, the manifest includes:

```yaml
status: approved
revision: 2
artifacts:
  spec: { path: spec.md, sha256: <digest> }
  plan: { path: plan.md, sha256: <digest> }
  review: { path: review.md, sha256: <digest> }
approval:
  verdict: approve
  reviewed_revision: 2
  reviewer: codex
  reviewed_at: 2026-07-18T12:00:00Z
```

After delivery verification, the manifest additionally includes:

```yaml
status: verified
artifacts:
  verification: { path: verification.md, sha256: <digest> }
verification:
  verdict: commit
  verified_revision: 2
  verifier: claude
  verified_at: 2026-07-19T18:00:00Z
```

A `verified` status requires a `verification` block whose verdict is `commit` and whose `verified_revision` equals the current `revision`. `artifact validate --stage verification` proves an implemented package still carries an intact approval for its current revision before any verdict is recorded.

The revision identifies the governing spec, plan, and producer evidence. Increment it whenever review changes one of those inputs. Creating `review.md` or appending execution facts to `implementation.md` does not by itself change the governing revision. An approval is usable only when its `reviewed_revision` equals the current `revision` and its verdict is `approve` (or its deprecated alias `merge`).

### Step provenance

An optional `steps` block records the provenance of each sealing step without changing the manifest schema version:

```yaml
steps:
  plan:   { harness: claude, model: claude-fable-5, completed_at: 2026-07-20T18:00:00Z }
  review: { harness: pi, model: minimax-m3, completed_at: 2026-07-20T19:00:00Z }
  apply:  { harness: codex, model: gpt-5.4, completed_at: 2026-07-20T21:00:00Z }
  verify: { harness: claude, model: claude-fable-5, completed_at: 2026-07-20T22:00:00Z }
```

The plan, review, apply, and verify primary skills stamp their own `steps.<step>` entry when sealing their stage, then run `artifact record`. `harness` and `completed_at` are required; `model` is optional when the harness does not expose it. A rerun overwrites only its own key. The block is optional, so legacy manifests remain valid.

## Lifecycle

```text
draft → ready-for-review → approved → implementing → implemented → verified
              ↘ changes-requested (from review or contract-defect verification failure) ↗
              ↘ blocked

implemented ── improve(implementation-defect) ──▶ implementing ──▶ Apply ──▶ Verify
implemented ── improve(contract-defect or mixed) ──▶ changes-requested ──▶ Plan
```

- `draft`: producer is still resolving the spec or plan.
- `ready-for-review`: producer recorded and validated a complete package.
- `changes-requested`: review found unresolved corrections, implementation discovered proposal drift, or verification found a contract defect. The package returns to Plan.
- `approved`: `review.md` accepts the current revision with verdict `approve`.
- `implementing`: approved work has started and may be resumed. A verification `improve` verdict classified entirely as `implementation-defect` also returns here; approval remains intact and `codepatrol-apply` resumes from the recorded findings.
- `blocked`: implementation cannot progress without an environmental or external change; approval remains intact.
- `implemented`: every accepted outcome has passing evidence in `implementation.md` and the package awaits delivery verification.
- `verified`: `codepatrol-verify` independently re-confirmed the implementation and recorded verdict `commit`. A blocking finding is classified as `implementation-defect` when delivered code or tests diverge from the still-correct approved contract, or as `contract-defect` when the spec, plan, or evidence is wrong or incomplete. All findings must be implementation defects for the shorter Apply route; any contract defect, including a mixed set, uses the stricter Plan route.

## Transitions, isolation, and contesting

- Each primary writes only the artifact it owns and the manifest metadata permitted at its sealing gate. It does not rewrite another step's artifact or silently replace another step's verdict.
- A rejected step's owner may accept the findings and perform the permitted correction route, or contest them with evidence recorded in its own artifact. A contest returns to the same gate for a fresh verdict; it never silently overrides the rejection.
- `codepatrol-verify` records the classification of every blocking finding in `verification.md`. Implementation-only findings set status `implementing` with next owner `codepatrol-apply`; contract or mixed findings set status `changes-requested` with next owner `codepatrol-plan`.

## Ownership rules

- Producers may write only their package and explicitly agreed design documents; they never edit production code.
- Handoff review may edit `spec.md` and `plan.md`, but records every adjustment in `review.md`, increments the revision, re-records hashes, and reviews the resulting content. It never edits production code.
- Implementation treats approved `spec.md`, `plan.md`, producer evidence, and `review.md` as immutable. Execution state and deviations go in `implementation.md` and operational workflow memory.
- A semantic plan/spec correction returns the package to `changes-requested`; implementation does not silently redesign it.
- Verification writes only `verification.md` and the manifest's verification metadata. It never edits production code, approved artifacts, or `implementation.md`.

## Command sequence

After writing a draft package, the producer records its hashes and runs the deterministic plan check before sealing:

```bash
codepatrol artifact record --manifest docs/codepatrol/<work-id>/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage plan --workspace "$PWD" --format json
```

After setting `ready-for-review` and recording hashes, the producer validates the review handoff:

```bash
codepatrol artifact record --manifest docs/codepatrol/<work-id>/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage review --workspace "$PWD" --format json
```

Reviewer first validates the incoming package, then records its review and runs either review validation for `changes-requested` or implementation validation for `approved`.

Implementer begins every new or resumed session with:

```bash
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage implementation --workspace "$PWD" --format json
```

Verifier begins with:

```bash
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage verification --workspace "$PWD" --format json
```

Hash mismatch, missing approval, stale review revision, material baseline drift, or an unresolved decision is a stop condition, not permission to infer the missing contract.
