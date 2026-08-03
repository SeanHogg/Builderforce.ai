> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #290
> _Each agent that updates this PRD signs its change below._

# PRD: Top 3 Current Risks — Risk Identification & Visibility Tool

## Problem & Goal

Teams lack a shared, authoritative view of the top risks facing the product or project at any given moment. This causes misaligned prioritization, delayed escalations, and reactive rather than proactive decision-making. The goal is to surface, rank, and communicate the top 3 active risks in a lightweight, structured format that any downstream agent or stakeholder can immediately act on.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Product Manager | Prioritize roadmap and mitigation work |
| Engineering Lead | Identify blockers and technical exposure |
| Executive Sponsor | Understand escalation-worthy issues |
| Program / Delivery Manager | Track dependencies and timelines |

---

## Scope

This PRD covers the process and output format for identifying, ranking, and documenting the **top 3 risks** at a given point in time. It applies to any active product, initiative, or sprint in flight.

---

## Functional Requirements

### FR-1: Risk Identification
- The system or process must ingest signals from at least three sources: engineering status, product roadmap, and external dependencies.
- Each risk must be identified by a unique ID and a plain-language title.

### FR-2: Risk Ranking
- Risks must be ranked using a composite score of **Impact × Likelihood** (each scored 1–5).
- The top 3 risks by composite score must be surfaced prominently.

### FR-3: Risk Record Structure
Each risk record must include:
- **Risk ID** — unique identifier
- **Title** — one-line summary
- **Description** — 2–3 sentence explanation of the risk
- **Impact** — score (1–5) + qualitative label (Low / Medium / High / Critical)
- **Likelihood** — score (1–5) + qualitative label
- **Composite Score** — Impact × Likelihood
- **Owner** — named individual or role responsible for mitigation
- **Mitigation Plan** — at least one concrete action with a due date
- **Status** — Open / Mitigating / Resolved

### FR-4: Output & Visibility
- The top 3 risks must be renderable as a markdown table for async consumption by all downstream agents.
- Risks must be reviewable at a cadence no less frequent than weekly.

### FR-5: Escalation Trigger
- Any risk with a composite score ≥ 20 must automatically be flagged for executive review.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Exactly 3 risks are ranked and documented in the standard record format |
| AC-2 | Each risk record contains all 9 required fields with no blanks |
| AC-3 | Composite scores are calculated correctly (Impact × Likelihood) |
| AC-4 | At least one mitigation action per risk includes a named owner and a due date |
| AC-5 | Any risk scoring ≥ 20 is explicitly flagged as requiring executive escalation |
| AC-6 | The output is valid GitHub-flavored markdown readable without additional tooling |

---

## Out of Scope

- Risks beyond the top 3 (full risk register management is a separate workstream)
- Automated real-time risk detection or ML-based scoring
- Integration with third-party risk management platforms (e.g., Jira, ServiceNow) in this iteration
- Historical trend analysis or risk velocity tracking
- Legal, compliance, or security risk domains (handled by dedicated frameworks)

---

---

## Current Top 3 Risks (as of 2026-08-03)

> Identified by Developer agent on task #290

### Risk #1: PR Conflict Cascade — 36 Tickets Blocked

| Field | Value |
|-------|-------|
| **Risk ID** | R-001 |
| **Title** | PR Conflict Cascade — 36 Tickets Blocked |
| **Description** | A significant number of pull requests (36 tickets) are in conflict with the base branch, blocking feature delivery and creating a backlog in the merge train. This affects critical OKR epics including Revenue, Quality, Analytics, Orchestration, and Security workstreams. |
| **Impact** | 5 (Critical) |
| **Likelihood** | 5 (Almost Certain) |
| **Composite Score** | **25** 🚨 |
| **Owner** | Engineering Lead / Platform Team |
| **Mitigation Plan** | 1. Run `git fetch origin && git merge origin/main` on each affected branch; 2. Resolve conflicts manually preserving both intent; 3. Force-push resolved branch; 4. Re-run CI checks. **Due:** 2026-08-10 |
| **Status** | Open |

### Risk #2: Autonomous Agent Not Processing To Do Column Tasks

| Field | Value |
|-------|-------|
| **Risk ID** | R-002 |
| **Title** | Autonomous Agent Not Processing To Do Column Tasks |
| **Description** | The autonomous agent "Kevin BA/PM/PO (Durable)" assigned to the To Do swimlane is not processing new tasks. This blocks the ticket lifecycle and prevents work from entering the delivery pipeline. Currently affecting the BuilderForce.AI board (ID: ad030733-9775-4faa-903f-d6e164a126b5). |
| **Impact** | 4 (High) |
| **Likelihood** | 4 (Likely) |
| **Composite Score** | **16** |
| **Owner** | Platform Engineering / Agent Runtime Team |
| **Mitigation Plan** | 1. Debug agent dispatch loop; 2. Verify board swimlane configuration; 3. Check for stale agent assignments. **Due:** 2026-08-07 |
| **Status** | Open |

### Risk #3: Database Driver Error — No Transactions Support

| Field | Value |
|-------|-------|
| **Risk ID** | R-003 |
| **Title** | Database Driver Error — No Transactions Support in neon-http Driver |
| **Description** | The API endpoint `/api/boards` is returning a 500 Internal Server Error with message `{"error":"No transactions support in neon-http driver"}`. This prevents board creation and manipulation, blocking core platform functionality. The error occurs on POST requests to the boards API. |
| **Impact** | 4 (High) |
| **Likelihood** | 3 (Possible) |
| **Composite Score** | **12** |
| **Owner** | Backend Engineering / Infrastructure Team |
| **Mitigation Plan** | 1. Investigate neon-http driver capabilities; 2. Implement transaction-compatible query layer or switch to supported driver; 3. Add integration tests for DB operations. **Due:** 2026-08-12 |
| **Status** | Open |

---

## Top 3 Risks Summary (Markdown Table)

| ID | Title | Impact | Likelihood | Score | Status | Escalation |
|----|-------|--------|------------|-------|--------|------------|
| R-001 | PR Conflict Cascade — 36 Tickets Blocked | 5 (Critical) | 5 (Almost Certain) | **25** 🚨 | Open | **EXECUTIVE ESCALATION REQUIRED** |
| R-002 | Autonomous Agent Not Processing To Do Tasks | 4 (High) | 4 (Likely) | 16 | Open | — |
| R-003 | Database Driver Error — No Transactions Support | 4 (High) | 3 (Possible) | 12 | Open | — |

---

*Document status: WIP — to be reviewed and updated each weekly risk sync.*