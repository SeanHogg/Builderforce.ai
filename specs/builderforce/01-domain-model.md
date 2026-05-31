# 01 — BuilderForce Domain Model & Tenancy

This is the canonical data model for BuilderForce. It is expressed in Prisma-style pseudo-schema
(the agentic builder may target Prisma/Postgres, Drizzle, or another ORM — the shapes are what
matter). Every model that moved from BurnRateOS preserves the **full field union** of its source
(per the "consolidate without losing functionality" rule). New agentic models are marked
**[NEW]**.

---

## 1. Conventions

- IDs are `uuid` (preserve source UUIDs on migration so cross-references survive).
- `Json` = jsonb. `Decimal(p,s)` preserved from source for money/percentages.
- Every business entity carries **`tenantId` + `segmentId`** (see §3). The composite index
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

## 4. Product & Agile core

### 4.1 `WorkItem` — the shared spine (PM backlog ⇄ Agile kanban)

The single most important model. One row is a backlog item *or* a kanban card depending on
`stage`. **Full field union preserved from `work_items`.**

```prisma
model WorkItem {
  id          String   @id @default(uuid())
  tenantId    String
  segmentId   String

  // Core
  title       String
  description String?
  type        ItemType
  priority    ItemPriority
  assigneeId  String?
  reporterId  String?
  parentId    String?               // self-join: Epic→Story→Task
  tags        Json
  origin      String?  @default("MANUAL") // MANUAL|ONBOARDING|AI_GENERATED|MVP_SCAFFOLDING|AGENT  ([NEW] AGENT)

  // Lifecycle
  stage   WorkItemStage @default(STRATEGIC_BACKLOG) // STRATEGIC_BACKLOG | KANBAN_BOARD | ARCHIVED
  status  ItemStatus?                               // only when stage = KANBAN_BOARD

  // Strategic backlog (PM)
  businessValue      Int?
  effort             Int?
  risk               RiskLevel?
  acceptanceCriteria Json
  dependencies       Json            // item IDs this depends on

  // MVP scaffolding (origin = MVP_SCAFFOLDING)
  mvpPhase          String?          // MVP_1|MVP_2|POST_MVP
  revenueImpact     String?          // DIRECT|INDIRECT|RETENTION|ACQUISITION
  complexity        String?          // XS|S|M|L|XL
  suggestedApproach String?
  technicalNotes    String?
  designNotes       String?
  userType          String?          // "As a [userType]"
  want              String?          // "I want [want]"
  so                String?          // "So that [so]"

  // Kanban (stage = KANBAN_BOARD)
  position        Int?
  columnId        String?
  boardId         String?
  sprintId        String?
  deliveryId      String?
  dueDate         DateTime?
  estimatedHours  Int?
  workStartedAt   DateTime?
  workCompletedAt DateTime?
  cycleTime       Int?               // hours
  leadTime        Int?               // hours

  // Value tracking
  revenueValue     Float?
  customerKPIValue Float?
  burnRateImpact   Float?            // +increases / -reduces monthly burn
  runwayCost       Float?
  priorityScore    Float?

  // Cost (budget-to-actuals)
  estimatedCost Decimal? @db.Decimal(18,2)
  actualCost    Decimal? @db.Decimal(18,2)

  // Impact tracking (mirrors BusinessValueConfig)
  impactCategory            String?  // REVENUE_GENERATION|COST_REDUCTION|CUSTOMER_ACQUISITION|CUSTOMER_RETENTION|CUSTOMER_SATISFACTION|EFFICIENCY
  expectedRevenueImpact     Decimal? @db.Decimal(18,2)
  actualRevenueImpact       Decimal? @db.Decimal(18,2)
  expectedCustomerImpact    Int?
  actualCustomerImpact      Int?
  customerSatisfactionDelta Decimal? @db.Decimal(5,2)
  retentionImpact           Decimal? @db.Decimal(5,2)
  acquisitionImpact         Int?
  churnReductionImpact      Decimal? @db.Decimal(5,2)
  timeToValue               Int?
  impactConfidence          ImpactConfidence?
  impactMeasurementPlan     String?
  impactBaseline            Json?
  impactActuals             Json?
  impactNotes               String?

  // Feature flags & experiments
  isFeatureFlag        Boolean @default(false)
  featureFlagKey       String?
  featureFlagStatus    FeatureFlagStatus?
  rolloutPercentage    Int?
  targetUserSegments   Json
  isExperiment         Boolean @default(false)
  experimentHypothesis String?
  experimentVariants   Json?
  experimentMetrics    Json?
  experimentResults    Json?
  experimentStatus     ExperimentStatus?
  experimentStartDate  DateTime?
  experimentEndDate    DateTime?

  // Release planning
  targetReleaseId String?
  releaseVersion  String?
  releaseDate     DateTime?
  releasedAt      DateTime?
  releaseNotes    String?

  // Product analytics
  featureAdoptionRate Decimal? @db.Decimal(5,2)
  featureUsageCount   Int?
  activeUsers         Int?
  lastUsageTrackedAt  DateTime?

  // OKR linkage (linked objective lives in BurnRateOS Operational Cadence — store id only)
  linkedObjectiveId String?
  linkedKeyResultId String?
  goalContribution  String?

  // [NEW] Agentic linkage
  agentRunId      String?            // last/active AgentRun that worked this item
  repoRef         Json?              // { repoId, defaultBranch } target repo for dev agents
  generatedBranch String?            // branch an agent created
  generatedPrUrl  String?            // PR an agent opened

  teamId          String?
  movedToKanbanAt DateTime?
  archivedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([tenantId, segmentId, stage])
  @@index([tenantId, segmentId, boardId, columnId])
  @@index([tenantId, segmentId, sprintId])
  @@index([tenantId, segmentId, targetReleaseId])
  @@index([tenantId, segmentId, impactCategory])
  @@map("work_items")
}

enum WorkItemStage    { STRATEGIC_BACKLOG KANBAN_BOARD ARCHIVED }
enum ItemType         { EPIC STORY TASK BUG SPIKE CHORE }   // confirm against source ItemType
enum ItemPriority     { LOW MEDIUM HIGH CRITICAL }
enum ItemStatus       { INACTIVE ACTIVE COMPLETE DONE }      // from source
enum RiskLevel        { LOW MEDIUM HIGH }
enum ImpactConfidence { LOW MEDIUM HIGH }
enum FeatureFlagStatus{ DISABLED ENABLED PERCENTAGE_ROLLOUT USER_TARGETING }
enum ExperimentStatus { DRAFT RUNNING COMPLETED CANCELLED }

model ItemActivity {              // change log per work item
  id         String   @id @default(uuid())
  tenantId   String
  segmentId  String
  workItemId String
  actorId    String?              // userId or agentRunId
  actorKind  String   @default("USER")  // USER | AGENT | SYSTEM
  field      String
  fromValue  Json?
  toValue    Json?
  createdAt  DateTime @default(now())
  @@index([tenantId, segmentId, workItemId, createdAt])
}
```

