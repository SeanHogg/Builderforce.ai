# Basis Payload Specification v1.0.0

## Overview

This document defines the canonical JSON payload structure for transmitting basis data between agents and boards. Basis data provides the structured set of facts, sources, weights, and reasoning context that ground agent decisions and enable board-based verification and challenge.

## Version

**Schema Version:** `1.0.0` (SemVer)

## Scope

This specification defines:
- The complete JSON payload schema
- All required and optional top-level fields
- Nested object structures with constraints
- Validation rules and examples
- Extension patterns for future-proofing

## Required Top-Level Fields

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `schema_version` | string | Yes | SemVer string (e.g., "1.0.0") |
| `basis_id` | UUID v4 | Yes | Globally unique identifier for this basis instance |
| `created_at` | ISO-8601 datetime | Yes | UTC timestamp of when this basis was created |
| `agent_id` | string | Yes | Identifier of the agent that produced this basis |
| `session_id` | string \| null | Yes | Optional session context for the agent |
| `parent_basis_id` | UUID v4 \| null | Yes | Optional reference to a prior basis (refinement/rebuttal) |
| `claims` | array | Yes | Array of claim objects |
| `evidence` | array | No | Optional array of evidence items |
| `reasoning_chain` | array | No | Optional ordered reasoning steps |
| `uncertainty` | object | No | Top-level uncertainty summary |
| `context` | object | Yes | Operational context of the basis generation |
| `extensions` | object | No | Domain-specific extensions |

## Nested Structures

### Claims

Each claim represents an atomic assertion made by the agent.

```json
{
  "claim_id": "<uuid-v4>",
  "text": "<human-readable assertion>",
  "confidence": 0.87,
  "confidence_method": "bayesian | heuristic | llm-self-report | empirical",
  "tags": ["<string>"],
  "status": "asserted | retracted | superseded"
}
```

#### Claim Constraints

- `confidence` MUST be a float in the range `[0.0, 1.0]`
- `confidence_method` MUST be one of the permitted enum values
- `status` defaults to `"asserted"` if not specified

### Evidence

Links external or computed information to one or more claims.

```json
{
  "evidence_id": "<uuid-v4>",
  "claim_ids": ["<uuid-v4>"],
  "type": "document | database_record | api_response | agent_output | human_input | computed",
  "uri": "<string | null>",
  "title": "<string | null>",
  "excerpt": "<string | null>",
  "retrieved_at": "<ISO-8601 UTC | null>",
  "weight": 0.75,
  "provenance": {
    "source_system": "<string>",
    "source_version": "<string | null>",
    "checksum": "<sha256 hex | null>"
  }
}
```

#### Evidence Constraints

- `weight` MUST be a float in the range `[0.0, 1.0]`
- `claim_ids` MUST reference valid `claim_id` values
- `type` MUST be one of the permitted enum values

### Reasoning Chain

Optional ordered steps that led to the final basis.

```json
{
  "reasoning_chain": [
    {
      "step": 1,
      "description": "<string>",
      "evidence_ids": ["<uuid-v4>"],
      "claim_ids": ["<uuid-v4>"],
      "inference_type": "deductive | inductive | abductive | analogical | lookup"
    }
  ]
}
```

#### Reasoning Chain Constraints

- `step` MUST be a sequential integer starting at 1
- `evidence_ids` and `claim_ids` MAY be empty
- `inference_type` MUST be one of the permitted enum values

### Uncertainty

High-level summary of confidence limits and potential issues.

```json
{
  "uncertainty": {
    "overall_confidence": 0.81,
    "known_unknowns": ["<string>"],
    "assumptions": ["<string>"],
    "contradictions": [
      {
        "claim_id_a": "<uuid-v4>",
        "claim_id_b": "<uuid-v4>",
        "description": "<string>"
      }
    ]
  }
}
```

#### Uncertainty Constraints

- `overall_confidence` MUST be a float in the range `[0.0, 1.0]`
- `contradictions` MAY be empty

### Context

Operational metadata about how the basis was generated.

```json
{
  "context": {
    "task_id": "<string | null>",
    "task_description": "<string | null>",
    "model_id": "<string>",
    "model_version": "<string | null>",
    "tool_calls": [
      {
        "tool_name": "<string>",
        "input_summary": "<string>",
        "output_summary": "<string>",
        "called_at": "<ISO-8601 UTC>"
      }
    ],
    "environment": "production | staging | development | test"
  }
}
```

#### Context Constraints

- `environment` MUST be one of the permitted enum values
- `tool_calls` MAY be empty

### Extensions

Domain-specific fields without polluting the core schema.

```json
{
  "extensions": {
    "<namespace>": { }
  }
}
```

#### Extension Constraints

- Keys MUST be reverse-DNS strings (e.g., `"com.acme.risk"`)
- Consumers MUST ignore unknown extension namespaces

## Failure Modes

Consumers MUST reject payloads that violate the following rules:

1. **Missing top-level required fields:** `schema_version`, `basis_id`, `created_at`, `agent_id`, `claims`, `context`
2. **Invalid schema version:** Major version not supported
3. **Out-of-bounds numeric values:** `confidence` or `weight` outside `[0.0, 1.0]`
4. **Invalid enum values:** Enum fields not matching permitted types
5. **Orphaned references:** `claim_ids` or `evidence_ids` that don't exist in the respective arrays
6. **Malformed timestamps:** Timestamps not in ISO-8601 format

Unknown fields outside the `extensions` object SHOULD generate a validation warning, not a hard error.

## Versioning Strategy

When introducing breaking changes:
1. Increment the major version component (e.g., `1.0.0` → `2.0.0`)
2. Update this specification document with the new schema
3. Update the JSON Schema artifact
4. Update the canonical example payload
5. Create a CHANGELOG entry

New non-breaking changes (additional fields, new enum values) may be introduced in the next minor version.

## Security Considerations

- `provenance.checksum` SHOULD be provided for all evidence to enable verification
- `agent_id` SHOULD be cryptographically bound to the agent that produced the basis
- `session_id` MAY be used for correlation without exposing sensitive context
- `parent_basis_id` chains enable audit trails without exposing intermediate reasoning

## Privacy Considerations

- TODO: Define whether sensitive data in `text` fields should be sanitized
- TODO: Define PII handling in `excerpt` fields from retrieved evidence
- TODO: Define whether `context.tool_calls.input_summary/output_summary` should be truncated

## Future Extensions

Potential v1.1 additions:
- `metadata` timestamp subfields (created_at, updated_at, expires_at)
- `result_type` discriminator for different basis purposes (diagnosis, recommendation, validation, etc.)
- `confidence_distribution` numeric array for full uncertainty profile
- `confidence_intervals` array for Bayesian-style uncertainty bounds