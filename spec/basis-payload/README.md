# Basis Payload Specification — v1.0.0

> **Status:** Ratified
>
> **Last Updated:** 2025-06-18
>
> **Version:** 1.0.0

---

## Overview

This directory contains the ratified, versioned JSON payload contract for structured **basis data** — the set of facts, sources, weights, and reasoning context that agents use to ground their decisions and that boards use to display, audit, and challenge those decisions.

**Purpose:** Provide a canonical, versioned schema that all agents can emit and all boards can consume, ensuring interoperability, auditability, and cross-agent comparability.

**Key Design Points:**
- **Payload-level evidence:** Required at the top level per AC-1 (FR-4 per-claim optionality is realized via evidence items referencing zero or more claims).
- **Extensions namespacing:** Unknown top-level fields cause warnings (not hard errors) per AC-6; only fields under `extensions` are constrained by the schema (`additionalProperties: true` at root, `additionalProperties: false` inside `extensions`).
- **Uncertainty block:** Required, containing an overall confidence score [0,1] and structured lists of known_unknowns, assumptions, and contradictions.
- **Reasoning chain ordering:** Steps are numbered sequentially starting at 1; the schema enforces `step >= 1`; sequential enforcement (no gaps) is semantic guidance for producers/consumers.

---

## Files & Artifacts

| Artifact | Description | Validation Command |
|----------|-------------|--------------------|
| `basis-payload.schema.json` | JSON Schema v1.0.0 (Draft 2020-12) — canonical contract | `node validate.js` (see below) |
| `example.canonical.json` | Full canonical example payload (validates against schema) | `node validate.js` |
| `basis-payload.md` | Reference documentation; integration guidelines; requirement traceability | — |
| `CHANGELOG.md` | Versioned changelog (v1.0.0 entry) | — |

---

## Quick Start

### 1. Validate the Canonical Example

The artifact `validate.js` is a zero-dependency Node.js script that runs the AC test plan against the schema and example:

```bash
cd spec/basis-payload
node validate.js
```

Expected output:

```
✓ schema_version pattern validation
✓ Required fields: schema_version, basis_id, agent_id, claims, evidence
✓ UUID formats for claim_id, evidence_id, basis_id, parent_basis_id
✓ confidence, weight, overall_confidence in [0, 1]
✓ environment enum values
✓ reverse-DNS pattern for extension keys
✓ Canonical example passes schema validation

All required tests passed.
```

Exit code `0` on all passing checks; non-zero if any test fails.

### 2. Integrate with Your Agent

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "./basis-payload.schema.json";

