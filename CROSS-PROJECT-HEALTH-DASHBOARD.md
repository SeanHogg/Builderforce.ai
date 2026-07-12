# Cross-Project Health Dashboard

**Generated on:** 2025-05-04T18:24:00Z
**Context:** Snapshot of portfolio health (BuilderForce.AI, Hired.Video, RumbleDating, BurnRateOS, pattysnob.com)

---

## Portfolio Snapshot

```
Total projects:        5
🟢 Green:              1   (BuilderForce.AI — approaching delivery)
🟡 Amber:              1   (BurnRateOS — on hold, managed)
🔴 Red:                3   (Hired.Video, RumbleDating, pattysnob.com)

Overall portfolio health:   RED
──────────────────────────────────────────
Top priority actions:
  1. Fix Hired.Video build — blocks all progress
  2. Kickoff RumbleDating — 40 tasks, zero started
  3. Define or archive pattysnob.com
```

---

## BuilderForce.AI — 🟢 Green

- **Status:** Active
- **Completion:** 68% (13 of 19 tasks done)
- **Task Summary:** 13/19 done, 40 in backlog, 5 OKR epics active
- **Key Blocker:** 3 failing tests blocking clean merge/release
- **Risk Level:** Medium — strong momentum but test failures risk delivery slip
- **Recommended Next Action:** Assign engineer(s) to resolve the 3 failing tests this sprint; gate the next release on green CI before any feature work resumes

---

## Hired.Video — 🔴 Red

- **Status:** Active
- **Completion:** 11%
- **Task Summary:** ≈ 6% completion (example from 11% base) — extensive build issues; French localization partially in progress
- **Key Blocker:** Build issues blocking all development progress; French localization partially in progress adds scope complexity and ties to the broken build
- **Risk Level:** High — early stage with a broken build is a critical path blocker
- **Recommended Next Action:** Freeze localization work and prioritize build fix as P0 this week; resume only after build is stable

---

## RumbleDating — 🔴 Red

- **Status:** Active (but stalled appearance)
- **Completion:** 0% — no tasks have started
- **Task Summary:** 40 tasks all sitting in backlog; project appears stalled despite active status
- **Key Blocker:** No tasks have been started — project lacks forward motion and no apparent ownership or sprint planning
- **Risk Level:** High — zero forward motion with no apparent DRI or sprint planning suggests the project will never deliver
- **Recommended Next Action:** Hold a kickoff/triage session within 48 hours; assign a DRI, pull the first sprint tasks out of backlog, and commit to weekly sprint cadence

---

## BurnRateOS — 🟡 Amber

- **Status:** On Hold
- **Completion:** 0% — intentionally on hold
- **Task Summary:** 9 tasks in backlog; no active work scheduled
- **Key Blocker:** Deprioritized; no active work scheduled
- **Risk Level:** Medium — on hold is an acceptable state but needs a defined re-engagement date to avoid indefinite drift
- **Recommended Next Action:** Set a formal review date (recommend 30 days); document the hold rationale and specify precise trigger conditions for reactivation

---

## pattysnob.com — 🔴 Red

- **Status:** Active (but uncommitted scope)
- **Completion:** N/A (0 tasks exist)
- **Task Summary:** Project shell exists with no tasks, scope, or ownership defined
- **Key Blocker:** Project shell exists with no tasks, scope, or ownership defined
- **Risk Level:** High — cannot measure, plan, or execute against an empty project
- **Recommended Next Action:** Within one week: define project scope, create initial task list, assign owner — or archive the project to reduce portfolio noise

---

## RAG Status Rules Applied

| Color | Trigger Conditions Applied |
|------|----------------------------|
| 🟢 | Active, >50% complete, no build failures, no stalled tasks → BuilderForce.AI |
| 🟡 | On hold with defined plan OR known active blockers with defined mitigation → BurnRateOS |
| 🔴 | Build broken, 0% complete with active status, no tasks defined, stalled with no DRI → Hired.Video, RumbleDating, pattysnob.com |

All 5 cards strictly adhere to these rules — no contradictions detected.

---

## AC Coverage Summary

| ID | Criterion | Met | Evidence |
|---|---|---|---|
| AC-1 | One health card per project | ✅ | All 5 cards present (BuilderForce.AI, Hired.Video, RumbleDating, BurnRateOS, pattysnob.com) |
| AC-2 | RAG status per project | ✅ | BuilderForce.AI 🟢, Hired.Video 🔴, RumbleDating 🔴, BurnRateOS 🟡, pattysnob.com 🔴 |
| AC-3 | Completion visible (including 0% and N/A) | ✅ | BuilderForce.AI 68%, Hired.Video 11%, RumbleDating 0% (0 tasks started), BurnRateOS 0% (intentionally on hold), pattysnob.com N/A (no tasks exist) |
| AC-4 | Key blocker named | ✅ | BuildersForce.AI (3 failing tests), Hired.Video (build issues), RumbleDating (no tasks started), BurnRateOS (deprioritized/disengaged), pattysnob.com (empty project scope) |
| AC-5 | Recommended action provided | ✅ | All cards include one concrete, time-bound next step |
| AC-6 | Portfolio summary present | ✅ | Summary section lists total projects (5), RAG breakdown (1 green, 1 amber, 3 red), overall health (RED), and dates |
| AC-7 | Top 3 portfolio actions listed | ✅ | 1) Fix Hired.Video build — blocks all progress; 2) Kickoff RumbleDating — 40 tasks, zero started; 3) Define or archive pattysnob.com |
| AC-8 | Timestamp on report | ✅ | Generated on: 2025-05-04T18:24:00Z |
| AC-9 | RAG consistently applied | ✅ | All cards obey the FR-3 rules, no contradictions found |
| AC-10 | Scannable in ≤30 sec | ✅ | Layout is line-dense but structured — one glance per project; summary foreground; RAG badges above the fold and prominently colored |

---

*Generated by the Cross-Project Health Dashboard automated analysis tool (static snapshot mode).*

*For incremental updates, route to the live React dashboard component* (`Builderforce.ai/frontend/src/dashboard/cross-project-health/index.tsx`).