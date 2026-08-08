> **PRD** — drafted by Ada (Sr. Product Mgr) · task #552
> _Each agent that updates this PRD signs its change below._
> - **Business Analyst** (this run): Authored the Requirements section; documented domain mismatch and re-scoped to platform-appropriate recommendation capabilities.

# Product Requirements Document: Recommendation Engine

## Problem & Goal
- **Problem:** The current platform lacks any mechanism to generate personalized recommendations for users. No data linking, recommendation logic, or UI components exist, resulting in a static experience that does not surface relevant items, content, or actions to individual users.
- **Goal:** Implement a functional recommendation engine that ingests user behavioral data, generates item-to-item or user-to-item recommendations, and delivers them through dedicated UI components, improving engagement, discovery, and conversion.

## Target users / ICP roles
- **End Users:** Consumers browsing the platform who benefit from personalized suggestions (e.g., shoppers, content viewers).
- **Business Stakeholders:** Product managers, marketing teams, and data analysts who use recommendation performance to optimize catalog exposure and campaigns.
- **Internal Developers:** Engineers who will maintain and extend the engine's data pipelines and feedback loops.

## Scope
- Build a batch-based recommendation generation pipeline that processes historical user-item interactions (clicks, views, purchases, ratings) and produces daily precomputed recommendation lists.
- Store generated recommendations in a queryable serving layer for low-latency retrieval.
- Expose recommendations via REST API endpoints with support for user-specific and item-based "similar to" requests.
- Develop reusable frontend widgets (carousel, grid) to display recommendations on key surfaces (e.g., homepage, product detail page, user profile).
- Instrument recommendation impressions and clicks for future model evaluation.
- Deliver a minimal admin dashboard to trigger a manual refresh of recommendations and view basic health metrics.

## Functional requirements
1. **Data Ingestion & Linking**  
   - Consume event streams (clicks, views, add-to-cart, purchases) from the event bus.  
   - Link events to unified user profiles and item catalogs to build an interaction matrix.  
   - Support daily incremental updates; handle late-arriving data within a configurable window.

2. **Recommendation Generation**  
   - Compute collaborative filtering (user-based and item-based) and optionally content-based similarity.  
   - Generate "Recommended for You" ranked lists per user (max 50 items).  
   - Generate "Similar Items" lists per item (max 20 items) based on co-occurrence.  
   - Allow configurable recency and popularity boosts, and filter out previously purchased/consumed items.

3. **Serving Layer**  
   - Store precomputed recommendations in a key-value store (e.g., Redis or DynamoDB) with user/item IDs as keys.  
   - Provide `GET /recommendations/for-user/{user_id}?limit=N` returning a ranked list of item IDs with predicted scores.  
   - Provide `GET /recommendations/similar-items/{item_id}?limit=N` returning similar items.  
   - Respond within 50ms p99 for cached results.

4. **Frontend Components**  
   - `RecommendationCarousel` component: displays horizontally scrollable items with title, image, and link.  
   - `RecommendationGrid` component: grid layout.  
   - Components must accept a `source` prop (e.g., "homepage", "pdp") and fire impression/click events.

5. **Feedback Loop**  
   - Log every served impression and every user click on a recommendation.  
   - Forward logs to a data lake for future model retraining and bias analysis.

6. **Admin Controls**  
   - Dashboard page listing generation run status, last successful run timestamp, and item coverage.  
   - Button to trigger an on-demand full recalculation (asynchronous job).  

## Acceptance criteria
- A daily scheduled job successfully produces recommendation lists for 100% of active users (users with ≥1 interaction in the last 90 days).
- API endpoints return valid recommendations within 50ms p99 for at least 99.9% of requests under normal load.
- UI components render correctly with fallback text when no recommendations exist; they fire impression and click events verified in browser console/network.
- Empty user state (new user with no interactions) returns a preconfigured fallback strategy (e.g., popular items) and logs a fallback event.
- Admin page displays correct last-run timestamp, job success status, and item coverage (percentage of catalog items appearing in at least one recommendation list).
- Manual recalculation completes within 2 hours for up to 1 million users and 100k items.
- System handles duplicate events and missing user/item IDs gracefully without crashes or corrupt recommendation output.
- All events (impression, click) are successfully delivered to the data lake and queryable within 30 minutes.

