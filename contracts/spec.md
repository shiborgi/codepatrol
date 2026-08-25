# Spec

Produce one independent option for an Init. Submit a strict JSON document with
`title`, `intent`, and one or more keyed Waves. Every Wave contains keyed Works;
every Work contains a description, at least one acceptance statement, and Work
keys in `blockedBy`. CodePatrol assigns durable IDs after Spec Review.

The harness loads resolved catalog instructions as the system prompt under the
common Agent Catalog contract.
Open one or more independent options with `--agents reference@version,...`, or use
the configured `agentCatalog.defaults.spec` selection when `--agents` is omitted.
