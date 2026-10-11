# PRD 33a — Session replay: implementation hand-off

> This is the brief an implementing agent works from. Read [PRD 33](./33-prd-session-replay.md) first; its decisions (D1–D17), the §2.1 competitive matrix, the §2.2 method link, the §2.3 prescriptions and the §2.4 page review are settled.
> **Roles** (CLAUDE.md):
> - **Implementation:** one Opus agent per slice.
> - **Compile / typecheck / test:** a Sonnet agent running §11 verbatim.
> - **Audit:** the planning session, running §12 before the next dependent slice starts.
>
> Versions, DONE.md and ROADMAP.md belong to the planning session only. An implementer never edits them.

---

## 0. Ground rules for every slice

1. **Extend, never duplicate.** Every concept in §1 already has a home. If you find yourself writing a second stat tile, drawer, selector function, key table, cache or "visitor id", stop. Use or extract the existing one.
2. **Layering.**
   - Presentation is `presentation/routes/*`. It constructs application services with `requestDb(c)` (or `buildTransactionalDatabase(env)` for transactional tables) and calls them. It never imports `schema/*`.
   - Application is `application/replay/*` and owns the use cases.
   - Domain is `domain/replay/*`: pure functions only, with no `Env` and no `Db`.
   - Infrastructure is the R2 / DB access, behind small ports in application.
   - Components fetch through `frontend/src/lib/replayApi.ts` only.
3. **File size.** No new file over ~400 lines. Do not grow these files:
   - `adminRoutes.ts` (mount a new router instead);
   - `adminApi.ts` (2,053 lines; use `lib/replayApi.ts`);
   - `CreationCanvas.tsx` (net ≤ +10 lines).
4. **Caching.** Every new read goes through `getOrSetCached` (`infrastructure/cache/readThroughCache.ts`). Keys carry a version token from `getCacheVersion` / `bumpCacheVersion`. Key builders live in `application/replay/replayCacheKeys.ts`.
5. **i18n.** Every visible string goes in all five catalogs (`frontend/src/i18n/messages/{en,zh,es,fr,de}.json`) with real translations. Namespaces:
   - `admin.insights.*` for the admin destination;
   - `replay.*` for the shared components;
   - `creationCanvas.surface.sessions.*` for the canvas surface;
   - `marketplace.capability.*` for purchase and install.
6. **Theme and responsive.** Use tokens only (`var(--surface-card)`, `var(--text-primary)`, `var(--border)`, `var(--accent)`, `var(--error)`, `var(--warning)`, `var(--success)` …). Both themes, fluid layout, 44 px targets on phones, and tables scroll in their own box.
7. **Overlays.** Detail views use `SlideOutPanel` (`@/components/SlideOutPanel`). Centered modals are only for destructive approvals, through `useConfirm`.
8. **Tests ship with the code.** Each sub-slice names its tests, and the slice is not done without them.
9. **Report back** at the end of a slice with:
   - the files touched, with line counts;
   - every deviation from this brief and why;
   - anything you found and did not fix;
   - the exact test files you added.

   Do not run the full vitest suite.

---

## 1. What already exists — use it, do not rebuild it

| Seam | Where | Use it for |
|---|---|---|
| Admin destination registry | `frontend/src/lib/adminGroups.ts` (`ADMIN_GROUP_META`, `resolveAdminRoute` L121, `adminSubHref` L137; `LEGACY_ADMIN_TAB` L96 aliases `?tab=` only) + `app/admin/page.tsx` `ADMIN_PANELS` L58 (static imports) | The new `visitors` sub, and retiring `users.sessions` + `growth.visitorFlow` |
| Admin shared UI | `components/admin/adminShared.tsx`: `AdminPanelHeader`, `useAdminData`, `useAdminFormat`, `useTableSort`, `SortableTh`, `AdminError`, `AdminLoading`, `errText` | Every admin view |
| Visitor ids | `lib/visitor.ts` (`bf_visitor_id`, `getVisitorId`, `getExistingVisitorId`) and `lib/visitorJourney.ts` (`bf_visit_id`, `getVisitId`, `beginVisit`, 30-min idle) | The recording's visitor and visit, on builderforce.ai |
| Visitor stream | `POST /api/visitor/events` → `VisitorEventService.recordVisitorEvents` → `visitorActivity.recordVisitorActivity` → `activity_log` (`actor_type='visitor'`, `verb='visitor.<kind>'`, `target_id=visitId`) | Journey, Flow, errors for builderforce.ai. Do NOT write replay data here. |
| Flow graph | `VisitorJourneyService.flowGraph(env, days)` (cached), `journeyFor(visitorId)`; `domain/marketing/visitorFlowGraph.ts`; UI `VisitorFlowGraph.tsx` | The Flow view, extended with click-through to recordings |
| Leads | `GuestPromptService` (`listSessionsWithIntent`, `listPromptsForVisitor`, `forgetVisitor` L301); routes `adminRoutes.ts` L1377–1397; UI `GuestSessionsPanel.tsx` (385 lines; its drawer at L298; `BroadcastComposer` at L377) | The Leads view and the Lead tab |
| Erase a visitor | `DELETE /api/admin/guest-sessions/:visitorId/prompts`, which erases prompts + journey rows and writes the `GUEST_PROMPTS_ERASED` audit. **`adminApi.forgetGuestPrompts` has no UI caller today.** | The one erase path, extended through an eraser registry and wired to the Lead tab |
| Selector derivation | `lib/qa/telemetry.ts` `deriveSelector(el): {selector,label}` L92, `redactInput` L122 | Moved to `packages/interaction-contract`, then imported back |
| Zone ranking | `QaHeatmapService.rankZones` (heat × 0.97^ageDays) | Extract the pure ranking into `domain/qa/heatZones.ts` and use it for both |
| Error markers | `QualityErrorReporter` → `reportProductApiError` (attaches `visitorId` + `visitId`) → `qualityIngestRoutes.ts` ~L204 writes `visitor.error` | Platform error markers; read them, don't capture them again |
| Audit | `writeAdminAudit(db, EVENT, actorId, opts)` (`infrastructure/audit/adminAudit.ts`). Event names are UPPER_SNAKE. | `REPLAY_VIEWED`, `REPLAY_RELEASE_RENAMED`, `REPLAY_PIN_SET` |
| Activity (traces) | `recordActivity(env, db, input)` (`application/activity/activityLog.ts` L181) | The purchase → first-event trace (verbs `replay.*`) |
| Cache | `getOrSetCached`, `invalidateCached`, `getCacheVersion`, `bumpCacheVersion` | All reads |
| Transactional DB | `buildTransactionalDatabase(env)` (`infrastructure/database/connection.ts` L134); migrations `api/transactional-migrations/` track, next is `0014_` | `replay_visits`, `replay_releases`, `replay_interactions_daily` |
| Retention | `application/maintenance/retentionPurge.ts` | Register the replay tables and the R2 prefix purge |
| R2 | `env.UPLOADS` (`builderforce-uploads`), in both `wrangler.toml` and `wrangler.sites.toml` | Recording chunks under `replay/` |
| CORS for public ingest | `presentation/middleware/cors.ts` `PUBLIC_INGEST_PREFIXES` | Add `'/api/replay-ingest'` |
| IP ceiling pattern | `VisitorEventService.withinIpBudget` (KV `AUTH_CACHE_KV`, fail-open) | Copy the shape; key prefix `replay:ingest:ip:` |
| API keys | `HashService.generateApiKey(prefix)` (union L43), `hashSecret`; `tenantApiKeyService.mintTenantApiKey` L143, `TENANT_API_SCOPES` L40, `originAllowed` L580; `tenant_api_keys.allowed_origins` | The `bfr_` site key: a scoped `tenant_api_keys` row |
| Plan features | `domain/tenant/PlanLimits.ts` (boolean features), `planFeatures.ts` `PLAN_FEATURE_LABEL`, `featureGate.ts` `requireFeature` L211, `evaluateFeatureEntitlement` L226, `featureEntitlements.ts` `tenantHasFeature` L92 | `sessionReplay` feature |
| One-off payments (prepaid packs) | `application/billing/purchaseRegistry.ts` `ONE_OFF_SETTLERS` (already settles comms top-ups and Spawn token packs); `webhookRoutes.ts` `checkout.completed` → `oneOffSettlerFor(purchaseKind)`; `PaymentProvider.createOneTimeCheckoutSession` (L380); `verifyPaidCheckout` (`application/finance/verifiedCheckout`) | Recording packs: one more settler row, no new payment path |
| Credit balance | `ledger_entries` (denomination column; unique `(tenant_id, denomination, reference)`) | Denomination `replay_recordings`: credit on pack purchase, debit on billable units, reverse on refund |
| Usage meter | `application/consumption/meters.ts` `buildConsumptionSnapshot` (meters `ai_tokens`, `ingestion`); `GET /api/consumption`; frontend `UsageMeter.tsx` renders one card per meter | The `replay_recordings` meter: displayed == enforced |
| Free install of a listing | `listingCommerce.acquireListing` (free listings; writes `template_licenses`), `heldLicence` | Installing the capability; the licence is the entitlement |
| Listing kinds | `packages/creation-canvas-contract/src/marketplaceListings.ts` `MARKETPLACE_LISTING_KINDS` L239 (no `capability` kind yet) | The `capability` kind |
| Hosted HTML injection | `application/ide/siteAttribution.ts` `injectSiteBadge` / `withSiteBadge` (used by `siteServer.ts` and `siteStaticServe.ts`, which the sites Worker runs) | Loader injection into hosted apps |
| Hosted releases | apps DB `site_releases.version_token`, `project_sites` | `release_key` for hosted apps |
| Canvas surfaces | `lib/canvasSurfaces.ts` (`CANVAS_SURFACES` L129, `CanvasSurfaceId` L41), `lib/canvasPhases.ts` `PHASE_SURFACES` L83, `stage/CanvasSurfaceStage.tsx` L113, `canvasSurfaceIcons.tsx`, `CanvasSurfaceSwitcher.tsx` i18n `creationCanvas.surface.<id>.{label,enter,active,regionLabel}` | The `sessions` surface (labelled Visitors) |
| Canvas site facts | `useSiteAudience(projectId, days)`, `lib/siteAudienceApi.ts`, `useOperateReading` (primary app → `binding.ideProjectId`), `useCanvasSessionFacts().persistence` | Which project's recordings; numbers in the surface header |
| Brain dock side | `brainDockPreferences.ts` (`BrainDockSide`, default `right`), `canvasLens.ts` L58 can force a side | Docking the replay panel on the opposite side |
| Browser SDK build | `scripts/tsup.base.mjs` `browserSnippetConfig({entry, globalName})`; examples `browser-sdk/`, `feedback-sdk/`; `.github/workflows/release.yml` `package-npm` matrix L31–45, `npm-publish-if-new.sh` | The `replay-sdk/` package |
| CDN (new in S2) | R2 bucket `builderforce-cdn` on the custom domain `cdn.builderforce.ai`, plus a no-Worker route for `cdn.builderforce.ai/*` | `/replay/v1/loader.js`, `/replay/r/recorder.<hash>.js`, `/replay/manifest.json`, and the `embed/v1.js` that `lib/embeddedCapabilities.ts:80` already references |
| Release notes | Migration row pattern, `api/migrations/1203_release_note_spawn_free_trial.sql` (fixed id, `ON CONFLICT DO NOTHING`, `emailed_at` NULL) | S8 |
| Blog | `frontend/src/content/blog/*.md` + `<slug>.{de,es,fr,zh}.md` bodies + catalog `blog.posts.<slug>.{title,description}`; `check:blog-index` | S8 |

Facts already verified. Do not rediscover them:
- No `cdn.builderforce.ai` exists yet (S2 creates it), and the wildcard `*.builderforce.ai/*` is routed to the sites Worker. That is why the CDN needs its own no-Worker route.
- There is no `manual` payment provider. Payments are Stripe only, and an unconfigured deploy returns 503 `PaymentNotConfiguredError`.
- No add-on grants a plan feature today.
- No publishable key type exists.
- There is no `listing_releases` table (releases are `snapshots` rows).
- No admin route test exists for visitor-flow or guest-sessions. Copy the pattern from `releaseNoteRoutes.test.ts` (mock `superAdminMiddleware`).
- Admin panel tests copy the pattern from `CronPanel.test.tsx` (spy on `adminApi`, render, `findByText`; next-intl is globally mocked).

---

## 2. Slice S0 — Consolidation (no new capability; ships alone)

### S0.0 Customer #1 (PRD 33 D17) — read before any slice

D17 overrides every mention of a **platform** scope, platform row, platform-only API, superadmin-only data route or unmetered platform in this brief. Where a step below still says "platform", apply this table:

| Earlier instruction | Now |
|---|---|
| `ReplayScope = { kind:'platform' } \| { kind:'site'; … }` (S1.2) | `ReplayScope = { tenantId: number; siteId: string }`. No kind. |
| Seed a platform `replay_sites` row, `tenant_id NULL` (S1.1) | No seed. `tenant_id` is NOT NULL. The Builderforce workspace creates builderforce.ai's site through the normal install path (S3). |
| `resolveSiteForIngest` accepts `siteToken === 'platform'` (S1.3) | Only `bfr_` keys and `hosted:<siteId>`. |
| `/api/admin/replay/*` behind `superAdminMiddleware`, scope platform (S1.4) | Reads are `/api/replay/*` with membership + `requireFeature('sessionReplay')`. Admin gets `/api/admin/replay-ops/*`: aggregates only (sites, ingest volume, errors, revenue), no recordings. |
| Platform scope never metered (S1.3b, S4) | Every site is metered. The Builderforce workspace holds an audited superadmin credit grant (`ledger_entries`, reference `replay-grant:<audit id>`). |
| `identify` only on the platform site (S2, S3) | `BFReplay.identify(id, traits)` is public, honoured only when the site's `identify` setting is on. Traits feed the recording kind's Lead tab. |
| Leads = the platform's composer prompts | Leads = identified visitors and their traits. builderforce.ai sends its own traits (plan, workspace, last prompt intent) through `identify`. |
| `InsightsPanelHost` in Admin ▸ Growth ▸ Insights (S0.5) | The app home is `/apps/insights`, rendered by `/apps/[slug]` from `CAPABILITY_APPS` (data: slug → component). `InsightsHome` is unchanged. Admin keeps a link to the Builderforce workspace's app and the operations view. |
| `ReplayClientScope` platform → `/api/admin/replay` (S3) | `replayApi` takes `{ siteId }` (project scope resolves to its hosted site). |
| `GuestSessionsPanel` / `VisitorFlowPanel` merged into one admin destination (S0.5) | S0 still merges them, because they read today's `activity_log`. **S3 retires them**, once builderforce.ai's own Insights install shows the same journeys and leads (wire-or-retire: Insights is the live twin). |

The buyer's path (PRD 33 §2.6) is built in S6 (S6.5 below) and walked twice in S8: once by the Builderforce workspace (customer #1, before any buyer) and once by the paying validation workspace.


**Goal.** One Insights destination, one visitor panel, one stat tile, one overlay primitive, and one selector and zone-ranking rule. S0 lands before any replay code exists.

### S0.1 `StatTile`
- In `components/admin/adminShared.tsx`, add:
  ```ts
  export function StatTile({ label, value, hint, tone }: {
    label: string; value: string; hint?: string; tone?: 'success' | 'error' | 'warning';
  }): React.JSX.Element
  ```
  Use the markup of `VisitorFlowPanel`'s `Stat` (L147–182). It is a superset of `FunnelStat`.
- Delete `FunnelStat` (`GuestSessionsPanel.tsx:44`) and `Stat` (`VisitorFlowPanel.tsx:147`). Migrate every call site.
- Tests: `adminShared.test.tsx`, covering tone colour and hint rendering.

### S0.2 `UserDetailDrawer` → `SlideOutPanel`
- Rebuild `frontend/src/components/UserDetailDrawer.tsx` (448 lines) as a `SlideOutPanel` (`width="wide"`, `widthStorageKey="admin-user-detail"`), keeping its props: `{ user, tenants, onClose, onStartImpersonate }`.
  - If the body stays over ~400 lines, split it into `UserDetailDrawer.tsx` (panel + header actions) and `UserDetailSections.tsx`.
- Delete `.user-drawer-overlay`, `.user-drawer`, `.user-drawer__*` from `globals.css` (~L4520–4580). Grep to confirm there are no other users.
- Rename `TenantApiKeyUsageDrawer` → `TenantApiKeyUsageRow`. It is inline, not a drawer. Update its 2 importers.
- Tests: `UserDetailDrawer.test.tsx`, covering: renders inside a dialog; Esc calls `onClose`; the impersonate button calls back.