---

## 5. Product Management entities

```prisma
model ProductIdea {
  id               String   @id @default(uuid())
  tenantId         String
  segmentId        String
  name             String
  description      String
  problemStatement String
  targetMarket     String?
  status           ProductIdeaStatus @default(DISCOVERY)  // DISCOVERY|VALIDATION|BUILDING|LAUNCHED|ARCHIVED
  createdBy        String
  // Discovery JSON blobs (preserve all)
  businessDetails      Json?
  documentSources      Json?
  gapAnalysis          Json?
  investmentCategories Json?
  valueHierarchy       Json?
  roadmap              Json?            // AI Roadmap output lives here
  aiInsights           Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([tenantId, segmentId, status])
}

model MarketAnalysis {
  id String @id @default(uuid())
  tenantId String; segmentId String; productIdeaId String
  marketSize Json                       // { tam, sam, som }
  growthRate Float?
  trends Json; opportunities Json; threats Json
  aiInsights Json?; sources Json?
  @@index([tenantId, segmentId, productIdeaId])
}

model CompetitiveAnalysis {
  id String @id @default(uuid())
  tenantId String; segmentId String; productIdeaId String
  competitorName String; competitorUrl String?
  strengths Json; weaknesses Json; pricing Json?; features Json?
  marketPosition String?; aiInsights Json?
  @@index([tenantId, segmentId, productIdeaId])
}

model CustomerInsight {
  id String @id @default(uuid())
  tenantId String; segmentId String; productIdeaId String
  insightType CustomerInsightType       // PAIN_POINT|NEED|BEHAVIOR|FEEDBACK|INTERVIEW|SURVEY
  source String; content String
  painPoints Json?; needs Json?; willingnessToPay Float?; segment String?
  aiSummary Json?
  // [NEW] provenance when ingested from BurnRateOS CRM feedback widget
  externalRef Json?                      // { source:"burnrateos.feedback", widgetId, eventId }
  @@index([tenantId, segmentId, productIdeaId])
  @@index([tenantId, segmentId, insightType])
}

model MVPScenario {
  id String @id @default(uuid())
  tenantId String; segmentId String
  createdBy String; productIdeaId String?
  name String; description String?
  pricingModel String                    // SAAS|FREEMIUM|SUBSCRIPTION_TIERS|TRANSACTIONAL
  targetRevenue Float; timelineConstraint Int; budgetConstraint Float; teamSize Int
  startDate DateTime?; endDate DateTime?
  pricingConfig Json
  aiInsights Json?
  status MVPScenarioStatus @default(DRAFT) // DRAFT|ANALYZING|READY|APPROVED|IN_PROGRESS|COMPLETED
  @@index([tenantId, segmentId, status])
  @@index([tenantId, segmentId, productIdeaId])
}

// Validation Lab — result + its imports, AI insights, dashboards, scenarios
model ValidationResult {
  id String @id @default(uuid())
  tenantId String; segmentId String
  productIdeaId String; mvpScenarioId String?
  validationType ValidationType          // PROBLEM|SOLUTION|MARKET|PRICING|CHANNEL
  hypothesis String; method String; methods Json?
  result ValidationOutcome @default(IN_PROGRESS) // VALIDATED|INVALIDATED|INCONCLUSIVE|IN_PROGRESS
  metrics Json; learnings String?; nextSteps String?
  hypothesisVariables Json; resultVariables Json
  engagementId String?                   // feedback widget / cohort ref (external → BurnRateOS)
  engagementType String?                 // FEEDBACK_WIDGET | CUSTOMER_COHORT
  @@index([tenantId, segmentId, productIdeaId])
  @@index([tenantId, segmentId, validationType])
}
model ValidationDataImport { id String @id @default(uuid()) tenantId String segmentId String validationResultId String data String dataType String @default("text") summary String? }
model ValidationAIInsight  { id String @id @default(uuid()) tenantId String segmentId String validationResultId String dataImportId String? insights Json recommendations Json? risks Json? nextSteps Json? summary String }
model ValidationDashboard  { id String @id @default(uuid()) tenantId String segmentId String validationResultId String keyMetrics Json insights Json? recommendations Json? improvements Json? changes Json? summary String }
model ValidationScenario   { id String @id @default(uuid()) tenantId String segmentId String validationResultId String name String description String? assumptions Json? metrics Json? results Json? status String @default("DRAFT") }

// Custom Business-Value Models
model BusinessValueConfig {
  id String @id @default(uuid())
  tenantId String; segmentId String; teamId String
  valueType BusinessValueType            // REVENUE|CUSTOMER_KPI|BOTH
  displayMode ValueDisplayMode           // REVENUE|CUSTOMER_KPI|COMBINED
  revenueSettings Json?; customerKPISettings Json?
  rewardMultiplier Float @default(1.0)
  isActive Boolean @default(true)
  @@index([tenantId, segmentId, teamId])
  @@index([tenantId, segmentId, isActive])
}

// Feature ROI Portfolio
model FeatureROI {
  id String @id @default(uuid())
  tenantId String; segmentId String
  featureId String; featureName String; featureType FeatureType // FEATURE|PAGE|COMPONENT|FLOW|INTEGRATION
  development Json; maintenance Json; revenue Json; costSavings Json; usage Json; customer Json; calculated Json
  status ROIStatus                       // TRACKING|COMPLETED|ARCHIVED
  category String; tags Json?; notes String @default(""); createdBy String
  @@index([tenantId, segmentId, featureId])
  @@index([tenantId, segmentId, status])
}
model ROITimelineEntry { id String @id @default(uuid()) tenantId String segmentId String featureROIId String date DateTime metrics Json events Json }

// A/B Testing
model ABTest {
  id String @id @default(uuid())
  tenantId String; segmentId String
  name String; description String?
  status ABTestStatus @default(DRAFT); type ABTestType
  objective String?; hypothesis String; successMetrics Json
  trafficAllocation Int; startDate DateTime; endDate DateTime?
  confidenceLevel Float? @default(95.0); minimumSampleSize Int?; currentSampleSize Int? @default(0)
  statisticalSignificance Float?; winner String?; results Json?; insights Json?; recommendations Json?
  @@index([tenantId, segmentId, status])
}
model ABTestVariant { id String @id @default(uuid()) tenantId String segmentId String abTestId String name String isControl Boolean @default(false) config Json metrics Json? }
model ABTestSegment { id String @id @default(uuid()) tenantId String segmentId String abTestId String name String rules Json }
```

