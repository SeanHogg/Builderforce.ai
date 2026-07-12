> **PRD** — drafted by Ada (Sr. Product Mgr) · task #215
> _Each agent that updates this PRD signs its change below._

# PRD: Resource Estimation per Project — Human-Days & Agent-Hours

## Problem & Goal

Project planning today relies on gut-feel or ad-hoc spreadsheets to estimate effort, leading to chronic under-resourcing, missed deadlines, and poor capacity planning. There is no consistent, repeatable mechanism to produce two distinct effort dimensions for a project:

1. **Human-days** — calendar-adjusted working days required from human contributors
2. **Agent-hours** — compute hours required from AI/autonomous agents

**Goal:** Deliver a resource estimation feature that, given a project definition, automatically produces a structured estimate of human-days and agent-hours broken down by phase and role/agent-type, with confidence bounds and key assumptions surfaced for review.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Manager / Team Lead** | Staffing decisions, sprint planning, headcount requests |
| **Product Manager** | Roadmap scheduling, dependency management, stakeholder reporting |
| **Program / Delivery Manager** | Cross-project capacity planning, resource allocation |
| **AI/Automation Ops Lead** | Budgeting agent compute costs, provisioning agent infrastructure |
| **Finance / PMO** | Cost forecasting, budget approval workflows |

---

## Scope

### In Scope

- Intake of a project definition (title, description, objectives, known constraints, tech stack tags)
- Decomposition of a project into standard phases (Discovery, Design, Build, Test, Deploy, Stabilisation)
- Per-phase, per-role estimation of **human-days** (e.g., engineer, designer, QA, PM)
- Per-phase, per-agent-type estimation of **agent-hours** (e.g., code-generation agent, test-generation agent, review agent, data-pipeline agent)
- Confidence level per estimate (Low / Medium / High) with stated assumptions
- Aggregate rollup: total human-days, total agent-hours, implied calendar duration at given team size
- Ability to adjust input parameters (team size, parallelism factor, automation coverage %) and see revised estimates
- Export of estimate as structured JSON and human-readable markdown/PDF summary
- Audit trail: inputs, model version, timestamp, and who requested the estimate

### Out of Scope (this version)

- Real-time resource scheduling or gantt chart generation
- Integration with project management tools (Jira, Linear, Asana) — post-MVP
- Financial cost calculation (hourly rates, billing) — post-MVP
- Multi-project portfolio-level optimisation
- Historical actuals ingestion / model fine-tuning loop
- Approval workflows or change-request management

---

## Functional Requirements

### FR-1 Project Intake
- **FR-1.1** The system must accept a structured project brief containing: project name, description (free text, ≤ 2 000 chars), objectives (list), constraints (list), tech stack tags, and target completion date (optional).
- **FR-1.2** The system must validate completeness and prompt for missing required fields before proceeding.
- **FR-1.3** The system must support intake via API (JSON payload) and via a guided UI form.

### FR-2 Phase Decomposition
- **FR-2.1** The system must decompose each project into a default six-phase lifecycle: Discovery, Design, Build, Test, Deploy, Stabilisation.
- **FR-2.2** The user must be able to suppress, merge, or add custom phases before estimation is finalised.
- **FR-2.3** Each phase must carry an estimated start offset (days from project kick-off) and duration in working days.

### FR-3 Human-Day Estimation
- **FR-3.1** For each phase the system must produce effort in human-days per standard role: Product Manager, UX/Designer, Software Engineer (broken down by specialism if determinable), QA Engineer, DevOps/Infra Engineer, Tech Lead/Architect.
- **FR-3.2** Estimates must include a point estimate and a range (optimistic / expected / pessimistic) using a three-point method.
- **FR-3.3** The system must surface the top 3–5 assumptions driving each phase estimate.
- **FR-3.4** The system must accept a `team_size` and `parallelism_factor` parameter and recalculate calendar duration accordingly.

### FR-4 Agent-Hour Estimation
- **FR-4.1** For each phase the system must produce effort in agent-hours per agent type: Code Generation, Code Review / Static Analysis, Test Generation & Execution, Documentation Generation, Data Processing / Pipeline, Orchestration / Planning.
- **FR-4.2** Agent-hour estimates must include an `automation_coverage_%` parameter (default 40 %) that scales agent effort vs. human effort substitution.
- **FR-4.3** Agent estimates must include point estimate and range (optimistic / expected / pessimistic).
- **FR-4.4** The system must flag phases where agent automation coverage is low-confidence due to insufficient project signal.

### FR-5 Confidence & Assumptions
- **FR-5.1** Each estimate (phase-level and aggregate) must carry a confidence rating: **High** (well-defined scope, known stack), **Medium** (some ambiguity), **Low** (novel domain, vague requirements).
- **FR-5.2** Confidence must degrade automatically when required input fields are absent or when free-text description contains ambiguous language patterns.
- **FR-5.3** All assumptions must be enumerated and presented to the user for acceptance or override before the estimate is locked.

### FR-6 Sensitivity & Scenario Analysis
- **FR-6.1** The user must be able to modify `team_size`, `parallelism_factor`, and `automation_coverage_%` and receive a recalculated estimate within 5 seconds.
- **FR-6.2** The system must support saving up to 5 named scenarios per project for side-by-side comparison.

### FR-7 Output & Export
- **FR-7.1** The system must render an interactive summary showing: total human-days, total agent-hours, estimated calendar duration, phase breakdown table, and top assumptions.
- **FR-7.2** The system must export the estimate as:
  - Structured JSON (machine-readable, schema-versioned)
  - Markdown report
  - PDF report (formatted, branded)
- **FR-7.3** Every exported artefact must include: project ID, estimation timestamp, model/engine version, and requesting user ID.

### FR-8 Audit & Versioning
- **FR-8.1** The system must store every submitted estimate with full input snapshot, output snapshot, and metadata.
- **FR-8.2** Re-estimation of the same project must create a new version; previous versions must remain accessible.
- **FR-8.3** Audit records must be immutable after creation.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-01 | Given a complete project brief, the system produces a human-day + agent-hour estimate within 30 seconds | Automated integration test |
| AC-02 | Estimate contains per-phase breakdowns for all six default phases with point + range values | Schema validation of JSON output |
| AC-03 | Confidence rating is present at phase level and aggregate level for every estimate | Schema validation |
| AC-04 | Changing `team_size` from 4 to 8 recalculates and renders updated calendar duration within 5 seconds | UI/API performance test |
| AC-05 | Export generates valid, parseable JSON, Markdown, and PDF artefacts | Automated download + parse test |
| AC-06 | All artefacts include project ID, timestamp, model version, and user ID | Artefact content assertion |
| AC-07 | Re-running estimation on the same project creates a new version; v1 remains retrievable | API version retrieval test |
| AC-08 | When required intake fields are missing, the system blocks estimation and returns specific field-level errors | Negative-path API test |
| AC-09 | Incomplete or ambiguous project brief yields a Low or Medium confidence rating, not High | Manual QA + automated heuristic test |
| AC-10 | Up to 5 named scenarios can be saved and compared side-by-side per project | UI smoke test |

---

## Out of Scope

- Gantt chart or timeline visualisation
- Native integrations with Jira, Linear, Asana, GitHub Projects (planned for v2)
- Cost/budget calculation using loaded hourly or daily rates
- Portfolio-level resource optimisation across multiple concurrent projects
- Actuals capture and feedback loop for model calibration
- Approval or sign-off workflow
- Multi-currency or multi-timezone scheduling logic
- Mobile-native application