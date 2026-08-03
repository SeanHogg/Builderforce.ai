> **PRD** — drafted by Ada · task #139
> _Each agent that updates this PRD signs its change below._
>
> **Business Analyst gap assessment** — appended 2026-07-17 (this execution) — see §7.
> _Signed: BA (code-creator / test-generator / code-reviewer personas)_

# Product Requirements Document: Epic: Code Analysis — Feature Set Discovery & Gap Assessment

## 1. Problem & Goal

**Problem:** Leadership frequently lacks accurate, real-time answers to critical questions regarding project status, deadlines, code quality, and resource allocation. Manual assessments are time-consuming, prone to human error, and often provide insufficient detail, leading to uninformed decisions and potential project risks. Without a clear understanding of the actual implemented feature set and its alignment with strategic goals (OKRs), it's challenging to gauge progress, manage expectations, and allocate resources effectively.

**Goal:** To systematically analyze the codebase to provide leadership with actionable intelligence. This intelligence will enable clear answers to: "Are we on track?", "What are our deadlines?", "How is our quality?", and "What resources do we need?", by automatically discovering the actual feature set, identifying gaps against planned OKRs, and producing insightful reports.

## 2. Target Users / ICP Roles

*   **Engineering Managers:** To monitor team progress, identify bottlenecks, and assess feature completion.
*   **Project Managers:** To track project milestones, evaluate scope creep, and refine project timelines.
*   **Engineering Directors / VPs:** To gain high-level oversight of multiple projects, assess overall code health, and inform strategic resource planning.
*   **Product Managers:** To verify feature implementation against product roadmaps and OKRs.
*   **Team Leads:** To understand the current state of their codebase and identify areas for improvement.

## 3. Scope

This epic encompasses the development of capabilities to:
*   Perform automated, systematic scanning and analysis of designated code repositories.
*   Intelligently identify and map the actual feature set implemented within the codebase.
*   Compare the discovered features against predefined OKRs, project plans, or feature specifications.
*   Perform a gap assessment, highlighting both missing planned features and unanticipated "feature creep."
*   Generate metrics related to code quality and progress.
*   Produce clear, actionable intelligence dashboards and reports tailored for management and leadership consumption.

## 4. Functional Requirements

*   **FR1: Codebase Integration:** The system MUST integrate with common Version Control Systems (e.g., Git, GitHub, GitLab, Bitbucket) to access code for analysis.
*   **FR2: Scan Execution:** The system MUST support scheduled and on-demand scans of specified branches or repositories.
*   **FR3: Feature Discovery:** The system MUST identify and categorize implemented features within the codebase using configurable heuristics (e.g., file structure, function definitions, API routes, database schemas, UI components).
*   **FR4: OKR/Plan Input:** The system MUST allow users to input or integrate with planned OKRs, project specifications, or feature lists for comparison.
*   **FR5: Gap Analysis:** The system MUST perform a comprehensive gap analysis between discovered features and planned items, explicitly highlighting both missing features and unplanned additions.
*   **FR6: Quality Metrics Generation:** The system MUST calculate and present key code quality metrics (e.g., cyclomatic complexity, code duplications, test coverage indicators, security vulnerability trends via integrated tooling).
*   **FR7: Progress & Resource Estimation:** The system MUST provide estimations of remaining work/resource needs based on identified gaps, code complexity, and configurable historical data.
*   **FR8: Reporting & Visualization:** The system MUST generate customizable reports and dashboards visualizing feature alignment, code quality trends, and progress against goals.
*   **FR9: Actionable Insights:** The system MUST provide clear, actionable insights derived from the analysis, recommending strategic next steps for leadership based on the discovered data.

## 5. Acceptance Criteria

