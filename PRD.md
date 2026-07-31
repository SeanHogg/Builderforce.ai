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

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._

---

> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #343
> _Each agent that updates this PRD signs its change below._

# Velocity Gap Product Requirements Document

## Problem & Goal

The goal of this product is to assist teams and stakeholders in identifying, understanding, and addressing velocity gaps to ensure timely project completion. Velocity gap refers to the difference between the current team velocity and the velocity needed to hit project delivery deadlines.

## Target users / ICP roles (if relevant)

* Product Owners
* Scrum Masters
* Development Teams
* Project Managers

## Scope

The current release includes the following features:

1. Definition of Velocity Gap
2. Understanding Velocity Gap
3. Identifying Velocity Gap
4. Calculating Velocity Gap
5. Addressing Velocity Gap
6. Recommendations and Actions

## Functional requirements

1. **Velocity Gap Definition**: Define the concept and reasons behind velocity gaps.
2. **Understanding Velocity Gap**: Guide users on how to understand the current velocity and the velocity needed to hit project delivery deadlines.
3. **Identifying Velocity Gap**: Provide a visual representation of velocity gaps and options for identification.
4. **Calculating Velocity Gap**: Offer automated calculations and explanations of velocity gap value.
5. **Addressing Velocity Gap**: Recommend actionable items for bridging velocity gaps, such as adjusting the burn-down chart flow, holding stories, or splitting stories.
6. **Recommendations and Actions**: Display visualizations and recommendations for addressing velocity gaps, along with the required actions.

## Acceptance criteria

The development team has accepted the following acceptance criteria for the Velocity Gap product:

1. **Velocity Gap Definition**: The tool can accurately and clearly define the concept of velocity gap.
2. **Understanding Velocity Gap**: The tool provides a clear and helpful explanation of the current velocity and the velocity needed to hit project delivery deadlines.
3. **Identifying Velocity Gap**: The tool can visually represent velocity gaps and present multiple options for identification. It should be possible to input a new velocity gap via the UI.
4. **Calculating Velocity Gap**: The tool should automatically calculate and provide an explanation of the velocity gap value.
5. **Addressing Velocity Gap**: The tool provides a recommended set of actionable items for bridging velocity gaps, along with the corresponding actions.
6. **Recommendations and Actions**: The tool visualizes the requirements for addressing velocity gaps and clearly displays the required actions. The tool should provide both a list of actions with milestones and a visual representation (e.g., Gantt chart).

## Out of scope

The out-of-scope features for this product release include:

* Simulation or simulation-like components to introduce velocity gaps
* Advanced analytics or statistical modeling related to velocity gap analysis
* Integration with external third-party tools or services.
