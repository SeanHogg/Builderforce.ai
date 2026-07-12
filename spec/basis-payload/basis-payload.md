# Agent/Board Basis Payload — Reference Documentation

> **Version:** 1.0.0 | **Status:** Ratified | **Last Updated:** 2025-01-15

## Overview

The Agent/Board Basis Payload defines a canonical JSON contract for representing **basis** — the structured set of facts, sources, weights, and reasoning context that an agent uses to ground its decisions, and that a board uses to display, audit, and challenge those decisions.

### Problem Solved

Without a canonical schema, each integration (agents, boards, audit tools) invents its own representation, leading to:
- Broken rendering of claims, citations, and confidence indicators
- Untraceable reasoning (no clear link from claim → evidence → inference)
- Impossible cross-agent comparison (different field names, formats, semantics)

This schema provides a single, versioned contract that all agents produce and all boards consume.

## Taxonomy

### Key Concepts

| Term | Definition |
|------|------------|
| **Basis** | A complete artifact emitted by an agent that documents the grounds for its claims. |
| **Claim** | An atomic assertion made by the agent (e.g., "This endpoint returns 200 OK for valid input"). |
| **Evidence** | A source referenced by one or more claims (e.g., a document, database record, tool output). |
| **Confidence** | A numeric value `[0.0, 1.0]` indicating the agent's belief in the claim. |
| **Provenance** | Metadata describing where evidence came from (`source_system`, `checksum`, etc.). |
| **Inference Type** | The logical method used to derive a chain step: deductive, inductive, abductive, analogical, or lookup. |
| **Extensions** | Domain-specific, experimental fields that do not pollute the core schema (reverse-DNS keyed). |

## Payload Structure

### Top-Level Fields

```json
{
  "schema_version": "1.0.0",  // Required
  "basis_id": "uuid-v4",      // Required
  "created_at": "ISO-8601 UTC", // Required
  "agent_id": "string",       // Required
  "session_id": "string | null", // Optional
  "parent_basis_id": "uuid-v4 | null", // Optional
  "claims": [],               // Required
  "evidence": [],             // Required (AC-1)
  "reasoning_chain": [],      // Required
  "uncertainty": {},          // Required
  "context": {},              // Required
  "extensions": {}            // Optional
}
```

### Claim

```json
{
  "claim_id": "uuid-v4",              // Required
  "text": "human-readable assertion",  // Required
  "confidence": 0.94,                 // Required: float [0.0, 1.0]
  "confidence_method": "bayesian | heuristic | llm-self-report | empirical", // Required trait (enum)
  "tags": ["string"],                 // Optional
  "status": "asserted | retracted | superseded" // Optional, default "asserted"
}
```

---

**Schema validation (Draft 2020-12).**

- `confidence` MUST be a float in `[0.0, 1.0]` (AC-4, schema: minimum: 0, maximum: 1).
- `status` defaults to `'asserted'`; values must be one of the enum.
- `confidence_method` MUST be one of the allowed method values.
- `claim_id` MUST be UUID-v4.
- `text` MUST be present.
- `tags` MAY be absent or an empty array.

---

### Evidence

```json
{
  "evidence_id": "uuid-v4",      // Required
  "claim_ids": ["uuid-v4"],      // Required (1+)
  "type": "document | database_record | api_response | agent_output | human_input | computed", // Required trait

  "uri": "string | null",        // Optional
  "title": "string | null",      // Optional
  "excerpt": "string | null",    // Optional
  "retrieved_at": "ISO-8601 UTC | null", // Optional

  "weight": 0.85,                // Required: float [0.0, 1.0]
  "provenance": {
    "source_system": "string",   // Required
    "source_version": "string | null", // Optional
    "checksum": "SHA-256 hex"    // Optional but recommended
  }
}
```

---

**Schema validation (Draft 2020-12).**

- `evidence_id` MUST be UUID-v4.
- `evidence_id` MUST NOT be used more than once across the payload (uniqueness constraint; enforced by producer/consumer).
- `claim_ids` MUST contain at least one non-null value.
- `type` MUST be one of the allowed enum values.
- `weight` MUST be a float in `[0.0, 1.0]` (AC-4).
- `provenance.checksum` MUST be a 64-character SHA-256 hexadecimal string, or `length === 0` + `type !== "computed"`.
- `provenance.source_system` MUST be a non-empty string, or `length === 0` + `type !== "document"`.
- Fields inside `provenance` (source_system, source_version, checksum) are REQUIRED for types {document | database_record | api_response | agent_output} and OPTIONAL for {human_input | computed}.

---

### Reasoning Chain

```json
{
  "step": 1,                               // Required: integer (min: 1)
  "description": "step description",      // Required
  "evidence_ids": ["uuid-v4"],            // Optional
  "claim_ids": ["uuid-v4"],               // Optional
  "inference_type": "deductive | inductive | abductive | analogical | lookup" // Required trait (enum)
}
```

