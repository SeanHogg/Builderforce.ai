# PRD 25a — Vertical KPI Dashboards: implementation hand-off

**Status:** Ready to build · **Owner:** platform (CFO seat) · **Created:** 2026-09-15 · **Parent:** [PRD 25](./25-prd-vertical-kpi-dashboards.md) (the why, the research, the KPI sets and benchmarks — read §5 and §6 before starting)
**Audience:** the coding agent that completes the product. Everything below is the remaining work, in build order, with the exact seams to use. Nothing here needs an operator decision.

## 0. Ground rules that apply to every slice

- **No new tables.** `api/src/application/migration/burnrateCutoverPolicy.json` has `newTablesAllowed: false` and `check-burnrate-cutover-policy.mjs` enforces it. Everything lands on `catalog_items`, `saved_dashboards`, `dashboard_widgets`, `dashboard_pins`, `metric_facts`, `custom_kpis`, `kpi_formulas`, `industry_benchmarks`, `tenant_benchmark_profiles`, `share_classes`, `objects`.
- **Presets, templates, verticals and metric keys are DATA.** Never add a `switch` on a vertical; a new vertical is a row in `DASHBOARD_VERTICALS`, a preset entry, a template manifest and i18n keys.
- **Layering.** Routes take application ports; no route imports a table. Materialisers and computes live in `application/`. Components call typed clients.
- **Null means "Not measured".** A metric with no observed and no declared value returns `null`; never `0`. Rates with no denominator are `null`.
- **Localize in the same pass.** Every visible string is a key in all five catalogs (`frontend/src/i18n/messages/{en,zh,es,fr,de}.json`) with real translations. Sector labels already exist under `startups.vocab.sector.*`; reuse them via `useStartupLabels().sector`.
- **Both themes, 360px.** Tiles use theme tokens only (`var(--surface)`, `var(--text-primary)`, `var(--border)`, `var(--radius-md)`, `var(--font-size-small)`); the design-token guard will reject literals.
- **Tests run through a Sonnet agent, not the author's shell** (operator rule). Guards to run after each slice: `check-migrations`, `check:tenant-scope`, `check-burnrate-cutover-policy`, the design-token guard, `askWidgetIds.test.ts`, `dashboardPresets.test.ts`, the templates contract test (every declarable output kind has a materialiser).
- **Ship rule.** Each slice is a NEW capability: author a `release_notes` row (category `new`) via the superadmin surface (`POST /api/release-notes`, see migration 1175 for the header style), and a blog post in `frontend/src/content/blog/` built around the Idea-to-Real arc (template: `run-your-app-on-the-canvas.md`, with `bf-figure` visuals and a "Where it sits in the method" section naming **Run → Measure**).
- **Versions.** Bump `api/package.json` and `frontend/package.json` when shipping (another session may already have; check `git diff` first).

## 0.1 Slice 0 — confirm what already shipped (do this first)

The vocabulary change described in §1 **was verified on 2026-09-15 and is clean.** Recorded so nobody re-runs it blind:

- **Contract:** `verticals.test.ts` + `startupListing.test.ts` → 14 tests pass. The package has no standalone typecheck; it is checked transitively by the API and frontend, both clean.
- **API:** tsgo and tsc both pass with no errors (tsc needs `--max-old-space-size=8192`; the default heap OOMs on this repo regardless of this change). All 34 checks in `api/scripts/checks.manifest.mjs` pass, including migration sequence (561 files, 1176 counted, no duplicate prefix), tenant scope (no new unscoped statements) and the BurnRateOS cutover policy (no new tables).
- **Frontend:** typecheck clean, the i18n catalog-parity test passes 108/108, and `check-i18n-keys` resolves every rendered key. One design-token regression was found and fixed in place: the `noCohort` notice used literal `borderRadius: 8` and `fontSize: '0.82rem'`, which tripped `check:design-scale`; both are now `var(--radius-md)` / `var(--font-size-small)`, the identical values as tokens.
- **Migration 1176** is file-only; it needs `db:migrate` on deploy like every other migration here. **This is the one step still outstanding.**

