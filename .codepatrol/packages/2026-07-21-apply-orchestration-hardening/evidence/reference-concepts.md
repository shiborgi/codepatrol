# Reference Concept Analysis — skill contracts, guardrails, tracing, and PR feedback

- **Target project:** Codepatrol v1 local, harness-agnostic workflow toolkit
- **Target problem:** Make Apply execution, skill triggering/order, and review feedback more reliable without introducing provider coupling.
- **Reference:** [Agent Skills specification at commit `38a2ff82958afee88dadf4831509e6f7e9d8ef4e`](https://github.com/agentskills/agentskills/tree/38a2ff82958afee88dadf4831509e6f7e9d8ef4e); [OpenAI Agents JS guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/); [OpenAI Agents JS tracing](https://openai.github.io/openai-agents-js/guides/tracing/); [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools); [Danger JS at commit `2c3b5a9e0c5cffa5fc0ef9f5ff59df719444b1cd`](https://github.com/danger/danger-js/tree/2c3b5a9e0c5cffa5fc0ef9f5ff59df719444b1cd); [reviewdog at commit `a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd`](https://github.com/reviewdog/reviewdog/tree/a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd)
- **Revision:** Agent Skills repository commit `38a2ff82958afee88dadf4831509e6f7e9d8ef4e`, Danger JS commit `2c3b5a9e0c5cffa5fc0ef9f5ff59df719444b1cd`, and reviewdog commit `a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd` were fetched on 2026-07-21; OpenAI Agents and MCP official documentation was consulted at the versioned MCP `2025-06-18` page and current official guides.
- **Consulted:** 2026-07-21
- **Scope:** Read format, guardrail/tracing boundaries, MCP tool contract/security notes, and PR feedback concepts. No external repository scripts, installers, or executables were run.

## Local constraints

Codepatrol's `README.md`, `AGENTS.md`, `skills/catalog.yaml`, and shared contracts define a local CLI, portable artifact packages, no MCP server, no scheduler, optional native delegation, and a mandatory sequential fallback. Public workflows own lifecycle stages and must stop for user authority. The repository currently has no `docs/wiki/` bundle, so wiki generation/freshness is a runtime state rather than a placeholder file requirement.

## Observed concepts

### Progressive disclosure and portable skill metadata

- **Facts:** The Agent Skills specification requires `SKILL.md` YAML frontmatter with `name` and `description`, allows optional compatibility/metadata/allowed-tools, recommends keeping instructions under 500 lines, and recommends moving detailed references to on-demand files.
- **Inference:** Codepatrol already follows the required minimal frontmatter and uses referenced format/contract files. Its catalog is a useful project-specific extension, but it should validate only fields that Codepatrol owns.
- **Reference problem:** Make skills discoverable and loadable across clients without forcing every client to load all detail.
- **Target fit:** Strong fit; Codepatrol is explicitly portable and already uses progressive references.
- **Decision:** `adopt`
- **Native adaptation:** Keep `SKILL.md` concise, retain relative references one level deep where practical, and add catalog lint checks for description length, name constraints, and stale command templates. Do not add `allowed-tools` because supported harnesses differ and no current policy requires it.
- **Trade-offs:** Better portability and earlier detection of malformed skills; more lint rules and possible false positives if the external spec changes.
- **Verification needed:** Contract tests for frontmatter constraints, relative resource existence, line/size budgets, and every public command template invoking the matching skill/path.

### Guardrails at workflow/tool seams

- **Facts:** OpenAI's Agents JS guide describes input/output/tool guardrails. Tool guardrails run on each function-tool invocation; input/output guardrails can block with a tripwire; non-parallel input guardrails can prevent model/tool execution before a costly action.
- **Inference:** The durable local equivalent is a precondition gate before Apply mutation and a post-task evidence gate after each claimed task. This does not require the SDK or an LLM.
- **Reference problem:** Prevent unsafe or invalid workflow/tool execution and halt promptly on contract violations.
- **Target fit:** Strong concept fit, poor dependency fit; Codepatrol already has artifact validation, workflow claims, and `execute-change`.
- **Decision:** `adapt`
- **Native adaptation:** Define Apply preconditions as a deterministic gate (hash-valid approved manifest, current revision, claim/dependencies, exact task scope), and define a post-task gate (red/green evidence, affected checks, assessment, journal update) before closure. Semantic deviation must trip the existing return-to-review route.
- **Trade-offs:** Stronger safety and less runaway execution; extra coordination and a stricter implementation journal.
- **Verification needed:** Red tests for each precondition failure and a test that a failed post-task gate does not close a workflow item or mutate the next task.

### Trace/span evidence for workflow observability

- **Facts:** OpenAI's tracing guide models a workflow as a trace containing nested spans for agent runs, generations, tools, guardrails, and handoffs, and warns that captured generation/function data may be sensitive.
- **Inference:** Apply already has a portable trace-like structure: work id, task claim, step stamp, artifact hashes, commands, and evidence paths. A local structured execution event would provide much of the useful causality without exporting sensitive data.
- **Reference problem:** Debug and audit multi-step agent execution.
- **Target fit:** Moderate concept fit; the project has no telemetry backend and explicitly avoids a scheduler/network service.
- **Decision:** `adapt`
- **Native adaptation:** Normalize concise task evidence fields in `implementation.md` and optional local workflow memory: task id, actor, start/end, changed paths, commands/results, assessment, and next action. Do not introduce a tracing dependency, remote exporter, or raw prompt/output capture.
- **Trade-offs:** Better resume/debug evidence with minimal privacy exposure; less visualization than hosted tracing.
- **Verification needed:** Schema/format tests, redaction checks against secrets/raw conversation, and resume tests from an interrupted task.

### MCP tool schema and trust controls

- **Facts:** MCP's tools specification uses named tools with descriptions and JSON Schemas, supports structured output schemas, distinguishes protocol errors from tool execution errors, and calls for input validation, access control, rate limits, output sanitization, timeouts, confirmation for sensitive actions, and audit logs.
- **Inference:** The useful concept is explicit tool contracts and trust-seam validation, not an MCP server.
- **Reference problem:** Allow models to discover and invoke external operations safely.
- **Target fit:** Codepatrol has CLI commands rather than model-controlled network tools; adding MCP would violate current scope and increase attack surface.
- **Decision:** `adapt`
- **Native adaptation:** Treat catalog entries, CLI command arguments, artifact manifests, and workflow claims as typed tool-like interfaces. Validate at each trust seam, preserve stable machine-readable errors, and require user authority for lifecycle transitions.
- **Trade-offs:** Clearer contracts without a protocol dependency; no interoperability with MCP clients.
- **Verification needed:** Existing JSON envelope/exit-code tests plus new catalog-to-command consistency checks. MCP integration remains a separate proposal if demanded by a user.

### Diff-scoped PR feedback

- **Facts:** Danger JS formalizes pull-request etiquette through a repository-side rules file; reviewdog consumes linter output, filters findings to the diff, and reports through local, checks, or PR-review reporters. The referenced reviewdog README is pinned to commit `a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd`.
- **Inference:** The valuable local pattern is a deterministic review rubric that reports only actionable findings within the governed change surface, while keeping the final verdict with the gatekeeper.
- **Reference problem:** Reduce review noise and surface policy violations in changed code.
- **Target fit:** Strong conceptual fit for `assess-change`; weak fit for direct integration because Codepatrol has no GitHub API requirement and review is intentionally harness-agnostic.
- **Decision:** `adapt`
- **Native adaptation:** Extend the assessment/review matrix to separate contract, code, simplicity, verification, and artifact-drift findings; bind findings to exact paths/lines and the approved surface; keep `approve`, `fix-first`, and `rework` as local verdicts. Do not add Danger or reviewdog dependencies.
- **Trade-offs:** Better signal and auditability; requires disciplined evidence and may reject broad but harmless diffs.
- **Verification needed:** Fixture reviews for in-diff/out-of-diff findings, stale verdict vocabulary, unplanned files, and artifact drift.

## Rejected integration surfaces

- No OpenAI Agents SDK dependency, guardrail runtime, tracing exporter, API key, or hosted telemetry.
- No MCP server, compatible MCP schema, network service, or external tool registry.
- No Danger JS or reviewdog dependency, GitHub API integration, CI bot, or provider-specific PR comment format.
- No copied external skill files or schemas. External concepts are adapted to Codepatrol's existing artifacts, CLI, catalog, and workflow ledger.

## Recommendation

Adopt the Agent Skills format discipline and adapt guardrail, trace/evidence, typed-tool, and diff-scoped review concepts into the existing Apply, catalog, artifact, and assessment seams. Reject direct integrations until a separate user-approved requirement establishes a concrete provider, trust boundary, and operational need.

## Open decisions

None for this package. A future MCP/hosted-review integration would require a separate explicit proposal rather than a deferred dependency hidden in Apply.
