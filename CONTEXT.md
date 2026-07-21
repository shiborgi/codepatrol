# Domain Glossary

**Public Workflow** — one of the four user-facing Codepatrol entry points that owns a complete lifecycle responsibility. The public workflows are Codepatrol Plan, Codepatrol Review, Codepatrol Apply, and Codepatrol Verify. _Avoid_: primary command, top-level skill.

**Codepatrol Plan** — the producer workflow that turns an intent (new project, feature, architecture scan, or bug symptom) into a decision-complete, reviewable change package. _Avoid_: propose-codebase, improve-codebase, generic scan.

**Codepatrol Review** — the gate workflow that assesses a change package or implemented change and returns exactly one auditable verdict. _Avoid_: review-codebase, approval command.

**Codepatrol Apply** — the execution workflow that may change production files only for the exact approved revision of a change package. _Avoid_: implement-codebase, unguarded apply.

**Approve** — the review verdict that accepts the current revision and sets status `approved`. _Avoid_: merge, accept, sign-off.

**Fix-first** — the review verdict meaning bounded corrections remain.

**Rework** — the review verdict meaning the contract, architecture, or verification strategy is materially unsound.

**Codepatrol Verify** — the delivery-gate workflow, invoked as `codepatrol-verify`, that independently re-verifies an implemented change package and records a commit or improve verdict. _Avoid_: verify-codebase, post-apply review.

**Support Skill** — a reusable bounded capability invoked behind a Public Workflow; it is not an additional product entry point. _Avoid_: internal command.

**Change Package** — the versioned `.codepatrol/packages/<work-id>/` handoff containing the governing specification, plan, review, implementation journal, and durable evidence for one independently reviewable change. _Avoid_: artifact bundle, proposal folder.

**Operational Memory** — resumable local workflow state under `.codepatrol/workflows/`; it may be reconstructed and never replaces a Change Package. _Avoid_: progress file, source of truth.

**Artifact Producer Origin** — the schema-v1 provenance value stored in a Change Package to distinguish project/feature production from architecture/bug production. The retained values are internal data, not Public Workflow identifiers. _Avoid_: command name, invocation alias.

**Distribution Adapter** — a harness-specific install or presentation layer over the canonical skills and CLI. Only two exist: the filesystem installer (`scripts/install-local.mjs`, which links the agnostic `skills/` tree into each harness's discovery directory) and the Pi native extension (`.pi/`). Harness-specific source, when it exists, lives in a root dotfolder named for the harness (`.pi/`, `.claude/`, `.codex/`, `.opencode/`). An adapter owns no workflow semantics. _Avoid_: separate implementation, marketplace plugin.
