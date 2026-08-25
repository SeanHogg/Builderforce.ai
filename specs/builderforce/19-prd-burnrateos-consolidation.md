# PRD 19 — burnrateos.com → Builderforce.ai consolidation

**Status:** In progress — **NO-GO for BurnRateOS shutdown** · **Owner:** platform · **Created:** 2026-08-07 · **Audited:** 2026-08-10
**Companion to:** [PRD 18 — hired.video port](./18-prd-hired-video-port.md)
**Goal:** extract the parts of `C:\code\burnrateos.com` that move Builderforce's **IDEA → REAL**
loop forward, completing the AI C-suite without copying BurnRateOS's application or schema.
hired.video contributes the **Recruiter** and **HR** agents; BurnRateOS contributes **CEO, CFO,
CRO, CMO, CPO, CISO** perspectives and selected domain behavior they need.

## Implementation audit — 2026-08-25

This section reports the repository state, not the intended destination described by the rest of
the PRD. A table in a migration, a row in the source-to-target map, a generic CRUD endpoint, a
marketing page, and a working migrated feature are five different states. Only the last one is
sufficient evidence for shutting down BurnRateOS.

**Audit baseline:** Builderforce `95bedac24fb7d9d2702d4aecdb65cd668b3f3364` and BurnRateOS
`cc23b2139e5846228fc255952cbf3bc733437668`. The prior baseline was
`6b9b31b89a4fc85ea351c16dbea5b02d4b7601b5` / `708f0d8b1b0f9d59b091e23634257159d6777766`
(2026-08-10); deltas below are measured against it.

### Executive verdict

