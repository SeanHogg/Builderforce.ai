# 01 — BuilderForce Domain Model & Tenancy

This is the canonical data model for BuilderForce. It is expressed in Prisma-style pseudo-schema
(the agentic builder may target Prisma/Postgres, Drizzle, or another ORM — the shapes are what
matter). Every model that moved from BurnRateOS preserves the **full field union** of its source
(per the "consolidate without losing functionality" rule). New agentic models are marked
**[NEW]**.

---

## 1. Conventions

- IDs are the **platform's own types** (§4.1): `serial` for `projects` / `tasks` (each with a unique
  human `key`), `uuid` for `specs`, `boards`, `swimlanes`, `sprints`, `product_releases` and OKRs.
  BurnRateOS source uuids are mapped onto them through import lineage, not kept as primary keys —
  the PM spine is UNIFIED onto `projects` / `tasks` / `specs` (operator decision 2026-09-12).
- `Json` = jsonb. `Decimal(p,s)` preserved from source for money/percentages.
- Every business entity carries **`tenantId` + `segmentId`** (see §3) — on the platform,
  `tenant_id integer` → `tenants` and `segment_id uuid` → `segments` (NOT NULL via the 0056 trigger). The composite index
  `@@index([tenantId, segmentId, …])` leads on both.
- `createdAt @default(now())`, `updatedAt @updatedAt` on every table unless noted.
- Foreign keys to identity (`userId`, `assigneeId`, `teamId`) are **string IDs that reference
  federated identity** (§2), not local FKs — BuilderForce does not own `User`/`Team`/`Company`.

---

## 2. Federated identity (owned by BurnRateOS, mirrored in BuilderForce)

BuilderForce does **not** own users, teams, companies, or accounts. It receives them as **claims**
over SSO (doc 05) and keeps a thin read-cache so the UI can render names/avatars without a
round-trip. Source of truth stays in BurnRateOS.

```prisma
// Thin denormalized cache, refreshed from SSO claims + a directory webhook.
model IdentityCache {
  id           String   @id            // = BurnRateOS user/team/company id
  tenantId     String
  segmentId    String?                 // null for tenant-wide identities (e.g. tenant admin)
  kind         IdentityKind            // USER | TEAM | COMPANY | ACCOUNT
  displayName  String
  email        String?
  avatarUrl    String?
  role         String?                 // last-seen RBAC role from claims
  persona      String?                 // CEO|CFO|CTO|CRO|CMO|CPO|CHRO|CISO
  raw          Json?                   // full last claim payload for debugging
  lastSeenAt   DateTime
  @@index([tenantId, segmentId, kind])
}

enum IdentityKind { USER TEAM COMPANY ACCOUNT }
```

Anywhere a moved model had `assigneeId`, `reporterId`, `creatorId`, `userId`, `teamId`,
`createdBy` → keep the column as a plain string id; resolve display via `IdentityCache`.

---

## 3. Tenancy & isolation (the core invariant)

```prisma
model Tenant {
  id          String   @id @default(uuid())
  slug        String   @unique          // "burnrateos"
  name        String
  kind        TenantKind @default(EMBEDDED)  // EMBEDDED (via host IdP) | DIRECT (own auth, future)
  idpIssuer   String?                   // OIDC issuer for SSO (BurnRateOS)
  status      TenantStatus @default(ACTIVE)
  settings    Json                      // feature flags, default plan, branding
  createdAt   DateTime @default(now())
  segments    Segment[]
}

model Segment {
  id            String   @id @default(uuid())
  tenantId      String
  // The host's tenant coordinates — for BurnRateOS this is (accountId, companyId).
  externalAccountId String                // BurnRateOS accountId
  externalCompanyId String                // BurnRateOS companyId
  displayName   String                    // cached company name
  plan          String   @default("FREE") // mirrors host plan: FREE|PRO|ENTERPRISE
  status        SegmentStatus @default(ACTIVE)
  settings      Json                      // per-segment overrides
  provisionedAt DateTime @default(now())
  lastActiveAt  DateTime?
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, externalAccountId, externalCompanyId])
  @@index([tenantId, status])
}

enum TenantKind   { EMBEDDED DIRECT }
enum TenantStatus { ACTIVE SUSPENDED }
enum SegmentStatus{ ACTIVE SUSPENDED ARCHIVED }
```

