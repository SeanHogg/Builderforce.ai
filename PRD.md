> **PRD** — drafted by Ada (Sr. Product Mgr) · task #233
> _Each agent that updates this PRD signs its change below._

# PRD: Quality Targets — Bug Rate & Coverage Standards

## Problem & Goal

Engineering teams lack explicit, measurable quality gates for bug rate and test coverage, leading to inconsistent release readiness decisions, accumulating technical debt, and unpredictable production incident rates. This PRD defines enforceable quality targets that align development, QA, and release processes around shared, data-driven thresholds.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **Engineering Leads / Staff Engineers** | Define and own targets; integrate into CI/CD pipelines |
| **QA Engineers** | Validate coverage reports and bug classification |
| **Product Managers** | Understand release readiness criteria |
| **DevOps / Platform Engineers** | Enforce gates in pipelines and dashboards |
| **VP Engineering / CTO** | Executive visibility into quality health over time |

---

## Scope

Covers all production-facing services and libraries maintained in the primary monorepo and any satellite repositories flagged as tier-1 or tier-2. Applies to every code change merged to `main` and every release candidate build.

---

## Functional Requirements

### FR-1 — Bug Rate Targets

**FR-1.1 Escaped Defect Rate (EDR)**
- Tier-1 services: ≤ 0.5 escaped bugs per 1,000 lines of changed code per release.
- Tier-2 services: ≤ 1.5 escaped bugs per 1,000 lines of changed code per release.
- EDR is calculated as bugs reported in production within 30 days of the release that introduced the change.

**FR-1.2 Severity Budgets**
- Zero tolerance for P0 (critical/data-loss or security) bugs reaching production.
- P1 (high-impact) bugs must not exceed 2 open per service at any time; any breach triggers an automatic freeze on new feature merges for that service.
- P2/P3 bugs tracked in backlog with ≤ 14-day triage SLA.

**FR-1.3 Regression Rate**
- Regression rate (bugs reintroduced after a prior fix) must remain ≤ 5% of total bug volume per quarter.

**FR-1.4 Mean Time to Detect (MTTD)**
- P0/P1 bugs: MTTD target ≤ 1 hour via automated alerting.
- P2 bugs: MTTD target ≤ 24 hours.

---

### FR-2 — Test Coverage Targets

**FR-2.1 Line / Statement Coverage**
- Tier-1 services: ≥ 85% line coverage, enforced as a hard CI gate (merge blocked on failure).
- Tier-2 services: ≥ 70% line coverage, enforced as a soft gate (merge allowed, alert generated).
- New files introduced in any PR must meet ≥ 80% line coverage for that file before merge.

**FR-2.2 Branch Coverage**
- Tier-1 services: ≥ 75% branch coverage.
- Tier-2 services: ≥ 60% branch coverage.

**FR-2.3 Critical Path Coverage**
- All code paths identified as "critical" (payment processing, auth, data persistence, public API contracts) must achieve 100% unit + integration test coverage. Critical paths are declared in a `CODEOWNERS`-adjacent `CRITICAL_PATHS.yml` manifest.

**FR-2.4 Mutation Testing Score**
- Tier-1 services must achieve a mutation score ≥ 70% (measured quarterly, not per-PR, to control CI cost).

**FR-2.5 Coverage Ratchet**
- Coverage may never decrease below the last-merged baseline on `main`. Any PR that reduces aggregate coverage is automatically blocked.

---

### FR-3 — Measurement & Reporting Infrastructure

**FR-3.1 Tooling**
- Coverage data collected via language-native tooling (e.g., Jest + Istanbul for TypeScript/JS, pytest-cov for Python, JaCoCo for JVM) and uploaded to a central coverage service (e.g., Codecov or SonarQube) on every CI run.

**FR-3.2 Bug Rate Dashboard**
- Bug rate metrics sourced from the issue tracker (Jira or Linear) and correlated with deploy events from the deployment tracking system. Dashboard refreshed daily.

**FR-3.3 Weekly Quality Report**
- Automated weekly digest sent to Engineering Leads and PM summarizing: EDR trend, open P1 count per service, coverage delta, and any active merge freezes.

**FR-3.4 Historical Trend Retention**
- Quality metrics retained for a minimum of 12 months to support quarterly retrospectives and goal-setting.

---

### FR-4 — Process Integration

**FR-4.1 CI/CD Gates**
- Hard coverage gates (FR-2.1 Tier-1, FR-2.5 ratchet, FR-2.3 critical paths) block PR merge automatically.
- Soft coverage gates emit PR comments with remediation guidance but do not block merge.
- P1 freeze (FR-1.2) is enforced by automatically adding a `FREEZE` label to all feature PRs targeting the affected service; only PRs labeled `bug-fix` or `security` may merge during freeze.

**FR-4.2 Baseline Establishment**
- Within the first sprint of adoption, each service team must declare its current coverage and bug rate as the baseline. Targets phase in over two quarters if the baseline is below the stated targets, with a documented improvement plan.

**FR-4.3 Exemptions**
- Exemptions to any target require written approval from the Engineering Lead and VP Engineering, documented in the repository's `QUALITY_EXEMPTIONS.md`, and are reviewed quarterly for removal.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Tier-1 CI pipeline blocks merge when line coverage drops below 85% or below the ratchet baseline. | Automated CI test with a coverage-reducing dummy commit. |
| AC-2 | A PR introducing a new file with < 80% file-level coverage is blocked before merge. | PR simulation in staging CI environment. |
| AC-3 | A P1 bug opened against a Tier-1 service automatically sets a `FREEZE` label on open feature PRs for that service within 5 minutes. | Integration test against issue tracker webhook. |
| AC-4 | Bug rate dashboard displays EDR, regression rate, and MTTD metrics refreshed ≤ 24 hours after a deploy event. | Manual QA of dashboard after a test deploy. |
| AC-5 | Zero P0 bugs reach production in any two-week release window. | Review of post-release incident log against release diff. |
| AC-6 | Weekly quality digest email is sent every Monday by 09:00 local team time and contains all four required sections. | Automated email log audit. |
| AC-7 | Coverage data for any CI run is retrievable from the central coverage service for at least 12 months. | Spot-check query against coverage service API for a run > 6 months old at the 12-month mark. |
| AC-8 | Mutation score for each Tier-1 service is computed and published quarterly; any service below 70% appears on the weekly digest as a flagged item. | Review quarterly mutation report artifact in CI. |
| AC-9 | All active exemptions are documented in `QUALITY_EXEMPTIONS.md` and reviewed within 90 days of creation. | Automated lint check on exemption file for stale dates. |

---

## Out of Scope

- **Performance / load testing targets** — addressed in a separate SLO/SLA PRD.
- **Security vulnerability SLAs beyond P0 definition** — owned by the Security team's separate vulnerability management policy.
- **Third-party / vendor code** — vendored dependencies are excluded from coverage measurement.
- **Exploratory / manual testing cadence** — scheduling and scope of manual QA sessions are defined by the QA team's test plan, not this document.
- **Mobile clients** — mobile platform quality targets are tracked under the Mobile Engineering quality program.
- **Documentation coverage or API contract linting** — out of scope for this cycle.
- **Tooling procurement decisions** — selection of specific vendors (Codecov vs. SonarQube, etc.) is delegated to Platform Engineering within the constraints of FR-3.1.