---

**Schema validation (Draft 2020-12).**

- Steps MUST be sequentially numbered starting at 1 (no gaps, no repeats).
- `inference_type` MUST be one of the allowed enum values.
- `step` MUST be an integer `>= 1`.
- `evidence_ids` MAY be empty; lacking evidence_ids means the step is inference-only (not a lookup).
- `claim_ids` MAY be empty (legal: evidence-only contributions before statements).

---

### Uncertainty

```json
{
  "overall_confidence": 0.85,             // Required: float [0.0, 1.0]
  "known_unknowns": ["string"],           // Optional
  "assumptions": ["string"],              // Optional
  "contradictions": [                     // Optional
    {
      "claim_id_a": "uuid-v4",
      "claim_id_b": "uuid-v4",
      "description": "string"
    }
  ]
}
```

---

**Schema validation (Draft 2020-12).**

- `overall_confidence` MUST be a float in `[0.0, 1.0]`.
- `known_unknowns` MAY be empty; each item MUST be a non-empty string, or `length === 0` + `array.length === 0`.
- `assumptions` MAY be empty; each item MUST be a non-empty string, or `length === 0` + `array.length === 0`.
- `contradictions` MAY be empty; each entry MUST have `claim_id_a`, `claim_id_b`, and `description`; these strings MUST be non-empty, or `length === 0` + `array.length === 0`.

---

### Context

```json
{
  "task_id": "string | null",         // Optional
  "task_description": "string | null", // Optional
  "model_id": "string",               // Required
  "model_version": "string | null",    // Optional
  "tool_calls": [                     // Optional (can be empty array)
    {
      "tool_name": "string",          // Required
      "called_at": "ISO-8601 UTC",    // Required
      "input_summary": "string",      // Optional
      "output_summary": "string"      // Optional
    }
  ],
  "environment": "production | staging | development | test" // Required trait (enum)
}
```

---

**Schema validation (Draft 2020-12).**

- `model_id` MUST be a non-empty string.
- Each `tool_calls` entry MUST have `tool_name` (non-empty string) and `called_at` (date-time).
- `environment` MUST be one of the allowed enum values.
- `tool_calls` MAY be empty; once present, all entries must satisfy tool-call constraints.

---

### Extensions

```json
{
  "com.acme.risk": { ... },
  "com.platform.audit": { ... }
}
```

