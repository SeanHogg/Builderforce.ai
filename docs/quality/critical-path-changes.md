# Critical Path Changes Log

**Purpose**: Audit trail of all changes to `CRITICAL_PATHS.yml`

**Validates**: Every addition or removal of critical paths is documented, reviewed, and approved before merging.

---

## Version History

| Version | Date | Changes | Decision Body | Vote |
|---------|------|---------|---------------|------|
| v1.0.0 | 2026-03-17 | Initial critical paths loaded from PRD (9 services) | Engineering Lead review | ✅ Approved |

---

## Community Plan (to be updated on each critical path change)

Community Plan defines **how and when** critical paths will be updated. This tracks the decision-making process and ensures consistency.


### 1. Guiding Principles

- Critical paths are **not changed lightly** — every change must have documented justification.
- **Tier-1 services** (auth, payment, tenant, public API) are high-risk and require Engineering Lead + VP Engineering review.
- Critical path changes affecting **production stability** require a pre-merge security/impact review.
- Only horizontal code paths are fair candidates (avoiding service-specific polygons).
- **Quarterly review** of critical paths for excessive additions/removals.


### 2. Decision Framework

**Approved by**: Engineering Lead (primary) + QA Lead (secondary)

**Vote Requirements**:
- Approval by Engineering Lead (Tier-1 changes)
- Approval by Engineering Lead + VP Engineering (Tier-1 critical path additions/removals)

**Limits**:
- Maximum of 5 critical path changes per sprint
- No more than one “Tier-1 critical path change per week” (to ensure thorough review)


### 3. Process Overview

#### A. Propose Change
- Create a PR that modifies `CRITICAL_PATHS.yml`
- Update this log with a `[PROPOSED]` entry (future tense)
- Include:
  - Why this path is critical (business impact, security, data loss)
  - Tier classification
  - Existing coverage (if applicable)

#### B. Review Milestone
- Queries GitHub for two consecutive weeks of no disagreement
- Then Request Engineering Lead review if:
  - Todo: explicit sign-off checkbox (for Tier-1)
  - Product PM and QA Lead indicated no objections


#### C. Approval Milestone
- Sign-off by Engineering Lead (primary) and VP Engineering (Tier-1)
- If no objection after *two* consecutive weeks of silent review for non-critical paths, the change is conditionally approved
- Note: feasible if DevOps + Safety Ops concur and a hardcoded defect exception is approved or not

#### D. Merge Milestone
- Merged only after:
  - Reviews logs (this log)
  - QR: quality review sign-off (for Tier-1 critical paths, this is the explicit Engineering Lead check)

#### E. Closer
- Delete IF existing PRs under review; keep active pending PRs


#### F. Expiry/Expiry Date
- Max duration: 90 days (soft review window; no final verdict until merged)
- Padding: 3 days buffer at the top and end of the 90-day window
- Expiry: if sealed years ago, explicitly close


### 4. Practicing Automation and Efficiency

**Automatic Parameters** (derived from tooling and configured policies):
- default timeout: 30 days (soft block, not a veto)
- max duration: 90 days (hard block)
- 2 consecutive weeks of review windows silence = proceed (this is not an approval — yet)

**Implementable Actions** (to be built in CI for Tier-1 changes over time):
- Templates for proposed critical path change (auto-populated from MR description or typed fields)
- Queue management to ensure scheduled capacity is respected

---
# Singleton Pattern for Community Plan (to be kept as-is above and used as normative policy)
---
This schedule, process, and process controls above constitute the biddable plan governing critical path changes.

(Remaining sections below are tracking entries; above is the normative policy.)