**Rules the builder must enforce (non-negotiable):**

1. Every request resolves a **Segment** before touching data — `resolveSegment(jwt)` maps
   `{tenantId, accountId, companyId}` claims → `Segment.id` (lazy-create on first request).
2. Every repository function takes `(tenantId, segmentId)` as its first scope and **adds them to
   every WHERE clause** — including agent-initiated writes.
3. Cross-segment reads are impossible by construction. There is no "global" query path for
   business entities. (Tenant-admin/observability queries are a separate, explicitly-audited path.)
4. The old `companyId`/`accountId` columns from BurnRateOS are **replaced** by `segmentId`
   (which encodes both). Do not also carry `companyId` — Segment is the scope now.

---

## 4. The PM spine — UNIFIED onto the platform (decided 2026-09-12)

> **Operator decision 2026-09-12: unify, do not build beside.** This document originally specified
> its own uuid-keyed project-management spine (`WorkItem`, `KanbanBoard`, `KanbanColumn`, `Sprint`,
> `Delivery`, release planning, `ItemActivity`, …). Every one of those concepts already has an owner
> in the platform schema (`api/src/infrastructure/database/schema/*.ts`, PRD 20). The spine is
> therefore **unified onto `projects` / `tasks` / `specs`** and their existing neighbours: there is
> no parallel work-item table, no second board, no second release, and ids are the platform's own
> types. The sections below are that mapping. The BurnRateOS field union survives as a
> field-by-field *provenance* map (§4.2), not as DDL.
>
> **Code state.** Migration `1160_unify_pm_spine_onto_platform_owners.sql` removed the last parallel
> pieces: the `work_item_ref` / `sprint_ref` / `project_ref` string pointers became typed foreign
> keys, the duplicate `kanban_columns` and `release_plans` tables were folded into `swimlanes` and
> `product_releases` and dropped, and `task_type` gained `bug`, the one spec kind with no owner.

### 4.1 Ids and scope — platform types, not spec uuids

| Entity | Primary key | Human key | Tenancy / scope |
|---|---|---|---|
| `projects` | `serial` (`integer`) | `projects.key` (unique) + `public_id uuid` | `tenant_id integer` → `tenants`; `segment_id uuid` → `segments` |
| `tasks` (the work item) | `serial` (`integer`) | `tasks.key` (unique, e.g. `PROJ-12`) | `tenant_id` (DB-derived from the project, 0944), `segment_id`, `project_id` |
| `specs` (PRD / architecture spec) | `uuid` | — | `tenant_id`, `segment_id`, optional `project_id` |
| `boards` / `swimlanes` | `uuid` | `swimlanes.key` (unique per board) | one board per project (`UNIQUE(project_id)`, `projects.primary_board_id`) |
| `sprints` | `uuid` | `name` | `tenant_id`, `segment_id`, optional `project_id` |
| `product_releases` | `uuid` | `version` | `tenant_id`, `segment_id`, optional `project_id` |
| `objectives` / `key_results` / `initiatives` | `uuid` | — | `tenant_id`, `segment_id`, optional `project_id` |

Rules:

- A reference to a work item is **`task_id integer`**, never a `work_item_ref` string; to a sprint,
  **`sprint_id uuid`**; to a project, **`project_id integer`**.
- A foreign key proves the row exists, not whose it is: every writer checks tenancy first
  (`taskInTenant`, `scopedToTenant`).
- Across a domain boundary the id is carried without a Drizzle `.references()` and the foreign key
  lives in the migration (the `projects.company_id` and `product_ideas.promoted_task_id`
  precedent), so `check-domain-boundary` stays clean.
- BurnRateOS source uuids are **not** kept as primary keys. The data gate (PRD 19) maps them onto
  platform ids through `import_run_id` lineage.

### 4.2 `WorkItem` → `tasks` (field provenance)