*   **AC1: Feature Discovery Accuracy:** The system accurately identifies >90% of a sample set of known features within a typical codebase.
*   **AC2: Gap Reporting Clarity:** Gap analysis reports clearly and correctly articulate discrepancies between planned and implemented features, with a false positive/negative rate below 10%.
*   **AC3: Metric Consistency:** Code quality metrics (e.g., complexity, coverage) are consistent and reproducible across multiple scans of the same codebase state.
*   **AC4: Usability of Insights:** Generated reports and dashboards are intuitive, provide clear visualizations, and empower leadership to make informed decisions without additional manual interpretation.
*   **AC5: Scalability & Performance:** The system can successfully process a medium-sized codebase (e.g., 500k-1M Lines of Code) within a reasonable timeframe (e.g., <2 hours for a full scan).
*   **AC6: Configurability:** Users can easily configure scan schedules, define feature heuristics, and input OKR data.

## 6. Out of Scope

*   Automated code generation, refactoring, or direct remediation of identified code quality issues.
*   Direct integration with project management tools for automated task creation, assignment, or status updates (analysis outputs can be manually integrated).
*   Real-time continuous monitoring beyond scheduled or on-demand discrete scans.
*   Providing specific, prescriptive solutions for *how* to implement missing features or fix identified quality problems (only identifies *what* the problem is).
*   Collection or analysis of individual developer performance metrics.

---

## 7. Gap Assessment — Existing Codebase vs Functional Requirements

_BA analysis: `seanhogg/builderforce.ai` (`api/src/application/`), conducted 2026-07-17._

### 7.1 Mapping Table

| FR | Status | Existing Assets | Gap Detail |
|----|--------|-----------------|------------|
| **FR1** — Codebase Integration | ✅ EXISTING | `api/src/application/repos/sources/` — `GitHubRepoSource.ts`, `GitLabRepoSource.ts`, `BitbucketRepoSource.ts` + `RepoSource.ts` (factory), `repoSourceBase.ts` (shared `RepoTreeEntry`, `RepoSourceConfig`, `FetchLike`, `RepoProvider`). `readRepoContents.ts` / `importRepoContents.ts` for tree + blob read; `commitFileToRepo.ts`, `createPullRequest.ts`, `mergePullRequest.ts` for write path. | None — all three major VCS providers are supported with token-auth, tree listing, blob fetch, and PR orchestration. |
| **FR2** — Scan Execution | ⚠️ PARTIAL | `selectEvidence()` in `RepoSource.ts` picks files by priority (manifests → entrypoints → largest modules) within a token budget. `importRepoContents.ts` fetches tree + file blobs on demand. The platform has a manager cron infrastructure for periodic sweeps. | On-demand scans exist. **Scheduled/recurring scans are not a dedicated feature** — no `scanSchedule` table, no cron job that periodically re-scans a repo and diffs the tree. The existing cron machinery could be extended, but the scheduling primitive is absent. |
| **FR3** — Feature Discovery | ❌ GAP | `scanForPlaceholders.ts` detects stubs/placeholders in committed code (pattern-based). `search_code` is an agent tool, not a systematic analysis pipeline. No structured heuristics for feature categorization from file structure, routes, schemas, or UI components. | **No feature-discovery engine exists.** There is no module that ingests a repo tree + file contents and outputs a categorized feature list. The PRD calls for configurable heuristics (file structure, function definitions, API routes, DB schemas, UI components) — none of these are wired. This is the largest gap. |
| **FR4** — OKR/Plan Input | ⚠️ PARTIAL | Full OKR infrastructure: `objectives` / `key_results` tables + `builtin_objectives_*` tools. Initiatives + portfolios via `builtin_initiatives_*` / `builtin_portfolios_*`. PMO rollup (`api/src/application/pmo/portfolioRollup.ts`). | OKR/initiative data exists, but it is **not wired for comparison against discovered features**. No "plan input" surface specific to this gap-analysis use case. The data model supports it — what's missing is the bridge that takes an OKR/initiative title/description and matches it against discovered features. |
| **FR5** — Gap Analysis | ❌ GAP | `recommendationsEngine.ts` compares current vs prior metrics and emits ranked prescriptive recommendations (cost/quality/allocation/delivery categories with anomaly detection). `deliveryInsights.ts` does scope-creep detection (work added after baseline). | **No feature-vs-plan gap analysis exists.** The recommendations engine is operational (compare metric X now vs before), not structural (compare discovered features vs planned features). There is no module that takes a feature list + an OKR/plan list and produces a diff (missing features, unplanned additions, alignment score). |
| **FR6** — Quality Metrics Generation | ⚠️ PARTIAL | `qualityInsights.ts` — production reliability (uptime %, incident count, MTTR, support tickets, defect aging). `engineeringInsights.ts` — AI effectiveness (merge rate, CI green, cost-per-merged-PR). `workforceMetrics.ts` — DORA four-keys (deployment frequency, lead time, change failure rate, MTTR). | **Operational quality exists; static code quality does not.** The PRD explicitly calls for cyclomatic complexity, code duplication, and test coverage indicators — these are static-analysis metrics that require parsing source code (AST traversal, clone detection). None of these are implemented. Security vulnerability trends are mentioned but also absent (no SAST/SCA integration). |
| **FR7** — Progress & Resource Estimation | ⚠️ PARTIAL | `deliveryInsights.ts` — burnup/burndown series, completion-date forecast (optimistic/pessimistic band), scope creep detection, on-track vs target. `deliveryScenario.ts` — scenario planner (adjust team size/focus/scope → projected completion date). `bottleneckInsights.ts` — stage-by-stage time-in-status analysis, rework signal, aging WIP. `lifecycleInsights.ts` — project phase progression. `peopleInsights.ts` — staffing gaps, open positions. `allocationInsights.ts` — effort allocation by category. | Strong progress estimation for task-based work exists, but it is **not connected to code-analysis gaps**. The estimation models throughput from task-completion velocity, not from code complexity or feature gaps. FR7 specifically calls for estimates "based on identified gaps, code complexity, and configurable historical data" — the gap-to-effort bridge is missing. |
| **FR8** — Reporting & Visualization | ⚠️ PARTIAL | `executiveSummary.ts` — KPI bundle (contributors, commits, PRs, issues, activity score). `DeckService.ts` + `dataSources.ts` — board-deck data assembly from all lenses (DORA, finance, AI impact, quality, people, R&D financials, portfolio rollup). `recommendationsEngine.ts` — prescriptive layer. Caching via `readThroughCache`. | Reporting infrastructure is strong, but there is **no "feature alignment" report or dashboard**. The deck covers operational/people/financial dimensions but has no "discovered features vs plan" visualization. The frontend is out of scope for this API-side assessment, so visualization gaps are noted but not actionable here. |
| **FR9** — Actionable Insights | ✅ MOSTLY EXISTING | `recommendationsEngine.ts` — ranked, severity-graded recommendations across cost/quality/allocation/delivery with anomaly detection (current vs prior period). Supports dismissal persistence. Rule functions are pure and unit-testable. | The recommendations engine is mature and well-architected, but it operates on operational metrics, not on feature-gap data. Extending it with a `feature_gap` category once FR3/FR5 are built would be straightforward — the engine's rule + ranking pattern is reusable. |

