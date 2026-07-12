> **PRD** — drafted by John Coder ((V2) (Durable)) · task #646
> _Each agent that updates this PRD signs its change below._

# PRD: Payload Basis Explanation Display

## Problem & Goal

Agents and board interfaces currently receive raw payload data without any contextual explanation of the underlying basis — the rules, structure, assumptions, or derivations that give the payload meaning. This creates friction for downstream agents and human reviewers who must reverse-engineer intent, leading to misinterpretation, reasoning errors, and slow decision cycles.

**Goal:** Expose a clear, structured explanation of the payload's basis alongside the payload itself, so that any consuming agent or board UI can immediately understand, display, and reason about the data correctly.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Downstream AI Agents** | Machine-readable basis metadata to condition reasoning and avoid invalid inferences |
| **Board / Dashboard Operators** | Human-readable explanation rendered in the UI for review and audit |
| **Integration Engineers** | Stable schema to build display components and agent connectors against |
| **Product & Compliance Reviewers** | Traceable record of what basis was declared at time of payload emission |

---

## Scope

This PRD covers:

- The **structure and content** of the basis explanation attached to or embedded in a payload
- The **display contract** that board UIs must satisfy when rendering the explanation
- The **consumption interface** that downstream agents must implement to ingest basis metadata
- Validation rules ensuring a payload without a valid basis block is rejected or flagged

---

## Functional Requirements

### FR-1 — Basis Block Structure
Every payload **MUST** include a `basis` object with the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string (uuid)` | Yes | Unique identifier for this basis declaration |
| `version` | `semver string` | Yes | Version of the basis schema in use |
| `summary` | `string (≤ 280 chars)` | Yes | One-sentence human-readable explanation of the basis |
| `detail` | `string (markdown)` | No | Extended explanation, supporting context, derivation steps |
| `source_refs` | `array<string>` | No | URIs or identifiers pointing to authoritative source documents |
| `assumptions` | `array<string>` | No | Explicit assumptions the basis rests on |
| `derived_from` | `array<uuid>` | No | IDs of parent basis declarations this one extends or overrides |
| `confidence` | `float [0.0–1.0]` | No | Emitter's stated confidence in the basis |
| `emitted_at` | `ISO 8601 timestamp` | Yes | When the basis was declared |
| `emitter_id` | `string` | Yes | Identifier of the agent or system that produced the basis |

### FR-2 — Payload Validation
- Payloads missing a `basis` block **MUST** be rejected at ingestion with error code `MISSING_BASIS`.
- Payloads with an incomplete `basis` block (missing required fields) **MUST** be rejected with error code `INVALID_BASIS`.
- Validation **MUST** occur before any downstream agent or board receives the payload.

### FR-3 — Board Display
The board UI **MUST**:

- Render `summary` prominently adjacent to the payload data view.
- Provide an expandable panel rendering `detail` as formatted markdown.
- Display `confidence` as a visual indicator (e.g., percentage bar or color-coded badge).
- List `assumptions` as a distinct, scannable bullet list.
- Link each entry in `source_refs` as a clickable reference.
- Show `emitter_id` and `emitted_at` in a metadata footer.
- Surface a warning banner when `confidence` is below **0.6** or `assumptions` array is non-empty.

### FR-4 — Agent Consumption Interface
Downstream agents **MUST**:

- Parse and validate the `basis` block before processing payload content.
- Treat `assumptions` as conditional premises: any reasoning derived from the payload **MUST** be flagged as assumption-dependent if the `assumptions` array is non-empty.
- Propagate `basis.id` in any derived payload's `derived_from` field.
- Refuse to act on payloads where validation fails, returning a structured error upstream.

### FR-5 — Basis Versioning & Lineage
- The system **MUST** store basis declarations in an append-only log indexed by `basis.id`.
- The system **MUST** be able to reconstruct the full lineage chain for any basis by traversing `derived_from` references.
- Lineage depth **MUST** be capped at **50 hops** to prevent circular or runaway chains; violations return error `BASIS_LINEAGE_OVERFLOW`.

### FR-6 — Schema Evolution
- The `basis` schema **MUST** follow semantic versioning.
- Minor version bumps **MUST** be backward-compatible (additive fields only).
- Major version bumps **MUST** trigger a migration path documented in the changelog and surfaced as a deprecation warning on the board.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A payload emitted without a `basis` block is rejected at ingestion with error `MISSING_BASIS` and never reaches a downstream agent or board. |
| AC-2 | A valid payload with a complete `basis` block is accepted, stored, and routed to consumers within existing SLA. |
| AC-3 | The board renders `summary`, `detail`, `confidence`, `assumptions`, and `source_refs` correctly for a test payload covering all fields. |
| AC-4 | The board displays a warning banner for any payload with `confidence < 0.6` or a non-empty `assumptions` array. |
| AC-5 | A downstream agent receiving a payload with a non-empty `assumptions` array flags all derived outputs as assumption-dependent. |
| AC-6 | A derived payload correctly carries the parent `basis.id` in its own `derived_from` field, and lineage is queryable end-to-end. |
| AC-7 | Lineage traversal beyond 50 hops returns `BASIS_LINEAGE_OVERFLOW` and halts without side effects. |
| AC-8 | Schema version upgrade from a minor bump is processed without breaking existing consumers (backward-compat test passes). |
| AC-9 | All basis declarations are persisted in the append-only log and retrievable by `basis.id` within 1 second (p95). |
| AC-10 | End-to-end test: agent emits payload → board displays basis explanation → second agent consumes and propagates lineage — all steps verified in CI. |

---

## Out of Scope

- **Basis authoring UI** — tooling for humans to compose basis declarations is a separate initiative.
- **Natural language generation of basis summaries** — auto-generation from raw data is not included; emitters supply summaries explicitly.
- **Cross-organization payload exchange** — federation, trust negotiation, and external schema registries are excluded from this release.
- **Real-time collaborative editing of basis declarations** — basis blocks are immutable once emitted; amendment requires a new declaration with `derived_from` reference.
- **Access control and permissioning** — who can emit or view basis data is governed by existing IAM policy; no new permission model is defined here.
- **Payload content validation** — this PRD concerns the basis metadata only; validation of the payload body itself is handled by existing schema contracts.