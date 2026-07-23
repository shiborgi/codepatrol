---
description: (codepatrol) Independently verify a Change candidate
---
Load `codepatrol-verify` for `$ARGUMENTS`. Bind the exact candidate commit/tree,
re-run acceptance and broad gates, write only `verify/`, record metrics and
advance to Finalize or return the defect. Never edit production or finalize.
