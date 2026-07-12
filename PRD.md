> **PRD** — drafted by Ada (Sr. Product Mgr) · task #226
> _Each agent that updates this PRD signs its change below._

# PRD: Human-Approval Bottleneck Inventory with Recommended SLAs

## Problem & Goal

Organizations running AI-assisted or automated workflows frequently stall at human-approval gates. These gates are often undocumented, inconsistently applied, and lack defined turnaround expectations — creating unpredictable cycle times, frustrated stakeholders, and degraded automation ROI.

**Goal:** Produce a structured, actionable inventory of every human-approval bottleneck across targeted workflows, paired with data-informed SLA recommendations, so that teams can set expectations, measure compliance, and prioritize automation or delegation opportunities.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering / DevOps Leads** | Identify release and change-approval gates slowing deployment pipelines |
| **Product Managers** | Understand spec/design sign-off delays impacting roadmap velocity |
| **Operations / Process Owners** | Audit procurement, compliance, and exception-approval queues |
| **Finance Controllers** | Quantify invoice, budget, and spend-approval latency |
| **Legal / Compliance Officers** | Map regulatory review checkpoints and their risk-weighted timelines |
| **Executive Sponsors** | Prioritize bottlenecks by business impact for investment decisions |

---

## Scope

### In Scope

- Approval bottlenecks across the following workflow domains:
  - Software delivery (code review, deployment, security sign-off)
  - Product development (PRD approval, design review, roadmap prioritization)
  - Finance & procurement (PO approval, invoice payment, budget exception)
  - Legal & compliance (contract review, policy exception, data-use authorization)
  - People & HR (offer letter sign-off, headcount approval, policy waiver)
  - Customer-facing (refund authorization, enterprise deal discount approval)
- SLA recommendations expressed as target, acceptable, and breach thresholds
- Risk classification for each bottleneck (Low / Medium / High / Critical)
- Recommended owner role for each SLA

### Out of Scope

- Automated approval logic design or implementation
- Tooling vendor selection
- Audit of non-human (system-to-system) approval gates
- Legal enforceability of SLAs (this document is operational guidance only)

---

## Functional Requirements

### FR-1: Bottleneck Discovery & Classification

1. **FR-1.1** The system/process shall identify and list every distinct human-approval step within each in-scope workflow domain.
2. **FR-1.2** Each bottleneck entry shall capture:
   - Unique ID
   - Workflow domain and sub-process name
   - Approval type (single approver / multi-approver / committee)
   - Approver role(s)
   - Trigger condition (what initiates the approval request)
   - Dependency chain (what is blocked while approval is pending)
3. **FR-1.3** Each bottleneck shall be tagged with a risk classification (Low / Medium / High / Critical) based on business impact if delayed.

### FR-2: Baseline Measurement

1. **FR-2.1** For each bottleneck, current average cycle time shall be recorded (sourced from ticketing systems, audit logs, or stakeholder interviews).
2. **FR-2.2** P50, P75, and P95 latency percentiles shall be captured where data is available; qualitative estimates flagged where data is unavailable.
3. **FR-2.3** Frequency of occurrence (approvals per week/month) shall be recorded to weight business impact.

### FR-3: SLA Recommendation Engine

1. **FR-3.1** Each bottleneck shall receive three SLA tiers:

   | Tier | Definition |
   |---|---|
   | **Target SLA** | Ideal turnaround time under normal conditions |
   | **Acceptable SLA** | Maximum tolerable time before workflow impact becomes significant |
   | **Breach Threshold** | Point at which escalation is automatically triggered |

2. **FR-3.2** SLA recommendations shall be derived from: industry benchmarks, risk classification, frequency, and downstream dependency criticality.
3. **FR-3.3** Each SLA recommendation shall include a rationale note of ≤ 50 words.
4. **FR-3.4** Where current average cycle time already meets or beats the Target SLA, the bottleneck shall be marked **Compliant** and deprioritized.

### FR-4: Escalation & Delegation Guidance

1. **FR-4.1** Each bottleneck entry shall include a recommended escalation path when the Breach Threshold is hit.
2. **FR-4.2** The inventory shall flag bottlenecks that are candidates for:
   - **Delegation** (approval authority pushed to a lower-risk approver)
   - **Automation** (rule-based auto-approval below a defined threshold)
   - **Batching** (low-risk items grouped for periodic review)

### FR-5: Output Deliverable Format

1. **FR-5.1** The inventory shall be exportable as:
   - Structured markdown table (primary)
   - CSV for import into project-management or BI tools
2. **FR-5.2** A summary dashboard view shall list bottlenecks sorted by composite impact score (risk × frequency × current latency).
3. **FR-5.3** Each workflow domain shall have its own section with a domain-level summary and aggregate SLA compliance score.

---

## Acceptance Criteria

| # | Criterion | Pass Condition |
|---|---|---|
| AC-1 | Coverage completeness | ≥ 95% of known approval gates in in-scope domains are captured |
| AC-2 | Data quality | Every entry has a risk classification, approver role, and at least one SLA tier populated |
| AC-3 | SLA rationale | 100% of SLA recommendations include a written rationale note |
| AC-4 | Baseline data | ≥ 70% of entries have quantitative cycle-time data; remainder marked with qualitative estimate and data-gap flag |
| AC-5 | Escalation coverage | 100% of High and Critical bottlenecks have a defined escalation path |
| AC-6 | Automation flags | All bottlenecks assessed for delegation, automation, or batching suitability; flag present on each entry |
| AC-7 | Export functionality | Inventory successfully exports to markdown and CSV without data loss |
| AC-8 | Stakeholder review | At least one domain owner per workflow area has reviewed and signed off on entries for their domain |
| AC-9 | Composite scoring | All entries have a computable impact score; summary view sorts correctly |
| AC-10 | SLA breach definition | Breach threshold is ≥ Acceptable SLA for every entry (no logical inversions) |

---

## Out of Scope

- Design or build of approval workflow tooling
- Integration with ITSM, ERP, or BPM platforms
- Training approvers on new SLAs (covered by a separate change-management workstream)
- Enforcement mechanisms or contractual SLA binding
- Approval gates in external partner or vendor systems not owned by the organization
- Real-time SLA monitoring dashboards (this PRD covers the static inventory and recommendations; monitoring is a Phase 2 initiative)
- Bottlenecks introduced after the inventory cutoff date without a formal change request