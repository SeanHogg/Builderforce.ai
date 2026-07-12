> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #271
> _Each agent that updates this PRD signs its change below._

# PRD: Project Health Report + Resolution Plan + Resource Plan

## Problem & Goal

Engineering and delivery teams lack a unified, structured artifact that simultaneously surfaces project health status, prescribes actionable remediation steps, and aligns resource allocation to resolve identified gaps. This forces stakeholders to synthesize information across scattered status updates, retrospective notes, and headcount spreadsheets — leading to delayed decisions, misaligned priorities, and compounding project risk.

**Goal:** Produce a single, authoritative document — the **Project Health Report + Resolution Plan + Resource Plan** — that gives leadership and delivery teams a clear, timestamped picture of project health, a prioritized plan to resolve issues, and a concrete resource allocation recommendation, all in one reviewable artifact.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager / Delivery Lead | Visibility into blockers, risk areas, and team capacity gaps |
| Program / Project Manager | Structured resolution actions with owners and timelines |
| CTO / VP Engineering | Executive summary of health signals and resource asks |
| Finance / Operations | Headcount and budget alignment to resolution actions |
| Individual Contributors (Tech Leads) | Clear ownership of resolution tasks |

---

## Scope

This PRD covers the generation, structure, and acceptance criteria for the combined **Project Health Report + Resolution Plan + Resource Plan** artifact. It applies to active software delivery projects tracked within the organization's project management tooling.

The artifact may be produced:
- On a recurring cadence (weekly / bi-weekly sprint cycle)
- Ad hoc when a project enters a risk threshold
- At a milestone gate review

---

## Functional Requirements

### FR-1: Project Health Report

**FR-1.1** The report MUST include an overall health status indicator using a standardized rating:
- 🟢 **Green** — On track; no critical blockers
- 🟡 **Yellow** — At risk; issues identified but manageable
- 🔴 **Red** — Off track; critical intervention required

**FR-1.2** The report MUST include the following health dimensions, each individually rated:
- Schedule / Timeline adherence
- Scope / Deliverable completeness
- Quality (defect rate, test coverage, tech debt signals)
- Team Velocity (sprint throughput vs. baseline)
- Dependency & Integration risk
- Stakeholder alignment

**FR-1.3** Each health dimension MUST include:
- Current status rating (Green / Yellow / Red)
- A 2–4 sentence narrative justifying the rating
- Key supporting metrics or data points (e.g., velocity trend, open blocker count, defect density)
- Trend indicator: ↑ Improving | → Stable | ↓ Degrading

**FR-1.4** The report MUST include an executive summary (≤ 150 words) suitable for leadership review.

**FR-1.5** The report MUST capture a snapshot timestamp and the reporting period it covers.

---

### FR-2: Resolution Plan

**FR-2.1** For every health dimension rated Yellow or Red, a corresponding resolution entry MUST be generated.

**FR-2.2** Each resolution entry MUST include:
- **Issue Title** — concise label for the problem
- **Root Cause** — 1–3 sentence diagnosis
- **Resolution Actions** — ordered list of specific, discrete steps
- **Owner** — named individual or role responsible
- **Target Resolution Date** — specific date or sprint
- **Priority** — Critical / High / Medium
- **Success Criteria** — measurable condition confirming resolution
- **Dependencies** — other teams, systems, or decisions required

**FR-2.3** Resolution actions MUST be actionable and unambiguous (avoid vague language such as "improve communication" without specific mechanisms).

**FR-2.4** The Resolution Plan MUST be sortable/filterable by Priority and Owner.

**FR-2.5** A consolidated **Resolution Summary Table** MUST be included at the top of this section listing all issues, owners, priorities, and target dates at a glance.

---

### FR-3: Resource Plan

**FR-3.1** The Resource Plan MUST inventory current resource allocation across the project:
- Team members by role
- Allocated capacity (% or FTE)
- Current assignment / workstream

**FR-3.2** The Resource Plan MUST identify resource gaps directly tied to resolution actions from FR-2, including:
- Skill gaps (missing competencies)
- Capacity gaps (insufficient hours / bandwidth)
- Dependency on external teams or vendors

**FR-3.3** For each identified gap, the Resource Plan MUST include:
- **Gap Description**
- **Linked Resolution Action(s)** from FR-2
- **Recommended Action** — hire, contract, reallocate, upskill, or defer
- **Timeline to Fill**
- **Estimated Cost Impact** (FTE cost, contractor rate, or deferred-risk cost if not filled)
- **Decision Owner** — who must approve the resource action

**FR-3.4** The Resource Plan MUST include a **capacity heatmap or summary table** showing team capacity vs. workload demand across the next 4–8 weeks.

**FR-3.5** The Resource Plan MUST flag over-allocated individuals (>100% capacity) as risk items.

**FR-3.6** The Resource Plan MUST include a **net resource ask summary** — a concise statement of total additional resources requested, cost, and timeline, formatted for executive approval.

---

### FR-4: Document Structure & Formatting

**FR-4.1** The final artifact MUST follow this top-level structure:
1. Cover / Metadata (project name, date, reporting period, author, distribution list)
2. Executive Summary
3. Project Health Report
4. Resolution Plan
5. Resource Plan
6. Appendix (raw data, metrics sources, changelog)

**FR-4.2** The document MUST be produced in GitHub-flavored Markdown, with optional export to PDF.

**FR-4.3** All tables MUST be formatted as GFM tables. Status indicators MUST use consistent emoji or text codes defined in a legend.

**FR-4.4** The document MUST include a **Document Changelog** section tracking version, date, author, and summary of changes.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | All six health dimensions are rated with a status, narrative, metrics, and trend indicator | Manual review of FR-1.2 / FR-1.3 |
| AC-2 | Every Yellow or Red dimension has a corresponding Resolution Plan entry | Cross-reference health ratings with Resolution Plan entries |
| AC-3 | Each resolution entry contains all required fields (FR-2.2) with no blanks | Field completeness check |
| AC-4 | The Resource Plan maps each gap to at least one resolution action | Traceability audit between FR-2 and FR-3 |
| AC-5 | The executive summary is ≤ 150 words and covers overall status, top 3 risks, and net resource ask | Word count + content audit |
| AC-6 | No resolution action uses vague, non-actionable language | Editorial review against FR-2.3 |
| AC-7 | Over-allocated team members are explicitly flagged | Capacity table review |
| AC-8 | The document follows the required top-level structure (FR-4.1) | Structure audit |
| AC-9 | The artifact is valid GitHub-flavored Markdown with no broken table syntax | Markdown lint check |
| AC-10 | A Document Changelog is present with at minimum one entry | Section presence check |

---

## Out of Scope

- **Long-range workforce planning** beyond the 8-week horizon covered by the Resource Plan
- **Budget approval workflows** — this document informs the ask but does not replace finance approval processes
- **Integration with project management tooling** (Jira, Linear, Asana) — data is sourced from those tools but this PRD does not define API or sync behavior
- **Automated generation pipelines** — this PRD defines the artifact, not the tooling to produce it automatically
- **Post-mortem or retrospective format** — resolution actions are forward-looking; root cause analysis depth beyond FR-2.2 is out of scope
- **Individual performance evaluation** — resource gaps and owner assignments must not be used as performance documentation
- **Multi-project portfolio rollup** — this artifact covers a single project; portfolio aggregation is a separate workstream