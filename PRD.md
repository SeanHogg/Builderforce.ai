> **PRD** — drafted by Ada · task #139
> _Each agent that updates this PRD signs its change below._
> | Date | Agent | Change |
> |------|-------|--------|
> | 2025-07-17 | Business Analyst (code-creator) | Full codebase discovery pass — mapped existing capabilities, identified real gaps, broke epic into actionable stories with concrete code-surface anchors. |

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

## 4. Codebase Discovery — What Already Exists

A systematic audit of `api/src/` was conducted to determine which capabilities are already built vs. which are truly missing. Findings are mapped to each functional requirement below.

### 4.1 Codebase Integration (FR1) — ✅ FULLY EXISTS
- **`api/src/application/repos/sources/`** — Production-grade VCS providers:
  - `GitHubRepoSource.ts` — GitHub REST API client (tree, file contents, search, PRs)
  - `GitLabRepoSource.ts` — GitLab API client
  - `BitbucketRepoSource.ts` — Bitbucket Cloud API client
  - `RepoSource.ts` — Unified interface (`RepoSourceConfig`, `RepoTreeEntry`, `fetchTree`, `fetchFileContents`, `searchCode`, `selectEvidence` for budgeted file sampling)
  - `repoSourceBase.ts` — Shared types (`RepoProvider`, `FetchLike`)
- **`api/src/application/repos/RepoService.ts`** — Orchestrates repo access for tasks
- **`api/src/application/repos/readRepoContents.ts`** — Reads/clones repo contents
- **`api/src/application/repos/searchRepoCode.ts`** — Code search across repos
- **`api/src/application/repos/importRepoContents.ts`** — Bulk import pipeline
- **`api/src/application/repos/resolveRepo.ts`** / `resolveRepoCredential.ts` — Repo resolution + credential decryption
- **Verdict:** Full multi-provider VCS integration exists. No new integration work needed.

### 4.2 Scan Execution (FR2) — ✅ EXISTS
- Scheduled and on-demand scans already wired through `RepoService` + connector framework.
- `scanForPlaceholders.ts` already does a targeted scan pattern.
- **Verdict:** The scan infrastructure exists. The "scan for features" heuristic engine (FR3) is what's missing, not the scan mechanism itself.

### 4.3 Feature Discovery (FR3) — ❌ NOT IMPLEMENTED
- No heuristic-based feature-set discovery exists anywhere in the codebase.
- `RepoSource.selectEvidence()` samples files by priority (manifests → entrypoints → largest modules) but only for reading, not for feature classification.
- No feature catalog, feature taxonomy, or code-to-feature mapping exists.
- **Verdict:** This is the core greenfield work of this epic. Must be built from scratch on top of the existing repo-source layer.

### 4.4 OKR / Plan Input (FR4) — ⚠️ PARTIALLY EXISTS
- Full OKR system: objectives, key results, initiatives — all accessible via platform tools and the `initiatives`, `aiProgramInitiatives` DB tables.
- `dataSources.ts` in the deck module already stitches multiple collectors for executive-level reporting.
- **Missing:** A structured "feature plan" or "feature specification" entity that can be compared against discovered features. OKRs exist as goals, not as itemized feature checklists.
- **Verdict:** Need a Feature Plan / Feature Spec model and input surface. OKR linkage is a stretch goal.

### 4.5 Gap Analysis (FR5) — ❌ NOT IMPLEMENTED
- No gap analysis between code surfaces and planned items exists.
- **Verdict:** Depends on FR3 + FR4. Pure greenfield.

### 4.6 Quality Metrics Generation (FR6) — ⚠️ PARTIALLY EXISTS
- **Existing delivery/operations quality:**
  - `qualityInsights.ts` — Uptime %, incident count + MTTR, support tickets, defect aging buckets
  - `engineeringInsights.ts` — AI merge rate, CI-green rate, cost-per-merged-PR, degraded-run rate
  - `workforceMetrics.ts` (`computeDora`) — DORA four keys (deployment frequency, lead time, change failure rate, MTTR)
  - `velocityInsights.ts` — Sprint velocity, estimation accuracy
  - `devexInsights.ts` — Developer experience survey rollup
- **Missing code-intrinsic quality:**
  - Cyclomatic complexity
  - Code duplication detection
  - Test coverage indicators (from coverage reports)
  - Security vulnerability trends from SAST tooling
  - Static analysis rule violations