**One coverage gap to close in slice A, since you will be editing these files anyway.** `api/src/application/insights/benchmarkProfile.ts` has no test, and neither does `benchmarkingInsights.ts` or `benchmarkingRoutes.ts` (the only file under `insights/` with tests is the unrelated agent-eval benchmark). Write `benchmarkProfile.test.ts` covering: a blank patch keeps the current value; `assertKnownCohort` rejects an unseeded industry and an unseeded size band with the list in the error; `setBenchmarkProfile` upserts and bumps the version token; `alignBenchmarkIndustry` is a no-op when the industry already matches and writes when it does not. Add `rankPercentile` unit tests while you are there — it is pure and currently untested.

Two failures you may still see are **not** from this change and were left alone: a one-millisecond timing flake in `api/src/application/investor/startupListing.test.ts` (the runway facet, logged in the roadmap), and frontend typecheck plus react-hooks failures in the brain-embedded chat-diagnostics exports, manager-autonomy types, `BrainDock.tsx` and `WorldViewport.tsx`, which another session was editing in this shared working tree at the time. Confirmed unrelated by content grep and file timestamps. Re-check once that workstream settles.

## 1. What already exists (do not rebuild)

| Seam | Where | Use it for |
|---|---|---|
| Sector vocabulary + verticals | `packages/creation-canvas-contract/src/startupListing.ts` (`STARTUP_SECTORS`, 20 values), `verticals.ts` (`DASHBOARD_VERTICALS`, `verticalForSector`, `isDashboardVertical`) | The ten preset keys and the fold |
| Benchmark profile writer | `api/src/application/insights/benchmarkProfile.ts` (`setBenchmarkProfile`, `alignBenchmarkIndustry`, `assertKnownCohort`) | Set the cohort on install |
| Benchmark read | `benchmarkingInsights.ts` (`computeBenchmarking` → `cohortSeeded`, `metrics[]` with `p50/p90/percentile/rating`) | The "benchmark position" tile |
| Presets | `api/src/application/dashboards/dashboardPresets.ts` (`DASHBOARD_PRESETS`, `PresetTile`, `applyDashboardPreset(db, tenantId, segmentId, presetKey, createdBy)` idempotent, `presetMetricKeysAreWhitelisted`) | Every vertical preset |
| Metric whitelist | `api/src/application/dashboards/metricRegistry.ts` (`MetricDef { label, unit, description, goodWhenUp?, compute, series? }`) | Every new metric key |
| Widget ids | `api/src/application/dashboards/widgetIds.ts` (`COMPOSABLE_WIDGET_IDS`) ↔ `frontend/src/components/widgets/allComponents.ts` ↔ `frontend/src/components/insights/askWidgetIds.test.ts` | Every new widget |
| Widget module pattern | `frontend/src/components/insights/widgets/financeWidgets.tsx` (`FINANCE_COMPONENTS`), `frontend/src/lib/widgets/sharedSource.ts` (`useSharedSource`) | Copy for `founderWidgets.tsx` etc. |
| Templates | `api/src/domain/template/templateManifest.ts` (`TemplateManifest`, `TEMPLATE_OUTPUT_KINDS`, `TemplateOutput`), `api/src/application/templates/outputKinds.ts` (`registerOutputKind`, `OutputResult`, `MaterializeOutputContext`), `templates/defaults/{dsl.ts,index.ts}` (`BuiltinTemplate`, `ask`, `projectStep`), `installTemplate.ts`, `templateRegistry.ts` (origin `builtin`) | The product packaging |
| Template routes | `api/src/presentation/routes/templateRoutes.ts` — `GET /`, `GET /:key`, `POST /:key/setup`, `POST /:key/install` (DEVELOPER) | No new route needed |
| Marketplace surface | `frontend/src/lib/marketplaceFamilies.ts` (asset family, `template` chip), `MarketplacePageClient.tsx`, `/templates?open=<key>` wizard | Cards appear automatically for built-ins |
| Runway | `computeRunway`, `zeroCashDateFrom`, `projectCashflow` (contract), `application/finance/runwayReport.ts` (`runwayReport(db, env, tenantId, companyId)`), `GET /api/bi/runway` | Founder-layer computes |
| Equity | `application/finance/equity.ts` (`capTable`, `modelRound`, `cliffsDueWithin`, `grantVesting`), `share_classes` terms (`liquidation_multiple`, `participating`, `seniority`, `conversion_ratio`), `equityVersionKey` | Founder-layer computes + the waterfall |
| Observed finance | `metric_facts` keys `finance.burn`, `finance.revenue`, `finance.cash`, `finance.mrr`, `finance.runway_months`, `finance.monthly_burn` (`kernel/rollups/finance.ts`) | `growth.*` computes |
| Declared KPIs | `custom_kpis` (`key, name, unit, goodDirection, target, cadence`) + `kpi_formulas` (versioned `expression`, `inputs`) | Milestone and hand-entered tiles |
| Canvas spec kinds | `frontend/src/lib/founderObjects.ts` (`FOUNDER_OBJECT_SPECS`, `derive` fields), `packages/creation-canvas-contract/src/objectKinds.ts` | `marketSize`, `exitScenario` |
| Deck binding | `api/src/application/deck/dataSources.ts` | Market slide ← `marketSize` |
| `/finance` | `frontend/src/components/finance/FinanceClient.tsx` (`?tab=`), `RunwayView.tsx`, `CashflowView.tsx`, `lib/financeApi.ts` | The dashboard tab |

