> **PRD** — drafted by Ada (Sr. Product Mgr) · task #141
> _Each agent that updates this PRD signs its change below._

# PRD: Gap Analysis — OKR Epics vs Actual Codebase State

---

## Problem & Goal

Engineering and product leadership lack a clear, evidence-based view of how the current codebase maps to the five strategic OKR epics. Without this mapping, sprint planning, resourcing decisions, and investor/board communication rest on assumption rather than fact. This document defines the requirements for a structured gap analysis that produces a per-Key-Result implementation status, an OKR-level completion score, and a ranked list of critical blockers — all grounded in traceable code evidence.

---

## Target Users

| Role | Need |
|---|---|
| Engineering Leadership (CTO / VP Eng) | Prioritize technical work against strategic goals; identify where debt or missing foundations block progress |
| Product Leadership (CPO / PM) | Align roadmap and sprint commitments to OKR completion percentages |
| Executive / Board | Understand strategic readiness and risk at a glance |
| Delivery Leads / Tech Leads | Own remediation plans for the critical gaps in their OKR area |

---

## Scope

### In Scope

- All five OKR epics and their documented Key Results:
  - **OKR 1 — Revenue:** Managed hosting, onboarding funnel, marketplace, enterprise license, SOC 2
  - **OKR 2 — Quality:** Orchestration workspace UI, inline diff, session checkpoint, remote streaming, multi-model routing
  - **OKR 3 — Analytics:** Contributor profiles, activity pipeline, Jira/Bitbucket/GitHub integrations, standup reports, dashboards
  - **OKR 4 — Orchestration:** PRD analysis workflow, Temporal engine, policy governance, task DAG UI, cross-agent context
  - **OKR 5 — Security:** DB policy packs, governance portal, audit log, fleet load balancing, Docker self-hosted
- Analysis of the current production codebase (all active repositories/monorepo paths) as the source of truth
- Status classification of each Key Result: **Implemented** / **Partial** / **Not Started**
- Per-OKR percentage-complete score
- Per-OKR top-3 critical gaps that currently block progress toward the objective

### Out of Scope

- Roadmap scheduling or sprint assignment of remediation work
- Business-case analysis or ROI modelling
- Stakeholder interviews or qualitative surveys
- Infrastructure / cloud environment audits (only source code is analysed)
- Future OKR epics not listed above

---

## Functional Requirements

### FR-1 Key Result Inventory

1. For each of the five OKR epics, enumerate every discrete Key Result exactly as described in the epic documentation.
2. Assign each Key Result a unique identifier (`OKR{n}-KR{m}`) to enable traceability throughout the document.

### FR-2 Codebase Cross-Reference

For every Key Result identified in FR-1, the analysis must:

1. Search the codebase (file paths, module names, API endpoints, configuration, schema definitions, CI/CD pipelines) for concrete evidence of implementation.
2. Assign one of three statuses:

| Status | Definition |
|---|---|
| **Implemented** | Core functionality exists, is integrated, and is reachable via a defined interface (API route, UI screen, service, or job). Minor polish gaps are acceptable. |
| **Partial** | Scaffolding, stub, or foundational code exists but the Key Result is not end-to-end functional; critical paths are missing or untested. |
| **Not Started** | No meaningful code artifact related to this Key Result exists in the codebase. |

3. Provide at least one code citation per Key Result (file path, function/class name, or endpoint) supporting the assigned status. Where status is Not Started, explicitly note the absence.

### FR-3 OKR Completion Score

1. For each OKR epic, compute a percentage-complete score using the following point weighting:
   - Implemented = 1.0 point
   - Partial = 0.5 points
   - Not Started = 0.0 points
2. Score formula: `(sum of points / total Key Results) × 100`, rounded to the nearest whole percent.
3. Present the score prominently in both the per-OKR section and a consolidated summary table.

### FR-4 Critical Gap Identification

For each OKR epic, identify exactly **three critical gaps** defined as Key Results whose absence or partial state most severely blocks the parent Objective from being achieved. For each critical gap:

1. State the Key Result identifier and description.
2. Explain the blocking dependency (why this gap prevents OKR progress, not just individual KR progress).
3. Classify the gap type: **Missing Feature**, **Missing Infrastructure**, **Missing Integration**, or **Missing Compliance Artifact**.

### FR-5 Consolidated Summary

Produce a single executive summary table with:
- OKR name
- Total Key Results count
- Implemented / Partial / Not Started counts
- Completion score (%)
- Single-sentence characterisation of the OKR's overall readiness state

### FR-6 Output Format

1. The gap analysis must be delivered as a structured GitHub-flavored Markdown document.
2. Sections must follow this order: Executive Summary → OKR-by-OKR Analysis (FR-1 through FR-4 per OKR) → Appendix (full Key Result status table).
3. Code citations must use inline code formatting for paths and identifiers.
4. The document must be self-contained — readable without access to external tools.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Every Key Result across all five OKR epics has an assigned status (Implemented / Partial / Not Started) with at least one supporting code citation or explicit absence note. |
| AC-2 | Every OKR section contains a calculated percentage-complete score derived from the defined weighting formula. |
| AC-3 | Every OKR section contains exactly three critical gaps, each with a blocking-dependency explanation and gap-type classification. |
| AC-4 | A consolidated executive summary table is present, covering all five OKRs in a single view. |
| AC-5 | No Key Result status is asserted without traceable evidence (file path, endpoint, schema object, or config key). |
| AC-6 | The output is valid GitHub-flavored Markdown renderable without errors. |
| AC-7 | The analysis reflects the codebase state at a single, explicitly stated point in time (commit SHA or date). |

---

## Out of Scope

- Sprint planning, ticket creation, or backlog grooming
- Estimation of effort to close identified gaps
- Architectural recommendations beyond naming the gap type
- Evaluation of code quality, test coverage, or performance within implemented features
- Comparison against competitor products or industry benchmarks
- OKR target-setting or revision of Key Result definitions
- Infrastructure environment audits, penetration testing, or live-system behavioural analysis