## Out of scope
- Real‑time / streaming recommendation updates; initial release is batch-only.
- Advanced deep‑learning models (e.g., transformers, two‑tower neural networks); initial model is classic collaborative filtering.
- A/B testing framework for recommendations; that will be built separately.
- Personalizing based on demographic or contextual data (time, location, device) beyond user‑item interactions.
- Multi‑lingual or cross‑domain recommendations.
- Self‑service UI for business users to manually curate or override recommendations.
- Integrating external paid recommendation APIs.

## Requirements

_Owned by the business-analyst._

### Domain Analysis — PRD-to-Platform Mapping

**Critical finding:** The PRD body (authored by Ada, Sr. Product Manager) describes a **consumer e-commerce recommendation engine** — collaborative filtering over clicks/purchases/ratings, "Recommended for You" product carousels, item-to-item similarity, a data lake feedback loop, and an admin pipeline dashboard. However, the bound repository (`seanhogg/builderforce.ai`) is **not** a consumer platform — it is an **AI dev-workforce orchestration platform** whose domain entities are projects, tasks, AI agent runs, LLM usage, DORA delivery metrics, and workforce allocation. There is no item catalog, no shopper identity, no product detail page, and no event bus for consumer interactions.

**What already exists (and is relevant):**

| Existing subsystem | File | What it does |
|---|---|---|
| Prescriptive business-insight recommendations | `api/src/application/insights/recommendationsEngine.ts` | Computes ranked operational recommendations ("budget at risk", "low merge rate", "high change-failure rate") from finance/engineering/allocation/DORA lenses. Rules are pure and unit-testable. Dismissals persist via `recommendation_dismissals` table (migration 0232). |
| Assignee recommendation | `api/src/application/metrics/assigneeRecommender.ts` | Ranks candidate workforce members by fit score (availability, WIP capacity, skill match, ramp factor) for task assignment. |
| Recommendations API routes | `api/src/presentation/routes/recommendationsRoutes.ts` | `GET /api/insights/recommendations` (ranked prescriptive actions), `POST /api/insights/recommendations/dismiss`, `GET /api/insights/space` (SPACE metrics). Mounted alongside `aiImpactRoutes.ts` which bundles the same cache. |
| Cache + dismissal infrastructure | `api/src/infrastructure/cache/readThroughCache.ts`, migration 0232 | Short-TTL read-through cache with per-tenant version-token invalidation on dismissal. |

**What the PRD describes that simply cannot exist on this platform:**
- Consumer user-item interaction matrices (clicks, views, add-to-cart, purchases) — no consumer catalog, no shopping cart
- Collaborative filtering (user-based / item-based) over consumer products — no item corpus
- `RecommendationCarousel` / `RecommendationGrid` frontend widgets displaying products — the frontend is a workforce dashboard
- Data lake feedback pipeline for impression/click logs — no data lake integration
- An admin dashboard for "generation run status" and "item coverage" — the platform's recommendations are computed live, not batch-generated

### Re-scoped Requirements — Platform-Appropriate Recommendation Capabilities

The following requirements map the PRD's *intent* (personalized, actionable recommendations surfaced through reusable UI) to what this platform *can actually deliver*. They extend the existing `recommendationsEngine.ts` and `assigneeRecommender.ts` foundation.

---

#### R1: Unified Recommendation Domain Model

**R1.1** A single `Recommendation` type SHALL be shared across all recommendation surfaces (insights, assignee, project, model). It MUST carry at minimum: a stable `key` for dismissal tracking, a `category` enum, a `severity` level, a human-readable `title` and `detail`, a quantifiable `metric` string, and a prescriptive `recommendation` action.

**R1.2** The existing `Recommendation` interface in `recommendationsEngine.ts` SHALL be promoted to a shared domain type at `api/src/domain/recommendation/types.ts` and re-exported so the assignee recommender and any future recommenders consume the same contract.

