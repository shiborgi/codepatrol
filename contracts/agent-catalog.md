# Agent Catalog

Task envelopes may contain top-level `agentInstructions` when an exact catalog
agent was resolved before task creation. The harness must load these instructions
as the system prompt for that task execution. The task source then contains `agent`,
`agentVersion`, `agentDigest`, and `agentInstructionsDigest`. These instructions
are an immutable snapshot. They do not extend or override task `input`,
`resultContract`, submitted result schemas, verification, review, or Ship gates.

Proposals copy source identity and digests for provenance but do not duplicate full
instructions. Producer Open accepts `--agents reference@version,...`; every explicit
entry is resolved before context retrieval or state mutation, then one envelope is
returned per task under `{ "tasks": [...] }`. If `--agents` is omitted, the matching
`agentCatalog.defaults.spec`, `.plan`, or `.build` selection is used. With no explicit
selection or matching default, Producer Open remains a usage error. Reviews and Ship
resolve their single configured default only. Task Show, Submit, and Retry never
resolve again.
