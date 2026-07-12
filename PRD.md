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

*Document status: WIP — to be reviewed and updated each weekly risk sync.*