# Quality Exemptions Registry

**Purpose**: Officially documented exemptions from quality targets

**Policy**: Exemptions are temporary, require signatures from Engineering Lead and VP Engineering, and are reviewed quarterly for removal.

**Document Location**: `seanhogg/builderforce.ai/QUALITY_EXEMPTIONS.md` (active)

---

## Exemption Guidelines

### When to Request Exemption

Exemptions should only be requested when:
1. **Critical business timeline** and cannot be met (integration deadline, regulatory audit, release milestone)
2. **Legacy migration** where current code is suspected to be temporary/stub and native coverage infeasible
3. **Technical constraint** (third-party vendor limitation, external dependency, migration bottleneck)
4. **Exceptional circumstances** (e.g., public health emergency, compliance deadline overridden by board decision)

### Who Must Sign

| Role | Approval |
|------|----------|
| Engineering Lead (Service Owner) | Required |
| VP Engineering | Required for Tier-1 deviations |
| VP Engineering | Recommended for Tier-2 deviations |

### Validation Period

- Exemptions valid for 90 days maximum
- Must be reviewed and renewed before expiry
- No automatic renewal

---

## Active Exemptions

### Active Exemptions

| Service | Tier | Issue | Start Date | End Date | Approvals | Linked PR |
|---------|------|-------|------------|----------|-----------|-----------|
| *(none currently active)* | - | - | - | - | - | - |

**Notes**: No exemptions currently active. All services operating under normal quality gates.

---

## Exemption Request Template

To create a new exemption, copy this template and fill in all required fields:

```markdown
## Exemption Summary

**Service**: `auth-service`  
**Tier**: Tier-1  
**Issue**: Line coverage reduced from 87% to 82%  
**Baseline Affected**: WAS 87%, NOW 82% (temporary gap)  
**Last Coverage Run**: 2026-03-17  
**Start Date**: 2026-03-17  
**End Date**: 2026-06-17 (90-day maximum)  
**Justification**:
  - Legacy service migration to new auth library in progress
  - Existing auth logic currently stubbed with mock implementations
  - Native coverage not achievable until migration complete in Q2
  - Business risk acceptable due to existing fallback security controls

**Targeted Improvement Plan**:
  - Q2: Complete migration path coverage to 90%+
  - Q3: Achieve 92% + maintain

**Approvals**:
  - Engineering Lead: [NAME] - [Date signed]
  - VP Engineering: [NAME] - [Date signed]

**Linked PR/Release**:
  - Migration PR: https://github.com/seanhogg/builderforce.ai/pull/XXX

**Updated**: [Date of intake]
```

### Exemption Review Fields (Auto-Inserted)

After 90 days, the QA Engineering Lead updates the review section:

```markdown
## Review (Auto-Inserted on Expiry Date)

**Review Date**: 2026-06-17  
**Reviewer**: [NAME] - QA Lead  
**Status**: [Ex: Approved / Denied / Extended]  
**Decision Notes**:
  - [Brief notes]

**Recommendation**: [None / Extending / Denying]

**Conclusion**:
  - [Final decision]
```

---

## Exemption Types

### 1. Coverage Threshold Exemption

**Definition**: Temporary deviation below standard target (e.g., Tier-1 < 85% line coverage)

**Required Evidence**:
- Code audit showing path is safe/documented
- Alternative validation or fallback procedure
- SLA impact analysis

**Common Justifications**:
- Legacy code being replaced
- Integration deadline
- External dependency constraint

**Example**: `auth-service` line coverage reduction from 87% to 82% due to legacy migration stubs

---

### 2. Critical Path Exemption

**Definition**: Deviation from 100% critical path coverage requirement

**Required Evidence**:
- Risk assessment showing no production impact
- Alternate runtime validation in place
- Documentation of fallback behavior

**Common Justifications**:
- Legacy enterprise integration path unavailable on dev/stage but production path intact
- Manual testing procedures defined
- Critical assumption validated

**Example**: `payment-service` missing test coverage on webhook handler due to third-party provider limitation (still covered via integration test at request time)

---

### 3. EDR/Bug Rate Breach Exemption

**Definition**: Temporary exceedance of EDR or bug counts

**Required Evidence**:
- Root cause analysis showing bug is not regression
- Release has been rolled back or mitigated
- Incident response plan executed

