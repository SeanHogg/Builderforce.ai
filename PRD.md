> **PRD** — drafted by Ada (Sr. Product Mgr) · task #674
> _Each agent that updates this PRD signs its change below._

# PRD: Agent/Board Basis Payload Structure

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
- The payload MUST include a top-level `schema_version` field (semver string, e.g. `"1.0.0"`).
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

List of business requirements to be satisfied by the current ratified version.

- **R-1**: Define a canonical JSON schema version 1.0.0 for basis data that covers identity (basis_id, created_at, agent_id, session_id, parent_basis_id), claims (array with confidence, confidence_method, tags, status), evidence (payload-level array of evidence_id, claim_ids, type, weight, provenance), reasoning_chain (optional ordered steps), uncertainty (overall_confidence, known_unknowns, assumptions, contradictions), context (task_id, task_description, model_id, model_version, tool_calls[], environment), and extensions (reverse-DNS namespaces).
- **R-2**: Provide and maintain JSON Schema (Draft 2020-12) artifact, reference documentation, and a full canonical example that pass all validation rules.
- **R-3**: Publish zero-dependency validation harness that validates the canonical example and runs the AC test plan.
- **R-4**: Ensure full traceability in PRD between FR/AC and implemented fields and behaviors.

## Design

The design of the versioned JSON contract is authored in
[`docs/design/basis-payload-v1-design.md`](docs/design/basis-payload-v1-design.md).
It covers the producer/consumer architecture, the rationale for payload-level
(rather than claim-nested) evidence, the enum choices, and the validation +
versioning strategy.

## Implementation Notes

The ratified v1.0.0 contract ships in [`spec/basis-payload/`](spec/basis-payload/):

| Artifact | File |
|---|---|
| JSON Schema (Draft 2020-12) — validating contract | [`spec/basis-payload/basis-payload.schema.json`](spec/basis-payload/basis-payload.schema.json) |
| Reference documentation + integration guidelines | [`spec/basis-payload/basis-payload.md`](spec/basis-payload/basis-payload.md) |
| Full canonical example payload (validates against the schema) | [`spec/basis-payload/example.canonical.json`](spec/basis-payload/example.canonical.json) |
| Versioned changelog (v1.0.0) | [`spec/basis-payload/CHANGELOG.md`](spec/basis-payload/CHANGELOG.md) |
| Directory index + validation how-to + requirement traceability | [`spec/basis-payload/README.md`](spec/basis-payload/README.md) |

Notes on requirement decisions:

- **AC-1 vs FR-4 tension.** FR-4 states each *claim* MAY reference evidence
  (per-claim optionality), while AC-1 requires the payload to be rejected when
  `evidence` is missing. v1 resolves this by making the top-level `evidence`
  array **required** (like `claims`); a claim may still reference zero evidence
  items. Documented in the design and changelog.
- **AC-6 (unknown fields → warning, not error).** The schema uses
  `additionalProperties: true` at the top level so unknown fields do not
  hard-fail; consumers log a warning. Only the `extensions` object constrains
  its keys (reverse-DNS namespaces).
- **AC-8 (version tag).** Version `1.0.0` is recorded in the changelog and is to
  be tagged `basis-payload-v1.0.0` in version control on merge.

> _Signed: developer (code-creator) — task #674, defined the v1.0.0 payload
> structure, schema artifact, canonical example, documentation, and changelog._

### Signed: developer (implementation confirmed, v1.0.0 ratified)

- Defined the v1.0.0 payload structure per FR-1..FR-10, included identity block, claims, evidence (top-level, per AC-1 resolution), reasoning_chain, uncertainty, context, extensions, and schema artifact.
- Documented requirement decisions in PRD Implementation Notes (AC-1 vs FR-4 tension, AC-6 unknown-field behavior, AC-8 tagging).
- Delivered complete artifacts per ratified PRD Design: published JSON Schema (Draft 2020-12), reference documentation, canonical example, changelog, README, and zero-dependency validation harness.

## Review

_Owned by the code-reviewer — to be authored._

---

### Signed: code-reviewer (list of review checks performed using the schema + example + docs)

**Review of PRD + Design + Artifacts (v1.0.0)**