The spec's "one row is a backlog item or a kanban card" model is exactly a `tasks` row: the lane it
sits in decides whether it reads as backlog or board.

| Spec `WorkItem` field(s) | Platform owner |
|---|---|
| `id` (uuid) | `tasks.id` (serial) + `tasks.key` |
| `tenantId`, `segmentId` | `tasks.tenant_id`, `tasks.segment_id` (both derived from the project) |
| `title`, `description` | `tasks.title`, `tasks.description` |
| `type` — source `ItemType` INITIATIVE / EPIC / STORY / TASK / BUG / SUBTASK | INITIATIVE → an `initiatives` row (work links to it through `tasks.initiative_id`); EPIC → `task_type = 'epic'`; STORY, TASK → `task_type = 'task'`; SUBTASK → `task_type = 'task'` with `parent_task_id`; **BUG → `task_type = 'bug'`** (added by 1160 — a new kind is a value, not a table). Platform-only kinds: `gap`, `security`, `incident`, `product`, `design`. |
| `priority` LOW / MEDIUM / HIGH / CRITICAL | `tasks.priority` `low` / `medium` / `high` / `urgent` (CRITICAL → `urgent`) |
| `assigneeId` | `tasks.assigned_user_id` (a person) **or** `assigned_agent_ref` / `assigned_agent_host_id` (an agent). One owner, never both. |
| `reporterId` | the creating actor in `activity_log` — not a column |
| `parentId` | `tasks.parent_task_id` (self-FK, `ON DELETE SET NULL`) |
| `tags` | no column. Work is classified by `task_type`, `action_type` (technical axis) and `allocation_category` (investment axis). |
| `origin` MANUAL / ONBOARDING / AI_GENERATED / MVP_SCAFFOLDING / AGENT | `tasks.source` (external board), `tasks.import_run_id` (import lineage), `tasks.decomposition_source` (llm / heuristic / manual) and the creating actor in `activity_log` |
| `stage` STRATEGIC_BACKLOG / KANBAN_BOARD / ARCHIVED | the lane: `tasks.status` is a backlog lane key or a board lane key; ARCHIVED → `tasks.archived = true` |
| `status` INACTIVE / ACTIVE / COMPLETE | `tasks.status` (free-form lane key) + the derived `tasks.swimlane_id`; COMPLETE = a lane with `swimlanes.is_terminal` |
| `businessValue` | `tasks.business_value` (+ `business_value_rationale`, `business_value_source`) |
| `effort`, `estimatedHours`, `complexity` | `tasks.story_points` (current) + `task_effort_estimates` (history: `task_id`, unit points / hours / days / tshirt, `estimator_kind` user / agent) |
| `risk` | per-ticket readiness in `ticket_audits`; team risk registers in kernel `question_sets` (PRD 20 map) |
| `acceptanceCriteria`, `technicalNotes`, `designNotes`, `suggestedApproach`, `userType` / `want` / `so` | the ticket's PRD: `specs` (`prd`, `arch_spec`, `task_list`), linked 1..N through `task_specs` (one primary), plus `tasks.description` |
| `dependencies` | `task_dependencies` (predecessor → successor edges, kept acyclic) |
| `mvpPhase`, `revenueImpact` (MVP scaffolding) | `mvp_scenarios` + `roadmap_items.horizon` |
| `position` | `tasks.manager_rank` (backlog order) |
| `columnId`, `boardId` | `tasks.swimlane_id` (derived by trigger from `status`) → `swimlanes.board_id` → `boards` |
| `sprintId`, `deliveryId` | `tasks.sprint_id` → `sprints` (a spec `Delivery` is a project-scoped sprint) |
| `dueDate`, `workStartedAt`, `workCompletedAt` | `tasks.due_date`, `tasks.start_date`, `tasks.completed_at` |
| `cycleTime`, `leadTime` | derived from `task_status_transitions` and never stored (PRD 20: derived numbers are not columns) |
| `revenueValue`, `customerKPIValue`, `burnRateImpact`, `runwayCost`, `priorityScore` | `business_value_configs` (the team's value model) + `feature_roi` + `tasks.manager_rank` |
| `estimatedCost`, `actualCost` | `task_effort_estimates` × rates → `cost_calculations`; the sprint roll-up is `sprint_financial_impact`; `tasks.cost_class` (capex / opex) |
| impact tracking (`impactCategory` … `impactNotes`) | `feature_roi` (+ `roi_timeline_entries`) |
| feature flags (`isFeatureFlag` … `targetUserSegments`) | `feature_flags` |
| experiments (`isExperiment` … `experimentEndDate`) | `experiments`, `ab_tests` (+ `ab_test_variants`, `ab_test_segments`) |
| release planning (`targetReleaseId`, `releaseVersion`, `releaseDate`, `releasedAt`, `releaseNotes`) | `tasks.release_id` → `product_releases` (`version`, `target_date`, `release_date`, `released_at`, `notes`); published notes are `release_notes` / `changelog_entries` |
| product analytics (`featureAdoptionRate` … `lastUsageTrackedAt`) | `feature_roi.usage` + `metric_facts` |
| `linkedObjectiveId`, `linkedKeyResultId`, `goalContribution` | `objective_links` (`link_kind` task / epic, `task_id`) → `objectives` / `key_results`. Local rows, not external ids. |
| `agentRunId` | `executions.task_id` (every run of the ticket) |
| `repoRef` | `tasks.explicit_repo_id` → `project_repositories`; multi-repo tickets use `task_repo_bindings` |
| `generatedBranch`, `generatedPrUrl` | `tasks.git_branch`, `tasks.github_pr_url` / `github_pr_number`; PR lifecycle in `pull_requests` |
| `teamId` | the project's team (`team_projects`) |
| `movedToKanbanAt`, `archivedAt` | the first move out of backlog in `task_status_transitions`; `tasks.archived` |

### 4.3 `ItemActivity` → the lifecycle ledger

`task_status_transitions` (`from_status`, `to_status`, `actor_kind` user / agent / system,
`actor_ref`) is the per-ticket lane history. Kernel `activity_log` carries field edits through
`recordActivity`. `actor_kind` is decisive: an agent's edit is `actor_kind = 'agent'`, which is
the spec's `actorKind = AGENT`.

---

## 5. Product Management entities → platform owners

| Spec model | Platform owner | Notes |
|---|---|---|
| `ProductIdea` | `product_ideas` (Investor domain, serial) | Promotion to a ticket is `product_ideas.promoted_task_id` → `tasks.id` (1160). Discovery material lives on the idea's canvas session (`creation_sessions`) — PRD 20 §2.1: an idea is its conversation plus its files. |
| `MarketAnalysis`, `CompetitiveAnalysis` | folded into siblings (PRD 20 map): evidence is `research_notes` (discovery), competitors are `ai_competitors` | |
| `CustomerInsight` | `customer_feedback` (ingested voice of customer, 0071), `customer_interviews` + `research_notes` (discovery) | the spec's `externalRef` is `customer_feedback.external_ref` |
| `MVPScenario` | `mvp_scenarios` | `/api/product/mvp` |
| `ValidationResult` | `validation_results` | `/api/product/validation` |
| `ValidationDataImport`, `ValidationDashboard` | `validation_data_imports`, `validation_dashboards` | |
| `ValidationAIInsight` | kernel `metric_facts` | derived |
| `ValidationScenario` | `break_even_scenarios` (the `scenario` root, PRD 20 §3.3) | |
| `BusinessValueConfig` | `business_value_configs` | `/api/product/business-value` |
| `FeatureROI`, `ROITimelineEntry` | `feature_roi`, `roi_timeline_entries` | `/api/product/feature-roi` |
| `ABTest`, `ABTestVariant`, `ABTestSegment` | `ab_tests`, `ab_test_variants`, `ab_test_segments` (Growth) | |
| RICE feature scoring | `feature_scores` | `/api/agile/feature-scoring` |
| Roadmap | `roadmap_items` (project- or segment-scoped) | `/api/product/roadmap`; `status → shipped` emits `roadmap.published` |
| Release planning | `product_releases` | `/api/releases`, `/api/product/release-planning`. BurnRateOS `release_plans` was folded here by 1160. |
| PRD / spec documents | `specs` (+ `spec_versions`, `spec_audit_records`, `task_specs`) | `/api/specs` |
| OKRs, initiatives, portfolios | `objectives`, `key_results`, `objective_links`, `initiatives`, `portfolios` | `/api/pmo`. An OKR is never an Epic (`work_items.convert_type` promotes one to the other). |

---

## 6. Agile Survival entities → platform owners

| Spec model | Platform owner | Notes |
|---|---|---|
| `KanbanBoard` | `boards` (one per project) | BurnRateOS `kanban_boards` merged here. A board budget (`estimatedBudget`, `actualCost`) is `sprint_financial_impact` / Finance `budgets`, not board columns. |
| `KanbanColumn` | `swimlanes` (`key`, `name`, `position`, `is_terminal`, `is_parking`, `gate`) | **1160 folded `kanban_columns` in and dropped it.** The column's `wipLimit` and `color` became `swimlanes.wip_limit` / `swimlanes.color_token`; `auto_run_enabled` is the lane `gate` (`auto` / `human`). |
| `Sprint` | `sprints` (uuid, optional `project_id`) | `/api/agile/sprints`; `status → completed` emits `sprint.completed` |
| `Delivery` | `sprints` with `project_id` set | a board-scoped cadence is a project-scoped sprint, not a second table |
| `PlanningPokerSession`, `Story`, `Vote` | `poker_sessions`, `poker_stories`, `poker_votes` | `/api/agile/poker`. A story's final estimate lands on the ticket as `story_points` / a `task_effort_estimates` row. |
| `PlanningPokerSessionParticipant`, `RetrospectiveParticipant` | `ceremony_participants` / kernel `memberships` | |
| `SessionDiscussion`, `CardDeck` | `session_discussions`, `card_decks` | |
| `Retrospective`, `RetrospectiveItem` | `retrospectives`, `retro_items` | `/api/agile/retros` |
| `ActionItem` | `action_items` | Promotion is `action_items.promoted_task_id` → `tasks.id` (1160); `/api/delivery-flow/action-items` |
| `TeamVelocity`, `VelocityHistory` | `team_velocity` + velocity derived from `tasks.story_points` (`/api/agile/velocity/derived`) | |
| `SprintForecast` | derived (`computeVelocityInsights`), not stored | |
| `CapacityPlanning` | `capacity_planning` | `/api/agile/capacity` |
| `TeamCapacity` | `member_profiles` (WIP caps) + `user_availability` + `capacity_heatmaps` | |
| `RiskAssessment` | kernel `question_sets` (PRD 20 map) | |
| `BottleneckAnalysis` | `bottleneck_analysis` (`project_id` since 1160) | |
| `CapacityHeatmap` | `capacity_heatmaps` | |
| `TaskEffortEstimate` | `task_effort_estimates` (`task_id` since 1160) | a 1:N history rather than the spec's 1:1; `/api/delivery-flow/estimates` |
| `CostCalculation` | `cost_calculations` (Finance) | `/api/agile/cost` |
| `SprintFinancialImpact` | `sprint_financial_impact` (`sprint_id` since 1160; the project is the sprint's own) | `/api/delivery-flow/sprints/:sprintId/cost` |
| `RunwayForecastLink` | no table: burn / runway is read from local `metric_facts` (PRD 19 B1) | |

---

## 7. Agentic software-development entities → platform owners

The spec's agentic layer duplicated the existing stack. It maps onto `executions` / `workflows` /
`source_control_integrations`, all of which already carry `segment_id` (0056). The full PRD is
doc 04.

| Spec model | Platform owner | Notes |
|---|---|---|
| `Repo` | `source_control_integrations` (provider connection, serial) + `project_repositories` (project ↔ repo, uuid) + `task_repo_bindings` (ticket ↔ repos) | Secrets never sit on the row: `integration_credentials` / kernel `credentials`. |
| `AgentRun` | `executions` (serial, `task_id NOT NULL`, `segment_id`, `status` pending / submitted / running / paused / completed / failed / cancelled) | The run's *kind* is not a column: it is the dispatching lane role and agent (`submitted_by`, `cloud_agent_ref`). |
| `AgentRunStep` | `execution_messages` + `tool_runs` / `tool_audit_events` + `telemetry_spans` | |
| `AgentOrchestration` | `workflows` + `workflow_tasks` (uuid, `segment_id`, `spec_id`) | Policy is the board's `max_concurrent_tickets`, the lane `gate`s, `execution_limits` and the autonomy circuit breaker. |
| `CodeReviewFinding` | `task_reviews` (append-only Validator verdicts) + `qa_findings` (`task_id`) + `vulnerability_findings` | A failed review mints a `gap` ticket. |
| token accounting (`useCase`, `tokenUsage`) | `llm_usage_log` (per call, per tenant / segment) | |

---

## 8. AI use cases (extend the gateway registry)

BuilderForce reuses the existing `AI_USE_CASES` registry pattern (one map edit per use case).
Port the PM/Agile ones and add the agentic ones:

| Use case key | Purpose | tools | notes |
|--------------|---------|-------|-------|
| `pm.discovery.research` | market/competitor/customer research for an idea | yes | was `tool.market_research` |
| `pm.mvp.generate` | MVP scenario generation + break-even | no | |
| `pm.roadmap.generate` | runway-aware roadmap sequencing | no | |
| `pm.validation.analyze` | analyze validation results + evidence | no | was `tool.feature_score`/custom |
| `pm.feature_score` | RICE / feature scoring | yes | was `tool.feature_score` |
| `pm.feature_roi.analyze` | portfolio ROI + risk recommendations | no | |
| `agile.retro.summarize` | retro → action items | no | |
| `agile.estimate.assist` | poker estimate suggestion from history | no | |
| `agile.forecast` | sprint completion forecast narrative | no | |
| **`dev.triage`** **[NEW]** | classify/triage an item, propose plan | yes | |
| **`dev.estimate`** **[NEW]** | code-aware effort estimate | yes | reads repo |
| **`dev.implement`** **[NEW]** | turn a work item into a branch + PR | yes | longest-running |
| **`dev.review`** **[NEW]** | review a diff/PR → findings | yes | |
| **`dev.refactor`** **[NEW]** | targeted refactor from a retro/finding | yes | |
| **`dev.test`** **[NEW]** | generate/run tests | yes | |

All dispatch through `callAiAndCharge({ useCase, viewer, … })`, credit-metered, vendor-hidden —
identical to the BurnRateOS AI facade (see doc 05 §6). The `viewer`/credit ledger is **per
Segment**.

---

## 9. Entity-relationship summary (platform tables)

```
tenants 1──* segments ;  every business row carries tenant_id (integer) + segment_id (uuid)

projects 1──1 boards 1──* swimlanes
projects 1──* tasks ──parent_task_id──► tasks          (epic → task → task; task_type is the kind)
tasks ──swimlane_id──► swimlanes                         (derived from tasks.status)
tasks ──sprint_id──► sprints ;  tasks ──release_id──► product_releases ;  tasks ──initiative_id──► initiatives
tasks *──* specs (task_specs) ;  tasks 1──* task_dependencies ;  tasks 1──* task_status_transitions
tasks 1──* task_effort_estimates | task_time_entries      (task_id, since 1160)
objectives 1──* key_results ;  objectives 1──* objective_links ──task_id──► tasks
action_items ──promoted_task_id──► tasks ;  product_ideas ──promoted_task_id──► tasks
sprints 1──1 sprint_financial_impact                      (sprint_id, since 1160)
poker_sessions 1──* poker_stories 1──* poker_votes ;  retrospectives 1──* retro_items

tasks 1──* executions 1──* execution_messages ;  workflows 1──* workflow_tasks
source_control_integrations ◄── projects 1──* project_repositories ;  tasks *──* project_repositories (task_repo_bindings)
tasks 1──* task_reviews | qa_findings
```
