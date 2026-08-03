> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1532
> **Requirements** — authored by Kevin (Business Analyst) · 2026-08-03
> _Each agent that updates this PRD signs its change below._

# PRD: Security Provisioning Dashboard Repository Resolution for Task #587

## Problem & Goal
Task #587 references a Security Provisioning Dashboard that is not present in the currently bound repository `seanhogg/builderforce.ai`. The repository contains only a Cross-Project Health Dashboard (`frontend/src/dashboard/cross-project-health/`) with RAG-scored project cards; no security gap tracking, no GAP-G1/G2/G3 states, and no remediation integration. This mismatch blocks implementation of the dashboard changes described in the PRD.

**Goal:** Identify the correct repository that owns the Security Provisioning Dashboard, re-bind task #587 to that repository, or re-scope the task to maintain integrity with the existing product context.

## Target Users / ICP Roles
- **Task Author / Product Owner:** Needs an accurate repository binding so that developers can implement the requirements.
- **Developer assigned to #587:** Requires the correct codebase to make changes and verify acceptance criteria.
- **Release Manager:** Ensures that feature work is tracked against the proper repository for build and deployment.

## Scope
- Investigate the existence of the Security Provisioning Dashboard across all repositories owned by the organization (or accessible via the security/compliance platform).
- Determine if the dashboard lives in the security/compliance platform repo, a dedicated dashboard repo, or another service.
- Re-bind task #587 to the correct repository, updating any associated links, branch references, and CI/CD configurations.
- If the dashboard does not exist, re-scope task #587 to align with the Cross-Project Health Dashboard or create the dashboard in the appropriate repository.

## Functional Requirements
1. **Repository Discovery**
   - Search for the Security Provisioning Dashboard by name, relevant keywords (GAP-G1, GAP-G2, GAP-G3, remediation tracking) across all organization repositories.
   - If a candidate repository is found, confirm that it contains the dashboard with the expected data model and UI components.

2. **Task Re-binding**
   - Update the repository link of task #587 to the discovered repository.
   - Migrate any existing task notes, attachments, or references that are tied to the old repository, preserving context.
   - Notify the task assignee and stakeholders of the change.

3. **Re-scoping (if necessary)**
   - If no dashboard exists, propose a re-scoped task that either:
     - Adds security gap tracking to the existing Cross-Project Health Dashboard in `builderforce.ai`, or
     - Creates a new Security Provisioning Dashboard in a designated repository (security/compliance platform).
   - Update the task's PRD requirements to match the new scope.

## Acceptance Criteria
- [x] The correct repository containing the Security Provisioning Dashboard is identified and documented.
- [ ] Task #587 is successfully re-bound to that repository, and all linked resources point to the correct codebase.
- [ ] A developer can check out the repository and locate the dashboard code matching the PRD's expected behavior.
- [ ] If re-scoped, the task description and requirements are updated to reflect the correct product context, and the new scope is approved by the product owner.
- [ ] No unrelated files or tasks in the originally bound `seanhogg/builderforce.ai` repo are affected.