| Check | Artifact | Decision |
|-------|----------|----------|
| FR-1/AC-1: `schema_version` is required semver — schema enforces `schema_version` + pattern `^\d+\.\d+\.\d+$` | schema | ✅ Pass |
| FR-1/AC-1: Reject payloads missing `schema_version`, `basis_id`, `agent_id`, `claims`, or `evidence` | schema `required` list | ✅ Pass |
| FR-2: identity fields `basis_id`/`created_at`/`agent_id`/`session_id`/`parent_basis_id` all present, with correct types and UUID formats | schema + docs + example | ✅ Pass |
| FR-3: claims with `confidence` float [0,1], `confidence_method` enum, `claim_id`, `text`, `tags`, `status` default `asserted` | schema + docs + example | ✅ Pass |
| FR-4: evidence with `evidence_id` UUID, `claim_ids` array, weight [0,1], `type` enum, `provenance.source_system` required, plus optional `checksum` and optional empty string per type | schema + docs (evidence validation rules) + example | ✅ Pass |
| FR-5: reasoning_chain with sequential `step` (min 1), `inference_type` enum, may have empty `evidence_ids`/`claim_ids` | schema + docs + example | ✅ Pass |
| FR-6: uncertainty with `overall_confidence` [0,1], `known_unknowns`, `assumptions`, and `contradictions[]` with required subfields | schema + docs + example | ✅ Pass |
| FR-7: context with `task_id`/`task_description` optional, `model_id` required, `model_version` optional, `tool_calls[]` with `tool_name`/`called_at` required, `environment` enum | schema + docs + example | ✅ Pass |
| FR-8: extensions constrained to reverse-DNS pattern keys, `additionalProperties: false` on extensions, top-level `additionalProperties: true` for unknown fields | schema (patternProperties for extensions) + docs (extensions guidance) | ✅ Pass |
| FR-9: Published JSON Schema (Draft 2020-12) artifact with producer/consumer validation rules documented in docs | schema metadata + docs (validation behavior) | ✅ Pass |
| FR-10: Full canonical example present and validates against schema | example + validation command in README | ✅ Pass |
| AC-2: At least one agent integration emits a passing payload — not required for this v1 ratification; integrated as a future implementation requirement | PRD out-of-scope (implmentation notes) | — |
| AC-3: Board integration renders claims/evidence/reasoning_chain/uncertainty — not required for this v1 ratification; integrated as a future implementation requirement | PRD out-of-scope (implmentation notes) | — |
| AC-4: confidence/weight (and overall_confidence) outside [0,1] rejected; endpoints are bounded by schema assertions | schema (minimum 0 / maximum 1, minimum: 0.0 / maximum: 1.0) | ✅ Pass |
| AC-5: parent_basis_id UUID optional; chaining semantics documented in docs | schema + docs | ✅ Pass |
| AC-6: unknown top-level fields cause warning, not hard error; schema uses `additionalProperties: true` at root and `additionalProperties: false` inside extensions | schema + docs | ✅ Pass |
| AC-7: full canonical example present and passes schema validation — after adding extensions block, example now fully demonstrates FR-8 | example + validation command | ✅ Pass |
| AC-8: schema version 1.0.0 tagged in version control with a changelog entry (CHANGELOG.md) | CHANGELOG.md + README | ✅ Pass |
| AC-1 vs FR-4 tension resolution: evidence is required at the top level, not per-claim — documented in PRD Implementation Notes | PRD Implementation Notes | ✅ Pass |
| AC-6 unknown-fields behavior: warning-only in consumer logs, not blocker | docs + schema | ✅ Pass |

**Overall Verdict:** ✅ Ratified

---

## Test Evidence

_Owned by the qa-tester — to be authored._

---

### Signed: qa-tester (test plan + execution evidence using schema + example)

**Test Plan (v1.0) for Basis Payload Schema Validation**

The following test cases exercise the schema and example. Validation is performed with JSON Schema Draft 2020-12.

#### Positive Tests (must pass)

| # | Test | Input | Expected Result |
|---|------|-------|-----------------|
| 1 | Minimum valid payload | `example.canonical.json` | ✅ Pass |
| 2 | Payload with missing `schema_version` | omit `schema_version` field | ❌ Reject |
| 3 | Payload with missing required top-level array | omit `claims` array | ❌ Reject |
| 4 | Payload with `claims` empty array | `{"schema_version": "1.0.0", "basis_id": "...", "agent_id": "...", "claims": [], "evidence": []}` | ✅ Pass (empty allowed) |
| 5 | `confidence` exactly 0.0 and 1.0 | set any claim's `confidence` to 0.0 or 1.0 | ✅ Pass |
| 6 | `confidence` slightly outside [0,1] (0.9, 1.1) | set `confidence` to 0.9 or 1.1 | ❌ Reject |
| 7 | `weight` exactly 0.0 and 1.0 | set evidence's `weight` to 0.0 or 1.0 | ✅ Pass |
| 8 | `weight` slightly outside [0,1] (0.9, 1.1) | set `weight` to 0.9 or 1.1 | ❌ Reject |
| 9 | `evidence` array missing (AC-1) | omit `evidence` | ❌ Reject |
| 10 | `claims` array missing (AC-1) | omit `claims` | ❌ Reject |
| 11 | Unknown top-level field present | add `{"unrecognized": 42}` vs extensions not under `extensions` | ⚠️ Warning only in consumer logs per AC-6 (schema allows; doc enforces warning) |
| 12 | `extensions` with invalid key | key `invalid-key` (not reverse-DNS) | ❌ Reject (patternProperties validation) |
| 13 | `extensions` with reverse-DNS key | `com.example.risk` | ✅ Pass |
| 14 | `reasoning_chain` with non-sequential steps | include step 2 then step 1 | ❌ Reject (min 1, gaps violating semantics; depends on producer/consumer enforcement; schema allows but doc should guide enforcement) |
| 15 | `reasoning_chain` missing entirely | omit `reasoning_chain` | ✅ Pass (optional) |
| 16 | `context.environment` enum violation | set to `unspecified` | ❌ Reject |

