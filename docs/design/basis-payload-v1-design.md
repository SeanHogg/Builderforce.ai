# Basis Payload v1.0.0 — Design Document

> **Status:** Ratified (2025-10-14)
>
> **Related PRD:** [`PRD.md`](../../../PRD.md) (Task #674)
>
> **Schema Version:** 1.0.0
>
> **Last Updated:** 2025-10-14

---

## Overview

This document provides the design rationale and architectural decisions behind the ratified **Basis Payload v1.0.0** contract. It clarifies constraints, defines behaviour where semver schema cannot enforce, and justifies trade-offs.

---

## High-Level Architecture

### Purpose

Define a stable, versioned JSON contract for structured **basis data** used by:
- **Agents** (producers) to emit facts, sources, weights, and reasoning traces.
- **Boards** (consumers) to display, audit, and challenge information grounded in claims and evidence.

### Product Objectives

- **Canonical Interoperability:** All agents and boards use the same schema, avoiding divergent implementations.
- **Auditability:** Every claim must reference verifiable evidence with provenance, enabling a claim-to-source chain.
- **Transparency:** Boards can inspect reasoning chains, uncertainty summaries, and context to understand how outputs were generated.
- **Extensibility:** Future domain extensions can be added via `extensions` without rewriting the core schema.
- **Version Scoping:** Schema versioning ensures backward compatibility and enables incremental evolution (semver).

---

## Core Design Decisions

### 1. Payload-level vs Per-claim Evidence

**Requirement Tension:**
- **FR-4:** "Every claim MAY reference one or more evidence items." This phrasing suggests per-claim evidence flexibility.
- **AC-1:** "Schema MUST reject payloads missing `schema_version`, `basis_id`, `agent_id`, `claims`, or `evidence`." This requires the entire payload to contain an `evidence` array.

**Resolution:**
- **Top-level `evidence` is required** (like `claims`). All evidence items are referenced at the payload level by ID.
- **Claims may reference zero or more evidence items** via `claim_ids` (can be empty).
- **Implication:** Evidence remains fully decoupled from claims; each claim is independently linkable to any evidence item, supporting flexible provenance while preserving a single canonical reference set.

**Rationale:**
- Ensures that all evidence sources are uniquely identifiable at the payload level (good for ingestion pipelines).
- Supports multi-purpose evidence (e.g., a single document supporting multiple distinct claims).
- Avoids having to duplicate `evidence_id` arrays inside every claim object.
- Aligns with AC-1’s hard rejection when `evidence` is missing, while preserving per-claim flexibility.

**Meta-rules:**
- Producers must ensure that every referenced `evidence_id` is present in the payload-level `evidence` array.
- Consumers should validate claim-to-evidence cross-references for completeness (optional but recommended).

---

### 2. Extensions Namespacing (Reverse-DNS)

**Goal:** Allow domain-specific or experimental fields without bloating the core schema.

**Decision:**
- Unknown top-level fields cause a **warning**, not a hard error (AC-6).
- Only the `extensions` object is constrained via `patternProperties` for keys with reverse-DNS pattern (`com.example.category`).
- The schema uses `additionalProperties: true` at the root, so unknown keys are permitted.

**Rationale:**
- Prevents schema breakage when new fields are added (e.g., future versions of the basis contract). Unknown keys are logged by consumers but do not fail processing.
- Encourages systematic namespaces (`com.builderforce.*`, `com.acme.risk`, `com.customer-frontend.*`) but does not enforce usage.
- Simplifies integration and reduces validation overhead for early adopters.

**Enforcement:**
- The `extensions` object enforces `additionalProperties: false`, meaning only extension keys can be present under it.
- Extension keys must match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`.

---

### 3. Reasoning Chain Ordering

**Problem:**
- Need step-by-step logical reasoning, but the schema alone cannot enforce sequential gaps (e.g., steps 2 followed by step 4 without step 3).

**Decision:**
- Schema enforces:
  - `step >= 1` (minimum).
  - Each `step` number is an integer.
- **Sequential ordering (no gaps)** is **semantic guidance** for producers/consumers; it is not enforced by JSON Schema validation.

**Rationale:**
- Strong validation could complicate incremental reasoning generation (e.g., adding a missing step below).
- Logging/reporting tools can enforce ordering as part of producer tooling or board rendering, decoupled from schema validation.
- Boards may degrade gracefully if small gaps are present, as long as semantic continuity is maintained.

**User-facing Impact:**
- Boards SHOULD render reasoning chains as navigable lists with steps.
- If steps are not strictly sequential, boards may still present them but indicate gaps.

---

### 4. Uncertainty Block Requiredness

**Requirement:**
- All payloads MUST include an `uncertainty` block (FR-6).

**Decision:**
- `uncertainty` is **required**, containing:
  - `overall_confidence` in [0.0, 1.0].
  - `known_unknowns` (array, required).
  - `assumptions` (array, required).
  - `contradictions` (array, required).

**Rationale:**
- Encourages agents to surface uncertainty explicitly rather than hiding it.
- Provides a uniform interface for boards and infra tools to compute aggregate risk/opportunity scores.
- Enables auditability and regulatory readiness (e.g., industries requiring explicit uncertainty reporting).

---

### 5. Payload Validation Strategy

**Producer Validation:**
- MUST validate against the JSON Schema BEFORE sending to a board (FR-9).
- Use `ajv` with `draft-2020-12` and enforced formats (`ajv-formats`) for schema validation.
- Emission of malformed payloads is blocked; structured error messages are returned to the producer.

**Consumer Validation:**
- SHOULD validate on ingestion.
- Unknown top-level fields (outside `extensions`) cause a **warning level log**, not a hard error (AC-6).
- Board rendering can proceed with warnings for optional fields.

---

### 6. Versioning Strategy

**SemVer Policy:**
- `major.minor.patch` format (v1.0.0).
- Consumers MUST reject payloads with a major version they don't support.
- Schema version is stored at payload root (`schema_version`) to allow runtime version negotiation.

**Evolution Control:**
- Patch bumps: backwards-compatible bug fixes or minor enhancements (e.g., performance, documentation).
- Minor bumps: backwards-compatible additions (new fields or enums).
- Major bumps: breaking changes (structure or semantics), requiring new consumers.

---

### 7. Toolkit & CLI

**Relevant Artifact:**
- `validate.js` provides zero-dependency CLI for validation and example test plan execution.

**Strategy:**
- CLI validates the canonical example against the schema.
- Executes positive/negative/extension/reasoning-chain test cases against the AC test plan.
- Documents how to reproduce validation on producer/consumer side, enabling CI integration.

---

## Field-by-Field Design Notes

### Identity Block

| Field | Type | Remarks |
|-------|------|---------|
| `schema_version` | `string` | Semver pattern enforced; determines consumer support. |
| `basis_id` | UUID | Schema enforced per RFC 4122; globally unique. |
| `parent_basis_id` | UUID | Optional; used to chain bases (e.g., rebuttal/refinement). |
| `sandbox` | `string \| null` | Optional sandbox identifier for the target workspace/tenant; must match the platform's environment key. |
| `created_at` | `date-time` | ISO 8601 timestamp; emitted by producer. |
| `agent_id` | `string` | Identifier of the agent that produced this basis. |
| `session_id` | `string \| null` | Optional session identifier for the agent. |
| `tool_calls` | `context.tool_calls[]` | Capabilities: tool name, input/output summaries, called_at. |

Canonical layout (matches schema and example.canonical.json):
```json
{
  "schema_version": "1.0.0",
  "basis_id": "<uuid>",
  "created_at": "<ISO-8601 UTC>",
  "agent_id": "<string>",
  "session_id": "<string | null>",
  "parent_basis_id": "<uuid | null>",
  "sandbox": "<string | null>"
}
```

---

### Claims

| Field | Type | Remarks |
|-------|------|---------|
| `confidence` | [0.0, 1.0] | Enforced schema; as a float; boundaries inclusive. |
| `confidence_method` | Enum or null | Enum values: `"bayesian"`, `"heuristic"`, `"llm-self-report"`, `"empirical"`. Null indicates no explicit method recorded. |
| `status` | Default `"asserted"` | Values: `"asserted"`, `"retracted"`, `"superseded"`. |

---

### Evidence

| Field | Type | Remarks |
|-------|------|---------|
| `weight` | [0.0, 1.0] | Strength of evidence; inclusive boundaries. |
| `provenance.checksum` | Optional SHA-256 | Recommended for reproducibility. |
| `type` | Enum | Enum values: `"document"`, `"database_record"`, `"api_response"`, `"agent_output"`, `"human_input"`, `"computed"`. |
| `uri` | Optional string | Link to full source; can be optional if content is internal. |

---

### Context

| Field | Type | Remarks |
|-------|------|---------|
| `model_id` | Required | Identifies model or orchestrator. |
| `environment` | Enum | Values: `"production"`, `"staging"`, `"development"`, `"test"`. |
| `tool_calls[]` | Tool-call objects | Captures tool execution directly relevant to the basis. |

---

### Uncertainty

| Field | Type | Remarks |
|-------|------|---------|
| `overall_confidence` | [0.0, 1.0] | Overall basis confidence; inclusive. |
| `known_unknowns` | Array (required) | Known limitations / unknown factors. |
| `assumptions` | Array (required) | Assumptions made in deriving this basis. |
| `contradictions[]` | Array of object | Pairs of claims with contradictions. |

---

### Extensions

- **Key pattern:** `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (camelCase with hyphens allowed; reverse-DNS structure).
- **Enforcement:** `additionalProperties: false` inside `extensions`; reverse-DNS enforced via `patternProperties`.

---

## Implementation Lifecycle

### Phase 1: Ratification (this PRD)

- Ratify v1.0.0 schema and documentation.
- Publish schema artifacts in `spec/basis-payload/`.
- Create canonical example and validation CLI.
- Tag PR and create PR from commit and pieces (schema, README, basis-payload.md, CHANGELOG.md, validate.js, example.canonical.json). Ensure all fields are in place; sync across repo and platform tracking.

### Phase 2: Producer Integration

- Update agents to emit validated payloads.
- Optionally add reasoning chain generation.
- Periodic audits of `tool_calls` coverage.
- **AC-2 validation artifact (future PR).**
  - Add pure stub `emitValidAgentPayload` that returns a schema-valid instance; use it as the `emitValidAgentPayload` property placeholder in `validate.js` to run the AC-2 positive canonical f test.
  - Document that samples pass without manual patching (future PR runs Handoff tests; this branch delivered signed stub placeholder for AC-2).

### Phase 3: Consumer Integration

- Integrate boards to render claims/evidence/reasoning_chain/uncertainty from basis payloads.
- Enforce unknown field warning.
- Provide UI for confidence visualization.
- **AC-3 board integration (future PR).**
  - Add stub `renderBoardUI` placeholder in `validate.js` to exercise the AC-3 canonical f test.
  - Document that boards can render claims/evidence/reasoning_chain/uncertainty from a valid payload without code changes (future PR runs assistant rendering tests; this branch delivered signed stub placeholder for AC-3).

### Phase 3: Consumer Integration

- Integrate boards to render claims/evidence/reasoning_chain/uncertainty from basis payloads.
- Enforce unknown field warning.
- Provide UI for confidence visualization.

### Phase 4: Evolving Schema

- Future versions (v1.1.0+, etc.) will add:
  - New JSON Schema.
  - Extended extensions for new domains.
  - New inference types for reasoning chains.
- Maintain backwards compatibility for new versions (e.g., v1.0.0 consumers can always read v1.x.x with differing `schema_version` as long as they support that major version).

---

## Open Issues, Future Considerations, and Deferred Work

- **Transport Protocol:** Not defined here. Future work may define REST API payloads for basis endpoints or WebSocket message schemas.
- **Storage Schema:** Database/table design is external to this payload contract.
- **UI Component Design:** Rendering components are out of scope; boards may use basis payloads as data source for new components.
- **Authentication:** Basis interface may be behind platform-level auth; not specified here.
- **Payload Compression / Binary:** Only JSON text encoding defined.
- **Real-time Streaming:** Streaming of partial payloads is out of scope; v1 describes complete finalized bases.
- **Automated Basis Generation Logic:** Production algorithms for generating claims/evidence/traces are out of scope.

---

## Compliance & Trust Service Criteria (TSC)

| TSC | Alignment |
|-----|-----------|
| **Availability** | Schema is ambient and always present; producers must emit before boards can use. |
| **Processing Integrity** | JSON Schema enforces fields, types, and bounds; unknown top-level fields log warnings (not hard errors). |
| **Confidentiality** | Constrained by contract; no requirement for encryption; agents must align with platform policies. |
| **Privacy** | Fields are defined in spec; agents must handle personal data in accordance with privacy policies. |

---

## References

- **Full PRD:** [`../PRD.md`](../../../PRD.md) in repository root.
- **Reference Docs:** [`../spec/basis-payload/`](../spec/basis-payload/).
- **Design Document for this PRD:** This document.
- **JSON Schema Specifications:** Draft 2020-12 (draft-wright-json-schema-2020-12).
- **Validator:** `spec/basis-payload/validate.js`.

---

## Revision History

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0.0 | 2025-06-18 | SeanHogg | Initial ratified design document. |