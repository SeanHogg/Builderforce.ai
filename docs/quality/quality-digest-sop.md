# Weekly Quality Digest SOP

**Purpose**: Automate delivery of weekly quality report to Engineering Leads and PM

**Schedule**: Every Monday at 09:00 local team time (every calendar week excluding holidays)

**Owner**: QA Lead + DevOps (tooling implementation)

**Approval**: Engineering / VP Engineering (Quarterly audit of quality metrics and digest relevance)

---

## Deliverables

### Email

**Recipients**:
1. Engineering Leads (all Tier-1/Tier-2)
2. Product Manager
3. VP Engineering (CC)

**Subject**: Weekly Quality Digest - [MM-DD] - [Date]

**Template**:

```markdown
## Weekly Quality Digest - [Date]

**Reports are sourced from the issue tracker, deployment tracking system, and CI. Our next full review between deployments is [Date].**

---

### 1. Escaped Defect Rate (EDR) Trend

| Service | Last Week | Previous Week | Trend | Status |
|---------|-----------|---------------|-------|--------|
| auth-service | 0.00 | 0.12 | ↓ 83% | ✅ Healthy |
| builderforce-api | 0.02 | 0.08 | ↓ 75% | ✅ Healthy |
| payment-service | 0.00 | 0.04 | ↓ 100% | ✅ Healthy |
| *(other Tier-2 services)* | *(value)* | *(value)* | *(trend)* | *(status)* |

**Overall Team**: 0.08 per 1k lines, ↓ 73% vs. last week.

**Notes**:
- auth-service EDR dropped significantly follow-up incident #124 resolved
- No regression events this week

---

### 2. Open P1 Bugs (per service)

| Service | Active P1 Bugs | P1 Trend | Freeze Alert |
|---------|----------------|----------|--------------|
| auth-service | 1 | ↓ 0 | ✅ No (≤ 2) |
| builderforce-api | 1 | ↓ 0 | ✅ No (≤ 2) |
| payment-service | 0 | - | ✅ No |
| *(others)* | *(count)* | *(trend)* | *(status)* |

**Tier-1 Status**:
- auth-service: 1 P1 open (security token issue) → resolves by 2026-03-31
- builderforce-api: 1 P1 open (tenant API rate limiting) → resolves by 2026-03-31

**Tier-1 Freeze Alert**:
- If any service > 2 P1 open → solution: enforce FREEZE label, block merges.

---

### 3. Coverage Delta (per service)

| Service | Last CI Baseline | Current Baseline | Delta | Status |
|---------|------------------|------------------|-------|--------|
| auth-service | 91% | 91% | -0% | ✅ No regression |
| builderforce-api | 92% | 92% | -0% | ✅ No regression |
| payment-service | 88% | 90% | +2% | 📈 Improvement |
| *(others)* | *(baseline)* | *(baseline)* | *(delta)* | *(status)* |

**Critical Path Status**:
- auth-service: 100% ✓
- builderforce-api: 100% ✓

**Notes**:
- No coverage regressions this week
- payment-service improved +2% (new test coverage added in PR #XXX)

---

### 4. Active Merge Freezes

| Service | Factor | Duration | Reviews Blocked | Status |
|---------|--------|----------|-----------------|--------|
| *(none)* | - | - | *(none)* | ✅ No active freezes |

**P1 Freeze Rule**: Automatically triggered if service > 2 P1 open; freezed service lists feature PRs labeled `bug-fix` only.

---

### 5. New Exemptions (active this week)

| Exemption ID | Service | Expiry | Owner | Reason |
|--------------|---------|--------|-------|--------|
| *(none)* | - | - | - | *(none)* |

---

### 6. Action Items (from last week)

| ID | Item | Owner | Due Date | Status |
|----|------|-------|----------|--------|
| AQ-001 | Auth token rotation coverage → 100% | Security Engineer | 2026-03-31 | ✓ In Progress |
| AQ-002 | Add e2e fuzz tests for token refresh | Security QA | 2026-04-02 | ✓ In Progress |

---

## Implementation Options

### Option 1: Mattermost-Only Digest (Current)

**Tool**: Mattermost / Slack bot that posts message to `#engineering-quality`

**Pros**:
- No email infrastructure overhead
- Real-time visual summary
- Actionable reactions for quick acknowledgement

**Cons**:
- No email archive
- Harder to audit compliance for VP-level

---

### Option 2: Email + Mattermost (Recommended)

**Tool**: Scheduled Node.js script triggering:
1. Mattermost webhook to `#engineering-quality`
2. SMTP to Engineering Leads + PM

**Pros**:
- Email for audit trail
- Mattermost for rapid acknowledgment
- Message posted to Mattermost anyway (so engineering team sees it on-channel)

**Cons**:
- More infrastructure

**Frequency**: Every Monday 09:00 (cron job)

---

### Option 3: Full Dashboard (Future)

**Tool**: Google Data Studio, Mattermost dashboard widget, email digests

**Pros**:
- Clickable metrics, drill-down capability
- Configurable alert thresholds
- Visual quality compliance scorecard per service

**Cost**: Work for DevOps (set up dashboard)
**Timeline**: Q2 if Analytics team available

---

## CI Integration Details

### Artifact Collection

1. **Coverage artifacts** (every run):
   - Uploaded to GitHub Actions if coverage-generating tests
   - Concrete location: `coverage/coverage-summary.json`, `coverage/coverage-summary.xml`

2. **Detection of New Files** (weekly):
   - Local CI script generating list of added files in last 2 weeks
   - Coverage metrics filtered by file content type (excludes vendor deps)

3. **Bug/Issue Data** (daily):
   - Export from Jira/Linear for P0/P1/P2/P3 classes
   - Filter to P0/P1 for EDR and severity counts

4. **Deployment Data** (daily):
   - `gh run` results for last 7 days (deployment status, commit, associated fixes)

### Cleanup & Retention

| Artifact | Retention |
|----------|-----------|
| Coverage reports | 30 days (CI), 12 months (codecov archive) |
| Issue export | 30 days (monthly archive if needed) |
| Deployment logs | 90 days (archived snapshot) |

---

## Testing

### Smoke Test

Weekly before Monday 08:55:
1. Run digest generation script locally
2. Verify all sections populated (no "N/A" placeholders)
3. Check email attachments if email enabled
4. Confirm Mattermost post visible in `#engineering-quality`

**Success Criteria**:
- Email goes out to Engineering Leads + PM
- Mattermost post includes all sections
- No metrics missing or show as "-" where expected

**Failure Procedure**:
- If email fails: Alert DevOps, fallback to Matteronly digest (notify Engineering Leads manually)
- If Mattermost fails: Alert QA Lead, manual post next business day

---

## Exemptions Review

Every quarter (April 30, July 30, October 30, January 30):
1. QA Lead reviews `QUALITY_EXEMPTIONS.md` for expiry status
2. Flag any upcoming expiry (days within range date +/- 15)
3. Include summary in digest with warning for expiring exemptions

**Digest Section** (at bottom of weekly digest):
```markdown
### 7. Exemptions Expiring Soon

| Exemption ID | Service | Expiry | Status |
|--------------|---------|--------|--------|
| EX-001 | auth-service | 2026-04-17 | ⚠️ Expiring within 30 days |

These need to be reviewed/renewed. Action items:
- [ ] Pare down or extend EX-001 if migration path not complete (Engineering Lead)
- [ ] Document renewal for VP Engineering if critical (VP Eng)
```

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-03-17 | code-creator | Initial SOP |

---