- **Verdict:** Delivery-quality metrics are strong. Code-quality metrics from static analysis are entirely absent and must be built. The repo-source layer can fetch code; a new static-analysis pipeline must interpret it.

### 4.7 Progress & Resource Estimation (FR7) — ⚠️ PARTIALLY EXISTS
- **Existing:**
  - `deliveryInsights.ts` — Burnup/burndown time series, completion-date forecast with optimistic/pessimistic bands, scope creep tracking
  - `forecasting.ts` — Exponential smoothing + Holt-Winters projection model
  - `peopleInsights.ts` — Hiring pipeline, open positions, developer satisfaction
  - `allocationInsights.ts` — Effort allocation by category vs. targets
  - `bottleneckInsights.ts` — Stage dwell times, rework detection, aging WIP
  - `lifecycleInsights.ts` — Phase analysis across the delivery lifecycle
- **Missing:** Resource estimation derived specifically from code analysis (gap size → effort estimate).
- **Verdict:** Delivery forecasting is strong. Code-based resource estimation is greenfield.

### 4.8 Reporting & Visualization (FR8) — ✅ LARGELY EXISTS
- **Existing:**
  - `insightsRoutes.ts` — 20+ cached insight lenses with Hono route handlers
  - `dataSources.ts` — Executive deck data-stitching layer
  - `DeckService.ts` / `TemplateLibraryService.ts` — Slide-deck generation
  - `executiveSummary.ts` — Narrative executive summary builder
  - Frontend dashboard surfaces consuming these endpoints
  - `builderInsights.ts` — Real-time builder-level push insights
  - `benchmarkingInsights.ts` — Industry-benchmark comparison
- **Missing:** Feature-alignment visualization (the "planned vs. actual feature map").
- **Verdict:** The reporting framework is mature. A new feature-alignment lens + visualization is the delta.

### 4.9 Actionable Insights (FR9) — ✅ EXISTS
- **`recommendationsEngine.ts`** — Ranked prescriptive recommendations from all lenses:
  - Cost: spend-forecast-over-budget signal, cost-per-merged-PR spike
  - Quality: low merge rate, model underperformance, high degraded rate
  - Allocation: category below goal, low capitalizable share
  - Delivery: DORA pressure signals
  - Persisted dismissals via `recommendation_dismissals` table
- **Verdict:** The recommendations engine exists. Extending it with feature-gap-driven recommendations is a natural extension.

## 5. Functional Requirements (with Discovery Notes)

*   **FR1: Codebase Integration** — ✅ EXISTS. `api/src/application/repos/sources/` (GitHub, GitLab, Bitbucket). No new work required.
*   **FR2: Scan Execution** — ✅ EXISTS. `RepoService` + connector framework supports scheduled and on-demand scans. No new work required.
*   **FR3: Feature Discovery** — ❌ GREENFIELD. New module: heuristic feature extraction from repo file trees + code content. Configurable rules (file structure patterns, API route conventions, DB schema tables, UI component patterns). This is the hardest requirement and the foundation for FR5.
*   **FR4: OKR/Plan Input** — ⚠️ NEEDS MODEL. New `feature_plans` / `feature_specs` table + input surface. Optional linkage to existing objectives/initiatives tables.
*   **FR5: Gap Analysis** — ❌ GREENFIELD. Depends on FR3 + FR4. Pure comparison engine: discovered features vs. planned features → matched / missing / unplanned.
*   **FR6: Quality Metrics Generation** — ⚠️ NEEDS STATIC-ANALYSIS SUBSYSTEM. Extend `qualityInsights.ts` or add a parallel `staticAnalysisInsights.ts` lens for code-intrinsic quality (complexity, duplication, coverage). The existing delivery-quality lens is complete.
*   **FR7: Progress & Resource Estimation** — ⚠️ NEEDS CODE-DERIVED ESTIMATION. Extend `deliveryInsights.ts` / `forecasting.ts` to accept gap-size inputs from FR5 and produce effort estimates. The delivery-forecasting math is already built.
*   **FR8: Reporting & Visualization** — ⚠️ NEEDS FEATURE-ALIGNMENT VIEW. New insight lens (`featureAlignmentInsights.ts`) + frontend component. Reuses the existing insights caching + route pattern.
*   **FR9: Actionable Insights** — ⚠️ NEEDS EXTENSION. Add feature-gap recommendation rules to `recommendationsEngine.ts` (new category: `features` with rules for "critical feature missing", "significant unplanned work detected").

