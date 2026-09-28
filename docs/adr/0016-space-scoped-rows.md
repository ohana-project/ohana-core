# Isolate spaces by space-scoped rows and composite keys

All spaces of an installation share one PostgreSQL schema. Every space-owned table carries a non-null `space_id`, and references between space-owned rows use composite foreign keys on `(space_id, id)`, so the database itself rejects a row in one space pointing at a row in another. Application queries go through a data-access layer that requires the acting member's space; unscoped queries on space-owned tables are not part of the normal access path.

A schema per space was rejected because migrations, pooling, and cross-space administration would multiply with every space. PostgreSQL row-level security is deferred rather than rejected: it is the planned additional safeguard when Ohana hosts unrelated families, and the `space_id` column on every row keeps that step additive.