## 2. Slice A — the product exists and installs (founder layer)

### A1. `dashboard` template output kind
- `api/src/domain/template/templateManifest.ts`: add `'dashboard'` to `TEMPLATE_OUTPUT_KINDS`; add
  ```ts
  export interface DashboardOutput {
    kind: 'dashboard';
    id: string;
    /** A key of DASHBOARD_PRESETS. */
    preset: string;
    /** When set, the install aligns the tenant's benchmark cohort to this sector. */
    sector?: string;
    /** From the template's `size_band` step, bound as `{{setup.size_band}}`. */
    sizeBand?: 'small' | 'mid' | 'large';
  }
  export type TemplateOutput = WorkflowOutput | TasksOutput | DashboardOutput;
  ```
  Validate `preset` is a non-empty `[a-z0-9_]+` string and `sector`, when present, satisfies `isStartupSector` (import from the contract package). Update the manifest validation error text list at the existing site (~line 244).
- `api/src/application/templates/outputKinds/dashboardOutput.ts` (new file; do not grow `outputKinds.ts` beyond the registration import): `registerOutputKind<DashboardOutput>({ kind: 'dashboard', async materialize(output, ctx) { … } })`. Body: `if (!isPresetKey(output.preset)) return { ok:false, error: uninstallableOutputError-style sentence naming listPresetKeys() }`; then

  ```ts
  const { dashboardId, createdDashboard, addedWidgets } =
    await applyDashboardPreset(ctx.db, ctx.tenantId, segmentId, output.preset, createdBy);
  if (output.sector) await alignBenchmarkIndustry(ctx.db, ctx.env, ctx.tenantId, output.sector);
  if (output.sizeBand) await setBenchmarkProfile(ctx.db, ctx.env, ctx.tenantId, { industry: output.sector ?? current, sizeBand: output.sizeBand });
  return { ok: true, href: '/finance?tab=dashboard', ref: String(dashboardId), detail: `${addedWidgets} tile(s) placed` };
  ```

  Two signature facts, already verified — do not rediscover them:
  - **`applyDashboardPreset` already returns the counts**: `Promise<ApplyPresetResult>` = `{ dashboardId, createdDashboard, addedWidgets }`. Nothing to extend. Write `detail` from `addedWidgets` and `createdDashboard`.
  - **Its `segmentId` parameter is `string`, but `MaterializeOutputContext.segmentId` is `string | null`.** Decide once and state it in the module header: pass `ctx.segmentId ?? ''` only if `''` is what `GET /api/dashboards/dashboards` lists on for a segmentless tenant — check `dashboardsRoutes.ts`'s own scope call — otherwise widen `applyDashboardPreset` to `string | null` and let the query use `isNull`. Getting this wrong materialises the dashboard into a segment the installer cannot open, which is the exact failure the function's own comment warns about.
  - `createdBy` is not on the context: add `installedByUserId: number | null` to `MaterializeOutputContext` and thread it from `installTemplate.ts` (the route knows the user), then pass `String(installedByUserId)` or `null`.
  - Import the module for its side effect from `outputKinds.ts` (one line) so registration happens at load, exactly as `workflow`/`tasks` do.