### S0.3 `packages/interaction-contract`
- Create a new source package, mirroring how `packages/creation-canvas-contract` is wired as a source package for the frontend, the API and an SDK. Its files:
  - `src/selector.ts`: `deriveSelector` and its helpers, moved verbatim from `lib/qa/telemetry.ts` L92+.
  - `src/redact.ts`: `redactInput`.
  - `src/interactions.ts`:
    - `INTERACTION_KINDS = ['click','rage','dead','quickback','excessive_scroll','scroll','error'] as const`
    - `MARK_KINDS = ['page','click','event','rage','dead','quickback','excessive_scroll','error','vital'] as const`. A `vital` mark has key `LCP|CLS|INP` and the value in `label` (D14).
    - `isRageClick(recent: ReadonlyArray<{t:number;x:number;y:number}>, opts?)`, default ≥3 in 700 ms within 30 px
    - `isDeadClickCandidate(el: Element): boolean`, true when the element is not interactive by role or tag and has no click handler hint
    - `isQuickBack(pages: ReadonlyArray<{path:string;t:number}>, opts?)`: true when the last three entries are A → B → A and B lasted under 7 s
    - `isExcessiveScroll(samples: ReadonlyArray<{t:number;y:number}>, viewportH: number, lastClickT: number | null, opts?)`: ≥3 direction reversals within 5 s, or more than 3 viewport heights within 10 s with no click
    - All thresholds live in one exported `FRUSTRATION_THRESHOLDS` object, so the recorder, the tests and the docs read the same numbers.
  - `src/filter.ts`:
    - `ReplayFilter = { all: ReplayFilterClause[] }` and `ReplayFilterClause = { field: FilterFieldId; op: FilterOp; value: string | number | boolean | [number, number] }`
    - `FILTER_FIELDS`: a registry of `{ id, ops, valueKind, scopes }`. The fields are `device`, `browser`, `os`, `country`, `referrer`, `entryPath`, `exitPath`, `visitedPath`, `clickedSelector`, `frustration` (`rage|dead|quickback|excessive_scroll|error`), `durationMs`, `activeMs`, `pageCount`, `release`, `smartEvent`, `tag` (`key=value`), `converted` (platform), `userId` (platform) and `askedForSomething` (platform).
    - `parseReplayFilter(raw: unknown): ReplayFilter | null`: hand-rolled validation that rejects unknown fields, operators and value kinds. It is capped at 12 clauses.
    - `filterToQuery(f)` / `filterFromQuery(qs)`: a URL round-trip, so a filtered view can be linked.
  - `src/smartEvents.ts`: `SmartEventRule = { name; ruleKind: 'page'|'click'|'custom'; match; matchMode }`, `BUILTIN_SMART_EVENTS: SmartEventRule[]` (sign up, purchase, add to cart, begin checkout, contact, download; matched on label words in all five locales, link targets such as `mailto:`/`tel:`/file extensions, and paths such as `/checkout`), and `markMatchesRule(mark, rule): boolean`. One matcher serves smart events, funnel steps and the `visitedPath`/`clickedSelector` filters.
    - `GRID = 50`
    - `toGridCell(x, y, docW, docH): {gx, gy}`
  - `src/release.ts`: `releaseKeyFromAssets(urls: string[]): string | null`, which keeps only URLs with a `[.-][0-9a-f]{6,}[.-]` segment, sorts them, takes the SHA-256 hex, and returns the first 12 characters. Make it async (`crypto.subtle`) and document that.
  - `src/chunk.ts`:
    - the `ReplayVisitMeta` and `ReplayChunk` types;
    - `parseReplayChunk(body: unknown): ReplayChunk | null`, a hand-rolled validator with no zod, so the browser bundle stays small;
    - `REPLAY_LIMITS = { maxChunkBytes: 512_000, maxEventsPerChunk: 5_000, flushMs: 5_000, maxMarksPerVisit: 300, maxTagsPerVisit: 20 }`.
    - `ReplayChunk` carries a `marks: ReplayMark[]` array beside the rrweb events (`{ kind, key, label?, atMs }`) and an optional `tags: Record<string,string>`. The recorder derives marks in the browser, so the server never parses rrweb events to find them.
  - `src/index.ts`, plus tests for every function. Add a jsdom test for `deriveSelector`.
- `lib/qa/telemetry.ts` imports these back. Its behaviour must not change. Keep the existing QA tests green, and add one asserting the import is the shared one.
- Register the package wherever the source-package graph guard (`check:source-package-graph`) and `check:declared-deps` require.

### S0.4 One zone-ranking rule
- New file `api/src/domain/qa/heatZones.ts`, with the pure functions:
  ```ts
  export function heatScore(count: number, lastSeen: Date, now: Date): number
  export function rankHeatZones<T extends { count: number; lastSeen: Date }>(rows: T[], now: Date, limit: number): Array<T & { score: number }>
  ```
  `heatScore` is `count × 0.97^ageDays`.
- `QaHeatmapService.rankZones` calls it. Its output must be byte-identical; prove that with the existing tests plus one new test.
- S4 uses the same function.

### S0.5 Admin ▸ Growth ▸ Insights
- `adminGroups.ts`:
  - Remove `{ id:'sessions', subKey:'sessions' }` from `users`.
  - Replace `{ id:'visitorFlow', subKey:'visitorFlow' }` in `growth` with `{ id:'visitors', subKey:'visitors', icon:'🧭' }`.
  - Add a new seam in `resolveAdminRoute`:
    ```ts
    export const LEGACY_ADMIN_SUB: Record<string, { group: string; sub: string; view?: string }>
    ```
    It maps `users/sessions` → `growth/insights?panel=issues` (platform: the Leads table is the `recording`-kind list until S4c) and `growth/visitorFlow` → `growth/insights?panel=funnel::flow`. `resolveAdminRoute` returns the resolved sub plus an optional `panel`.
  - Extend `adminGroups.test.ts` with both legacy cases and an unknown sub.
- `app/admin/page.tsx`: the `ADMIN_PANELS` key `insights` → `InsightsPanelHost` (the admin container that mounts `InsightsHome` with `{kind:'platform'}`). Remove the `sessions` and `visitorFlow` keys.
- New `components/admin/panels/InsightsPanelHost.tsx` (container, ≤120 lines):
  - Header: `AdminPanelHeader` + the 7/30/90 window buttons (keep `WINDOWS` as data) + refresh.
  - **No view switcher.** D16: the panel is ONE home screen, `InsightsHome`, that fits the viewport, plus ONE `InsightsPanel` (a `SlideOutPanel`) for every detail. Views and modes do not exist. Instead there is a registry of **panel kinds**:

    | Kind | Tabs | Registered by |
    |---|---|---|
    | `recording` | replay (S3) · journey · lead | S0 (journey, lead); S3 adds replay first |
    | `issue` | overview · recordings · fix · history | S4c (overview, recordings), S4e (fix, history) |
    | `fix` | change · prompt · measure | S4e (change, measure), S4f (prompt) |
    | `route` | — | S4f |
    | `metric` | — | S4c |
    | `funnel` | steps · clusters · flow | S0 (flow), S4c (steps, clusters) |
    | `live` | — | S5 |
    | `proof` | — | S4d |
    | `release` | — | S4e |
    | `issues` | — | S4c |

    ```ts
    export type InsightPanelKind = 'recording'|'issue'|'fix'|'route'|'metric'|'funnel'|'live'|'proof'|'release'|'issues';
    export type InsightPanelLevel = { kind: InsightPanelKind; id: string; tab?: string };
    export const INSIGHT_PANEL_KINDS: ReadonlyArray<{ kind: InsightPanelKind; labelKey: string; scopes: ReadonlyArray<'platform'|'site'>; tabs: ReadonlyArray<{ id: string; labelKey: string; Component: React.ComponentType<{ scope: ReplayScope; id: string; filter: ReplayFilter; push: (level: InsightPanelLevel) => void }> }> }>
    ```
    `InsightsPanel` owns the stack (`levels: InsightPanelLevel[]`), renders the breadcrumb from it, and reads `?panel=<kind>:<id>[:<tab>]` on mount. A slice registers a kind or a tab row: never a route, never a second overlay. The registry lives in `components/insights/panelKinds.ts`, so the canvas surface (S7) renders the same kinds filtered to `scopes` including `'site'`, docked on the opposite side.
    In S0 the home shows the funnel band and the Leads table (platform) in the Issues column's place until S4c lands the issues table; `recording` (journey, lead) and `funnel` (flow) are the registered kinds. The home's bands are components in `components/insights/` (`GoalBar`, `KpiTiles`, `FunnelBand`, `IssuesTable`, `PageStage`, `DoNext`, `ScoreStrip`), each ≤150 lines, each taking `{ scope, filter, days }` and calling the panel through `usePanel().push`.
- New `components/admin/visitors/FlowView.tsx`: the body of today's `VisitorFlowPanel` (headline `StatTile`s + `VisitorFlowGraph` + visitor-id lookup).
- New `components/admin/visitors/LeadsView.tsx`: the table and funnel of today's `GuestSessionsPanel`, without its drawer.
- New `components/visitors/RecordingPanel.tsx`: the ONE visitor panel, replacing both `VisitorJourneyDrawer` and `GuestSessionsPanel`'s drawer.
  ```ts
  export function RecordingPanel({ visitorId, visitId, initialTab, onClose }: {
    visitorId: string | null; visitId?: string | null; initialTab?: RecordingPanelTabId; onClose: () => void;
  }): React.JSX.Element | null   // null when visitorId is null
  ```
  - It is a `SlideOutPanel` with `width="wide"`, `widthStorageKey="insights-panel"`, `crumb` = Growth · Insights and `accentVar` = the growth seat variable.
  - Tabs come from the registry `VISITOR_PANEL_TABS` (`journey`, `lead`; S3 adds `replay` as the first entry).
  - Header actions: copy lead (the existing `GuestSessionCopyButton`) and message visitor (the existing `BroadcastComposer`).
- New `components/visitors/VisitorJourneyTimeline.tsx`: the body of `VisitorJourneyDrawer` (owns its fetch through `adminApi.visitorJourney`). Each visit gets a "Watch this visit" action, rendered only when an `onWatchVisit` prop is given; S3 gives it.
- New `components/visitors/VisitorLeadDetail.tsx`: the body of `GuestSessionsPanel`'s drawer: stat tiles, detail rows and prompt history. It adds the erase action:
  - a button that `useConfirm`s, then calls `adminApi.forgetGuestPrompts(visitorId)`;
  - it closes the panel and reloads the leads.
  - This wires the dead seam.
- Delete `VisitorJourneyDrawer.tsx`, `VisitorFlowPanel.tsx` and `GuestSessionsPanel.tsx`. Grep for zero references, and move any helper still used.
- i18n:
  - Reuse the existing `admin.visitorFlow.*` and guest-session keys by moving them under `admin.insights.*` in all five catalogs.
  - Delete the keys that are no longer used.
  - Add `admin.sub.visitors`.
- Tests:
  - `InsightsHome.test.tsx`: the home renders every band; `?panel=funnel::flow` opens the panel on the flow tab; the Leads table renders with mocked `adminApi`; nothing on the home overflows a 1440×900 container (assert `scrollHeight <= clientHeight` on the root in jsdom with explicit heights).
  - `InsightsPanel.test.tsx`: push adds a level and a crumb, crumb click pops, close clears, Esc closes; a kind absent for the scope is never rendered.
  - `RecordingPanel.test.tsx`: null id renders nothing; the tabs from the registry; Esc closes; the erase action confirms, then calls `forgetGuestPrompts`.
  - `adminGroups.test.ts`: the legacy aliases.

**S0 is done when** all of these hold:
- Admin shows Growth ▸ Visitors with Flow and Leads.
- The old URLs land on the right view.
- One panel opens for a visitor from either view.
- `FunnelStat`, `Stat`, `.user-drawer` and the three deleted files have zero references.
- QA telemetry imports the shared selector.
- §11 S0 and §12 S0 pass.

---

## 3. Slice S1 — Data plane (API)

### S1.0 Scale amendments (PRD 33 D15 and §3.3) — read before S1.1

D15 changes S1, S2, S4 and S4c. Where this block and a later step disagree, this block wins; the auditor checks it first.
- **Bindings (wrangler, API Worker):** an `analytics_engine_datasets` binding `REPLAY_EVENTS` (dataset `replay_events`) and a Pipelines binding `REPLAY_LAKE` whose sink is the R2 Data Catalog table `replay_events` (partition `site_id`, `day`). The operator creates the pipeline and the catalog table once; the brief lists the exact commands in the runbook.
- **Contracts (`interaction-contract`):** `routeTemplate(path, learned?)` (numeric, uuid, hex and long-token segments become `:id`; per-site learned templates win) and `issueFingerprint({siteId, routeTemplate, kind, subject})`. Both are pure, both have unit tests, and the recorder, ingest and rules import them.
- **Recorder (S2):** buffer mode. `keepRate` comes from the config response. Events stream always; rrweb chunks stream only when kept (head sample or trigger, PRD §3.3). `BFReplay.keep()` is public.
- **Ingest (S1.3, replaces steps 7, 7b and 9):** for every chunk, write each event as one `REPLAY_EVENTS.writeDataPoint` (≤250 per invocation; overflow goes to the lake only) and send the chunk's events to `REPLAY_LAKE`. Only for kept recordings: store the chunk, fold `replay_recordings`, and append to `marks.json`. `replay_visit_marks`, `replay_visit_tags`, `replay_interactions_daily` and `replay_page_vitals_daily` are **not created**.
- **Migrations (S1.1, transactional):** `replay_recordings` (the §3.1 visit columns plus `keep_reason`, `sample_weight`), `replay_releases`, `replay_issues`, `replay_issue_daily`, `replay_issue_representatives`, `replay_route_daily`, `replay_visit_summaries` (keyed by recording).
- **Reads:** `ReplayMetricsService` (Analytics Engine SQL API through `getOrSetCached`), `ReplayLakeService` (R2 SQL, 5-minute cache, 10-second timeout, row cap), and `ReplayReadService` for the small tables. A route never queries a store directly.
- **Nightly rollup (`replayRollup.ts`, cron):** lake → `replay_route_daily`, `replay_issue_daily`, `replay_issues` (new fingerprints, status `new`), regression detection, and behaviour clustering → `replay_issue_representatives`. It is idempotent per site and day.
- **Load test (S1 done-when):** a synthetic site at 10 million sessions a month (≈330k a day, 40 events each) through ingest for one hour on staging, then the home view warm under 1 s at p95 and cold under 4 s, and the transactional database growth under 50 MB for the simulated month.

### S1.1 Migrations
- **Core** (`api/migrations/`, the next free number; `check:migrations` fails on duplicates, so re-check just before committing): `replay_sites`, exactly as PRD 33 §3.1. Add the Drizzle schema in `schema/growth.ts`.
  - Seed the platform row as a fixed uuid: `kind='platform'`, `tenant_id NULL`, `label 'builderforce.ai'`, `settings {"maskAllInputs":true,"maskAllText":false,"consentRequired":true,"sampleRate":1}`.
  - Insert with `ON CONFLICT DO NOTHING`.
- **Core**, same migration: `replay_segments`, `replay_smart_events`, `replay_funnels`, `replay_funnel_steps` (PRD 33 §3.1). S4c is their only reader and writer, but the tables land here so that one migration owns the replay core schema.
- **Transactional** (`0014_replay.sql`): `replay_visits` (including `quickback_count`, `excessive_scroll_count`, `active_ms`), `replay_releases`, `replay_interactions_daily`, `replay_visit_marks`, `replay_visit_tags` and `replay_visit_summaries`, as in PRD 33 §3.1, with their indexes. Add the Drizzle schema in the module where the run-telemetry tables live (`schema/agents.ts` ~L2035 documents the transactional ones). Follow that file's comment convention.
- Update the schema-drift guard inputs as required (`check:schema`).

### S1.2 Domain (`api/src/domain/replay/`)
- `replayScope.ts`:
  ```ts
  export type ReplayScope = { tenantId: number; siteId: string };   // D17: no platform scope
  export function scopeWhere(scope): { tenantId: number | null; siteId?: string }
  ```
- `interactionAggregate.ts`:
  ```ts
  export function aggregateInteractions(chunk: ReplayChunk, meta): InteractionCell[]
  ```
  A pure fold from chunk events to the daily cells `(path, device, kind, selector, label, gx, gy) → n`.