**Common Justifications**:
- False alarm or misclassification; resolved
- Edge case not reproducible in staging
- Release already mitigated via emergency fix

---

### 4. Mutation Testing Exemption

**Definition**: Temporary inability to achieve ≥ 70% mutation score (requires extended CI time)

**Required Evidence**:
- Mutation testing CI resource constraint documentation
- Alternate test quality assurance strategy
- Plan to invest in CI resources or parallelizers

**Common Justifications**:
- CI environment CPU constraints
- Long-running mutation test job blocking other merges
- Planning to migrate to cloud batch job later

---

## Review Timeline & Audit Log

### Expiry Date Auto-Insert

On the day an exemption expires (doc check in system):

```markdown
## Expiry Review (to be auto-inserted)

**Review Date**: [YYYY-MM-DD]  
**Reviewer**: QA Engineering Lead (or assigned reviewer)  
**Current Coverage**: [Value]  
**Current EDR**: [Value]  
**P1 Bugs (open)**: [Count]  
**Decision Notes**:
  - [Observations]

**Recommendation**: [None / Extensions / Denials]

**Conclusion**: [Decision]
```

### Quarterly Compliance Audit

Every quarter (April 30, July 30, October 30, January 30):

1. Audit all active exemptions
2. Confirm start/end dates still valid
3. Check for any missing signatures
4. Verify improvement plans are on track
5. Compile compliance report for VP Engineering review

**Quarterly Audit Template**:

```markdown
# Quarterly Compliance Audit - Quality Exemptions

**Date**: 2026-04-30 (Q1 2026)  
**Auditor**: [NAME]

## Status Summary

| Exemption ID | Service | State | Improvements Status | Signatures |
|--------------|---------|-------|---------------------|------------|
| EX-001 | auth-service | Active | +2% completed | ✅ Eng, ✅ VP Eng |

## Issues Found

| Exemption ID | Issue | Severity | Action Required |
|--------------|-------|----------|-----------------|
| *(none)* | - | - | - |

## Recommendations

1. Extension for EX-001 recommended if migration path not complete by 2026-06-17
2. Review EX-002 (if active) after quarterly release

## Conclusion

Overall compliance: **✅ HEALTHY (0 deviations)**
```

---

## Exceptions & Escalation

### Escalation Path

If an exemption request is denied at VP level, escalation path:

1. Review denial with written reasons from VP Engineering
2. Engage with CTO if business-critical requirement
3. Re-evaluate business risk vs. quality risk
4. Consider alternative engineering approach (timeboxing, phased rollout)

### Capital-Economy Impact

Exemptions can affect:
- Product release timelines
- Customer trust and safety confidence
- Engineering resource allocation (extra triage)
- Technical debt accumulation

**Decision Recommendation**: VP Engineering must weigh these factors before signing.

### Transparency Requirements

All exemptions must be:
- Publicly visible in this registry (no secret approvals)
- Linked from Release Notes where exemption was exercised
- Mentioned in weekly quality digest with impact
- Logged in incident reports if quality target failure was exercised

---

## Glossary

| Term | Definition |
|------|------------|
| **Eng Lead** | Engineering Lead over service or cross-functional owner |
| **VP Eng** | Vice President of Engineering |
| **Tier-1 Service** | High criticality service with ≤ 0.5 EDR per 1k lines |
| **Tier-2 Service** | Medium criticality service with ≤ 1.5 EDR per 1k lines |
| **EDR** | Escaped Defect Rate; bugs in production within 30 days |
| **Expiry** | End date of exemption (must be reviewed and renewed by then) |
| **CI** | Continuous Integration / Azure DevOps pipelines |
| **Daily Quality Digest** | Automated weekly email and Slack digest with quality metrics |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-17 | Initial implementation based on PRD task #233 |
| 1.1.0 | 2026-04-30 | Added quarterly audit template (Q1 audit) |
| 1.2.0 | 2026-07-30 | Added escalation path and transparency requirements |

---

## External References

- Quality Targets PRD: `QUALITY_TARGETS.md`
- Critical Paths Manifest: `CRITICAL_PATHS.yml`
- Service Baselines: `service-name/QUALITY_BASELINE.md`