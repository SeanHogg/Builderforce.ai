> **PRD** — drafted by Ada (Sr. Product Mgr) · task #499
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Budget Constraints – Persistence, Burn-Rate & Nested Budgets

**Status**: Work in Progress
**Author**: [Product Architect]
**Date**: [YYYY-MM-DD]

## Problem & Goal
### Problem
1. **Data Loss**: Budget definitions and spend data are stored in-memory, causing loss on service restart or failover.
2. **Stale Reporting**: Dashboards reflect charges only on periodic syncs, leading to >12-hour lag in visibility.
3. **No Historical Context**: Lack of 24-month history prevents trend analysis and compliance reporting.
4. **Flat Budgeting**: Teams cannot model nested/rolled-up budgets (e.g., department → team → project), leading to manual spreadsheets.
5. **Double-Counting Risk**: Shared resources (e.g., shared Kubernetes cluster) may be counted in multiple budget envelopes, distorting projections.

### Goal
Provide durable, real-time budget tracking with nested aggregation, accurate burn-rate projections, and full historical retention while eliminating double-counting.

## Target Users / ICP Roles
- **Finance Teams**: FP&A, Cost Controllers – need 24-month spend history for accruals and audit.
- **Engineering Mgmt**: VP, Directors, Team Leads – require nested budgets aligned with org hierarchy.
- **FinOps Analysts**: Need <15-min cost updates and end-of-period projections to prevent overspend.

## Scope
### In Scope
1. **Persistence Layer**: Replace in-memory Maps with durable storage (PostgreSQL or cloud-native alternative).
2. **Real-Time Cost Ingestion**: Integrate with cloud billing APIs to update spend within 15 minutes of accrual.
3. **Write-Through Updates**: Ensure dashboard reflects new charges via CDC or push-based ingestion.
4. **Burn-Rate Calculation**: Compute current burn rate (rate per period) and project end-of-period spend based on current trend.
5. **Historical Retention**: Store 24 months of raw spend data and daily snapshots.
6. **Nested Budget Aggregation**: Support unlimited tree depth (parent → child) without double-counting shared resources.
7. **Required Field Validation**: Enforce non-null values on budget creation (`name`, `owner`, `period`, `amount`).

### Out of Scope
- Forecasting based on ML or seasonality (future phase).
- Currency conversion or multi-currency budgeting.
- Granular resource-level tagging or charge-back mechanism.
- UI/UX for budget editor beyond functional requirements.

## Functional Requirements
| ID          | Requirement                                                                                             | Priority |
|-------------|--------------------------------------------------------------------------------------------------------|----------|
| FR-1.2      | Support nested budgets with aggregation without double-counting.                                      | High     |
| FR-3.1      | Persist all budget definitions and spend history in durable storage.                                 | High     |
| FR-3.2      | Ingest cloud spend within <15 minutes and update dashboard via write-through.                         | High     |
| FR-3.3      | Compute burn rate (actual spend / elapsed period) and project end-of-period total.                    | High     |
| FR-3.4      | Retain 24 months of raw spend history and daily snapshots; allow query by date range.                 | High     |
| FR-4.1      | Validate `name`, `owner`, `period`, `amount` as required on budget create/update.                     | Medium   |

## Acceptance Criteria
### AC-2: Required Field Validation
- [ ] Submission fails if `name`, `owner`, `period`, or `amount` is null or invalid format.
- [ ] Error message specifies which field is missing/invalid.

### AC-3: Nested Budgets without Double-Counting
- [ ] Shared resource charges allocated proportionally to intersecting budgets.
- [ ] Parent budget aggregates child budgets without double-counting shared items.
- [ ] Graph traversal respects DAG (no cycles); error if cycle detected.

### AC-4: Cost Ingestion & Write-Through
- [ ] Dashboard reflects new cloud charges within 15 minutes of ingestion.
- [ ] Write-through updates atomic (no stale reads).
- [ ] Backfill mechanism handles missed ingestion windows.

### AC-5: Burn Rate & Projection
- [ ] Current burn rate calculated as `actual_spend / elapsed_period`.
- [ ] Projection formula: `projected_total = actual_spend + (burn_rate * remaining_period)`.
- [ ] Alert triggered if projection exceeds budget by defined threshold (e.g., 90 %).

### AC-6: Historical Retention
- [ ] API/query returns spend data for any range within 24 months.
- [ ] Daily snapshots stored and deletable after retention policy expires (24 months).