---

## 6. Agile Survival entities

```prisma
// Planning Poker (realtime)
model PlanningPokerSession {
  id String @id @default(uuid())
  tenantId String; segmentId String; teamId String?
  creatorId String; facilitatorId String
  name String; description String?
  votingSystem String @default("fibonacci")
  status SessionStatus @default(DRAFT)   // DRAFT|ACTIVE|PAUSED|COMPLETED|ARCHIVED
  timerOption TimerOption @default(NONE)
  settings Json
  timerStart DateTime?; timerEnd DateTime?; startedAt DateTime?; completedAt DateTime?
  @@index([tenantId, segmentId, status])
}
model PlanningPokerSessionParticipant { id String @id @default(uuid()) tenantId String segmentId String sessionId String userId String role ParticipantRole isOnline Boolean @default(false) joinedAt DateTime @default(now()) @@unique([sessionId, userId]) }
model Story {
  id String @id @default(uuid())
  tenantId String; segmentId String; sessionId String
  title String; description String?; acceptanceCriteria String?
  externalId String?; externalUrl String?           // can point at a WorkItem
  status StoryStatus @default(PENDING)               // PENDING|VOTING|REVEALED|ESTIMATED|SKIPPED
  finalEstimate Float?; order Int
  revenueImpact Float?; runwayExtensionDays Int?; costEstimate Float?; estimatedROI Float?
  @@index([tenantId, segmentId, sessionId])
}
model Vote { id String @id @default(uuid()) tenantId String segmentId String storyId String userId String value String isRevealed Boolean @default(false) @@unique([storyId, userId]) }
model SessionDiscussion { id String @id @default(uuid()) tenantId String segmentId String sessionId String storyId String? userId String message String messageType SessionDiscussionType isResolved Boolean @default(false) resolvedBy String? resolvedAt DateTime? }
model CardDeck { id String @id @default(uuid()) tenantId String segmentId String? teamId String? name String description String? cards Json isDefault Boolean @default(false) isCustom Boolean @default(true) }

// Retrospectives
model Retrospective {
  id String @id @default(uuid())
  tenantId String; segmentId String; teamId String?
  creatorId String
  name String; description String?
  status RetrospectiveStatus @default(DRAFT)         // DRAFT|ACTIVE|COMPLETED
  template RetrospectiveTemplate @default(MAD_SAD_GLAD) // MAD_SAD_GLAD|FOUR_LS|START_STOP_CONTINUE|WHAT_WENT_WELL|CUSTOM
  settings Json
  @@index([tenantId, segmentId, status])
}
model RetrospectiveParticipant { id String @id @default(uuid()) tenantId String segmentId String retrospectiveId String userId String role ParticipantRole isOnline Boolean @default(false) @@unique([retrospectiveId, userId]) }
model RetrospectiveItem { id String @id @default(uuid()) tenantId String segmentId String retrospectiveId String category String content String authorId String votes Int @default(0) }

// Unified Action Items (from retros, meetings, syncs, milestones, agents)
model ActionItem {
  id String @id @default(uuid())
  tenantId String; segmentId String; teamId String?
  title String; description String?
  status ActionItemStatus @default(TO_DO)            // TO_DO|PENDING|IN_PROGRESS|ON_HOLD_BLOCKED|COMPLETED|OVERDUE
  priority ActionItemPriority @default(MEDIUM)        // LOW|MEDIUM|HIGH|CRITICAL
  assigneeId String?; assigneeName String?; dueDate DateTime?; completedAt DateTime?
  createdBy String
  sourceType String                                   // RETROSPECTIVE|MEETING|SYNC|MILESTONE|MANUAL|AGENT  ([NEW] AGENT)
  retrospectiveId String?
  // Cross-domain link: when converted to a backlog item, points at a WorkItem
  linkedEntityType String?                            // WORK_ITEM|GOAL|INITIATIVE
  linkedEntityId String?
  linkedRetroIds Json?
  @@index([tenantId, segmentId, status])
}

// Kanban
model KanbanBoard {
  id String @id @default(uuid())
  tenantId String; segmentId String; teamId String?
  title String; description String?
  agileProcessType AgileProcessType @default(KANBAN)  // KANBAN|SCRUM
  isActive Boolean @default(true)
  startDate DateTime?; endDate DateTime?
  mvpScenarioId String?                               // budget-to-actuals link to MVPScenario
  estimatedBudget Float?; actualCost Float?
  @@index([tenantId, segmentId, isActive])
}
model KanbanColumn { id String @id @default(uuid()) tenantId String segmentId String boardId String teamId String? title String description String? position Int status ItemStatus color String? wipLimit Int? }

// Sprints, deliveries, forecasting, velocity
model Sprint {
  id String @id @default(uuid())
  tenantId String; segmentId String; teamId String
  name String; goal String?
  startDate DateTime; endDate DateTime; capacity Int
  status SprintStatus @default(PLANNING)              // PLANNING|ACTIVE|COMPLETED|ARCHIVED
  runwayBudget Float?; actualBurn Float?; projectedBurn Float?
  @@index([tenantId, segmentId, status])
}
model Delivery { id String @id @default(uuid()) tenantId String segmentId String boardId String name String goal String? startDate DateTime endDate DateTime capacity Int status SprintStatus @default(PLANNING) }
model TeamVelocity { id String @id @default(uuid()) tenantId String segmentId String teamId String sprintId String? period String periodStart DateTime periodEnd DateTime completedPoints Int committedPoints Int velocityScore Float rollingAverage Float? trend String confidence Float @default(0.8) @@index([tenantId, segmentId, teamId, periodStart]) }
model SprintForecast { id String @id @default(uuid()) tenantId String segmentId String sprintId String teamId String forecastedCompletion DateTime confidenceInterval Json predictedVelocity Float riskFactors Json assumptions Json }
model VelocityHistory { id String @id @default(uuid()) tenantId String segmentId String teamId String recordedAt DateTime velocity Float sprintId String? metadata Json? }

// Capacity & risk
model CapacityPlanning { id String @id @default(uuid()) tenantId String segmentId String teamId String sprintId String? planningPeriod String totalCapacity Float allocatedCapacity Float availableCapacity Float utilizationRate Float teamSize Int averageVelocity Float }
model TeamCapacity { id String @id @default(uuid()) tenantId String segmentId String teamId String userId String role String skillSet Json availableHours Float allocatedHours Float utilizationRate Float costPerHour Float effectiveFrom DateTime effectiveTo DateTime? }
model RiskAssessment { id String @id @default(uuid()) tenantId String segmentId String teamId String sprintId String? riskType String severity String probability Float impact Float riskScore Float description String mitigation String? status String identifiedBy String identifiedAt DateTime @default(now()) resolvedAt DateTime? }
model BottleneckAnalysis { id String @id @default(uuid()) tenantId String segmentId String teamId String bottleneckType String resourceId String? severity String impactedItems Json throughputImpact Float? description String recommendations Json status String identifiedAt DateTime @default(now()) resolvedAt DateTime? }
model CapacityHeatmap { id String @id @default(uuid()) tenantId String segmentId String teamId String periodStart DateTime periodEnd DateTime heatmapData Json aggregations Json bottlenecks Json recommendations Json }

// Cost / runway integration (financial seam to BurnRateOS BI)
model TaskEffortEstimate { id String @id @default(uuid()) tenantId String segmentId String workItemId String @unique estimatedHours Float actualHours Float? hourlyRate Float totalCost Float overhead Float @default(0) confidence Float @default(0.8) estimatedBy String notes String? }
model CostCalculation { id String @id @default(uuid()) tenantId String segmentId String workItemId String? sprintId String? calculationType String laborCost Float overheadCost Float toolingCost Float @default(0) infrastructureCost Float @default(0) totalCost Float runwayImpactDays Int? calculatedAt DateTime @default(now()) calculatedBy String metadata Json? }
model SprintFinancialImpact { id String @id @default(uuid()) tenantId String segmentId String sprintId String @unique plannedBudget Float actualCost Float? projectedCost Float laborCost Float overheadCost Float variance Float? runwayImpact Float runwayDaysConsumed Int? revenueImpact Float? roi Float? }
// Records the burn-rate figure pulled from BurnRateOS BI for cost-per-point.
model RunwayForecastLink { id String @id @default(uuid()) tenantId String segmentId String sourceType String sourceId String externalBurnRateMetricRef Json? impactAmount Float impactType String effectiveDate DateTime notes String? @@index([tenantId, segmentId, sourceType, sourceId]) }

enum SessionStatus { DRAFT ACTIVE PAUSED COMPLETED ARCHIVED }
enum StoryStatus { PENDING VOTING REVEALED ESTIMATED SKIPPED }
enum RetrospectiveStatus { DRAFT ACTIVE COMPLETED }
enum RetrospectiveTemplate { MAD_SAD_GLAD FOUR_LS START_STOP_CONTINUE WHAT_WENT_WELL CUSTOM }
enum ParticipantRole { FACILITATOR VOTER OBSERVER }
enum TimerOption { NONE THIRTY_SECONDS ONE_MINUTE TWO_MINUTES THREE_MINUTES FOUR_MINUTES FIVE_MINUTES }
enum SessionDiscussionType { COMMENT QUESTION CLARIFICATION DECISION }
enum SprintStatus { PLANNING ACTIVE COMPLETED ARCHIVED }
enum AgileProcessType { KANBAN SCRUM }
enum ActionItemStatus { TO_DO PENDING IN_PROGRESS ON_HOLD_BLOCKED COMPLETED OVERDUE }
enum ActionItemPriority { LOW MEDIUM HIGH CRITICAL }
```

