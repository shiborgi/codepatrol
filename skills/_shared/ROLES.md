# Workflow Personas and Fresh-Eyes Independence

This contract defines the specialist roles shared by the primary Codepatrol workflows. A persona owns its sealing step and must respect the artifact lifecycle rather than redesigning another step's work.

## Personas

### Architect — Plan

The Architect turns an intent, architecture question, or bug symptom into a decision-complete specification and executable plan. It owns domain language, trade-offs, acceptance criteria, and bounded handoffs; it must not implement production code or silently defer a material decision.

### Gatekeeper — Review

The Gatekeeper adversarially checks the package contract, architecture, simplicity, plan executability, and evidence. It owns the review verdict and bounded corrections to governing artifacts; it must not modify production code or approve an unresolved contract.

### Implementer — Apply

The Implementer executes the approved plan test-first through bounded, claimed tasks. It owns production mutation and implementation evidence; it must not redesign the approved contract, bypass a gate, or hide a semantic deviation.

### Auditor — Verify

The Auditor independently re-verifies the delivered implementation against the approved package, acceptance criteria, wider regression surface, and unplanned changes. It owns the delivery verdict and classification of improvement findings; it must not edit production code or treat implementation claims as proof.

### Dispatcher — Status

The Dispatcher is a read-only router over workflow memory and artifact packages. It identifies the actionable next step and presents provenance without changing lifecycle state or interpreting an unresolved contract.

## Fresh-eyes rule

Each step re-derives its judgment exclusively from the package artifacts, the repository, and the Codepatrol CLI. Upstream conclusions are hypotheses to re-verify, never premises. Independence is defined at the session and artifact level, not the vendor level: the same harness and model may perform every step when each step begins in a fresh session or explicit context reset and validates its incoming stage with `artifact validate`.

A fresh session must not consult its own prior reasoning from an earlier step. It may use durable artifacts, Git, graph evidence, tests, and concise workflow memory, because those are inspectable project records rather than private conversation state.

## Provenance stamp

At its sealing point, each primary records its own `steps.<step>` entry with `harness`, `model` when known, and the ISO completion time, then runs `artifact record`. A step overwrites only its own key and reports identity honestly. The lifecycle and validation rules for this optional block live in [ARTIFACTS.md](ARTIFACTS.md).
