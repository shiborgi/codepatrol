# Context Provider

An optional context provider supplies a bounded, advisory code-analysis report.
CodePatrol invokes the complete configured command directly without a shell and
sends one strict JSON request over stdin. The request contains only a repository
workspace, neutral analysis text, profile facets, budget, and a source target.

Context provider reports are immutable snapshots. They are exposed at the task
envelope top level but never copied into proposals or historical reviews. A report
does not change task inputs, result contracts, verification, review selection, or
Ship authority.
