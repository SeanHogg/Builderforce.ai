# PRD 19 — burnrateos.com → Builderforce.ai consolidation

**Status:** In progress — **NO-GO for BurnRateOS shutdown** · **Owner:** platform · **Created:** 2026-08-07 · **Audited:** 2026-08-10
**Companion to:** [PRD 18 — hired.video port](./18-prd-hired-video-port.md)
**Goal:** extract the parts of `C:\code\burnrateos.com` that move Builderforce's **IDEA → REAL**
loop forward, completing the AI C-suite without copying BurnRateOS's application or schema.
hired.video contributes the **Recruiter** and **HR** agents; BurnRateOS contributes **CEO, CFO,
CRO, CMO, CPO, CISO** perspectives and selected domain behavior they need.

## Implementation audit — 2026-08-10

This section reports the repository state, not the intended destination described by the rest of
the PRD. A table in a migration, a row in the source-to-target map, a generic CRUD endpoint, a
marketing page, and a working migrated feature are five different states. Only the last one is
sufficient evidence for shutting down BurnRateOS.

**Audit baseline:** Builderforce `6b9b31b89a4fc85ea351c16dbea5b02d4b7601b5` and BurnRateOS
`708f0d8b1b0f9d59b091e23634257159d6777766`.

### Executive verdict

**Do not redirect or terminate `burnrateos.com` yet.** Builderforce has completed most of the
*destination-model* work, but not the source-data move or most feature behavior:

- [`check-model-coverage.mjs`](../../api/scripts/check-model-coverage.mjs) passes: all **1,130**
  distinct source tables are assigned a disposition and all **362/362** keep targets have a
  Drizzle declaration. This proves design coverage, not migrated rows or behavior.
- [`check-table-adoption.mjs`](../../api/scripts/check-table-adoption.mjs) reports **258** tables
  created by migrations 0418+, **258** registered with the generic entity layer, **36**
  reached by a feature path, and **222 registry-only**. Registration by
  [`entityCatalog.ts`](../../api/src/application/domains/entityCatalog.ts) is deliberately excluded
  from feature adoption by the checker.
- Migrations 0418–0433 contain **245 `CREATE TABLE` statements and zero `INSERT ... SELECT` or
  `UPDATE` data transforms**. There is no BurnRateOS database extractor/loader, ID map, replay,
  reconciliation report, or rollback manifest in this repository.
- **Resolved 2026-08-10:** Builderforce makes no runtime HTTP pull to BurnRateOS.
  [`burnRateService.ts`](../../api/src/application/seams/burnRateService.ts) reads tenant-scoped
  `metric_facts`; [`validationEngagementsService.ts`](../../api/src/application/seams/validationEngagementsService.ts)
  reads local validation results, validation dashboards and feedback collectors. The host URL/token
  configuration routes and frontend client were removed. CI runs
  [`check-no-burnrate-runtime.mjs`](../../api/scripts/check-no-burnrate-runtime.mjs) to reject a
  restored `hostBi` setting, `/api/bi/config`, or BurnRateOS API URL in runtime source.
- The six new C-suite teammates are provisioned by
  [`provisionBuiltinAgents.ts`](../../api/src/application/agent/provisionBuiltinAgents.ts). The
  **48/48** BurnRateOS executive intents are now mapped into Creation Canvas' searchable “Choose a
  starting point” menu by
  [`PromptUseCasePicker.tsx`](../../frontend/src/components/PromptUseCasePicker.tsx), retaining each
  dotted source contract as its audit/search id. This is intentionally a Canvas mapping onto
  existing objects and actions—not 48 new MCP endpoints and not new tables. It closes menu and
  intent discoverability; it does **not** by itself close the domain-service and source-data gaps in
  B1–B8 below.
- The UI has a useful shared seat surface and generated record browser
  ([`DomainSurface`](../../frontend/src/components/kernel/DomainSurface.tsx),
  [`EntityBrowser`](../../frontend/src/components/kernel/EntityBrowser.tsx)), but it does not
  preserve the workflows, calculations, provider actions, public viewers, or guided states of the
  262 BurnRateOS pages. The `/<burnrateDomain>` and `/features/<burnrateFeature>` catch-alls are
  translated **marketing explainers**, not migrated application surfaces.

The fastest safe end-of-week outcome is therefore either (a) finish the P0 gates below and then
redirect, or (b) close new sign-ups and put BurnRateOS in read-only legacy mode while its API,
database and object storage remain available. A hard shutdown without either path loses features
and customer data access.

### Evidence by track

“Feature-reached” below uses the strict definition in
[`tableAdoption.test.ts`](../../api/src/application/kernel/tableAdoption.test.ts): a non-test,
non-registry reader or writer imports the table or queries it directly. Existing Builderforce owner
implementations can still satisfy the *merge* half of a track, but do not prove that BurnRateOS data
or behavior was moved onto them.

