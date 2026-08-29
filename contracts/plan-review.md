# Plan Review

Compare every Plan proposal in the sealed round. CodePatrol recomputes Work and
acceptance coverage. Verdicts may include an integer `score` from 0 through 100 as
advisory metadata. When proposals differ by `contextProfile`, the summary must
compare the with-context and without-context options. Approve only with the passing
`selectedProposalId`; scores do not select a proposal. Return without a selection when another planning round is required.

Optional catalog instructions are advisory under the common Agent Catalog contract.

New reviews expose the Plan Review dimensions `acceptance-mapping`, `code-locality`,
`dependency-risk-coverage`, and `verification-specificity` in the review protocol.
Submit ordered evidence-backed dimensions; the host computes the total and rank.