### 7.2 Gap Severity Ranking

| Rank | Gap | Severity | Rationale |
|------|-----|----------|-----------|
| 1 | **FR3 — Feature Discovery** | 🔴 Critical | This is the foundation: without a feature-discovery engine, FR5 (gap analysis), FR8 (reporting), and the whole epic's value proposition collapse. No reusable module exists; must be built from scratch. |
| 2 | **FR5 — Gap Analysis** | 🔴 Critical | Depends on FR3 + FR4. The comparison engine itself (diff two feature sets, classify matches/misses/creep) must be built. The `recommendationsEngine` pattern (pure math + thin DB shell) should be mirrored. |
| 3 | **FR6 — Static Code Quality** | 🟠 High | Cyclomatic complexity, duplication, and coverage require AST-level analysis. This is a distinct subsystem from the operational quality metrics that already exist. Consider integrating an existing open-source tool (e.g., `typos`, `tokei`, or a WASM-compiled analyzer) rather than building a parser. |
| 4 | **FR2 — Scheduled Scans** | 🟠 High | On-demand exists; scheduling needs a `scan_schedule` table + a cron job that diffs consecutive trees. The platform's manager cron infrastructure provides a pattern to follow. |
| 5 | **FR4 — OKR/Plan Wiring** | 🟡 Medium | The data exists (objectives, key results, initiatives). The gap is a dedicated "plan input" surface for this use case — a UI or API that lets a user tag which OKRs/initiatives should be compared against discovered features. |
| 6 | **FR7 — Gap-to-Effort Bridge** | 🟡 Medium | Progress estimation is strong independently; the missing piece is connecting code-complexity signals + gap size → effort estimates. Can be built incrementally once FR3 exists. |
| 7 | **FR8 — Feature-Alignment Dashboard** | 🟡 Medium | Reporting infrastructure exists. A new lens (`featureAlignmentInsights.ts`) following the existing lens pattern (pure math + thin DB + cache) would complete this. |