| Track | Destination evidence in Builderforce | Actual status and unported behavior |
|---|---|---|
| **B0 · Foundation** | Source map is complete; 0418–0433 create the consolidated targets; generic entity API and shared seat UI exist; password hashes use the same PBKDF2/SHA-256, 100k-iteration, `salt:hash` format in both products. | **Partial / cutover blocker.** No source-row ETL or reconciliation. The company invariant in §3.2 is not implemented as written: `companies.tenant_id` is mandatory, there is no `account_company_relationships` or project↔company junction, and the map flattens that source table to generic `relation`; generic relations cannot point from a tenant to a company because both ends require `objects` rows. No port of BurnRateOS account locks, login-attempt history, bot-block events, refresh sessions, or MFA-secret transformation. Existing sessions cannot survive the domain/JWT change. |
| **B1 · CFO / BI** | Migration 0424 creates 20 finance targets; kernel ledger/settings/metrics can absorb balances and series. | **Not ported: 0/20 target tables feature-reached.** Runway/burn, break-even engine, forecast assumptions/sensitivity/Monte Carlo, ARR projections, cohort retention, CAC/LTV/payback, expense classifier, company P&L, Plaid sync, TCO, custom KPI formulas, scenario dashboards and sprint financial impact have no migrated service. The remaining burn-rate seam still calls BurnRateOS. Builderforce FinOps is cloud/AI spend, not a replacement for company finance. |
| **B2 · CEO / Investor** | Migration 0422 creates 12 investor/portfolio targets; kernel artifacts/revisions/shares can represent deck content and versions. | **Not ported: 0/12 target tables feature-reached.** No pitch-deck generator/version/share-view analytics flow, investor updates and approvals, investor reports/digests, board packages, data-room ACL/download flow, due-diligence workflow, portfolio health scoring, funding-history/valuation/exit models, or investor portal migration. Generic artifact and entity forms do not enforce these workflows. |
| **B3 · CRO / CRM + VoIP** | Migration 0421 creates 20 revenue targets; existing Builderforce sales routes cover a simpler contact/pipeline; business-phone checkout and entitlement recording exist. | **Mostly not ported: 1/20 targets feature-reached (`business_phone_numbers`).** Contact provenance/edit logs, identity/source history, enrichment credits/providers, dedup/import, ICPs, sequences, conversion/quota analytics, communications ops and deal-risk logic are missing. Phone currently sells and records an entitlement; it does not implement SignalWire number search/provisioning, balance, call/SMS operations, voice agent, or port requests. Builderforce has no `SIGNALWIRE_*` configuration. |
| **B4 · CMO / Growth** | Migration 0432 creates 47 targets; the pre-existing campaign/site/mailbox engines are valid merge owners. | **Mostly not ported: 2/47 targets feature-reached (`announcement_banners`, `email_otp_challenges`), neither proves the CMO workflows.** BurnRateOS heatmap capture/screenshots/analysis, nurture step execution/enrollment, lead-form lifecycle, landing/website block editor behavior, A/B allocation, NPS, referrals/affiliate settlement, email event parity, SEO manager/rank tracking, brand kit/content calendar, waitlist/community/podcast/video flows and public widgets are missing or registry-only. Web Push is wholly absent: no VAPID code/config, marketing subscriber/campaign/delivery service, `push-fanout` queue/DLQ, or `packages/push-pwa`. |
| **B5 · CPO / Product** | Builderforce PMO, product, feedback and validation owners exist; consolidated work/items/artifacts can represent several source models. Validation engagement reads are now local. | **Partial merge only.** Feature voting/adoption, scoring, product ideas/company workflows, release plans, public roadmap/deck, validation AI insights/scenarios, MVP scaffolding, entity version/sign-off/model-lock workflows still need domain-backed behavior and migrated source rows. |
| **B6 · CTO / Agile** | Builderforce boards/tasks/sprints, poker/retro and ceremonies remain the correct owners. | **Core merge owner exists; BurnRateOS additions are not ported.** Missing cost-per-sprint/runway coupling, capacity and velocity parity, bottleneck/technical-debt/deployment rollups, cost calculation, source session/data migration, and the BurnRateOS `SessionRoom` collaboration behavior. Do not migrate duplicate Kanban/poker tables; write explicit transforms into the Builderforce owners. |
| **B7 · HR / Operational cadence** | Migration 0420 creates 22 people/HR targets; one `builtin_kind='hr'` teammate is provisioned; existing meetings/pulse owners remain. | **Not ported: 0/22 targets feature-reached.** Employee/employment/emergency contacts, headcount and hiring forecasts, goals/reviews/1:1/check-ins, weekly syncs, scorecards, ScratchPad pages/collaborators/transcripts/templates/attachments, bookings/calendar links and Slack workflows lack feature services. Booking targets in 0425 are registry-only. Recall.ai notetaker config and attachment-row/object migration are absent. |
| **B8 · CISO / Governance** | Builderforce SOC/security/uptime owners exist; migration 0428 adds two identity/governance targets. | **Partial merge only: 0/2 new targets feature-reached.** BurnRateOS vendors, DPAs, PII inventory, compliance events, security training, DSR/suppression, terms agreement history, embed consent, public DSR, and uptime-monitor source data/alert behavior are not ported. The BurnRateOS 5-minute uptime sweep and support-chat behavior are not wired into Builderforce jobs. |
| **B9 · Platform** | Migration 0425 creates 20 commerce targets; cart/order checkout integration is real; Builderforce has marketplace, billing, support, content and admin owners. | **Partial: 3/20 targets feature-reached (`carts`, `orders`, `order_line_items`).** Missing consultant onboarding/knowledge/earnings/settlement, affiliate/referral payout methods, booking settlement/webhooks, AI/enrichment-credit ledger transforms, templates/licenses, white-label agency/client data, support live-chat DO, coach marks/segments, guest claim continuity, waitlist/media/free-tools data, and system-admin parity. Cart/order support does not migrate existing BurnRateOS purchases or subscriptions. |

### C-suite Creation Canvas menu mapping — implemented 2026-08-10

The migration decision is to expose these as executive creation intents in the existing Canvas
menu. Selecting an item gives Brain a bounded prescription to create or update existing Canvas
objects from available evidence. It does not create a parallel C-suite service layer.

| Source tool family | Count | Existing Canvas destinations |
|---|---:|---|
| Agile / delivery | 5 | dashboard, chart, report, table, roadmap |
| CRM / revenue | 4 | sales pipeline, dashboard, table, chart, KPI |
| Cross-domain risk | 1 | dashboard, report |
| Finance | 5 | KPI, dashboard, table, chart, scenario comparison report |
| Governance | 5 | table, report, dashboard, roadmap |
| Investor market | 5 | target market, report, sourced comparison dataset |
| Marketing | 5 | table, dashboard, report, chart, evaluation |
| Operations / people | 5 | dashboard, roadmap, chart, spreadsheet, report |
| Product / company | 5 | product-ideas table, feature summary, report, target market, dashboard |
| Research + ScratchPad | 8 | sourced dataset, report, document pages, slides |
| **Total** | **48** | **Only existing Creation Canvas object kinds and actions** |

Implementation evidence:

- `C_SUITE_CANVAS_USE_CASES` contains **48 unique legacy ids** and is merged into the localized
  Creation Canvas starting-point catalog for every locale.
- Menu search includes the legacy dotted id, label, category and prescription, so operators can
  locate either “Runway snapshot” or `finance.runway.snapshot`.
- Prescriptions name the existing destination object and require source evidence/no invented
  values. Canonical sales requests use the existing sales workspace. Market-peer deletion requires
  an identified target rather than a broad destructive action.
- Creation Canvas exposes one read-only `canvas_read_domain` action over the existing 15-domain
  summary, entity, item and metric APIs. It lets all 48 prescriptions inspect real tenant data
  without a C-suite service catalog; writes continue through existing reviewed Canvas/canonical
  actions.
- [`PromptUseCasePicker.test.tsx`](../../frontend/src/components/PromptUseCasePicker.test.tsx)
  asserts the 48-entry/48-unique invariant and exercises dotted-id search and selection.
- Verification on 2026-08-10: focused Vitest **5/5 passed**; frontend `tsgo --noEmit` passed; no
  schema or migration file was added.

### Extraction boundary — IDEA → REAL decision (2026-08-10)

This supersedes “port every BurnRateOS page.” The source is a capability quarry, not the target
architecture. A capability is extracted only when it shortens or strengthens this loop:

| Stage | Extract from BurnRateOS | Existing Builderforce destination |
|---|---|---|
| **Idea** | scratch pad/notes, product ideas, validation evidence, market and competitor research, company/market analysis, pitch narrative | Creation Canvas documents/datasets/slides, Product Discovery, validation owners, CEO/CPO agents |
| **Make** | scenario-to-plan handoff, sprint/velocity/bottleneck/debt/deployment evidence, release readiness | Projects, tasks, sprints, ceremonies, roadmaps, Builder workspaces, Manager/CTO agents |
| **Run** | runway/forecast/break-even/ARR, pipeline/deal risk/quota, campaigns/experiments, headcount/cadence, governance/vendors/incidents | Existing finance, revenue, growth, people and governance domains rendered into Canvas |
| **Measure** | cross-domain risk, conversion, channel performance, delivery health and executive snapshots | `metric_facts`, domain summaries and Canvas dashboards/charts/reports |

Explicit non-targets:

- BurnRateOS navigation, page-for-page Mantine UI, AI hub/assistant rooms, duplicate auth/tenant
  administration, duplicate Kanban/CRM/campaign/support implementations and per-feature authoring
  containers are retired—not ported.
- A source table is **not** evidence that a target table is required. Authored/session content lands
  in Canvas/kernel primitives; derived values land in `metric_facts`; vendor state lands in the
  connector platform; duplicate business entities land in their existing domain owner.
- No new table may be introduced for this extraction unless a reviewed invariant cannot be stored
  safely in an existing owner, production source rows prove the capability is used, and a named
  workflow reads/writes it. Generic registry reachability does not meet this threshold.
