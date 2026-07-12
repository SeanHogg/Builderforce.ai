# Agent/Board Basis Payload Design (v1)

## Purpose
Define the canonical JSON contract for **basis** data so all agents and boards have a shared, versioned payload structure for claims, evidence, reasoning, uncertainty, and context.

**Version:** 1.0.0
**Status:** Ratified (2025-06-XX; task #674)
**Authors:** BuilderForce architect (Ada/Hari)

---

## Constraints & Out of Scope

1. **Transport/Messaging** – How payloads are sent (REST, WebSocket, queue) is not defined here; only the JSON body shape.
2. **Storage Schema** – What tables/document stores are created is separate.
3. **UI/Renders** – How boards display claims, evidence, reasoning chains is left to board developers; the schema carries all fields they need.
4. **Authz** – Who can emit or read payloads is handled by the platform-layer authz.
5. **Compression/Binary** – Payloads are JSON text.
6. **Streaming** – The schema describes a complete, finalized basis; streaming will be a vN+1 variant.
7. **Auto-generation** – This PRD defines the output contract, not how agents compute it.

---

## Payload Structure Overview

### Top-Level Keys
| Key | Type | Required | Description |
|-----|------|----------|--------------|
| `schema_version` | string | yes | SemVer of the schema (e.g., "1.0.0"); consumers must reject if major unsupported |
| `basis_id` | UUID | yes | Unique identifier for this basis instance |
| `created_at` | ISO-8601 UTC | yes | When this basis was produced |
| `agent_id` | string | yes | Agent identifier |
| `session_id` | string | yes | Optional, session-level ID (e.g., human dial-in, conversation circuit ID) |
| `parent_basis_id` | UUID | yes | Links to prior basis (refinement/rebuttal chain) |
| `claims` | Claim[] | yes | Atomic assertions with confidence and evidence references |
| `evidence` | Evidence[] | yes | Sources referenced by evidence_id |
| `reasoning_chain` | ReasoningStep[] | optional | Ordered logical steps linking evidence → claims |
| `uncertainty` | Uncertainty | yes | Top-level summary of confidence and caveats |
| `context` | Context | yes | Operational context (task, model, tools, environment) |
| `extensions` | { [namespace: string]: any } | optional | Open extension slots for domain-specific or experimental fields |

### Extra Fields (Extension Layout) – per AC-6
- Extension namespaces must be reverse-DNS strings (e.g., "com.acme.risk", "com.builderforce.review") and MUST start with a leading dot.
- Consumers MUST ignore unknown extension namespaces.
- When an extension uses `extraExtends` to define its own sub-key with a schema object, only that specific extension’s k is required and the object is expected to be truthy. The parent schema ignores any unknown extension keys.

---

## Field Definitions

### Top-Level Identity Block
- `schema_version`: semver string; must be resolvable by consumer.
- `basis_id`: UUIDv4; globally unique.
- `created_at`: ISO-8601 UTC (no TZ indicator).
- `agent_id`: string (identifies the emitting agent).
- `session_id`: optional string (cases where a session/context ID is applicable).
- `parent_basis_id`: optional UUIDv4; null if independent.

### Claim / Evidence / Reasoning / Uncertainty / Context Sub-Structures
- **Claims:** claim_id, text, confidence, confidence_method, tags (array), status (asserted/retracted/superseded/immediate only; immediate as per FR-3). Confidence in [0.0, 1.0].
- **Evidence:** evidence_id, claim_ids (array), type (document/database_record/api_response/agent_output/human_input/computed), uri/title/excerpt/retrieved_at/weight/provenance (source_system, optional source_version, optional checksum), weight in [0.0, 1.0]; required at payload level.
- **ReasoningChain:** ordered steps; each step has step (1+), description, evidence_ids, claim_ids, inference_type.
- **Uncertainty:** overall_confidence, known_unknowns, assumptions, contradictions (claim_id pairs + text). Confidence in [0.0, 1.0].
- **Context:** task_id/description/model_id/model_version/tool_calls(called_at only, plus tool_name/input_summary/output_summary), environment (production/staging/development/test).

### FR-1 Drivers
- `schema_version` present => validation passes at least FR-1.
- Mismatched major version => consumer must reject.

---

## Example Payload

See `spec/basis-payload/example.canonical.json` for a complete, valid payload illustrating all documented fields.

---

## Extensibility & Validation

- **Extensions:** Use reverse-DNS namespace keys; unknown namespaces ignored. Each extension object is arbitrary; only extraExtends is constrained.
- **Validate:** Clients MUST validate before processing. Length constraints follow license/oem policy (no hard limit; length is in scope of local policy).

---

## Maturity Level
- **Document:** Ratified (requires no further implementation).
- **Implementation:** Next turn (tasks or repo integration may generate payloads conforming to this schema).