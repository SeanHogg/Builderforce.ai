# API wire contracts

## Timestamps

All JSON API timestamps use ISO 8601 in UTC, including the trailing `Z` (for example,
`2026-07-25T07:11:00.123Z`). This applies to both camelCase and legacy snake_case fields.

Database routes should project typed Drizzle timestamp columns and allow JSON
serialization to produce the wire value. Do not cast timestamps to Postgres text: its
timezone-less form is ambiguous and is not consistently parseable by browsers. Code that
performs timestamp arithmetic must convert explicitly with `Date#getTime()` (or parse a
documented external ISO string) rather than depending on a driver-specific representation.

Read-through cached responses follow the same JSON shape on a loader miss and on L1/KV
hits; `Date` instances are normalized to ISO strings before the fresh value is returned.