- Data belonging to an extracted capability is transformed into its existing owner. Data belonging
  only to a retired capability receives a customer-readable export and retention/erasure handling;
  it does not force dead schema into Builderforce.

The C-suite catalog encodes the same decision: every family declares its IDEA/MAKE/RUN/MEASURE
stage, existing owner domains and allowed Canvas object kinds. Selecting one instructs Brain to
read those owners through `canvas_read_domain` and explicitly forbids proposing a database table.
Tests assert all 48 contracts have an extraction owner, every stage belongs to IDEA → REAL, and
every output kind already exists in the Creation Canvas contract.

### Source code still unique to BurnRateOS

These are concrete source-only implementation families, not just missing schema names. Some should
be rewritten onto a Builderforce owner rather than copied, but none can be deleted until its
behavior is either ported or explicitly retired:

- `product/api/src/worker/routes`: all **103 top-level + 6 nested** feature route modules remain the
  reference implementation for the workflows listed above. Builderforce's generic five-handler
  entity router is reachability, not a replacement for their validation, calculations, public
  grants, provider calls, approvals and side effects.
- `product/api/src/worker/ai/personaPrompts.ts` and `ai/tools/{agile,crm,cross,finance,governance,
  investor,marketing,ops,product,research,scratchpad}.ts`: all 48 user-facing intents are mapped to
  the Creation Canvas menu, but the source selectors, per-company query semantics and underlying
  domain calculations/providers remain reference behavior until B1–B8 feature services and data
  migration are complete. The approved target is the Canvas menu and existing platform actions,
  not a duplicate `builtinMcpService.ts` C-suite catalog.
- `product/api/src/worker/services/{plaid,signalwire,recall,uptime}.ts`, `services/push/*` and
  `services/payment/{stripeProvider,helcimProvider}.ts`: provider implementations and their
  idempotent workflows are absent or only partially replaced in Builderforce.
- `product/api/src/worker/durable/{NotificationRoom,SessionRoom,SupportChatRoom}.ts`: no state or
  behavior migration exists. An equivalently named real-time primitive is not proof that message,
  participant or support-session semantics match.
- `product/frontend/src/domains/*`: the Mantine pages and components still contain the only product
  UX for most B1–B9 workflows. The shared Builderforce record browser exposes rows, but does not
  port the workflow-specific presentation/application logic beneath those pages.
- `product/packages/push-pwa`: the service-worker registration/subscription package has no target
  package or Builderforce integration.

### Runtime and integration gaps

The source Worker config at `C:\code\burnrateos.com\product\api\wrangler.toml` declares three
Durable Objects, two crons, a push queue with DLQ, cache KV, and the
`burnrateos-attachments` R2 bucket. Builderforce has not adopted the BurnRateOS bindings or their
state:

| Source capability | Builderforce evidence | Status |
|---|---|---|
| `NotificationRoom`, `SessionRoom`, `SupportChatRoom` | Builderforce has its own relay/session DOs, but no state/data migration or support-chat adapter. | **Not migrated** |
| `0 3 * * *` daily churn/digest/coach batch | [`cronSweeps.ts`](../../api/src/cronSweeps.ts) has Builderforce sweeps, not the BurnRateOS batch. | **Not ported** |
| `*/5 * * * *` uptime sweep | A Builderforce 5-minute trigger exists, but it does not read the BurnRateOS monitor store or port its alert service. | **Partial owner only** |
| `push-fanout` + DLQ and `packages/push-pwa` | No VAPID/push implementation or queue binding exists in Builderforce. | **Not ported** |
| `burnrateos-attachments` R2 | Builderforce has other artifact storage, but no copy manifest, key rewrite, checksum, ACL, or legacy URL plan. | **Not migrated** |
| Plaid, SignalWire, Recall.ai, Tavily | No corresponding Builderforce env contracts or provider implementations were found. | **Not ported** |
| Stripe/Helcim commerce | Builderforce supports Stripe; BurnRateOS also supports Stripe/Helcim. No customer/subscription/order mapping or provider-webhook handoff exists. | **Cutover blocker** |
| OAuth/connectors | Both products have provider integrations, but no encrypted-credential transform or callback/refresh-token handoff exists. | **Cutover blocker; expect re-consent where secrets cannot be moved safely** |

### User and customer-data migration status

There is currently **no executable user migration**. The generic Builderforce migration wizard is
for board providers (`DISCOVERY_PROVIDER_IDS`); it is not a BurnRateOS account/database importer.
Before any redirect, implement and retain a reproducible manifest covering:

1. BurnRateOS `User` → Builderforce `users`, preserving UUID, normalized email, name, locale,
   verification time, suspension state, created time and compatible password hash. Resolve email
   collisions deterministically; never create two Builderforce identities for one email.
2. `Account`/memberships/roles/invitations → `tenants`/`tenant_members`/kernel invitations, with a
   durable source-ID↔target-ID table. Provision default project/segment exactly once per imported
   tenant and do not accidentally start trials, agents or paid usage during replay.
3. Company graph and active-company/default-company state, after the §3.2 mismatch above is
   resolved. A tenant/segment approximation is not enough for agencies, investors or shared
   companies unless the product explicitly drops those semantics.
4. Every surviving domain row using the source-to-target map, with child ordering, public tokens,
   slugs, timestamps, audit actors, money denominations and external provider references preserved.
5. Password continuity (hashes are compatible), forced new sessions, and either an MFA-secret
   decrypt/re-encrypt transform or a deliberate MFA re-enrollment campaign. Do not copy refresh or
   access tokens.
6. Billing customers/subscriptions, active plan/interval/seats, phone add-ons, credit/ledger
   balances, invoices/orders/refunds and webhook idempotency keys. Prove no user is double-billed
   and no paid user lands on Free.
7. R2 attachments/decks/screenshots, public-share URLs, embed keys, OAuth connections, email
   preferences, unsubscribe/suppression state and legal acceptances.

### End-of-week shutdown gates

All gates are mandatory for a **hard shutdown**. “Mapped in TSV,” “table exists,” and “opens in
EntityBrowser” do not satisfy them.

- [ ] **Decision gate:** settle §2 rows 4, 6 and 12 plus §5 pricing/push/provider decisions; record
  the selected owners in this PRD.
- [ ] **Tenancy gate:** implement and test the company graph/project-company contract or explicitly
  revise §3.2 and migrate every affected workflow to the replacement semantics.
- [ ] **Identity gate:** dry-run all users, collisions, memberships, roles and verified emails;
  login with an imported password; require fresh sessions; test OAuth-only and MFA users.
- [ ] **Data gate:** run idempotent ETL against a production snapshot; publish per-table source,
  transformed, inserted, merged, rejected and orphan counts plus financial totals and attachment
  checksums; rerun to prove zero duplicates.
- [ ] **Extraction gate:** every feature used by an active BurnRateOS tenant is classified by the
  IDEA → REAL boundary: an extracted capability has a tested Builderforce workflow and transformed
  data; a non-target has an explicit customer-approved retirement/export. Do not activate the
  **222 registry-only** tables merely to reduce a metric; generic CRUD and unused source DDL are not
  product requirements.
- [x] **C-suite menu gate:** map all 48 CxO intents to existing Creation Canvas objects/actions,
  retain searchable legacy ids, test uniqueness and selection, and add no tables.
