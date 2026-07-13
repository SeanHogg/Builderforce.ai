# PRD: Agent/Board Basis Payload Structure

> **PRD** — drafted by Ada (Sr. Product Mgr) · task #674
> _Each agent that updates this PRD signs its change below._

## Problem & Goal

Agents and boards currently lack a shared, well-defined contract for representing **basis** data — the structured set of facts, sources, weights, and reasoning context that an agent uses to ground its decisions and that a board uses to display, audit, and challenge those decisions. Without a canonical payload structure, each integration invents its own schema, leading to broken rendering, untraceable reasoning, and impossible cross-agent comparisons.

**Goal:** Define, document, and ratify a single versioned JSON payload structure that all agents produce and all boards consume when transmitting basis information.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Agent developers** | Need a clear schema to emit valid basis payloads without ambiguity |
| **Board / UI developers** | Need predictable fields to render citations, confidence indicators, and reasoning chains |
| **Auditors / reviewers** | Need enough provenance metadata to trace every claim back to its source |
| **Platform / infra engineers** | Need versioning and validation hooks to reject malformed payloads at ingestion |

---

## Scope

This PRD covers the **design and documentation** of the JSON payload schema only. It does not cover transport protocols, storage backends, or UI rendering implementation.

---

## Functional Requirements

### FR-1 — Schema Versioning
- The payload MUST include a top-level `schema_version` field (semver string, e.g., `"1.0.0"`).
- Consumers MUST reject payloads whose major version they do not support.

### FR-2 — Basis Identity
The payload MUST carry a unique identity block:

```json
{
  "schema_version": "1.0.0",
  "basis_id": "<uuid-v4>",
  "created_at": "<ISO-8601 UTC>",
  "agent_id": "<string>",
  "session_id": "<string | null>",
  "parent_basis_id": "<uuid-v4 | null>"
}
```

- `basis_id`: globally unique identifier for this basis instance.
- `parent_basis_id`: links to a prior basis when this basis is a refinement or rebuttal.

### FR-3 — Claim Block
Each basis MUST contain one or more **claims** — the atomic assertions the agent is making:

```json
{
  "claims": [
    {
      "claim_id": "<uuid-v4>",
      "text": "<human-readable assertion>",
      "confidence": 0.87,
      "confidence_method": "bayesian | heuristic | llm-self-report | empirical",
      "tags": ["<string>"],
      "status": "asserted | retracted | superseded"
    }
  ]
}
```

- `confidence` MUST be a float in `[0.0, 1.0]`.
- `status` defaults to `"asserted"`.

### FR-4 — Evidence / Sources Block
Every claim MAY reference one or more evidence items. Evidence items are defined at the payload level and referenced by ID:

```json
{
  "evidence": [
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
  ]
}
```

- `weight` MUST be a float in `[0.0, 1.0]` indicating how strongly this evidence supports linked claims.
- `provenance.checksum` is optional but RECOMMENDED for reproducibility.

### FR-5 — Reasoning Chain Block
The payload MUST support an optional ordered reasoning chain so boards can display step-by-step logic:

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

- Steps MUST be sequentially numbered starting at `1`.
- A missing or empty `reasoning_chain` is valid; boards SHOULD render a notice when absent.

### FR-6 — Uncertainty & Caveats Block
The payload MUST carry a top-level uncertainty summary:

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

### FR-7 — Context Block
Agents MUST attach the operational context in which the basis was produced:

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

### FR-8 — Extensions Block
The payload MUST include an `extensions` object for domain-specific or experimental fields without polluting the core schema:

```json
{
  "extensions": {
    "<namespace>": { }
  }
}
```

- Consumers MUST ignore unknown extension namespaces.
- Extension namespaces MUST be reverse-DNS strings (e.g., `"com.acme.risk"`).

### FR-9 — Validation
- A JSON Schema (Draft 2020-12) artifact MUST be published alongside this PRD and kept in sync with every schema version bump.
- Payload producers MUST validate against this schema before emission.
- Payload consumers MUST validate before processing and emit a structured error if validation fails.

### FR-10 — Full Canonical Example
A complete, valid example payload MUST be included in the documentation and kept updated with every schema version.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A published JSON Schema file validates all required fields and rejects payloads missing `schema_version`, `basis_id`, `agent_id`, `claims`, or `evidence`. |
| AC-2 | At least one agent integration emits a payload that passes validation without manual patching. |
| AC-3 | At least one board integration renders `claims`, `evidence`, `reasoning_chain`, and `uncertainty` from a valid payload without code changes. |
| AC-4 | `confidence` and `weight` values outside `[0.0, 1.0]` are rejected by the schema. |
| AC-5 | A payload with `parent_basis_id` set correctly chains to a prior payload retrievable by `basis_id`. |
| AC-6 | Unknown fields outside `extensions` cause a validation warning (not a hard error) in consumer logs. |
| AC-7 | The full canonical example payload is present in the documentation and passes schema validation. |
| AC-8 | Schema version `1.0.0` is tagged in version control with a changelog entry. |

---

## Out of Scope

- **Transport / messaging layer** — how payloads are sent (REST, WebSocket, message queue) is not defined here.
- **Storage schema** — database table or document store design is a separate concern.
- **UI component design** — how boards visually render the payload is left to board developers.
- **Authentication / authorization** — securing who can emit or read payloads is handled by the platform layer.
- **Payload compression or binary encoding** — only JSON text encoding is addressed in v1.
- **Real-time streaming of partial payloads** — the schema describes a complete, finalized basis; streaming formats are deferred to a future version.
- **Automated basis generation logic** — this PRD defines the output contract, not how agents compute their basis.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._