**R1.3** The `RecCategory` enum SHALL be extended from `'cost' | 'quality' | 'allocation' | 'delivery'` to include `'staffing'`, `'model'`, and `'project'` so future recommenders have canonical slots.

---

#### R2: Model Routing Recommendations (New)

**R2.1** A `ModelRecommender` service SHALL be implemented at `api/src/application/insights/modelRecommender.ts`. Given a task's characteristics (task type, estimated complexity, project modality, historical merge rates per model for similar tasks), it SHALL return a ranked list of recommended LLM models with fit scores (0–100).

**R2.2** The recommender SHALL consume the existing `engineeringInsights.byModel` data (merge rate per model, degraded rate, runs count) and the learned model routing table (migration 0197) as inputs.

**R2.3** The recommender SHALL expose a pure `rankModels(inputs: ModelRankingInputs): ModelRecommendation[]` function, unit-testable without a database.

**R2.4** A `GET /api/insights/model-recommendations?projectId=X&taskType=Y` endpoint SHALL serve the ranked list, cached under the existing short-TTL policy.

---

#### R3: Project Health Recommendations (New)

**R3.1** A `ProjectRecommender` service SHALL be implemented at `api/src/application/insights/projectRecommender.ts`. It SHALL consume the existing `computeProject360.ts` health-tier computation and the project's diagnostic profiles to emit prescriptive actions.

**R3.2** Recommendations SHALL include, at minimum: projects with stalled tickets (no lane-move in 7+ days), projects with zero agent runs in the window, projects approaching budget limits, and projects whose DORA metrics have regressed vs. the prior window.

**R3.3** The pure derivation function SHALL be exported and unit-testable.

**R3.4** A `GET /api/insights/project-recommendations?days=N` endpoint SHALL serve the ranked list, filtered by tenant dismissals.

---

#### R4: Extended Assignee Recommendations (Enhance Existing)

**R4.1** The existing `assigneeRecommender.ts` SHALL emit its `Recommendation` results in the unified `Recommendation` shape (R1), adding a `category: 'staffing'` field.

**R4.2** Each assignee recommendation SHALL carry a stable `key` (e.g., `staffing.candidate.{memberRef}`) so the manager can dismiss a candidate for a given project context.

**R4.3** The recommendation detail SHALL include the reasons array (e.g., "3/5 skills matched", "2 WIP slots free") as part of the `detail` field.

---

#### R5: Unified Recommendations API Surface

**R5.1** A new composite endpoint `GET /api/insights/recommendations/feed` SHALL accept query parameters `?categories=cost,staffing,model,project&days=30&projectId=X` and return a merged, interleaved, ranked feed of recommendations from all active recommenders (R1–R4).

**R5.2** The feed SHALL respect the existing dismissal mechanism: a dismissed `rec_key` from any category SHALL be filtered out of the composite feed.

**R5.3** Each item in the feed SHALL carry a `source` field (e.g., `"insights"`, `"staffing"`, `"model"`, `"project"`) so the frontend can render category-appropriate cards.

---

#### R6: Recommendation UI Components (Frontend)

**R6.1** A `RecommendationList` component SHALL render a vertically stacked list of recommendation cards, grouped by category, with dismiss (×) buttons that POST to `/api/insights/recommendations/dismiss`.

**R6.2** A `RecommendationBadge` component SHALL display severity (critical/warning/info) as a color-coded dot/badge alongside the metric value. It SHALL accept a `source` prop (e.g., `"project-dashboard"`, `"home"`) and fire an analytics event on render (impression) and on dismiss (action).

**R6.3** The components SHALL be implemented in the existing dashboard frontend at `Builderforce.ai/frontend/src/dashboard/` following the patterns established by `CrossProjectHealthDashboard.tsx`.

**R6.4** When the feed returns zero recommendations (all dismissed or none generated), the component SHALL render an empty-state message: "No recommendations right now. Everything looks on track."

---

#### R7: Recommendation Telemetry

