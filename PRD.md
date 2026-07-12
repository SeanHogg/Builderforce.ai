> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #273
> _Each agent that updates this PRD signs its change below._

# PRD: Canonical Question Set for Project Health Assessment

## Problem & Goal

Project managers, delivery leads, and executives rely on fragmented, inconsistently framed questions when conducting project health reviews. This inconsistency produces incomplete status signals, missed escalations, and misaligned stakeholder expectations. The goal is to define a single, canonical, reusable question set that systematically surfaces the true health of a project across eight dimensions: timeline status, business deadlines, customer deadlines, budget status, team capacity, quality concerns, risk factors, and stakeholder alignment.

---

## Target Users / ICP Roles

| Role | Primary Use |
|---|---|
| Project Manager / Delivery Lead | Weekly and milestone health checks |
| Program Manager | Cross-project portfolio roll-ups |
| Engineering Manager | Team capacity and quality triage |
| Executive Sponsor | Go/no-go and escalation decisions |
| PMO Analyst | Standardizing reporting templates |
| Customer Success Manager | Customer-facing deadline and alignment reviews |

---

## Scope

This PRD covers the **definition, structure, and acceptance criteria** of the canonical question set itself. It does not cover the tooling or UI used to administer the questions. The question set must be tool-agnostic and portable to any review format (meeting agenda, form, survey, AI prompt, or checklist).

---

## Functional Requirements

### FR-1 — Dimension Coverage
The question set **must** include at least one primary question and at least two follow-up / probe questions per dimension. Required dimensions:

1. Timeline Status
2. Business Deadlines
3. Customer Deadlines
4. Budget Status
5. Team Capacity
6. Quality Concerns
7. Risk Factors
8. Stakeholder Alignment

### FR-2 — Question Taxonomy
Each question entry **must** specify:
- `dimension` — which of the eight dimensions it belongs to
- `question_type` — one of: `primary`, `probe`, `escalation-trigger`
- `response_format` — one of: `status-rating`, `free-text`, `date`, `numeric`, `yes/no`
- `escalation_flag` — boolean indicating whether a specific answer pattern mandates escalation

### FR-3 — Canonical Question Definitions

#### Dimension 1 — Timeline Status
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| T1 | primary | What is the current completion percentage versus the planned percentage at this point in the schedule? | numeric | yes |
| T2 | probe | Which milestones have slipped since the last review, and by how many days? | free-text | yes |
| T3 | probe | What is the projected completion date based on current velocity, and how does it compare to the committed date? | date | yes |
| T4 | escalation-trigger | Is the project currently more than 10% behind planned schedule? | yes/no | yes |

#### Dimension 2 — Business Deadlines
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| B1 | primary | What internal business deadlines (regulatory filings, board reviews, product launches, fiscal close) are tied to this project, and are they at risk? | free-text | yes |
| B2 | probe | What is the financial or operational impact if the nearest business deadline is missed by one week? By one month? | free-text | yes |
| B3 | probe | Have any business deadlines changed since the project was last baselined? | yes/no | yes |
| B4 | escalation-trigger | Is any business deadline within 30 days and currently at risk? | yes/no | yes |

#### Dimension 3 — Customer Deadlines
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| C1 | primary | What deliverables are contractually or informally committed to the customer, and what are their due dates? | free-text | yes |
| C2 | probe | Has the customer been informed of any delivery risk, and what was their response? | free-text | yes |
| C3 | probe | Are customer acceptance criteria clearly defined and agreed upon for the next deliverable? | yes/no | no |
| C4 | escalation-trigger | Is any customer-committed deliverable currently projected to miss its due date? | yes/no | yes |

#### Dimension 4 — Budget Status
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| BU1 | primary | What is the current spend versus approved budget, expressed as a percentage of budget consumed versus percentage of work completed? | numeric | yes |
| BU2 | probe | What is the current cost variance (CV) and schedule performance index (SPI)? | numeric | yes |
| BU3 | probe | Are there unforecasted costs or change requests pending approval that could affect the budget baseline? | free-text | yes |
| BU4 | probe | What is the estimate at completion (EAC) compared to the budget at completion (BAC)? | numeric | yes |
| BU5 | escalation-trigger | Is the project forecasting a budget overrun greater than 10% of the approved budget? | yes/no | yes |

#### Dimension 5 — Team Capacity
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| TC1 | primary | What is the current team availability versus the planned allocation for this sprint or phase? | numeric | yes |
| TC2 | probe | Are any critical-path contributors operating at over 100% allocation or at risk of departure? | yes/no | yes |
| TC3 | probe | Are there open roles, skill gaps, or onboarding delays affecting delivery throughput? | free-text | yes |
| TC4 | probe | What is the team's current morale and sustainable pace signal (e.g., overtime hours, sick days, attrition risk)? | status-rating | yes |
| TC5 | escalation-trigger | Has the team lost or is it at risk of losing a single-point-of-failure contributor with no identified backup? | yes/no | yes |

