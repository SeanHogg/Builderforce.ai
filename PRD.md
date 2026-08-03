> **PRD** — drafted by Ada · task #139
> _Each agent that updates this PRD signs its change below._
>
> **Change log:**
> - Ada (draft): initial PRD skeleton
> - Business Analyst (task #139 lane ready): gap assessment — mapped every FR + AC against the actual `api/src` codebase (seanhogg/builderforce.ai), producing disposition, evidence paths, severity, and implementation effort estimates

---

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

# Appendix A — Codebase Discovery & Gap Assessment

> **Conducted by:** Business Analyst, task #139 lane `ready`
> **Date:** 2026-07-01
> **Scope:** `api/src` of `seanhogg/builderforce.ai` on branch `builderforce/task-139`
> **Method:** Full listing of `api/src/application/insights/`, `api/src/application/repos/`, `api/src/application/reports/`, `api/src/application/deck/`, and `api/src/presentation/routes/`; file-level read of every lens, collector, and integration module. Disposition is evidence-based with specific file paths.

---

## A.1 Functional Requirement Gap Matrix

### FR1 — Codebase Integration (VCS) — ✅ EXISTS

**Disposition:** IMPLEMENTED. The repo has full multi-provider VCS integration.

**Evidence:**
- `api/src/application/repos/sources/repoSourceBase.ts` — shared `RepoSourceConfig` interface, `RepoProvider` (`'github' | 'bitbucket' | 'gitlab'`), `RepoTreeEntry` and `FetchLike` types
- `api/src/application/repos/sources/GitHubRepoSource.ts` — GitHub REST API client (tree listing, file fetch, branch resolution)
- `api/src/application/repos/sources/GitLabRepoSource.ts` — GitLab API client
- `api/src/application/repos/sources/BitbucketRepoSource.ts` — Bitbucket API client (app-password Basic auth)
- `api/src/application/repos/sources/RepoSource.ts` — `selectEvidence()` (priority-tiered file selection: manifests → entrypoints → largest modules), token budgeting, binary/secret/excluded-path filters
- `api/src/application/repos/RepoService.ts` — orchestration service over all providers
- `api/src/application/repos/resolveRepoCredential.ts` — encrypted credential resolution (PAT/OAuth/app-password)
- `api/src/application/repos/resolveDefaultRepo.ts` / `resolveRepo.ts` — repo resolution chain
- `api/src/application/repos/readRepoContents.ts` / `importRepoContents.ts` — file content I/O

**Verdict:** No work needed. All three common VCS providers (GitHub, GitLab, Bitbucket) are supported, with credential management, tree traversal, token-budgeted file selection, and binary/secret filtering.

---

### FR2 — Scan Execution (scheduled + on-demand) — ⚠️ PARTIAL

**Disposition:** On-demand scanning exists implicitly through the agent execution loop (every agent run can list/read repo files). Scheduled scanning does NOT exist as a dedicated feature.

**Evidence:**
- On-demand: the agent runtime (`agent-runtime/`) dispatches runs that call repo tools, and `api/src/application/repos/scanForPlaceholders.ts` already performs a targeted post-commit scan for stub/placeholder detection — proving the scan pattern works
- The `RepoSource.selectEvidence()` function is deterministic and pipelinable
- No `cron`-backed scheduled-scan registry, no `scheduled_scans` table, no scan-configuration CRUD endpoint exists anywhere in `api/src/`

**Gap:** A scheduled scan feature requires (a) a `scheduled_scans` or `scan_configs` table storing repo ref, branch, cadence, and heuristic config per tenant; (b) a cron-style dispatch that enqueues scan jobs; (c) a scan-results store.

**Severity:** Medium. Leadership won't set up scans; they consume results. On-demand scans via the agent loop satisfy the "get me an analysis now" use case. Scheduled scans are a nice-to-have for recurring board-deck refresh, but the deck already refreshes from live lens data.

**Effort estimate:** ~3 story points (schema + cron binding + config CRUD). Can be deferred to post-MVP.

---

### FR3 — Feature Discovery (heuristic-based) — ❌ MISSING

**Disposition:** NOT IMPLEMENTED. No heuristic-based feature-discovery engine exists. This is the core of the epic and the largest gap.

**Evidence:**
- `api/src/application/insights/` contains 30+ lens modules (bottleneck, delivery, quality, engineering, finance, allocation, people, compliance, aiImpact, devex, funnel, benchmarking, velocity, lifecycle, builder, board, catalog, ceremony, space, rdFinancials) — none perform code-level feature extraction
- `api/src/application/repos/sources/RepoSource.ts` has `selectEvidence()` which picks representative files by priority tier, but it stops at file selection — no AST walk, no symbol extraction, no feature tagging
- `api/src/application/repos/scanForPlaceholders.ts` regex-matches source files for stub patterns — proves the "scan source and classify" pipeline is viable, but it's a single narrow check, not a general feature classifier
- No module anywhere in `api/src/` performs: API route enumeration, DB schema→domain mapping, UI component cataloging, function-definition inventory, or file-structure→feature heuristics
- The agent runtime has `search_code` (grep), but it's an ephemeral tool call, not a persisted feature map

**What needs to be built:**
1. **Feature Heuristic Engine** (`api/src/application/analysis/featureDiscovery.ts`): a pure, pluggable pipeline that accepts a `RepoTreeEntry[]` + file contents and emits `DiscoveredFeature[]` (name, category, confidence, evidence paths). Pluggable analyzers:
   - **Route Analyzer:** scans `api/src/presentation/routes/` for Hono route registrations → feature = "REST API surface"
   - **Schema Analyzer:** scans `api/src/infrastructure/database/schema/` for Drizzle table definitions → feature = "Data Model"
   - **Domain Analyzer:** scans `api/src/domain/` for module structure → feature = "Domain Boundaries"
   - **UI Analyzer:** scans frontend source for React component/page structure → feature = "UI Surface"
   - **Config Analyzer:** reads `package.json`, `Dockerfile*`, `wrangler.toml` → feature = "Deployment Topology"
2. **Feature Catalog Store** (`api/src/infrastructure/database/schema/analysis.ts` + migration): a `discovered_features` table (tenant, repo, branch, commit_sha, feature_name, category, confidence, evidence_json, discovered_at)
3. **Discovery Endpoint** triggering a scan + returning the catalog

**Severity:** CRITICAL. FR5 (gap analysis) depends on this. Without it, the epic delivers a dashboard of delivery metrics but fails its headline promise of "feature set discovery."

**Effort estimate:** ~13 story points (heuristic engine + 4 analyzers + schema + migration + route). This is the epic's anchor deliverable.

---

### FR4 — OKR/Plan Input — ✅ EXISTS

**Disposition:** IMPLEMENTED. The platform has a mature OKR/spec/plan input surface.

**Evidence:**
- `builtin_objectives_create` / `builtin_objectives_update` — create and manage OKR objectives with portfolio/initiative/project scoping
- `builtin_key_results_create` / `builtin_key_results_update` — measurable KR targets under objectives
- `builtin_objectives_add_link` — links board epics/tasks to OKRs (lineage edges)
- `builtin_specs_create` / `builtin_specs_get` — PRD/spec input and retrieval
- `builtin_pmo_tree` — full portfolio ▸ initiative ▸ project hierarchy
- `api/src/application/pmo/portfolioRollup.ts` — rollup across the hierarchy
- `api/src/application/deck/dataSources.ts` — already pulls OKR/initiative data for board decks

**Verdict:** No new work needed. The OKR data model, input surface, and lineage edges are in place. Gap analysis (FR5) will query this existing data.

---

### FR5 — Gap Analysis (discovered vs planned) — ❌ MISSING

**Disposition:** NOT IMPLEMENTED. No module compares discovered features against planned OKRs/specs. This is a direct dependency on FR3.

**Evidence:**
- `api/src/application/insights/recommendationsEngine.ts` performs anomaly detection and prescriptive ranking — but over cost/quality/allocation/delivery metrics, not over feature-vs-OKR alignment
- `api/src/application/insights/deliveryInsights.ts` computes scope creep (work added post-baseline) — a related concept, but at the task level, not the feature-vs-OKR level
- No module anywhere joins discovered features ↔ objectives/key-results/specs
- No "feature creep" (unplanned discovered features) or "missing features" (planned-but-undiscovered) report exists

**What needs to be built:**
1. **Gap Analyzer** (`api/src/application/analysis/gapAnalysis.ts`): a pure function accepting `DiscoveredFeature[]` + `Objective[]`/`KeyResult[]`/`Spec[]` and emitting:
   - **Matched:** discovered feature → OKR mapping (confidence-scored)
   - **Missing:** planned OKR/KR with no matching discovered feature
   - **Unplanned:** discovered feature with no matching OKR/plan (feature creep)
   - **Coverage %** per objective/initiative
2. **Gap Report Route** (`/api/insights/gaps` or similar) serving the gap matrix

**Severity:** CRITICAL. This is the headline deliverable — "are we building what we planned?" Without it, the epic is a delivery-metrics dashboard that already exists.

**Effort estimate:** ~8 story points (gap analyzer + matching heuristics + route + caching). Depends on FR3 completion.

---

### FR6 — Quality Metrics Generation — ⚠️ PARTIAL

**Disposition:** Delivery-quality metrics are well-covered. Static code-quality metrics (cyclomatic complexity, duplication, test coverage) are MISSING.

**Evidence — EXISTS:**
- `api/src/application/insights/qualityInsights.ts` — uptime %, alerts, prod-incident count + MTTR, monthly failure rate, support tickets, defect aging buckets
- `api/src/application/insights/engineeringInsights.ts` — AI effectiveness: merge rate, CI-green rate, degraded rate, cost-per-merged-PR, adoption curves
- `api/src/application/insights/bottleneckInsights.ts` — stage-by-stage timing (avg/median dwell), rework signal (redoCount/reopenCount), aging WIP
- `api/src/application/insights/complianceInsights.ts` — audit evidence packs over `tool_audit_events`
- `api/src/application/metrics/workforceMetrics.ts` — DORA four keys (deployment frequency, lead time for changes, change failure rate, MTTR)
- `api/src/application/insights/aiImpactInsights.ts` — AI productivity score (throughput × quality × efficiency composite)

**Evidence — MISSING (the PRD specifically calls for these):**
- **Cyclomatic complexity:** no static analyzer reads source files and computes complexity scores
- **Code duplication:** no duplicate-detection across the repo (e.g., jscpd or similar)
- **Test coverage indicators:** no coverage report parser or coverage-trend tracking
- **Security vulnerability trends:** `complianceInsights.ts` covers audit events but not CVE/vulnerability scanning integration

**Gap:** The PRD explicitly lists "cyclomatic complexity, code duplications, test coverage indicators, security vulnerability trends via integrated tooling." These are static-analysis concerns, not delivery-metric concerns. The existing quality lens covers the operational/production quality dimension well; the static-code dimension is entirely absent.

**Severity:** Medium. The board deck's Quality slide works today with operational metrics. Static code quality is a deeper engineering concern. Could be scoped as a follow-on lens.

**Effort estimate:** ~8 story points (a `staticQualityInsights.ts` lens that wraps an external analyzer — e.g., a Worker binding to a complexity/duplication tool — or implements lightweight heuristics for JS/TS). The scanner foundation from FR3 (file content access) would be reused.

---

### FR7 — Progress & Resource Estimation — ⚠️ PARTIAL

**Disposition:** Throughput-based estimation exists. Gap-based estimation does not (depends on FR5). Code-complexity-based estimation does not (depends on FR6 static side).

**Evidence — EXISTS:**
- `api/src/application/insights/deliveryInsights.ts` — burnup/burndown series, completion-date forecast with optimistic/pessimistic band, on-track/at-risk/late grading vs target date, scope creep (work added post-baseline as count + %)
- `api/src/application/insights/deliveryScenario.ts` — what-if scenario planner: "if we add N developers at X% focus and adjust scope by Δ, when does it land?" with effort (person-weeks)
- `api/src/application/insights/bottleneckInsights.ts` — identifies the slowest stage and aging WIP
- `api/src/application/insights/velocityInsights.ts` — sprint-by-sprint velocity (completed/committed, estimation accuracy, throughput)
- `api/src/application/insights/allocationInsights.ts` — effort allocation by category

**Evidence — MISSING:**
- **Gap-based estimation:** "remaining work = sum of estimated effort for each missing feature" — requires FR5's gap list
- **Code-complexity-weighted estimation:** "complex modules cost more to change" — requires FR6's static analysis

**Severity:** Low. The delivery lens already answers "when will we finish?" and the scenario planner answers "what if we change the team?" The gap-based dimension is additive.

**Effort estimate:** ~3 story points (wiring the gap list from FR5 into the scenario planner's scope-delta input). Depends on FR5.

---

### FR8 — Reporting & Visualization — ✅ EXISTS

**Disposition:** IMPLEMENTED. The platform has a mature reporting and visualization pipeline.

**Evidence:**
- `api/src/application/reports/executiveSummary.ts` — KPI bundle (contributors, commits, PRs merged, issues resolved, activity score) consumed by both the report endpoint and the deck generator
- `api/src/application/deck/dataSources.ts` — assembles the full `DeckData` bundle from all lenses (DORA, finance, AI-impact, quality, people, R&D financials, portfolio rollup) + executive summary; cached at 120s KV + 30s L1
- `api/src/application/deck/DeckService.ts` — renders board-deck slides from templates
- `api/src/application/deck/TemplateLibraryService.ts` — slide template management
- `api/src/application/deck/render/GenerativeRenderer.ts` — generative slide rendering
- `api/src/application/insights/recommendationsEngine.ts` — ranked prescriptive recommendations with severity, anomaly detection, and trend commentary
- `api/src/presentation/routes/insightsRoutes.ts` — serves every lens as cached REST endpoints consumed by the frontend dashboard
- 30+ tested lens modules with pure-aggregation patterns (unit-testable without DB)

**Verdict:** No new work needed for the pipeline. When FR3/FR5 produce new data (discovered features, gaps), they follow the established pattern: add a collector, wire it into `dataSources.ts`, and the deck + dashboard consume it automatically.

---

### FR9 — Actionable Insights — ✅ EXISTS

**Disposition:** IMPLEMENTED. The recommendation engine already produces ranked, prescriptive insights with severity classification.

**Evidence:**
- `api/src/application/insights/recommendationsEngine.ts` (323 lines): ranked recommendations across cost, quality, allocation, and delivery categories; severity (`critical` | `warning` | `info`); current-vs-prior anomaly detection; dismissible (persisted `recommendation_dismissals` table, migration 0232)
- `api/src/application/insights/complianceInsights.ts` — evidence-pack export for audit requests
- `api/src/application/insights/aiImpactInsights.ts` — composite AI productivity scoring with week-over-week delta
- `api/src/application/insights/benchmarkingInsights.ts` — tenant-vs-industry benchmarking on DORA + AI effectiveness

**Verdict:** No new work needed. When FR5 delivers gap data, the recommendation engine can ingest it as a new `gap` category following the same rule+anomaly pattern.

---

## A.2 Acceptance Criteria Assessment

| AC | Criterion | Status | Notes |
|----|-----------|--------|-------|
| AC1 | Feature Discovery Accuracy >90% | ❌ UNMET | No feature discovery exists. Cannot be measured. |
| AC2 | Gap Reporting Clarity <10% FP/FN | ❌ UNMET | No gap analysis exists. Cannot be measured. |
| AC3 | Metric Consistency | ⚠️ PARTIAL | Delivery metrics are pure-function-tested and deterministic. Static code metrics (complexity, coverage, duplication) do not exist. |
| AC4 | Usability of Insights | ✅ MET | Board-deck slides, ranked recommendations with severity, dashboard lenses — all exist and are consumed. |
| AC5 | Scalability (<2h for 500k-1M LOC) | ❌ UNMET | No code-scanning pipeline exists to benchmark. The existing lenses are fast (cached reads over indexed DB queries) but do not scan source code. |
| AC6 | Configurability | ⚠️ PARTIAL | OKR/spec input exists. Scan scheduling does not. Heuristic configuration does not (no heuristics exist yet). |

---

## A.3 Implementation Roadmap

The gap assessment reveals that the codebase already delivers **FR1, FR4, FR8, and FR9** in full, and **FR2, FR6, and FR7** in part. The two critical missing pieces are **FR3 (Feature Discovery)** and **FR5 (Gap Analysis)** — without them, the epic delivers a delivery-metrics dashboard that already exists rather than the promised "feature set discovery & gap assessment."

### Phase 1 — Foundation (FR3): Feature Discovery Engine
- `api/src/application/analysis/featureDiscovery.ts` — pluggable heuristic pipeline
- Per-language analyzers: route scanner, schema scanner, domain scanner, UI scanner, config scanner
- `api/src/infrastructure/database/schema/analysis.ts` — `discovered_features` table + migration
- `/api/analysis/discover` endpoint

### Phase 2 — Core Value (FR5): Gap Analysis
- `api/src/application/analysis/gapAnalysis.ts` — feature↔OKR matcher
- `/api/insights/gaps` route serving the gap matrix
- Wire into `deck/dataSources.ts` for board-deck inclusion
- Wire into `recommendationsEngine.ts` as a new `gap` recommendation category

### Phase 3 — Completeness
- FR2: scheduled scan registry + cron dispatch
- FR6: static code quality lens (complexity, duplication, coverage)
- FR7: gap-weighted estimation (extend scenario planner)

### Phase 4 — Polish
- AC5: benchmark and optimize the scan pipeline for 500k-1M LOC
- AC6: heuristic-configuration UI

---

## A.4 Key Files Referenced in This Assessment

| File | Role |
|------|------|
| `api/src/application/repos/sources/RepoSource.ts` | VCS abstraction + file selection |
| `api/src/application/repos/sources/repoSourceBase.ts` | Shared VCS types |
| `api/src/application/repos/scanForPlaceholders.ts` | Existing post-commit source scanner |
| `api/src/application/insights/qualityInsights.ts` | Production quality lens |
| `api/src/application/insights/engineeringInsights.ts` | AI effectiveness lens |
| `api/src/application/insights/deliveryInsights.ts` | Burnup/forecast/scope-creep lens |
| `api/src/application/insights/deliveryScenario.ts` | What-if scenario planner |
| `api/src/application/insights/bottleneckInsights.ts` | Stage timing bottleneck lens |
| `api/src/application/insights/recommendationsEngine.ts` | Prescriptive recommendation engine |
| `api/src/application/insights/complianceInsights.ts` | Audit evidence lens |
| `api/src/application/insights/aiImpactInsights.ts` | AI productivity scoring |
| `api/src/application/insights/allocationInsights.ts` | Effort allocation lens |
| `api/src/application/insights/velocityInsights.ts` | Sprint velocity lens |
| `api/src/application/insights/lifecycleInsights.ts` | Lifecycle phase explorer |
| `api/src/application/insights/peopleInsights.ts` | Team/people health lens |
| `api/src/application/insights/rdFinancialsInsights.ts` | R&D financials lens |
| `api/src/application/insights/financeInsights.ts` | FinOps lens |
| `api/src/application/insights/funnelInsights.ts` | Innovation funnel lens |
| `api/src/application/insights/devexInsights.ts` | DevEx survey lens |
| `api/src/application/insights/benchmarkingInsights.ts` | Industry benchmarking |
| `api/src/application/insights/versionKeys.ts` | Cache-version tokens |
| `api/src/application/reports/executiveSummary.ts` | Executive KPI bundle |
| `api/src/application/deck/dataSources.ts` | Deck data assembly from all lenses |
| `api/src/application/deck/DeckService.ts` | Board-deck rendering |
| `api/src/presentation/routes/insightsRoutes.ts` | Insights REST surface |
| `api/src/application/metrics/workforceMetrics.ts` | DORA four-keys |