- `visitSummary.ts`:
  ```ts
  export function foldVisit(prev: VisitRow | null, chunk: ReplayChunk, now: Date): VisitRow
  ```
  It updates counts (including quick backs and excessive scrolls, counted from the chunk's marks), paths, `active_ms`, `last_event_at` and the end marker.
- `visitMarks.ts`:
  ```ts
  export function marksToInsert(existingCount: number, chunk: ReplayChunk): ReplayMark[]
  ```
  It assigns `ord` after the existing count and applies `maxMarksPerVisit`, dropping plain clicks first.

### S1.3 Application (`api/src/application/replay/`)
- `replayCacheKeys.ts`. All keys carry `replayVersionKey(siteId)`.
- `replayChunkStore.ts` (an R2 port):
  - `putChunk(env, {scopeKey, siteId, day, visitId, seq, gz: Uint8Array})`
  - `listChunks(env, …)`
  - `getChunk(env, key)`
  - `deleteVisit(env, …)`
  - `deletePrefixOlderThan(env, cutoff)`

  Key format: `replay/<platform|t{tenantId}>/<siteId>/<YYYY-MM-DD>/<visitId>/<seq 6-digit>.ndjson.gz`.
- `replaySites.ts`:
  - `resolveSiteForIngest(env, db, siteToken, origin)`, cached by key hash, 5 min.
    - (D17) There is no platform token. builderforce.ai sends its own `bfr_` key like any site.
    - Otherwise: hash the `bfr_` key, find the `tenant_api_keys` row with scope `replay:ingest` that is not revoked, check `originAllowed`, then load the `replay_sites` row by `api_key_id`.
  - `getSite`, `listSitesForTenant`, `updateSiteSettings`.
- `ReplayConfigService.ts`:
  ```ts
  config(env, db, siteToken, origin): Promise<ReplayClientConfig | null>
  ```
  - Returns `{ enabled, recorderUrl, recorderVersion, sampleRate, maskAllInputs, maskAllText, consentRequired, releaseHint? }`.
  - `recorderUrl` comes from the platform pin (a superadmin setting), else the site's channel, else `REPLAY_RECORDER_LATEST`, an env var the frontend build writes into a manifest the API reads. Simplest: the manifest is fetched once from `https://builderforce.ai/replay/manifest.json` and cached for 10 min.
  - `enabled` is false when the site is disabled, the tenant is not entitled (S6), or the monthly cap is reached.
- `ReplayIngestService.ts`:
  ```ts
  ingest(env, db, txDb, {siteToken, origin, ip, country, body: Uint8Array /* gzip */}): Promise<{accepted: boolean}>
  ```
  The steps run in this order:
  1. Resolve the site.
  2. Check the IP budget (copy `withinIpBudget`; prefix `replay:ingest:ip:`; limit `REPLAY_IP_DAILY_CHUNKS = 3000`).
  3. Check the size: reject chunks over `REPLAY_LIMITS.maxChunkBytes`.
  4. Gunzip and run `parseReplayChunk`.
  5. Check the usage allowance through `replayUsage.ts` (S1.3b). It applies only when a chunk would create a NEW visit or push a visit into a further 2 MB unit. If the allowance and credits are spent, it drops new visits and keeps recording visits already in progress. The platform scope is never metered.
  6. Store the chunk.
  7. `foldVisit` and upsert `replay_visits` (txDb).
  7b. Insert the chunk's marks (`marksToInsert`) and upsert its tags, in one batched statement each, through `replayMarkStore.ts`.
  8. Upsert the release (first seen / last seen).
  9. Run `aggregateInteractions` into the interaction buffer.
  10. Bump the version at most once per 60 s per site, gated by a KV timestamp.

  Never throw to the route; log through `reportCaughtError`.
- `replayUsage.ts` (S1.3b; the ONE place usage is computed). Functions:
  - `billableUnits(bytes): number`: `max(1, ceil(bytes / 2_097_152))`, pure, in `domain/replay/billing.ts`.
  - `usageThisMonth(env, txDb, tenantId)`: sums `billable_units` for visits started this month, cached 60 s with version-token invalidation on visit creation.
  - `freeAllowance(env, db, tenantId)`: `REPLAY_FREE_MONTHLY_UNITS = 5000`, unless `tenants.settings.replayFreeAllowanceOverride` is set (superadmin-only, used by the live validation).
  - `creditBalance(env, db, tenantId)`: the `ledger_entries` balance in denomination `replay_recordings`.
  - `canStartVisit(...)` / `chargeUnits(env, db, tenantId, visitId, units)`: units beyond the free allowance are debited from the ledger. The reference is `replay-use:${visitId}:${unitIndex}`, so a retried chunk can never double-charge.

  The debit is batched: one ledger row per visit per unit crossing, written through `ctx.waitUntil`.
- Register a `replay_recordings` meter in `application/consumption/meters.ts`, with unit `recordings`, `used` = units this month, and `limit` = free allowance + credit balance. `UsageMeter.tsx` then renders it with no frontend work beyond the i18n label (`usageMeter.replay_recordings` ×5).
- `interactionBuffer.ts`: the `siteTraffic.ts` pattern. It buffers cells per isolate and flushes an additive `INSERT … ON CONFLICT DO UPDATE SET n = n + EXCLUDED.n` through `ctx.waitUntil`. Reuse the shape; do not reuse the module.
- `ReplayReadService.ts` takes a scope on every method, and every method is cached:
  - `listVisits(scope, {days, filter?: ReplayFilter, cursor})`: bounded page of 50 with a cursor. In S1, `compileReplayFilter` (in `application/replay/replayFilterCompiler.ts`) supports the visit-column fields. S4c adds the mark, tag and smart-event fields to the same compiler. Platform rows are left-joined in application to `marketing_sessions.converted` and prompt presence by `visitor_id`. That is two batched queries, never N+1.
  - `getVisit(scope, visitId)`: meta plus the ordered chunk keys.
  - `streamChunks(scope, visitId, fromSeq)`: returns the NDJSON text. It is not cached (immutable R2 objects are fine), and it uses `Cache-Control: private, max-age=31536000, immutable` per chunk URL.
  - `releases(scope)`.
  - `renameRelease(scope, key, label)`.
- `visitorDataErasers.ts`:
  ```ts
  export interface VisitorDataEraser { id: string; erase(env, db, visitorId): Promise<number> }
  export const VISITOR_DATA_ERASERS: VisitorDataEraser[]
  ```
  It has three entries: prompts, journey (existing) and replay (deletes `replay_visits` rows plus their R2 chunks). `GuestPromptService.forgetVisitor` is refactored to run the registry, so the route and audit stay as they are. Return `{erased, byEraser}`.
- `retentionPurge.ts`: register `replay_visits`, `replay_visit_marks`, `replay_visit_tags`, `replay_visit_summaries` (with their visit), `replay_releases` (rows with no visits) and `replay_interactions_daily` per D3, plus `deletePrefixOlderThan` for R2. The replay eraser deletes marks, tags and summaries with the visit.

### S1.4 Presentation
- `presentation/routes/replayIngestRoutes.ts`, mounted at `/api/replay-ingest`. Add the prefix to `PUBLIC_INGEST_PREFIXES`.
  - `GET /v1/config?site=…` returns `ReplayClientConfig`, or `{enabled:false}`.
  - `POST /v1/chunks?site=…` takes a gzip body and always answers 202 `{ok:true}`.
- `presentation/routes/replayRoutes.ts`, mounted at `/api/replay` with membership + `requireFeature('sessionReplay')`; the site comes from `?site=` and must belong to the caller's workspace (D17). `replayOpsRoutes.ts` at `/api/admin/replay-ops` (superadmin) returns aggregates only.
  - `GET /visits`
  - `GET /visits/:visitId`: writes the `REPLAY_VIEWED` audit (metadata visitId, visitorId).
  - `GET /visits/:visitId/chunks/:seq`
  - `GET /releases`
  - `PATCH /releases/:key`: writes the `REPLAY_RELEASE_RENAMED` audit.
  - Later slices add heatmap, elements and live.
- Tests (vitest, `vi.hoisted` + fake db, as in `qualityIngestRoutes.productReport.test.ts`):
  - `replayIngestRoutes.test.ts`: a bad key gives 202 with nothing written; a wrong origin gives nothing written; an oversize chunk is dropped; a valid chunk writes R2, upserts the visit and buffers cells; an exhausted allowance stops new visits but continues an existing one.
  - `replayUsage.test.ts`: free allowance first, then credits; the 2 MB unit boundary; a retried chunk does not double-debit (same ledger reference); the platform scope is never metered; the override is honoured.
  - `replayAdminRoutes.test.ts`: superadmin only (mock the middleware); the viewed audit is written once per GET of a visit.
  - Domain tests for `foldVisit`, `aggregateInteractions` and `marksToInsert` (the cap drops plain clicks first; `ord` continues across chunks).
  - In `replayIngestRoutes.test.ts`, a chunk with marks and tags writes both, and the 21st tag is ignored.
  - `visitorDataErasers.test.ts`: all three erasers run, and the counts are summed.
  - `replaySites.test.ts`: platform origin rule; a key without `replay:ingest` is rejected.
- **Security test (required):** a `bfr_` key used as a Bearer token on any other API route is rejected. Locate the API-key auth path that reads `scopes`, add `replay:ingest` to `TENANT_API_SCOPES`, and assert that a key whose only scope is `replay:ingest` is refused by a normal authenticated route such as `GET /api/projects`.

**S1 is done when** the ingest → R2 → visit row → aggregates path works in tests end to end, every read is cached and scoped, the erase path covers replay, retention is registered, and §11/§12 S1 pass.

---

## 4. Slice S2 — Recorder package (parallel with S0/S1)

### S2.1 `replay-sdk/` (new package, modelled on `browser-sdk/`)
- `package.json`:
  - name `@seanhogg/builderforce-replay`, global `BuilderforceReplay`, version `2026.10.x`;
  - `files: ["dist"]`, `unpkg`/`jsdelivr: dist/index.global.js`;
  - scripts `build` (tsup), `type-check`, `test`, `size`;
  - dependencies: `rrweb` pinned to an exact version (D1) and `@builderforce/interaction-contract` (workspace source).
- `src/loader.ts` builds to `dist/loader.global.js`. It is ≤ **2 KB gzip**, enforced by `size.test.ts`, and must:
  - Read `document.currentScript.dataset` (`site`, `release?`).
  - Respect DNT/GPC (`navigator.doNotTrack === '1' || navigator.globalPrivacyControl`): return without loading.
  - `fetch(config)` with `credentials:'omit'`. If `!enabled`, return.
  - Pick a sample with `Math.random() < sampleRate`.
  - If `consentRequired`, wait for `window.BFReplay.consent(true)` (a queued global stub).
  - Inject a `<script async src=recorderUrl>` and hand it `{config, site, releaseHint}` through `window.__bfReplay`.
- `src/recorder.ts` builds to the hashed `dist/recorder.<hash>.js`. It must:
  - Set the visitor and visit ids. On builderforce.ai, reuse `bf_visitor_id` / `bf_visit_id` by reading the same storage keys, with the same 30-min idle rule. Elsewhere, mint the same shape under `bfr_visitor_id` / `bfr_visit_id` in first-party storage. Import nothing from the frontend; duplicate only the 10-line id rule, and add a contract test that pins both implementations to the same constants (exported from `interaction-contract`: `VISIT_IDLE_MS`, id format regex).
  - Compute the release key per PRD 33 §3.3.
  - Run `rrweb.record` with:
    - `maskAllInputs: true` (always);
    - `maskTextSelector` (`maskAllText` ? `'*'` : `'[data-bf-mask]'`);
    - `blockSelector: '[data-bf-block]'`;
    - password and `autocomplete=cc-*` fields never captured;
    - `sampling: { mousemove: 50, scroll: 150, input: 'last' }`;
    - `recordCanvas` on when `config.recordCanvas` is true (D10), with `sampling.canvas: 2` and `dataURLOptions: { type: 'image/jpeg', quality: 0.4 }`;
  - the `[data-bf-mask]` / `[data-bf-block]` attributes are honoured for every scope.
  - Capture interactions: capture-phase click → `deriveSelector`, `toGridCell`, rage detection (`isRageClick`), dead-click detection (candidate plus no navigation/DOM mutation within 500 ms, through a short-lived `MutationObserver`); scroll depth max per path.
  - Detect quick backs (`isQuickBack` over the SPA and full-page path history) and excessive scrolling (`isExcessiveScroll` over sampled scroll positions).
  - Capture JS errors on every scope through `error` and `unhandledrejection` listeners. The message is truncated to 120 characters and fingerprinted (the first stack frame plus the message without digits). On builderforce.ai the quality stream stays the source of truth (§1), so the recorder only marks the moment there.
  - Emit a `marks` entry for each page change, click, frustration signal, error and custom event, and track `active_ms`.
  - Report field Web Vitals per page (LCP, CLS, INP via `PerformanceObserver`, about 1 KB of code, no dependency) as one `vital` mark per metric at `pagehide`. The ingest fold aggregates them into `replay_page_vitals_daily` (PRD 33 §3.1, D14).
  - Batch with `REPLAY_LIMITS`: flush every 5 s while visible, and on `pagehide`/`visibilitychange` via `fetch(…, {keepalive:true})`. Gzip with `CompressionStream` and fall back to uncompressed with a header.
  - Self-disable on any thrown error, and report it once through `console.warn` only. Never break the host page.
  - Public API: `window.BFReplay = { consent(granted:boolean), event(name:string), tag(key:string, value:string), stop(), version }`, plus `identify(id, traits)`, honoured only when the site's identify setting is on (D17).
    - `event(name)` adds an `event` mark. Names are limited to 80 characters and `[\w .:-]`.
    - `tag(key, value)` sets a visit tag, at most `maxTagsPerVisit`. Values are limited to 200 characters. A value that looks like an email or a card number is refused, and a `console.warn` names the tag.
    - Calls made before the recorder loads are queued by the loader's stub and replayed in order.
- `src/npm.ts` is the npm entry: `export function startReplay({ site, release? })`. It injects the loader tag, so the npm path also self-updates.
- Build:
  - `tsup` through `browserSnippetConfig` for `index` (npm), plus separate IIFE entries for loader and recorder with content hashing.
  - A script `replay-sdk/scripts/emit-assets.mjs` writes the CDN layout under `dist/assets/`:
    - `replay/v1/loader.js`
    - `replay/r/recorder.<hash>.js`
    - `replay/manifest.json`: `{ latest: { version, url: "https://cdn.builderforce.ai/replay/r/recorder.<hash>.js", hash, builtAt } }`

    The loader's config URL (`https://api.builderforce.ai/api/replay-ingest/v1/config`) is a build-time constant, overridable by `data-api` for local dev.
- Tests (vitest + jsdom): loader DNT/GPC/sampling/consent; release-key priority; rage/dead/quick-back/excessive-scroll detection; error capture and fingerprint; `event`/`tag` queued before load and replayed; the tag refusal for email- and card-shaped values; batching and flush on pagehide; masking config passed to rrweb (mock rrweb); size budgets (loader ≤2 KB gz, recorder ≤80 KB gz including rrweb record).

### S2.2 The CDN: `cdn.builderforce.ai` (D5)
- **Infrastructure as code.** New file `infra/cdn/README.md` plus `.github/scripts/cdn-ensure.sh`. The script is idempotent and runs with the deploy job's `CLOUDFLARE_API_TOKEN` (the existing secret; it needs R2 + DNS + Workers Routes edit, so add those permissions if they are missing):
  1. `wrangler r2 bucket create builderforce-cdn` if absent.
  2. `wrangler r2 bucket domain add builderforce-cdn --domain cdn.builderforce.ai --zone-id $CLOUDFLARE_ZONE_ID` if absent.
  3. A Workers **route with no Worker** for `cdn.builderforce.ai/*`, created through the Cloudflare API (`POST /zones/:zone/workers/routes` with `{ pattern, script: null }`). This stops the `*.builderforce.ai/*` sites route from capturing the CDN host.
  4. Set the CORS policy on the bucket (`wrangler r2 bucket cors set`): GET from `*`.
- **Publishing.** New file `.github/scripts/cdn-publish.sh <dir>` uploads `replay-sdk/dist/assets/**` with `wrangler r2 object put --cache-control …` per path class:

  | Path | Cache-Control |
  |---|---|
  | `replay/v1/loader.js` | `public, max-age=300` |
  | `replay/r/*` | `public, max-age=31536000, immutable` |
  | `replay/manifest.json` | `public, max-age=60` |

  Content types are set explicitly. Hashed files are uploaded first and the manifest LAST, so a manifest never points at a missing file.
- **Workflow.** A new `publish-cdn` job in `release.yml` runs after `package-npm` and before `deploy-api`. It runs `cdn-ensure.sh`, then `npm --prefix replay-sdk run build`, then `cdn-publish.sh`. Add `replay-sdk` to the `package-npm` matrix as well (the npm entry).
- **The broken embed reference.** `lib/embeddedCapabilities.ts:80` `unifiedEmbedSnippet()` already emits `https://cdn.builderforce.ai/embed/v1.js`, and nothing serves it.
  - Find which bundle that snippet means (grep `embed/v1`, `unifiedEmbedSnippet` callers, `studio-embedded`).
  - If a built global bundle exists, publish it at that path from the same job.
  - If none exists, change the snippet to the bundle that does exist. Report which you did; leaving a URL that 404s is not an option.
- **API config.** `ReplayConfigService` reads `https://cdn.builderforce.ai/replay/manifest.json` (cached 10 min) to learn the latest recorder.
- **Kill check after deploy.** `curl -sI https://cdn.builderforce.ai/replay/v1/loader.js` should return 200, `cache-control: public, max-age=300`, a `cf-cache-status` header and NO `cf-worker` header. A second request should show `HIT`.
- **Blocked on the operator only if** the CI token lacks R2/DNS/Routes permissions. In that case the script fails with the missing permission named, and the planning session asks the operator to extend the token.

**S2 is done when** all of these hold:
- the package builds and the size budgets hold;
- `cdn-ensure.sh` and `cdn-publish.sh` work, proven against a dry-run flag that prints the wrangler calls;
- the `embed/v1.js` reference is resolved;
- §11/§12 S2 pass.

The live CDN kill check runs at the first deploy (S8 step 1).

---

## 5. Slice S3 — Dogfood on builderforce.ai (Recordings + Replay)

- `frontend/src/components/ReplayLoader.tsx` (client), mounted in `app/layout.tsx` next to `<VisitorJourneyTracker />`:
  - Renders `<script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="platform" data-release={APP_VERSION}>` for **every** visitor, signed in or out (D9), once auth is ready.
    - Signed-in recording is additionally gated by the platform setting `replay.recordSignedIn`, read from the existing platform settings store (locate it; do not add a new one). It defaults to `false` until the legal disclosure is published.
    - A workspace with `tenants.settings.replayExcluded` is never recorded while the user is in it.
  - On sign-in or sign-out, call `window.BFReplay.identify({ userId, tenantId })` / `BFReplay.identify(null)`. This is a platform-only API: the recorder accepts it only when `site === 'platform'`, and it sends a `identity` meta event so the server sets `replay_visits.user_id` / `seen_tenant_id`. The visit continues across sign-in.
  - The PRD's non-goal "no identify" applies to buyer sites only. Update PRD §6 wording if this reads ambiguously.
  - `BFReplay.consent(true)` is called when the existing `CookieConsentManager` grants analytics. Locate its consent signal and subscribe to it; do not create a second consent store.
  - Has no `'use client'` beyond the boundary rule (`check:use-client-boundaries`).
- **Sensitive regions (D9 privacy floor).** Add `data-bf-block` (never recorded) or `data-bf-mask` (text replaced) to the ROOT element of these components. Locate each by grep; this is attribute-only, with no logic change:

  | Area | Attribute |
  |---|---|
  | API key list and reveal (`settings/ApiKeysContent.tsx`, `TenantApiKeysAdminTab.tsx`) | block |
  | Provider/BYO key forms | block |
  | Connected-account token fields | block |
  | Billing and card forms | block |
  | Brain composer input area | mask, beyond the input masking that already applies |
  | Secrets and env editors | block |

  Add a test that asserts each listed component's root carries its attribute, so a refactor cannot silently drop it.
- **Legal disclosure draft.** Draft the new Privacy Policy and Terms paragraphs (session recording: what is captured, masking, retention, purpose, opt-out via the cookie banner), and add them as a DRAFT version through the existing legal document versioning (Admin ▸ Compliance ▸ Legal, `LegalEditorDrawer`). Do not publish; publishing is the operator's.
- **The user's recordings in Admin.** The S0.2 `UserDetailDrawer` gets a "Recordings" section. It is `RecordingsList` with `{kind:'platform'}` and a `userId` filter, and it reuses the component unchanged except for one more filter in its filter registry.
- `frontend/src/lib/replayApi.ts` is a typed client. It must:
  - take `scope: ReplayClientScope = { kind:'platform' } | { kind:'project'; projectId: number }`;
  - map platform scope to `/api/admin/replay/*` (auth `'web'`) and project scope to `/api/projects/:id/replay/*` (S7);
  - export types `ReplayVisitSummary`, `ReplayVisit`, `ReplayRelease`, …
- `components/replay/RecordingsList.tsx` (owns its fetch; `{ scope, days, onOpen(visit) }`):
  - A sortable table (`useTableSort` / `SortableTh`) with columns visitor/where, asked-for (platform only, clamped to 2 lines), release, pages, length, signals.
  - Filter chips (asked for something, rage, error, registered, release, path). They are the first `FILTER_FIELDS` entries, sent to the server as a `ReplayFilter`. S4c replaces the chips with the full filter bar without changing this component's props.
  - Cursor paging; empty and error states.
  - It must work for both scopes with zero edits. The platform-only column is declared in the column registry with `scopes: ['platform']`.
- `components/replay/ReplayPlayer.tsx` (≤300 lines) + `useReplayPlayback.ts` + `ReplayTimeline.tsx` + `ReplayEventList.tsx`:
  - Load chunks sequentially through `replayApi`, and lazy-load `rrweb`'s Replayer with `next/dynamic` / `import()` so the admin chunk does not carry it.
  - Controls:
    - play/pause, a real range scrubber and speed (1/2/4/8×);
    - skip inactivity (on by default);
    - overlays: cursor trail, clicks, heatmap (S4), inspect element (highlight the last interaction's target from its selector).
  - Timeline markers (buttons with `aria-label`) come from the visit's marks (`GET /visits/:visitId` returns them): clicks, rage, dead, quick back, excessive scroll, custom events and errors, each with its own icon and label. Platform errors are the visitor `error` rows for this `visit_id`, read from the journey.
  - The event list is clickable and seeks the player.
  - The header shows the release chip (`UI <release_key> · API <api version at that time if known>`), device, location, referrer and duration.
  - "Link at <time>" copies `?visit=<id>&t=<s>`. On `InsightsPanelHost` mount, the URL opens the panel at that time.
  - "Ticket from this moment" opens the existing task-creation flow with the prefilled title "Replay: <event label> at <time>" and a body linking the replay URL. Locate the existing create-task `SlideOutPanel` or client; do not build a new one. If none fits without growth, log it and render a copy-to-clipboard of the link instead.
- `RecordingPanel`: add `{ id:'replay', … }` as the first row of `VISITOR_PANEL_TABS`. Its content is `ReplayPlayer`. `VisitorJourneyTimeline` gets `onWatchVisit`, which switches to the replay tab for that visit.
- Register the `replay` tab as the first tab of the `recording` panel kind, and the `recordings` tab of the `issue` kind (`RecordingsList`, cursor-paginated). The `recording` kind IS the old `RecordingPanel`; rename it `RecordingPanel` and keep its props.
- Tests:
  - `RecordingsList.test.tsx`: renders rows; the platform-only column is hidden in project scope; filters update the query.
  - `ReplayPlayer.test.tsx`: mock rrweb; play/pause/seek; markers seek; inspect highlight follows the last interaction.
  - `ReplayLoader.test.tsx`: not rendered for signed-in users; consent wiring.
  - Extend `RecordingPanel.test.tsx` with the replay tab first and the journey watch action switching tabs.

**S3 is done when** the Builderforce workspace has installed Insights through the public path (S0.0), builderforce.ai carries its `bfr_` snippet, and a local anonymous visit produces a recording that a member of the Builderforce workspace can replay in `/apps/insights`, with the release chip, markers and audit row present, and §11/§12 S3 pass.

---

## 6. Slice S4 — Heatmaps, element tracking, release compare

- API `application/replay/ReplayHeatmapService.ts` (cached; version-token keys):
  - `grid(scope, {path, release, device, kind, days}) → {cells: {gx,gy,n}[], total}`
  - `elements(scope, {path, release, compareRelease?, device, days}) → rows {selector, label, clicks, rage, dead, delta}`, ranked with `rankHeatZones` from S0.4
  - `scrollDepth(scope, {path, release, device, days}) → deciles[]`
  - `paths(scope, {days}) → [{path, visits}]`
- Routes go on `replayAdminRoutes.ts`: `GET /heatmap/grid`, `/heatmap/elements`, `/heatmap/scroll`, `/heatmap/paths`.
- Frontend `components/replay/HeatmapView.tsx` (container), with:
  - `HeatmapOverlay.tsx` (canvas over a page snapshot);
  - `ElementTable.tsx`;
  - `ReleaseCompare.tsx` (single / side-by-side / difference);
  - `HeatmapInsights.tsx`.
- The page background is the first full snapshot of the most recent visit on that path/release/device, rebuilt with rrweb's snapshot rebuild in a sandboxed iframe (`sandbox="allow-same-origin"`, no scripts). The overlay draws the 50×50 grid with a colour ramp from tokens plus a cold/hot text legend.
- Insights are rules as data (`HEATMAP_INSIGHT_RULES`), not hand-written text. For example:
  - rage clicks up >3× vs the compare release;
  - dead clicks over a threshold on non-interactive text;
  - an element with the most clicks below the 50% scroll decile.

  Each insight has an action: "Watch replays" (filters Recordings) or "Create ticket".
- Register the `heatmap` **mode** on the Replays view (not a new view). Switching between Recordings and Heatmap keeps the selected path, release and filter. From the heatmap, clicking an element filters Recordings to the visits that clicked it. The ReplayPlayer heatmap overlay toggle now uses `grid` for the current path.
- Tests:
  - service tests for the grid fold, the elements delta and rank reuse (assert it imports `rankHeatZones`);
  - `HeatmapView.test.tsx`: mode switch, compare modes, an element row highlights its zone;
  - `HeatmapInsights.test.ts`: the rules fire on fixtures.

### S4b. Export as video (MP4) — D10
- **API.** `application/replay/replayVideoExport.ts`:
  - `requestExport(scope, visitId, userId)` creates an export job. The job uses the existing job/queue primitive the render or QA paths use: locate the one `MediaRenderContainerDO` / QA runner uses for "run on agent host or GitHub Actions". Do not create a new queue.
  - Debit `REPLAY_EXPORT_UNITS = 10` units through `replayUsage.chargeUnits` (reference `replay-export:${jobId}`). Platform scope is free.
  - `exportStatus(scope, jobId)`, cached 5 s.
  - On completion the MP4 is at R2 `replay-exports/<scope>/<jobId>.mp4`, served through a signed, short-lived URL.
- **Worker script.** `replay-sdk/export/render.mjs`, a Node + Playwright script run by the job:
  1. Open a static page that embeds the rrweb Replayer.
  2. Load the visit's chunks through a short-lived signed URL list.
  3. Play at 1× with idle skipped.
  4. Record with Playwright `recordVideo` at the visit's viewport size.
  5. Transcode WebM → MP4 with ffmpeg where available (else keep WebM and say so in the status).
  6. Upload the result.
- **Where it runs.** On the tenant's agent host when one is online, else in the platform's GitHub Actions (the PRD's $0 compute paths). If neither is available, the export reports `unavailable` honestly rather than queueing forever.
- **UI.** `ReplayPlayer` header gains "Export as video", which shows progress, then a download link. Strings go in `replay.export.*` ×5.
- **Tests:** `replayVideoExport.test.ts` (units debited once; platform free; status transitions; unavailable when no runner); `render.mjs` gets a smoke test that renders a 2-second fixture in CI only where Playwright is installed (skip otherwise, and say so).

---

## 6c. Slice S4c — Analysis parity (PRD 33 D11 and §2.1)

**Goal.** Every web analysis feature Microsoft Clarity offers works on both scopes. S4c runs after the S3 audit, in parallel with S4 and S5. It reads only what S1 and S2 already capture (visit columns, marks, tags, daily aggregates). If it finds a missing signal, it stops and reports to the planning session rather than adding capture.

### S4c.1 Filter bar and saved segments
- **API.**
  - `application/replay/replayFilterCompiler.ts` (started in S1) gains the mark, tag and smart-event fields. It compiles a `ReplayFilter` into one parameterised `WHERE` over `replay_visits`, with `EXISTS` sub-queries on `replay_visit_marks` / `replay_visit_tags`, using their indexes. There is no string concatenation of values.
  - A `smartEvent` clause resolves the rule (a built-in from `BUILTIN_SMART_EVENTS`, or a `replay_smart_events` row for the site) into the same mark predicate that `markMatchesRule` describes. A parity test runs the TS matcher and the compiled SQL over the same fixture marks and asserts the same visits match.
  - `application/replay/replaySegments.ts`: `list`, `create`, `rename` and `delete`, scoped and cached (version token per site), with the filter validated by `parseReplayFilter`.
  - Routes go on the existing scoped routers: `GET/POST/PATCH/DELETE /segments` on `replayAdminRoutes.ts` (platform) and `replayProjectRoutes.ts` (site). The route bodies call one shared handler factory, `replaySegmentHandlers(scopeOf)`, so the two scopes share the code.
  - `GET /filter-options?field=` returns the distinct values for `browser`, `os`, `country`, `referrer`, `release`, `tag` keys and smart events over the window, capped at 50 and cached.
- **Frontend.**
  - `components/replay/ReplayFilterBar.tsx` (presentational) + `useReplayFilter.ts` (state, URL sync through `filterToQuery`/`filterFromQuery`).
    - "Add filter" lists `FILTER_FIELDS` for the current scope; each field renders its editor from `valueKind` (a registry of editors, no branches per field).
    - Applied clauses show as removable chips.
    - A segment menu offers save, rename, delete and apply. Deleting uses `useConfirm`.
  - The filter is lifted into `InsightsHome` (and the canvas `sessions` surface (labelled Visitors) in S7) and passed to every band and every panel tab as one `filter` prop (the registry's component contract already carries it). Every band and kind honours it.
  - `RecordingsList`'s S3 chips are replaced by the bar, and its props are unchanged apart from `filter`.

### S4c.2 Overview (the dashboard)
- **API.** `application/replay/ReplayOverviewService.ts`, cached with version-token keys:
  ```ts
  overview(scope, { days, filter }) → {
    sessions, uniqueVisitors, pagesPerSession, avgActiveMs, avgScrollDepthPct,
    frustration: { rage, dead, quickback, excessiveScroll, error }   // % of sessions with ≥1
    trend: Array<{ day, sessions, frustratedPct }>,
    top: { pages, entryPages, exitPages, referrers, countries, devices, browsers, os }  // each ≤10
  }
  ```
  - Each number is one grouped query over `replay_visits` (plus `replay_interactions_daily` for scroll depth). There are no per-visit loops.
  - Route: `GET /overview` on both routers.
- **Frontend.** `components/replay/OverviewView.tsx` (container) + `OverviewTiles.tsx` (`StatTile` from S0.1, never a new tile) + `OverviewBreakdowns.tsx`.
  - The trend chart uses the chart primitive the admin insight panels already use. Locate it; do not add a chart library.
  - Every frustration tile is a link: it adds that `frustration` clause and switches to Recordings.
  - Every breakdown row is a link: it adds its clause.
  - Register the `metric` kind (the old Overview, opened from a KPI tile), the `issues` kind, the `issue` kind's overview and recordings tabs, and the `funnel` kind's steps and clusters tabs. Land `IssuesTable` in the home's first column (it replaces the S0 Leads placeholder; Leads moves to `?panel=issues` on platform scope as a tab of `issues`).

### S4c.3 Frustration signals, surfaced
- The ReplayPlayer marker icons, the event list and the filter field from S3 already include quick back and excessive scroll. This sub-slice checks them end to end and adds:
  - a "Skip to next frustration" control in the player;
  - an `HEATMAP_INSIGHT_RULES` row: "Quick backs from <path> doubled vs the compare release".
- An **Areas** mode in `HeatmapView` draws one box per top `ElementTable` selector over the snapshot, with its click share. The boxes come from the snapshot's element rects, read in the sandboxed iframe through `rrweb` mirror lookups. It adds no new aggregation.

### S4c.4 Smart events and funnels
- **API.**
  - `application/replay/replaySmartEvents.ts`: `list(scope)` returns the built-ins plus the site's rows, each with its count over the window. It also provides `create`, `delete` and `preview(rule, days)` (the matching-visit count before saving). All are cached.
  - `application/replay/ReplayFunnelService.ts`:
    - `list`, `create` (with steps), `update` and `delete`.
    - `evaluate(scope, funnelId, { days, filter })` → `steps: Array<{ ord, label, visits, conversionFromPrevPct, medianTimeFromPrevMs, droppedVisitIds: first 50 }>`.
    - The evaluation is a pure domain fold, `domain/replay/funnelFold.ts` `evaluateFunnel(marksByVisit, steps, windowMinutes)`. It reads the marks of the filtered visits in batches of 500 ordered by `(visit_id, ord)`, with a hard ceiling of 20,000 visits per evaluation; the response says `truncated: true` if it hit the ceiling. Steps must occur in order within `window_minutes` of the first step.
    - The result is cached per `(funnelId, days, filterHash)` under the site's version token.
  - **Buyer Flow.** `application/replay/replayFlow.ts` projects the filtered visits' `page` and `error` marks into `VisitorFlowRow[]` and calls the existing `buildVisitorFlowGraph` (with `prompts: []`, and `conversions` from an optional "goal" smart event). It is cached. It does not copy the fold.
  - Routes on both routers: `/smart-events*`, `/funnels*`, `GET /funnels/:id/evaluate` and `GET /flow`.
- **Frontend.**
  - `components/replay/FunnelsView.tsx` (list + chart) and `FunnelEditor.tsx` (a `SlideOutPanel`, `width="sheet"`). Each editor step picks a kind (page/click/event), a match and a mode, and shows a live `preview` count.
  - The funnel chart shows bars per step with conversion %, median time between steps, and a "Watch the N who dropped here" action. That action opens Recordings filtered to `droppedVisitIds` (a `visitIds` clause, internal only and not listed in `FILTER_FIELDS`).
  - `components/replay/SmartEventsView.tsx`: a table of built-ins and custom events with counts. Rows can be created from the table, or with "Define from this click", which is offered on any click marker in the ReplayPlayer and pre-fills a click rule with that selector.
  - Register `funnels` (the default mode) and `events` as **modes** on the Journeys view. For site scope, the existing `flow` mode's `FlowView` takes a `source` prop, so its data comes from `/flow` on the project router. `FlowView` is extended, not copied. A flow node offers "Make this a funnel step", and a funnel step offers "See it in the flow". These are cross-links between modes, not copies.

### S4c.5 AI summaries and the Brain tool
- **Move the primitive first.** Move `condenseTranscript` from `application/meetings/meetingIntelligence.ts` to `application/llm/condense.ts`, unchanged. Update `meetingIntelligence.ts` to import it, and keep the meetings tests green.
- `domain/replay/visitDigest.ts`:
  ```ts
  visitDigest(visit, marks, tags) → string
  ```
  - It is pure. It produces one line per mark, `[mm:ss #ord] kind key "label"`, plus a header with device, release, duration, entry and exit paths, and tags.
  - It is capped at 300 lines.
  - It never includes page text: marks carry only selectors, labels already masked by the recorder, paths and error fingerprints.
- `application/replay/replaySummaries.ts`:
  - `summarizeVisit(scope, visitId, { regenerate? })` returns the cached `replay_visit_summaries` row, or calls `condenseTranscript` with a shape that asks for a 3–5 sentence account (what the visitor tried, where it went wrong, the likely cause) in which every sentence ends with the `#ord` it rests on.
  - `parseCitations` keeps only sentences citing an `ord` that exists in the digest, and stores `citations`.
  - `summarizeSegment(scope, { days, filter })`:
    - samples up to 30 matching visits (frustrated ones first);
    - feeds their digests plus the Overview numbers;
    - asks for the 3 most common patterns, each citing `visitId#ord`.
    - It is cached per `(filterHash, days)` for 1 hour, and not stored in a table.
  - Tenant: a site scope uses the buyer's `tenantId` for `tenantProxyForPlan`. The platform scope uses the platform tenant that the superadmin's own Brain uses. Locate how admin-side LLM calls resolve the tenant today; do not invent one.
  - Limit: `REPLAY_SUMMARY_DAILY_LIMIT = 200` per tenant per day, counted in KV (the `withinIpBudget` shape). When the limit is hit, the call returns `{ error: 'limit' }`, which the UI says plainly.
  - Summaries are not metered as recordings.
- Routes on both routers: `POST /visits/:visitId/summary` and `POST /summary` (segment). They are POST because they can spend money. The route writes the `REPLAY_SUMMARY_GENERATED` audit on the platform scope, and the `replay.summary.generated` activity on a site scope.
- **Frontend.**
  - `components/replay/ReplaySummary.tsx` is shown in the `ReplayPlayer` side column: a "Summarize" button, then the text with each citation as a button that seeks the player to that mark.
  - `SegmentSummary.tsx` is shown above Recordings when a filter is applied. Each pattern links to its example visits at the cited moment.
- **Brain tool.** `application/llm/replayToolCatalog.ts` exports `REPLAY_TOOLS: BuiltinTool[]` and is spread into the catalog in `builtinMcpService.ts`, exactly as `CHAT_DIAGNOSTICS_TOOLS` is.
  - The tools are `replay.overview`, `replay.funnel_evaluate`, `replay.search_recordings` (filter → visit ids + one-line digests) and `replay.summarize_visit`. All are read-only.
  - Scope comes from the calling context's project. A tool is advertised only when the workspace holds the `sessionReplay` entitlement, and returns an error otherwise. Use the advertising gate the other entitled catalogs use.
  - The composer of the canvas `sessions` surface (labelled Visitors) (`composerIntents: ['ask']`, S7) lets the buyer ask "why do people drop at checkout?". The Brain answers from these tools and links recordings.
  - Follow the prompt tool-name contract (`advertisedName()`).
- **Read API for buyers.** Document `GET /api/projects/:projectId/replay/{overview,visits,funnels/:id/evaluate}` for workspace API keys in the developer docs page that lists project APIs (locate it). The routes exist already; this only documents them and adds a `replay:read` scope to `TENANT_API_SCOPES`, checked on those three GETs.

### S4c tests
- `packages/interaction-contract`: `filter.test.ts` (parse rejects unknown fields and operators; 12-clause cap; URL round-trip), `smartEvents.test.ts` (each built-in fires on a fixture in each of the five locales; `markMatchesRule` modes), and frustration detector tests (thresholds read from `FRUSTRATION_THRESHOLDS`).
- api:
  - `replayFilterCompiler.test.ts` (every `FILTER_FIELDS` id compiles; values are parameterised; the matcher/SQL parity test);
  - `replaySegments.test.ts`;
  - `ReplayOverviewService.test.ts`;
  - `domain/replay/funnelFold.test.ts` (order, window, drop-offs, median times, truncation);
  - `ReplayFunnelService.test.ts`;
  - `replaySmartEvents.test.ts`;
  - `replayFlow.test.ts` (calls `buildVisitorFlowGraph`; assert the import);
  - `domain/replay/visitDigest.test.ts` (no label beyond what the mark carries; 300-line cap);
  - `replaySummaries.test.ts` (an uncited sentence is dropped; the cache is hit on the second call; the daily limit; platform tenant resolution);
  - `replayToolCatalog.test.ts` (not advertised without entitlement; read-only);
  - the meetings tests still green after the `condense.ts` move;
  - the `replay:read` scope test.
- frontend:
  - `ReplayFilterBar.test.tsx` (add, remove, save segment, URL sync);
  - `OverviewView.test.tsx` (a tile click adds the clause and switches view);
  - `FunnelsView.test.tsx` / `FunnelEditor.test.tsx` (preview count; watch drop-offs opens filtered Recordings);
  - `SmartEventsView.test.tsx`;
  - `ReplaySummary.test.tsx` (a citation seeks the player);
  - `InsightsHome.test.tsx` extended (every band receives `filter`; a KPI tile opens the `metric` kind).

**S4c is done when** every non-excepted row of PRD 33 §2.1 marked S4c works on both scopes in tests, the filter applies to every view, `condenseTranscript` has one home, and §11/§12 S4c pass.

---

## 6d. Slice S4d — The method link (PRD 33 D12 and §2.2)

**Goal.** Replay becomes the measuring instrument of the Idea-to-Real method. Proofs are graded from what visitors did, grades carry evidence, the answer flows back to Idea, fixes are measured, the journey learns Make and Measure, and builderforce.ai measures adoption of the method itself.

S4d starts after the S4c and S7 audits. It owns no new storage engine: it reads replay through `ReplayReadService`, `ReplayFunnelService`, `compileReplayFilter` and `replaySummaries`, and writes only through existing seams (`setRealizationVerdict`, `recordProofOutcome` / `recordOutcomeEvent`).

### S4d.1 Proof measures (the kill condition as data)
- **Contract.** `packages/interaction-contract/src/proofMeasure.ts`:
  ```ts
  ProofMeasure = {
    sample:  { filter: ReplayFilter; min: number };                          // e.g. tag source = instagram, min 1000
    success: { kind: 'smartEvent' | 'funnel'; ref: string };                  // e.g. smart event "Sign up"
    threshold: { op: '>=' | '<='; value: number; unit: 'count' | 'rate' };  // e.g. >= 40 count
    windowDays: number;                                                       // from the charter (smoke test: 14)
  }
  ```
  Also `parseProofMeasure`.
- **Targets declare it.** Add `measure?: ProofMeasure` to `RealizationOutput` (`realization/realizationTarget.ts`). Every live target fills it from the numbers its charter already states. Do not invent new thresholds:
  - `smokeTest.ts`: sample = visits tagged with the named source, min = `sample`; success = the built-in **Sign up** smart event; threshold `>= target` count.
  - Each of `wizardOfOz`, `poc`, `pilot`, `phoneLine` and `liveSystem` maps its first success criterion to a smart event or funnel. Where a criterion cannot be measured from visitor behaviour (for example "the operator answered within 4 h"), leave `measure` undefined for that target and say so in the report. Do not fake it.
  - Persist the measure on the realization (`realizations.measure jsonb`, core migration, written once at materialise time, beside the charter).
- **The generated pages emit the event.** Each live target's generated form/submit handler calls `window.BFReplay && BFReplay.event('<success event>')`. Each landing page sets `BFReplay.tag('source', <utm_source or ref param>)`. The targets' page templates already carry the signup form, so this is a two-line addition per template.
- **Proof sites record without an install.** `replayEntitledForSite(site)` (`application/replay/replayEntitlement.ts`) is true when the workspace holds the capability licence (S6) OR the site's project carries a live realization. S7's `withReplayLoader` and the ingest allowance both call it; no second check is written. Usage still counts toward the free allowance (D4).
- `application/realization/proofMeasure.ts`:
  ```ts
  evaluateProofMeasure(env, db, txDb, realization) → {
    sampleN, sampleMin, sampleReached, successN, value, threshold,
    status: 'collecting' | 'met' | 'missed',
    windowEndsAt, releaseKeys, evidenceVisitIds /* ≤5 non-converting */
  }
  ```
  - It resolves the hosted site for the realization's project and builds the `{kind:'site'}` scope.
  - The sample is counted with `compileReplayFilter` (S4c), success with `ReplayFunnelService.evaluate` or a smart-event count over the sample.
  - It is cached under the site's replay version token.
- **Test fixture:** a smoke test with 1,000 sample visits and 31 signups against a threshold of 40 reports `collecting` before the window ends and `missed` after it. With 30 visits and 40 signups, it never reports `met`.

### S4d.2 Measured verdicts with evidence
- Extend `syncRealizationVerdict` (`realization/realizationVerdict.ts`). Do not add a second sync. The precedence is:
  1. A person's `abandoned` stands (existing rule).
  2. A verdict posted by the console or a person is accepted only when `sampleReached`, or when it carries a written `reason` (an early call). In both cases `verdictMetric` is REPLACED by the measured numbers (plus `reason`, `calledEarly`). A `met` without the sample and without a reason is not written; the row keeps `verdictMetric.held = 'sample_not_reached'`.
  3. With no human call, once `windowEndsAt` has passed, the measured `met` or `missed` is written with `decidedAt = windowEndsAt`.
- `recordProofOutcome(... 'proof.grade' ...)` gains `metadata.evidence = { sampleN, successN, threshold, value, releaseKeys, visitIds, patterns }`. `patterns` is `replaySummaries.summarizeSegment` over the non-converting sample, only on `missed`, and only its cited form. The metadata ceiling in `outcomeLedger.ts` applies, so trim patterns before visit ids. `kill_condition_met` stays 1 or 0, so `OUTCOME_DEFINITION_VERSION` does not change.
- The window-end write needs a trigger nobody has to remember. Register a daily job in the existing scheduled maintenance runner (the one that runs `retentionPurge`). It finds realizations whose window ended with no verdict and calls `syncRealizationVerdict`. Locate the runner; do not add a cron.
- **Frontend.** The canvas's existing proof card (locate where `realizationApi.get` renders a realization's verdict) gains `ProofScoreboard.tsx`:
  - the kill condition in words;
  - a sample progress bar and a success progress bar;
  - days left;
  - a status pill (collecting / on track / at risk / met / missed);
  - "Watch the visitors who didn't" (Recordings filtered to the non-converting sample);
  - "Why it missed" (the stored cited patterns);
  - "Call it early…" (a `SlideOutPanel` `sheet` that requires a reason).

  The same component renders at the top of the canvas `sessions` surface (labelled Visitors) when the app is a proof. i18n: `creationCanvas.proof.*` ×5.

### S4d.3 Read again with what we learned
- On a graded proof card, "Read again with what we learned" calls `realizationApi.plan(idea, sessionId, { priorRealizationId })`. The plan route loads that realization's grade and evidence, passes them to the Read step as context, and writes `idea.read started` with `metadata.priorGrade = { realizationId, verdict, value, threshold, patterns }`.
- `recommendRealizations` reads `priorGrade` with one rule-as-data table (`PRIOR_GRADE_RULES`):
  - missed because the sample was not reached → re-recommend the same form with a "fix traffic" note (never escalate fidelity);
  - missed with the sample reached → rank a lower-effort form that tests the first cited pattern;
  - met → rank the next fidelity up.
- `proofJourney.ts` already folds attempts. It now links an attempt to its prior attempt through `priorGrade.realizationId`, so the journey reads as a chain.

### S4d.4 Ticket effect (Make iterations measured)
- The S3 "Ticket from this moment" stores `replayMoment = { scope, visitId, atMs, releaseKey, metric }` on the task, in the task's existing metadata field (locate it; no new column). `metric` is the funnel step or frustration signal at that moment, for example `{kind:'frustration', key:'rage', selector}`.
- `application/replay/ticketEffect.ts`: `effectFor(task)`. Once a release newer than `releaseKey` has ≥ `REPLAY_EFFECT_MIN_VISITS = 200` visits on the same path, it returns `{before, after, delta}` for that metric. It is cached, and computed on read of the task. Nothing is stored.
- The task detail shows a one-line effect chip ("Rage clicks on Pro “Start free”: 34% → 2% on 2026.10.36"), with links to both releases' recordings.

### S4d.5 Journey signal (closes the `useFounderJourney` ROADMAP gap)
- `GET /api/realizations/journey-signal` → `{ stage: 'make' | 'measure' | null, realizationId }`, cached per tenant and invalidated on realization write, verdict write and first ingest for a proof site.
  - It is **measure** when any live realization is `collecting`, or was graded within 14 days.
  - It is **make** when a realization is built (`proof.build succeeded`) but its site has no visits yet.
- `useFounderJourney` widens `stage` to include `make | measure`. It reads the signal after the existing `idea`/`run` logic, with `run` keeping precedence when a company exists. Update the hook header comment, `founderJourneyFixtures.ts`, and the Journey Strip, TopBar pill and canvas chip tests.

### S4d.6 The Method funnel (dogfood)
- `frontend/src/lib/methodEvents.ts`: `emitMethodEvent(action: ProofJourneyAction)` calls `window.BFReplay?.event(action)`. It is called ONLY from `realizationApi` wrappers on success: `plan` → `idea.read`, `create` → `proof.choose`, build success → `proof.build`, and a verdict read that changed → `proof.grade`. One seam, so a component never emits a method event itself.
- A migration seeds, for the platform site:
  - the four method acts as `replay_smart_events` rows (`rule_kind='custom'`);
  - a `replay_funnels` row, **"The method"**, with steps: page `/` (prefix) → event `composer.submit` (the existing typed-an-idea signal) → `idea.read` → `proof.choose` → `proof.build` → `proof.grade`, with `window_minutes = 43200` (30 days).
- On the platform Overview, a "Method" tile row shows the conversion of each act, linking into that funnel.

### S4d tests
- `interaction-contract`: `proofMeasure.test.ts`.
- api:
  - `realization/proofMeasure.test.ts` (collecting / met / missed; the sample guard; scope is the proof's own site only);
  - `realizationVerdict.test.ts` extended (the precedence rules; held when the sample is not reached; an early call needs a reason; the window-end write; evidence on the ledger row within the metadata ceiling);
  - one test per live target asserting `measure` matches its charter numbers;
  - `replayEntitlement.test.ts` (proof site without a licence is entitled; a non-proof site without one is not);
  - `ticketEffect.test.ts`;
  - `journeySignal.test.ts`;
  - `recommendRealizations` with `priorGrade`;
  - `proofJourney.test.ts` (the chain);
  - the maintenance-job registration test.
- frontend:
  - `ProofScoreboard.test.tsx` (each status; early call requires a reason; watch links carry the filter);
  - `useFounderJourney.test.ts` (make / measure / run precedence);
  - `methodEvents.test.ts` (emitted only from the `realizationApi` wrappers; `rg -n "emitMethodEvent" frontend/src` shows only `builderforceApi.ts` and the module itself);
  - `InsightsPanelHost` Overview Method row.

**S4d is done when** a smoke test built in tests is graded from replay data (held before the sample, measured at window end, evidence on `proof.grade`), read-again carries `priorGrade` into the next read, a ticket shows its effect, the journey reports make/measure, the Method funnel exists on the platform, and §11/§12 S4d pass.

---

## 6e. Slice S4e — Prescriptions (PRD 33 D13 and §2.3)

**Goal.** The platform tells each workspace what to change on its funnel, UI/UX, website and sales; does it, or drafts it; and proves whether it worked. Findings are deterministic, and the AI only phrases and drafts from cited evidence.

S4e starts after the S4d audit. It reuses the replay reads, `condenseTranscript`, the S4d.4 ticket effect, `marketing/experimentation.ts`, `dispatchCloudRunForTask`, the Sales `sequence` engine and `salesPolicy.ts`. It adds no second LLM path, A/B engine or sender.

### S4e.1 Rules and impact (pure, in `api/src/domain/replay/prescriptions/`)
- `rules.ts`: `PRESCRIPTION_RULES: PrescriptionRule[]`, one entry per row of the PRD 33 §2.3 table:
  ```ts
  { id, area: 'funnel'|'ux'|'site'|'sales', detect(input: SiteAggregates): Finding[], effort: 1|2|3, actions: PrescriptionActionKind[], thresholds }
  ```
  A detector reads only the aggregates the application layer passes in (visit counts by cohort, marks, interaction cells, funnel evaluations, error fingerprints and scroll deciles). It never queries anything.
- `impact.ts`: `estimateImpact(finding, cohorts) → { estimate, low, high, unit, confidence }`, using a Wilson interval on both cohorts. It returns `confidence: 'low'` with no point estimate below 100 visits in either cohort.
- `rank.ts`: `rankPrescriptions(rows)`, impact ÷ effort, with low confidence sorted after medium and high.
- Tests: every rule fires on its fixture and stays silent on a near-miss fixture; the impact interval; low confidence suppresses the estimate; the ranking.

### S4e.2 Sweep and prescribe (application)
- Migration (core): `replay_prescriptions` as in PRD 33 §3.1.
- `application/replay/prescriptionSweep.ts`: `sweepSite(env, db, txDb, site)`.
  1. It builds `SiteAggregates` through the existing read services (cached reads; no new scans).
  2. It runs every rule and upserts on `(site_id, rule_id, subject_key)`, refreshing `finding` and `impact`. A dismissed subject stays dismissed for 30 days.
  3. For the top 5 rows per site per day that have no `prescription` yet, it calls `condenseTranscript` with the finding, the cited visit digests (`visitDigest`) and the page's element map. The element map is the snapshot's selectors and labels only, never text content.
  4. It stores `prescription`, `change` and `acceptance`, and drops uncited sentences through the same `parseCitations` as S4c.5.

  It shares the daily `REPLAY_SUMMARY_DAILY_LIMIT` budget, so there is no second meter. It is registered on the same daily maintenance runner as S4d.2. "Find fixes now" calls it for one site, rate-limited to once an hour.
- `pricing_hesitation` and `checkout_abandon_known` resolve identity through ONE function, `resolveKnownContacts(scope, visitorIds)`:
  - **platform:** `replay_visits.user_id` and leads with prompts;
  - **site:** the visit's `user` tag matched against the workspace's Sales contacts by external id.

  Unmatched visitors are never contacted and are only counted.

### S4e.3 Actions (`application/replay/prescriptionActions.ts` + registry `PRESCRIPTION_ACTIONS`)
- **Fix it** (`fix`):
  - It creates a task through the existing task-creation application service. The body holds the finding, the cited replay links, the drafted change, the acceptance metric and, for `site`, the error fingerprint and suspected source.
  - For a hosted site it then calls `dispatchCloudRunForTask` against the project's coding agent with a `prescriptionFix` payload marker (the shape `incidentDispatch.ts` / `securityDispatch` use). The run publishes a **preview** release (not the live one); locate the preview/publish split in the hosted-release flow and use it. A person publishes the preview from the prescription card.
  - With no coding agent, or on an external site, it stops at the task. When a repo is connected through repo-sync, the task asks the agent to open a PR.
  - `action_ref` = the task id.
- **Test it** (`test`):
  - It requires a preview release, from a Fix it or from a person's own edit. It calls `createTest` and `setVariants` (control = the live release, variant = the preview, 50/50, `minimum_sample` from the impact model) and leaves the test in `draft`. "Start test" calls `startTest`, which is a person's action.
  - **Traffic split (new; this closes part of the ROADMAP `experiment` gap).** The sites Worker reads a running test for the site (a cached, dependency-light lookup, as S7.1 does) and assigns a sticky `bf_ab_<testId>` cookie by allocation. It serves the matching release and calls `recordExposure`. The conversion is the test's success smart event, recorded through `recordConversion` by the ingest step when a visit's marks match it. The injected loader carries `data-variant`, and the recorder tags `variant`, so every replay view can segment by it.
  - Run `check:sites-worker-graph`.
  - `action_ref` = the `ab_tests` id.
- **Follow up** (`follow_up`):
  - **site:** it enrols the matched contacts into a chosen `sequence`, or a new one whose step copy the AI drafted from the cited objection. Every send still goes through `runSequenceSweep` and `salesPolicy.ts`. Enrolment is a person's action, with the draft shown first.
  - **platform:** it opens `BroadcastComposer` prefilled with the leads.
  - `action_ref` = the sequence id.
- **Ticket** (`ticket`): the S3 ticket flow, with the brief as the body. For `objection_pattern`, the ticket also proposes the sales FAQ entry and talk-track text.
- **Dismiss:** a reason is required, and dismiss counts per rule are shown to the superadmin (platform) for threshold tuning.
- Routes on both replay routers: `GET /prescriptions` (cached; filter-aware), `POST /prescriptions/:id/{fix,test,start-test,follow-up,ticket,dismiss,publish-preview,revert}`. Each writes an audit (platform) or activity (site) row: `REPLAY_PRESCRIPTION_<ACTION>` / `replay.prescription.<action>`. Role: `MANAGER` for actions; `BILLING_MANAGE` is not needed.

### S4e.4 Verify
- `application/replay/prescriptionVerify.ts` runs on the daily runner and on read:
  - **fix/ticket:** `effectFor(task)` from S4d.4;
  - **test:** `variantResults`, which already withholds a lift until the test is powered;
  - **follow_up:** the enrolled contacts' conversion against the matched contacts that were not enrolled, over 14 days.

  It writes `measured` and the status `worked`, `no_effect` or `worse` (thresholds in the rule's `acceptance`), and records `recordOutcomeEvent({ action: 'prescription.verify', phase: 'validated', metricKey: acceptance.metric, metricValue: delta })`. Add `prescription.verify` to the outcome contract only as a new DELIVERY-family action, with a contract test. If that changes a metric definition, bump `OUTCOME_DEFINITION_VERSION` and say so in the report.
- A `worse` result on a published Fix it offers **Revert**, which republishes the previous release through the hosted-release flow.

### S4e.5 Surfaces
- `components/replay/FixesView.tsx` (container) + `PrescriptionCard.tsx` + `PrescriptionActions.tsx` (actions rendered from `PRESCRIPTION_ACTIONS`, no branches).
  - Each card shows the area chip, the finding with cited replay links, the prescription, the drafted change (before/after), the impact range and confidence, the action buttons, and the status with measured numbers.
  - Land `DoNext` (the ranked fixes) and `ScoreStrip` on the home, and register the `fix` kind (change, measure tabs), the `issue` kind's fix and history tabs, and the `release` kind. There is no Fixes view: the fixes are on the home, and their detail is the `fix` panel.
  - Filters come from `ReplayFilterBar`, plus an area chip row.
- Inline entry points, each rendering `PrescriptionCard` for the matching `subject_key` (the same component, no copies):
  - the Overview's top 3;
  - the Funnels drop panel ("Prescribed fix");
  - the Heatmap insights;
  - the ReplayPlayer's side column, for the visit's own findings;
  - the S4d `ProofScoreboard` "Why it missed".
- Brain: add `replay.prescriptions` (read) and `replay.prescription_draft` (returns the drafted change for a prescription id, read-only) to `REPLAY_TOOLS`. Applying an action stays a person's click, and the Brain may only link to the card.
- i18n: `replay.fixes.*`, `replay.prescription.*` ×5. Rule titles are i18n keys by rule id; the AI text is stored as written, in the workspace's language when known.

### S4e tests
- domain: `rules.test.ts`, `impact.test.ts`, `rank.test.ts`.
- api:
  - `prescriptionSweep.test.ts` (upsert by subject; dismissed suppressed for 30 days; the daily cap and the shared budget; uncited sentences dropped; no page text in the prompt);
  - `prescriptionActions.test.ts` (fix creates a task and dispatches only with an agent and a hosted site; preview, not live; test stays in draft until start; follow-up enrols only matched contacts and goes through `salesPolicy`; audits written);
  - the sites Worker split (sticky cookie, allocation, exposure recorded; `check:sites-worker-graph`);
  - `prescriptionVerify.test.ts` (each action's verifier; revert offered on worse; outcome event recorded);
  - `resolveKnownContacts.test.ts`;
  - the outcome contract test for `prescription.verify`.
- frontend:
  - `FixesView.test.tsx` (ranking order; area filter; low confidence hides the estimate);
  - `PrescriptionCard.test.tsx` (actions from the registry; a dismiss requires a reason);
  - the inline entry points render the same card (assert the import).

**S4e is done when** each of the four areas has at least two rules firing on fixtures, Fix it / Test it / Follow up / Ticket each run end to end in tests with the human gate in place, verification grades each action kind, the Fixes view and its inline entry points work on both scopes, and §11/§12 S4e pass.

---

## 6f. Slice S4f — The page review (PRD 33 D14 and §2.4)

**Goal.** For every key page, Builderforce reads the screen, the metrics, the SEO and the content, renders the improvement visually, hands it to an AI as a prompt (or applies it), and measures the result on the next release. **Fixes becomes the home** of the feature.

S4f starts after the S4e audit. It extends S4e's table, rules, actions and verifier. It adds no second prescription store, no second LLM path and no second runner.

### S4f.1 Page captures
- Migrations:
  - core (or transactional, matching `replay_prescriptions`): `replay_page_captures`, and the new `replay_prescriptions` columns (`page_path`, `capture_id`, `source`, `visual`, plus the widened `area` values);
  - transactional: `replay_page_vitals_daily`.
- `application/replay/pageSelection.ts`: `pagesToReview(scope, site)` returns up to 25 paths: entry pages, funnel-step pages, proof pages and the top 20 by visits. It is cached.
- `application/replay/pageCapture.ts`: `requestCaptures(env, db, site, releaseKey)` queues one capture job per page and device. It reuses `dispatchQaRunner` (the Agentic Tester container) with a new job kind, `page_capture`; do not add a container or a queue. It runs on a new release (first seen in `replay_releases`) and weekly otherwise.
- **QA runner (`api/qa-container/server.mjs`):** add the `page_capture` handler. With Playwright at 1440×900 and 390×844 it:
  1. loads the page;
  2. waits for network idle;
  3. captures full-page and fold screenshots;
  4. builds the rect map (selector via the shared `deriveSelector` logic, bundled into the runner, mapped to `{x,y,w,h,label,role}`) for headings, CTAs, links, inputs, images and sections;
  5. extracts the SEO facts, content facts, lab performance (from `PerformanceObserver` entries and resource timing) and accessibility facts (computed-style contrast, tap-target sizes, labels, alt).

  Uploads use the same signed, tenant-keyed path as `findingScreenshots.ts` (prefix `replay/pages/`).
  - Content-fact extraction skips `[data-bf-mask]` / `[data-bf-block]` regions.
  - The runner never submits forms and never logs in on buyer sites. It captures what an anonymous visitor sees.
- Search Console: `pageSearchFacts(env, db, tenantId, url)` reads `search_console` through the analytics port (dimension `page`, then `query` for that page) when the workspace has it connected; otherwise it returns `{connected:false}`. Never fabricate zeros (the port's own rule).
- Tests: `pageSelection.test.ts`, `pageCapture.test.ts` (queues per release; reuses the runner dispatch; capped), and a runner unit test for the fact extractors against a fixture HTML.

### S4f.2 Rules and the vision review
- Extend `PRESCRIPTION_RULES` with the PRD 33 §2.4 `seo_*`, `content_*`, `perf_*` and `a11y_*` rules. They are pure over `PageFacts` (the capture plus the page's vitals and behaviour). Each has an impact model. SEO rules use clicks; content, performance and accessibility rules use the page's conversion to its next step, with the device split for `a11y_tap_targets`.
- `application/replay/visionReview.ts`: `reviewPage(env, db, capture, facts, ruleFindings)` sends ONE multimodal request through the gateway: the fold screenshots for both devices, the rect map as text, the metrics and the rule findings. The capability gate routes it to a vision model.
  - It asks for at most 5 observed findings as JSON: `{elementSelector, observation, supportingMetric, prescription, visualPatch}`.
  - `acceptObserved(finding, rectMap, facts)` drops any finding whose selector is not in the rect map or whose `supportingMetric` is not a key of `facts`.
  - Accepted findings upsert as `source:'observed'`.
  - It shares the daily summary budget with the S4c summaries and the S4e sweep (one meter).
- Tests: each new rule fires and stays silent on fixtures; `acceptObserved` drops an unanchored finding, an invented metric and an unknown selector; the request carries image parts (assert the shape the capability gate detects).

### S4f.3 Visual patches and before/after
- `packages/interaction-contract/src/visualPatch.ts`:
  - `VisualPatchOp` (`setText`, `setAttr` from an allow-list: alt, aria-label, href on same-origin, title, placeholder; `setStyle` from an allow-list of properties; `moveBefore`, `moveAfter`, `insertAfter` with sanitised HTML from an allow-list of tags and no `on*` attributes, `style` checked by the same allow-list; `hide`);
  - `validateVisualPatch(patch, rectMap)`;
  - `applyVisualPatch(document, patch)`, which runs in the runner sandbox.
- The S4e sweep asks the prescription prompt for a `visualPatch` when the area is `ux`, `content`, `seo` (visual parts) or `accessibility`, and validates it before storing. An invalid patch is stored without a visual, with the reason logged.
- The runner job `page_render_after` loads the captured page, applies the patch and screenshots both sizes. It stores `afterScreenshotKeys` on the prescription. Callout numbers come from the order of the patch ops.
- `components/replay/BeforeAfter.tsx`: before (with numbered callouts drawn from the rect map) beside after, a slider/toggle/side-by-side switch, and a phone/desktop switch. `components/replay/SerpPreview.tsx` renders the search-result before/after for meta changes, plus the JSON-LD diff.
- Tests: `visualPatch.test.ts` (rejects script, `on*`, external URLs, disallowed properties, unknown selectors; applies each op in jsdom); `BeforeAfter.test.tsx`; `SerpPreview.test.tsx`.

### S4f.4 The improvement prompt and Apply
- `packages/interaction-contract/src/improvementPrompt.ts`: `compileImprovementPrompt(input, { audience: 'composer' | 'coding_agent' | 'site_builder' })`. It is pure and deterministic, with sections in a fixed order: page and goal, evidence, changes (each with selector, before → after, reason), constraints, acceptance and measurement. It is snapshot-tested per audience. It is not stored.
- Apply, as `PRESCRIPTION_ACTIONS` rows (S4e registry; no branches):
  - `apply_in_composer` (a canvas app hosted by Builderforce, in the canvas only): it pushes one `previewPick` context per targeted element plus a prescription chip into the ONE composer, with the compiled `composer` prompt as the draft. The person presses send. The Brain makes the change on the App surface, and publishing goes through the normal preview flow. The prescription moves to `applied` with `action_ref` = the resulting release when the session publishes. Locate where a canvas publish records its `version_token`, and subscribe there.
  - `fix` (S4e) for connected repos and hosted sites without the canvas open: the task body is the `coding_agent` prompt.
  - `copy_prompt` (any site): a copy button per audience. It marks the prescription `applied:'manual'`, and the next detected release for that site starts its verification, with no hand-off back.
  - `apply_page` bundles every accepted fix on a page into one prompt (any of the three routes).
- Tests: `improvementPrompt.test.ts` (fixed sections; constraints present; no secrets or masked text); `prescriptionActions.test.ts` extended (composer apply pushes picks and draft; copy marks manual; a new release triggers verification).

### S4f.5 Page score and the Fixes home
- `domain/replay/pageScore.ts`: `pageScore(facts, weights)` with `PAGE_SCORE_WEIGHTS` as data (conversion, frustration, SEO, CWV, a11y). It returns a 0–100 score per component. It is computed per capture and stored in `replay_page_captures.score`.
- `components/replay/FixesView.tsx` (S4e) becomes the home, with these parts:
  1. **Header:** the site's improvement score, its trend across releases, and "+N expected" from open fixes.
  2. **The improvement ledger:** releases as a timeline, each with the fixes it shipped and their measured verdicts.
  3. **Pages:** a list ranked by opportunity, with each page's score, its top fix and its fold thumbnail.
  4. **The page review**, for a selected page: the screenshot with numbered callouts, then for each callout its `PrescriptionCard` with `BeforeAfter`, the improvement prompt (copy per audience) and the Apply action.

  It has an area filter: Funnel, UI/UX, Website, Content, SEO, Performance, Accessibility, Sales.
- Every evidence view keeps its inline `PrescriptionCard`s (S4e.5), so a person browsing evidence is always one click from the fix.
- The canvas surface `sessions` keeps its id; its label is **Visitors** (`creationCanvas.surface.sessions.label` ×5), because the canvas already has an `insights` surface. It renders `InsightsHome`.
- i18n: `replay.fixes.*`, `replay.page.*`, `replay.prompt.*` ×5.
- Tests: `pageScore.test.ts`; `FixesView.test.tsx` extended (Fixes is the default view; page select shows callouts in patch order; the ledger lists releases with verdicts); `CanvasInsightsSurface.test.tsx` (lands on Fixes).

**S4f is done when** a hosted test site and an external fixture site each get page captures per release, rules plus vision produce anchored prescriptions in all eight areas, at least one before/after renders from a validated patch, the improvement prompt compiles for all three audiences, Apply works in the composer, as an agent task and as a copied prompt, the next release re-scores the page and verifies the fix, Fixes is the default view everywhere, and §11/§12 S4f pass.

---

## 7. Slice S5 — Live and Flow links

- API `ReplayLiveService.ts`:
  - `active(scope) → visits with last_event_at > now−60s` (cache TTL 5 s; `kvTtlSeconds: 5`, L1 2 s)
  - `byPath(scope)`
  - `tail(scope, visitId, afterSeq)` → new chunk keys (TTL 2 s)

  Routes: `GET /live`, `GET /visits/:id/tail`.
- Frontend `components/replay/LiveView.tsx`: the count, by-page bars, and live tiles.
  - Tiles show the latest cursor position from the newest chunk (cheap: the last pointer event). There is no full replay per tile.
  - Clicking a tile opens `RecordingPanel` on the replay tab in follow mode. `useReplayPlayback` gains a `follow` mode that polls `tail` every 5 s and appends.
  - Poll intervals pause while `document.hidden`.
- Flow links: `VisitorFlowGraph` nodes get an `onNodeSelect`. `FlowView` shows a detail strip (the node's numbers plus "Watch recordings on this step") that switches to the recordings view with `path=<node.label>`. Do not redraw the graph; extend the existing component's props.
- Register the `live` view row.
- Tests:
  - `ReplayLiveService.test.ts`: window and scope;
  - `LiveView.test.tsx`: polling pauses when hidden (fake timers);
  - `FlowView.test.tsx`: node select → recordings filtered by path.

---

## 8. Slice S6 — Commerce: free install, prepaid recording packs, site keys, install, verify

### S6.1 Install (free) = the entitlement
- `marketplaceListings.ts`: add `{ id:'capability', launch:'run', from:[], family:'asset', harness:'instrument', deliveries:['entitlement'], pricing:'either', trial:'preview', icon:'🎥' }`.
  - If `deliveries` is a closed union, add `'entitlement'` and handle it at each switch site the type-check flags. The handling: "no copy; holding the licence grants the capability".
  - Update the contract tests.
- Migration (core, next free number): insert the `catalog_items` row:
  - `kind='capability'`, `slug='session-replay'`, name and summary (English; display copy from i18n by slug)
  - `visibility='public'`, `price_cents=0` (installing is free; usage is what costs)
  - `publisher_ref='builderforce'`, `published_at=now()`
  - `body={"addon":"session_replay","freeMonthlyUnits":5000,"unitBytes":2097152,"packs":[...]}` (the D4 ladder, as data)
  - `ON CONFLICT DO NOTHING`
- Verify that the marketplace browse query includes rows with `tenant_id IS NULL` / the platform publisher. If it does not, report it as a finding; do not set a fake tenant.
- Install = the existing `acquireListing` (free path), which writes `template_licenses`. Do not add a second install path.
- Entitlement:
  - Add `sessionReplay: boolean` to `PlanLimits` (false on every plan) and a `PLAN_FEATURE_LABEL` entry.
  - Add ONE new source to `evaluateFeatureEntitlement`: `heldCapabilityFeatures(env, db, tenantId)`. It returns the plan features granted by capability listings the workspace holds a licence for (`heldLicence`), mapped through `CAPABILITY_FEATURES: Record<slug, PlanFeature[]>` (data, in `domain/tenant/capabilityFeatures.ts`). It is cached and invalidated on licence write and revoke.
  - Superadmins stay entitled by the existing first check.
- Tests: `featureGate` gains a held licence → `sessionReplay`, a revoked licence → none; plus a contract test for the `capability` kind.

### S6.2 Prepaid recording packs (the real payment)
- The pack ladder is data, read from the catalog item's `body.packs`: `[{ id:'p10k', units:10000, amountCents:4000 }, …]`. The D4 defaults go in the migration; the operator may edit them before S8.
- `application/replay/replayPacks.ts`:
  - `startPackCheckout(db, env, { tenantId, userId, packId, origin })`:
    - calls `createOneTimeCheckoutSession` with `metadata: { purchaseKind: 'replay_pack', tenantId, packId }` and `idempotencyKey: replay-pack:${tenantId}:${packId}:${yyyy-mm-dd-hh}`;
    - writes the `replay.checkout.started` and `replay.checkout.session_created` trace verbs.
  - `settleReplayPack(db, env, event)`: the `ONE_OFF_SETTLERS['replay_pack']` row in `purchaseRegistry.ts`. It verifies through `verifyPaidCheckout`, then:
    - inserts the sale into `orders` / `order_line_items` exactly as other one-off settlers do (copy the comms top-up settler's shape);
    - credits `ledger_entries` (denomination `replay_recordings`, `amount = units`, reference `replay-pack:${checkoutSessionId}`), so it is idempotent through the unique key;
    - writes the money leg in the platform's currency denomination, as the comms top-up does;
    - writes the `replay.payment.completed` trace;
    - invalidates the usage cache.
  - `refundReplayPack(...)`, called from the existing refund handling path (locate where `mp-refund:` / comms refunds are handled):
    - debits the unused remainder of the pack's credits (reference `replay-pack-refund:${sessionId}`);
    - writes `replay.payment.refunded`.
  - **Auto-recharge.** A tenant-level `settings` singleton `feature='replay_autorecharge'`, value `{ packId, threshold: 0.1 }`. When a debit leaves less than 10% of the last pack, `replayUsage` triggers a recharge. A Checkout session needs the buyer present, so it cannot charge off-session.
    - If the payment provider already exposes an off-session or saved-card charge (check `PaymentProvider.ts`), use it.
    - Otherwise ship auto-recharge as an emailed "top up" link, and log the off-session charge as a ROADMAP finding naming the missing provider method. Do NOT fake it.
- Route: `presentation/routes/capabilityRoutes.ts` → `POST /api/capabilities/session-replay/packs/:packId/checkout`, with `requireRole(MANAGER)` + `requirePermission(BILLING_MANAGE)`. It answers 503 cleanly when payments are not configured (`PaymentNotConfiguredError`).
- Tests:
  - `replayPacks.test.ts`: the checkout carries the metadata; settle credits exactly once even on a duplicate webhook; refund debits only the unused remainder; the trace verbs are written;
  - `purchaseRegistry.test.ts`: the `replay_pack` settler is registered;
  - `capabilityRoutes.test.ts`: role, permission and the 503 path.

### S6.3 Sites and keys
- `HashService.generateApiKey` union: add `'bfr'`.
- `TENANT_API_SCOPES`: add `'replay:ingest'`.
- `application/replay/replaySiteAdmin.ts`:
  - `createExternalSite(db, env, {tenantId, userId, label, allowedOrigins[]})`: mints the key through `mintTenantApiKey` (`client:'replay'`, `scopes:['replay:ingest']`, `allowedOrigins`) and inserts `replay_sites`. It returns the raw key ONCE. Because a `bfr_` key is public by design, the install page can always show the key again: store the raw key's display form in `replay_sites.settings.publicKey`. It is not a secret; its only power is ingest, limited to its origins. Document this in the module header.
  - `createHostedSite(db, env, {tenantId, projectId})`
  - `setSiteEnabled`, `updateAllowedOrigins`, `listSites`

  All are entitlement-checked (`requireFeature(c,'sessionReplay')`) at the routes. There is no site limit: usage is metered per recording (D4), so a workspace can add as many sites as it likes.
- Routes: `presentation/routes/replayProjectRoutes.ts` (`/api/projects/:projectId/replay/*`) for hosted sites and reads, plus `/api/replay/sites` (tenant-level) for external sites. Membership is checked with the project ownership helper the `check:project-ownership` guard expects.

### S6.5 The buyer's path (PRD 33 §2.6, D17)
- **Landing page.** `LISTING_LANDINGS` in `frontend/src/lib/marketplace/listingLandings.ts`: data keyed by listing slug → ordered section entries (`hero`, `install`, `pillars`, `compare`, `pricing`, `faq`, `proof`), each rendered by an existing marketing section where one exists (`MarketingFaq`, `CompetitorMatrix`, `SocialProofBar`, `CreationCtaSection`) and a new one only where none does (`ListingHero`, `PricingCalculator`, `InstallStrip`). `marketplace/listing/[slug]/page.tsx` renders the landing above `ListingLaunch` when the slug has an entry; no per-slug branch in the page. Copy lives in i18n under `marketplace.landing.insights.*` ×5. The "Builderforce runs on it" numbers come from the Builderforce workspace's own cached KPI read (public, aggregated, no recordings).
- **SEO.** Add `/marketplace/listing/<slug>` for public listings to `app/sitemap.ts` (missing today), and `JsonLd` `SoftwareApplication` with the offer (free) on the landing.
- **Intent resume.** `Start free` → `registerHref('/apps/insights/setup', 'install:insights')`. After sign-up, verification and `/tenants?next=` workspace choice, `/apps/insights/setup` reads the intent and continues at the workspace step. One helper, `resumeIntent(intent)`, in `lib/auth.ts`; it is used by the listing page too, so a signed-out "Get" on any free listing resumes the same way.
- **Set-up flow** (`/apps/insights/setup`, ONE page, steps as registry data): workspace (→ `acquireListing`), site (→ `createExternalSite`, privacy switches → `replay_sites.settings`), snippet (`replaySnippets`: script, npm, GTM, Builderforce app), verify (`CapabilityVerify`, live), plan (pack buttons → `startPackCheckout`, return to `/apps/insights?panel=plan:packs&checkout={CHECKOUT_SESSION_ID}`). It replaces S6.4's separate install screen; `CapabilityInstall` and `CapabilityVerify` are its step bodies.
- **App home.** `app/apps/[slug]/page.tsx` + `CAPABILITY_APPS` (`lib/marketplace/capabilityApps.ts`): `{ insights: { Component: InsightsApp, setupPath: '/apps/insights/setup' } }`. Not entitled → the listing; entitled with no site → set-up; otherwise `InsightsHome`. The header carries the site switcher (`sites` panel kind: sites, snippet, privacy) and the usage chip (`plan` panel kind: usage, packs, receipts). The workspace nav lists installed capability apps from `GET /acquired` (the existing client function, unused today).
- Tests: `listingLandings.test.ts` (an entry renders its sections in order; a slug without an entry renders today's page), `sitemap.test.ts` (public listings present), `resumeIntent.test.ts` (sign-up → verify → workspace choice keeps the intent), `InsightsSetup.test.tsx` (steps advance only when their call succeeds; verify polls; the pack button starts checkout), `capabilityApps.test.tsx` (the three entitlement states).

### S6.4 Install and Verify UI (set-up step bodies)
- `components/marketplace/capability/CapabilityInstall.tsx` (container), with steps as registry data:
  - `SessionReplayInstallSteps.tsx`:
    - tabs Script tag / npm / Builderforce apps;
    - a copy button;
    - allowed-domain chips input;
    - privacy switches bound to `replay_sites.settings`;
    - the hosted-app list with switches (from the tenant's projects with a published site).
  - `CapabilityVerify.tsx`: polls `GET /api/replay/sites/:id/verify`, which returns `{scriptSeen, originOk, firstEventAt, sessionId}`. These come from the trace verbs below, read through the cached activity query.

  Shows each step's state and names the step that stopped.
- Snippets are generated by a pure function `replaySnippets({ siteKey })` in `packages/interaction-contract` so docs, UI and tests share it:
  - script tag: `<script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="bfr_…"></script>`;
  - npm: `startReplay({ site })`.
- Purchase trace. `recordActivity` (tenant-scoped, actor = user or system, `target_type='capability'`, `target_id=kind`) at each step:

  | Verb | Written by |
  |---|---|
  | `replay.checkout.started` | checkout route |
  | `replay.checkout.session_created` | after the processor returns |
  | `replay.payment.completed` | webhook/complete, idempotent on the session id |
  | `replay.entitlement.granted` | install (`acquireListing`) wrote the licence |
  | `replay.credits.added` | pack settled (units, reference) |
  | `replay.site_key.issued` | site created |
  | `replay.loader.hit` | config endpoint, first hit per site per day |
  | `replay.ingest.first_event` | first visit ever for the site |
  | `replay.credits.first_debit` | first unit charged beyond the free allowance |
  | `replay.session.viewed` | buyer opened a replay |
  | `replay.payment.refunded` | refund |
  | `replay.allowance.exhausted` | new visits started being dropped |

  The Install & Verify screen also shows the usage meter: free units used this month, credits left, and the pack buttons.

  The ledger is the existing one; record nothing about money outside `ledger_entries`.
- Tests:
  - `capabilityRoutes.test.ts` (role/permission; 503 when payments not configured; trace verbs written);
  - `replaySiteAdmin.test.ts` (key scope + origins; only an entitled workspace can create sites);
  - `CapabilityInstall.test.tsx` (tabs; copy; hosted toggles call the API);
  - `CapabilityVerify.test.tsx` (each step state; the stopped step named);
  - `replaySnippets.test.ts`.

---

## 9. Slice S7 — Buyer surfaces (hosted injection, canvas Measure ▸ Visitors)

### S7.1 Hosted injection
- Extract the shared helper `injectBeforeBodyClose(html, markerId, snippet)` from `siteAttribution.injectSiteBadge`, and make `injectSiteBadge` use it.
- New `application/ide/siteReplayInjection.ts`:
  ```ts
  withReplayLoader(env, tenantId, projectId, versionToken, response)
  ```
  - If the hosted site has an enabled `replay_sites` row (cached lookup by project, 5 min), inject `<script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="hosted:<siteId>" data-release="<version_token>">`.
  - The `hosted:<siteId>` site token is resolved in `resolveSiteForIngest`. Its origin must equal the site's subdomain or custom domain; no key is needed for hosted sites.
- Compose it next to `withSiteBadge` at both call sites (`siteServer.ts`, `siteStaticServe.ts`).
- **Run `check:sites-worker-graph`:** the sites Worker must not pull in heavy modules. Keep `siteReplayInjection.ts` dependency-light: a cached query only, no service graph.
- Tests: injection idempotent; no injection when disabled/not entitled; the release token is written; graph guard green.

### S7.2 Canvas surface `sessions`
- `lib/canvasSurfaces.ts`: add `'sessions'` to `CanvasSurfaceId` and an entry:
  ```ts
  { id:'sessions', scope:'board', order: <after insights>, showsBoard:false, showsObjects:false, brainIsSurface:false, persist:true, composerIntents:['ask'] }
  ```
  Renumber `launch` and the object surfaces as PRD 32 W11 did.
- `lib/canvasPhases.ts` `PHASE_SURFACES`: add `'sessions'` to `measure` and `reach`. Keep the rule additive.
- `stage/CanvasSurfaceStage.tsx`: `sessions: <CanvasInsightsSurface onExit={exitToBoard} />`.
- `canvasSurfaceIcons.tsx`: an icon. i18n: `creationCanvas.surface.sessions.{label,enter,active,regionLabel}` ×5.
- New `components/creation-canvas/CanvasInsightsSurface.tsx` (≤200 lines):
  - It resolves the primary app's `ideProjectId` through `useOperateReading`'s existing selector (do not re-derive it).
  - It renders three states:
    - **not entitled:** a buy prompt linking to the listing, with no data fetch;
    - **entitled but recording off for this app:** a switch that calls `createHostedSite`;
    - **otherwise:** `InsightsHome` with `{kind:'project', projectId}` and `InsightsPanel` docked on the side opposite the Brain; the panel kinds come from `INSIGHT_PANEL_KINDS` filtered to `scopes` including `'site'`. They are the same registry and components as Admin, with no surface-specific copies.

    Entitlement is read through a `useCapability('session_replay')` hook (new; calls a cached `GET /api/capabilities/:kind/state`).
  - Numbers in the header come from `useSiteAudience` (the existing count). Do not count again.
  - Toolbar controls go through `useCanvasSurfaceActions`, as `CanvasInsightsSurface` does.
  - Opening a recording opens `RecordingPanel`-equivalent content. The panel in project scope has only the `replay` tab: `VISITOR_PANEL_TABS` rows carry `scopes`. It is docked on the side opposite the Brain through a new `useCounterBrainDockSide(): 'left'|'right'` hook, which reads `brainDockPreferences` + the lens override.
- Tests:
  - `canvasSurfaces.test.tsx` (`sessions` registered and offered from `measure` only);
  - `CanvasInsightsSurface.test.tsx` (three states; no fetch when not entitled; the panel side flips with the dock side; the site-scope kinds come from `INSIGHT_PANEL_KINDS` and the lead tab is absent; a composer question reaches the Brain with the `replay.*` tools advertised);
  - `useCounterBrainDockSide.test.ts`.

---

## 10. Slice S8 — Ship and live validation

### 10.1 Release note
A migration (core, next free number) using the `1203_` pattern, with a fixed uuid, `category 'new'`, `stage 'live'` and the frontend version of the release. Copy:
- **Title:** "Watch what visitors do — session replay & heatmaps".
- **Body:** what someone can now do, not what changed internally.

### 10.2 Blog post
- File: `frontend/src/content/blog/see-why-visitors-leave.md`, plus `.de/.es/.fr/.zh` bodies and `blog.posts.see-why-visitors-leave.{title,description}` in all five catalogs.
- Template: `run-your-app-on-the-canvas.md`.
- Structure:
  1. Open with the gap: you can see that people left, not why.
  2. A `bf-figure` `screen` of the Visitors replay panel.
  3. A `flow` figure: Run → record → watch → ticket → Make.
  4. A `compare` figure: release vs release heatmap.
  5. A "Where it sits in the method" section. This is the heart of the post, not an afterword:
     - **Measure** is where a proof's kill condition is graded, and replay is what grades it: a sample that was actually reached, a success event visitors actually triggered, and recordings of the visitors who did not convert.
     - That evidence goes back to **Idea** ("read again with what we learned") and on to **Make** (a ticket from the moment, with its effect measured on the next release).
     - Show it with a `flow` figure: Prove → Build → Run → Measure (graded by replay) → Idea.

Run `check:blog-index`.

### 10.3 Live validation runbook (the planning session runs it; it needs the operator)
**Prerequisites:**
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set on the API Worker.
- The webhook endpoint `https://api.builderforce.ai/api/webhooks/payment` is registered for checkout and subscription events.
- `[PRICE]`, `[SITE ALLOWANCE]` and `[SESSION CAP]` are set.
- A test workspace exists that is NOT superadmin or comped.

**Steps:**

| # | Step | Evidence the step passed |
|---|---|---|
| 1 | Deploy api + frontend + the `publish-cdn` job. | `curl -sI https://cdn.builderforce.ai/replay/v1/loader.js` → 200, `cache-control: public, max-age=300`, no `cf-worker` header, and `cf-cache-status: HIT` on the second request. `/replay/manifest.json` names a hashed recorder that returns 200 with `immutable`. `cdn.builderforce.ai/embed/v1.js` resolves, or the snippet was changed in S2. |
| 2 | Dogfood as customer #1. As a member of the Builderforce workspace, walk §2.6 from the landing page (install, site key for builderforce.ai, deploy the snippet). Then open builderforce.ai in a private window, accept analytics, click around, and rage-click something. Then sign in, open a canvas with the 3D Room, and visit Settings ▸ API keys. This step requires the operator to have published the legal disclosure and set `replay.recordSignedIn = true`. | In Admin ▸ Growth ▸ Insights ▸ Recordings, ONE visit appears within ~10 s and runs across sign-in. It is tagged with the current UI version, and its `user_id` is set. The replay plays the Room (canvas frames). The API-key area is blocked and inputs are masked. The user's detail panel lists the recording. Logs ▸ Audit has `REPLAY_VIEWED`. |
| 3 | Install, then buy. As the test workspace owner, install the listing (free; trace `replay.entitlement.granted`). As superadmin, set its `replayFreeAllowanceOverride = 0`. Then buy the 10k pack ($40) with a real card. | Trace `replay.checkout.started` → `.session_created` → `.payment.completed` → `replay.credits.added` (10,000). `ledger_entries` has the sale rows plus a `replay_recordings` credit of 10,000. The Stripe dashboard shows the $40 payment. The usage meter shows 10,000 credits. |
| 4 | Install. Create an external site with a test origin. Paste the snippet on a page served from that origin. Visit it. | `replay.site_key.issued`, then `replay.loader.hit`, then `replay.ingest.first_event`. Verify turns green. |
| 5 | Hosted. Turn recording on for one published canvas app, then visit it. | The page source contains the injected loader with `data-release=<version_token>`. A recording appears in that canvas's Measure ▸ Visitors. |
| 6 | Review, then compete. Open the recording as the buyer. Then, on the buyer site, call `BFReplay.event('signup')` and `BFReplay.tag('plan','pro')`, quick-back once, and scroll frantically once. Build a 3-step funnel, save a segment, summarize the recording, and ask the canvas Brain "where do visitors drop off?". | `replay.session.viewed`. A different workspace's user cannot list it (403). Overview shows the frustration tiles. The recording carries the quick-back and excessive-scroll markers, the `signup` event and the `plan=pro` tag. The funnel shows the drop and "Watch who dropped" opens the matching recordings. The saved segment filters every view. The summary cites moments that seek the player. The Brain answer links recordings. Then walk the PRD 33 §2.1 matrix row by row and record the evidence. |
| 7 | Debit, then refund. After the step-4/5 visits, confirm credits were debited (`replay.credits.first_debit`; the balance below 10,000; one ledger row per unit crossed, no duplicates). Record one canvas-heavy visit and confirm it counted more than 1 unit. Export one replay as MP4 and confirm 10 units were debited and the file plays. Then refund the payment in Stripe. | `replay.payment.refunded`. The ledger debits the unused remainder only. With 0 credits and a 0 allowance, config for the site returns `enabled:false` for NEW visits (`replay.allowance.exhausted`). Already-recorded visits still play. Reset `replayFreeAllowanceOverride` afterwards. |
| 8 | Erase. In Admin, erase the step-2 visitor. | Their `replay_visits` rows and R2 chunks are gone. The audit has `GUEST_PROMPTS_ERASED` with per-eraser counts. |
| 9 | The method, end to end. In the test workspace, read an idea, choose **smoke test**, build it, and send a small named source (`?utm_source=runbook`) through the landing page. Lower the charter's sample to 20 and the target to 3 for the run. Sign up twice, and try to record `met` from the console. Then sign up a third time once the sample is reached. Finally, "Read again with what we learned". | Before the sample: the console's `met` is held (`verdictMetric.held = 'sample_not_reached'`). After: `proof.grade validated` with `kill_condition_met = 1` and `metadata.evidence` holding the measured numbers and the release key. The proof scoreboard matches. The journey reports `measure`. The next `idea.read` carries `priorGrade`. On builderforce.ai, the Method funnel shows these acts as events. |
| 10 | Prescriptions. On the step-5 hosted app, deploy a release with a deliberately broken button and a non-clickable heading styled like a link, then drive 150+ visits through it. | The Fixes view shows `rage_on_element` and `dead_click_heading` with cited replays and an impact range. **Fix it** creates a task and the agent produces a preview release; publish it. **Test it** on the heading change creates a draft test; start it and confirm visitors split, with the `variant` tag on the recordings. After the next 200 visits, the Fix it prescription reads `worked` with numbers, and a `prescription.verify` outcome row exists. A **Follow up** on a matched test contact enrols them into a sequence only after confirmation. |
| 11 | The page review. Point an external fixture site (no repo, not hosted) at the snippet. It needs a vague hero CTA ("Learn more"), a missing meta description and a 32 px tap target on phone. Drive 150+ visits. Then copy the "coding agent" improvement prompt, apply it by hand, and redeploy. | A capture exists for both devices on the release. Fixes is the default view. Each issue appears in its own area (content, seo, accessibility) with a before/after (the SERP preview for the meta), and observed findings carry an element and a metric. After the redeploy, the new release is detected with no hand-off, the page is re-captured, the score changes, and each `copy_prompt` fix gets a measured verdict. |

Record the trace output in the DONE.md entry.

---

## 11. Verification briefs (Sonnet subagent, verbatim)

**Never run the full vitest suite.** Report pass/fail per item with the failing output, verbatim. Do not judge design.

**Common to every slice:**
1. `cd Builderforce.ai/api && npm run type-check` (tsgo or tsc, never both)
2. `cd Builderforce.ai/api && npm run check`
3. `cd Builderforce.ai/frontend && npm run type-check`
4. `cd Builderforce.ai/frontend && npm run check`

**Targeted tests per slice.** Run only these:

| Slice | Where | Files |
|---|---|---|
| S0 | frontend | `src/components/admin/adminShared.test.tsx`, `src/components/UserDetailDrawer.test.tsx`, `src/lib/adminGroups.test.ts`, `src/components/admin/panels/InsightsPanelHost.test.tsx`, `src/components/visitors/RecordingPanel.test.tsx`, the QA telemetry tests under `src/lib/qa/` |
| S0 | packages | `packages/interaction-contract` (all tests) |
| S0 | api | `src/application/qa/QaHeatmapService*.test.ts`, `src/domain/qa/heatZones.test.ts` |
| S1 | api | `src/domain/replay/*.test.ts`, `src/application/replay/*.test.ts`, `src/application/visitors/visitorDataErasers.test.ts`, `src/presentation/routes/replayIngestRoutes.test.ts`, `src/presentation/routes/replayAdminRoutes.test.ts`, the scope-rejection security test, `src/application/maintenance/retentionPurge*.test.ts` |
| S2 | replay-sdk | `npm run type-check && npm test && npm run build && npm run size` |
| S2 | scripts | `bash .github/scripts/cdn-ensure.sh --dry-run` and `bash .github/scripts/cdn-publish.sh replay-sdk/dist/assets --dry-run` (print the planned wrangler/API calls, exit 0); `shellcheck` on both if available |
| S3 | frontend | `src/components/replay/RecordingsList.test.tsx`, `ReplayPlayer.test.tsx`, `src/components/ReplayLoader.test.tsx`, `src/components/visitors/RecordingPanel.test.tsx`, the sensitive-region attribute test, `UserDetailDrawer.test.tsx` (recordings section) |
| S4 | api | `src/application/replay/ReplayHeatmapService.test.ts`, `replayVideoExport.test.ts` |
| S4 | frontend | `src/components/replay/HeatmapView.test.tsx`, `HeatmapInsights.test.ts` |
| S4c | interaction-contract | `filter.test.ts`, `smartEvents.test.ts`, the frustration detector tests |
| S4c | api | `src/application/replay/{replayFilterCompiler,replaySegments,ReplayOverviewService,ReplayFunnelService,replaySmartEvents,replayFlow,replaySummaries}.test.ts`, `src/domain/replay/{funnelFold,visitDigest}.test.ts`, `src/application/llm/replayToolCatalog.test.ts`, `src/application/llm/builtinMcpService.test.ts`, the meetings intelligence tests, the `replay:read` scope test |
| S4c | frontend | `src/components/replay/{ReplayFilterBar,OverviewView,FunnelsView,FunnelEditor,SmartEventsView,ReplaySummary}.test.tsx`, `InsightsPanelHost.test.tsx` |
| S4d | interaction-contract | `proofMeasure.test.ts` |
| S4d | api | `src/application/realization/{proofMeasure,realizationVerdict,proofOutcomes}.test.ts`, the per-target measure tests under `src/application/realization/targets/`, `src/application/replay/{replayEntitlement,ticketEffect}.test.ts`, `journeySignal.test.ts`, the recommender test, `src/application/outcomes/proofJourney.test.ts`, the maintenance-job registration test |
| S4d | frontend | `ProofScoreboard.test.tsx`, `src/lib/useFounderJourney.test.ts`, `src/lib/methodEvents.test.ts`, the Journey Strip / TopBar pill / canvas chip tests, `InsightsPanelHost.test.tsx` |
| S4e | api | `src/domain/replay/prescriptions/{rules,impact,rank}.test.ts`, `src/application/replay/{prescriptionSweep,prescriptionActions,prescriptionVerify,resolveKnownContacts}.test.ts`, the sites Worker split test, `src/application/marketing/experimentation*.test.ts`, the outcome contract test; plus `npm run check:sites-worker-graph` |
| S4e | frontend | `src/components/replay/{FixesView,PrescriptionCard}.test.tsx`, `InsightsPanelHost.test.tsx` |
| S4f | interaction-contract | `visualPatch.test.ts`, `improvementPrompt.test.ts` |
| S4f | api | `src/application/replay/{pageSelection,pageCapture,visionReview,prescriptionActions}.test.ts`, `src/domain/replay/pageScore.test.ts`, the new rule fixtures under `src/domain/replay/prescriptions/`, the vision request-shape test against the capability gate |
| S4f | qa-container | the fact-extractor unit test (fixture HTML) |
| S4f | frontend | `src/components/replay/{BeforeAfter,SerpPreview}.test.tsx`, `src/components/insights/RoutePanel.test.tsx`, `CanvasInsightsSurface.test.tsx`, `InsightsHome.test.tsx` (the stage's "Page review" opens the `route` kind) |
| S5 | api | `ReplayLiveService.test.ts` |
| S5 | frontend | `LiveView.test.tsx`, `src/components/admin/visitors/FlowView.test.tsx` |
| S6 | api | `src/application/replay/replayPacks.test.ts`, `src/application/billing/purchaseRegistry*.test.ts`, `src/presentation/middleware/featureGate*.test.ts`, `capabilityRoutes.test.ts`, `replaySiteAdmin.test.ts`, the consumption meters test (`application/consumption/*.test.ts`) |
| S6 | packages | the contract tests in `packages/creation-canvas-contract` (marketplaceListings) |
| S6 | frontend | `CapabilityInstall.test.tsx`, `CapabilityVerify.test.tsx` |
| S6 | interaction-contract | `replaySnippets.test.ts` |
| S7 | api | `siteReplayInjection.test.ts`, `siteAttribution*.test.ts` |
| S7 | frontend | `canvasSurfaces.test.tsx`, `CanvasInsightsSurface.test.tsx`, `useCounterBrainDockSide.test.ts`, `canvasPhases.test.ts` |
| S7 | clients/vscode | type-check only (it compiles the canvas source; do not package) |
| S8 | frontend | `npm run check` (includes `check:blog-index`) plus `src/i18n/messages.test.ts` |

---

## 12. Audit checklist (planning session — Opus or Fable, never Sonnet)

Hand-over package from each slice:
- the diff;
- the §11 report;
- screenshots of every new or changed screen, in both themes and at 360 px;
- the implementer's deviation list.

**Every slice:**
- [ ] Decisions D1–D17 obeyed. No new decision taken silently.
- [ ] **No duplicates.** These all return only the canonical definition:
  - `rg -n "function (FunnelStat|Stat)\b" frontend/src` → 0
  - `rg -n "deriveSelector\s*\(" -g '!**/interaction-contract/**' --type ts | rg "function"` → 0
  - `rg -n "0\.97" api/src` → only `domain/qa/heatZones.ts`
  - `rg -n "SlideOutPanel" frontend/src/components/replay frontend/src/components/visitors` → only `RecordingPanel.tsx`
  - `rg -n "user-drawer" frontend/src` → 0
- [ ] **Layering.** These return 0:
  - `rg -n "infrastructure/database/schema" api/src/presentation/routes/replay*.ts api/src/presentation/routes/capabilityRoutes.ts`
  - `rg -n "fetch\(|apiRequest\(" frontend/src/components/replay frontend/src/components/visitors` (only `lib/replayApi.ts` / `adminApi.ts` call the network)
- [ ] **Sizes.** `wc -l` on every new file is ≤ ~400. `git diff --stat` shows `adminRoutes.ts` and `adminApi.ts` not grown beyond a mount/import line. `CreationCanvas.tsx` net ≤ +10.
- [ ] **Tables, not branches.** These return 0:
  - `rg -n "view === '|tab === '|kind === 'capability'" frontend/src/components/admin/panels/InsightsPanelHost.tsx frontend/src/components/visitors frontend/src/components/marketplace`
  - Views, tabs, filters, insights, purchase actions and add-ons are registries.
- [ ] **Caching.** Every new `router.get` in `replay*Routes.ts` resolves through a service method that uses `getOrSetCached`, or carries a one-line reason (chunk bytes: immutable R2 plus a `Cache-Control` header).
- [ ] **i18n.** New keys exist in all five catalogs with non-English text in zh/es/fr/de (spot-check 5 keys per locale). `messages.test.ts` is green, and there are no hardcoded strings in new TSX (`rg -n ">[A-Z][a-z]+ [a-z]+<" <new files>` reviewed).
- [ ] **Theme.** `rg -n "#[0-9a-fA-F]{3,6}\b|rgb\(" <new TSX/CSS>` returns 0, except inside the replay iframe and heatmap ramp definitions, which must reference token fallbacks. Light and dark screenshots are reviewed.
- [ ] **Accessibility.** Icon buttons have `aria-label`. The scrubber is an `input[type=range]`. Markers are buttons. Every tablist has `role="tab"`/`aria-selected`.
- [ ] **Dead code.** Every removed or replaced export has zero references. No unused exports were added (run `rg` on each new export).
- [ ] **Tests.** Each sub-slice's named tests exist and assert behaviour (not snapshots only).

**Per slice:**

| Slice | Additional checks |
|---|---|
| S0 | Old admin URLs (`?tab=users&sub=sessions`, `?tab=growth&sub=visitorFlow`) land on the right view. The erase button is wired. The three old files are deleted. QA telemetry behaviour is unchanged (its tests are unmodified). |
| S1 | The `bfr_` key is refused on a normal API route (the security test exists and passes). Ingest never throws to the client and always returns 202. Recordings are NOT written to `activity_log` (`rg -n "recordActivity\|activity_log" api/src/application/replay/ReplayIngestService.ts` → 0, except the S6 trace verbs, which must sit in a separate module). The transactional DB is used for visits/aggregates (`buildTransactionalDatabase`). Retention is registered. The eraser registry covers replay. |
| S2 | Size budgets are enforced by a test, not by a comment. `maskAllInputs` is hard-true (no config can disable it; grep the recorder). DNT/GPC is honoured before any network call. The recorder self-disables on error. The CDN scripts are idempotent, upload the manifest LAST, set the cache classes, and create the no-Worker route (read the script). No snippet anywhere points at a URL that is not published (`rg -n "cdn.builderforce.ai" -g '!*.md'`, each path matched to an upload). |
| S3 | Both signed-in and signed-out visitors are recorded. Signed-in recording is gated by `replay.recordSignedIn` and by `replayExcluded`, and only after consent. `identify` is accepted for the platform site only (a test proves a buyer site's identify is ignored). Every listed sensitive component carries its attribute (test). The legal text is drafted as a DRAFT version, not published. `REPLAY_VIEWED` audit written. The player is lazy-loaded (`rg -n "rrweb" frontend/src` shows only dynamic imports outside `replay-sdk`). The ticket action reuses the existing task flow, or a logged fallback is in place. |
| S4 | `rankHeatZones` is used by both services. The heatmap background iframe is sandboxed without scripts. Insights are rules-as-data. The video export reuses an existing job runner (no new queue), debits 10 units once, and reports `unavailable` honestly. |
| S4c | One filter contract and one compiler: `rg -n "ReplayFilter\b" frontend/src api/src` shows only imports from `interaction-contract`, and no view parses its own query string. The compiler parameterises every value (read it). The matcher/SQL parity test exists. `buildVisitorFlowGraph` is called by `replayFlow.ts` and not copied. `condenseTranscript` has exactly one definition (`rg -n "function condenseTranscript"` → `application/llm/condense.ts`). The digest carries no page text. Uncited summary sentences are dropped. Summaries are on demand, cached and limited. `REPLAY_TOOLS` is entitlement-gated and read-only. The funnel evaluation is bounded (batched, 20k ceiling, `truncated` flag). Overview uses `StatTile`. Every view takes `filter`. Every S4c row of the PRD 33 §2.1 matrix maps to working code. |
| S4d | The verdict is synced in ONE place (`syncRealizationVerdict`), with the precedence exactly as specified. `met` is never written before the sample is reached without a reason. `REALIZATION_VERDICTS` and `OUTCOME_DEFINITION_VERSION` are unchanged. Every measure on a target matches its charter numbers, and a target that cannot be measured from behaviour says so rather than faking it. Entitlement is ONE function (`replayEntitledForSite`) used by injection and ingest. Method events have exactly one emitting seam. Read-again carries `priorGrade` into both the ledger and the recommender. The ticket effect is computed on read and never stored. The journey change updates its header comment and every consumer's test. The ROADMAP `useFounderJourney` gap moves to DONE.md. |
| S4e | Findings come only from `PRESCRIPTION_RULES` (`rg -n "condenseTranscript" api/src/application/replay` shows the summaries and the sweep only, and the sweep calls it only for rows a rule produced). Uncited sentences are dropped. No page text reaches a prompt. Impact is pure and withheld at low confidence. Every action is a `PRESCRIPTION_ACTIONS` row, and the human gates hold: preview not live, the test in draft until started, follow-up through `salesPolicy`, contacts only via `resolveKnownContacts`. There is ONE A/B engine (`experimentation.ts`, no second results path) and ONE dispatch seam (`dispatchCloudRunForTask`). The sites Worker graph is green. The verifier reuses `effectFor` and `variantResults`. `PrescriptionCard` is the only card, rendered by every entry point. The ROADMAP `experiment` gap is updated with what the traffic split now covers. |
| S4f | ONE runner (`dispatchQaRunner` with new job kinds; no new container or queue). ONE prescription table (no second store for page findings). Observed findings are anchored (the `acceptObserved` test exists and the rule in it matches D13's amendment). Visual patches pass `validateVisualPatch` and the after images come from applying them to the captured page (no generated images). The improvement prompt is pure, compiled on read, and contains no masked or secret text. Apply in the canvas goes through the ONE composer via `previewPick`: `rg -n "improvement.*form\|ApplyForm" frontend/src` → 0. Search Console data comes only through the analytics port. A new release triggers verification for `copy_prompt` fixes. Fixes is the first `INSIGHT_PANEL_KINDS` row and the canvas landing view. The runner never submits forms or signs in on buyer sites. |
| S5 | Polling pauses while hidden. Live TTLs are ~5 s and cached. `VisitorFlowGraph` was extended, not copied. |
| S6 | One install path (`acquireListing`) and one payment path (a `ONE_OFF_SETTLERS` row); no subscription code added. Credits and debits only in `ledger_entries` under `replay_recordings`, idempotent by reference (grep for a second balance store → 0). The pack ladder is data in the catalog item. The meter is registered in `meters.ts`, so displayed == enforced (the same `replayUsage` function feeds both). Auto-recharge is real, or logged with the missing provider method named. Trace verbs at each step. `requireRole(MANAGER)` + `BILLING_MANAGE` on checkout. |
| S7 | `check:sites-worker-graph` green. Injection idempotent. The surface fetches nothing when not entitled. The panel docks opposite the Brain. `sessions` is offered from `measure` only. |
| S8 | The release note is category `new` with copy about what users can do. The blog has all 3 figures and a "Where it sits in the method" section in 5 locales. Runbook steps 1–11 are recorded with evidence. The PRD 33 §2.1 matrix has been re-checked against Clarity's current docs, and every non-excepted row has been demonstrated. Versions bumped. ROADMAP → DONE.md moved. |

---

## 13. Definition of done, per slice

| Slice | Done when |
|---|---|
| S0 | One Insights destination (Flow, Leads), one `RecordingPanel`, one `StatTile`, `UserDetailDrawer` on `SlideOutPanel`, shared selector + ranking; legacy URLs alias; erase wired; §11 green; §12 passed |
| S1 | Ingest → R2 → visits → aggregates proven in tests; scoped, cached reads; key scope security test; erasers + retention; §11/§12 |
| S2 | Package builds within budgets; the CDN scripts are ready to provision and publish to `cdn.builderforce.ai`; `embed/v1.js` resolved; npm entry self-updates; §11/§12 |
| S3 | Signed-out and (behind the gate) signed-in builderforce.ai visits are replayable by the superadmin as one continuous visit, with canvas frames, release chip, markers, sensitive regions blocked, audit, and the user's recordings on their detail panel; §11/§12 |
| S4 | Click/scroll/attention heatmaps, element table, release compare, rule-based insights, MP4 export; §11/§12 |
| S4c | Overview, filter bar + segments on every view, frustration surfacing + Areas mode, smart events, funnels, buyer Flow, AI summaries (visit and segment), Brain `replay.*` tools, the documented read API; both scopes; §11/§12 |
| S4d | Proofs graded from replay (sample guard, measured verdict, evidence on `proof.grade`), proof scoreboard, read-again with `priorGrade`, ticket effect, journey make/measure, platform Method funnel; §11/§12 |
| S4e | Rules across funnel/ux/site/sales, impact model, cited AI prescriptions, Fix it (preview release) / Test it (A/B with traffic split) / Follow up (sequence) / Ticket, verification with revert, Fixes view + inline cards + Brain tools, both scopes; §11/§12 |
| S4f | Page captures per release (screen, SEO, content, lab + field performance, accessibility), rules + anchored vision findings in 8 areas, visual before/after from validated patches, improvement prompts for composer / coding agent / site builder, Apply via the ONE composer / agent / copy, page score + improvement ledger, Fixes as the home; §11/§12 |
| S5 | Live view (~5 s), follow mode, Flow → recordings; §11/§12 |
| S6 | A buyer can install free, buy a pack (in tests against a mocked processor), see credits on the meter, get a site key, install the snippet, verify, and be debited past the free allowance; §11/§12 |
| S7 | Hosted apps record with release tokens; canvas Measure ▸ Visitors works per entitlement state; §11/§12 |
| S8 | Release note, blog ×5, versions, runbook executed with real payment + refund, ROADMAP → DONE.md |

## 14. Hand-off order (who starts when)

```
S0 (Opus A) ──┐
S2 (Opus B) ──┼──▶ S1 (Opus A, after S0 audit; needs interaction-contract) ──▶ S3 (Opus A) ──┬──▶ S4 (Opus B)
              │                                                                              ├──▶ S5 (Opus A)
              │                                                                              └──▶ S4c (Opus C)
              └──────────────────────────────────────────────────────────────────────────────────▶ S6 (Opus B, after S4) ──▶ S7 (Opus A, after S4c + S6) ──▶ S4d (Opus C) ──▶ S4e (Opus C) ──▶ S4f (Opus C) ──▶ S8 (planning session + operator)
```

- S7 waits for S4c because the canvas surface renders the S4c views and the Brain tools.

- Sonnet verifies after each slice.
- The planning session audits before any dependent slice starts.
- Real failures go back to the slice's Opus agent with the §11 output and the §12 finding. The planning session does not patch them itself.
