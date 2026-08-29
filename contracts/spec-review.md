# Spec Review

Compare every Spec proposal in the sealed round. Report one verdict per proposal;
each verdict may include an integer `score` from 0 through 100 as advisory metadata.
When proposals differ by `contextProfile`, the summary must compare the
with-context and without-context options. Approve only with the passing
`selectedProposalId`; scores do not select a proposal.
Return without a selection when none is adequate. Approval materializes the Init's
Waves and Works.

Optional catalog instructions are advisory under the common Agent Catalog contract.

New reviews expose the Spec Review dimensions `scope-coverage`,
`requirement-grounding`, `acceptance-clarity`, and `unresolved-ambiguity` in the
review protocol. Submit ordered evidence-backed dimensions; the host computes
the total and rank.