- [ ] **Agent execution gate:** the generic tenant-scoped domain read is implemented; prove each
  mapped intent against migrated production data, apply Builderforce confirmation policy to its
  canonical writes, and pass persona-specific read/write integration tests. Menu presence and a
  generic read alone do not satisfy this gate.
- [ ] **Provider gate:** transfer or reauthorize Plaid, SignalWire, payments, Recall, email, Slack,
  Google/Microsoft/GitHub/LinkedIn and enrichment connections; switch webhook/callback URLs only
  after replay/idempotency tests.
- [ ] **Runtime gate:** migrate or replace R2 objects, public shares, embeds, crons, DO sessions and
  queues; preserve unsubscribe/suppression and legal evidence.
- [ ] **Billing gate:** reconcile active subscribers and balances to provider reports; test renewal,
  cancellation, refund, failed payment, annual interval, seat count and phone add-on independently.
- [ ] **Cutover gate:** freeze BurnRateOS writes, take a final incremental snapshot, replay deltas,
  compare counts/checksums, smoke-test representative tenants, then redirect web/API/public links.
- [ ] **Rollback gate:** retain the source database, R2 bucket and Worker in non-public/read-only
  form through an agreed rollback window; monitor login, 4xx/5xx, billing webhooks, missing-object
  and support rates with a named abort threshold.

### Reproducible audit commands

Run from the Builderforce repository:

```powershell
cd api
node scripts/check-model-coverage.mjs
node scripts/check-table-adoption.mjs
```

Expected at the audited baseline:

```text
1130 source tables mapped, 0 unaccounted; target schema 362/362
258 consolidation tables created; 36 feature-reached; 222 registry-only; 0 unreachable
```

The first line is the architecture milestone. The second line is the migration-status meter and
must not be collapsed into the first when reporting readiness.

> **The experience half of every track is decided by
> [PRD 21 — The Unified Experience](./21-prd-unified-experience.md), not here.** A track may land
> its schema, its migrations and its API at any time. What it may **not** do is ship a surface as a
> page: every track's UI arrives as a **panel over the mounted canvas**, and the C-suite seats this
> PRD completes appear as **teammates in the footer**, never as a navigation rail. PRD 21 §5.1 is
> the gate; its E0–E2 block frontend work on B1–B9.

> **Read §2 before scheduling any track in this PRD or in PRD 18.** The two consolidations
> collide *with each other* on at least twelve capabilities. Run independently, they will each
> add a second affiliate system, a second bookings system, a second phone product, a third
> campaign engine, a third OKR store and a third people/HR module. §2 is the register that
> prevents that; it governs **both** PRDs.

---

## 0 · This is a MERGE, not a port

PRD 18 is mostly **additive** — Builderforce has no résumé parser, no ATS, no Canvas
runtimes, so hired.video fills empty space. BurnRateOS is the opposite: it is a second
implementation of much of what Builderforce already does, aimed at a different buyer
(startup CxO rather than engineering org).

Confirmed overlaps against live Builderforce tables — every one of these is a *name-level*
collision, not a conceptual one:

| BurnRateOS model | Builderforce table | Source |
|---|---|---|
| `SocControl`, `SocEvidence` | `soc_controls`, `soc_evidence` | migration 0254 already had to rename a collision of exactly this shape ([[finops-soc-controls-collision]]) |
| `SupportTicket` | `support_tickets` | 0236 |
| `UptimeMonitor` / `UptimeCheck` | `uptime_samples` | 0236 |
| `PlanningPokerSession`, `Retrospective`, `RetrospectiveItem` | `poker_sessions`, `retrospectives`, `retro_items` | 0062 |
| `SupportArticle` | `knowledge_documents` | 0227 |
| `KanbanBoard`, `KanbanColumn`, `WorkItem`, `Sprint` | boards / swimlanes / tasks / sprints | core |
| `StrategicObjective`, `ObjectiveOutcome`, `ObjectiveMilestone` | `objectives`, `key_results`, `objective_links` | 0268 |
| `SalesPipeline`, `PipelineStage`, `Deal`, `Contact` | sales pipeline / contacts / deals | canvas + sales |
| `MarketingCampaign`, `MarketingEmail` | `campaignEngine.ts` | 0412 |
| `PulseCheck`, `PulseQuestion`, `PulseResponse` | `pulse_surveys` | 0317 |
| `Invoice`, `PaymentTransaction`, `BillingPlan`, `PlanFeature` | billing + `planFeatures.ts` | core |

So the governing rule is **one owner per capability**. Where BurnRateOS and Builderforce both
implement something, exactly one implementation survives and the other's call sites migrate to
it in the same pass ([[no-technical-debt-rule]]). A "port" that lands a second table with the
same meaning is a failure of this PRD, not a delivery against it.

### The stack conversion is real (unlike PRD 18)

| Layer | BurnRateOS | Builderforce | Cost |
|---|---|---|---|
| Runtime | Cloudflare Workers | Cloudflare Workers | **none** |
| Database | **Neon Postgres** | Neon Postgres | **none** |
| Schema / migrations | **Prisma** (`schema.prisma`, 404 models) | **Drizzle** + numbered SQL | **conversion** — 404 models → Drizzle schema + SQL migrations |
| Runtime queries | raw Neon tagged-template SQL (`SqlClient`) | Drizzle | **low** — raw SQL ports; only the typing changes |
| Cache | **Valkey/Redis** (docker) + KV | `getOrSetCached` (L1 Map + L2 KV) | **conversion** — no Redis in the target |
| Frontend | Vite SPA + **Mantine 8** + TanStack Query | Next 15 App Router + Tailwind/shadcn + next-intl | **high** — component-library swap, not just a router swap |
| Tenancy | **two-level: Account → Company → rows** | `tenant_id` + `project_id` | **decision** (§3.2) |
| LLM | already calls Builderforce via `@seanhogg/builderforce-sdk` | — | **none** — the seam exists |

The Mantine→Tailwind conversion is the single biggest line item and has no equivalent in
PRD 18: hired.video was already Tailwind/shadcn, so its leaf components moved nearly verbatim.
BurnRateOS's 262 pages and ~600 components are built on Mantine primitives (`@mantine/core`,
`form`, `dates`, `modals`, `notifications`, `tiptap`, `carousel`) and must be rebuilt against
Builderforce's component set. Budget for a rewrite of the presentation layer, a port of the
logic beneath it.

### Scale, measured

| Thing | Count |
|---|---|
| Prisma models | **404** |
| API route modules | **103** top-level + 6 nested (`auth/`, `systemAdmin/`) |
| API LOC (tests excluded) | **~97,300** |
| Frontend domains / pages | **20 domains, 262 pages** |
| Frontend LOC (tests excluded) | **~63,800** |
| Durable Objects | 3 — `NotificationRoom`, `SessionRoom`, `SupportChatRoom` |
| Cron schedules / queues | 2 (`0 3 * * *`, `*/5 * * * *`) / 1 (`push-fanout` + DLQ) |
| Workspace packages | 1 — `packages/push-pwa` |
| CxO AI tools | **48** across 11 tool modules |

**Combined incoming (PRD 18 + PRD 19):** **832 tables** (428 + 404), **328 API route modules**
(219 + 109), **471 pages** (209 + 262). Against Builderforce's own 78 surveyed routes that
makes **549 destinations** the navigation architecture has to hold — a 7× increase on what it
was designed against.

### The one free lunch