#### Dimension 6 — Quality Concerns
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| Q1 | primary | What is the current defect rate, escaped defect count, or test pass rate, and how does it compare to the quality baseline? | numeric | yes |
| Q2 | probe | Are there open critical or high-severity defects that are blocking acceptance or release? | yes/no | yes |
| Q3 | probe | Has technical debt, code coverage, or architectural risk increased since the last review? | free-text | yes |
| Q4 | probe | Are non-functional requirements (performance, security, accessibility, compliance) on track to be validated before release? | yes/no | yes |
| Q5 | escalation-trigger | Are there open Sev-1 or Sev-2 defects with no accepted resolution path within this sprint? | yes/no | yes |

#### Dimension 7 — Risk Factors
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| R1 | primary | What are the top three risks on the current risk register, ranked by probability × impact, and what is the mitigation status of each? | free-text | yes |
| R2 | probe | Have any risks materialized into issues since the last review? If so, what is the impact and recovery plan? | free-text | yes |
| R3 | probe | Are there external dependencies (third-party vendors, APIs, regulatory approvals, infrastructure) that are unresolved and on the critical path? | yes/no | yes |
| R4 | probe | What assumptions made at project kickoff have since been invalidated? | free-text | yes |
| R5 | escalation-trigger | Is there any risk rated High or Critical with no documented mitigation or owner assigned? | yes/no | yes |

#### Dimension 8 — Stakeholder Alignment
| # | Type | Question | Response Format | Escalation Flag |
|---|---|---|---|---|
| S1 | primary | Do all key stakeholders share a common understanding of the current project scope, timeline, and success criteria? | yes/no | yes |
| S2 | probe | Have there been any scope change requests, conflicting priorities, or direction changes from stakeholders in the past two weeks? | free-text | yes |
| S3 | probe | Who is the accountable decision-maker for the next critical decision, and is that person engaged and available? | free-text | yes |
| S4 | probe | Are there any stakeholders who are disengaged, unsatisfied, or actively escalating concerns outside of the project cadence? | yes/no | yes |
| S5 | escalation-trigger | Is there an unresolved disagreement between stakeholders on scope, priority, or success criteria that is blocking progress? | yes/no | yes |

### FR-4 — Escalation Trigger Aggregation
The question set **must** define an escalation threshold rule: if **three or more** `escalation-trigger` questions return a flag-positive answer in a single review, the review outcome **must** be classified as `RED` and require an executive sponsor notification within 24 hours.

### FR-5 — Scoring and Status Rating
Each dimension **must** produce a status rating using the following scale:

| Rating | Definition |
|---|---|
| `GREEN` | All probes answered satisfactorily; no escalation triggers fired |
| `AMBER` | One or more probe answers indicate concern; no escalation trigger fired |
| `RED` | One or more escalation triggers fired within this dimension |

Overall project health **must** be derived as:
- `GREEN` — zero RED dimensions, two or fewer AMBER dimensions
- `AMBER` — zero RED dimensions, three or more AMBER dimensions
- `RED` — one or more RED dimensions

### FR-6 — Versioning and Traceability
- The question set **must** carry a semantic version number (starting at `v1.0.0`).
- Any modification to question text, escalation flags, or response formats **must** increment the version.
- Each question **must** carry a stable unique ID (e.g., `T1`, `BU3`, `S5`) that does not change on revision; deprecated questions are marked `[DEPRECATED]` rather than deleted.

### FR-7 — Language and Tone Standards
- All questions **must** be written in plain English at a grade 10 reading level or below.
- Questions **must** be answerable by a project manager without requiring specialist finance or engineering knowledge to interpret.
- Questions **must** be written in second-person or neutral framing to avoid blame language.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | All eight dimensions are represented with a minimum of one primary and two probe questions each. |
| AC-2 | Every question entry contains all four required taxonomy fields: `dimension`, `question_type`, `response_format`, and `escalation_flag`. |
| AC-3 | Each dimension has at least one `escalation-trigger` question. |
| AC-4 | The escalation aggregation rule (≥3 fired triggers → RED + 24h notification) is documented and testable. |
| AC-5 | The overall project health scoring logic produces a deterministic single status (GREEN / AMBER / RED) from dimension scores. |
| AC-6 | The question set is assigned version `v1.0.0` and all question IDs are stable and unique. |
| AC-7 | A blind review by two project managers who were not authors confirms all questions are unambiguous and answerable within a 30-minute review session. |
| AC-8 | No question uses jargon that requires a specialist glossary to interpret without a tooltip or inline definition. |
| AC-9 | The full question set can be completed in 30 minutes or less in a facilitated review session. |
| AC-10 | The document is portable and renders correctly in plain markdown, Google Docs, Confluence, and Notion without formatting loss. |

---

## Out of Scope

- **Tooling or platform implementation** — this PRD does not specify any survey tool, project management software integration, or AI interface.
- **Automated data ingestion** — questions requiring answers that could theoretically be auto-populated from JIRA, GitHub, or finance systems are out of scope for this version; answers are assumed to be human-supplied.
- **Industry-specific variants** — vertical adaptations (e.g., construction, clinical trials, regulated finance) are a future version concern.
- **Team or individual performance evaluation** — this question set is a project health instrument, not a performance review tool.
- **Historical trend analysis and dashboarding** — aggregation of scores over time and visualization layers are downstream concerns.
- **Localization and translation** — non-English versions are out of scope for `v1.0.0`.
- **Question weighting models** — differential weighting of dimensions or questions for portfolio scoring is deferred to `v2.0.0`.