# Portable Execution Protocol

Use the main conversation as the **coordinator**. The coordinator owns decisions, the final synthesis, `codepatrol graph sync`, and every wiki write.

Use the [shared workflow contracts](WORKFLOW.md) for durable memory. Resume an existing workflow before decomposing it, represent dependencies in the native ledger, and claim a write unit before changing its scope.

For work that can be decomposed, describe each unit with:

- `id`: short identifier;
- `objective`: the question to answer;
- `scope`: files, symbols, or topic;
- `mode`: `read-only`, `write-isolated`, or `coordinator-only`;
- `dependencies`: units that must finish first;
- `input`: only the context and settled decisions it needs;
- `output`: concise conclusion, verified `file:line` evidence, risks, and uncertainty.

When the harness offers native delegation and units are independent, ask it to execute them in parallel. Otherwise, execute the same units sequentially in dependency order. In both cases, wait at a barrier until every unit finishes, validate the returned evidence, resolve contradictions, and only then synthesize.

Parallel work is safe for reading, independent tests, review, and isolated writes. Never let workers update the same file or module concurrently. Do not recursively fan out. Workers query an already-synced graph and never write the wiki.