`api/src/worker/services/builderforceClient.ts` — **BurnRateOS already routes every LLM and
embedding call through the Builderforce gateway** via `@seanhogg/builderforce-sdk`, with
`useCase` + `metadata` passed for billing trace-back. That is the same strangler-fig anchor
PRD 18 has in `hiredVideo.ts`, and it means the AI substrate needs no migration at all —
only the removal of the HTTP hop once the code lives in-process.

---

## 1 · What BurnRateOS actually contributes

Strip the overlap and the net-new surface is sharp:

**The rest of the C-suite.** Builderforce has CTO, Product Manager, Product Owner, Designer,
Manager, Security, Incident Manager, Validator, Compliance Audit, PR Reconciler — and PRD 18
adds Recruiter + HR. BurnRateOS has eight CxO personas (`ai/personaPrompts.ts`) with 48
domain tools behind them. The missing seats are **CEO, CFO, CRO, CMO**; `CPO` maps to Product
Manager, `CISO` to Security, **`CHRO` to the HR agent PRD 18 introduces — they must be the
same agent, not two.**

**Startup finance.** Runway/burn, break-even scenarios, forecast scenarios + assumptions +
sensitivity + Monte Carlo, ARR projections, cohort retention, CAC/LTV/payback, expense
classification, Plaid bank sync, TCO settings, sprint financial impact. Builderforce has
FinOps for *cloud/AI spend*; it has no company P&L model. **Net-new, and the strongest single
reason to do this consolidation.**

**Investor intelligence.** Pitch decks (versions, share links, per-slide view analytics),
investor updates + approvals, data rooms, due-diligence checklists, cap-table-adjacent
funding rounds, portfolio health scoring, deal flow. Builderforce has `pitch*` Canvas objects
for *competition* pitches — a different artifact. **Net-new.**

**Growth & marketing instrumentation.** Heatmaps (pages, captures, screenshots, analysis),
landing pages + blocks, lead forms, nurture flows + enrollment, A/B tests + variants +
segments, NPS surveys, referral codes, email tracking/sends, SEO pages, brand kits, content
calendar. **Mostly net-new**; campaigns merge.

**CRM + VoIP.** Contacts with provenance/edit logs, companies, deals, quota attainment,
conversion rates, sequences/campaigns (`Ri*`), enrichment credits, dedup, plus a **business
phone product** on SignalWire (numbers, porting, balances, voice agent). Sales pipeline
merges; **VoIP is net-new — and collides with hired.video's phone product (§2).**

**Consultant marketplace + affiliate + credits.** Consultant profiles, knowledge docs,
consultations, earnings, marketplace settlement/payouts, AI credit balances/transactions/
purchases, cart + orders + line items. Marketplace merges; **the AI-credit economy is
net-new and is a better fit than the token-cap model for self-serve.**

**ScratchPad / meetings.** 13 models — pages, shares, collaborators, scheduled meetings,
attendees, transcripts, notes templates, attachments. Overlaps Builderforce meetings +
knowledge; the *transcript + notes-template* half is net-new.

**Web push.** `MarketingPushSubscriber/Campaign/Delivery`, a `push-fanout` queue, and
`packages/push-pwa`. **Builderforce deliberately DELETED web push in migration 0195**
([[push-removed-burnrateos]] — "never reintroduce VAPID"). Consolidation reverses that
decision. See §5 exception 2.

---

## 2 · Capability ownership register — governs PRD 18 AND PRD 19

For each contested capability: who owns the surviving implementation, and what the losers do.
**Decide the row before either PRD schedules the track that touches it.**

| # | Capability | Builderforce today | hired.video (PRD 18) | BurnRateOS (PRD 19) | **Owner** | Losers |
|---|---|---|---|---|---|---|
| 1 | **HR / People agent** | — | HR agent (Career 360, coaching, org review) | CHRO persona + `ops.*` tools + Employee/Goal/Review/1:1 | **ONE `builtin_kind='hr'` agent** | BurnRateOS CHRO persona becomes that agent's persona; its `ops.headcount_plan.list` / `ops.hiring_forecast.list` become `hr.headcount_plan` |
| 2 | **OKR / objectives** | `objectives`, `key_results`, `objective_links` (0268) | `people_strategic_objectives` (+outcomes, milestones) | `StrategicObjective`, `ObjectiveOutcome`, `ObjectiveMilestone` | **Builderforce 0268** | both map onto it; writes `invalidateProjectsList` ([[objectives-project-scope]]) |
| 3 | **Campaign engine** | `campaignEngine.ts` (0412) | `CampaignService` + audiences/targeting | `MarketingCampaign`, `MarketingEmail`, `NurtureFlow` | **`campaignEngine.ts`** | both merge in; nurture-flow steps extend it |
| 4 | **Affiliates / referrals** | none (0402 is sales-associate commissions) | `affiliates` (6 tables) | `AffiliatePartner/Referral/Payout/PayoutMethod`, `ReferralCode/Entry` | **pick ONE — recommend BurnRateOS** (payout methods + settlement are more complete) | the other is dropped, not ported |
| 5 | **Bookings / scheduling** | none | `bookings` (6 tables) | `Booking*` (9 models incl. external calendar link, payout, webhooks) | **BurnRateOS** (richer) | hired's is dropped |
| 6 | **Business phone / VoIP** | Twilio *connector* only | `phone` (5 tables, own provider) | SignalWire numbers, porting, balances, voice agent | **pick ONE — recommend BurnRateOS/SignalWire** (has porting + voice agent) | hired's is dropped; the Twilio connector stays for API-level calls |
| 7 | **Support tickets + KB** | `support_tickets`, `prod_incidents` (0236), `knowledge_documents` (0227) | `help` mappings | `SupportTicket/Message`, `SupportArticle`, `SupportChatRoom` DO | **Builderforce 0236 + 0227** | BurnRateOS contributes the live support-chat DO |
| 8 | **Poker / retros / ceremonies** | `poker_sessions`, `retrospectives` (0062), ceremonies | — | `PlanningPokerSession`, `Retrospective*`, `AgileEvent` | **Builderforce 0062** | BurnRateOS's are dropped |
| 9 | **Kanban / sprints / stories** | boards, swimlanes, tasks, sprints | — | `KanbanBoard/Column`, `WorkItem`, `Sprint`, `Story`, `Epic`, `Initiative`, `UserStory`, `Task`, `Subtask` | **Builderforce** | BurnRateOS's hierarchy (Product→Initiative→Epic→Story→Task→Subtask) informs the epic-decomposition gap already in the register |
| 10 | **SOC 2 controls** | `soc_controls`, `soc_evidence` | `compliance` (3) | `SocControl`, `SocEvidence`, `ComplianceEvent`, `SecurityVendor`, `PiiDataAsset`, `SecurityDpa` | **Builderforce** | BurnRateOS's vendor/DPA/PII-asset models extend it (net-new fields, same table) |
| 11 | **Uptime / monitoring** | `uptime_samples` (0236), alerts, monitoring | — | `UptimeMonitor`, `UptimeCheck` | **Builderforce** | — |
| 12 | **Blog / articles / content** | `/blog` + content-manager | `articles` (9 tables) | `BlogPost`, `MarketingContentItem`, `MarketingSeoPage` | **ONE content store** — recommend Builderforce knowledge + a `content_items` table | three-way merge; slugs preserved for SEO |
| 13 | **Surveys / pulse / NPS** | `pulse_surveys` (0317), devex surveys (0229) | — | `PulseCheck/Question/Response`, `NpsSurvey` | **Builderforce 0317** | NPS becomes a survey type |
| 14 | **Billing / plans / invoices** | plans, `planFeatures.ts`, `featureGate.ts` | `billing` (9) | `BillingPlan`, `PlanFeature`, `Invoice`, `Order`, `Cart`, `PricingVersion` | **`planFeatures.ts` + `featureGate.ts`** ([[paid-plan-feature-gate]]) | BurnRateOS's cart/order/line-item model is net-new and lands *under* the one evaluator |
| 15 | **Payouts** | env-gated stub | full ledger + tax reporting + Tremendous + Helcim | `MarketplacePayout`, `MarketplaceSellerBalance`, `AffiliatePayout` | **hired.video's** (most complete) | BurnRateOS settlement calls into it |
| 16 | **Meetings / notes** | meetings (0292), ceremonies | — | `ScratchPad*` (13), `MeetingTranscript`, `ScratchPadNotesTemplate` | **Builderforce meetings** | ScratchPad transcript + notes-template half is net-new and merges in |
| 17 | **AI credits vs token caps** | token caps + consumption meters (0218) | tier enforcement | `AiCreditBalance/Transaction/Purchase`, credit packs | **the consumption-meter framework** ([[consumption-meter-framework]]) | credits become a meter denomination, not a parallel ledger |
| 18 | **Enrichment / dedup / import** | connectors | `enrichment`, `scraping` | `EnrichmentCache/Transaction`, `TenantEnrichmentCredits`, `Dedup`, `ImportJob/Row` | **BurnRateOS** (credit-metered) | hired's enrichment merges in |
| 19 | **"Company" — three meanings, one table** | none | `companies` (8 tables — employer profiles a candidate browses, reviews) | `Company` + `CompanyDomain` + facets (`CompanyCRM`/`Billing`/`Support`/`Product`/`Marketing`) + `AccountCompanyRelationship` | **BurnRateOS's company graph** (§3.2) | hired.video's employer profiles are the SAME entity with no `OWNER` relationship to your tenant — they merge in as `kind` rows rather than becoming a third company concept. Resolves what looked like an unavoidable collision. |