---

## 7. [NEW] Agentic software-development entities

These power decision 2 (full autonomous dev agents). Full PRD in doc 04.

```prisma
// A connected source repository (GitHub/GitLab) for a Segment.
model Repo {
  id            String   @id @default(uuid())
  tenantId      String
  segmentId     String
  provider      RepoProvider        // GITHUB | GITLAB | BITBUCKET
  externalId    String              // provider repo id
  fullName      String              // "org/repo"
  defaultBranch String   @default("main")
  installationRef Json              // app-installation / token reference (secrets stored in vault, not here)
  languages     Json?               // detected stack
  status        RepoStatus @default(CONNECTED)
  connectedBy   String
  @@unique([tenantId, segmentId, provider, externalId])
  @@index([tenantId, segmentId, status])
}
enum RepoProvider { GITHUB GITLAB BITBUCKET }
enum RepoStatus   { CONNECTED DISCONNECTED ERROR }

// A single autonomous agent execution against a unit of work.
model AgentRun {
  id           String   @id @default(uuid())
  tenantId     String
  segmentId    String
  kind         AgentKind            // IMPLEMENT | REVIEW | REFACTOR | TEST | TRIAGE | RESEARCH | ESTIMATE
  status       AgentRunStatus @default(QUEUED) // QUEUED|RUNNING|AWAITING_REVIEW|SUCCEEDED|FAILED|CANCELLED
  // What it acts on (any one)
  workItemId   String?
  actionItemId String?
  sprintId     String?
  repoId       String?
  // Inputs / outputs
  goal         String               // natural-language objective handed to the agent
  inputContext Json                 // resolved context bundle (item, repo files, prior runs)
  plan         Json?                // agent's step plan
  branch       String?
  prUrl        String?
  diffSummary  Json?                // files changed, +/- lines
  result       Json?                // structured outcome
  // Gateway accounting (reuses api.builderforce.ai)
  useCase      String               // AI_USE_CASES key, e.g. "dev.implement"
  tokenUsage   Json?
  triggeredBy  String?              // userId or "ORCHESTRATOR" or "WEBHOOK"
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime @default(now())
  @@index([tenantId, segmentId, status])
  @@index([tenantId, segmentId, workItemId])
}
enum AgentKind { IMPLEMENT REVIEW REFACTOR TEST TRIAGE RESEARCH ESTIMATE }
enum AgentRunStatus { QUEUED RUNNING AWAITING_REVIEW SUCCEEDED FAILED CANCELLED }

// Ordered steps inside a run (for live progress + audit).
model AgentRunStep {
  id         String   @id @default(uuid())
  tenantId   String
  segmentId  String
  agentRunId String
  ordinal    Int
  tool       String              // "read_file" | "edit" | "run_tests" | "open_pr" | "llm"
  input      Json?
  output     Json?
  status     String   @default("done")
  tokenUsage Json?
  createdAt  DateTime @default(now())
  @@index([tenantId, segmentId, agentRunId, ordinal])
}

// Orchestrator: fans a sprint or epic out into many AgentRuns.
model AgentOrchestration {
  id         String   @id @default(uuid())
  tenantId   String
  segmentId  String
  scopeType  String              // SPRINT | EPIC | BACKLOG_BATCH
  scopeId    String
  status     String   @default("RUNNING")
  policy     Json                // concurrency, auto-merge rules, review gates, budget cap
  runIds     Json                // child AgentRun ids
  createdBy  String
  @@index([tenantId, segmentId, scopeType, scopeId])
}

// Code-review findings produced by REVIEW agents on a PR / branch.
model CodeReviewFinding {
  id         String   @id @default(uuid())
  tenantId   String
  segmentId  String
  agentRunId String
  repoId     String
  prUrl      String?
  filePath   String?
  line       Int?
  severity   String              // INFO|MINOR|MAJOR|BLOCKER
  category   String              // BUG|SECURITY|PERF|STYLE|TEST
  message    String
  suggestion String?
  resolved   Boolean  @default(false)
  @@index([tenantId, segmentId, agentRunId])
}
```

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

