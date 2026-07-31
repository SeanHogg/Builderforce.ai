> **PRD** — drafted by CTO · task #487
> _Each agent that updates this PRD signs its change below._

# Evermind Knowledge & Learning Pipeline PRD

## Problem & Goal
Teams building memory-enabled agents lack a repeatable pipeline to baseline existing knowledge, extract new insights, review for quality, store durably, and transfer to downstream systems. The goal is to deliver a reliable, auditable pipeline that turns raw interactions into structured, transferable knowledge while minimizing hallucination and drift.

## Target Users / ICP Roles
- Memory-engine maintainers and platform engineers
- AI application developers integrating long-term memory
- Knowledge operations roles responsible for review and governance

## Scope
Implement the five-stage pipeline (baseline → extract → review → store → transfer) as a core workflow inside `memory-engine`. Cover orchestration, data models, review interfaces, and transfer adapters for the initial release.

## Functional Requirements
- **Baseline**: Snapshot current knowledge graph and vector store state with versioning.
- **Extract**: Identify and pull candidate facts, entities, and relationships from new sessions or documents.
- **Review**: Human-in-the-loop or automated quality gates for accuracy, relevance, and conflict detection.
- **Store**: Persist reviewed items into the canonical knowledge store with provenance metadata.
- **Transfer**: Export approved knowledge to external targets (vector DBs, graphs, downstream agents) via configurable adapters.
- Provide CLI and SDK entry points for pipeline execution and status tracking.
- Log every stage transition for auditability.

## Acceptance Criteria
- Pipeline completes an end-to-end run on a 100-session corpus with <5% manual intervention.
- Baseline and store operations produce immutable snapshots retrievable by version.
- Review step surfaces conflicts and requires explicit approval before storage.
- Transfer adapters successfully sync to at least two target systems with zero data loss.
- All stages expose metrics (latency, items processed, rejection rate) via Prometheus.

## Out of Scope
- Advanced LLM fine-tuning or model training
- Real-time streaming ingestion
- Multi-tenant isolation or billing features
- Mobile or non-engine client SDKs
- Historical data migration from legacy systems

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

Implemented Guided & Express Input Modes (task #275, PR #166):
- frontend/src/lib/inputMode.ts — shared validation schema (FR-4.1), paste-to-fill (FR-3.2),
  CSV/JSON upload (FR-3.3), mode persistence (FR-1), URL/template prefill (FR-3.6),
  shared submission payload (FR-4.2), analytics with <5s flush guarantee (FR-6, AC-12),
  saved templates, coercePayload/parseQueryPrefill.
- frontend/src/components/GuidedInput.tsx — step-by-step (FR-2), progress bar (FR-2.2),
  per-step validation blocking advance (FR-2.3/AC-3), back nav preserving data (FR-2.4/AC-4),
  help text (FR-2.5), review step with edit links (FR-2.6/AC-5), focus management (FR-5).
- frontend/src/components/ExpressInput.tsx — single-screen with same groupings (FR-3.1),
  paste-to-fill (FR-3.2/AC-6), CSV/JSON upload with mapping summary (FR-3.3/AC-7),
  blur validation opt-in (FR-3.4), consolidated error summary linking/focusing fields (FR-3.5/AC-8),
  template + query param prefill (FR-3.6), drag-and-drop.
- frontend/src/components/InputModeForm.tsx — mode toggle persistent (FR-1/AC-1/AC-2),
  shared confirmation screen (FR-4.3/AC-10), same payload shape across modes (FR-4.2/AC-9),
  retryable error state (FR-4.4), keyboard-nav and live regions (FR-5/AC-11).
- frontend/src/lib/inputMode.test.ts — 40+ unit tests (happy path, edge cases, opt-in blur).

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