Rows 4, 6 and 12 are genuine either/or calls; the rest have an obvious owner. **All of them
must be settled before the losing side's track is scheduled**, because the cost of discovering
row 6 after both phone products have shipped is two migrations and a data merge.

---

## 3 · Foundation work (B0) — blocks every BurnRateOS track

### 3.1 Prisma → Drizzle

404 models convert to Drizzle schema modules + numbered SQL migrations continuing from
PRD 18's tail. Write it as a **codemod over `schema.prisma`**, not by hand: Prisma's DSL is
regular enough to parse, and hand-conversion of 404 models will drift. Relations become
explicit FK columns + Drizzle `relations()`; `@@map`/`@map` become the SQL names so existing
data migrates without a rename. Runtime queries are already raw Neon tagged-template SQL, so
they port with type changes only.

### 3.2 Tenancy — RESOLVED 2026-08-07: company is a real axis, and BurnRateOS already built it

**Decision:** `accountId` → `tenant_id`; `companyId` → a first-class **company** axis; the
tenant↔company relationship is many-to-many; a project associates with one or more companies.
Company creation is a **CEO-agent** capability, not a settings form.

The proposal turned out to be already implemented upstream — this is an adoption, not a design.
BurnRateOS shipped it in April 2026 as "company-graph v1":

- **`account_company_relationships`** *is* the junction — `(accountId, companyId, kind)` unique,
  with `kind ∈ OWNER | CUSTOMER | PROSPECT | INVESTOR_TARGET | PORTFOLIO_COMPANY | PARTNER |
  COMPETITOR | VENDOR | OTHER`, an `isPrimary` flag (which replaced `Company.isDefault`), and a
  full ownership-claim flow — `claimedByUserId`, `claimVerificationMethod`
  (`DOMAIN_DNS_TXT | EMAIL_AT_DOMAIN | MANUAL_REVIEW`), DNS TXT token, and verification stamps.
- **`Company.accountId` is deliberately nullable** — NULL is a global business-graph row nobody
  has claimed (enriched from a data provider); non-NULL means a tenant runs it. That single
  nullable column is what lets one table be both *the business you operate* and *a company in
  your CRM / portfolio / investor pipeline*, discriminated by relationship `kind`.
- `Company` already carries the operating facets a CEO agent would fill in: onboarding status,
  `isDraft`, team size, funding round, available cash, monthly budget, team cost, monthly
  revenue, business stage, industry, market focus, plus public profile fields. The schema
  comments state these feed the pitch-deck AI and the market-research tool directly.

**`isDraft` matches a pattern Builderforce already has.** It is the silent pre-onboarding
company auto-created so a user can reach the dashboard without declaring a business yet — the
same idea as the auto-provisioned Default workspace + project ([[zero-setup-onboarding]]).
Reconcile them rather than shipping both.

#### The one invariant this decision forces — and it cannot be deferred

**Every ported row must carry `tenant_id NOT NULL`, denormalized, in the same codemod.**

Measured across the 404 models: **79** carry `accountId` + `companyId`, **51** carry `accountId`
only, **112** carry neither (child rows scoped through a parent FK) — and **162 carry
`companyId` with no `accountId` at all** (`Deal`, `KanbanBoard`, `Task`, `Epic`,
`FinancialTransaction`, `PlanningPokerSession`, …). The tenancy service's docstring claims
"every authenticated row is scoped by BOTH accountId and companyId"; the schema does not agree.

For those 162, the owning tenant is derivable *only* through the junction — and the junction's
`@@unique([accountId, companyId, kind])` permits two different accounts to each hold an `OWNER`
row for the same company. So a `Deal`'s owning tenant is genuinely ambiguous at the schema
level. Every Builderforce gate gates on tenant: `enforceTokenCaps` and the consumption meters
([[consumption-meter-framework]]), the `activity_log` audit store
([[unified-activity-audit-log]]), per-tenant derived-key connector credential decryption,
`planFeatures.ts` / `featureGate.ts` ([[paid-plan-feature-gate]]), and the superadmin bypass
([[superadmin-unlimited-dispatch-two-caps]]). None of them can run on a derived, possibly
two-valued tenant.

Fix is mechanical and belongs in the B0 codemod: stamp `tenant_id NOT NULL` on all 404,
back-filled from the primary `OWNER` relationship at migration time, keeping `company_id` as the
business axis beside it. Doing this later means a second migration the size of the first, plus
rewriting every query written in between.

With the invariant in place, **switching company never crosses an identity boundary** — it stays
a filter inside one tenant, which is exactly how the navigation architecture's scope table
already draws it. Many-to-many tenant↔company then means what it should: an agency and its
client both *see* a company record, while every data row still has exactly one owner.

#### Project ↔ company

Many-to-many, using the `isPrimary` pattern already in the junction: **one primary company per
project** for rollups and billing attribution, plus additional associations for visibility.
Without a primary, `portfolioRollup.ts`, `lib/deliveryVerdict.ts` and `objective_links` all
double-count a project shared by two companies.

### 3.3 Valkey/Redis → `getOrSetCached`

BurnRateOS runs Valkey in Docker for dev and caches through `services/cache.ts`. There is no
Redis in the Builderforce target and there must not be an inline `Map`+TTL: every cached read
moves to the canonical `getOrSetCached` (L1 in-isolate Map + L2 KV) with write-invalidation,
and the `invalidateCached`/`cacheKey` helpers map onto it 1:1.

### 3.4 Mantine → Builderforce components

