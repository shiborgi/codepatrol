# Schema policy

CodePatrol v1 accepts only `schemaVersion: 1` documents with the exact fields
declared by their parser. Unknown fields, absent required fields, and unknown
versions are rejected. There are no legacy readers, automatic migrations, or
backward-compatibility aliases.

An incompatible future schema is a new major version with an explicit offline
state rewrite performed by the operator. Downgrade is not supported.