- Tests: `outputKinds.test.ts` (or the existing templates contract test) — `registeredOutputKinds()` includes `dashboard`; materialising twice inserts once; an unknown preset reports `ok:false` with the installable preset list; a `sector` aligns the benchmark profile (assert through `getBenchmarkProfile`).

### A2. Presets
- `dashboardPresets.ts`: add `founder` and one entry per `DashboardVertical` (`ai_ml`, `saas`, `fintech`, `healthtech`, `medtech`, `biotech`, `climate_energy`, `hardware_robotics`, `cybersecurity`, `marketplace`). In slice A each vertical preset is `founder`'s tiles plus a single `{ widgetKey: 'bench.position', title }` tile; slices B and D fill them. `name` strings: `'Founder'`, `'SaaS'`, `'AI-native'`, `'FinTech'`, `'Digital health'`, `'MedTech'`, `'BioTech'`, `'Climate & energy'`, `'Hardware & robotics'`, `'Cybersecurity'`, `'Marketplace'` (the `saved_dashboards.name` is also the idempotence key — keep them stable).
- `founder` tiles, in order: `finance.runwayMonths` (stat) · `finance.cash` (stat) · `finance.netBurn` (stat) · `finance.cashZeroDate` (stat, unit `date`, see A3) · `equity.founderOwnership` (stat) · `equity.poolUnallocated` (stat) · `equity.cliffsDue90d` (stat) · widget `founder.runway-projection` · widget `founder.ownership` · widget `bench.position`.
- Add a test in `dashboardPresets.test.ts` asserting every `DashboardVertical` is a `PresetKey` and every preset's metric keys are whitelisted (extend the existing assertion).

### A3. Metric keys (founder layer) in `metricRegistry.ts`
Each `compute` calls an existing service; no SQL of its own:
- `finance.runwayMonths` — `runwayReport(...)` for the tenant's listed company (resolve the company via `application/investor/companyWorkspace.ts`; if the tenant has several, the one with `is_publicly_listed` or the newest); return `verdict.months` or `null`. `goodWhenUp: true`, unit `months`.
- `finance.cash` — declared `cash_on_hand` if `finance_declared_at` is set, else observed `finance.cash` latest fact; unit `USD`.
- `finance.netBurn` — `computeRunway(...).netBurn`; `goodWhenUp: false`, unit `USD`.
- `finance.cashZeroDate` — `zeroCashDateFrom(...)` as a UTC day number (`MetricDef.unit: 'date'`; add `'date'` to the unit rendering in the stat widget if not present, rendering through `useFormat().date`).
- `equity.founderOwnership` — `capTable(...)`, sum of holders with `role='founder'` fully diluted %; unit `%`.
- `equity.poolUnallocated` — pool class authorized minus granted, as % fully diluted; unit `%`.
- `equity.cliffsDue90d` — `cliffsDueWithin(db, tenantId, 90).length`; `goodWhenUp` omitted.
The `series` hook for `finance.netBurn` and `finance.cash` reads the 12-month `runwayReport.observed` pivot (month grain is fine; `MetricPoint` accepts any date).
The registry file is already large: put these in `metricRegistry/founderMetrics.ts` exporting `FOUNDER_METRICS: Record<string, MetricDef>` and spread it into the whitelist object; do the same for every later family (`growthMetrics.ts`, …). Keep `metricRegistry.ts` as the aggregation point only.

### A4. Widgets
- `api/src/application/dashboards/widgetIds.ts`: add `'founder.runway-projection'`, `'founder.ownership'`, `'bench.position'`.
- `frontend/src/components/insights/widgets/founderWidgets.tsx` — `FOUNDER_COMPONENTS`: `founder.runway-projection` (12-month cash line from `financeApi.runway()`, using the `TrendChart` primitive in `components/charts/`, watch/critical bands from `RUNWAY_WATCH_MONTHS`/`RUNWAY_CRITICAL_MONTHS`), `founder.ownership` (`DonutChart` over `capTable` holders: founders / investors / pool / unallocated), and `bench.position` (rating pill + percentile from `benchmarkingApi.get()`; when `cohortSeeded` is false render the `insights.benchmarking.noCohort` sentence). Each card body only; `WidgetCard` supplies chrome. Data through `useSharedSource` so N tiles dedupe to one request. Spread into `allComponents.ts`.
- i18n: `widgets.title.founder.*`, `widgets.group.founder` in all five catalogs.

