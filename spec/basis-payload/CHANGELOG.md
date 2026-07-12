# Changelog — Agent/Board Basis Payload Structure

All notable changes to the basis payload schema are documented in this file.

The schema follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR** — a breaking change to the payload contract (field removal, type change, or a
  new required field). Consumers MUST reject payloads whose major version they do not support.
- **MINOR** — a backwards-compatible addition (new optional field, new enum value).
- **PATCH** — a backwards-compatible clarification or documentation-only fix with no wire change.

The current schema artifact lives at
[`basis-payload.schema.json`](./basis-payload.schema.json) and the full documentation
at [`basis-payload.md`](./basis-payload.md).

---

## [1.0.0] — 2025-01-15

Initial ratified version of the Agent/Board Basis Payload structure.

### Added

- **FR-1 — Schema versioning.** Top-level required `schema_version` semver string.
- **FR-2 — Basis identity.** `basis_id` (uuid-v4), `created_at`, `agent_id`,
  `session_id`, and `parent_basis_id` for chaining refinements/rebuttals.
- **FR-3 — Claims block.** Required array of atomic assertions with
  `claim_id`, `text`, `confidence` (`[0.0, 1.0]`), `confidence_method`, `tags`,
  and `status` (default `asserted`).
- **FR-4 — Evidence/sources block.** Payload-level `evidence` items referenced by
  `claim_ids`, with `type`, `uri`, `title`, `excerpt`, `retrieved_at`,
  `weight` (`[0.0, 1.0]`), and a `provenance` object (`source_system`,
  `source_version`, optional SHA-256 `checksum`).
- **FR-5 — Reasoning chain block.** Optional ordered `reasoning_chain` with
  sequential `step` numbers starting at 1, `evidence_ids`, `claim_ids`, and
  `inference_type`.
- **FR-6 — Uncertainty & caveats block.** `uncertainty` with `overall_confidence`,
  `known_unknowns`, `assumptions`, and `contradictions`.
- **FR-7 — Context block.** `context` with `task_id`, `task_description`, `model_id`,
  `model_version`, `tool_calls[]`, and `environment`.
- **FR-8 — Extensions block.** `extensions` object keyed by reverse-DNS namespaces
  for domain-specific fields; consumers MUST ignore unknown namespaces.
- **FR-9 — Validation.** Published JSON Schema (Draft 2020-12) artifact; `confidence`
  and `weight` bounded to `[0.0, 1.0]`; missing `schema_version`, `basis_id`,
  `agent_id`, `claims`, or `evidence` is rejected.
- **FR-10 — Canonical example.** [`example.canonical.json`](./example.canonical.json)
  published and validated against the schema.

### Tagging

This release is tagged in version control as `basis-payload-v1.0.0`.
