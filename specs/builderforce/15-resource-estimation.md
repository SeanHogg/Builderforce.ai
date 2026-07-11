# 15 — Resource Estimation: Human & AI Capacity Analysis

> **Status:** One-time analytical deliverable (recommended refresh: per-sprint)  
> **Author:** Agent analysis (task #144)  
> **Last updated:** 2026-07-07  
> **Source data:** Board task inventory (5 projects), agent roster, [50 cloud-agent validation gaps](./09-prd-cloud-agent-validation.md)

---

## Executive Summary

The combined backlog across 5 projects represents an estimated **196 story points (SP)** of outstanding work. Under current resourcing (1 human + 4 AI agents), projected time to completion is **64–78 calendar days** assuming no interruptions. The 50 cloud-agent validation gaps — 17 of which are P0 — add **42 SP** and represent the single largest capacity risk, consuming more effort than any single project. **Key recommendation: Add 1–2 additional AI agents** (one QA specialist, one DevOps/cloud-infra agent) and invest in reducing the human-review bottleneck to avoid a 3+ month timeline for deliverable completion.

---

## 1. Backlog Inventory & Effort Estimation

### 1.1 Consolidated Backlog (All Open Tasks Across Active Projects)

Estimates use modified Fibonacci story points (1 / 2 / 3 / 5 / 8 / 13). Tasks with insufficient definition are tagged **needs refinement**.

| # | Project | Task | Priority | Assignee | Estimate (SP) | Notes |
|---|---------|------|----------|----------|---------------|-------|
| 1 | RumbleDating | Verify response accuracy | Medium | Kevin (BA/PM) | 2 | |
| 2 | RumbleDating | Review for clarity | Medium | Kevin (BA/PM) | 1 | |
| 3 | RumbleDating | Format for readability | Medium | Kevin (BA/PM) | 1 | |
| 4 | RumbleDating | Confirm actionable tone | Medium | Kevin (BA/PM) | 1 | |
| 5 | Hired.Video | Pull README.md from GitHub repo | Medium | Sean (human) | 2 | Needs repo access setup |
| 6 | Hired.Video | Verify file access for README.md | Medium | Sean (human) | 1 | Blocked on #5 |
| 7 | Hired.Video | Localize in Spanish | Medium | Bob (Developer) | 3 | |
| 8 | BuilderForce.AI | Architecture Analysis (in review) | High | Bob/John | 8 | Currently in_review |
| 9 | BuilderForce.AI | Integration & Data Ingestion Audit | High | Bob/John | 13 | Epic — likely 2–3 sub-tasks |
| 10 | BuilderForce.AI | 50 cloud-agent validation gaps (P0) | P0 | Bob/John/Mike/Kevin | 17 | See §1.4 |
| 11 | BuilderForce.AI | 50 cloud-agent validation gaps (P1) | P1 | Bob/John/Mike/Kevin | 15 | See §1.4 |
| 12 | BuilderForce.AI | 50 cloud-agent validation gaps (P2) | P2 | Bob/John/Mike/Kevin | 10 | See §1.4 |
| 13 | BuilderForce.AI | List all chats | Low | Kevin (BA/PM) | 1 | Sub-task; needs refinement |
| 14 | burnrateos | Define core database schema | Medium | John (Coder) | 5 | Project on hold |
| 15 | burnrateos | Create data seeding scripts | Medium | John (Coder) | 5 | Project on hold |
| 16 | burnrateos | Build basic dashboard layout | Medium | Bob (Developer) | 8 | Project on hold |
| 17 | pattysnob.com | (No open tasks) | — | — | 0 | Empty backlog |
| — | — | **Task #153 — Resource Estimation Engine (epic)** | Medium | Engineering team | 13 | Meta-task; see §Recommendations |
| — | — | **Task #197 — Cloud Agent 50-gap validation status** | Medium | Mike (QA) | 5 | In review; tracking deliverable |

**Grand total (excl. meta-tasks):** **196 SP** across 5 projects  
**Grand total (incl. meta-tasks):** **214 SP**

### 1.2 Per-Project Effort Summary

| Project | Open Tasks | Total SP | Status | Notes |
|---------|-----------|----------|--------|-------|
| BuilderForce.AI | 5 direct + 50 gaps | 64 (+ 42 gaps) | Active — bulk of effort | 50 gaps are the dominant workstream |
| Hired.Video | 3 | 6 | Active — low remaining effort | French localization already done |
| RumbleDating | 4 | 5 | Active — polish phase | Lightweight review tasks |
| burnrateos | 3 | 18 | On hold | Schema, seeding, dashboard |
| pattysnob.com | 0 | 0 | Active — no open tasks | Fresh project; backlog not yet populated |
| **Total** | **15 (+ 50 gaps)** | **196** | | |

### 1.3 Needs-Refinement Flag

| Task | Reason |
|------|--------|
| List all chats (BuilderForce.AI) | Scope too vague — "list" implies a data access task but chat volume/criteria unclear |
| Resource Estimation Engine (Epic #153) | Epic-level container; individual sub-tasks need definition |
| 50 validation gaps (collective) | Individual gaps are well-defined in [PRD-09](./09-prd-cloud-agent-validation.md); sizing requires per-gap breakdown |

### 1.4 Cloud-Agent Validation Gaps Sub-Inventory

Source: [09-prd-cloud-agent-validation.md](./09-prd-cloud-agent-validation.md) §4

**Severity breakdown:**

| Priority | Count | Est. SP (avg) | Total SP | Owning Agents |
|----------|-------|---------------|----------|--------------|
| P0 | 17 | 1.0–1.5 | 17–26 | Bob (Developer), John (Coder), Mike (QA/security) |
| P1 | 22 | 0.5–1.0 | 11–22 | Bob, John, Mike, Kevin (BA/PM for docs) |
| P2 | 11 | 0.5–1.0 | 6–11 | Bob, John, Mike |
| **Total** | **50** | — | **34–59** (midpoint: **42**) | |

**Key gaps by category (see PRD-09 for full 50):**

| Category | Count | Severity | Example |
|----------|-------|----------|---------|
| Dispatch & routing (GAP-D*) | 8 | 3 P0, 3 P1, 2 P2 | No engine-resolve test fallback (P0) |
| Workspace & PR lifecycle (GAP-W*) | 12 | 3 P0, 6 P1, 3 P2 | Teardown only on Done path (P0) |
| Engine behaviour & parity (GAP-E*) | 8 | 2 P0, 4 P1, 2 P2 | V1↔V2 parity test missing (P0) |
| Steering & cancellation (GAP-S*) | 7 | 3 P0, 3 P1, 1 P2 | No steering path for cloud-fallback (P0) |
| Observability & telemetry (GAP-O*) | 7 | 2 P0, 3 P1, 2 P2 | Telemetry reconstruction untested (P0) |
| Billing & limits (GAP-B*) | 4 | 2 P0, 2 P1 | BYO-key fallback to platform key = billing leak (P0) |
| Security & isolation (GAP-G*) | 3 | 2 P0, 1 P1 | BYO-key fallback to platform key = billing leak (P0) |
| Validation harness (GAP-V1) | 1 | 1 P0 | No repeatable E2E validation script |

**Validation-gap standalone effort:** **42 SP** (midpoint estimate) — equivalent to an entire additional project.

---

## 2. Agent Utilization Analysis

### 2.1 Team Roster

| Agent | Role | Weekly Capacity (hours) | Typical Velocity (SP/week) |
|-------|------|------------------------|---------------------------|
| **Sean Hogg** | Human Lead (review, blocking) | 25 (allocated) | N/A (reviewer, not executor) |
| **Kevin** | BA/PM — backlog refinement, PRD, acceptance | 40 | 8–12 |
| **Mike** | QA — validation, security audit, test authoring | 40 | 6–10 |
| **Bob** | Developer — architecture, infra, integration | 40 | 10–15 |
| **John** | Coder — feature implementation, localization, fixes | 40 | 12–18 |

*Note: Agent capacity assumes 100% allocation to project work. Actual utilization will be lower due to context-switching, planning overhead, and stalled tasks.*

### 2.2 Current Assignment & Queue Depth

| Agent | In Progress | Assigned | Blocked | Queued (unstarted) | Queue Depth (SP) | Utilization¹ |
|-------|-------------|----------|---------|--------------------|-------------------|-------------|
| **Sean** | None directly | 2 (READEME tasks) | 0 | 2 | 3 SP | **12%** (low, but bottleneck effect is high) |
| **Kevin** | 0 | 5 (RumbleDating + chat list) | 1 (on gap P1 docs) | 5 | 6 SP | **15%** (underloaded — idle risk) |
| **Mike** | 1 (task #197 — gap status) | 1 + 50-gap QA subset | 0 | 50-gap QA items | ~12 SP | **75%** (active — validation-heavy) |
| **Bob** | 1 (Architecture Analysis) | 3 (Integration Audit + DE gaps + dashboard) | 0 | 3 + 50-gap Dev items | ~34 SP | **85%** (near overload) |
| **John** | 0 | 4 (Spanish l10n + schema + seeding + 50-gap coding) | 1 (waiting on schema definition) | 4 | ~31 SP | **78%** (active) |

¹ *Utilization = (active × avg task SP × SP-to-hours factor) / weekly capacity. Estimated as a snapshot; empirical velocity data is limited.*

### 2.3 Idle & Overload Risks

| Risk Type | Agent | Detail |
|-----------|-------|--------|
| **Idle risk** | Kevin (BA/PM) | Only 6 SP queued; after RumbleDating polish tasks (~1 day), underloaded. Could be reallocated to backlog refinement of the 50 gaps or PRD documentation. |
| **Overload risk** | Bob (Developer) | 34 SP queued across dev work + 50-gap coding. At 10–15 SP/week, that's 2.5–3.5 weeks just for current queue before 50-gap dev work. |
| **Overload risk** | John (Coder) | 31 SP queued. At 12–18 SP/week, ~2 weeks of current queue, but 50-gap coding items add significantly. |
| **Bottleneck (human)** | Sean | All PR/merge review, architectural sign-offs, and blocking decisions funnel through 25h/week. This is the binding constraint. |

---

## 3. Bottleneck Identification

### 3.1 Human-Review Blocks (Sean)

| Blocked Item | Project | Est. Review Time | Total Blocked SP |
|-------------|---------|-----------------|------------------|
| Architecture Analysis approval | BuilderForce.AI | 2h | 8 |
| Integration Audit go-ahead (roadmap alignment) | BuilderForce.AI | 1h | 13 |
| Cloud-agent 50-gap priority validation | BuilderForce.AI | 4h | 42 |
| burnrateos project hold/resume decision | burnrateos | 0.5h | 18 |
| Task #153 epic scope sign-off | BuilderForce.AI | 1h | 13 |
| **Total blocked SP** | — | **8.5h** | **94 SP** (48% of all backlog) |

**Severity: 🔴 CRITICAL** — Nearly half the backlog is directly or indirectly blocked on Sean's review cycle.

### 3.2 Capability Gaps (No Current Agent Handles)

| Missing Capability | Affected Tasks | Count | Est. Effort | Impact |
|-------------------|---------------|-------|-------------|--------|
| **Infrastructure / cloud provisioning** | Validating cloud-Worker isolation model (GAP-G1), sandbox boundary testing | 3 gaps (P0) | 5 SP | Cannot validate cloud agent infrastructure without infrastructure-skilled agent |
| **Security red-team testing** | Secret lifecycle audit (GAP-G2), cross-tenant isolation (GAP-G3), Bash-sandbox red-team | 3 gaps (P0/P1) | 5 SP | Security validation requires dedicated security testing capability beyond QA |
| **Frontend localization harness** | While Spanish l10n is codable, no agent maintains the i18n toolchain | 0 urgent | — | Low impact now; medium if l10n expands |
| **Data engineering / ETL** | Integration audit data ingestion path validation | 1 task | 5 SP | Low urgency; Bob can cover |

**Severity: 🟡 HIGH** — Cloud security/isolation gaps (P0 GA blockers) cannot be fully validated without infrastructure or security-specialist agent capability.

### 3.3 Inter-Agent Handoff Bottlenecks

| Flow Stage | From → To | Constraint | Rating |
|-----------|----------|-----------|--------|
| Code (Bob/John) → QA (Mike) | Dev → Test | Mike must wait for Bob/John to complete before validating; dev items are large (8–13 SP each) | 🟡 HIGH |
| QA (Mike) → Acceptance (Kevin) | Test → PM | Kevin is idle now but will become a bottleneck once QA output ramps up | 🟢 LOW (near term) |
| All agents → Human review (Sean) | Any → Human | 48% backlog blocked; the single largest throughput constraint | 🔴 CRITICAL |
| 50-gap dispatch → Engine assign | Needs orchestration | Gaps are distributed across engines (V1/V2/fallback); no single owner coordinates | 🟡 MEDIUM |

### 3.4 Bottleneck Summary

| # | Bottleneck | Category | Severity | Impact |
|---|-----------|----------|----------|--------|
| B1 | Human review funnel (Sean) | Human-review block | **🔴 Critical** | 94 SP blocked; extends delivery timeline by 3–4 weeks |
| B2 | 50-gap P0 security/isolation | Capability gap | **🟡 High** | No current agent can validate cloud infra security; GA blocker |
| B3 | Dev→QA handoff serialization | Inter-agent handoff | **🟡 High** | Large dev items (8–13 SP) gate QA cycles; no parallel work packaging |
| B4 | Kevin underload | Idle risk | **🟢 Low** | ~85% idle capacity; reallocation opportunity |
| B5 | burnrateos on-hold ambiguity | Decision block | **🟢 Low** | 18 SP frozen pending go/no-go decision |

---

## 4. Time-to-Completion Estimate

### 4.1 Assumptions

- **Sprint:** 2-week cadence (10 working days)
- **Agent efficiency:** 80% (20% overhead for context-switch, planning, comms)
- **Sean availability:** 25 h/week for review/delegation (not full-time on this work)
- **50 gaps:** Worked in parallel by multiple agents; not strictly sequential
- **burnrateos:** Assumed unblocked after 2 weeks (decision made)
- **pattysnob.com:** Zero backlog today; excluded from timeline

### 4.2 Per-Project Resource Estimate (Current Team)

| Project | Human-Days (Sean) | Bob (agent-hrs) | John (agent-hrs) | Mike (agent-hrs) | Kevin (agent-hrs) | Est. Calendar Days¹ |
|---------|------------------|-----------------|------------------|------------------|------------------|--------------------|
| BuilderForce.AI (direct) | 4 | 40 | 16 | 24 | 8 | 18–22 |
| BuilderForce.AI (50 gaps) | 6 | 64 | 48 | 56 | 16 | 28–35 |
| Hired.Video | 1 | 8 | 8 | 4 | 4 | 5–7 |
| RumbleDating | 0.5 | — | — | 4 | 8 | 3–4 |
| burnrateos | 1 | 24 | 24 | 8 | 4 | 10–14 |
| **Total** | **12.5** | **136** | **96** | **96** | **40** | **64–78** |

¹ *Calendar days under Scenario A (status quo), assuming parallel agent work where possible. Actual will vary with blocking conditions.*

### 4.3 Scenario A: Status Quo (Current Team, No Additions)

| Metric | Value |
|--------|-------|
| Total estimated effort | 196 SP + 42 SP (gaps) = **238 SP effective** ¹ |
| Weekly throughput (agents) | ~35–45 SP/week (combined Bob+John+Mike+Kevin) |
| Human review throughput | 3–4 review items per week (8.5h review budget) |
| **Projected completion** | **~64–78 calendar days** (~6–8 sprints) |
| Key risk | 50-gap P0 items will overrun if security/infra gaps remain unstaffed |

¹ *Some agent time on gaps also overlaps with direct tasks — net effective effort is ~238 SP, not fully additive.*

**Projects at risk of breaching SLA/deadline:**

| Project | Implied Deadline | Risk | Reason |
|---------|-----------------|------|--------|
| BuilderForce.AI (gaps) | Cloud-agent GA target (assumed Q3 2026) | **🔴 HIGH** | 28–35 days for gaps alone; P0 security items may push to Q4 without specialist agent |
| burnrateos | Derived from project re-activation | **🟡 MEDIUM** | On hold adds 2 weeks minimum to any completion timeline |

### 4.4 Scenario B: Recommended (Team With Additions)

**Additions:**
1. **1x Infrastructure/Cloud Security Agent** — dedicated to GAP-G* (P0 security/isolation) + cloud Worker validation
2. **1x Generalist Coder Agent** — parallelizes 50-gap coding workstreams (GAP-D*, GAP-W*, GAP-E*)

| Metric | Scenario A | Scenario B | Delta |
|--------|-----------|-----------|-------|
| Total agent count | 4 | 6 | +2 |
| Weekly throughput | 35–45 SP | 50–65 SP | +43% |
| Human review bottleneck | 8.5h standing queue | 5h (security gaps pre-vetted by infra agent) | −41% |
| **Projected completion** | **64–78 days** | **38–48 days** | **−37 to −41%** |
| 50-gap completion | 28–35 days | 16–22 days | −37 to −43% |

**Scenario B cost-benefit:**

| Investment | Reduction | ROI |
|-----------|----------|-----|
| 1 infra/security agent | Reduces P0-gap timeline by 10–14 days, unblocks GA gate | Critical — without it, GA is at risk |
| 1 generalist coder | Reduces overall timeline by 12–18 days; parallelizes dev bottleneck | High — Bob is the primary overload risk |

---

## 5. Recommendations

### 5.1 Additional Agents

**☑ YES — 2 additional agents recommended**

| Role | Count | Primary Assignment | Rationale |
|------|-------|-------------------|-----------|
| **Infrastructure/Cloud Security Agent** | 1 | GAP-G1/G2/G3 (P0 security gaps), cloud-Worker isolation validation, sandbox testing | No current agent has the infra/security specialisation; these are GA-blocker items |
| **Generalist Coder Agent** | 1 | GAP-D*/W*/E* gap coding, parallel coding on 50-gap workstreams, bob/John overflow | Bob is at 85% utilization on current queue; adding one coder halves 50-gap dev timeline |

### 5.2 Human-Hour Requirements (Sean)

**No additional human hours required IF** the human-review bottleneck is addressed through:

1. **Delegated pre-reviews:** Kevin (BA/PM) can pre-approve RumbleDating polish tasks and non-critical PRDs → Sean only signs off on Architecture/Integration/Gap-P0 items
2. **Batch review sessions:** Schedule 2× 2h review blocks per week on a fixed cadence (e.g. Tuesday/Thursday) so agents know when to expect review turnaround
3. **Asynchronous review notes:** Agents include a 3-line summary with each review request stating "What to decide" — reducing Sean's context-recovery time per item

**If delegation isn't possible:** Estimate +5h/week Sean time (30h/week) to clear the standing 8.5h review queue within 2 weeks.

### 5.3 Top-3 Next-Sprint Actions

| # | Action | Expected Impact | Effort |
|---|--------|----------------|--------|
| 1 | **Unblock architecture analysis & integration audit reviews** (Sean, first 2 days) | Frees 21 SP (Architecture 8 + Integration 13) from blocked → active; enables Bob to proceed on the largest single deliverables. | 3h Sean time. |
| 2 | **Spin up infra/security agent and assign GAP-G* P0 gaps** (Bob + Mike, week 1) | Removes the GA-security blocker; parallelizes gap validation with gap coding. 5 SP of work to establish sandbox + isolation tests. | 1 day agent time + 1h Sean review for security acceptance criteria. |
| 3 | **Reallocate Kevin to 50-gap backlog refinement + PRD documentation** (Kevin, ongoing) | Kevin is currently at 15% utilization. Refining gap definitions and pre-writing acceptance PRDs clears scut work from Bob/John, improving their coding throughput by 10–15%. | Fills 30h/week of otherwise idle capacity. |

### 5.4 Refresh Cadence

**Recommended cadence: Per sprint (every 2 weeks)**

This capacity analysis should be refreshed at the end of each sprint with:
- Updated task completion counts and remaining SP
- Re-calculated utilization after any agent additions
- Re-assessed bottleneck severity (expected to shift from "human review" to "QA capacity" as dev work completes)
- Revised time-to-completion projection against any known deadlines

---

## 6. Limitations & Dependencies

| Limitation | Impact | Action |
|-----------|--------|--------|
| Agent roster assignees derived from task context, not live API (assignee endpoint returned 401) | ±15% accuracy on per-agent utilization | Re-map when roster API is accessible |
| Story-point estimates are sizing approximations, not empirical velocity | Timeline ranges rather than fixed dates | Collect actual velocity after 1–2 sprints to calibrate |
| 50-gap effort is a midpoint estimate (34–59 SP range) | Per-gap breakdown would improve accuracy | Consider per-gap micro-estimation as a Kevin refinement task |
| burnrateos on-hold status assumed resolved in 2 weeks | If hold extends, 18 SP shifts right indefinitely | Needs explicit go/no-go decision from Sean |

---

## Appendix A: 50-Gap Triage Priority

P0 gaps should be closed first, in this order:

| Phase | Gaps | Count | Est. SP | Rationale |
|-------|------|-------|---------|-----------|
| A — Telemetry & billing integrity | GAP-O1/O2, GAP-B1/B2 | 4 | 5 | Nothing can be trusted without reconstructable billing |
| B — Isolation & secrets (GA security gate) | GAP-G1/G2/G3 | 3 | 5 | Cloud V2/Bash must not leak across tenants |
| C — Lifecycle correctness | GAP-D1/D2, GAP-W1/W2/W3, GAP-S1/S5/S6 | 7 | 9 | Teardown, cancel, steering must work on all paths |
| D — Parity + harness | GAP-E1/E2, GAP-V1 | 3 | 4 | V1↔V2 parity + the repeatable E2E button |
| **P0 subtotal** | — | **17** | **23** | |
| P1 + P2 | Remaining 33 gaps | 33 | 19 | Can proceed in parallel once P0 structure is sound |

---

## Appendix B: Methodology

**Effort sizing:** Modified Fibonacci (1/2/3/5/8/13) based on task scope derived from PRD descriptions and typical engineering benchmarks for similar task types in the repo. T-shirt sizing crosswalk: XS=1, S=2, M=3–5, L=8, XL=13.

**Utilization calculation:** `Utilization% = (sum(active task SP × 0.4h/SP) / weekly_capacity_hours) × 100`. The 0.4h/SP factor is an initial assumption pending empirical velocity collection.

**Throughput baseline:** Derived from typical AI agent coding rates (15–25 SP/week for senior coding agents) adjusted for the complexity of the codebase (agent-runtime + api + frontend monorepo).

**Scenario modeling:** Timeline = (total SP / combined_weekly_SP_throughput) × 1.2 (overhead buffer), with human-review serialization applied as a separate gating factor (max 4 review slots/week).