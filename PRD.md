> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #261
> _Each agent that updates this PRD signs its change below._

# PRD: Resource Plan — Capacity & Cost Estimates

## Problem & Goal

Engineering and product leadership currently lack a consolidated, structured view of the people, time, and budget required to deliver planned work. Capacity is tracked informally across spreadsheets and verbal estimates, making it impossible to detect over-allocation, forecast spend accurately, or make confident trade-off decisions before commitments are made.

**Goal:** Produce a living Resource Plan artifact that translates the approved scope (US-6) into explicit capacity requirements and cost estimates, enabling leadership to approve, adjust, or re-scope work before execution begins.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager / Tech Lead | Validate headcount availability and flag bottlenecks |
| Product Manager | Align resourcing with roadmap priorities and release dates |
| Finance / Budget Owner | Approve spend, track actuals vs. estimates, manage variances |
| Program / Delivery Manager | Coordinate cross-team dependencies and timeline risks |
| VP / Director (Exec Sponsor) | Make go/no-go and trade-off decisions with cost visibility |

---

## Scope

### In Scope

- Capacity model covering all roles required to deliver US-6 deliverables
- Cost estimates (labor + non-labor) per workstream and in aggregate
- Timeline view mapping capacity to sprint/milestone schedule
- Risk-adjusted estimates (best case / base case / worst case)
- Identified capacity gaps and recommended mitigations
- Assumptions log and dependency register (resourcing-relevant)

### Out of Scope

*(See dedicated section below)*

---

## Functional Requirements

### FR-1 — Role & Headcount Inventory

- List every role type required (e.g., frontend engineer, backend engineer, QA, DevOps, designer, PM, tech writer).
- State FTE count, allocation percentage, and availability window for each role.
- Distinguish between committed (confirmed) and provisional (pending) resources.

### FR-2 — Effort Estimation per Workstream

- Break US-6 deliverables into discrete workstreams or epics.
- Provide effort estimates in person-days or story points per workstream, per role.
- Include estimation methodology used (e.g., three-point estimation, reference class forecasting, team velocity).

### FR-3 — Timeline & Capacity Mapping

- Map estimated effort onto a calendar timeline aligned with sprint cadence or milestone gates.
- Surface over-allocation (>100% utilization) and under-utilization visually or via a flag.
- Show critical path and any hard external deadlines.

### FR-4 — Cost Estimation

- Compute labor cost: effort (days) × blended or role-specific daily rate.
- Include non-labor costs: tooling licenses, infrastructure/cloud spend, third-party services, contractor fees.
- Present costs at workstream level and rolled up to total program level.
- Show cost by time period (monthly or per sprint) to support budget phasing.

### FR-5 — Risk-Adjusted Scenarios

- Provide three scenarios: optimistic (–15%), base, pessimistic (+25%) or team-defined variance bounds.
- Identify top 3–5 resourcing risks (e.g., key-person dependency, hiring lag, scope creep) with likelihood and impact ratings.
- For each risk, define a mitigation action and the cost/schedule impact if the risk materializes.

### FR-6 — Capacity Gap Analysis

- Compare available capacity against required capacity per role per period.
- Flag gaps ≥ 20% of required capacity as critical.
- Propose resolution options: re-prioritize, hire/contract, shift timeline, reduce scope.

### FR-7 — Assumptions & Dependencies Register

- Document all assumptions that underpin estimates (e.g., "Design finalized by Week 2," "API contracts stable by Sprint 3").
- List cross-team or third-party dependencies that affect resourcing.
- Each entry must have an owner and a due date.

### FR-8 — Artifact Format & Accessibility

- The Resource Plan must be deliverable as a structured document (Markdown, Confluence page, or spreadsheet with named sheets) that can be version-controlled.
- Must include a one-page executive summary with: total headcount, total duration, total estimated cost (base case), and top 3 risks.
- All data cells must reference source assumptions so estimates are auditable.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Every US-6 workstream has a corresponding effort estimate with role breakdown and methodology noted. | Peer review by Tech Lead and PM |
| AC-2 | Total labor cost and non-labor cost are both present, itemized, and sum correctly to the total program cost. | Finance Owner sign-off |
| AC-3 | Timeline view shows no unresolved over-allocation (>100%) for any role in any sprint without a documented mitigation. | Delivery Manager review |
| AC-4 | Three cost/effort scenarios (optimistic, base, pessimistic) are present with defined variance rationale. | PM and Exec Sponsor review |
| AC-5 | Capacity gap analysis identifies all gaps ≥ 20% and each has at least one resolution option documented. | Engineering Manager sign-off |
| AC-6 | Assumptions and dependencies register is complete: every entry has an owner and due date. | Program Manager audit |
| AC-7 | Executive summary fits on one page (or equivalent scroll-length) and is approved by Exec Sponsor before plan is baselined. | Exec Sponsor written approval |
| AC-8 | The artifact is stored in version control or the designated project wiki with a change log. | Delivery Manager confirmation |

---

## Out of Scope

- **Detailed project schedule / Gantt chart** — owned by the Delivery/Program Management workstream; this plan feeds into it but does not replace it.
- **Individual performance tracking** — this plan deals with roles and allocations, not individual contributor metrics.
- **Procurement process** — vendor selection and contract execution are handled by Legal/Procurement; this plan surfaces the need and estimated cost only.
- **Post-delivery actuals reconciliation** — tracked in the financial reporting process; out of scope for the plan creation phase (though the plan structure should support later actuals comparison).
- **Product roadmap prioritization decisions** — this plan informs trade-offs but does not make them; decisions remain with PM and leadership.
- **HR / hiring process execution** — hiring gaps are flagged here; the hiring workflow itself is owned by People Operations.

---

*Document status: WIP — Awaiting capacity data inputs from Engineering Leads and rate card confirmation from Finance.*
*Last updated: derived from US-6 scope baseline.*