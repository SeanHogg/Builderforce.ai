# Quality Targets — Bug Rate & Coverage Standards

**Status**: Active  
**PRD Reference**: task #233  
**Target Audience**: Engineering Leads, Staff Engineers, QA, Product Managers, DevOps, VP Engineering  
**Last Updated**: 2026-03-17

---

## Table of Contents

- [Scope](#scope)
- [Introduction](#introduction)
- [Tier Classification](#tier-classification)
- [Bug Rate Targets](#bug-rate-targets)
- [Test Coverage Targets](#test-coverage-targets)
- [Measurement & Reporting Infrastructure](#measurement--reporting-infrastructure)
- [Process Integration](#process-integration)
- [Exemptions Process](#exemptions-process)
- [Baseline Establishment](#baseline-establishment)
- [Off-Scope Item Clarifications](#off-scope-item-clarifications)

---

## Scope

This document defines enforceable quality gates for all production-facing services and libraries maintained in the primary monorepo (`seanhogg/builderforce.ai`) and any satellite repositories flagged as tier-1 or tier-2.

**Applies to**:
- All code merged to `main` branch
- Every release candidate build
- Tier-1 and Tier-2 satellite repositories

**Does not apply to**:
- Third-party vendor code (vendored dependencies)
- Mobile client applications
- Documentation or API contract linting at this time

---

## Introduction

Engineering teams lack explicit, measurable quality gates for bug rate and test coverage, leading to inconsistent release readiness decisions, accumulating technical debt, and unpredictable production incident rates. This document establishes shared, data-driven thresholds that align development, QA, and release processes.

---

## Tier Classification

Services are classified as **Tier-1** or **Tier-2** based on business impact and release frequency.

### Tier-1 Services (High Criticality)

**Criteria**:
- Direct customer-facing APIs with data persistence
- Public API contracts (auth, payment processing)
- Core orchestration layer (tenant management, project data, task lifecycle)
- Services with weekly or higher release cadence

**Examples**:
- Builderforce API (`worker` worker)
- Authentication service
- Tenant management endpoints
- Payment processing integration
- Public v1/v2 API contracts

### Tier-2 Services (Medium Criticality)

**Criteria**:
- Internal orchestration tooling
- Eventing or messaging infrastructure
- Services with monthly or lower release cadence
- Non-critical internal worker utilities

**Examples**:
- Analytics/telemetry pipelines
- Internal notification services
- Batch processing workers
- Logging infrastructure

---

## Bug Rate Targets

### FR-1.1 Escaped Defect Rate (EDR)

**Definition**: Bugs reported in production within **30 days** of the release that introduced the change.

| Tier | Target | Formula |
|------|--------|---------|
| Tier-1 | ≤ 0.5 | `escaped_bugs_count / (changed_lines / 1000)` |
| Tier-2 | ≤ 1.5 | `escaped_bugs_count / (changed_lines / 1000)` |

**Notes**:
- Only production incidents classified as actual escaped defects (not confirmed as pre-existing issues) count toward the metric
- `changed_lines` = total lines of code modified in the release
- Metrics are reported per-service, per-release

**Tooling**:
- Microsoft Viva Insights/Jira external issue tracking
- Deployment tracking system (Cloudflare Analytics/Postgres history)
- EDR calculated automatically by quality-engineering dashboard on deploy event

---

### FR-1.2 Severity Budgets

**P0 (Critical) Bugs**:
- **Zero tolerance** requirement
- Any P0 reaching production triggers:
  - Immediate incident response escalation (sev1)
  - Root cause analysis (RCA) within 24 hours
  - Engineering lead + VP Engineering notification
  - Automated rollback consideration

**P1 (High Impact) Bugs**:
- Maximum **2 open** concurrently per service
- **Automatic service freeze** if exceeded:
  - Freeze all feature branch merges to that service
  - `FREEZE` label auto-applied to all feature PRs against the service
  - Only PRs labeled `bug-fix` or `security` may merge during freeze
  - Freeze lifted only after P1 is resolved and validated by QA

**P2/P3 Bugs**:
- Tracked in backlog
- **Triage SLA**: ≤ 14 days from bug report to triage classification
- Separated from active work to avoid blocking normal feature development

---

### FR-1.3 Regression Rate

**Target**: ≤ 5% of total bug volume per quarter

**Definition**: Bugs that are reintroductions of previously fixed defects

**Reporting**:
- Regression incidents flagged automatically during quarterly bug volume analysis
- Excludes false positives or red herrings
- Baseline regression rate calculated from last 6 months of production incidents

---

### FR-1.4 Mean Time to Detect (MTTD)

**Target**: Time from bug creation to automated detection

| Bug Severity | Target MTTD | Automation Method |
|--------------|-------------|-------------------|
| P0 | ≤ 1 hour | Automated alerting via Sentry/Upsource, infrazone-based alerts |
| P1 | ≤ 1 hour | Same as P0 (high-priority routing) |
| P2 | ≤ 24 hours | Flood-based orchestrator monitoring + team on-call pager |

**Notes**:
- P0/P1 detection failures trigger immediate on-call escalation
- P2 detection delays validated quarterly via incident log audit

---

## Test Coverage Targets

### FR-2.1 Line / Statement Coverage (per file)

**Hard Gate (Tier-1)**: Merge blocked if line coverage < 85%

| Tier | Coverage | Gate Type | New Files |
|------|----------|-----------|-----------|
| Tier-1 | ≥ 85% | **Hard** (blocks merge) | ≥ 80% |
| Tier-2 | ≥ 70% | **Soft** (merge allowed, alert) | ≥ 80% |

**Enforcement**:
- CI pipeline runs `coverage` command after test suite (`pnpm test:coverage`)
- Coverage report generated and uploaded to central service (Codecov, detected automagically)
- PR checks fail if coverage threshold not met
- File-level coverage reported for new files introduced in PR

---

### FR-2.2 Branch Coverage (per file)

**Hard Gate (Tier-1)**: Merge blocked if branch coverage < 75%

| Tier | Coverage | Gate Type |
|------|----------|-----------|
| Tier-1 | ≥ 75% | **Hard** (blocks merge) |
| Tier-2 | ≥ 60% | **Soft** (merge allowed, alert) |

**Tooling**:
- Jest + Istanbul for TypeScript/JavaScript
- `--coverage --config` with branch configuration
- CI job validates coverage via GitHub Actions/Jest-safe integration

---

### FR-2.3 Critical Path Coverage

**Requirement**: **100%** unit + integration test coverage on all "critical" code paths

**Critical Paths** (defined in `CRITICAL_PATHS.yml`):
- Payment processing services
- Authentication service
- Tenant data persistence layer
- Public API contract endpoints (v1/v2)
- Multi-tenant isolation logic
- Security-sensitive operations (token management)

**Manifest File**:
```yaml
# CRITICAL_PATHS.yml
criticalPaths:
  - service: "auth-service"
    files:
      - "src/auth/token.ts"
      - "src/auth/middleware.ts"
    paths:
      - "/v1/auth/login"
      - "/v1/auth/logout"
      - "/v1/auth/verify"

  - service: "payment-service"
    files:
      - "src/payment/process.ts"
      - "src/payment/subscription.ts"
    paths:
      - "/v1/payment/checkout"
      - "/v1/payment/callback"
      - "/v1/payment/refund"
```

**Enforcement**:
- CI job validates critical path coverage on every PR
- Coverage report flagged if any critical path has < 100%
- Non-blocking but alerts Engineering Lead for review

---

### FR-2.4 Mutation Testing Score

**Target**: ≥ 70% mutation score (measured quarterly, not per-PR)

**Rationale**: Mutation testing is computationally expensive; measured per-quarter to control CI cost

**Tooling**:
- Stryker/mutation-testing library (configured per-service)
- CI job runs mutation tests nightly on `main` branch
- Quarterly report generated with a mutation health score per service
- Services below 70% flagged in quality digest

**Quarterly Reporting**:
- Mutation score published as CI artifact on weekly quality report
- Services below threshold placed in remediation queue
- Target: Increase by at least 5% per quarter until ≥ 70%

---

### FR-2.5 Coverage Ratchet

**Rule**: Coverage may never decrease below the last-merged baseline on `main`

- PR that reduces aggregate coverage triggers **automatic merge block**
- Reviewer may override if evidence shows legitimate gap improvement elsewhere
- Gap analysis report included in PR description

---

## Measurement & Reporting Infrastructure

### FR-3.1 Tooling

**Coverage Streaming**:
- Every CI run uploads coverage data to central service
- Detected automatically based on language (JaCoCo, pytest-cov, coverage.py, Istanbul)
- Artifacts uploaded to CI storage with hash of commit

**Bug Tracking Integration**:
- Validation: Bug severity classification matched to incident alerts
- Correlation: Issue tracker + deployment tracking system data
- Retrievable: Coverage and bug metrics queryable by service, release, time window

---

### FR-3.2 Bug Rate Dashboard

**Metrics Displayed**:
- EDR trend per service (last 12 months)
- Open P1 bugs per service (live view)
- Regression rate trend (quarterly)
- MTTD for P0/P1 bugs (latest 30 days)

**Dashboard Refresh**: Daily (real-time on deploy)

**Tool**:
- Viva Insights, Google Data Studio, or Mattermost dashboard integration
- Queryable via API against deployment/issue tracking system

---

### FR-3.3 Weekly Quality Digest

**Schedule**: Every Monday by 09:00 local team time

**Required Sections**:
1. **EDR Trend**: Last week vs. previous week EDR per service
2. **Open P1 Count**: Per-service P1 bug count (active freeze notifications)
3. **Coverage Delta**: New coverage baseline update per service
4. **Active Merges Freeze**: Services on automatic freeze (from FR-1.2)

**Deliverables**:
- Email to Engineering Leads + PM
- Mattermost/Slack channel: `#engineering-quality`
- Artifact stored in `docs/quality/daily-briefings/` for archival

---

### FR-3.4 Historical Trend Retention

**Retention Policy**: Min 12 months for all quality metrics

**Retention Details**:
- Coverage metrics per CI run (including artifact)
- Bug/issue tracking data for at least 12 months
- Incident log accessible for RCA/review

**Audit**: Quarterly log rotation review by DevOps

---

## Process Integration

### FR-4.1 CI/CD Gates

**Hard Gates** (merge blocked automatically):
1. **Tier-1 line coverage** < 85% (per FR-2.1)
2. **Coverage ratchet violation** (per FR-2.5)
3. **Critical path coverage < 100%** (per FR-2.3 Tier-1)

**Soft Gates** (non-blocking but generates alert):
1. **Tier-2 line coverage** < 70%
2. **Branch coverage** below Tier target

**Label Enforcement**:
- During **service freeze** (P1 > 2 open):
  - `FREEZE` label auto-applied to all feature PRs targeting affected service
  - Only `bug-fix` or `security` PR labels permit merge
  - PR without `bug-fix`/`security` auto-post comment with `FREEZE` warning

---

### FR-4.2 Baseline Establishment

**Timeline**: Within first sprint of adoption

**Process**:
1. Team declares current coverage and bug rate as baseline per service
2. Baseline documented in service level `QUALITY_BASELINE.md`
3. Improvement plan created if baseline below targets (two-quarter phasing)

**Phasing Example**:
| Quarter | Tier-1 Target | Tier-2 Target |
|---------|---------------|---------------|
| Q1 (Current) | Baseline review | Baseline review |
| Q2 | +5% improvement | +3% improvement |
| Q3 | Meet target (≥ 85%/70%) | Meet target |
| Q4+ | Maintain | Maintain |

---

### FR-4.3 Exemptions

**Exemption Process**:

1. **Request Form** (`QUALITY_EXEMPTIONS.md` template):
   - Service tier classification
   - Planned temporary deviation (start date, end date)
   - Business justification (release schedule, regulatory, integration deadline)
   - Engineering Lead signature
   - VP Engineering signature

2. **Approval Threshold**:
   - Engineering Lead approval required
   - VP Engineering signature required for any deviation affecting Tier-1

3. **Review Schedule**:
   - Quarterly review date (30 days after exemption expiry)
   - Exemption automatically expires if renewal not requested
   - Reuse exemptions only for new releases (no reversion of baseline)

4. **Documentation**:
   - Exemption maintained in `QUALITY_EXEMPTIONS.md`
   - Links to admission PR or release notes where exemption was exercised
   - Alerts raised on quarterly review for expired exemptions

**Sample Template**:

```markdown
## Exemption Summary

**Service**: `auth-service`  
**Tier**: Tier-1  
**Issue**: Line coverage reduced from 87% to 82%  
**Justification**: Legacy migration introduced stub code; native stubs not yet covered  
**Start Date**: 2026-03-17  
**End Date**: 2026-06-17  
**Approvals**: Eng Lead: [Name] | VP Eng: [Name]  
**Linked PR**: https://github.com/seanhogg/builderforce.ai/pull/XXX
```

---

## Baseline Establishment

**Objective**: Create service-level baseline metrics to ensure quality targets are met progressively.

### Service Baseline Process

1. **Select First Sprint (Q1 2026)**:
   - Teams define current coverage thresholds per service
   - Historical bug data aggregated (last 12 months baseline)

2. **Baseline Document Structure** (`service-name/QUALITY_BASELINE.md`):

```markdown
# Quality Baseline: auth-service

**Classification**: Tier-1  
**Owner**: Engineering Team  
**Baseline Established**: 2026-03-17

## Current Metrics

| Metric | Value | Source |
|--------|-------|--------|
| Line Coverage | 92% | 2026-02-28 CI run |
| Branch Coverage | 89% | 2026-02-28 CI run |
| Last 30 Days EDR | 0.18 | Production incidents |
| P1 Bugs (open) | 1 | Open incident #123 |

## Historical Data (Last 12 Months)

- Average line coverage: 90.5% (Q1-Q4 2025)
- Average EDR: 0.32 per 1k lines
- P1 bug average: 1.8 open per month

## Improvement Plan

| Quarter | Target | Rationale |
|---------|--------|-----------|
| Q2 | 93% line coverage | +3% targeted focus on auth endpoints |
| Q3 | Maintain + 70% mutation score | Annual mutation test integration |
```

3. **Target Phasing** (if below targets):
   - **Two-quarter ramp-up**: Teams set improvement milestones in 90-180 day window
   - **Tracking**: Quarterly sync with QA to validate progress

4. **Baseline Review**:
   - Every 6 months, baseline re-validated
   - Updated if significant architectural change (lambda update, microservice split)

---

## Off-Scope Item Clarifications

Per the original PRD off-scope, these clarifications define where boundaries exist for quality targets:

### Performance / Load Testing

**Not in this PRD**: Performance SLAs and load testing targets are covered in separate SLO/SLA PRD (if exists). Currently, no dedicated performance target is defined in Builderforce.ai.

**Note**: From `CONTRIBUTING.md`:
> "Before opening a pull request make sure: Tests still pass (`pnpm test` at the root, or run the appropriate script)."

This suggests basic testing exists, but performance testing is not explicitly gated.

---

### Security Vulnerability SLAs Beyond P0

**Definition**: P0 critical criteria defined in FR-1.2 (zero tolerance). Security deadline/immediate fix after discovery is a separate concern handled by the Security team's vulnerability management policy.

**Current State**: Security scanning and SLAs are tracked elsewhere; this document focuses purely on bug rate and coverage.

---

### Third-Party / Vendor Code

**Exclusion**: Vendored dependencies are excluded from coverage measurement. Only code maintained in the primary monorepo (`Builderforce.ai/`) is subject to these targets.

**Rationale**: External dependencies security posture outsourced to vendor handling; custom integration tests exist.

---

### Exploratory / Manual Testing Cadence

**Scope**: Scheduling and scope of manual QA sessions are defined by the QA team's test plan, not this document.

**Process**: Existing QA processes continue as defined; quality targets do not replace manual QA cadence.

---

### Mobile Clients

**Status**: Mobile client quality targets tracked under the Mobile Engineering quality program, not this PRD.

---

### Documentation Coverage or API Contract Linting

**Out of scope for this cycle**: While important, this PRD is focused on runtime code quality.

---

### Tooling Procurement Decisions

**Approach**: Selection of vendors (Codecov vs. SonarQube, etc.) delegated to Platform Engineering within constraints of FR-3.1.

**Current Implementation**:
- Coverage tooling detected automatically based on project language (`coverage.py`, `pytest-cov`, Istanbul)
- Central tracking service chosen by Platform Engineering — can be swapped without breaking quality gates

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-03-17 | code-creator | Initial implementation based on PRD task #233 |

---

## Supporting Artifacts

- `CRITICAL_PATHS.yml` — Source of truth for critical path definitions
- `QUALITY_EXEMPTIONS.md` — Active exemptions template and registry
- `service-name/QUALITY_BASELINE.md` — Service-specific baseline metrics
- CI configuration for coverage gates (`.github/workflows/coverage-check.yml` placeholder)
- Deployment missing: Weekly quality digest script (pipeline to Mattermost/Email)