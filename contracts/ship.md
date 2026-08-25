# Ship

Inspect the selected candidate, base commit, verification, and review evidence.
The operator explicitly confirms Accept or Rollback. Accept moves the configured
base branch to the exact reviewed candidate and publishes state atomically.
Rollback leaves the base branch unchanged.

Ship Show may resolve optional advisory catalog instructions read-only. Accept and
Rollback never resolve an agent and still require explicit human confirmation.