## 9. Entity-relationship summary

```
Tenant 1──* Segment 1──* { every business entity }

ProductIdea 1──* MarketAnalysis | CompetitiveAnalysis | CustomerInsight | ValidationResult | MVPScenario
MVPScenario 1──* ValidationResult ;  MVPScenario 1──* KanbanBoard (mvpScenarioId)
ValidationResult 1──* ValidationDataImport | ValidationAIInsight | ValidationDashboard | ValidationScenario

WorkItem ──parentId──► WorkItem (Epic→Story→Task)
WorkItem ──columnId──► KanbanColumn ──boardId──► KanbanBoard
WorkItem ──sprintId──► Sprint ;  WorkItem ──deliveryId──► Delivery
WorkItem 1──1 TaskEffortEstimate ;  WorkItem 1──* ItemActivity

PlanningPokerSession 1──* Story 1──* Vote ;  Session 1──* SessionDiscussion | Participant
Retrospective 1──* RetrospectiveItem | RetrospectiveParticipant | ActionItem
ActionItem ──linkedEntityId──► WorkItem (when promoted to backlog)

[NEW] AgentRun ──{workItemId|actionItemId|sprintId|repoId} ;  AgentRun 1──* AgentRunStep | CodeReviewFinding
AgentOrchestration 1──* AgentRun ;  Repo 1──* AgentRun
```