### A5. Built-in templates
- `api/src/application/templates/defaults/verticalDashboards.ts`: `BuiltinTemplate[]` generated from `DASHBOARD_VERTICALS` plus `founder`:
  ```ts
  key: `vertical-dashboard-${sector}`   // and 'vertical-dashboard-founder'
  category: 'analytics'
  icon: per vertical (🤖 🧩 💳 🩺 🩹 🧬 🌍 🦾 🛡️ 🛒; founder 🚀)
  requiredConnectors: []
  steps: [ choose('size_band', 'How big is the team?', [['small','1–20'],['mid','21–200'],['large','200+']]) ]
  outputs: [ { kind: 'dashboard', id: 'dashboard', preset: sector, sector, sizeBand: '{{setup.size_band}}' } ]
  ```
  Two DSL facts, already verified:
  - **`BuiltinTemplate` is `Omit<TemplateManifest, 'requiredSecrets' | 'tags' | 'successCriteria'>`** — do not write those three fields; the barrel supplies them.
  - **`defaults/dsl.ts` has no `choice` helper** (it exports `trigger`, `llm`, `agent`, `call`, `transform`, `filter`, `output`, `chain`, `needs`, `checklist`, `ask`, `projectStep`). Add `choose(id, title, options, help?)` to `dsl.ts` returning a `GuidedStep` of `kind: 'choice'` with `options: ChoiceOption[]` and `required: true` — eleven templates need it, so it belongs in the DSL rather than eleven inline literals.

  Names and summaries come from the PRD 25 §5 tables (one sentence each). Register in `defaults/index.ts` (`ALL`). `sizeBand` on the output is bound by the existing `{{setup.x}}` binder, so add it to `DashboardOutput` in A1 and validate it against `['small','mid','large']`.
- Names/summaries/step titles of built-in templates are English in code today (check how `business.ts` is localized — if the catalogue localizes by key, add `templates.builtin.vertical-dashboard-*.{name,summary}` keys in five catalogs; if not, follow the existing convention and note it).
- Test: `templateRegistry` lists eleven `vertical-dashboard-*` keys with origin `builtin`; `isReservedTemplateKey('vertical-dashboard-saas')` is true.

### A6. `/finance` dashboard tab
- `FinanceClient.tsx`: add `tab=dashboard`, default when the tenant has a `saved_dashboards` row named after a preset (read via the existing `GET /api/dashboards/dashboards`); otherwise keep `runway` default and show a `DashboardInstallPrompt` (new small component: one sentence + a link to `/templates?open=vertical-dashboard-<verticalForSector(company.sector) ?? 'founder'>`). Render the dashboard with the existing `WidgetGrid`/`ReorderableWidgetGrid` over `GET /api/dashboards/dashboards/:id/data`.
- i18n: `finance.dashboard.*` keys × 5.

### A7. Dogfood + ship
- Builderforce's own workspace: declare `sector = 'saas'` on its `companies` row (through `/investor?tab=listing`), install `vertical-dashboard-saas` from `/marketplace?family=asset&kind=template`, confirm `/finance?tab=dashboard` renders with the founder tiles and the benchmark position.
- Release note (category `new`): "Install your vertical's KPI dashboard from the Marketplace". Blog post per §0.
- Proof/kill from PRD 25 §7 row A recorded in the roadmap entry.

## 3. Slice B — SaaS and AI-native are real (growth metrics, LTV tranches, seeds)

### B1. Producers
`growth.*` needs monthly facts. Extend `kernel/rollups/finance.ts` (or add `kernel/rollups/growth.ts` registered in `rollupRegistry.ts`) to emit from the ledger/subscription sources already synced (`ledger_accounts`, `invoices`, `revenue-intel`): `growth.mrr`, `growth.new_mrr`, `growth.expansion_mrr`, `growth.contraction_mrr`, `growth.churned_mrr`, `growth.customers`, `growth.customers_lost`, `growth.cogs`, `growth.sm_spend`, `growth.inference_spend`. Where no source exists, the metric stays declared via `custom_kpis` (the compute falls back to the latest `kpi_formulas` evaluation; add `application/dashboards/declaredKpi.ts` with `latestDeclaredValue(db, tenantId, key)` and reuse it everywhere).

