> **PRD** — drafted by Ada (Sr. Product Mgr) · task #161
> _Each agent that updates this PRD signs its change below._

# PRD: Learning Review Queue — Human Curation & Evaluation

## Problem & Goal

Extracted learnings from Builderforce workflows accumulate faster than they can be manually reviewed, leading to knowledge-base drift, contradictory entries, and low-confidence noise polluting downstream agent decisions. There is no structured mechanism for human reviewers to efficiently triage, validate, and refine these learnings before they influence production behaviour.

**Goal:** Deliver a human-in-the-loop review system that surfaces extracted learnings with automated scoring and conflict detection, enables reviewers to approve, reject, edit, and merge entries, and groups related learnings into coherent curated units — all integrated with the existing Builderforce approvals framework.

---

## Target Users / ICP Roles

| Role | Responsibility in this system |
|---|---|
| **Knowledge Curator** | Primary queue operator; approves/rejects/merges learnings daily |
| **Domain Expert / Tech Lead** | Resolves contradictions and edits learning content for accuracy |
| **ML / Data Ops Engineer** | Monitors confidence scoring pipeline, tunes thresholds |
| **Product Owner** | Audits curated learning groups; sets baseline policy |
| **Builderforce Approval Admin** | Manages routing rules and escalation paths within the approvals framework |

---

## Scope

This release covers the end-to-end lifecycle of a learning from extraction output to approved knowledge-base entry, including automated pre-processing signals and the reviewer UI/API surface. Integration is scoped to the **existing Builderforce approvals framework** (hooks, routing, audit trail) rather than rebuilding approval infrastructure from scratch.

---

## Functional Requirements

### 1. Review Queue

**FR-1.1** The system shall expose a paginated review queue listing all pending learnings, sortable and filterable by: confidence score, source workflow, extraction timestamp, topic/tag, and conflict status.

**FR-1.2** Each queue item shall display: learning text, source context (workflow ID, step, timestamp), confidence score, conflict flags, duplicate candidates, and suggested group membership.

**FR-1.3** The queue shall support bulk actions: bulk approve, bulk reject, bulk assign to reviewer, and bulk add to group.

**FR-1.4** Reviewers shall be able to claim/lock an item to prevent concurrent edits; locks shall expire after a configurable idle timeout (default 15 minutes).

**FR-1.5** The queue shall integrate with the Builderforce approvals framework, routing items to the correct approver pool based on configurable rules (e.g., domain tag → team, confidence < threshold → senior reviewer).

### 2. Approve / Reject / Edit / Merge Actions

**FR-2.1** **Approve:** A reviewer may approve a learning as-is; approved learnings are promoted to the knowledge base with reviewer identity and timestamp recorded.

**FR-2.2** **Reject:** A reviewer may reject a learning with a mandatory rejection reason (free-text + category enum). Rejected learnings are archived and excluded from the knowledge base but remain auditable.

**FR-2.3** **Edit:** A reviewer may edit the learning text, tags, and metadata before approving. All edits shall be diff-tracked; original extraction is preserved.

**FR-2.4** **Merge:** A reviewer may merge two or more duplicate or highly related learnings into a single canonical entry. The merged entry records all source learning IDs and inherits the union of their metadata. Source entries transition to `merged` status and are excluded from the active queue.

**FR-2.5** All actions shall be persisted to the Builderforce approvals audit log, capturing: actor, action type, before/after state, and ISO-8601 timestamp.

**FR-2.6** Actions shall be available via both the review UI and a versioned REST API to support programmatic or agent-assisted curation.

### 3. Auto Confidence Scoring

**FR-3.1** Every extracted learning shall receive a confidence score (0.00–1.00) computed automatically at extraction time before entering the queue.

**FR-3.2** The scoring model shall consider at minimum: source signal strength, extraction model certainty, corroboration count (how many independent sources support the learning), and recency weight.

**FR-3.3** Confidence scores shall be recalculated when a learning is edited or when new corroborating/contradicting evidence arrives post-extraction.

**FR-3.4** Configurable threshold bands shall drive queue routing:
- `HIGH` (≥ 0.85): eligible for auto-approval if policy permits
- `MEDIUM` (0.60–0.84): standard reviewer queue
- `LOW` (< 0.60): escalate to domain expert / senior reviewer

**FR-3.5** The scoring pipeline shall expose an explanation payload (feature weights) alongside the score to support reviewer trust and auditability.

### 4. Contradiction Detection Against Baseline

**FR-4.1** On ingestion, each new learning shall be compared against the current knowledge-base baseline using semantic similarity and logical-conflict heuristics.

**FR-4.2** If a conflict is detected, the queue item shall be flagged with: conflicting baseline entry ID(s), conflict type (direct negation, partial overlap, temporal supersession), and a similarity score.

**FR-4.3** Conflict-flagged items shall be automatically routed to a dedicated **Contradiction Resolution** sub-queue and shall not be auto-approved regardless of confidence score.