Per-page rebuild. Rules that apply to every rebuilt page, in the same pass as the rebuild:
theme tokens only, light **and** dark, fluid to 360px ([[theme-and-responsive-ui]]), and
next-intl keys in all five catalogs with real translations ([[i18n-localization]]).
BurnRateOS ships no i18n at all today — this is net-new work on 262 pages, not a migration.

### 3.5 Auth reconciliation

BurnRateOS has `Session`, `EmailOtpChallenge`, `MfaBackupCode`, `LoginAttempt`, `AccountLock`,
`BotBlockEvent`, `GuestSession`, TOTP. Builderforce has MFA (0010), OAuth + magic link (0034),
device authorization (0201), sessions. Merge onto Builderforce's; BurnRateOS contributes
account-lockout, login-attempt throttling and bot-block — all net-new hardening.

---

## 4 · Tracks

Each track is **merge-first**: reconcile against the §2 owner, then port only what survives.

| Track | Scope | Net-new vs merge |
|---|---|---|
| **B0** | Foundation (§3) — Prisma→Drizzle codemod, tenancy decision, cache, auth, component-system baseline | all foundation |
| **B1 · CFO / Business Intelligence** | Runway, burn, break-even, forecast scenarios + assumptions + sensitivity + Monte Carlo, ARR projections, cohort retention, CAC/LTV/payback, expenses + AI expense classification, Plaid sync, financial accounts/transactions/categories, TCO, custom KPIs + formulas + thresholds, what-if scenarios, dashboard widgets/layouts | **mostly net-new** — merges only with FinOps |
| **B2 · CEO / Investor Intelligence** | Pitch decks + versions + share links + slide analytics + comments, investor profiles/updates/reports/approvals, portfolio companies, health scoring, funding rounds, data rooms, due diligence, deal flow, investor portal access | **net-new** |
| **B3 · CRO / CRM + VoIP** | Contacts (+identifiers, sources, provenance, edit logs, experience/education/compensation), companies + CRM/billing/support/product/marketing facets, deals, pipelines, quota, conversion rates, sequences (`Ri*`), dedup, enrichment credits, **business phone** (numbers, porting, balances, voice agent) | merge pipeline/contacts; **VoIP net-new** (§2 row 6) |
| **B4 · CMO / Marketing & Growth** | Heatmaps (pages/captures/screenshots/analysis/events), landing pages + blocks, website pages, lead forms, nurture flows + steps + enrollment, A/B tests + variants + segments, NPS, referral codes, email sends + tracking, SEO pages, brand kits, content items, **web push** (§5 ex. 2) | merge campaigns; rest **net-new** |
| **B5 · CPO / Product Management** | Features, feature requests + voting + adoption, experiments, release plans, roadmap items, product ideas, market/competitive analysis, customer insights, validation (results, imports, AI insights, dashboards, scenarios), MVP scenarios, approval workflows, entity versions, sign-offs, model locks | merge onto PMO/product; **validation + voting net-new** |
| **B6 · CTO / Agile Survival** | Kanban, sprints, velocity, capacity, bottlenecks, risk assessment, technical debt, deployments, dev integrations (issues/commits/PRs/time/releases), cost calculation, sprint financial impact, runway↔sprint link | **mostly merge** — the *financial* half (cost per sprint, runway link) is net-new |
| **B7 · CHRO / Operational Cadence** | Employees + employment records + emergency contacts, goals, performance reviews, 1:1s, check-ins, startup sync + agenda + metrics, scorecards, ScratchPad + meetings + transcripts + notes templates, calendar + bookings, Slack | merge with PRD 18 T3 (**same HR agent**, §2 row 1); bookings per §2 row 5 |
| **B8 · CISO / Governance** | SOC controls + evidence, security incidents, vendors, DPAs, PII data assets, security training, compliance events, DSR (public + internal), data suppression, terms versions + agreements, embed consent | merge onto `soc_controls`/security; **vendors + DPA + PII assets net-new** |
| **B9 · Platform remainder** | Marketplace + consultants + settlement, AI credits, cart/orders/invoicing, affiliate (§2 row 4), onboarding flows, announcement banners, changelog, user segments, coach marks, agency branding + clients, impersonation, system admin, embeds + widgets, uptime, waitlist, webinars/podcast/learn-video, blog (§2 row 12), guest sessions, free tools | merge-heavy |

### 4.1 · B9 pricing-cart acceptance contract

The BurnRateOS migration includes its self-serve plan-selection journey, not only the
cart/order tables. Builderforce's published pricing document and subscription checkout endpoint
remain the system of record; the BurnRateOS UI behavior is merged onto those seams.

- The pricing cards expose monthly and annual billing before a buyer selects a plan. Every shown
  total, cart line, renewal label, and checkout payload uses the selected interval.
- Teams exposes its published minimum-seat scale on the card and displays the arithmetic
  (`per-seat price × seats = recurring total`) before the plan enters the cart.
- Each card's top action shows either `Current plan` or the applicable upgrade action. Paid-plan
  actions add one replaceable subscription line to the shared header cart; they do not bypass it.
- An anonymous cart survives account creation. Registration continues through workspace creation
  or selection, then returns to `/pricing`, reopens the saved cart, and asks the buyer to confirm
  secure checkout.
- Authenticated checkout supplies the selected plan, interval, seat count, retained discount, and
  account billing email to `POST /api/tenants/:id/subscription/checkout`, then redirects only to
  the payment-provider URL returned by that endpoint. Plan activation still occurs only from the
  verified provider webhook.
- Marketplace artifacts, business phone, and a base-plan subscription cannot be combined in one
  provider checkout; the cart explains that they must be purchased separately.

---

## 5 · Exceptions — decisions, not engineering

1. ~~**Tenancy model**~~ — **RESOLVED 2026-08-07** (§3.2). Company is a first-class axis;
   tenant↔company is many-to-many via the `account_company_relationships` junction BurnRateOS
   already ships; projects associate with one or more companies with one primary; a CEO agent
   creates companies. B0's codemod and the navigation architecture's scope rules are both
   unblocked. The one condition carried into B0: `tenant_id NOT NULL` denormalized onto all 404
   models in the same pass, because 162 of them carry `companyId` with no tenant column today.
2. **Web push comes back.** Migration 0195 deleted Web Push from Builderforce and the standing
   note is "never reintroduce VAPID" ([[push-removed-burnrateos]]) — precisely *because* push
   lived in BurnRateOS. Consolidating BurnRateOS reverses that: `MarketingPushSubscriber/
   Campaign/Delivery`, the `push-fanout` queue and `packages/push-pwa` all arrive with B4.
   **This also settles an open question in the navigation architecture**, whose invite matrix
   lists "installed PWA, not running → a true ring while the app is closed" as *blocked by
   policy* for exactly this reason. So the question is no longer "revisit the VAPID rule to
   enable one feature" — push is re-admitted anyway by this consolidation, and all that remains
   is whether the live-session ring rides it. Either re-admit VAPID (and get the closed-app ring
   nearly free), or drop BurnRateOS's push campaigns and lose a shipped marketing capability.
   Not an engineering call.
3. **Rows 4, 6 and 12 of §2** — affiliates, VoIP provider, content store. Each is a genuine
   either/or between two working implementations.
4. **AI credits vs token caps** (§2 row 17) — BurnRateOS sells credit packs (500/$4.99 →
   50K/$299.99); Builderforce meters tokens against plan caps. One pricing model survives, and
   that is a commercial decision that changes both products' pricing pages.
