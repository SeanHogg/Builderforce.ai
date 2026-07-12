# Quality Baseline: builderforce-api

**Classification**: Tier-1  
**Owner**: Core Platform Team  
**Baseline Established**: 2026-03-17  
**Issue Tracker**: Jira / Linear (Service: `builderforce-api`)  

---

## Current Metrics (as of 2026-03-17)

| Metric | Value | Source | Assessment |
|--------|-------|--------|------------|
| **Line Coverage** | 92% | CI run 2026-03-10 (`coverage-2026-03-10.json`) | ✅ Passes (Tier-1 ≥ 85%) |
| **Branch Coverage** | 89% | CI run 2026-03-10 (`coverage-2026-03-10.json`) | ✅ Passes (Tier-1 ≥ 75%) |
| **Last 30 Days EDR** | 0.12 | Production incidents 2026-02-17 .. 2026-03-17 | ✅ Passes (≤ 0.5 per 1k lines) |
| **Open P1 Bugs** | 1 | Open incident #274 | ✅ Passes (≤ 2 concurrent) |
| **Critical Path Coverage** | 100% | CI validated on 2026-03-10 | ✅ Passes (100% required) |

**Recent Release Metrics**:
- Last release: `2026.3.14` (updated with tenant feature toggle)
- Bug reports last 30 days: 3 total (2 P0 critical resolved, 1 P2 minor)
- Deploy frequency: Weekly (average 5 days between releases)

---

## Full Coverage Drilldown (2026-03-10)

### Tier-1 Identified Services in Coverage

| Service | File | Line Coverage | Branch Coverage | Status |
|---------|------|---------------|-----------------|--------|
| builderforce-api | `src/api/endpoints/tenant.ts` | 95% | 98% | ✅ |
| **builderforce-api (CRITICAL)** | `src/api/endpoints/tenant.ts` | **100%** | **100%** | ✅ |
| builderforce-api | `src/api/endpoints/project.ts` | 92% | 88% | ✅ |
| **builderforce-api (CRITICAL)** | `src/api/endpoints/project.ts` | **100%** | **100%** | ✅ |
| builderforce-api | `src/api/endpoints/task.ts` | 94% | 91% | ✅ |
| **builderforce-api (CRITICAL)** | `src/api/endpoints/task.ts` | **100%** | **100%** | ✅ |
| builderforce-api | `src/api/endpoints/agent.ts` | 91% | 86% | ✅ |
| **builderforce-api (CRITICAL)** | `src/api/endpoints/agent.ts` | **100%** | **100%** | ✅ |

### Critical Paths in This Service (from CRITICAL_PATHS.yml)
- Public API V1/V2 endpoints for tenant, project, task, agent
- Authentication middleware integration
- Tenant isolation logic

---

## Historical Data (Last 12 Months Q1-Q4 2025)

| Quarter | Avg Line Coverage | Avg Branch Coverage | Avg EDR | Avg P1 Open |
|---------|-------------------|---------------------|---------|-------------|
| Q1 2025 | 88.5% | 84.9% | 0.32 | 2.3 |
| Q2 2025 | 90.1% | 86.2% | 0.28 | 2.1 |
| Q3 2025 | 91.8% | 87.5% | 0.22 | 1.6 |
| Q4 2025 | 92.1% | 89.0% | 0.19 | 1.2 |
| **Q1 2026 (current)** | **92.0%** | **89.0%** | **0.12** | **1.0** |

**Trend**:
- Line coverage climbing +3.5% over 8 quarters
- EDR dropping steadily with improved CI quality gates
- P1 bugs trending down -48% YoY

---

## Internal Testing Matrix

| Test Type | Coverage | Schedule | Owner |
|-----------|----------|----------|-------|
| Unit Tests | 92% | Every PR | QA Lead |
| Integration Tests | Critical paths = 100% | Every PR | QA Lead |
| Mutation Tests | Not yet enabled (Quarterly goal) | Q2 2026 | Platform Engineering |
| Migration Tests | All migrations tested | Every migration | DevOps |

---

## Existing Quality Gate Integration

### Coverage Artifacts
- **Coverage reports**: Uploaded to GitHub Actions artifacts for 30 days retention
- **Codecov / SonarQube**: Integration enabled in CI pipeline
- **Badge on README**: Coverage metric displayed (requires pipeline integration)

### CI Integration
- **PR time checks**: Coverage gates enforced via `.github/workflows/coverage-check.yml`
- **main-time checks**: Ratchet check via `compare-coverage-baseline.mjs`
- **New file gate**: Files with → merge blocked if < 80% coverage (per PRD FR-2.1)

### Label Enforcement
- `FREEZE` label auto-applied by workflow on P1 > 2 open (see `issue-watcher` script)
- Only `bug-fix` or `security` PR labels permitted during freeze (enforced by PR review policy)

---

## Service Improvement Plan (Q2 2026)

| Week | Goal | Owner | Check-in |
|------|------|-------|----------|
| W1-2 | Continue migration test auto-checks (prevent regressions) | QA Lead | 2026-03-31 |
| W3-4 | Reduce code duplication in `src/api/endpoints/task.ts` | Eng Lead | 2026-04-14 |
| W5-6 | Integrate metrics to Mattermost dashboard | DevOps | 2026-04-28 |
| W7-8 | Quarterly mutation test pilot (target 65% for Q2) | Platform Eng | 2026-05-12 |

---

## Notes & Observations

- Critical path coverage at 100% verified for all public API endpoints
- Last 30 days had 0 fixed bugs, 1 minor P2 bug unresolved (≥ 14-day triage)
- EDR well below Tier-1 target (0.12 vs 0.5 per 1k lines) – no freeze triggers
- Mutation testing to be added in Q2 (currently not measured in pipeline)

---

## Exemptions

| Exemption ID | Service | Issue | Status | Next Review |
|--------------|---------|-------|--------|-------------|
| *(none)* | - | - | *(none)* | *(none)* |

No active exemptions at this time.

---

## Linked Artifacts

- **Quality Targets PRD**: `QUALITY_TARGETS.md`
- **Critical Paths Manifest**: `CRITICAL_PATHS.yml`
- **Quality Exemptions Registry**: `QUALITY_EXEMPTIONS.md`
- **CI Coverage Workflow**: `.github/workflows/coverage-check.yml`
- **Funding**: API funding is implemented via Transaction endpoints (/tx).


**Next Update**: 2026-04-17 (end of Q2 baseline refresh)