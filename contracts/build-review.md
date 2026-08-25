# Build Review

CodePatrol verifies every immutable candidate before review. Compare every
candidate and keep verification separate from acceptance. Verdicts may include an
integer `score` from 0 through 100 as advisory metadata; scores do not select a
candidate. Approval requires a selected candidate with a passing verification result
and a passing verdict for every acceptance ID. Infrastructure failure blocks and
retries the same review.

Optional catalog instructions are advisory under the common Agent Catalog contract.
