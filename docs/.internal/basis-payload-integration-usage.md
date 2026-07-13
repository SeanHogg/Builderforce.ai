# Basis Payload Integration Usage

This guide explains how producers and consumers should handle unknown fields when using the Basis Payload v1.0.0 contract.

## Overview

The Basis Payload schema permits unknown top-level fields via `additionalProperties: true` (`root` only). Per AC-6, unknown fields outside `extensions` should produce a warning in consumer logs, not a hard error.

To avoid ambiguity and log pollution, producers should:

- Wrap all unknown or domain-specific data in the `extensions` object using reverse-DNS namespaces.
- Leave no unknown top-level fields outside `extensions`.

## Producer Syntax

Use reverse-DNS namespace keys under `extensions`. Example:

```json
{
  "schema_version": "1.0.0",
  "basis_id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-10-14T12:00:00Z",
  "agent_id": "coderclaw-mock-basis-gen",
  // ... required fields ...

  "extensions": {
    "com.builderforce.project-analysis": {
      "project_risk_score": 0.24,
      "dominant_risk_factors": [
        "legacy-dependencies",
        "testing-parity-with-runtime"
      ]
    },
    "com.acme.security": {
      "priority_vulns": 2,
      "recommendation_rebuttal_threshold": 0.7
    }
  }
}
```

Top-level unknown fields outside `extensions` should not be emitted because:

- They cause consumer warning logs (AC-6).
- They obscure the contract boundaries and may be incompatible with schema evolution.
- In v1, they're treated as warnings-only, which is symbolic rather than informative for boards that consume payloads.

If a producer carries legacy data fields that are not part of this contract, they must be placed under `extensions` for future-proofing.

## Consumer Processing

1. Validate the payload against the schema. The validator should log warnings for unknown top-level fields outside `extensions` (AC-6).
2. If a warning appears, producers should be informed so they can refactor the payload into `extensions`.
3. Board/UI implementations should:
   - Render known blocks (identity, claims, evidence, reasoning_chain, uncertainty, context).
   - Ignore `extensions` entirely unless the board has specific support for a namespace.
   - Optional: surface unknown top-level fields as warnings to product/engineering teams.

## Version Future-Proofing

When extending the payload in a later schema version (e.g., v1.1.0):

| Situation | Handling |
|-----------|----------|
| New MUST fields | Update the JSON schema and update the required list. Consumers rejecting unsupported major versions will update backend contracts. |
| New OPTIONAL fields | Add properties entry in the schema. Producers may omit them at v1.0.0 without breaking consumer validation. |
| Breaking changes | Bump major version. Update the PRD, design doc, and migration notes. Consumers that reject unsupported major versions will interpret new fields as unknown `extensions` (with warning semantics if client code is still in the same major context). |

No unknown fields should be emitted top-level without being under `extensions`. This ensures AC-6 is satisfied both nominally (schema-level) and operationally (log policy).