# Quality Baseline: auth-service

**Classification**: Tier-1  
**Owner**: Security Team / Core Platform  
**Baseline Established**: 2026-03-17  
**Issue Tracker**: Trello (Div: Security / Team: Platform Security)

---

## Current Metrics (as of 2026-03-17)

| Metric | Value | Source | Assessment |
|--------|-------|--------|------------|
| **Line Coverage** | 91% | CI run 2026-03-10 (`auth-coverage-2026-03-10.json`) | ✅ Passes (Tier-1 ≥ 85%) |
| **Branch Coverage** | 88% | CI run 2026-03-10 (`auth-coverage-2026-03-10.json`) | ✅ Passes (Tier-1 ≥ 75%) |
| **Last 30 Days EDR** | 0.08 | Production incidents 2026-02-17 .. 2026-03-17 | ✅ Passes (≤ 0.5 per 1k lines) |
| **Open P1 Bugs** | 1 | Open incident #124 security-related token issue | ⚠️ At limit (should resolve within 14 days) |
| **Critical Path Coverage** | 100% | CI validated 2026-03-10 | ✅ Passes (100% required) |

**Recent Release Metrics**:
- Last release: `2026.3.12` (OAuth V2.1 tokens update)
- Bug reports last 30 days: 1 resolved P0, 1 open P1
- Deploy frequency: Bi-weekly

---

## Full Coverage Drilldown (2026-03-10)

### Tier-1 Identified Services in Coverage

| File | Line Coverage | Branch Coverage | Status |
|------|---------------|-----------------|--------|
| `src/auth/token-manager.ts` | 95% | 98% | ✅ |
| `src/auth/middleware.ts` | 94% | 92% | ✅ |
| `src/auth/sessions.ts` | 91% | 87% | ✅ |
| `src/auth/oauth.ts` | 88% | 84% | ✅ |

**Critical Paths (from CRITICAL_PATHS.yml)**:
- `/v1/auth/login` → `src/auth/oauth.ts`
- `/v1/auth/logout` → `src/auth/middleware.ts`
- `/v1/auth/verify` → `src/auth/token-manager.ts`
- `/v1/auth/refresh` → `src/auth/sessions.ts`

---

## Historical Data (Last 12 Months)

| Quarter | Avg Line Coverage | Avg Branch Coverage | Avg EDR | Avg P1 Open |
|---------|-------------------|---------------------|---------|-------------|
| Q1 2025 | 86.2% | 84.3% | 0.45 | 3.1 |
| Q2 2025 | 87.5% | 85.1% | 0.42 | 2.8 |
| Q3 2025 | 89.0% | 86.5% | 0.38 | 2.2 |
| Q4 2025 | 90.2% | 87.1% | 0.25 | 1.9 |
| **Q1 2026 (current)** | **91.0%** | **88.0%** | **0.08** | **1.0** |

**Trend**:
- Line coverage climbing +4.8% over 8 quarters
- EDR halved going from Q1 2025 (0.45) to Q1 2026 (0.08)
- P1 bugs trending down -68% YoY

---

## Internal Testing Matrix

| Test Type | Coverage | Schedule | Owner |
|-----------|----------|----------|-------|
| Unit Tests | 91% | Every PR | Security QA Lead |
| Integration Tests | Critical paths = 100% | Every PR | Security QA Lead |
| Mutation Tests | Not yet (Quarterly goal Q2) | Q2 2026 | Security Team |
| Token Refresh Tests | e2e Fuzz → 98% branch | Week of 2026-03-18 | Security Engineer |

---

## Existing Quality Gate Integration

### Coverage Artifacts
- Coverage reports uploaded to Codecov (integration active in CI)
- Local artifact retention 30 days on CI runs
- Team tracks coverage trend on `https://codecov.io/seanhogg/builderforce.ai`

### CI Integration
- **PR time checks**: Coverage gates enforced via `.github/workflows/coverage-check.yml`
- **Critical path gate**: 100% enforcement on auth endpoints
- **P1 freeze detection**: `FREEZE` label script triggers if > 2 P1 bugs

### Label Enforcement
- `FREEZE` label auto-applied when P1 bugs > 2 (autodetected by issue-watcher)
- During freeze, PRs without `bug-fix` or `security` labels are reviewed flag

---

## Service Improvement Plan (Q2 2026)

| Week | Goal | Owner | Check-in |
|------|------|-------|----------|
| W1-2 | Add e2e fuzz tests for token refresh paths | Security QA | 2026-03-31 |
| W3-4 | Integrate zero-trust session mock vs. prod | Security Engineer | 2026-04-14 |
| W5-6 | Interval token rotation coverage → 100% | Security Architect | 2026-04-28 |
| W7-8 | Quartermutation test pilot (target 65% for Q2) | Platform Eng | 2026-05-12 |

---

## Notes & Observations

- Critical path coverage at 100% verified for all auth endpoints
- Currently 1 open P1 bug (security token issue) — triage SLA: 2026-03-31
- EDR well below Tier-1 target (0.08 vs 0.5 per 1k lines)
- Mutation testing is planned for Q2 (currently not measured)

---

## Exemptions

| Exemption ID | Service | Issue | Status | Next Review |
|--------------|---------|-------|--------|-------------|
| *(none)* | - | - | *(none)* | *(none)* |

---

## Linked Artifacts

- **Quality Targets PRD**: `QUALITY_TARGETS.md`
- **Critical Paths Manifest**: `CRITICAL_PATHS.yml`
- **Quality Exemptions Registry**: `QUALITY_EXEMPTIONS.md`
- **CI Coverage Workflow**: `.github/workflows/coverage-check.yml`

**Next Update**: 2026-04-17