### 7.3 Existing Strengths to Leverage

1. **Multi-provider VCS layer** (`api/src/application/repos/sources/`) — FR1 is fully done. The `RepoTreeEntry` type, `selectEvidence()` priority-based file picker, and `readRepoContents` are directly reusable for FR3's file-content ingestion.

2. **Lens architecture pattern** — Every existing insight module follows the same clean pattern: pure math function (unit-testable without DB) + thin `compute*` function (DB queries) + route-level caching. FR3, FR5, and a feature-alignment lens should follow this exactly. See `bottleneckInsights.ts` for the canonical example (detailed JSDoc, `build*`/`summarize*` pure functions, `compute*` thin shell).

3. **Recommendations engine** (`recommendationsEngine.ts`) — Already answers "what should I DO" with ranked, severity-graded outputs. Adding a `feature_gap` category is a natural extension once FR3/FR5 data exists.

4. **Delivery forecasting** (`deliveryInsights.ts` + `deliveryScenario.ts`) — The burnup/burndown + scenario-planner pattern (read baseline from real data, project forward with linear model, grade against target) is the right shape for FR7's gap-to-effort estimation.

5. **OKR/PMO infrastructure** — Objectives, key results, initiatives, portfolios, and the PMO rollup are all in place. FR4 is a wiring task, not a data-modeling task.

### 7.4 Recommended Implementation Sequence

```
Phase 1 (foundations):  FR3 → FR5
Phase 2 (scheduling):   FR2
Phase 3 (quality):      FR6
Phase 4 (wiring):       FR4 → bridge FR7 → FR8
Phase 5 (prescriptive): Extend FR9 with feature_gap category
```

FR3 must ship first — every other gap either depends on it directly (FR5) or is significantly more valuable with it (FR7, FR8, FR9). FR2 and FR6 are independent and can be parallelized.

### 7.5 Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **FR3 scope creep** — "feature discovery" is open-ended; heuristics can grow without bound. | Epic never ships. | Start with a narrow, deterministic v1: classify by top-level directory + package.json module name + route prefix. Expand heuristics iteratively. |
| **FR6 build vs buy** — writing a complexity/duplication analyzer is a multi-month project. | Wastes a full quarter. | Integrate an existing tool. Investigate `tokei` (lines/blanks/comments per language), `jscpd` (copy-paste detection), or a WASM-compiled `tree-sitter` for AST queries. Do not build a parser. |
| **FR3 false positives** — heuristic-based discovery miscategorizes infrastructure code as features. | Undermines leadership trust (AC1: >90% accuracy; AC2: <10% FP/FN). | Bias heuristics toward precision over recall. A missed feature is less damaging than a phantom feature in a board deck. Include a confidence score per discovered feature. |
| **Scheduling overlap** — FR2 scheduled scans may collide with on-demand scans on the same repo. | Resource exhaustion, duplicate work. | Use a lease/lock pattern (the existing agent claim system). Deduplicate by tree SHA — if the tree hasn't changed, skip the scan. |

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| (original) | Ada | Drafted PRD — Epic: Code Analysis — Feature Set Discovery & Gap Assessment |
| 2026-07-17 | BA (code-creator) | Added §7 — Gap Assessment: mapped all 9 FRs against existing `api/src/application/` codebase; identified 2 critical gaps (FR3 feature discovery, FR5 gap analysis), 2 high gaps, 3 medium; ranked implementation sequence; documented risks. |
