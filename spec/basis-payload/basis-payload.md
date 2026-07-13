# Basis Payload Reference

> **Schema Version:** 1.0.0
> **Specification Status:** Ratified
> **Schema URI:** `https://builderforce.ai/spec/basis-payload/basis-payload.schema.json`

This document is the authoritative reference for the Basis Payload JSON structure — the shared contract that agents and boards use to transmit structured facts, sources, weights, reasoning context, and provenance.

---

## 1. Overview

A **Basis Payload** is a single JSON document containing:

1. **Identity block** — who/what produced it, when, and the unique identifier.
2. **Claims** — atomic assertions the agent is making.
3. **Evidence / Sources** — provenance-tagged data items referenced by claims.
4. **Reasoning Chain** (optional) — ordered steps showing how the agent arrived at each conclusion.
5. **Uncertainty Block** — overall confidence, known unknowns, assumptions, and contradictions.
6. **Context Block** — operational context (model, task, tools used, environment).
7. **Extensions Block** — domain-specific or experimental data under reverse-DNS namespaces.

---

## 2. Full Field Reference

### 2.1. Identity Block

```json
{
  "schema_version": "1.0.0",
  "basis_id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-10-14T12:00:00Z",
  "agent_id": "coderclaw-mock-basis-gen",
  "session_id": null,
  "parent_basis_id": null,
  "sandbox": "development"
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `schema_version` | ✅ | string | MUST match semver pattern `^\d+\.\d+\.\d+$` |
| `basis_id` | ✅ | string | v4 UUID |
| `created_at` | ✅ | string | ISO-8601 UTC (`date-time` format) |
| `agent_id` | ✅ | string | Identifier of the agent that produced this basis |
| `session_id` | ❌ | string \| null | Optional session identifier |
| `parent_basis_id` | ❌ | string (UUID) \| null | Links to a prior basis for refinement/rebuttal chaining |
| `sandbox` | ❌ | string \| null | Optional sandbox/deployment identifier |

### 2.2. Claims

```json
{
  "claims": [
    {
      "claim_id": "550e8400-e29b-41d4-a716-446655440001",
      "text": "The system processes 1,500 transactions per second on average.",
      "confidence": 0.87,
      "confidence_method": "empirical",
      "tags": ["performance", "throughput"],
      "status": "asserted"
    }
  ]
}
```

| Field | Required | Type | Constraints/Values |
|-------|----------|------|-------------------|
| `claim_id` | ✅ | string | UUID v4; globally unique within the payload |
| `text` | ✅ | string | Human-readable assertion; min length 1 |
| `confidence` | ✅ | float | MUST be in range `[0.0, 1.0]` (inclusive) |
| `confidence_method` | ✅ | string | One of: `bayesian`, `heuristic`, `llm-self-report`, `empirical` |
| `tags` | ❌ | string[] | Arbitrary labels for filtering/navigation |
| `status` | ❌ | string | One of: `asserted` (default), `retracted`, `superseded` |

**Validation rules:**
- `claims` array MUST have at least 1 item.
- `confidence` MUST be a float between 0.0 and 1.0 inclusive.
- `status` defaults to `"asserted"` when absent.

### 2.3. Evidence / Sources

```json
{
  "evidence": [
    {
      "evidence_id": "550e8400-e29b-41d4-a716-446655440010",
      "claim_ids": ["550e8400-e29b-41d4-a716-446655440001"],
      "type": "document",
      "uri": "https://example.com/reports/performance-2025-10.md",
      "title": "Performance Testing Report Q3 2025",
      "excerpt": "Average throughput measured at 1,513 TPS across 3 regions.",
      "retrieved_at": "2025-10-14T11:55:00Z",
      "weight": 0.92,
      "provenance": {
        "source_system": "testing-internal",
        "source_version": "v3.2.0",
        "checksum": "sha256hex..."
      }
    }
  ]
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `evidence_id` | ✅ | string | UUID v4; unique within the payload |
| `claim_ids` | ✅ | string[] | Array of UUID v4s referencing claim entries. May be empty. |
| `type` | ✅ | string | One of: `document`, `database_record`, `api_response`, `agent_output`, `human_input`, `computed` |
| `uri` | ❌ | string (URI)\|null | Resolvable identifier for the evidence |
| `title` | ❌ | string \| null | Human-readable evidence title |
| `excerpt` | ❌ | string \| null | Short excerpt for previews |
| `retrieved_at` | ❌ | string (date-time)\|null | When evidence was fetched |
| `weight` | ✅ | float | MUST be in range `[0.0, 1.0]`. How strongly this evidence supports linked claims. |
| `provenance` | ✅ | object | See below |

**Provenance object:**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `source_system` | ✅ | string | The system that produced this evidence (e.g., `github.com`, `postgres-db-01`) |
| `source_version` | ❌ | string \| null | Version of the source system |
| `checksum` | ❌ | string \| null | SHA-256 hex hash for reproducibility |

**Validation rules:**
- `evidence` array is **required at the top level** (like `claims`). It may be empty (`minItems: 0`).
- `weight` MUST be between 0.0 and 1.0 inclusive.
- `provenance.source_system` is **required**.
- `uri` must be a valid URI if present (format: uri).

### 2.4. Reasoning Chain (optional)

```json
{
  "reasoning_chain": [
    {
      "step": 1,
      "description": "Analyzed benchmark results from the performance testing suite.",
      "evidence_ids": ["550e8400-e29b-41d4-a716-446655440010"],
      "claim_ids": ["550e8400-e29b-41d4-a716-446655440001"],
      "inference_type": "inductive"
    }
  ]
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `step` | ✅ | integer | MUST be ≥ 1; steps SHOULD be sequential |
| `description` | ✅ | string | Human-readable reasoning step; min length 1 |
| `inference_type` | ✅ | string | One of: `deductive`, `inductive`, `abductive`, `analogical`, `lookup` |
| `evidence_ids` | ❌ | string[] | UUID v4 references to evidence items |
| `claim_ids` | ❌ | string[] | UUID v4 references to claims |

**Validation rules:**
- `reasoning_chain` is optional; if absent, boards SHOULD render a notice.
- Steps MUST be numbered starting at 1. Schema enforces `step >= 1`.
- Producers SHOULD use sequential step numbers without gaps; consumers MAY detect gaps.

### 2.5. Uncertainty Block (optional)

```json
{
  "uncertainty": {
    "overall_confidence": 0.81,
    "known_unknowns": [
      "How consistent is system throughput during peak hours?"
    ],
    "assumptions": [
      "Benchmark scenarios represent typical production workload."
    ],
    "contradictions": [
      {
        "claim_id_a": "...",
        "claim_id_b": "...",
        "description": "Claim A reports higher throughput than Claim B under same conditions."
      }
    ]
  }
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `overall_confidence` | ✅ | float | MUST be in range `[0.0, 1.0]` |
| `known_unknowns` | ✅ | string[] | Known limitations or gaps in the basis |
| `assumptions` | ✅ | string[] | Explicit assumptions made when producing the basis |
| `contradictions` | ❌ | array of objects | Discrepancies between claims. Each entry requires `claim_id_a`, `claim_id_b`, and `description`. |

### 2.6. Context Block (optional)

```json
{
  "context": {
    "task_id": "TASK-4567",
    "task_description": "Analyze performance test results for Q3 2025",
    "model_id": "claude-3.5-sonnet",
    "model_version": "20250314",
    "tool_calls": [
      {
        "tool_name": "fetch_benchmark",
        "input_summary": "Fetch performance reports for Q3 2025",
        "output_summary": "Retrieved 42 benchmark records across 3 regions",
        "called_at": "2025-10-14T11:30:00Z"
      }
    ],
    "environment": "development"
  }
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `task_id` | ❌ | string \| null | ID of the associated task |
| `task_description` | ❌ | string \| null | Human-readable task description |
| `model_id` | ✅ | string | Model identifier (e.g., `gpt-4`, `claude-3.5-sonnet`) |
| `model_version` | ❌ | string \| null | Specific model version/checkpoint |
| `tool_calls` | ❌ | array of objects | Each tool call has `tool_name`, `input_summary`, `output_summary`, `called_at` |
| `environment` | ✅ | string | One of: `production`, `staging`, `development`, `test` |

### 2.7. Extensions Block (optional)

```json
{
  "extensions": {
    "com.builderforce.project-analysis": {
      "project_risk_score": 0.24
    },
    "com.acme.security": {
      "priority_vulns": 2
    }
  }
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| (arbitrary) | ❌ | object | Key MUST be reverse-DNS: `^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$` |

**Validation rules:**
- Consumers MUST ignore unknown extension namespaces.
- Extension namespaces MUST be reverse-DNS strings (e.g., `com.acme.risk`).
- The `extensions` object uses `additionalProperties: false` — unknown keys outside reverse-DNS are rejected.
- Unknown top-level fields outside `extensions` produce a warning (not error) in consumer logs (AC-6 behavior).

---

## 3. Validation Rules Summary

| Rule | Scope | Enforcement |
|------|-------|-------------|
| `schema_version` must match semver pattern | Top-level | Schema `pattern` |
| `basis_id` must be a valid UUID | Top-level | Schema `format: uuid` |
| `created_at` must be valid ISO-8601 UTC | Top-level | Schema `format: date-time` |
| `claims` array min 1 item | Claims | Schema `minItems: 1` |
| `claim_id` must be UUID | Per claim | `$ref` to uuid definition |
| `confidence` in `[0.0, 1.0]` | Per claim | Schema `minimum/maximum` |
| `weight` in `[0.0, 1.0]` | Per evidence | Schema `minimum/maximum` |
| `evidence` array is required (min 0) | Top-level | Schema `required` |
| `provenance.source_system` required | Per evidence | Schema `required` |
| `reasoning_chain[].step` ≥ 1 | Per step | Schema `minimum: 1` |
| `context.model_id` required | Context | Schema `required` |
| `context.environment` in enum | Context | Schema `enum` |
| Extension keys must be reverse-DNS | Extensions | Schema `patternProperties` |
| Extensions `additionalProperties` false | Extensions | Schema |
| Root unknown fields allowed (warning) | Top-level | `additionalProperties: true` |

---

## 4. Processing Flow

### 4.1. Producer Sequence

1. Gather operational context (model ID, environment, task info, tool call logs).
2. Define claims — each claim is an atomic assertion with confidence and method.
3. Gather evidence — collect sources for each claim with provenance metadata.
4. Optional: build a `reasoning_chain` for step-by-step transparency.
5. Optional: populate `uncertainty` with overall confidence, known unknowns, assumptions.
6. Optional: attach domain-specific data via `extensions` (reverse-DNS namespaces).
7. Validate the payload against `basis-payload.schema.json` before emission.
8. Emit the payload via the agreed transport (REST, WebSocket, message queue).

### 4.2. Consumer Sequence

1. Receive the payload.
2. Validate against `basis-payload.schema.json` (hard error on failure).
3. Log unknown top-level fields as warnings (AC-6).
4. Extract identity block for auditing/tracking.
5. Render claims with confidence bars and evidence citations.
6. Display reasoning chain (if present) or show a notice.
7. Show uncertainty summary (overall confidence, assumptions, contradictions).
8. Show context block (model, environment, tool calls) in a footer/tooltip.
9. Process extensions — ignore unknown namespaces.

---

## 5. Versioning & Changelog

- Schema version follows semver: `MAJOR.MINOR.PATCH`.
- Major version changes require consumer updates (breaking changes to required fields or formats).
- Minor version changes add optional fields or relax constraints.
- Patch version changes fix typos/clarifications without changing validation semantics.
- See [`CHANGELOG.md`](CHANGELOG.md) for history.

---

## 6. Custom Example: Extensions Usage

```json
{
  "extensions": {
    "com.builderforce.project-analysis": {
      "project_risk_score": 0.24,
      "dominant_risk_factors": ["legacy-dependencies", "testing-parity-with-runtime"],
      "kanban-age-days": 18
    },
    "com.acme.security": {
      "priority_vulns": 2,
      "recommendation_rebuttal_threshold": 0.7,
      "compliance-matrix": {
        "soc2-tr-2": "testing",
        "cis-l1-1.0.1": "documented"
      }
    }
  }
}
```

---

## 7. Error Responses (Consumer Validation)

On validation failure, consumers SHOULD emit a structured error response:

```json
{
  "error": "validation_failed",
  "schema_version": "1.0.0",
  "payload_version": "1.0.0",
  "issues": [
    {
      "path": ".claims[0].confidence",
      "message": "Expected number between 0 and 1",
      "value": 1.2
    },
    {
      "path": ".evidence",
      "message": "Missing required array"
    }
  ]
}
```

---

## 8. Integration Guidelines

### For Agent Developers (Producers)

- Use the schema at `basis-payload.schema.json` for validation in your build/CI pipeline.
- Always include at least 1 claim and at least the identity block (`schema_version`, `basis_id`, `created_at`, `agent_id`).
- Provide provenance for every evidence item (`source_system` required).
- Use `reasoning_chain` for any non-trivial inference to aid transparency.
- Document your extension namespaces in your integration guide.

### For Board / UI Developers (Consumers)

- Validate every incoming payload against the published schema before processing.
- Treat `unknown` top-level fields as warnings — log them, do not reject.
- Use the optional `uncertainty` block to display overall confidence, caveats, and contradictions to users.
- Render `reasoning_chain` as steps; show a notice if absent.
- Ignore unknown extension namespaces gracefully.

### For Platform / Infra Engineers

- The JSON Schema artifact published in this directory is the source of truth.
- Version bumps require updating the schema, changelog, README, and example.
- Support `ajv-cli` or `treblle` schema validation in your API gateway for payload-level guard.

---

## 9. Schema URI Resolution

The schema `$id` is:
```
https://builderforce.ai/spec/basis-payload/basis-payload.schema.json
```

Local consumers should use the committed file path (`spec/basis-payload/basis-payload.schema.json`); remote resolution is available from the repository on the `main` branch after merging.

---

> **Ratification Status:** ✅ Ratified v1.0.0 on builderforce.ai/task-674.
> **Maintainers:** Developer (code-creator) | Code Reviewer | QA Tester