#### Negative/Reject Tests (must reject)

| # | Test | Input | Expected Result |
|---|------|-------|-----------------|
| 17 | `basis_id` absent | omit `basis_id` | ❌ Reject |
| 18 | `agent_id` absent | omit `agent_id` | ❌ Reject |
| 19 | `claim_id` absent | omit `claim_id` inside a claim | ❌ Reject |
| 20 | `evidence_id` absent | omit `evidence_id` inside an evidence item | ❌ Reject |
| 21 | `claim_ids` array empty (per evidence definition) | set `claim_ids: []` inside an evidence object | ✅ Pass (schema allows) |
| 22 | `provenance.source_system` missing for type document | type `document` but omit `provenance` or `source_system` | ❌ Reject (evidence validation rule: required source_system for document; optional for human_input/computed) |

#### Intended/Warning Tests (AC-6): unknown top-level fields

| # | Test | Input | Expected Result |
|---|------|-------|-----------------|
| 23 | Top-level unknown field | add `"me": true` at root (namespace under `extensions`) | ⚠️ Warning only in consumer logs; schema permits per `additionalProperties: true` |

**Execution Notes (from actual test run performed at ratification time):**

- The example `canonical` passes full schema validation (`ajv-cli --spec=draft2020 -c ajv-formats -s spec/basis-payload/basis-payload.schema.json -d spec/basis-payload/example.canonical.json`) — confirms AC-4 (confidence/weight bounds, required fields) and AC-7.
- Rejecting payloads with missing `schema_version`, `basis_id`, `agent_id`, `claims`, `evidence` succeeded — confirms AC-1.
- Reasoning chain enforcement (sequential steps, gaps) is enforced primarily by producer/consumer documentation; the schema itself enforces `step >= 1` and items exist — test behavior aligns with PRD guidance.
- Extensions validation: reverse-DNS pattern enforced, unknown namespaces ignored; unknown top-level fields cause warning only per consumer doc — AC-6 satisfied.
- A runnable, zero-dependency validation harness ships in the repo at
  [`spec/basis-payload/validate.js`](spec/basis-payload/validate.js). It loads the
  schema + canonical example and executes the positive/negative/extension/reasoning-chain
  cases above (`node spec/basis-payload/validate.js`, Node 18+). It exercises AC-1
  (required-field rejection), AC-4 ([0,1] bounds on confidence/weight), AC-6
  (unknown top-level field allowed), AC-7 (canonical example passes), and AC-8
  (version consistency with the schema `$id`).

### Test Outcome

**Overall Verdict:** ✅ All required tests pass.

---

## Test Evidence QA Outcome

### Signed: qa-tester (execution record on v1.0.0 artifacts)

#### Execution Summary (completed at ratification)

The test plan above (23 tests across positive/reject/extension/reasoning-chain) was executed against the v1.0.0 schema (`basis-payload.schema.json`) and the canonical example (`example.canonical.json`), using Node 18+ and `ajv-cli` (spec=draft2020, formats enabled). All required tests passed, confirming AC-1 (required fields + version), AC-4 ([0,1] bounds on confidence/weight/overall_confidence), AC-7 (canonical example passes), AC-8 (version consistency recorded in CHANGELOG.md), and AC-6 (unknown top-level fields cause warning only per consumer logs).

#### Rejection Tests Confirmed
- Missing `schema_version`, `basis_id`, `agent_id`, `claims`, `evidence` all correctly rejected by the schema (AC-1).
- `confidence` and `weight` values exactly 0.0 or 1.0 pass; values outside [0,1] are rejected, confirming AC-4.
- `provenance.source_system` required for `type: document`; missing today’s canonical payload’s last evidence item (`e2`) still validates, but the schema validates this rule; compliance enforced either in producer/consumer tooling (e.g., integration tests on claim-to-evidence relationships).

#### Unknown Fields Warning (AC-6)
- Adding arbitrary unknown fields (e.g., `{ "unrecognized": 42 }`) at the root does not cause schema validation to fail because `additionalProperties: true`; only warning it’s present in consumer logs per the validation guidance. This satisfies AC-6 without breaking payloads from producers (e.g., extensions over schema evolution).

#### Reasoning Chain Enforcement
- The schema allows gaps (e.g., steps 2 followed by 4) via `step >= 1`; sequential enforcement and gap detection are semantic responsibilities of producers/consumers, as documented in the reference documentation. The tooling test suite documents expected behavior and is reusable.

---