> **DIRECTIVE CHANGE — 2026-08-25.** The operator directive is now **deprecation of
> `burnrateos.com`**, which is a parity obligation: every source capability must be built or
> explicitly retired, because a capability that is neither is lost at shutdown. This **supersedes
> the scoping half of the 2026-08-10 selective-extraction decision** (§0, DONE.md) — that decision's
> engineering conclusions stand, its *boundary* does not. **[§9](#9--deprecation-parity-audit--2026-08-25)
> is the inventory, the mapping and the gap register the new directive requires**, and it is the
> authority on what is left to build. The gates in this section remain the authority on shutdown
> readiness.

**Do not redirect or terminate `burnrateos.com` yet.** Builderforce has completed most of the
*destination-model* work, but not the source-data move or most feature behavior:

- [`check-model-coverage.mjs`](../../api/scripts/check-model-coverage.mjs) passes: all **1,130**
  distinct source tables are assigned a disposition and all **363/363** keep targets have a
  Drizzle declaration — the target schema reached **100%** on 2026-08-25. The last gap was a stale
  map row rather than missing work: `gig_disputes` was generalised into `marketplace_disputes` by
  migration 0986 and the map still named the retired table. This proves design coverage, not
  migrated rows or behavior.
- [`check-table-adoption.mjs`](../../api/scripts/check-table-adoption.mjs) reports **358** tables
  created by migrations 0418+, **358** registered with the generic entity layer, **177**
  reached by a feature path (162 import, 44 raw SQL), and **181 registry-only**, 0 unreachable.
  Registration by [`entityCatalog.ts`](../../api/src/application/domains/entityCatalog.ts) is
  deliberately excluded from feature adoption by the checker. This is the migration-status meter
  and it has moved: 36 → 177 feature-reached since 2026-08-10, against 100 more tables created.
  **Of the 181 still registry-only, 99 originate in BurnRateOS** and 80 in hired.video; the
  BurnRateOS remainder concentrates in Growth & marketing (25), Finance (16), Delivery & work (11)
  and Revenue & CRM (10) — i.e. tracks B4, B1, B6 and B3.
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
  **48/48** BurnRateOS executive intents are now executable from Creation Canvas' searchable “Choose a
  starting point” menu by
  [`PromptUseCasePicker.tsx`](../../frontend/src/components/PromptUseCasePicker.tsx), retaining each
  dotted source contract as its audit/search id. Every item now has an evidence mode, operation,
  entity-selection hints, permitted existing output kinds and a measurable completion condition.
  This is intentionally one Canvas execution path—not 48 new MCP endpoints and not new tables. It
  closes intent discovery and execution contracts; it does **not** by itself migrate production
  source rows or close the provider/domain-service gaps in B1–B8 below.
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
| **B0 · Foundation** | Source map is complete; 0418–0433 create the consolidated targets; generic entity API and shared seat UI exist; password hashes use the same PBKDF2/SHA-256, 100k-iteration, `salt:hash` format in both products. The tenant/company planner now maps explicit account→tenant assignments onto existing `segments`, tenant `companies`, registered `objects` and `relations`, with strict ambiguity rejection and no DDL. | **Partial / production cutover blocker.** The mapping contract is implemented and tested, but no production account map, source-row ETL or reconciliation report has been run. No port of BurnRateOS account locks, login-attempt history, bot-block events, refresh sessions, or MFA-secret transformation. Existing sessions cannot survive the domain/JWT change. |
| **B1 · CFO / BI** | Migration 0424 creates 20 finance targets; kernel ledger/settings/metrics can absorb balances and series. The legacy burn/runway seam now reads local tenant-scoped `metric_facts`; no Builderforce runtime calls BurnRateOS. | **Partial / production-data blocker: 0/20 finance target tables feature-reached.** The local seam closes the network dependency, not finance parity. Break-even, forecast assumptions/sensitivity/Monte Carlo, ARR projections, cohort retention, CAC/LTV/payback, expense classification, company P&L, Plaid sync, TCO, custom KPI formulas, scenario calculations and sprint financial impact still require production-use classification and, where retained, existing-owner behavior plus transformed rows. Builderforce FinOps is cloud/AI spend, not a replacement for company finance. |
| **B2 · CEO / Investor** | Migration 0422 creates 12 investor/portfolio targets; kernel artifacts/revisions/shares can represent deck content and versions. | **Not ported: 0/12 target tables feature-reached.** No pitch-deck generator/version/share-view analytics flow, investor updates and approvals, investor reports/digests, board packages, data-room ACL/download flow, due-diligence workflow, portfolio health scoring, funding-history/valuation/exit models, or investor portal migration. Generic artifact and entity forms do not enforce these workflows. |
| **B3 · CRO / CRM + VoIP** | Migration 0421 creates 20 revenue targets; existing Builderforce sales routes cover a simpler contact/pipeline; the Twilio connector remains the phone-action ceiling. | **CRM extraction remains production-driven: 1/20 targets feature-reached (`business_phone_numbers`).** Contact provenance/edit logs, identity/source history, enrichment credits/providers, dedup/import, ICPs, sequences, conversion/quota analytics, communications ops and deal-risk logic require active-use classification and transformed data where retained. The SignalWire hosted carrier product is intentionally retired: export call/SMS history, port or release active numbers, reconcile add-ons, and add no provider configuration or phone tables. |
| **B4 · CMO / Growth** | Migration 0432 creates 47 targets; the pre-existing campaign/site/mailbox engines are valid merge owners. | **Mostly not extracted: 2/47 targets feature-reached (`announcement_banners`, `email_otp_challenges`), neither proves the CMO workflows.** Heatmaps, nurture execution, lead forms, landing blocks, A/B allocation, NPS, email parity, SEO, brand/content and public widgets require active-use classification. Affiliate administration and Web Push are intentionally retired; retain/export required history and consent, delete push tokens, and do not add VAPID, queue/DLQ or PWA runtime. |
| **B5 · CPO / Product** | Builderforce PMO, product, feedback and validation owners exist; consolidated work/items/artifacts can represent several source models. Validation engagement reads are now local. | **Partial merge only.** Feature voting/adoption, scoring, product ideas/company workflows, release plans, public roadmap/deck, validation AI insights/scenarios, MVP scaffolding, entity version/sign-off/model-lock workflows still need domain-backed behavior and migrated source rows. |
| **B6 · CTO / Agile** | Builderforce boards/tasks/sprints, poker/retro, ceremonies and shell session remain the correct owners. | **Core merge owner exists; retained source behavior/data is not migrated.** Missing cost-per-sprint/runway coupling, capacity and velocity parity, bottleneck/technical-debt/deployment rollups, cost calculation and source work/session data transformation. BurnRateOS `SessionRoom` is intentionally not ported as a second room; only active-session state that customers must retain is transformed/exported into the shell owner. Do not migrate duplicate Kanban/poker tables. |
| **B7 · HR / Operational cadence** | Migration 0420 creates 22 people/HR targets; one `builtin_kind='hr'` teammate is provisioned; existing meetings/pulse owners remain. | **Not ported: 0/22 targets feature-reached.** Employee/employment/emergency contacts, headcount and hiring forecasts, goals/reviews/1:1/check-ins, weekly syncs, scorecards, ScratchPad pages/collaborators/transcripts/templates/attachments, bookings/calendar links and Slack workflows lack feature services. Booking targets in 0425 are registry-only. Recall.ai notetaker config and attachment-row/object migration are absent. |
| **B8 · CISO / Governance** | Builderforce SOC/security/uptime owners exist; migration 0428 adds two identity/governance targets. | **Partial merge only: 0/2 new targets feature-reached.** BurnRateOS vendors, DPAs, PII inventory, compliance events, security training, DSR/suppression, terms agreement history, embed consent, public DSR, and uptime-monitor source data/alert behavior are not ported. The BurnRateOS 5-minute uptime sweep and support-chat behavior are not wired into Builderforce jobs. |
| **B9 · Platform** | Migration 0425 creates 20 commerce targets; cart/order checkout integration is real; Builderforce has marketplace, billing, support, content and admin owners. | **Partial: 3/20 targets feature-reached (`carts`, `orders`, `order_line_items`).** Consultant settlement, booking webhooks, retained credit-value transforms, templates/licenses, white-label data, evidence-backed support chat, guest claim continuity and active media/free-tool state remain classification/ETL work. Affiliate administration is retired after history export and unsettled-payout reconciliation. Cart/order support still does not migrate existing BurnRateOS purchases or subscriptions. |

### C-suite Creation Canvas menu mapping — implemented 2026-08-10

The migration decision is to expose these as executive creation intents in the existing Canvas
menu. Selecting an item gives Brain a bounded, machine-readable workflow to create or update
existing Canvas objects from available evidence. It does not create a parallel C-suite service
layer.

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
- `C_SUITE_CANVAS_WORKFLOWS` contains exactly the same **48 ids**. Every contract declares domain,
  Canvas or web evidence; the intended operation; entity-selection terms; permitted existing output
  kinds; target-confirmation policy; and a completion condition.
- Menu search includes the legacy dotted id, label, category and prescription, so operators can
  locate either “Runway snapshot” or `finance.runway.snapshot`.
- Prescriptions name the existing destination object and require source evidence/no invented
  values. Canonical sales requests use the existing sales workspace. Market-peer deletion requires
  an identified target rather than a broad destructive action.
- Creation Canvas exposes `canvas_prepare_executive_use_case`, one read-only dispatcher over the
  existing 15-domain summary, entity, item and metric APIs. Domain contracts select live readable
  entities by semantic hints and fall back to the domain's objects/metrics rather than assuming a
  table. Canvas contracts read the selected object/snapshot; web contracts require search + fetch +
  sourced dataset. Existing `canvas_read_domain` remains available for follow-up inspection. Writes
  continue through existing reviewed Canvas/canonical actions.
- A run is not counted complete merely because Brain returned prose. The dotted id is written into
  prompt outcome/activity metadata, and completion requires a successful proposed mutation to one
  of that contract's allowed existing object kinds. A missing artifact produces an explicit
  incomplete system event and failed outcome.
- [`PromptUseCasePicker.test.tsx`](../../frontend/src/components/PromptUseCasePicker.test.tsx)
  asserts the 48-entry/48-unique invariant, exact workflow coverage, valid existing output kinds,
  evidence configuration, completion contracts, dotted-id search and selection.
- Verification on 2026-08-10: focused Vitest **6/6 passed**; frontend `tsgo --noEmit` passed; no
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
stage and existing owner domains; every individual use case declares its evidence, operation,
entity hints, allowed Canvas output kinds and completion condition. Selecting one instructs Brain
to prepare it through `canvas_prepare_executive_use_case` and explicitly forbids proposing a
database table. Tests assert all 48 contracts have an extraction owner and workflow, every stage
belongs to IDEA → REAL, and every output kind already exists in the Creation Canvas contract.

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
- `product/api/src/worker/durable/{NotificationRoom,SessionRoom,SupportChatRoom}.ts`: the duplicate
  notification/session objects are intentionally retired, not ported. What remains is to inventory
  active state and transform or export customer-required messages/participants into the existing
  shell owners; support chat is extracted only if active-tenant evidence makes it an IDEA → REAL
  requirement. An equivalently named primitive is not proof that state was moved.
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
| `NotificationRoom`, `SessionRoom`, `SupportChatRoom` | Duplicate notification/session DOs are retired in favor of Builderforce's relay/session owners. Active-state inventory, required state transform/export and the evidence-based support-chat decision are still missing. | **No duplicate runtime port; state cutover open** |
| `0 3 * * *` daily churn/digest/coach batch | [`cronSweeps.ts`](../../api/src/cronSweeps.ts) has Builderforce sweeps, not the BurnRateOS batch. | **Not ported** |
| `*/5 * * * *` uptime sweep | A Builderforce 5-minute trigger exists, but it does not read the BurnRateOS monitor store or port its alert service. | **Partial owner only** |
| `push-fanout` + DLQ and `packages/push-pwa` | Policy keeps Web Push retired; consent history is exported and legacy tokens are deleted. | **Intentionally retired; no runtime port** |
| `burnrateos-attachments` R2 | Builderforce has other artifact storage, but no copy manifest, key rewrite, checksum, ACL, or legacy URL plan. | **Not migrated** |
| Plaid, SignalWire, Recall.ai, Tavily | Policy requires finance reconsent only for retained Plaid use, SignalWire number port/release, Recall artifact export, and Builderforce's existing search routing/Tavily reconsent. | **Disposition settled; customer/provider actions open** |
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

- [x] **Decision gate:** §2 rows 4, 6 and 12 plus pricing, push and provider ownership are settled
  in this PRD and enforced by the versioned cutover-policy manifest/CI check.
- [x] **Tenancy mapping gate:** the strict account→tenant/company/project planner, row resolver and
  read-only production audit are implemented and tested on existing shapes with no DDL. Supplying
  the production identity account map and applying/reconciling its output remain Identity/Data work.
- [ ] **Identity gate:** dry-run all users, collisions, memberships, roles and verified emails;
  login with an imported password; require fresh sessions; test OAuth-only and MFA users.
- [ ] **Data gate:** run idempotent ETL against a production snapshot; publish per-table source,
  transformed, inserted, merged, rejected and orphan counts plus financial totals and attachment
  checksums; rerun to prove zero duplicates.
- [ ] **Extraction gate — now measured, see [§9](#9--deprecation-parity-audit--2026-08-25):** every
  feature used by an active BurnRateOS tenant is classified, and under the deprecation directive the
  classification is binary — an extracted capability has a tested Builderforce workflow and
  transformed data, or it has an explicit customer-approved retirement/export. §9 resolves all 106
  source modules: **44 at full parity, 45 partial, 6 gap, 11 stateless**, leaving **64 `build`
  items** in [`burnrate-parity.tsv`](../data-model/burnrate-parity.tsv). All 64 already have a
  Drizzle declaration, so none of them is a schema request. Closing them is what closes this gate;
  activating a registry-only table merely to move the adoption meter still does not.
- [x] **C-suite Canvas execution gate:** map all 48 CxO intents to existing Creation Canvas
  objects/actions; retain searchable legacy ids; give each an evidence/operation/output/completion
  contract; fail outcomes that do not mutate an allowed artifact; test exact coverage; add no tables.
- [ ] **Production-data execution gate:** the tenant-scoped contract dispatcher is implemented;
  prove each mapped intent against migrated production data, apply Builderforce confirmation policy
  to its canonical writes, and pass persona-specific read/write integration tests. Contract presence
  and a generic read alone do not satisfy this gate.
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
pnpm run check:no-burnrate-runtime
pnpm run check:burnrate-policy
pnpm run audit:burnrate-cutover:validate
pnpm run audit:burnrate-tenancy:validate
```

With read-only production credentials, generate the immutable evidence report without changing
either database:

```powershell
$env:BURNRATE_SOURCE_DATABASE_URL = '<read-only BurnRateOS PostgreSQL URL>'
$env:NEON_DATABASE_URL = '<read-only Builderforce PostgreSQL URL>'
node scripts/audit-burnrate-cutover.mjs --output .\burnrate-reconciliation.json --strict
node scripts/audit-burnrate-tenancy.mjs --account-map .\burnrate-account-tenants.json --output .\burnrate-tenancy.json --strict
```

The audit inventories all 344 mapped BurnRateOS source tables and directly compares only the 114
one-to-one `keep` candidates. Collapsed/session/derived rows are marked `transform_required`; the
tool does not pretend row-count equality can validate a many-to-one extraction and performs no
writes or DDL.

The tenancy audit consumes the explicit account→tenant file produced by the identity dry run. It
does not infer tenants from names, domains or email suffixes. It verifies source accounts, target
tenants, active relationship authorization, unique company-only ownership and primary-company
cardinality, then reports the existing/missing `segments` needed by the later ETL. Its output is
also read-only and immutable (`flag: wx`).

Expected at the audited baseline:

```text
1130 source tables mapped, 0 unaccounted; target schema 363/363
358 consolidation tables created; 177 feature-reached; 181 registry-only; 0 unreachable
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
| 4 | **Affiliates / referrals** | none (0402 is sales-associate commissions) | `affiliates` (6 tables) | `AffiliatePartner/Referral/Payout/PayoutMethod`, `ReferralCode/Entry` | **RETIRE / EXPORT** — no affiliate administration product in Builderforce | export customer-readable history; reconcile unsettled obligations through the existing payout owner; add no referral tables |
| 5 | **Bookings / scheduling** | none | `bookings` (6 tables) | `Booking*` (9 models incl. external calendar link, payout, webhooks) | **BurnRateOS** (richer) | hired's is dropped |
| 6 | **Business phone / VoIP** | Twilio *connector* only | `phone` (5 tables, own provider) | SignalWire numbers, porting, balances, voice agent | **Twilio connector is the ceiling; retire the hosted carrier product** | export call/SMS records; port or release every active number; reconcile phone add-ons; copy no SignalWire credential or phone tables |
| 7 | **Support tickets + KB** | `support_tickets`, `prod_incidents` (0236), `knowledge_documents` (0227) | `help` mappings | `SupportTicket/Message`, `SupportArticle`, `SupportChatRoom` DO | **Builderforce 0236 + 0227** | BurnRateOS contributes the live support-chat DO |
| 8 | **Poker / retros / ceremonies** | `poker_sessions`, `retrospectives` (0062), ceremonies | — | `PlanningPokerSession`, `Retrospective*`, `AgileEvent` | **Builderforce 0062** | BurnRateOS's are dropped |
| 9 | **Kanban / sprints / stories** | boards, swimlanes, tasks, sprints | — | `KanbanBoard/Column`, `WorkItem`, `Sprint`, `Story`, `Epic`, `Initiative`, `UserStory`, `Task`, `Subtask` | **Builderforce** | BurnRateOS's hierarchy (Product→Initiative→Epic→Story→Task→Subtask) informs the epic-decomposition gap already in the register |
| 10 | **SOC 2 controls** | `soc_controls`, `soc_evidence` | `compliance` (3) | `SocControl`, `SocEvidence`, `ComplianceEvent`, `SecurityVendor`, `PiiDataAsset`, `SecurityDpa` | **Builderforce** | BurnRateOS's vendor/DPA/PII-asset models extend it (net-new fields, same table) |
| 11 | **Uptime / monitoring** | `uptime_samples` (0236), alerts, monitoring | — | `UptimeMonitor`, `UptimeCheck` | **Builderforce** | — |
| 12 | **Blog / articles / content** | `/blog` + content-manager | `articles` (9 tables) | `BlogPost`, `MarketingContentItem`, `MarketingSeoPage` | **Builderforce `knowledge_documents` + existing content-manager/public artifact routes** | transform retained published content; preserve canonical slugs and redirects; no `content_items` table |
| 13 | **Surveys / pulse / NPS** | `pulse_surveys` (0317), devex surveys (0229) | — | `PulseCheck/Question/Response`, `NpsSurvey` | **Builderforce 0317** | NPS becomes a survey type |
| 14 | **Billing / plans / invoices** | plans, `planFeatures.ts`, `featureGate.ts` | `billing` (9) | `BillingPlan`, `PlanFeature`, `Invoice`, `Order`, `Cart`, `PricingVersion` | **`planFeatures.ts` + `featureGate.ts`** ([[paid-plan-feature-gate]]) | BurnRateOS's cart/order/line-item model is net-new and lands *under* the one evaluator |
| 15 | **Payouts** | env-gated stub | full ledger + tax reporting + Tremendous + Helcim | `MarketplacePayout`, `MarketplaceSellerBalance`, `AffiliatePayout` | **hired.video's** (most complete) | BurnRateOS settlement calls into it |
| 16 | **Meetings / notes** | meetings (0292), ceremonies | — | `ScratchPad*` (13), `MeetingTranscript`, `ScratchPadNotesTemplate` | **Builderforce meetings** | ScratchPad transcript + notes-template half is net-new and merges in |
| 17 | **AI credits vs token caps** | token caps + consumption meters (0218) | tier enforcement | `AiCreditBalance/Transaction/Purchase`, credit packs | **the consumption-meter framework** ([[consumption-meter-framework]]) | credits become a meter denomination, not a parallel ledger |
| 18 | **Enrichment / dedup / import** | connectors | `enrichment`, `scraping` | `EnrichmentCache/Transaction`, `TenantEnrichmentCredits`, `Dedup`, `ImportJob/Row` | **BurnRateOS** (credit-metered) | hired's enrichment merges in |
| 19 | **"Company" — three meanings, one table** | none | `companies` (8 tables — employer profiles a candidate browses, reviews) | `Company` + `CompanyDomain` + facets (`CompanyCRM`/`Billing`/`Support`/`Product`/`Marketing`) + `AccountCompanyRelationship` | **BurnRateOS's company graph** (§3.2) | hired.video's employer profiles are the SAME entity with no `OWNER` relationship to your tenant — they merge in as `kind` rows rather than becoming a third company concept. Resolves what looked like an unavoidable collision. |

Rows 4, 6 and 12 were settled on 2026-08-10 by the selective IDEA → REAL policy. The executable
decision manifest is
[`burnrateCutoverPolicy.json`](../../api/src/application/migration/burnrateCutoverPolicy.json),
and CI rejects an undecided entry or any policy that permits new tables.

---

## 3 · Foundation work (B0) — blocks every BurnRateOS track

### 3.1 Selective source transformation — RESOLVED 2026-08-10

There is no 404-model Prisma→Drizzle codemod. Production-used IDEA → REAL rows transform into
existing Builderforce owners; retired capabilities are exported/erased under the cutover policy.
A source model is evidence to classify and transform, not permission to emit DDL.

### 3.2 Tenancy and company ownership — IMPLEMENTED 2026-08-10

No junction table is added. Builderforce already has every required shape:

- an identity dry run supplies the explicit **BurnRateOS account id → Builderforce tenant id** map;
- existing `segments` owns the unique `(tenant_id, external_account_id, external_company_id)`
  coordinate and becomes the primary project/company scope;
- existing tenant-scoped `companies` receives one copy per authorized tenant/company pair, with
  source ids, relationship kinds and claim evidence preserved in `attrs`;
- registered `objects` plus kernel `relations(kind='associated_with')` represent additional
  project↔company associations. The primary OWNER company selects the project's `segment_id`.

[`burnrateTenantCompanyMapping.ts`](../../api/src/application/migration/burnrateTenantCompanyMapping.ts)
implements the pure plan and row resolver. It does not guess ownership: account+company rows require
an active relationship; company-only rows require exactly one active mapped OWNER; rows with neither
coordinate are rejected unless their classifier explicitly permits platform-global data. Conflicting
account maps, multiple primary companies, unknown relationship kinds, unauthorized project links and
target company-name collisions are blockers. Unclaimed global companies are exported/retired rather
than forcing a global directory or nullable tenant ownership into Builderforce.

[`audit-burnrate-tenancy.mjs`](../../api/scripts/audit-burnrate-tenancy.mjs) validates the identity
account map against both databases with read-only credentials and reports assignments, missing
segments and every ambiguity. The planner and audit add no database table or migration. Running the
production account map and applying the accepted ETL remain part of the Identity/Data gates, not an
unresolved ownership design.

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
| **B0** | Foundation (§3) — selective transforms, implemented tenant/company mapping, cache, auth, component-system baseline | all retained foundation behavior/data |
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
2. ~~**Web push**~~ — **RESOLVED 2026-08-10:** stays retired. Do not reintroduce VAPID,
   `push-fanout`, a DLQ or `packages/push-pwa`. Export consent history required for the customer
   record, delete legacy push tokens at shutdown, and use existing email/in-app channels.
3. ~~**Rows 4, 6 and 12 of §2**~~ — **RESOLVED 2026-08-10:** affiliate administration retires
   after export/settlement; SignalWire hosted phone retires after history export and number
   port/release; published content transforms into `knowledge_documents` and existing public
   content routes with slugs/redirects preserved.
4. ~~**AI credits vs token caps**~~ — **RESOLVED 2026-08-10:** Builderforce consumption meters,
   plan features and kernel ledger are canonical. Valid customer value transforms to a meter/ledger
   denomination or is refunded; no parallel credit balance survives.
5. ~~**Two self-serve price points**~~ — **RESOLVED 2026-08-10:** Builderforce's published price
   list and verified Stripe checkout/webhook path are canonical. No BurnRateOS plan is recreated.
6. ~~**Provider ownership**~~ — **RESOLVED 2026-08-10:** Stripe is reconciled; retained connectors
   are reauthorized through existing owners; Helcim/SignalWire/Recall/LinkedIn retire after their
   named settlement/export actions. The complete credential and data dispositions are enforced by
   [`burnrateCutoverPolicy.json`](../../api/src/application/migration/burnrateCutoverPolicy.json).
7. ~~**Bulk schema/tier and Prisma dual-schema decisions**~~ — **RETIRED 2026-08-10:** selective
   extraction emits no bulk BurnRateOS schema, so neither a 404-model codemod nor its table-count
   capacity decision exists.

---

## 6 · Sequencing against PRD 18

The two programs share T0/B0 foundation work and collide on §2. Interleave them:

| Phase | PRD 18 | PRD 19 | Gate |
|---|---|---|---|
| 0 | T0 foundation | — | — |
| 0.5 | — | — | **§2 register settled** (rows 1, 4, 6, 12 especially) + §5 ex. 1 answered |
| 1 | T1 — Recruiter + résumé spine | B0 — selective transforms, tenancy mapping, cache | B0 production identity/data audit |
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

1. **Not every feature or table survives — but under the 2026-08-25 deprecation directive, each
   casualty now needs a NAMED decision rather than a boundary.** Duplicate application structure is
   still retired and non-target data is still exported rather than used to justify schema; what
   changed is that "outside the IDEA → REAL boundary" is no longer by itself a reason not to build.
   [§9](#9--deprecation-parity-audit--2026-08-25) carries the resulting register: 64 build, 6
   transform, 4 retire.
2. **§5 lists seven decisions** — tenancy axis, web push, three either/or capability calls, the
   credits-vs-caps pricing model, and the Neon tier. Each changes what gets built. §3.2 closed the
   tenancy decision on 2026-08-10 — `burnrateTenantCompanyMapping.ts` implements the planner and row
   resolver and `audit-burnrate-tenancy.mjs` validates it read-only — so what remains there is
   supplying the production account map and applying its output, not an unresolved design.

---

## 9 · Deprecation parity audit — 2026-08-25

### 9.0 The directive changed, and this section is what changed with it

**The operator directive is now DEPRECATION of `burnrateos.com`, and deprecation is a parity
obligation.** The 2026-08-10 decision recorded in §0 and in DONE.md — a selective IDEA → REAL
extraction, explicitly "not a 404-model/262-page port" — is **superseded for scoping purposes**. It
is not deleted, because it is a recorded operator decision and because most of its engineering
conclusions survive intact (no second invitation economy, no parallel schema, no duplicate provider
product). What does not survive is its *boundary*: under selective extraction, a BurnRateOS
capability with no Builderforce owner was **out of scope by definition**. Under deprecation, the
same capability is a **gap that must be closed or explicitly retired with customer approval**.
There is no third option, because when the source is switched off, a capability that is neither
built nor retired is simply lost.

This section is the inventory, the mapping and the gap register that the deprecation directive
requires. Everything in it is measured from source, not asserted, and both registers are committed
so the numbers are reproducible rather than a snapshot.

### 9.1 Step 1 — the full scope of `burnrateos.com`, measured

Measured at BurnRateOS `cc23b2139e5846228fc255952cbf3bc733437668`:

| Surface | Count | How it was measured |
|---|---|---|
| API route modules | **106** | `api/src/worker/routes/**/*.ts`, excluding `__tests__` |
| API endpoints | **1,739** | `.get/.post/.put/.patch/.delete/.all` registrations, deduplicated per module |
| Frontend `<Route>` paths | **481** unique | `App.tsx` |
| — real destinations | **348** | routes whose element is not a `<Navigate>` |
| — legacy redirects | **133** | already self-deprecated inside BurnRateOS |
| Frontend domains | **20** | `frontend/src/domains/*` |
| Frontend page components | **337** | `*.tsx` under a `pages` path |
| Prisma models | **404** | `model ` declarations in `schema.prisma` |
| Durable Objects · crons · queues | 3 · 2 · 1 | §7.3 |

The earlier "262 pages" figure counted only the nine product domains and excluded `system` (52),
`auth` (13) and `account` (10). **348 real routes is the deprecation surface**, not 262: a redirect
that returns 404 after shutdown is as broken as a missing feature.

The ten largest modules carry 660 of the 1,739 endpoints — `operationalCadence` (91),
`productManagement` (86), `businessIntelligence` (83), `investors` (80), `systemAdmin` (77),
`governance` (67), `billing` (52), `kanban` (45), `investorIntelligence` (42), `scratchPad` (39).

For comparison, Builderforce at `95bedac24fb7d9d2702d4aecdb65cd668b3f3364` has **226 route modules,
3,887 endpoints and 188 pages**. The destination is larger than the source; the question this
section answers is not *capacity* but *coverage*.

### 9.2 Step 2 — the mapping, and how parity is decided without guessing

Mapping 106 modules by name similarity would be a guess. The method used instead is evidence-driven
and mechanical, and it works because BurnRateOS writes **raw SQL**, so every route module names the
tables it touches in its own source:

1. For each BurnRateOS route module, extract the tables it reads or writes
   (`FROM|JOIN|INTO|UPDATE <table>`).
2. Resolve each table through [`source-to-target.tsv`](./data-model/source-to-target.tsv) to its
   Builderforce target and disposition.
3. A `primitive` / `merged` / `session` / `flatten` disposition means the row was absorbed by a
   kernel primitive, which is feature-reached by construction. Only a `keep` target can sit
   unreached.
4. A `keep` target is **reached** unless it appears in
   [`.table-adoption-baseline.txt`](../../api/scripts/.table-adoption-baseline.txt), which is the
   existing, CI-maintained list of tables that *only* the generic entity layer touches.
5. A module's parity is the share of its tables whose targets are reached.

This deliberately reuses the adoption checker rather than inventing a second definition of
"migrated". "Opens in `EntityBrowser`" already does not count as adoption anywhere else in this
repository, and it does not count here.

**Result across 106 modules** — committed as
[`burnrate-modules.tsv`](./data-model/burnrate-modules.tsv):

| Verdict | Modules | Meaning |
|---|---|---|
| **Full parity (100%)** | **44** | every table the module touches is reached by a Builderforce feature path |
| **Partial (1–99%)** | **45** | the capability exists but part of its data has no feature path |
| **Gap (0%)** | **6** | `landingPages`, `system`, `blog`, `breakEven`, `freeTools`, `lookups` |
| No table evidence | 11 | `health`, `sitemap`, `auth/geo`, `widgetJs`, `hrWidgetJs`, `hrPanel`, `coach`, `dedup`, `featureAdoption`, `numberPorting`, `v1Hr` — stateless proxies, embeddable JS, or delegating shims |

The 11 no-evidence modules were read individually rather than assumed: none holds state of its own.
`numberPorting` is covered by the `phoneVoip → retire_port_out` decision; the two `widgetJs` modules
serve embeddable script and are a real surface obligation tracked under `embed_widget_layout` below.

**Partial is the important verdict, and it is why a module-level "mapped" column would have lied.**
`productManagement` is 38% — features, requests, roadmap and experiments land on existing owners,
while A/B testing, release plans and heatmap-backed feedback do not. Reporting that module as
"mapped to PMO" would have hidden five capabilities.

### 9.3 Step 3 — the gap register, which is the build backlog

Deduplicating every unreached target across all 106 modules gives **74 distinct Builderforce targets
that a BurnRateOS route module depends on and that no Builderforce feature path reaches**. Committed
as [`burnrate-parity.tsv`](./data-model/burnrate-parity.tsv), classified against cutover policy v1:

| Disposition | Count | Meaning |
|---|---|---|
| **`build`** | **64** | no Builderforce owner and no retirement decision — must be built to deprecate |
| `transform` | 6 | a Builderforce owner is already canonical; the source rows transform onto it |
| `retire` | 4 | already decided in `burnrateCutoverPolicy.json`; export, do not rebuild |

`transform` is `billing_plans`, `plan_features`, `business_pricing_models`, `pricing_simulations`,
`system_features` (all `pricing → transform_existing`; `PlanLimits.ts` and
`pricingConfiguration.ts` stay canonical and are not in scope to change) and `payment_methods`
(`stripe → retain_reconcile`). `retire` is `affiliate_referrals` and `referral_entries`
(`affiliates → retire_export`), `ai_voice_agent_calls` (`phoneVoip → retire_port_out`) and
`blog_posts` (`blogContent → transform_existing` onto `knowledge_documents`).

**The single most important finding: all 74 targets already have a Drizzle declaration.** Verified
against `schema/*.ts` — zero of them need new schema. The entire deprecation backlog is application
code and surfaces over tables that already exist, which is exactly what
`burnrateCutoverPolicy.json`'s `newTablesAllowed: false` asserts, and it is the same shape the
2026-08-22 hired.video mapping audit found for PRD 18. **A gap here is a missing feature path, never
a missing table.**

#### The 64 `build` items by domain

| Domain | n | Targets |
|---|---|---|
| **Growth & marketing** | **18** | `landing_pages`, `landing_page_blocks`, `website_pages`, `marketing_seo_pages`, `marketing_content_items`, `marketing_emails`, `nurture_flows`, `ab_tests`, `ab_test_variants`, `customer_journeys`, `journey_touchpoints`, `marketing_heatmap_pages`, `marketing_heatmap_screenshots`, `brand_kits`, `embed_widget_layout`, `learn_videos`, `podcast_outreach`, `waitlist_entries` |
| **Revenue & CRM** | **9** | `ri_icps`, `ri_prospects`, `ri_sequences`, `ri_ids`, `deal_flow_opportunities`, `contact_experiences`, `contact_educations`, `contact_compensations`, `saved_contact_searches` |
| **Commerce** | **8** | `booking_hosts`, `booking_services`, `booking_reservations`, `agency_brandings`, `agency_clients`, `consultant_consultations`, `consultant_knowledge_docs`, `card_decks` |
| **Delivery & work** | **6** | `action_items`, `kanban_columns`, `release_plans`, `task_effort_estimates`, `sprint_financial_impact`, `approval_actions` |
| **Identity & tenancy** | **5** | `user_terms_agreements`, `onboarding_flows`, `onboarding_progress`, `stage_lookup`, `region_waitlist` |
| **Finance** | **5** | `break_even_scenarios`, `churn_predictions`, `monte_carlo_simulations`, `payback_period`, `saved_calculations` |
| **Agents & runtime** | **4** | `ai_tool_calls`, `ai_competitors`, `ai_email_classifications`, `enrichment_cache` |
| **Investor & portfolio** | **3** | `investor_peer_comparables`, `scratch_pad_attachments`, `modules` |
| **Support & knowledge** | **2** | `customer_engagement_feedback_widgets`, `support_articles` |
| **People & HR** | **2** | `hr_emergency_contacts`, `health_dimensions` |
| **Hiring** | **1** | `cohort_retention` |
| **Platform & observability** | **1** | `uptime_monitors` |

#### Sequencing, by how many source modules a target unblocks

`user_terms_agreements` (4 modules), `action_items` (3), `churn_predictions` (3),
`customer_engagement_feedback_widgets` (3), `marketing_heatmap_pages` (3),
`deal_flow_opportunities` (2), `investor_peer_comparables` (2), `onboarding_flows` (2),
`break_even_scenarios` (2), `ai_tool_calls` (2), `customer_journeys` (2) come first: each closes
part of more than one BurnRateOS module, so the parity percentage of several modules moves per unit
of work. Growth & marketing is the largest single block at 18 and the one that most needs a product
decision before code, because `landing_pages` / `website_pages` / `marketing_seo_pages` overlap the
existing `sites` and `siteManage` owners and must merge onto them rather than beside them — §2 is
the register that governs that, and it still governs.

### 9.4 What this section does NOT change

- **No new tables.** `newTablesAllowed: false` stands, and the audit above shows it is achievable.
- **§2 capability ownership still governs.** A gap being real is not permission to create a second
  owner. Every item lands on the owner §2 names.
- **PRD 21 still owns the experience.** Each closed gap arrives as a **panel over the mounted
  canvas**, never as a standalone page, and never as a horizontal tab bar.
- **Pricing is out of scope.** `PlanLimits.ts` and `pricingConfiguration.ts` are an operator
  decision; the six `transform` rows reconcile *onto* them.
- **The Claim-to-Proof gate still binds public copy.** Closing all 64 items would still not license
  the word "migrated": no BurnRateOS source rows have moved, and the Data gate in the implementation
  audit is still open.
- **Behaviour parity is not data parity.** This section closes the *extraction* gate. The
  *identity*, *data*, *provider*, *runtime*, *billing*, *cutover* and *rollback* gates are untouched
  by it, and the ETL those gates need still does not exist in this repository.

### 9.5 Reproducing this audit

Both registers are regenerated from source, never hand-edited:

```powershell
cd api
node scripts/check-burnrate-parity.mjs            # verifies the committed registers still match source
node scripts/check-burnrate-parity.mjs --update    # regenerates them after a gap is closed
```

The checker is the meter for this section: as each of the 64 items gains a feature path, the
`build` count falls, and it must never rise silently.
