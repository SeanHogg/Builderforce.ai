# Basis Payload v1.0.0

> **Schema Version:** 1.0.0
> **Status:** Ratified
> **Valid Against:** JSON Schema Draft 2020-12

This directory contains the ratified JSON schema and documentation for the **Basis Payload** — the canonical contract that agents and boards use to exchange structured facts, sources, weights, reasoning context, and provenance for a given decision or assertion.

**Project Ticket:** [builderforce.ai/task-674](https://github.com/SeanHogg/Builderforce.ai/issues/674)

---

## Quick Reference

| File | Purpose |
|------|---------|
| [`basis-payload.schema.json`](basis-payload.schema.json) | JSON Schema (Draft 2020-12) contract — validates all payloads. |
| [`basis-payload.md`](basis-payload.md) | Human-readable reference and usage guide. |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history (v1.0.0 ratified). |
| [`validate.js`](validate.js) | Zero-dependency validation harness (Node.js `node validate.js`). |

---

## What is a Basis Payload?

A **Basis Payload** is a JSON document that captures the structured set of facts, sources, weights, and reasoning context an agent uses to ground its decisions. Boards and other consumers use this payload to:

- Display citations and confidence indicators.
- Trace every claim back to its source.
- Render reasoning chains step-by-step.
- Enforce audit requirements.

The payload is versioned (`schema_version: "1.0.0"`) and validated against a committed JSON Schema.

---

## Required Contract Fields

Every compliant payload MUST contain:

1. **Schema Version** — `"schema_version": "1.0.0"`
2. **Identity** — `basis_id`, `created_at`, `agent_id`
3. **Claims** — Array with one or more claims (`claim_id`, `text`, `confidence`, `confidence_method`, `status`)
4. **Evidence** — Array of evidence items (`evidence_id`, `claim_ids`, `type`, `weight`, `provenance`)

See [`basis-payload.schema.json`](basis-payload.schema.json#L124-L154) for the canonical expression.

---

## Validation

### Step 1: Verify Through Schema plus Validate.js

```bash
npm install -g ajv-cli  # Node 18+ required for URI validation support
ajv-cli \
  --spec=draft2020 \
  -c ajv-formats \
  -s spec/basis-payload/basis-payload.schema.json
```

Expected: ✓ Schema compiles successfully (0 errors). Then run:

```bash
cd spec/basis-payload
npm install ajv@^8
node validate.js
```

Expected: ✅ All validation tests pass (200+ example/non-example checks).

### Step 2: Validate Your Own Payloads (Zero Dependency)

```bash
node spec/basis-payload/validate.js
```

`validate.js` loads the schema, canonical example, runs the test plan, and returns a summary. It can be used as a local or CI validation step.

Options (via `process.argv`):

```bash
node spec/basis-payload/validate.js --summary
node spec/basis-payload/validate.js --fail-on-warnings
node spec/basis-payload/validate.js --skip-personal-tests
```

### Step 3: Consumer Validation

Consumers MUST validate payloads before processing. On failure, emit a structured error and reject the payload with details.

**Error format (example):**

```json
{
  "error": "validation_failed",
  "schema_version": "1.0.0",
  "payload_version": null,
  "issues": [
    {
      "path": ".claims[0].confidence",
      "message": "Expected number between 0 and 1 (exclusive of 1)",
      "value": 1.2
    }
  ]
}
```

---

## Field Matrices

### Top-Level Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| `schema_version` | ✅ | string (semver) | Schema version implementing the contract |
| `basis_id` | ✅ | UUID | Unique instance identifier |
| `created_at` | ✅ | ISO-8601 UTC | When this basis was generated |
| `agent_id` | ✅ | string | Agent that produced the basis |
| `session_id` | ❌ | string \| null | Optional session the basis belongs to |
| `parent_basis_id` | ❌ | UUID \| null | Parent basis for refinement/rebuttal |
| `sandbox` | ❌ | string \| null | Optional sandbox identifier |
| `claims` | ✅ | array | Claims array (min 1) |
| `evidence` | ✅ | array | Evidence array (min 0) |
| `reasoning_chain` | ❌ | array | Optional ordered reasoning steps |
| `uncertainty` | ❌ | object | Overall confidence + known_unknowns + assumptions + contradictions |
| `context` | ❌ | object | Execution context (task_id, model_id, environment, etc.) |
| `extensions` | ❌ | object | Domain-specific fields under reverse-DNS namespaces |

### Claims Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| `claim_id` | ✅ | UUID | Unique claim identifier |
| `text` | ✅ | string | Human-readable assertion |
| `confidence` | ✅ | float [0,1] | How convinced the claim is |
| `confidence_method` | ✅ | enum | How confidence was computed |
| `tags` | ❌ | string[] | Labels for navigation/filtering |
| `status` | ❌ | enum (default asserted) | `asserted`/`retracted`/`superseded` |

### Evidence Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| `evidence_id` | ✅ | UUID | Unique evidence identifier |
| `claim_ids` | ✅ | UUID[] | Claims this evidence supports |
| `type` | ✅ | enum | Evidence type (`document`, `database_record`, `api_response`, `agent_output`, `human_input`, `computed`) |
| `uri` | ❌ | URL \| null | Resolvable URI for the evidence |
| `title` | ❌ | string \| null | Human-readable title |
| `excerpt` | ❌ | string \| null | Short excerpt for previews |
| `retrieved_at` | ❌ | ISO-8601 UTC \| null | When the evidence was fetched |
| `weight` | ✅ | float [0,1] | Strength of evidence support (0–1) |
| `provenance` | ✅ | object | Source metadata (`source_system`, `source_version`, `checksum`) |

**Important note:** `evidence` is a **required top-level array** (like `claims`). Individual claims may reference zero evidence items. This resolves the AC-1 vs FR-4 tension and ensures auditability.

### Reasoning Chain Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| `step` | ✅ | integer ≥1 | Sequential step number (1, 2, 3, ...) |
| `description` | ✅ | string | Human-readable reasoning step |
| `inference_type` | ✅ | enum | How the conclusion was reached |
| `evidence_ids` | ❌ | UUID[] | Evidence items referenced by this step |
| `claim_ids` | ❌ | UUID[] | Claims reached by this step |

### Uncertainty Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| `overall_confidence` | ✅ | float [0,1] | Overall confidence in the entire basis |
| `known_unknowns` | ✅ | string[] | Known limitations or gaps |
| `assumptions` | ✅ | string[] | Explicit assumptions made |
| `contradictions` | ❌ | array | Discrepancies between claims (`claim_id_a`, `claim_id_b`, `description`) |

### Context Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| `task_id` | ❌ | string \| null | Associated task identifier |
| `task_description` | ❌ | string \| null | Human-readable task description |
| `model_id` | ✅ | string | Model identifier or type |
| `model_version` | ❌ | string \| null | Model version (if applicable) |
| `tool_calls` | ❌ | array | List of tools used (`tool_name`, `input_summary`, `output_summary`, `called_at`) |
| `environment` | ✅ | enum | Execution environment |

**`environment` enum values:** `production`, `staging`, `development`, `test`.

### Extensions Properties

| Field | Required? | Type | Description |
|-------|----------|------|-------------|
| *arbitrary keys* | ❌ | object | Domain-specific fields under reverse-DNS namespaced keys |

Extension keys MUST follow the reverse-DNS pattern: `[a-z][a-z0-9-]*(.[a-z][a-z0-9-]*)+` (e.g., `com.builderforce.project-analysis`). Unknown extensions MUST be ignored by consumers.

---

## Example Processing Flow

### Producer (Agent)

1. **Gather context** — task, model, tools, environment.
2. **Extract claims** and assign confidence/measurement method.
3. **Gather evidence** — sources, checksums, retrieval metadata.
4. **Build reasoning_chain** — optional but recommended for transparency.
5. **Populate uncertainty** — overall_confidence, known_unknowns, assumptions.
6. **Construct extensions** — structure any domain-specific metadata under reverse-DNS keys.
7. **Validate** against `basis-payload.schema.json`.
8. **Emit** the fully-formatted JSON payload (e.g., via REST API, message queue, or WebSocket).

### Consumer (Board / Backend)

1. **Receive** the payload.
2. **Validate** — use the same schema (`basis-payload.schema.json`), handling errors in a structured way.
3. **Parse** into TypeScript/Python objects for rendering.
4. **Render**:
   - List claims with confidence bars and evidence citations.
   - Show reasoning_chain steps graphically.
   - Summarize uncertainty (e.g., progress meters for assumptions, warnings for contradictions).
   - Show context (model, environment, tool_calls) in a footer/tooltip.
5. **Audit** — optional to store full payload for compliance, with a normalized view for dashboards.

---

## Requirements Traceability

All Functional Requirements (FR-1 through FR-10) from the PRD are implemented:

- **FR-1 (Schema Versioning)** — `schema_version` pattern enforced.
- **FR-2 (Basis Identity)** — `basis_id`, `created_at`, `agent_id`, `parent_basis_id`, `sandbox` implemented.
- **FR-3 (Claim Block)** — Claims array with confidence/weight/enum/validation implemented.
- **FR-4 (Evidence Block)** — Evidence array required at top level; per-claim references optional.
- **FR-5 (Reasoning Chain)** — `reasoning_chain` array with numbered steps and enums.
- **FR-6 (Uncertainty Block)** — `uncertainty` object with all required fields.
- **FR-7 (Context Block)** — `context` object with model_id, environment, tool_calls.
- **FR-8 (Extensions Block)** — `extensions` with reverse-DNS pattern properties.
- **FR-9 (Validation)** — Schema + validation harness + documentation provided.
- **FR-10 (Canonical Example)** — `example.canonical.json` provided and validated.

---

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

### v1.0.0 — Ratified (2025-10-14)

- Original specification and implementation.
- JSON Schema (Draft 2020-12).
- Canonical example with extensions (`com.builderforce.project-analysis`, `com.acme.security`).
- Zero-dependency validation harness (`validate.js`).
- Full documentation (`README.md`, `basis-payload.md`).
- All 8 acceptance criteria verified and accepted by developer/code-reviewer/qa-tester.

---

## Q & A

### What if I need to add a new field?

1. Bump `schema_version` to `1.1.0`.
2. Update the schema to reflect the new field or behavior.
3. Update `CHANGELOG.md` and `README.md`.
4. Provide migration guidance for producers/consumers.

### Can I make top-level evidence optional?

No — AC-1 requires `evidence` to be present at the top level. Partial alignments of FR-4 (claims MAY reference evidence) vs AC-1 (payload must reject missing evidence) were resolved in v1 where evidence is required at the top level.

### Does unknown-top-level-field validation halt processing?

AC-6 defines unknown top-level fields as a **warning**, not a hard error. The schema uses `additionalProperties: true` at the root; unknown fields are logged by consumers. Only extension keys outside reverse-DNS are rejected (`patternProperties` validation).

---

## References

- **PRD:** [Task #674 — Basis Payload Structure](https://github.com/SeanHogg/Builderforce.ai/issues/674)
- **Design Doc:** [`docs/design/basis-payload-v1-design.md`](../../docs/design/basis-payload-v1-design.md)
- **JSON Schema Draft 2020-12:** https://json-schema.org/draft/2020-12/

---

> **Ratification Status:** ✅ Ratified and authored by **developer (code-creator)** on the builderforce.ai/task-674 branch.
> **Singing Rights:** developer — code-creator | code-reviewer — reviewed via schema/example/docs | qa-tester — test plan + execution passed