5. **Two self-serve price points collide.** BurnRateOS Starter/Pro ($29/mo) vs Builderforce's
   existing plans. Consolidation means one price list.
6. **Neon tier.** PRD 18 already puts ~360 net-new tables against the Free tier; this PRD adds
   up to ~400 more. The combined program does not fit a Free-tier budget.
7. **Prisma dual schemas.** `schema.mysql.prisma` and `schema.neon.prisma` exist alongside
   `schema.prisma`. Confirm Neon is the only live target before the codemod runs; a MySQL
   deployment would change the conversion.

---

## 6 · Sequencing against PRD 18

The two programs share T0/B0 foundation work and collide on §2. Interleave them:

| Phase | PRD 18 | PRD 19 | Gate |
|---|---|---|---|
| 0 | T0 foundation | — | — |
| 0.5 | — | — | **§2 register settled** (rows 1, 4, 6, 12 especially) + §5 ex. 1 answered |
| 1 | T1 — Recruiter + résumé spine | B0 — Prisma→Drizzle codemod, tenancy, cache | B0 needs the §5.1 answer |
| 2 | T3 — HR agent + Career 360 + HRMS connectors | B7 — CHRO domain **into the same HR agent** | §2 row 1 |
| 3 | T2 — ATS | B1 + B2 — CFO + CEO (highest net-new value) | independent |
| 4 | T4 — Canvas runtimes (long-running, parallel throughout) | B3 + B4 — CRO + CMO | §2 rows 3, 6 |
| 5 | T5 + T6 | B5 + B6 + B8 | §2 rows 8, 9, 10, 13 |
| 6 | cutover | B9 + cutover | §2 rows 4, 14, 15, 17 |

**Both domains retire together or the collisions reopen.** A cutover that redirects
hired.video while burnrateos.com still runs its own affiliate and phone systems leaves exactly
the duplication §2 exists to prevent.

---

## 7 · Coverage appendix

### 7.1 API route modules (103 + 6 nested) → track

**B1 (CFO):** `financial`, `expenses`, `breakEven`, `forecasting`, `predictiveAnalytics`,
`revenueAnalytics`, `revenueIntelligence`, `businessIntelligence`, `agileCost`, `analytics`,
`dashboard`, `pricing`, `pricingAggregator`

**B2 (CEO):** `investorIntelligence`, `investors`, `investorUpdates`, `pitchDeck`,
`portfolioComms`, `growth`

**B3 (CRO):** `crmDeals`, `contacts`, `v1Contacts`, `companies`, `businessProfiles`,
`customerEngagement`, `salesGrowth`, `phone`, `numberPorting`, `commsOps`, `dedup`,
`sourcingExtractor`, `importSync`, `googleImport`, `leadForms`(→B4), `nurtureFlows`(→B4)

**B4 (CMO):** `marketing`, `marketingGrowth`, `heatmaps`, `landingPages`, `blog`, `nps`,
`referrals`, `emailTracking`, `emailConfig`, `push`, `publicWidgets`, `widgetJs`,
`hrWidgetJs`, `embed`, `sitemap`, `freeTools`, `catalog`

**B5 (CPO):** `productManagement`, `featureVoting`, `featureScoring`, `featureAdoption`,
`roadmap`(via productManagement), `knowledgeBase`

**B6 (CTO):** `agileSurvival`, `kanban`, `planningPoker`, `retrospectives`, `events`

**B7 (CHRO):** `operationalCadence`, `hrAdmin`, `hrLegal`, `hrPanel`, `v1Hr`, `bookings`,
`meetingNotesTemplates`, `scratchPad`, `slackIntegration`, `notifications`

**B8 (CISO):** `governance`, `soc2`, `dsrPublic`, `terms`, `uptime`

**B9 (platform):** `accounts`, `auth` + `auth/*`, `oauth`, `users`, `teams`, `billing`,
`invoicing`, `marketplace`, `consultant`, `agency`, `affiliate`(via referrals), `ai`,
`aiCredits`, `aiProductivity`, `coach`, `coachMarks`, `onboarding`, `impersonation`,
`systemAdmin` + `systemAdmin/*`, `system`, `guest`, `health`, `lookups`, `migrate`,
`supportTickets`, `usageTracking`, `contact`, `emailPreference`(via emailConfig)

### 7.2 Frontend domains (20, 262 pages) → track

`businessIntelligence`(20)→B1 · `investorIntelligence`(22)→B2 ·
`customerEngagement`(25)+`revenueIntelligence`(9)→B3 · `marketing`(60)+`growth`(11)→B4 ·
`productManagement`(17)→B5 · `agileSurvival`(14)→B6 · `operationalCadence`(24)→B7 ·
`governanceCollaboration`(19)→B8 · `account`(10)+`auth`(12)+`company`(5)+`system`(2)+
`marketplace`(6)+`affiliate`(3)+`support`(1)+`dashboard`(2)+`ai`(6)→B9 · `common`(3)→B0

### 7.3 Runtime infrastructure

| BurnRateOS | Builderforce target | Track |
|---|---|---|
| DO `SupportChatRoom` | merge with support (0236) — contributes the live-chat half | B9 |
| DO `NotificationRoom` | existing notification/relay DO | B9 |
| DO `SessionRoom` | existing session/collab DO | B6 |
| Queue `push-fanout` + DLQ | **§5 exception 2** | B4 |
| `packages/push-pwa` | **§5 exception 2** | B4 |
| Cron `0 3 * * *` (churn recalc, digests, coach) | `cronSweeps.ts` behind the KV work-gate | B9 |
| Cron `*/5 * * * *` (uptime sweep) | merge into monitoring sweeps | B8 |
| `frontend/src/workers/sourcingExtractor.worker.ts` | browser worker, ports as-is | B3 |
| `ai/personaPrompts.ts` (8 CxO) + `ai/tools/*` (48 intents, 11 modules) | `provisionBuiltinAgents.ts` seeds + Creation Canvas `PromptUseCasePicker` mapped onto existing object/actions | B0 → per-domain |
| `services/builderforceClient.ts` | **delete** — in-process once consolidated | B0 |
| Prisma `schema.mysql.prisma` / `schema.neon.prisma` | **§5 exception 7** | B0 |

### 7.4 Out of scope

`.augment/`, `.kiro/`, `.windsurf/`, `.claude/` — editor/agent configuration, not product.
`SECRETS.md` — operational credentials; migrate to the secret store, never to source.

---

## 8 · Planned coverage confirmation

**The strategy assigns every BurnRateOS capability a destination; it does not confirm that the
migration has happened.** All 109 route modules, all 20 frontend domains / 262 pages, all 404
models, all 3 Durable Objects, both crons, the queue and the workspace package have a named
destination above. The dated implementation audit at the top of this PRD is the authority for
actual shutdown readiness.

Two honest qualifications, both decisions rather than gaps:

1. **Not every feature or table survives, by design.** The extraction boundary above is now the
   product decision: IDEA → REAL capabilities move into an existing owner; duplicate application
   structure is retired; non-target customer data is exported rather than used to justify schema.
2. **§5 lists seven decisions** — tenancy axis, web push, three either/or capability calls, the
   credits-vs-caps pricing model, and the Neon tier. Each changes what gets built. The 2026-08-10
   audit found that the implemented company/relationship model does not yet satisfy the tenancy
   decision in §3.2, so that decision must be reconciled before production data is transformed.