const ajv = new Ajv({ strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);

const basis = {
  schema_version: "1.0.0",
  basis_id: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  agent_id: "your-agent-id",
  session_id: "session-123",
  parent_basis_id: null,
  claims: [
    {
      claim_id: crypto.randomUUID(),
      text: "Revenue growth is projected at 15% YoY",
      confidence: 0.87,
      confidence_method: "empirical",
      tags: ["revenue", "forecast"],
      status: "asserted"
    }
  ],
  evidence: [
    {
      evidence_id: crypto.randomUUID(),
      claim_ids: ["<claim-1-uuid>"],
      type: "database_record",
      uri: "https://api.your-financial-db.com/reports/2025q1",
      title: "Q1 2025 Revenue Forecast",
      weight: 0.92,
      reported_at: "2025-04-10T10:30:00Z",
      provenance: {
        source_system: "Financial Core",
        source_version: "2.4.1",
        checksum: "a0b1c2d3e4f5..."
      }
    }
  ],
  reasoning_chain: [
    {
      step: 1,
      description: "Load historical revenue data",
      evidence_ids: ["<evidence-1-uuid>"],
      claim_ids: ["<claim-1-uuid>"],
      inference_type: "lookup"
    },
    {
      step: 2,
      description: "Apply growth factor from marketing spend correlation",
      evidence_ids: ["<evidence-2-uuid>"],
      claim_ids: ["<claim-1-uuid>"],
      inference_type: "inductive"
    }
  ],
  uncertainty: {
    overall_confidence: 0.81,
    known_unknowns: ["External economic sanctions not yet modeled"],
    assumptions: ["Marketing spend correlation holds constant"],
    contradictions: []
  },
  context: {
    task_id: "task-basis-projection-123",
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

if (!validate(basis)) {
  console.error("Payload validation failed:", validate.errors);
  // Abort emission or fallback to safe defaults
}
```

### 3. Handle Consumer Validation

When your board receives payloads, validate before processing:

```typescript
const inBasis = JSON.parse(requestBody);
if (!validate(inBasis)) {
  console.warn("Validation warnings/errors:", validate.errors);
  // Log a structured warning; do not reject outright as per AC-6; use WARN level
}

// Safe to render claims/evidence/reasoning_chain/uncertainty
claims.forEach(c => renderConfidenceIndicator(c.confidence));
renderEvidenceTable(basis.evidence);
```

---

## Requirement Traceability

| Requirement | Reference | Implementation Field | Schema Enforcement |
|-------------|-----------|----------------------|-------------------|
| **FR-1 / AC-1** | schema_version semver | `schema_version` pattern ^\d+\.\d+\.\d+$ | required, pattern validation |
| **FR-2** | Identity block | `basis_id`, `created_at`, `agent_id`, `session_id` (nullable), `parent_basis_id` (nullable) | required fields, UUID formats |
| **FR-3** | Claims block | `claims[]` array of claim objects | required array, minItems 1; per-claim required fields |
| **FR-4** | Evidence block | `evidence[]` array at top level | required array, minItems 0; per evidence item required fields |
| **FR-5** | Reasoning chain | `reasoning_chain[]` | optional array; step sequential guidance |
| **FR-6** | Uncertainty block | `uncertainty` | required; fields: `overall_confidence [0,1]`, `known_unknowns[]`, `assumptions[]`, `contradictions[]` |
| **FR-7** | Context block | `context` | required fields; `model_id` required; `environment` enum |
| **FR-8** | Extensions block | `extensions` object (reverse-DNS keys) | patternProperties for extension keys; top-level `additionalProperties: true` warns per AC-6 |
| **FR-9** | Validation schema | `basis-payload.schema.json` (Draft 2020-12) | $id, metadata tags |
| **FR-10** | Canonical example | `example.canonical.json` | validates with script; ACs 2, 3 imply future integration tests |

### AC-1 Resolution Note

FR-4 originally specified each *claim* MAY reference evidence items (per-claim optionality). AC-1 requires the payload to be rejected when `evidence` is missing at the top level. This PRD resolves the tension by:

- Making the top-level `evidence` array **required** (like `claims`).
- Allowing individual evidence items to reference zero or more claims (empty `claim_ids` permitted).
- Documenting the resolution in this README and in `basis-payload.md`.

### AC-6 (Unknown Fields → Warning)

Unknown fields at the root do NOT cause schema validation to fail (non-blocking) per AC-6. The schema uses `additionalProperties: true` at the root; consumers log a warning. Only fields under `extensions` are constrained by the schema (`additionalProperties: false` and `patternProperties`).

### AC-4 (Confidence/Weight Bounds)

All confidence and weight values (per-claim `confidence`, evidence `weight`, and `uncertainty.overall_confidence`) are bounded by `minimum: 0.0` and `maximum: 1.0` in the schema; values outside this range cause validation failures.

---

## Validation Summaries

### Updated by developer (code-creator) on branch builderforce/task-674:
- Document anchor specs in README.md: documented uncertainty summary fields, extensions reverse-DNS validation behavior, and unknown top-level field semantics (all sans radical changes to existing specs). Verified against design doc basis-payload-v1-design.md (gaps/self-consistency checks passed per AC-1, AC-4, AC-6, AC-7, AC-8, AC-2/AC-3 stub anchoring). Performed requirement traceability, and ensured schema linkage matches file artifact basis-payload.schema.json. The validation harness continue to exercise the same tests. Fixed the DA05/7821小红/植松 notes to confirm no breaking changes: constraints reverse-DNS pattern key regex (^[a-z][a-z0-9]*(-[a-z0-9]+)*$) and schema.additionalProperties behavior (root true, extensions false) are preserved. Keep these semantics unchanged from grounding.

### Notes on Requirement Decisions:
- FR-4 per-claim evidence language resolves to top-level required evidence as implementation notes justify and as documented in design. Implementation no longer permits per-claim-only evidence as fully validated structure.
- Unknown top-level fields trigger warnings only; schema root uses additionalProperties:true to avoid blocking validation.
- Extension keys follow reverse-DNS pattern; schema enforces patternProperties.

---

## Versioning

- **Current Version:** `1.0.0`
- **Schema Version String:** `"1.0.0"`
- **Handling:** Consumers MUST reject payloads with major version they do not support (FR-1).
- **Changelog:** See `CHANGELOG.md` for version history (v1.0.0 entry and prior drafts).
- **Tagging:** On merge to `main`, branch should be tagged `basis-payload-v1.0.0` to satisfy AC-8.

---

## Future Work (Out of Scope)

- Transport protocol specification (REST/WebSocket/message queue).
- Storage schema/database table design.
- UI component designs for rendering.
- Authentication/authorization integration.
- Payload compression or binary encoding.
- Real-time streaming of partial payloads.
- Automated basis generation logic (this PRD defines the output contract, not the production).

---

## Audit & Compliance

This ratified specification satisfies the following Trust Service Criteria (TSC) where applicable:

| TSC | How |
|-----|-----|
| availability | Schema is ambient and always present in `spec/basis-payload/`. |
| processing_integrity | JSON Schema validation rejects malformed or out-of-bounds values; producers must validate before emission. |
| confidentiality | Payload attributes are schema-defined; no sensitive data is managed outside the governed contract. |
| privacy | Fields are defined in the spec; agents must align internal data handling with this contract. |

---

## Copyright & License

© SeanHogg/Builderforce.ai. Licensed under the same license as the repository.

---

## Related PRD

**Full PRD:** [`PRD.md`](../../PRD.md) in repository root (task #674).

**Design Document:** [`docs/design/basis-payload-v1-design.md`](../../docs/design/basis-payload-v1-design.md).