### B2. Metric keys — `metricRegistry/growthMetrics.ts`
`growth.mrr`, `growth.arrGrowth`, `growth.nrr`, `growth.grr`, `growth.grossMargin`, `growth.cac`, `growth.cacPayback`, `growth.ltv`, `growth.ltvCac`, `growth.magicNumber`, `growth.burnMultiple`, `growth.logoChurn`; `metricRegistry/aiMetrics.ts`: `ai.inferenceMarginPct`, `ai.inferenceCostPerUnit`, `ai.inferenceEfficiency`. Formulas in PRD 25 §5.3. Denominator zero → `null`.

### B3. LTV tranches
- `application/dashboards/ltvTranches.ts`: pure `computeLtvTranches(rows, { dimension: 'plan' | 'cohort' | 'channel' | 'segment' })` over per-customer rows `{ id, plan, cohortMonth, channel, segment, arpa, marginPct, churnPct, cac }` → `{ tranche, ltv, cac, ratio, paybackMonths, declared: boolean }[]`; the per-customer rows come from the same ledger read as B1 (a new `application/finance/customerEconomics.ts` port; declared fallback from the churn calculator's assumption, flagged `declared: true`).
- Widget `growth.ltv-tranches` (horizontal bars, one hue, 3:1 reference line, the tranche below 3:1 named as the next action; table view for accessibility). Route `GET /api/dashboards/ltv-tranches?dimension=` cached under the finance rollup version key.
- Unit test on the pure function: blended vs tranche disagreement, `null` on zero churn, declared flag propagation.

### B4. Seeds
- Migration `1177_vertical_benchmark_seeds.sql`: `industry_benchmarks` rows for `saas` and `ai_ml` × small/mid/large × the §5.3 metrics that have a public band (`nrr_pct`, `grr_pct`, `gross_margin_pct`, `cac_payback_months`, `ltv_cac_ratio`, `magic_number`, `burn_multiple`, `logo_churn_pct_monthly`, `arr_growth_pct`; `ai_ml` adds `inference_margin_pct`). Every row's `source` names the report and quarter from PRD 25 §9. `ON CONFLICT (industry, size_band, metric) DO NOTHING`.
- `benchmarkingInsights.ts`: `BENCHMARK_METRICS` and `liveValues` gain the growth keys, sourced from the B2 computes (extract `liveValues` assembly into `benchmarkLiveValues.ts` so the lens file does not grow).

### B5. Fill presets + ship
`saas` and `ai_ml` presets get their §5.3 tiles (stat + trend pairs where a `series` exists). Widgets `saasWidgets.tsx`, `aiWidgets.tsx`; ids in `widgetIds.ts`; i18n × 5. Release note + blog.

## 4. Slice C — ownership math beside the numbers (waterfall, market size)

### C1. Exit waterfall
- `api/src/application/finance/exitWaterfall.ts` (new, beside `equity.ts`): pure
  ```ts
  computeWaterfall(input: {
    holders: CapTableHolder[]; classes: ShareClassRow[];
    exitValue: number; debt?: number; vesting: 'normal' | 'accelerated'; asOf: Date;
  }): { byClass: { classRef, preference, participation, converted: boolean, payout }[];
        byHolder: { partyRef, payout, multiple: number | null }[];
        breakpoints: { exitValue, classRef, event: 'preference_satisfied' | 'converts' }[] }
  ```
  Algorithm: net exit = exitValue − debt; walk classes by `seniority` paying `liquidation_multiple × invested` (preferred only); participating classes then share pro rata with common; a non-participating class converts when its as-converted share exceeds its preference (that crossing is a breakpoint); options count if in the money and vested by `asOf` under `vesting`. Sensitivity = map over an exit-value range; goal-seek = bisection on `computeWaterfall` for a target holder multiple.
- `POST /api/equity/waterfall` in `equityRoutes.ts` body `{ companyRef, exitValue, debt?, vesting?, asOf? }` → cached under `equityVersionKey`; `POST /api/equity/waterfall/sensitivity` `{ …, from, to, steps }`.
- Canvas kind `exitScenario` in `FOUNDER_OBJECT_SPECS` (fields `exitValue`, `debt`, `vesting`; `derive`: founder payout, investor payout, pool payout — computed from the board's `capTable` object through the existing `canvasEquityTools.ts` seam, never stored). Metric key `equity.exitPayoutAt` (three stats: $25M/$100M/$250M defaults, editable through the tile's config).
- Tests: `exitWaterfall.test.ts` — 1× non-participating converts above breakpoint; participating with cap; seniority stack; debt reduces net; accelerated vs normal vesting; goal-seek converges. Cross-check one case against a hand-built spreadsheet and record the numbers in the test.

### C2. Market size
- Contract: add `marketSize` to `objectKinds.ts` founder family. `FOUNDER_OBJECT_SPECS['marketSize']`: fields `method` (`bottom_up`|`top_down`), `potentialCustomers`, `serviceableCustomers`, `reachableCustomers`, `arpa`, `achievableShare`, `topDownMarket`, `topDownShare`, `sources` (list); `derive`: `tam`, `sam`, `som`, `triangulationGap` (percent difference between methods; `undefined` when either is missing), render style `math`. Enforce `som ≤ sam ≤ tam` in the derive (return `undefined` and a `verdict` field `'inconsistent'` otherwise).
- Deck: `application/deck/dataSources.ts` gains a `marketSize` source so the market slide binds `tam/sam/som` from the board object.
- Tile `founder.market-size` (concentric SVG, one hue ramp) reading the board object through the canvas widget host (`packages/canvas-widget-protocol`); the `/finance` dashboard shows it only when the company's board has one.
- i18n: `creationCanvas.founder.field.*` for the new fields × 5. Release note + blog.

## 5. Slice D — the other eight verticals

For each of `fintech`, `healthtech`, `medtech`, `biotech`, `climate_energy`, `hardware_robotics`, `cybersecurity`, `marketplace`:
- Metric family file `metricRegistry/<family>Metrics.ts` per PRD 25 §6.2 (`payments.*`, `health.*`, `clinical.*`, `bio.*`, `climate.*`, `hardware.*`, `security.*`, `market.*`). Milestone tiles (regulatory stage, development stage, production stage, reimbursement status, licences, TRL, certifications) are `custom_kpis` with an ordinal unit: add `unit: 'stage'` handling in the stat widget that renders the stage bar (one `StageBar` component, stages passed as data from the metric's `description` or a `stages` field on `MetricDef`).
- Widgets module per vertical; ids; i18n × 5.
- Seeds migration `1178_vertical_benchmark_seeds_2.sql` with sourced rows only; verticals without a public band get no rows (the lens says `cohortSeeded: false`).
- Fill the eight presets; the template manifests already exist from A5.
- Design-partner proof per vertical (PRD 25 §7). Release note + blog per vertical batch.

## 6. Small items to close on the way

- `practiceOpsRoutes.ts` (`:209/:518`) and `founderNetworkRoutes.ts` (`:87`) write `companies.sector` free-form; route them through `validateListingPatch` (or `isStartupSector`) in slice A when the listing is touched.
- `benchmarkingRoutes.ts` still keeps `BenchmarkProfileBody` (zod) in the route; fine, but the `sizeBand` step answer from A5 must pass through `resolveBenchmarkProfilePatch` so both doors bound the same way.
- `frontend/src/lib/benchmarkingApi.ts` comment says cohorts are labelled by `useStartupLabels` — keep it true if the lens moves.
- The first-draft HTML page (`c:\tmp\beyond-carta.html`) predates the ten-vertical list; PRD 25 is authoritative.

## 7. Definition of done, per slice

| Slice | Done when |
|---|---|
| A | `vertical-dashboard-*` cards visible under Marketplace → Assets → Templates; installing `vertical-dashboard-saas` on the Builderforce workspace produces `/finance?tab=dashboard` with the founder tiles and a benchmark position; `askWidgetIds`, `dashboardPresets`, template contract and all guards green; release note + blog live |
| B | A SaaS tenant with 3+ months of MRR facts sees NRR, GRR, CAC payback, LTV:CAC per tranche with bands; AI-native shows inference margin; seeds sourced; guards green; release note + blog |
| C | Three exits modelled from a real cap table match the recorded spreadsheet case; the deck market slide binds to a `marketSize` object; guards green; release note + blog |
| D | Eight presets filled with their tiles and milestone bars; seeds sourced where a band exists; two design partners per vertical running for a month; release notes + blog |
