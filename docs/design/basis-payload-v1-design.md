# Design: Agent/Board Basis Payload (v1.0.0)

## Architecture Overview

The basis payload is a self-contained data contract that sits in the "grounding layer" between agent reasoning and board rendering.

**Producer:** Agents emit payloads when they produce a response that holds claims.
**Consumer:** Boards, audit tools, and integration services consume payloads to render citations, confidence, and reasoning chains.

The contract is versioned and validated with a JSON Schema artifact. No transport, storage, or UI implementation is defined here.

## Schema Design Rationale

### Top-Level Fields

`schema_version` (required, semver) enables versioned evolution. `basis_id` is globally unique to trace reasoning paths. `parent_basis_id` links refinements/rebuttals for long-running conversations.

### Claim Block

`claims` must be an array of atomic assertions. `confidence` is bounded to `[0.0, 1.0]` with an enum for method (bayesian, heuristic, llm-self-report, empirical). This avoids opaque probability values and enforces explicit reasoning.

### Evidence Block

`evidence` is payload-level, referenced by ID, rather than nested inside each claim. Reasons:
- Reuse: the same doc or tool output may support multiple claims.
- Consistency: ensures each item has a unique identifier (useful for tracking provenance).
- Complexity: shared references are more tractable for large payloads.

`type` is an enum to guide consumer expectations. `weight` is a [0, 1] float indicating support strength per the claim(s) it links.

`provenance` carries system name, version, and optional checksum for database/document consistency checks.

### Reasoning Chain

Linear steps with sequential integers (1, 2, ...). Inference_type is an enum to classify the logical mechanism (deductive, inductive, abductive, analogical, lookup). This helps boards across diverse domains choose an appropriate rendering style per step type.

### Uncertainty Block

Top-level summary surfaces uncertainty comprehensively: overall confidence, known unknowns, assumptions, and contradictions. Boards can use this to show risk ratings or trigger low-confidence alerts.

### Context Block

Includes task context, model info, tool calls, and environment. This enables boards to label if basis came from a specific model or task, and to trace which external services were invoked.

### Extensions Block

Reverse-DNS keying enables domain-specific augmentations (e.g., `com.acme.risk` for risk assessments). Consumers ignore unknown namespaces entirely, enabling future rollouts without breaking older consumers.

## Validation Strategy

Schema validation is enforced in the data plane:

**Producer:** Validate before emission with the JSON Schema. Log warnings for unknown top-level fields (warning-only; per AC-6) and errors for malformed or out-of-range values (confidence, weight, overall_confidence, step numbers).

**Consumer:** Validate before processing. Emit structured error and reject payloads on schema violation. For unknown fields, log a warning but proceed with rendering (per AC-6).

## Versioning Plan

**Phase 1 (v1):** Publish the contract and example payload. No storage or UI work required from other teams (design/documentation only).

**Phase 2 (to be designed separately, outside this PRD):** Extend the schema for streaming, compression, or additional fields, referencing the changelog for migration paths.

## Constraint Rationale

Why rejection for missing `evidence` (AC-1) even though FR-4 says optional?

AC-1 defines a concrete validation rule and mandates rejection on missing fields. FR-4 reflects a design intention: evidence is optional for claims, not globally optional. To avoid ambiguity, v1 requires `evidence` at the payload level (same as `claims`).

---

**Related artifacts:**
- Schema: `spec/basis-payload/basis-payload.schema.json`
- Docs: `spec/basis-payload/basis-payload.md`
- Example: `spec/basis-payload/example.canonical.json`
- PRD: `PRD.md`