**FR-4.4** A reviewer resolving a contradiction shall choose one of: keep new (deprecate baseline), keep baseline (reject new), merge/reconcile (produce a new canonical entry), or defer (escalate with commentary).

**FR-4.5** Resolved contradictions shall update the baseline atomically; partial or failed updates shall roll back and alert the ML/Data Ops Engineer.

### 5. Deduplication

**FR-5.1** On ingestion, semantic deduplication shall run against both the pending queue and the approved knowledge base.

**FR-5.2** Candidate duplicates (similarity ≥ configurable threshold, default 0.90) shall be surfaced inline on the queue item card with a side-by-side diff.

**FR-5.3** Near-duplicates (0.75–0.89 similarity) shall be flagged as "related" and suggested as merge candidates without blocking the review action.

**FR-5.4** Exact duplicates (hash-based) shall be automatically collapsed to a single queue item with a count of suppressed sources; no reviewer action required to deduplicate.

**FR-5.5** Deduplication results shall feed back into confidence scoring (corroboration count in FR-3.2).

### 6. Curation — Grouping Related Learnings

**FR-6.1** The system shall automatically suggest learning groups using topic modelling / clustering on pending and approved learnings.

**FR-6.2** A curator may create, rename, merge, split, and archive groups via the UI and API.

**FR-6.3** Each group shall have: a human-readable name, optional description, an owner role, member learning IDs, and a coherence score (automated).

**FR-6.4** Approved learnings shall be publishable at the group level, enabling downstream agents to consume a coherent thematic unit rather than individual entries.

**FR-6.5** Group membership changes shall not alter the approval status of individual learnings; a learning may belong to multiple groups.

**FR-6.6** The UI shall provide a group-centric view (Kanban-style or tree) in addition to the flat queue view.

### 7. Notifications & SLAs

**FR-7.1** Reviewers shall receive configurable notifications (in-app, email, Slack webhook) when: items are assigned to them, SLA breach is approaching, or a contradiction is flagged on a learning they approved.

**FR-7.2** Queue items shall carry SLA deadlines configurable by confidence band and domain; breached items shall be auto-escalated per Builderforce approvals routing rules.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-01** | A reviewer can open the queue, see all pending learnings with scores and flags, and complete an approve/reject/edit/merge action in ≤ 3 clicks from the queue list view. |
| **AC-02** | Confidence scores are present on 100 % of learnings entering the queue; score explanation payload is non-empty. |
| **AC-03** | Contradiction detection runs within 10 seconds of learning ingestion (p95) and correctly flags ≥ 90 % of direct-negation conflicts in the acceptance test dataset. |
| **AC-04** | Exact-duplicate learnings are collapsed automatically with zero reviewer intervention required; deduplication is verified by hash comparison in automated tests. |
| **AC-05** | Semantic duplicate candidates at ≥ 0.90 similarity are surfaced on the queue item before a reviewer submits any action. |
| **AC-06** | All approve/reject/edit/merge actions appear in the Builderforce approvals audit log within 5 seconds and are retrievable via the audit API. |
| **AC-07** | Merge of N learnings produces exactly one canonical entry; all N source IDs are recorded; source entries are marked `merged` and absent from the active queue. |
| **AC-08** | Auto-approval (HIGH confidence, policy enabled) promotes a learning to the knowledge base without human interaction and records the system actor in the audit log. |
| **AC-09** | A group can be created, populated with ≥ 2 approved learnings, and published; downstream agents can fetch the group payload via API. |
| **AC-10** | Lock expiry releases a claimed item back to the queue automatically after the configured idle timeout (verified by integration test with time-mocked clock). |
| **AC-11** | SLA breach on a queue item triggers escalation routing within 60 seconds of deadline (verified in staging environment). |
| **AC-12** | REST API endpoints for all queue actions return documented responses and pass OpenAPI contract tests. |

---

## Out of Scope

- **Extraction pipeline** — ingestion and initial extraction of learnings from raw workflow data is owned by a separate system; this PRD assumes learnings arrive at a well-defined ingestion API.
- **Knowledge-base storage layer** — schema design and persistence of approved learnings beyond the promotion event are managed by the Knowledge Base service team.
- **Model retraining / active learning loops** — using approved/rejected labels to retrain the extraction model is a future phase.
- **End-user (non-reviewer) facing UI** — surfacing curated learnings to end users or agents is handled by the Knowledge Base consumption API, not this system.
- **Rebuilding the Builderforce approvals framework** — routing rules engine, approver-pool management, and core audit infrastructure are consumed as-is; this system adds hooks and routing configurations only.
- **Real-time collaborative editing** — simultaneous multi-reviewer editing of a single learning is not supported; the lock model (FR-1.4) is the concurrency mechanism for this release.
- **Multi-language / multilingual learning content** — all learnings are assumed to be in English for this release; localisation is deferred.
- **Mobile-optimised review UI** — the review interface targets desktop browsers (≥ 1280 px viewport); responsive/mobile layouts are out of scope.