# Quality Standards Documentation

This directory contains the authoritative quality targets, standards, and artifacts for Builderforce.ai.

---

## Overview (QUALITY_TARGETS.md)

**Primary Source of Truth**: `QUALITY_TARGETS.md`

Defines:
- Bug rate targets (EDR, severity budgets, regression, MTTD)
- Test coverage targets (line, branch, critical path, mutation score)
- Measurement & reporting infrastructure (dashboards, weekly/daily digests)
- Process integration (CI/CD gates, exemptions, baselines)

Read this first for full policy details.

---

## Critical Paths (CRITICAL_PATHS.yml)

**Purpose**: Identifies all code paths requiring 100% unit + integration test coverage

**Who Updates**: Engineering Lead of the service

**Validation**: CI job (`coverage-check.yml`) checks critical path coverage

**Getting Started**:
1. Read the definitions at the top of the file
2. Update per-file critical paths (Tier-1 or Tier-2) based on business impact
3. Update `docs/quality/critical-path-changes.md` with your change
4. Submit PR for Engineering Lead review

---

## Quality Exemptions (QUALITY_EXEMPTIONS.md)

**Purpose**: Documents temporary deviations from quality targets

**When to Use**: When a service cannot meet targets due to:
- Critical business timeline (integration deadlines, regulatory audits)
- Legacy migration with stub code
- External dependency limitations
- Emergency circumstances

**Review Process**:
1. Fill in the exemption template
2. Get Engineering Lead signature
3. Get VP Engineering signature (Tier-1)
4. Track expiry (max 90 days)
5. Review quarterly for removal

---

## Quality Baselines (service-name/QUALITY_BASELINE.md)

**Per-Service Files**: Documents current metrics and improvement plans for each service

**Metrics Tracked**:
- Line & branch coverage
- Escaped Defect Rate (EDR) trend
- Open P1 bugs status
- Critical path coverage verification
- Historical data (last 12 months)

**When Updated Every 6 Months** (or after significant restructure):
- Recalculate after major deployment
- Adjust improvement targets if needed
- Review exemption status

---

## Critical Path Changes Log (critical-path-changes.md)

**Purpose**: Audit trail of all `CRITICAL_PATHS.yml` modifications

**Process for Adding Critical Path**:

1. **Propose** (update this log with `[PROPOSED]` entry, link to PR)
2. **Review** (silent review over 2 consecutive weeks, then Engineering Lead check)
3. **Approve** (Engineering Lead + VP Engineering for Tier-1)
4. **Merge** (after review logs, QR, and triggering operations)

**When to Remove Critical Path**:
- Service decommissioned
- Path no longer in production
- Path moved to Tier-2 (lower urgency)
- Justified via documented analysis in PR

---

## CI Quality Gate (`.github/workflows/coverage-check.yml`)

**PR-time Checks**:
- Line coverage: Tier-1 ≥ 85% (hard fail), Tier-2 ≥ 70% (soft fail)
- New files: ≥ 80% (hard fail)
- Branch coverage: Tier-1 ≥ 75% (hard fail), Tier-2 ≥ 60% (soft fail)
- Critical path: 100% (Tier-1 hard fail)

**Push-time Checks** (`main` branch only):
- Coverage ratchet: No aggregate coverage drop from last main baseline

---

## Automated Reports

### Weekly Quality Digest
- **Schedule**: Every Monday by 09:00 local time
- **Sent to**: Engineering Leads + PM
- **Contains**:
  - EDR trend (last 2 weeks)
  - Open P1 count per service
  - Coverage delta (baseline updates)
  - Active service freeze notifications

### Bug Rate Dashboard
- **Metric Retention**: 12 months minimum
- **Data Sources**: Issue tracker + deployment tracking system
- **Refresh**: Daily
- **Accessible via**: [Quality Dashboard URL] (to be provisioned by DevOps)

---

## Service Owners Responsibilities

| Role | Responsibilities |
|------|------------------|
| **Engineering Lead** | Approve critical path changes, sign exemptions, baseline review |
| **QA Lead** | Validate critical path coverage, QA sign-offs, quarterly audits |
| **DevOps / Platform** | CI/CD gate enforcement, dashboard provisioning, rotation |
| **Product Manager** | Review quality digest, align on release readiness criteria |
| **VP Engineering** | Approve Tier-1 exemptions, quarterly quality audit |

---

## Quick Reference: Quick Links

- **Full PRD**: `QUALITY_TARGETS.md` (start here)
- **Policy**: FR-1 bug rates, FR-2 coverage gates, FR-3 measurement, FR-4 process integration
- **Critical Paths**: `CRITICAL_PATHS.yml`
- **Critical Path Changes**: `docs/quality/critical-path-changes.md`
- **Exemptions**: `QUALITY_EXEMPTIONS.md`
- **Service Baselines**: `service-name/QUALITY_BASELINE.md`
- **CI Workflow**: `.github/workflows/coverage-check.yml`

---

## Incident Management

Quality failures:
- **Tier-1 coverage failure** on PR → PR blocked, Engineering Lead consulted
- **P0 bug production** → Immediate root cause analysis, rollback consideration
- **Critical path < 100%** → Engineering Lead email + production restriction until remediated
- **EDR exceed** on release → Post-release investigation, bump goals

---

## Version History

| Version | Date | Author | Description |
|---------|------|--------|-------------|
| 1.0.0 | 2026-03-17 | code-creator | Initial documentation per PRD task #233 |

---