# Basis Payload Reference — v1.0.0

> **Status:** Ratified
>
> **Last Updated:** 2025-06-18

---

## Table of Contents

1. [Scope](#scope)
2. [Core Structure](#core-structure)
3. [Field Definitions](#field-definitions)
4. [Reasoning Chain Semantics](#reasoning-chain-semantics)
5. [Extensions Namespacing](#extensions-namespacing)
6. [Integration Guidelines](#integration-guidelines)
7. [Field Mapping to PRD Requirements](#field-mapping-to-prd-requirements)

---

## Scope

This reference document details the ratified **JSON payload contract v1.0.0** for structured basis data. It supports:

- Identity identification (`basis_id`, `created_at`, `agent_id`, `parent_basis_id`).
- Claim assertions with confidence and provenance.
- Evidence sources with claim-to-evidence linkage, weights, and provenance.
- Optional reasoning chains for step-by-step logic transparency.
- Uncertainty summary (overall confidence, known_unknowns, assumptions, contradictions).
- Operational context (task, model, tool calls, environment).
- Extensible naming via `extensions` (domain-specific fields).

### Not Covered

- Transport protocols (HTTP/WebSocket, message queue schemas).
- Storage schema/database design.
- UI rendering specifications.
- Authentication/authorization gateways.
- Payload compression or binary encoding.

---

## Core Structure

At the root, a basis payload must:

- Include `schema_version` as a semver string (e.g., `"1.0.0"`).
- Include required identity fields (`basis_id`, `created_at`, `agent_id`).
- Include required arrays (`claims`, `evidence`).
- May include optional fields (`reasoning_chain`, `uncertainty`, `context`, `extensions`).

### Error Handling

- **Producer-side validation:** MUST validate before emission using the schema in `basis-payload.schema.json` and reject with a structured error if invalid.
- **Consumer-side validation:** SHOULD validate before processing; unknown top-level fields cause a **warning** (not hard error) per AC-6.

---

## Field Definitions

### Top-level Identity Fields

| Field | Type | Required | Description | Notes |
|-------|------|----------|-------------|-------|
| `schema_version` | `string` | Yes | Schema version semver (e.g., `"1.0.0"`). | Must match supported version; non-matching major version rejected. |
| `basis_id` | `string` (UUID v4) | Yes | Globally unique identifier for this basis instance. | UUID v4 per RFC 4122. |
| `created_at` | `string` (ISO-8601) | Yes | ISO-8601 UTC timestamp when payload was created. | `YYYY-MM-DDTHH:MM:SS.SSSZ`. |
| `agent_id` | `string` | Yes | Identifier of the agent or system that produced this basis. | Must be stable; boards use it to attribute claims. |
| `session_id` | `string \| null` | No | Session identifier for the agent; optional. | Useful for session-level audits. |
| `parent_basis_id` | `string \| null` (UUID v4) | No | UUID of a prior basis if this is a refinement or rebuttal. | Optional; enables chaining. |

### `claims` Array

Array of claim objects. Each claim is an atomic assertion.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `claim_id` | `string` (UUID v4) | Yes | Unique identifier for the claim. |
| `text` | `string` | Yes | Human-readable assertion text. |
| `confidence` | `number` [0.0, 1.0] | Yes | Confidence in the claim. |
| `confidence_method` | `string \| null` | No | Method: `"bayesian"`, `"heuristic"`, `"llm-self-report"`, `"empirical"`. |
| `tags` | `string[]` | No | Additional classification tags. |
| `status` | `string` | No | Status: `"asserted"` (default), `"retracted"`, `"superseded"`. |

#### Confidence Guidelines

- `confidence` MUST be a float in `[0.0, 1.0]`. Permissible values at boundaries are valid (e.g., `0.0`, `1.0`).
- Use `confidence_method` to disambiguate how the value was derived (refer to product/team conventions for interpretation).
- Boards should render confidence visually (e.g., confidence bar).

### `evidence` Array (Required)

Evidence items referenced at the payload level. All evidence is referenced by ID from `claims` or `reasoning_chain`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `evidence_id` | `string` (UUID v4) | Yes | Unique identifier for this evidence item. |
| `claim_ids` | `string[]` (UUID) | Yes | Claim IDs this evidence supports (may be empty). |
| `type` | `string` (enum) | Yes | Kind of source: `"document"`, `"database_record"`, `"api_response"`, `"agent_output"`, `"human_input"`, `"computed"`. |
| `uri` | `string \| null` | No | URI to retrieve full evidence. |
| `title` | `string \| null` | No | Title or name of the source. |
| `excerpt` | `string \| null` | No | Searchable excerpt or snippet. |
| `retrieved_at` | `string (ISO-8601) \| null` | No | Timestamp when evidence was retrieved. |
| `weight` | `number` [0.0, 1.0] | Yes | Strength of support for linked claims. |
| `provenance` | `object` | Yes | Provenance details (see below). |

#### Provenance Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_system` | `string` | Yes | Identifier of the source system that generated this evidence. |
| `source_version` | `string \| null` | No | Version of the source system. |
| `checksum` | `string (hex) \| null` | No | SHA-256 checksum of evidence content; optional but recommended for reproducibility. |

### `reasoning_chain` Array (Optional)

Ordered steps explaining the logical flow leading to claims. Steps must be numbered sequentially starting at 1.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step` | `integer` 1..n | Yes | Sequential step number (must start at 1; gaps not recommended). |
| `description` | `string` | Yes | Human-readable description of this inference step. |
| `evidence_ids` | `string[]` (UUID) | Yes | IDs of evidence considered/used at this step; may be empty. |
| `claim_ids` | `string[]` (UUID) | Yes | IDs of claims derived at this step; may be empty. |
| `inference_type` | `string` (enum) | Yes | Inference type: `"deductive"`, `"inductive"`, `"abductive"`, `"analogical"`, `"lookup"`. |

#### Inference Types

- `deductive`: Reasoning from general premises to specific conclusions.
- `inductive`: Reasoning from specific instances to general conclusions.
- `abductive`: Inferring most plausible explanation.
- `analogical`: Drawing inference by analogy.
- `lookup`: Retrieval/retrieval-like operation (e.g., retrieving a record).

---

### `uncertainty` Object (Required)

Overall uncertainty profile. Per FR-6 and AC-6.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `overall_confidence` | `number` [0.0, 1.0] | Yes | Overall confidence in the basis content. |
| `known_unknowns` | `string[]` | Yes | Known limitations or unknown factors. |
| `assumptions` | `string[]` | Yes | Assumptions made in deriving this basis. |
| `contradictions` | `object[]` | Yes | Pairs of claims with contradictory statements. |

#### Contradiction Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `claim_id_a` | `string` (UUID) | Yes | ID of first claim in the pair. |
| `claim_id_b` | `string` (UUID) | Yes | ID of second claim in the pair. |
| `description` | `string` | No | Short description of the contradiction (optional). |

### `context` Object (Required)

Operational context of the basis.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | `string \| null` | No | ID of the task this basis addresses. |
| `task_description` | `string \| null` | No | Human-readable task description. |
| `model_id` | `string` | Yes | Identifier of the model generating this basis. |
| `model_version` | `string \| null` | No | Version of the model. |
| `tool_calls` | `object[]` | No | List of tools invoked (see below). |
| `environment` | `string` (enum) | Yes | Deployment environment: `"production"`, `"staging"`, `"development"`, `"test"`. |

#### Tool Call Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool_name` | `string` | Yes | Name of the tool. |
| `input_summary` | `string` | No | High-level summary of the tool input. |
| `output_summary` | `string` | No | High-level summary of the tool output. |
| `called_at` | `string` (ISO-8601) | Yes | Timestamp when tool was invoked. |

---

### `extensions` Object (Optional)

Domain-specific fields without polluting the core schema. Consumers ignore unknown extension namespaces.

| Property Key | Type | Description | Validation |
|--------------|------|-------------|------------|
| Extension keys | `object` | Reverse-DNS style namespace keys (e.g., `"com.builderforce.review"`). | `pattern: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. |

Notes:
- Unknown top-level fields (outside `extensions`) do NOT cause hard errors per AC-6; they cause warnings.
- Internal schema enforces reverse-DNS keys for `extensions`.

---

## Reasoning Chain Semantics

- **Sequential numbering:** Steps MUST start at 1 and be sequential (e.g., `1`, `2`, `3`). The schema enforces `minimum: 1`; gaps (e.g., `1, 3`) are allowed but discouraged as semantic guidance.
- **Discrete steps:** Each step has a purposeful inference; empty `evidence_ids` or `claim_ids` is allowed.
- **Chain completeness:** Reasoning chains are optional; boards may render a helpful note when absent.

---

## Extensions Namespacing

- Use reverse-DNS style prefixes for extension namespaces (e.g., `"com.builderforce.review"`, `"com.acme.risk"`).
- The schema enforces `additionalProperties: false` within `extensions` and `patternProperties` for extension keys.
- Unknown fields under `extensions` are ignored by consumers.
- Unknown fields at the root are logged as warnings (non-blocking) per AC-6.

---

## Integration Guidelines

### For Producers (Agents)

1. **Validate before emission:**
   - Use `ajv` with `draft-2020-12` and `ajv-formats` to validate.
   - Reject payloads with validation failures before sending to boards.
2. **Self-ID fields:**
   - Generate fresh `basis_id` (UUID v4) for each emitted basis.
   - Set `parent_basis_id` to the `basis_id` of the prior basis for chains of reasoning.
3. **Traceability:**
   - Use `tool_calls` to capture all external tool calls relevant to the claims.
4. **Extensions:**
   - Introduce namespace keys with reverse-DNS style prefixes for domain-specific fields.
   - Extend schema only if backward compatibility is not critical; otherwise, support multiple versions.

### For Consumers (Boards / Applications)

1. **Validate on receipt:**
   - Run the same schema validator before rendering claims/evidence.
   - Log structured warnings for missing optional fields but allow viewing when available.
2. **Unknown fields:**
   - Unknown top-level fields are informational; do not fail rendering (per AC-6).
   - Unknown extension fields are ignored.
3. **Display confidence:**
   - Render `confidence` and `overall_confidence` visually (e.g., bars with color shifts for historical conventions).
4. **Citations:**
   - Use `evidence.uri` to link to full evidence sources.
   - Summarize `evidence.title` and `evidence.excerpt` in user-facing citation views.

---

## Field Mapping to PRD Requirements

| PRD Requirement | Payload Field(s) | Enforcement |
|-----------------|------------------|--------------|
| **FR-1 / AC-1** | `schema_version` (root) | Pattern `^\d+\.\d+\.\d+$`, Required |
| **FR-2** | Root identity block (`basis_id`, `created_at`, `agent_id`, `session_id`, `parent_basis_id`) | Required fields, UUID formats |
| **FR-3** | `claims[]` | Required array; per-claim fields (`confidence`, `confidence_method`, `tags`, `status`) |
| **FR-4** | `evidence[]` | Required array; `claim_ids`, `weight`, `provenance.source_system`, etc. |
| **FR-5** | `reasoning_chain[]` | Optional array; step numbers, inference type |
| **FR-6** | `uncertainty` | Required; `overall_confidence [0,1]`, `known_unknowns`, `assumptions`, `contradictions[]` |
| **FR-7** | `context` | Required; `model_id`, `environment` enum, `tool_calls[]` |
| **FR-8** | `extensions` object | `additionalProperties: false`, `patternProperties` for reverse-DNS keys |
| **FR-9** | `basis-payload.schema.json` (Draft 2020-12) | $id, schema structure |
| **FR-10** | `example.canonical.json` | Fully populated example validating against schema |

### AC Resolutions

- **AC-1 (required fields):** Enforced by schema (required: `schema_version`, `basis_id`, `agent_id`, `claims`, `evidence`).
- **AC-4 (bounds):** Enforced via `minimum: 0.0`, `maximum: 1.0` on `confidence`, `weight`, `overall_confidence`.
- **AC-5 (parent chaining):** Optional `parent_basis_id` supports chaining; conceptual link semantics documented.
- **AC-6 (unknown field warnings):** Root `additionalProperties: true`; unknown fields logged as warnings (non-blocking).
- **AC-7 (canonical example):** `example.canonical.json` fully populated, passes validation.
- **AC-8 (version tag):** Tracking in `CHANGELOG.md`; tagging plan: `basis-payload-v1.0.0`.

---

## Reference Implementation (TypeScript Example)

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const schema = require("./basis-payload.schema.json");
const validate = ajv.compile(schema);

// Example basis payload
const basisPayload = {
  schema_version: "1.0.0",
  basis_id: "550e8400-e29b-41d4-a716-446655440000",
  created_at: "2025-04-10T10:00:00Z",
  agent_id: "finance-unified-planner-v2",
  session_id: "finance-session-a1b2c3",
  parent_basis_id: null,
  claims: [
    {
      claim_id: "claim-1",
      text: "Revenue growth is projected at 15% YoY",
      confidence: 0.87,
      confidence_method: "empirical",
      status: "asserted"
    }
  ],
  evidence: [
    {
      evidence_id: "evidence-1",
      claim_ids: ["claim-1"],
      type: "database_record",
      uri: "https://api.finance-db.com/reports/2025q1",
      title: "Q1 2025 Revenue Forecast",
      weight: 0.92,
      provenance: {
        source_system: "Financial Core",
        checksum: "a0b1c2d3e4f5..."
      }
    }
  ],
  reasoning_chain: [
    {
      step: 1,
      description: "Load historical revenue data",
      evidence_ids: ["evidence-1"],
      claim_ids: ["claim-1"],
      inference_type: "lookup"
    }
  ],
  uncertainty: {
    overall_confidence: 0.81,
    known_unknowns: ["External economic sanctions not yet modeled"],
    assumptions: ["Marketing spend correlation holds constant"],
    contradictions: []
  },
  context: {
    task_id: "task-basis-revenue-projection-123",
    task_description: "Create a quarterly revenue projection basis",
    model_id: "finance-unified-planner-v2",
    model_version: "2.0.3",
    tool_calls: [
      {
        tool_name: "query_financial_db",
        input_summary: "SELECT revenue, marketing_spend FROM q1_history WHERE year=2024",
        output_summary: "Loaded 24 monthly records",
        called_at: "2025-04-10T10:15:00Z"
      }
    ],
    environment: "production"
  },
  extensions: {
    "com.builderforce.review": {
      peer_review_status: "pending",
      reviewers: ["agent-audit", "user-finops"]
    },
    "com.acme.risk": {
      risk_exposure_score: 0.45
    }
  }
};

if (!validate(basisPayload)) {
  console.error("Validation failed:", validate.errors);
  // Abort emission
}
```

---

## Change History

See [`CHANGELOG.md`](CHANGELOG.md) for versioned changes.

---

## Copyright & License

© SeanHogg/Builderforce.ai. Licensed under the same license as the repository.

---

## Related Documentation

- **Full PRD:** [`PRD.md`](../../PRD.md) (Task #674).
- **JSON Schema:** [`basis-payload.schema.json`](basis-payload.schema.json).
- **Canonical Example:** [`example.canonical.json`](example.canonical.json).
- **Design Document:** [`docs/design/basis-payload-v1-design.md`](../../docs/design/basis-payload-v1-design.md).