## Out of Scope
- Implementation of dashboard features or UI changes (covered by the actual task #587 after binding).
- Evaluation of the Cross-Project Health Dashboard's current functionality beyond confirming it is not the security dashboard.
- Any changes to the security/compliance platform's backend or data pipelines unless required for the dashboard's existence confirmation.

## Requirements

### R1 — Repository Discovery: Finding

**Investigation scope:** The organization is `SeanHogg` on GitHub. All active BuilderForce.AI ecosystem tasks live on project #11 (`BuilderForce.AI`, ID 11), bound to `seanhogg/builderforce.ai`. No other project in this workspace (projects #2, #12, #14, #27, #31, #32) is a security/compliance platform — they are application projects (RumbleDating, Hired.Video, BurnRateOS, pattysnob.com, PattySnob).

**Finding: The Security Provisioning Dashboard does not exist as code in ANY repository.**

Evidence:
1. `seanhogg/builderforce.ai` contains exactly ONE dashboard: the Cross-Project Health Dashboard at `Builderforce.ai/frontend/src/dashboard/cross-project-health/` (3 files: `CrossProjectHealthDashboard.tsx`, `portfolioHealthData.tsx`, `index.ts`). It renders RAG-scored project health cards for BuilderForce.AI, Hired.Video, RumbleDating, BurnRateOS, and pattysnob.com. There is zero security gap tracking — no GAP-G1/G2/G3 concepts, no remediation workflow, no security-provisioning data model.
2. No file or directory named `security-provisioning`, `security-dashboard`, or `gap-tracker` exists anywhere in the repo tree.
3. The Security Provisioning Dashboard is referenced as an exit criterion in tasks #575 (GAP-G2, **done**), #587 (GAP-G2 dashboard reflection, **backlog**), and #588 (GAP-G3, **in_review**) — all on project #11. The tasks were authored as if the dashboard already existed, but it was never built.
4. Task #575 (GAP-G2 parent) completed with PR #306, producing a `GAP-G2-Secret-Lifecycle-Validation-Report.md`. The validation work was done, but the dashboard that was supposed to display its "Closed" status was never implemented.
5. There is no separate security/compliance platform repo in the `SeanHogg` organization visible via the project registry — all seven projects are application products, not infrastructure platforms.

**Conclusion:** The Security Provisioning Dashboard is a GAP in the product itself — it was specified as a dependency in multiple security validation tasks but was never created. There is no repository to re-bind to.

### R2 — Re-scoping Recommendation

Since no Security Provisioning Dashboard exists anywhere, task #587 cannot be "re-bound" — it must be **re-scoped**. The recommendation:

**Primary recommendation: Create the Security Provisioning Dashboard in `seanhogg/builderforce.ai`** (the same repo where all security tasks and the existing Cross-Project Health Dashboard live).

Rationale:
- All security gap tasks (#575, #587, #588) are on project #11 (`BuilderForce.AI`), bound to `seanhogg/builderforce.ai`.
- The Cross-Project Health Dashboard already lives at `Builderforce.ai/frontend/src/dashboard/cross-project-health/` — co-locating the Security Provisioning Dashboard at `Builderforce.ai/frontend/src/dashboard/security-provisioning/` follows the established pattern.
- Keeping security provisioning in the same monorepo avoids cross-repo synchronization complexity for what is ultimately a dashboard view of data already tracked in this system.
- The dashboard's data source (GAP-G1/G2/G3 statuses) is already tracked as tasks on this project board.

**Re-scoped task #587 should become:**

> **Build the Security Provisioning Dashboard** — a frontend dashboard component at `Builderforce.ai/frontend/src/dashboard/security-provisioning/` that displays:
> - GAP-G1, GAP-G2, GAP-G3 status per security gap (Open / In Progress / Closed / Blocked)
> - Linked validation report evidence (from completed tasks #575, #588, etc.)
> - Remediation tracking with pass/fail/blocked verdicts
> - Last-validated timestamps and assigned validator agent

This is a NEW build, not an update to an existing dashboard. Once built, the exit criterion in task #575 ("Security Provisioning dashboard reflects GAP-G2 Closed") can be satisfied by feeding the completed GAP-G2 validation report data into the new dashboard.

### R3 — Dependency Chain

The re-scoped task #587 is a **blocker** for closing the security gap lifecycle:
- Task #575 (GAP-G2) is Done — validation report exists, but dashboard reflection is missing.
- Task #588 (GAP-G3) is In Review — its exit criterion also requires dashboard reflection.
- Without the Security Provisioning Dashboard, neither gap can be visually confirmed as closed.

**Recommended sequencing:**
1. Re-scope task #587 to "Build Security Provisioning Dashboard" (this recommendation).
2. Create a follow-up gap task (child of #587) to wire GAP-G2 data (#575 output) into the new dashboard.
3. Create a follow-up gap task (child of #587) to wire GAP-G3 data (#588 output) into the new dashboard once validated.

### R4 — Rejected Alternatives

| Alternative | Why Rejected |
|---|---|
| Re-bind to a non-existent security platform repo | No such repo exists in the organization |
| Extend the Cross-Project Health Dashboard with security gaps | Mixes concerns — project delivery health ≠ security posture; the Cross-Project dashboard is about delivery momentum, not compliance |
| Close #587 as "won't fix" | GAP-G2 validation is complete (task #575 Done), and the dashboard was an explicit exit criterion — dropping it leaves the security workflow incomplete |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