- Namespaces MUST be [reverse-DNS strings](https://en.wikipedia.org/wiki/Reverse_DNS).
- Each namespace's value MAY be any JSON value; consumers MUST ignore unknown namespaces entirely.
- This enables domain-specific extensions without requiring schema updates.

---

## Complete Canonical Example

For a realistic scenario, see
[`example.canonical.json`](./example.canonical.json), which depicts an
agent analyzing an automated test suite and performance baseline.

The example focuses on a fictional task TASK-0123 (verify test correctness
and performance). It demonstrates:

- A single basis with 4 claims (3 asserted, 1 superseded)
- Multiple evidence items spanning API/Doc/Metrics
- A multi-step reasoning chain
- Uncertainty caveats (assumptions, known unknowns)
- Full context with tool calls

---

## Validation Behavior

1. **Producers** MUST validate payloads against the schema (`schema_version >= 1.0.0`).
2. **Consumers** MUST validate payloads before processing; if validation fails they MUST emit a structured error and reject the payload.
3. **AC-1** mandates rejection when missing `schema_version`, `basis_id`, `agent_id`, `claims`, or `evidence`.
4. **AC-6** mandates unknown top-level fields cause a warning (not a hard error) in consumer logs; the schema itself should allow such fields (`additionalProperties: true`).

---

## Agent Integration Guidelines

Producers are agents that generate basis payloads when:
- Emitting a reasoning trace after a model response
- Explaining test failures
- Reporting system health or status
- Rebutting an earlier claim

### Required Steps for Agents

1. **Versioning** — Include a unique `schema_version` (initially `1.0.0`).
2. **Identity** — Generate a fresh `basis_id` (uuid-v4) per emission.
3. **Claims** — Emit at least one claim; ensure each satisfies types and bounds.
4. **Evidence** — For each claim that isn't purely computational, tie to at least one evidence item (type, provenance, weight).
5. **Reasoning** — Encode the agent's logical flow in a stepwise `reasoning_chain`.
6. **Context** — Document the model used, environment, and any tools invoked.
7. **Uncertainty** — Populate `known_unknowns` and `assumptions`; include any contradictions.

### Production Checklist

- All required fields present
- UUID strings for IDs (`basis_id`, `claim_id`, `evidence_id`, `parent_basis_id`, `claim_id_a/b`, `evidence_id_a/b`, `claim_ids`, `evidence_ids`, `tool_calls[].called_at`)
- Floats in `[0.0, 1.0]` for `confidence`, `weight`, `overall_confidence`
- `reasoning_chain.steps` are sequential starting at 1
- `provenance` correct per type (e.g., `checksum` for {document | database_record | api_response | agent_output})
- `inference_type` enum respected
- `session_id` present when applicable; `parent_basis_id` set for refinements

---

## Board Integration Guidelines

Consumers are boards, dashboards, audit tools, or any system that must render basis information.

### Rendering Orders of Preference

1. **Claim Strength** — Rank claims by `confidence`; bold or highlight high-confidence items.
2. **Evidence Correlation** — Display evidence items as clickable cards; show `type`, `weight`, and `provenance`.
3. **Reasoning Chain** — Show steps as a numbered list; annotate inference types where helpful.
4. **Uncertainty** — Visualize `overall_confidence` (progress bar) and list assumptions/known unknowns.
5. **Context** — Show model/version, environment, and task metadata in a collapsible detail panel.

### Warning Handling (AC-6)

When consuming a payload:
- Field names outside the canonical schema should be passed through to logs as warnings but NOT block rendering, as permitting rare extensions without breaking the contract.

### Layout Suggestion

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Basis #b1: Code Analyzer v1 — Task TASK-0123                          │
│ Generated: 2025-01-15T14:30:00Z | Agent: agent-code-analyzer-v1      │
├─────────────────────────────────────────────────────────────────────┤
│ Aggregated Confidence: 85% │ Status: On track                        │
├─────────────────────────────────────────────────────────────────────┤
│ Claims                                                                  │
│ ─────────────────────────────────────────────────────────────────── │
│ 1. The component under test follows the documented contract          │
│    Conf: 94% | Method: empirical | Tags: behavioral, high-confidence│
├─────────────────────────────────────────────────────────────────────┤
│ 2. Error handling paths correctly return 4xx responses for invalid   │
│    Conf: 76% | Method: llm-self-report | Tags: error-handling       │
├─────────────────────────────────────────────────────────────────────┤
│ Evidence                                                                │
│ ─────────────────────────────────────────────────────────────────── │
│ ① [API Response] Health Check Endpoint (weight: 0.85)                 │
│    Source: local-api v1.3.2 | SHA-256: …                              │
│    Excerpt: Status: operational, latency: 12ms...                    │
├─────────────────────────────────────────────────────────────────────┤
│ Reasoning Chain                                                        │
│ ─────────────────────────────────────────────────────────────────── │
│ 1. Ran health check endpoint (inductive)                               │
│ 2. Verified error response rules against docs (deductive)             │
│ 3. Analyzed connection pool metrics (inductive)                        │
│ 4. Archived superseded claim (deductive)                              │
├─────────────────────────────────────────────────────────────────────┤
│ Uncertainty                                                             │
│ ─────────────────────────────────────────────────────────────────── │
│ Assumptions: The health check reflects full system health.            │
│ Known Unknowns: Impact of recent SDK upgrade (v2.8.4) on error codes.│
├─────────────────────────────────────────────────────────────────────┤
│ Context                                                                 │
│ ─────────────────────────────────────────────────────────────────── │
│ Task: Verify automated test suite correctness...                      │
│ Model: gpt-4.1-turbo (2024-07-06) | Env: production                    │
│ Tools: api_status_tool, search_documentation_tool, fetch_metrics_t…   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Migration & Versioning Strategy

### Semantic Versioning

- **NEW TOOLS** MUST emit using `schema_version: 1.0.0` initially.
- When upgrading the schema in the future, bump the major version (e.g., `2.0.0`) for breaking changes (new required fields, type changes).
- Consumers configure a `target_schema_version` and reject payloads older than this target.

### Downgrade Safety

- Consumers SHOULD parse the top-level `schema_version` explicitly and use it to run validation code.
- Avoid silent weave across versions (e.g., using only claim fields when `reasoning_chain` exists in v1.1+).

---

## Future Enhancements (Out of Scope)

- Transport protocols (REST, WebSocket, message queue).
- Storage schema (database tables or document store).
- UI components for visual rendering.
- Authentication/authorization.
- Payload compression or binary encoding.
- Real-time streaming of partial payloads.
- Automated basis generation logic.

---

## References

- **JSON Schema:** [https://json-schema.org/](https://json-schema.org/)
- **Semantic Versioning:** [https://semver.org/](https://semver.org/)
- **Schema Artifact:** [`basis-payload.schema.json`](./basis-payload.schema.json)
- **Example Payload:** [`example.canonical.json`](./example.canonical.json)
- **PRD:** See [PRD.md](../../PRD.md) (task #674).