**R7.1** Every recommendation impression (component mount) and user action (dismiss, click-through) SHALL write a structured event to the existing `activity_log` table (migration 0287) with `eventType = 'recommendation_impression' | 'recommendation_dismiss' | 'recommendation_click'`.

**R7.2** Each event SHALL carry the `rec_key`, `category`, `source` prop, `tenantId`, and `userId` (if authenticated).

**R7.3** A `GET /api/insights/recommendations/telemetry?days=N` endpoint SHALL return aggregate impression/dismiss/click counts grouped by category and rec_key for auditing recommendation effectiveness.

---

#### R8: Admin Controls (Minimal)

**R8.1** The existing manager-facing AI-overview dashboard (served by `aiImpactRoutes.ts`) SHALL include a recommendations summary section showing: total active recommendations, count by severity, and the timestamp of the latest cache refresh.

**R8.2** A `POST /api/insights/recommendations/invalidate` endpoint (manager role) SHALL bump the version token for all recommendation cache keys, forcing a live recomputation on the next read. This serves as the "manual refresh" equivalent.

---

### What the Re-scope Excludes (and Why)

| PRD item | Exclusion rationale |
|---|---|
| Collaborative filtering, interaction matrices, item similarity | No item catalog or consumer interaction data exists on this platform. |
| `RecommendationCarousel` / `RecommendationGrid` product widgets | The frontend is a workforce dashboard, not a consumer storefront. |
| Event bus ingestion (clicks, views, add-to-cart) | No consumer event bus. Activity is tracked through `activity_log`. |
| Data lake feedback pipeline | No data lake integration. Telemetry uses existing `activity_log`. |
| Batch recommendation generation pipeline (Spark/MapReduce style) | Platform recommendations are computed live from hot operational data, not batch-generated. |
| "Item coverage" metric | No item corpus to measure coverage against. |
| 50ms p99 SLA on KV store lookups | Existing cache layer (readThroughCache) already provides sub-50ms response; the SLA is on the live computation, which is scoped by the 2-hour manual recalculation window — not applicable. |

---

### Traceability Matrix

| Requirement | Existing Platform Foundation | New Implementation Needed |
|---|---|---|
| R1 (unified type) | `recommendationsEngine.ts` `Recommendation` interface | Extract to `api/src/domain/recommendation/types.ts` |
| R2 (model recommender) | `engineeringInsights.byModel`, migration 0197 routing | New `modelRecommender.ts` + route |
| R3 (project recommender) | `computeProject360.ts`, diagnostic profiles | New `projectRecommender.ts` + route |
| R4 (extended assignee) | `assigneeRecommender.ts` | Add unified type + stable keys |
| R5 (composite feed) | `recommendationsRoutes.ts` caching layer | New `/feed` endpoint |
| R6 (UI components) | `CrossProjectHealthDashboard.tsx` patterns | New `RecommendationList`, `RecommendationBadge` |
| R7 (telemetry) | `activity_log` table (migration 0287) | Instrumentation in UI + `/telemetry` endpoint |
| R8 (admin) | `aiImpactRoutes.ts` | Summary section + `/invalidate` endpoint |

### Open Questions for Stakeholders

1. **Should the assignee recommender's candidate keys be dismissible?** Dismissing a candidate across all projects may hide someone the manager wants for a different task. Consider scoping dismissals to (tenant, rec_key, project_id) instead of (tenant, rec_key).

2. **Should model recommendations be per-project or per-task?** A model that under-merges on React tasks may excel on Python data tasks. The current proposal is per-project; a finer-grained per-task-type recommendation would be more useful but requires more wiring.

3. **Should the recommendation feed support push (WebSocket/SSE) updates?** The current PRD is batch-only, but since these are computed live from hot data, a real-time refresh on the dashboard could be valuable. This is out of scope but worth scheduling.

4. **Is there appetite to re-title the PRD?** The current title ("Recommendation Engine") and the PRD body describe a consumer product recommender. Renaming to "Operational Recommendations Engine" or "AI Workforce Recommendations" would avoid future confusion.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