## 6. User Stories / Epic Breakdown

### Story A: Feature Heuristic Engine (FR3)
**As a** Tech Lead, **I want to** point the platform at a repository and have it automatically discover the feature set from the codebase, **so that** I have an accurate, up-to-date map of what is actually built.

**Implementation anchors:**
- New module: `api/src/application/insights/featureDiscovery.ts`
- Consumes `RepoSource.fetchTree()` + `RepoSource.fetchFileContents()` (already built)
- Configurable heuristic rules (stored in a new `feature_heuristics` table or a JSON config column)
- Heuristic types: file-structure patterns (e.g. `src/features/<name>/`), API route patterns (e.g. `POST /api/<resource>`), DB schema tables, UI component directories, package/dependency signals
- Output: `DiscoveredFeature[]` — `{ name, category, confidence, evidence: [{ path, kind, snippet }] }`
- Pure extraction function export for testability (mirrors every other insights lens)
- Budgeted: reuses `selectEvidence()` pattern for sampling large repos within token limits

**Estimated effort:** 5–8 story points (the heaviest story)

### Story B: Feature Plan Model & Input (FR4)
**As a** Product Manager, **I want to** define a feature plan (a checklist of planned features mapped to OKRs), **so that** the system can compare what is planned against what is discovered.

**Implementation anchors:**
- New DB table: `feature_plans` (id, tenantId, name, description, createdAt, linkedObjectiveId nullable)
- New DB table: `feature_plan_items` (id, planId, name, category, priority, notes)
- Migration: `api/migrations/` next available number
- New route: `POST/GET/PATCH /api/feature-plans` in a new route module or appended to `insightsRoutes.ts`
- Optional: link each plan item to an existing objective or key result
- Schema additions: new tables registered in the appropriate `api/src/infrastructure/database/schema/<context>.ts` module

**Estimated effort:** 3–5 story points

### Story C: Gap Analysis Engine (FR5)
**As an** Engineering Manager, **I want to** see a side-by-side comparison of the discovered feature set against the feature plan, **so that** I can immediately see what's missing, what's complete, and what was built that wasn't planned.

**Implementation anchors:**
- New module: `api/src/application/insights/featureGapAnalysis.ts`
- Pure function: `computeFeatureGap(discovered: DiscoveredFeature[], planned: FeaturePlanItem[]) → FeatureGapReport`
- Report shape: `{ matches: Match[], missing: FeaturePlanItem[], unplanned: DiscoveredFeature[], coveragePct: number }`
- Match scoring: fuzzy name matching + category alignment + evidence correlation
- Export pure functions for unit-testability
- Route: `GET /api/insights/feature-gap?planId=X&repoId=Y` (cached, mirrors existing lens pattern)

**Estimated effort:** 3–5 story points

### Story D: Static-Analysis Quality Metrics (FR6)
**As a** Tech Lead, **I want to** see code-intrinsic quality metrics (complexity, duplication, coverage) for each repository, **so that** I can identify quality hotspots beyond delivery signals.

**Implementation anchors:**
- New module: `api/src/application/insights/staticAnalysisInsights.ts`
- Reads code content via `RepoSource.fetchFileContents()` (already built)
- Computes: per-file complexity (regex-based or tree-sitter), duplication ratio (n-gram or AST hash), test-file-to-source-file ratio as a coverage proxy, dependency graph depth
- Pure analysis functions (no DB queries — operates on fetched file content)
- Cached via the existing `versionKeys` pattern
- Extend `qualityInsights.ts` or stand alone as a new lens
- Route: `GET /api/insights/quality/code?repoId=X`

**Estimated effort:** 5–8 story points (complex parsing)

### Story E: Code-Derived Resource Estimation (FR7)
**As a** Project Manager, **I want to** see an estimate of remaining effort based on the size of the feature gaps and the complexity of the missing work, **so that** I can plan resource allocation accurately.

**Implementation anchors:**
- New module: `api/src/application/insights/gapEffortEstimator.ts`
- Input: `FeatureGapReport` (from Story C) + historical velocity data (from `velocityInsights.ts`)
- Output: `GapEffortEstimate` — `{ estimatedPoints, estimatedWeeks, confidenceBand, assumptions[] }`
- Heuristic: gap count × average story points per feature × team velocity
- Reuses `forecasting.ts` projection model for confidence bands
- Pure function for testability
- Route: `GET /api/insights/feature-gap/effort?planId=X&repoId=Y`

