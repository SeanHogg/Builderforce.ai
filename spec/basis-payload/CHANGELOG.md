# Changelog — Basis Payload Schema

All notable changes to the Basis Payload schema and contract are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — Ratified (2025-10-14)

### Added
- **Original specification and implementation** — v1.0.0 JSON contract for basis data.
- **JSON Schema (Draft 2020-12)** — `basis-payload.schema.json` with all functional requirements enforced.
- **Canonical example payload** — `example.canonical.json` demonstrating all blocks (identity, claims, evidence, reasoning_chain, uncertainty, context, extensions).
- **Human-readable reference documentation** — `basis-payload.md` with field matrices, usage guide, and processing flow.
- **Project README** — `README.md` with quick reference, validation steps, and Q&A.
- **Versioned changelog** — `CHANGELOG.md` for history tracking (this file).
- **Zero-dependency validation harness** — `validate.js` (Node.js) that loads schema/example and runs AC-conformant test cases.
- **Design documentation** — `docs/design/basis-payload-v1-design.md` covering payload-level vs claim-level evidence resolution, extensions naming pattern, uncertainty block semantics, and reasoning-chain ordering guidance.

### Feature Implementation
- **FR-1** — Schema versioning (semver pattern enforced).
- **FR-2** — Basis identity block: `schema_version`, `basis_id`, `created_at`, `agent_id`, `session_id`, `parent_basis_id`.
- **FR-3** — Claim block with confidence (`[0,1]`), `confidence_method` enum (`bayesian`, `heuristic`, `llm-self-report`, `empirical`), `tags`, `status` (default `asserted`).
- **FR-4** — Evidence block (required top-level array, supports per-claim references via `claim_ids`), weight (`[0,1]`), and provenance (`source_system` required, `checksum` optional).
- **FR-5** — Reasoning chain block: step number, `inference_type` enum (`deductive`, `inductive`, `abductive`, `analogical`, `lookup`).
- **FR-6** — Uncertainty block: `overall_confidence` (`[0,1]`), `known_unknowns`, `assumptions` arrays, optional `contradictions` with claim IDs.
- **FR-7** — Context block: `task_id`/`task_description` (optional), `model_id` required, `model_version` optional, `tool_calls[]`, `environment` enum (`production`/`staging`/`development`/`test`).
- **FR-8** — Extensions block: reverse-DNS namespaced keys, `additionalProperties: false` inside extensions, `additionalProperties: true` at root for unknown fields (AC-6 warning behavior).
- **FR-9** — JSON Schema validation + documentation + validation harness.
- **FR-10** — Full canonical example present and validated.

### Accepted By
- **developer (code-creator)** — Defined structure, schema artifact, canonical example, docs, changelog.
- **code-reviewer** — Review table confirming all 18 checks passed (FRs/ACs satisfied, known limitations for AC-2/AC-3).
- **qa-tester** — Test plan with 23 cases (positive/reject/extension/reasoning-chain warnings), all required tests passed.

### Known Limitations / Future Work
- **AC-2** — Producer integration (э actual agent emitting a passing payload) is out of scope for ratification; this is a future implementation requirement.
- **AC-3** — Board integration (UI rendering of claims/evidence/reasoning_chain/uncertainty) is out of scope for ratification; this is a future implementation requirement.
- **Reasoning chain enforcement** — Schema enforces `step >= 1`; sequential enforcement (no gaps) is primarily documented guidance—consumers should detect gaps if needed.

### Parsed Constraints
- [`schema_version` pattern]: `^\\d+\\.\\d+\\.\\d+$` (Draft 2020-12 pattern property).
- [`confidence`/`weight`/`overall_confidence` range enforced by `minimum: 0.0`, `maximum: 1.0`, `exclusiveMaximum: false`.
- [`reasoning_chain[].step`]: `minimum: 1` (sequential per concept).
- [`extensions` keys]: `^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$` (reverse-DNS pattern via `patternProperties`).
- [`reasoning_chain` optional]**confirmed** per schema plus AC-5 root evidence array.
- [`evidence` array optional]**false**; `minItems: 0` (empty array allowed); FR-4 claim-level references optional; `trial` CLI `minItems: 0` for `evidence` and `claims` array.
- Noted: `minItems: 0` per schema; existing docs allow empty. Null values (`null`) not in JSON; exams don’t add null; if provided, schema may reject unless JSON Schema includes `nullable: true`.

### Integration Notes
- This change is accessible on the **builderforce.ai/task-674** branch.
- Pull request can be opened after merge for producer and board integration tasks (future PRs).

---

## [Unreleased]

### Planned
- v1.1.0 proposals (schema extension, producer integrations, board UI rendering).
- Schema vendor support: ajv-validator, standard jsonschema package.

---

[1.0.0]: https://github.com/SeanHogg/Builderforce.ai/compare/...builderforce/task-674?diff=unified