**Estimated effort:** 2–3 story points

### Story F: Feature-Alignment Reporting & Visualization (FR8)
**As a** VP of Engineering, **I want to** see a dashboard that visualizes feature alignment (planned vs. actual), quality trends, and progress against goals, **so that** I can report to the board with confidence.

**Implementation anchors:**
- New lens: `api/src/application/insights/featureAlignmentInsights.ts`
- Composes: feature gap report + quality metrics + delivery forecast into a single lens payload
- New frontend component: feature-alignment chart (heatmap / tree-map of planned-vs-discovered)
- Reuses `DeckService.ts` / `dataSources.ts` for slide-deck inclusion
- Route: `GET /api/insights/feature-alignment?planId=X`

**Estimated effort:** 3–5 story points (mostly frontend)

### Story G: Feature-Gap Recommendations (FR9)
**As a** VP of Engineering, **I want the** system to proactively tell me when a critical planned feature has no code evidence, **so that** I can intervene before the deadline.

**Implementation anchors:**
- Extend `recommendationsEngine.ts`:
  - New category: `features`
  - Rules: "critical feature <X> has zero discovered evidence" → severity `critical`
  - Rules: "unplanned feature <Y> consuming significant code surface" → severity `warning`
  - Rules: "feature coverage below 70%" → severity `warning`
- Reuses existing `Recommendation` shape, dismissal persistence, and ranking
- Pure rule functions exported for unit tests

**Estimated effort:** 2 story points

## 7. Dependency Graph

```
Story A (Feature Discovery)
  ├── Story C (Gap Analysis) ── requires A + B
  ├── Story E (Effort Estimation) ── requires C
  └── Story F (Alignment Reporting) ── requires C + D

Story B (Feature Plan Model) ── independent

Story D (Static Analysis) ── independent, feeds F

Story G (Recommendations) ── requires C
```

**Recommended implementation order:** A → B → C → (D, E, F in parallel) → G

## 8. Acceptance Criteria

*   **AC1: Feature Discovery Accuracy:** The system accurately identifies >90% of a sample set of known features within a typical codebase.
*   **AC2: Gap Reporting Clarity:** Gap analysis reports clearly and correctly articulate discrepancies between planned and implemented features, with a false positive/negative rate below 10%.
*   **AC3: Metric Consistency:** Code quality metrics (e.g., complexity, coverage) are consistent and reproducible across multiple scans of the same codebase state.
*   **AC4: Usability of Insights:** Generated reports and dashboards are intuitive, provide clear visualizations, and empower leadership to make informed decisions without additional manual interpretation.
*   **AC5: Scalability & Performance:** The system can successfully process a medium-sized codebase (e.g., 500k-1M Lines of Code) within a reasonable timeframe (e.g., <2 hours for a full scan).
*   **AC6: Configurability:** Users can easily configure scan schedules, define feature heuristics, and input OKR data.

## 9. Out of Scope

*   Automated code generation, refactoring, or direct remediation of identified code quality issues.
*   Direct integration with project management tools for automated task creation, assignment, or status updates (analysis outputs can be manually integrated).
*   Real-time continuous monitoring beyond scheduled or on-demand discrete scans.
*   Providing specific, prescriptive solutions for *how* to implement missing features or fix identified quality problems (only identifies *what* the problem is).
*   Collection or analysis of individual developer performance metrics.

## 10. Architecture Constraints

All new modules MUST follow the existing insights-lens conventions observed in the codebase:

1. **Pure-core pattern:** Export a pure aggregation/summarization function (unit-testable without a DB) plus a thin `compute*` wrapper that does the I/O.
2. **Caching:** Use the existing `getOrSetCached` + `versionKeys` pattern from `insightsRoutes.ts`. Each new lens gets a version key in `versionKeys.ts`.
3. **Route convention:** Hono route handler that calls the compute function, caches the result, and returns JSON. Mirrors the existing `GET /api/insights/<lens>` pattern.
4. **No new dependencies without justification:** The api runs on Cloudflare Workers (Hono, no Express). Drizzle ORM for DB. `RepoSource` for VCS access. No zod, no Express.
5. **Schema additions:** New tables go in the appropriate `api/src/infrastructure/database/schema/<context>.ts` module (or a new one), registered in the barrel `schema.ts`.
6. **Migrations:** Sequential numbering in `api/migrations/`. Check the latest migration number before creating.
