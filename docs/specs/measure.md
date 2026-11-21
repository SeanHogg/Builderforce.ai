# 📊 Measure — grade the proof

> **Domain PRD — open work only.** Consolidated 2026-11-17 from the per-PRD specs that used to live in
> `docs/specs/NN-*.md`; every section was verified against the code that day. This file holds only
> what is left to build. Finished sections are archived word for word in `DONE.md` ("✅ RESOLVED 2026-11-17 — PRD NN:
> finished sections archived on consolidation"), with their § numbers kept, so a citation such as
> `PRD 38 §4.3` resolves to the `## PRD 38` section here (open) or to DONE.md (shipped).
> A gap in a PRD's numbering is a shipped section. Outstanding work is tracked in `ROADMAP.md` under **📊 Measure**.

**Holds:** Metrics, KPI dashboards, experiment measurement, Insights (session replay, heatmaps, funnels), creation outcome metrics.

## Contents

- [PRD 25 — Vertical KPI Dashboards](#prd-25--vertical-kpi-dashboards)
- [PRD 33 — Insights: session replay, heatmaps, live visitors and prescriptive fixes](#prd-33--insights-session-replay-heatmaps-live-visitors-and-prescriptive-fixes)
- [Design — Creation outcome metrics](#design--creation-outcome-metrics)

---

## Features and tasks — status

Verified against the code 2026-11-20. This replaces the per-section `Remaining (verified …)` notes, which were stale: each now points at a row ID below. **Status** is `Complete`, `Incomplete`, or `Blocked — operator` (needs a credential, a provisioned resource or a business relationship, not code). The prose in the sections that follow is unchanged and remains the spec.

### PRD 25 — Vertical KPI Dashboards

| ID | Feature / task | Spec § | Status | Evidence (file paths) |
|---|---|---|---|---|
| P25-01 | Vertical presets carry their §5.3 KPI tiles (saas, ai_ml, fintech, medtech, biotech and the rest) | §5.3 | Complete | `api/src/application/dashboards/dashboardPresets.ts`, `dashboardPresets.test.ts` |
| P25-02 | LTV tranches: `computeLtvTranches`, `customerEconomics` port, `GET /api/dashboards/ltv-tranches`, `growth.ltv-tranches` widget | §5.4, §25a.3 B3 | Complete | `api/src/application/dashboards/ltvTranches.ts` (+test), `api/src/application/finance/customerEconomics.ts` (+test), `api/src/presentation/routes/dashboardsRoutes.ts` |
| P25-03 | `marketSize` canvas kind with TAM/SAM/SOM derive, deck `dataSources.ts` binding | §5.5, §6.3, §25a.4 C2 | Complete | `packages/creation-canvas-contract/src/marketSize.ts` (+test), `objectKinds.ts`, `api/src/application/deck/dataSources.ts` |
| P25-04 | Metric keys `growth.*`, `ai.*` and vertical families (`clinical`, `payments`, `climate`, `hardware`, `security`, `market`) in the registry; `growth.*` is declared-only via `custom_kpis` (`latestDeclaredValue`) with derived cacPayback / ltv / ltvCac | §6.2, §25a.3 B2 | Complete | `api/src/application/dashboards/{growthMetrics,aiMetrics,declaredKpi,declaredStageKpi,clinicalMetrics,paymentsMetrics,climateMetrics,hardwareMetrics,securityMetrics,marketMetrics}.ts`, `verticalMetrics.test.ts`, `metricRegistry.ts` |
| P25-05 | Vertical widget modules and `StageBar`, ids in `COMPOSABLE_WIDGET_IDS` | §6.2, §25a.3 B5, §25a.5 | Complete | `frontend/src/components/insights/widgets/{saasWidgets,aiWidgets,verticalWidgets,verticalTiles,StageBar}.tsx`, `api/src/application/dashboards/widgetIds.ts` |
| P25-06 | Exit waterfall (`computeWaterfall`), `exitScenario` kind, `equity.exitPayoutAt`, waterfall routes | §6.3, §25a.4 C1 | Complete | `api/src/application/finance/exitWaterfall.ts` (+test), `exitWaterfallService.ts`, `api/src/application/dashboards/exitMetrics.ts` (+test), `objectKinds.ts` |
| P25-07 | B1 MRR-economics producer rollup (MRR, new/expansion/contraction/churned MRR, customers, COGS, S&M, inference spend) with fact names that do not collide with marketing `growth.leads/conversions/spend` | §6.2, §7 B, §25a.3 B1 | Complete | Evidence: `kernel/rollups/revenueEconomics.ts` (spread into `REVENUE_ROLLUP`) emits `revenue.mrr/newMrr/expansionMrr/contractionMrr/churnedMrr/customers/customersLost`; `growthMetrics.ts` derives NRR/GRR/logo churn when undeclared (COGS/S&M/inference spend remain declared) |
| P25-08 | B4 benchmark seeds for `saas` and `ai_ml` (sourced rows; `ON CONFLICT DO NOTHING`) plus `BENCHMARK_METRICS` growth keys and `benchmarkLiveValues.ts` extraction | §6.5, §25a.3 B4 | Complete | Evidence: `migrations/1359_measure_growth_benchmark_seeds.sql`, `insights/benchmarkLiveValues.ts`, growth keys in `BENCHMARK_METRICS` (source names are seed figures to verify before ship) |
| P25-09 | Slice D benchmark seeds for the other eight verticals (sourced rows only; no band, no rows) | §6.5, §25a.5 | Complete | Evidence: `api/migrations/1363_measure_cybersecurity_benchmark_seeds.sql` seeds cybersecurity `nrr_pct` and `burn_multiple` (the only §5.3 metrics with two sourced anchors; a lone anchor cannot rank). fintech, healthtech, medtech, biotech, climate_energy, hardware_robotics and marketplace get no rows ("no band, no rows") and stay `cohortSeeded: false` |
| P25-10 | FinanceLens reads the installed preset dashboard | §6.6 | Complete | Evidence: `FinanceLens.tsx` renders `FinanceDashboardView` (installed preset, pin control, Marketplace empty state) under `fin.verticalDashboard` in all five catalogs |
| P25-11 | `toPublicProfile` carries the benchmark rating (elite/high/medium/low, never numbers) | §6.6 | Complete | `api/src/application/investor/startupDirectory.ts`, `frontend/src/lib/startupDirectory.ts` |
| P25-12 | `companies.sector` validated through `isStartupSector` | §8 | Complete | `api/src/application/investor/companyWorkspace.ts` (`createCompany` uses `sectorFromInput`) |
| P25-13 | Release notes (category `new`) for slices B, C and D | §7 ship rule, §25a.0 | Complete | Evidence: `migrations/1360_release_note_measure_saas_ai_dashboards.sql`, `1361_release_note_exit_waterfall_market_size.sql`, `1362_release_note_vertical_milestone_dashboards.sql` |
| P25-14 | Slice D design-partner proof: two design-partner tenants per vertical run the dashboard for a month | §7 D, §25a.7 | Blocked — operator | Business relationship, not code |

### PRD 33 — Insights

| ID | Feature / task | Spec § | Status | Evidence (file paths) |
|---|---|---|---|---|
| P33-01 | D18 event lake (exact funnels, flow, segments) | §2 | Blocked — operator | Operator provisions the pipeline; a Pipelines binding fails deploy when the pipeline does not exist |
| P33-02 | `NEXT_PUBLIC_REPLAY_SITE_KEY` set for builderforce.ai | §11 | Blocked — operator | Read by `frontend/src/components/ReplayLoader.tsx`; set only in `frontend/.env.local.example` |
| P33-03 | Stripe secrets and webhook (session-replay pack checkout answers 503 until set) | §11 | Blocked — operator | Credentials; see Reach › Billing |

### Creation outcome metrics

| ID | Feature / task | Spec § | Status | Evidence (file paths) |
|---|---|---|---|---|
| OUT-01 | `costPerDelivery` producer: attach the authoritative run cost (`llm_usage_log.cost_usd_millicents`) to delivery outcomes | Metric definitions — Cost per delivered outcome | Complete | Evidence: `POST /:id/outcomes` in `creationSessionRoutes.ts` attaches `readDeliveryCostMillicents` on succeeded delivery actions; `proof.build` already did; `prescription.verify` has no run to attribute |
| OUT-02 | Presentation export of the sales brief (slides / PDF) | Instrumentation rollout | Complete | Evidence: `frontend/src/lib/outcomeSalesBriefExport.ts` renders a self-contained 16:9 HTML deck with `@page` rules; `OutcomeMetricsPanel.tsx` offers Markdown, HTML and Print (browser Save as PDF) exports, each content-free with definition version, denominator, window, freshness and suppressed-segment stamps |
| OUT-03 | Bind live experiment traffic (`experiment` in `CONNECTED_CANVAS_ACTIONS`) | Instrumentation rollout | Blocked | Blocker (verified 2026-11-21): `experiment` kind exists in `creation-canvas-contract` but has no `CONNECTED_CANVAS_ACTIONS` entry or adapter, and no live-traffic split measurement source exists; an authored table is not a measured split, so the producer must come first |

---

## PRD 25 — Vertical KPI Dashboards

> Consolidated 2026-11-17 from `docs/specs/25-prd-vertical-kpi-dashboards.md` and its hand-off `docs/specs/25a-vertical-kpi-dashboards-implementation.md` (25a sections appear here as §25a.N). Verified against code 2026-11-17: Partly built — Slice A shipped; Slices B, C, D not started.
> Finished sections are archived in DONE.md ("PRD 25: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

**Goal:** a preconfigured KPI dashboard per vertical, installed from the marketplace as a first-party template, with runway, ownership, exit payout, market size and LTV tranches on one surface. The product, the `dashboard` output kind, the founder layer and the eleven templates exist (DONE). What remains is the vertical content.

### §5.3 The vertical layers

Benchmarks are 2026 public figures and are seeds for `industry_benchmarks`, each row naming its `source`; none is a Builderforce claim.


**AI-native (`ai_ml`)**

| KPI | Definition | Benchmark |
|---|---|---|
| Gross margin after inference | (revenue − COGS incl. inference) ÷ revenue | ~52% average 2026; 60%+ is the credible plan |
| Inference cost per unit | Token/GPU spend ÷ requests (or ÷ active user) | Falling ~10× per year; trajectory matters more than level |
| Inference efficiency ratio | Inference spend ÷ revenue | Investors want a routing/caching plan to move it |
| ARR and growth, NRR, CAC payback | As SaaS | AI cohort raises at 2–3× SaaS multiples at the same ARR |
| Usage quality | Retained weekly active accounts, tasks completed | Distinguishes trial curiosity from adoption |
| Compute burn share | GPU/API spend ÷ total burn | — |

**SaaS (`saas`)**

| KPI | Formula | Benchmark |
|---|---|---|
| MRR / ARR and growth | Sum of active subscriptions; YoY | Median ARR growth 26% |
| Net revenue retention | (start ARR + expansion − contraction − churn) ÷ start ARR | ≥100% healthy, 120%+ top decile |
| Gross revenue retention | Same without expansion | ≥90% |
| Gross margin | (revenue − COGS) ÷ revenue | 70–85% |
| CAC payback (months) | CAC ÷ (ARPA × gross margin) | <12 elite, 15–18 median |
| LTV and LTV:CAC | ARPA × gross margin ÷ churn; by tranche §5.4 | 3:1 to 5:1 |
| Magic number | ΔARR quarter × 4 ÷ prior-quarter S&M | >0.75 efficient |
| Burn multiple | Net burn ÷ net new ARR | <1 great, 1–2 good |
| Logo churn | Customers lost ÷ start customers, monthly | <1% SMB monthly is strong |

**FinTech (`fintech`)**

| KPI | Definition | Benchmark |
|---|---|---|
| TPV / GMV | Total payment volume processed | Growth is the headline |
| Take rate and net revenue | Net revenue ÷ TPV | Payments 0.3–1%, marketplaces higher |
| Funded-account ratio | Accounts with balance or first transaction ÷ sign-ups | Activation, not sign-ups |
| Activation, DAU/MAU, ARPU | Standard engagement | DAU/MAU 20%+ for daily finance products |
| Fraud loss rate | Confirmed fraud losses ÷ TPV (bps); default rate for lending; AML alert-to-case | — |
| Reconciliation cycle time, payout latency | Operational | — |
| Licences and regulatory perimeter | Money transmitter, EMI, lending licences by jurisdiction | Milestone tile |

**Digital health (`healthtech`)**

| KPI | Definition | Benchmark |
|---|---|---|
| Engaged patients / members per month | Active in the last 30 days ÷ enrolled | The adoption number payers ask for |
| Patient acquisition cost | Acquisition spend ÷ new enrolled patients | CAC in this vertical |
| Revenue per member (PMPM) or per visit | Net revenue ÷ members ÷ months | — |
| Payer and employer contracts | Signed, in pilot, in pipeline | Milestone tile |
| Clinical outcome measure | The program's declared primary outcome vs baseline | Declared per company |
| Readmission / adverse-event rate, NPS | Quality and satisfaction | — |
| Provider utilisation | Visits ÷ provider capacity | — |

**MedTech (`medtech`)**

| KPI | Definition | Benchmark |
|---|---|---|
| Regulatory stage | concept → design freeze → V&V → submission (510(k) / De Novo / PMA / CE) → clearance → first commercial use | Headline tile |
| Months to next milestone vs runway | Planned months to clearance vs `computeRunway` | Runway > months-to-milestone plus buffer; 18–24 months post-raise |
| Regulatory spend share | Regulatory + clinical spend ÷ total | 510(k) averages $31M total, 77% regulatory; PMA $94M |
| Cost per clinical data point | Clinical spend ÷ enrolled subjects | — |
| Enrollment rate | Subjects ÷ plan, per site per month | — |
| Reimbursement status | none → code identified → coverage decision → payer contracts | Risk peaks after clearance; start at Series A |
| Installed base, ASP, gross margin | Post-clearance commercial | Devices 60–70% at scale |
| Quality system | Open CAPAs, complaint rate | ISO 13485 readiness |

**BioTech (`biotech`)**

| KPI | Definition | Benchmark |
|---|---|---|
| Development stage | discovery → lead → IND-enabling → IND cleared → Phase 1 → Phase 2 → Phase 3 → BLA/NDA | Headline tile; value inflects at IND and each readout |
| Runway to next value inflection | Cash ÷ R&D burn vs months to the next readout | 24+ months survived downturns; 11–14 did not; <12 is a red flag |
| R&D burn and burn split | Monthly; CRO/CDMO vs internal | Early-stage $100–250K/month lean |
| Cost per patient enrolled, enrollment vs plan | Trial economics | — |
| Probability-weighted milestone value | Milestone payments × phase success rate | Phase 2 ~20%, Phase 3 ~15% success; never plan on unweighted payments |
| Grant and non-dilutive share | Non-dilutive ÷ total funding | — |
| IP position | Patent families filed / granted | Milestone tile |

**Climate & energy (`climate_energy`)**

| KPI | Definition | Benchmark |
|---|---|---|
| Unit economics vs incumbent | LCOE, cost per tonne, or cost per unit vs the fossil/incumbent baseline | The cost curve is the pitch |
| tCO2e abated (measured) and abatement potential at scale | Life-cycle assessed | Some funds require 10 MtCO2e/yr at scale |
| Capacity deployed | MW, tonnes, units in the field | — |
| Offtake and project pipeline | Signed PPAs/offtake, LOIs, pipeline $ | — |
| Capex per unit of capacity, project IRR | Project finance readiness | — |
| Grants and non-dilutive share | — | — |
| Technology readiness level | TRL 1–9 | Milestone tile |

**Hardware, robotics, defence (`hardware_robotics`)**

| KPI | Definition | Benchmark |
|---|---|---|
| BOM cost and hardware gross margin | Unit COGS; (ASP − COGS) ÷ ASP | Well below SaaS; trajectory to 40–50% at volume |
| Units shipped, installed base, uptime | Fleet metrics | — |
| Backlog and contract pipeline | Signed backlog $; SBIR/OTA/prime contracts by stage | Defence: procurement stage is the milestone |
| Production run stage | prototype → pilot run → first production run → rate production | Headline tile |
| Inventory turns, lead time | Supply chain | — |
| Service revenue share | Recurring ÷ total | — |
| Certifications | Safety, export (ITAR), sector certs | Milestone tile |

**Cybersecurity (`cybersecurity`)**

| KPI | Definition | Benchmark |
|---|---|---|
| ARR, growth, NRR, gross margin | As SaaS | $3M ARR institutional threshold; NRR 110%+ sticky; burn multiple <1.5 |
| Pipeline coverage | Open pipeline ÷ quota | 3–5× for enterprise cycles |
| POC conversion and time to value | POCs won ÷ started; days to first detection | Cycle stalls on POC, budget freeze, champion loss |
| Funnel conversion | Lead→MQL 24%, MQL→SQL 40%, SQL→closed 46% (sector medians) | — |
| Customer security outcomes | MTTD / MTTR delivered for customers | No universal standard; report the delivered number |
| Compliance attestations | SOC 2, ISO 27001, FedRAMP stage | Milestone tile |

**Marketplaces & consumer commerce (`marketplace`)**

| KPI | Definition | Benchmark |
|---|---|---|
| GMV and take rate | Gross volume; net revenue ÷ GMV | — |
| Liquidity | Fill rate, time to match, search-to-transaction | The marketplace-specific number |
| Supply and demand growth, concentration | Active sellers/buyers; top-10 share | — |
| Repeat rate, cohort retention | Buyers transacting again within 90 days | — |
| CAC by side, payback | Supply CAC vs demand CAC | — |
| Contribution margin per order | After payments, fulfilment, support | — |
| DAU/MAU, NPS | Consumer engagement | — |


**Status:** see [P25-01](#features-and-tasks--status) (Complete).

### §5.4 LTV tranches

A single blended LTV is a vanity number. A **tranche** is a partition of the customer base that gets its own LTV, CAC and payback so the founder sees which pocket pays. Tranche dimensions, in priority order: **plan tier**, **acquisition cohort** (month of first payment), **acquisition channel**, **segment** (SMB / mid-market / enterprise). The dashboard shows LTV:CAC per tranche as one chart and names the tranche below 3:1 as the next action.

LTV per tranche = ARPA(tranche) × gross margin ÷ monthly churn(tranche). Cohort tranches use observed retention curves once 12+ months of `metric_facts` exist; before that the churn calculator's assumption is used and the tile is labelled *declared*, the same claim-to-proof rule `/finance` already applies.

**Status:** see [P25-02](#features-and-tasks--status) (Complete).

### §5.5 TAM / SAM / SOM

Both methods, side by side, with the assumptions written down. **Bottom-up** is primary: SOM = reachable customers × ARPA × achievable share; SAM = serviceable customers × ARPA; TAM = all potential customers × ARPA. **Top-down** triangulates from a cited market figure and a share assumption. Rules the object enforces: SOM ≤ SAM ≤ TAM; SOM is tied to the plan; the two methods within 15% of each other is a health mark; every figure carries a source.

**Status:** see [P25-03](#features-and-tasks--status) (Complete).

### §6.2 Metric keys and widgets

Every metric a preset names must be a `MetricDef` in `metricRegistry.ts`, which is the whitelist. The founder keys exist (`api/src/application/dashboards/founderMetrics.ts`, spread at `metricRegistry.ts:366`). Still to add, each with a `compute(db, tenantId, days)` over existing services, one family file per group beside `founderMetrics.ts`:

- `growth.mrr`, `growth.arrGrowth`, `growth.nrr`, `growth.grr`, `growth.grossMargin`, `growth.cac`, `growth.cacPayback`, `growth.ltv`, `growth.ltvCac`, `growth.magicNumber`, `growth.burnMultiple`, `growth.logoChurn`
- `ai.inferenceMarginPct`, `ai.inferenceCostPerUnit`, `ai.inferenceEfficiency`
- `clinical.stage`, `clinical.monthsToMilestone`, `clinical.regulatorySpendPct`, `clinical.costPerDataPoint`, `clinical.enrollmentRate`, `clinical.reimbursementStatus`
- `payments.tpv`, `payments.takeRate`, `payments.fundedAccountRatio`, `payments.fraudLossBps`, `payments.payoutLatency`
- `climate.unitCostVsIncumbent`, `climate.tco2eAbated`, `climate.capacityDeployed`, `climate.offtakePipeline`
- `hardware.bomCost`, `hardware.grossMargin`, `hardware.backlog`, `hardware.productionStage`
- `security.pipelineCoverage`, `security.pocConversion`, `security.timeToValue`
- `market.gmv`, `market.liquidity`, `market.repeatRate`, `market.contributionPerOrder`
- `equity.exitPayoutAt`

`compute` reads `metric_facts` for observed series and `custom_kpis`/`kpi_formulas` for hand-entered ones (the milestone tiles — regulatory stage, development stage, production stage, licences — are `custom_kpis` with an ordinal unit). No observed and no declared value returns `null`, rendered "Not measured", never zero.

Widgets: one `*_COMPONENTS` module per vertical under `frontend/src/components/insights/widgets/` (`saasWidgets.tsx`, …), spread into `allComponents.ts`, ids added to `COMPOSABLE_WIDGET_IDS`; `askWidgetIds.test.ts` enforces the three-way contract. Each tile: value, benchmark band, delta, next action. Titles under `widgets.title.*` in all five catalogs.

**Status:** keys — [P25-04](#features-and-tasks--status) (Complete); widgets — [P25-05](#features-and-tasks--status) (Complete); MRR-economics producer — [P25-07](#features-and-tasks--status) (Incomplete).

### §6.3 Exit waterfall and market size

`api/src/application/finance/exitWaterfall.ts` (new module beside `equity.ts`, not inside it): pure `computeWaterfall({capTable, shareClasses, exitValue, debt, vestingTreatment})` returning payout per class and holder, the breakpoints at which each class converts, and per-holder multiple. `POST /api/equity/waterfall` in `equityRoutes.ts` (cached under `equityVersionKey`). Canvas kind `exitScenario` with `derive` fields for the payouts. Sensitivity is the same function over a range; goal-seek is a bisection.

Canvas kind `marketSize` in `FOUNDER_OBJECT_SPECS`: fields `method`, `potentialCustomers`, `serviceableCustomers`, `reachableCustomers`, `arpa`, `achievableShare`, `topDownMarket`, `topDownShare`, `sources`; `derive` fields `tam`, `sam`, `som`, `triangulationGap`, returning `undefined` on missing inputs. The deck engine's `dataSources.ts` binds the market slide to it.

**Status:** see [P25-06](#features-and-tasks--status) (exit waterfall, Complete) and [P25-03](#features-and-tasks--status) (market size, Complete). Stored terms used: `share_classes.liquidation_multiple`, `participating`, `seniority`, `conversion_ratio`.

### §6.5 Benchmark seeds

Add `industry_benchmarks` rows for the §5.3 metrics per vertical and size band, each with a `source` naming the public report and quarter; a seed row with no source is rejected. Carta's own reports are a legitimate source for round-size, valuation and dilution bands. Compensation bands stay out until there is a licensed source.

**Status:** `saas` / `ai_ml` seeds — [P25-08](#features-and-tasks--status) (Incomplete); the other eight verticals — [P25-09](#features-and-tasks--status) (Incomplete). Seeds need migration numbers after the latest existing one (1177/1178 named in 25a were used by unrelated migrations).

### §6.6 Where it appears

- **Insights hub:** the same dashboard under the Finance lens, pinnable per user through `dashboard_pins`.
- **Marketplace company profile:** benchmark position only (elite/high/medium/low), never the numbers, extending `toPublicProfile()`.

**Status:** FinanceLens — [P25-10](#features-and-tasks--status) (Incomplete); `toPublicProfile` benchmark rating — [P25-11](#features-and-tasks--status) (Complete).

### §7 Sequencing (open slices)

| Slice | Build | Proof | Kill condition |
|---|---|---|---|
| B | `growth.*` and `ai.*` metric keys, LTV tranches, benchmark seeds; `saas` and `ai_ml` presets filled | A SaaS tenant with 3+ months of `finance.mrr` sees NRR and LTV:CAC per tranche with a band | Tiles read "Not measured" for most tenants because no producer writes `growth.*` facts (then the fix is the ledger connector, not the dashboard) |
| C | Exit waterfall + `exitScenario` kind + `marketSize` kind + deck binding | A founder models three exits and the deck's market slide binds to the canvas object | Waterfall payouts disagree with a hand-built spreadsheet on the test cap table |
| D | The remaining eight vertical presets with milestone tiles and their benchmark seeds | Two design-partner tenants per vertical run the dashboard for a month | No design partner in a vertical (the template stays listed with the founder layer until one appears) |

Ship rule for each slice: it is a new capability, so it carries a `release_notes` row (category `new`) and a methodology-framed blog post per the platform's feature-shipping rule.

### §8 Open items

- `companies.sector` is still written free-form. The practiceOps/founderNetwork sites originally named no longer write it; the live writer is `createCompany` (`api/src/application/investor/companyWorkspace.ts:368`, `input.sector?.trim() || null`, reached from `investorRoutes.ts`). Route it through `validateListingPatch` / `isStartupSector`.
- The seven verticals with no cohort get theirs with slices B and D (§6.5); until then the lens reports `cohortSeeded: false` and says so.

### §25a.0 Ground rules (apply to every remaining slice)

- **No new tables.** `api/src/application/migration/burnrateCutoverPolicy.json` has `newTablesAllowed: false` and `check-burnrate-cutover-policy.mjs` enforces it. Everything lands on `catalog_items`, `saved_dashboards`, `dashboard_widgets`, `dashboard_pins`, `metric_facts`, `custom_kpis`, `kpi_formulas`, `industry_benchmarks`, `tenant_benchmark_profiles`, `share_classes`, `objects`.
- **Presets, templates, verticals and metric keys are DATA.** Never add a `switch` on a vertical; a new vertical is a row in `DASHBOARD_VERTICALS`, a preset entry, a template manifest and i18n keys.
- **Layering.** Routes take application ports; no route imports a table. Materialisers and computes live in `application/`. Components call typed clients.
- **Null means "Not measured".** A metric with no observed and no declared value returns `null`; never `0`. Rates with no denominator are `null`.
- **Localize in the same pass.** Every visible string is a key in all five catalogs with real translations. Sector labels already exist under `startups.vocab.sector.*`; reuse them via `useStartupLabels().sector`.
- **Both themes, 360px.** Tiles use theme tokens only; the design-token guard rejects literals.
- **Guards after each slice:** `check-migrations`, `check:tenant-scope`, `check-burnrate-cutover-policy`, the design-token guard, `askWidgetIds.test.ts`, `dashboardPresets.test.ts`, the templates contract test.
- **Ship rule.** Each slice: a `release_notes` row (category `new`) and an Idea-to-Real blog post naming **Run → Measure**.

### §25a.3 Slice B — SaaS and AI-native are real

**B1. Producers.** `growth.*` needs monthly facts. Add a rollup (e.g. `kernel/rollups/` registered in `rollupRegistry.ts`) emitting from the ledger/subscription sources already synced (`ledger_accounts`, `invoices`, `revenue-intel`): MRR, new/expansion/contraction/churned MRR, customers, customers lost, COGS, S&M spend, inference spend. Choose fact names that do not collide with the existing marketing `growth.leads/conversions/spend` (`kernel/rollups/growth.ts`). Where no source exists, the metric stays declared via `custom_kpis` (add `application/dashboards/declaredKpi.ts` with `latestDeclaredValue(db, tenantId, key)` and reuse it everywhere).

**B2. Metric keys** — `growthMetrics.ts`, `aiMetrics.ts` beside `founderMetrics.ts`, keys per §6.2, formulas per §5.3. Denominator zero → `null`.

**B3. LTV tranches.** `application/dashboards/ltvTranches.ts`: pure `computeLtvTranches(rows, { dimension: 'plan' | 'cohort' | 'channel' | 'segment' })` over per-customer rows `{ id, plan, cohortMonth, channel, segment, arpa, marginPct, churnPct, cac }` → `{ tranche, ltv, cac, ratio, paybackMonths, declared }[]`; rows from a new `application/finance/customerEconomics.ts` port (declared fallback flagged `declared: true`). Widget `growth.ltv-tranches` (horizontal bars, one hue, 3:1 reference line, the tranche below 3:1 named as the next action; table view for accessibility). Route `GET /api/dashboards/ltv-tranches?dimension=` cached under the finance rollup version key. Unit test: blended vs tranche disagreement, `null` on zero churn, declared flag propagation.

**B4. Seeds.** A new migration: `industry_benchmarks` rows for `saas` and `ai_ml` × small/mid/large × `nrr_pct`, `grr_pct`, `gross_margin_pct`, `cac_payback_months`, `ltv_cac_ratio`, `magic_number`, `burn_multiple`, `logo_churn_pct_monthly`, `arr_growth_pct` (`ai_ml` adds `inference_margin_pct`). Every row's `source` names the report and quarter from §9. `ON CONFLICT (industry, size_band, metric) DO NOTHING`. `benchmarkingInsights.ts`: `BENCHMARK_METRICS` and `liveValues` gain the growth keys (extract `liveValues` assembly into `benchmarkLiveValues.ts`).

**B5. Fill presets + ship.** `saas` and `ai_ml` presets get their §5.3 tiles; `saasWidgets.tsx`, `aiWidgets.tsx`; ids; i18n × 5; release note + blog.

### §25a.4 Slice C — ownership math beside the numbers

**C1. Exit waterfall.** `api/src/application/finance/exitWaterfall.ts`, pure:
```ts
computeWaterfall(input: {
  holders: CapTableHolder[]; classes: ShareClassRow[];
  exitValue: number; debt?: number; vesting: 'normal' | 'accelerated'; asOf: Date;
}): { byClass: { classRef, preference, participation, converted: boolean, payout }[];
      byHolder: { partyRef, payout, multiple: number | null }[];
      breakpoints: { exitValue, classRef, event: 'preference_satisfied' | 'converts' }[] }
```
Algorithm: net exit = exitValue − debt; walk classes by `seniority` paying `liquidation_multiple × invested` (preferred only); participating classes then share pro rata with common; a non-participating class converts when its as-converted share exceeds its preference (a breakpoint); options count if in the money and vested by `asOf` under `vesting`. Sensitivity = map over a range; goal-seek = bisection. Routes `POST /api/equity/waterfall` and `/waterfall/sensitivity` in `equityRoutes.ts`, cached under `equityVersionKey`. Canvas kind `exitScenario` (fields `exitValue`, `debt`, `vesting`; derived payouts through `canvasEquityTools.ts`, never stored). Metric `equity.exitPayoutAt` (defaults $25M/$100M/$250M). Tests `exitWaterfall.test.ts`: non-participating converts above breakpoint; participating with cap; seniority stack; debt; accelerated vs normal; goal-seek converges; one hand-built spreadsheet case recorded.

**C2. Market size.** `marketSize` in `objectKinds.ts` founder family and `FOUNDER_OBJECT_SPECS` (fields and derive per §6.3; `som ≤ sam ≤ tam` enforced, else `verdict: 'inconsistent'`). Deck `dataSources.ts` gains a `marketSize` source. Tile `founder.market-size` via the canvas widget host; shown on `/finance` only when the board has one. i18n `creationCanvas.founder.field.*` × 5. Release note + blog.

### §25a.5 Slice D — the other eight verticals

For each of `fintech`, `healthtech`, `medtech`, `biotech`, `climate_energy`, `hardware_robotics`, `cybersecurity`, `marketplace`: a metric family file per §6.2; milestone tiles are `custom_kpis` with `unit: 'stage'` rendered by one `StageBar` (stages as data on `MetricDef`); a widgets module; ids; i18n × 5; a seeds migration with sourced rows only (no band → no rows); fill the preset (templates already exist); design-partner proof per §7; release note + blog per batch.

### §25a.7 Definition of done (open slices)

| Slice | Done when |
|---|---|
| B | A SaaS tenant with 3+ months of MRR facts sees NRR, GRR, CAC payback, LTV:CAC per tranche with bands; AI-native shows inference margin; seeds sourced; guards green; release note + blog |
| C | Three exits modelled from a real cap table match the recorded spreadsheet case; the deck market slide binds to a `marketSize` object; guards green; release note + blog |
| D | Eight presets filled with their tiles and milestone bars; seeds sourced where a band exists; two design partners per vertical running for a month; release notes + blog |

### 9. Sources

- Carta product and pricing: [Carta best cap table software guide](https://carta.com/best-cap-table-software/), [Carta finance solutions](https://carta.com/solutions/finance/), [Contrary Research on Carta](https://research.contrary.com/company/carta), [Spendflo pricing breakdown](https://www.spendflo.com/blog/how-much-does-carta-cost-a-breakdown-of-plans-and-pricing), [Pulley vs Carta pricing](https://sparklaun.ch/compare/carta-pulley), [Costbench Carta pricing](https://costbench.com/software/equity-management/carta/), [JustPricing Carta review](https://justpricing.com/carta-pricing)
- Carta scenario tools: [Scenario modeling](https://carta.com/equity-management/cap-table/scenario-modeling/), [Waterfall analysis](https://carta.com/learn/startups/exit-strategies/waterfall-analysis/), [Investor waterfall support article](https://support.carta.com/s/article/investors-waterfall)
- Carta data: [Data Desk](https://carta.com/data/), [State of Private Markets Q1 2026](https://carta.com/data/state-of-private-markets-q1-2026/), [State of Pre-Seed Q2 2026](https://carta.com/data/state-of-pre-seed-q2-2026/), [Startup Compensation H2 2025](https://carta.com/data/startup-compensation-h2-2025/), [Q2 2026 benchmark refresh](https://releasenotes.carta.com/quarterly-benchmark-refresh---q2-2026-37RSw)
- Vertical ranking: [Crunchbase 2025 funding by industry via Venture Capital Journal](https://www.venturecapitaljournal.com/funding-for-ai-dominated-in-vc-in-2025-crunchbase/), [Startup funding statistics by industry](https://blog.mean.ceo/startup-funding-statistics-by-industry/), [Euclid Ventures Vertical Report 2026](https://insights.euclid.vc/p/the-vertical-report-2026-full-version), [HubSpot VC trends 2026](https://www.hubspot.com/startups/fundraising/vc-fundraising-trends), [Venture Atlanta top industries 2026](https://www.ventureatlanta.org/top-startup-industries-2026/)
- Competitors: [Pulley on Carta competitors](https://pulley.com/guides/carta-competitors), [ValueAdd VC ranking](https://valueaddvc.com/blog/best-cap-table-management-tools-in-2026-carta-pulley-angellist-capdesk-ranked)
- SaaS: [Averi 2026 SaaS metrics](https://www.averi.ai/blog/15-essential-saas-metrics-every-founder-must-track-in-2026-(with-benchmarks)), [Eagle Rock CFO benchmarks by stage](https://www.eaglerockcfo.com/blog/research/saas-finance-metrics-benchmarks), [CFO Advisors Series A board deck benchmarks](https://cfoadvisors.com/blog/2026-series-a-board-deck-kpi-benchmarks)
- AI-native: [Avante Ventures AI gross margin benchmark 2026](https://avanteventures.com/en/library/ai-startup-gross-margin-benchmark-2026), [The SaaS CFO inference efficiency ratio](https://www.thesaascfo.com/how-to-calculate-the-inference-efficiency-ratio/), [AI Business metrics investors track](https://aibusiness.vc/startups/ai-startup-metrics-investors-track), [Value Add VC cost of running an AI product](https://valueaddvc.com/blog/the-true-cost-of-running-an-ai-product-in-2026-gpu-api-and-inference-bills)
- MedTech: [MedDeviceGuide funding guide 2026](https://meddeviceguide.com/blog/medical-device-startup-funding-guide-vc-2026), [Med Device Online investor milestones](https://www.meddeviceonline.com/doc/key-investor-milestones-every-med-device-developer-should-know-0001), [leanRAQA market pathway](https://leanraqa.substack.com/p/building-a-medtech-market-pathway)
- BioTech: [Qubit biotech seed modeling](https://qubit.capital/blog/financial-modelling-biotech-seed-round), [K38 biotech cash runway](https://k38consulting.com/biotech-15/), [Excel Business Resource biotech KPIs](https://excelbusinessresource.com/top-10-biotech-startup-kpis-for-investor/)
- Climate: [Višević on measuring climate performance](https://visevic.medium.com/how-to-measure-the-climate-performance-potential-of-startups-6cc7fdb4110f), [Carbon13 cohort investment](https://carbonthirteen.com/news/cohort-4-investment/), [Nature Tech Memos carbon capture 2026](https://www.naturetechmemos.com/p/top-10-carbon-capture-startups-for-corporate-partnerships-in-2026)
- Hardware and defence: [mHUB investor pitch metrics for hardware](https://mhub.org/events/investor-pitch-metrics-for-hardware-startups-145849), [Robots & Startups Goldilocks zone](https://robotsandstartups.substack.com/p/the-goldilocks-zone-for-robots-hard), [SVB startup KPIs](https://www.svb.com/startup-insights/startup-growth/startup-KPIs-to-master/)
- Cybersecurity: [FE International valuing a cybersecurity business 2026](https://www.feinternational.com/blog/cybersecurity-business-valuation), [Gangly cybersecurity sales cycle 2026](https://getgangly.com/blog/cybersecurity-sales-cycle), [Landbase pipeline coverage 2026](https://www.landbase.com/blog/pipeline-coverage-ratio-calculate-2026), [Fidelis MTTD](https://fidelissecurity.com/cybersecurity-101/learn/mean-time-to-detect-mttd/)
- FinTech and marketplaces: [Finro fintech KPI guide](https://www.finrofca.com/news/fintech-kpi-guide), [Databrain fintech KPIs](https://www.usedatabrain.com/blog/fintech-kpis-metrics), [Perceptive Analytics payments dashboards](https://www.perceptive-analytics.com/top-fintech-dashboards/)
- Digital health: [Massively Better Healthcare on evaluating digital health startups](https://www.massivelybetterhealthcare.com/resources/how-investors-evaluate-digital-health-startups), [OpenHunts startup metrics 2026](https://openhunts.com/blog/startup-metrics-kpis-complete-guide)
- Market sizing and LTV: [Waveup top-down vs bottom-up](https://waveup.com/blog/top-down-and-bottom-up-market-size-calculation/), [ICanPitch TAM SAM SOM guide](https://www.icanpitch.com/blog/tam-sam-som-market-sizing-guide), [Spike AI LTV methods](https://getspike.ai/blog/saas-ltv-calculation-formulas-benchmarks/), [ChartMogul LTV](https://chartmogul.com/saas-metrics/ltv/)


---

## PRD 33 — Insights: session replay, heatmaps, live visitors and prescriptive fixes

> Consolidated 2026-11-17 from `docs/specs/33-prd-session-replay.md`. Verified against code 2026-11-17: Shipped in code; production provisioning and the D18 event lake are open.
> Finished sections are archived in DONE.md ("PRD 33: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §2 D18 — event lake (deferred scale-up)
Funnels, flow, segments and AI digests run over kept recordings weighted by `sample_weight` and are shown as ≈. An event lake that makes them exact is a later scale-up; it is not a dependency of anything in this PRD.

**Status:** see [P33-01](#features-and-tasks--status) (Blocked — operator).

### §11 Production provisioning (operator)
Prerequisites: Stripe secrets and webhook; `CLOUDFLARE_API_TOKEN` with R2/DNS/Routes; the legal disclosure published (draft from migration 1219); `NEXT_PUBLIC_REPLAY_SITE_KEY` set for builderforce.ai; a non-superadmin test workspace.

**Status:** replay site key — [P33-02](#features-and-tasks--status); Stripe secrets (`POST /api/capabilities/session-replay/packs/:packId/checkout` answers 503 until set) — [P33-03](#features-and-tasks--status). Both Blocked — operator.

---

## Design — Creation outcome metrics

> Consolidated 2026-11-18 from `docs/design/creation-canvas/OUTCOME-METRICS.md`. Verified against code 2026-11-18: built. This is the north-star metric contract, kept as reference; it has three open gaps (cost is never sent, no presentation export of the sales brief, no live experiment-traffic binding).
> The whole document was also archived word for word in DONE.md on 2026-11-17 ("Design: Creation outcome metrics — finished sections archived on consolidation"). The text below is the living contract.

### Purpose

Builderforce measures whether one Creation Session moved a user from an idea to a **graded proof** — a Build whose kill condition was measured, not merely a deliverable that was produced. Runtime activity is useful diagnostic evidence, but it is not value by itself, and a deliverable nobody graded is a launch with extra steps.

The same outcome ledger serves three consumers:

1. The session scorecard opened from the outcome icon: this session versus an aggregated tenant baseline.
2. Project and tenant value reviews: outcomes, speed, quality, reuse, intervention, cost, and latency.
3. A privacy-safe sales deck: platform-level value generation without tenant content or identifying session data.

### Where the definitions live

Every metric is declared exactly once, in `api/src/application/outcomes/outcomeMetricContract.ts`. A metric carries both halves of its own definition — the **session** value (TypeScript, from the shared fact row) and the **aggregate** value (a SQL expression over the same facts) — so the session scorecard and every rollup compute the same number from the same rows. The single write path into the ledger is `api/src/application/outcomes/outcomeLedger.ts`; the presentation contract (labels, units, comparison arithmetic) is `frontend/src/lib/outcomeMetrics.ts`, shared by both the in-canvas scorecard and the superadmin Value outcomes panel.

`OUTCOME_DEFINITION_VERSION` rides every payload, so a deck states which definition set produced the figure it quotes.

### Correlation contract

Every meaningful action emits a `started` event and exactly one terminal event with the same `correlationId` and `action`. Terminal phases are `succeeded`, `failed`, `validated`, or `reused`.

Each event carries:

- scope: `sessionId`, `projectId` when applicable, and server-derived `tenantId`;
- actor: user, agent, Brain, or system;
- action and phase;
- optional artifact ID, metric key/value/unit, duration, cost, and non-sensitive metadata;
- occurrence time.

The API derives tenant and user identity rather than trusting client-supplied scope. Named agent/Brain actors are accepted only from session roles allowed to perform the action. A project ID is accepted only when it is linked to the session; a session ID supplied by a producer outside the canvas is accepted only when `resolveOutcomeSession` proves it is a live board in the caller's tenant that the caller belongs to. The unique `(session, correlation, action, phase)` key makes retries idempotent.

`correlation_coverage = terminal events with a matching started event / terminal events` is itself a first-class quality metric. A feature is not considered fully instrumented while this falls below 100% for its meaningful actions.

#### The proof lifecycle in the ledger

The method — Read → Prove → Build → Measure — records itself through `api/src/application/realization/proofOutcomes.ts`:

| Action | Emitted by | Meaning |
|---|---|---|
| `idea.read` | `POST /api/realizations/plan` | The idea was read into a spec and the proof forms were ranked. Nothing else is persisted by that call. |
| `proof.choose` | `POST /api/realizations` | A proof form was chosen. Carries the target's effort and fidelity. |
| `proof.build` | `POST /api/realizations/:id/build` | The proof was built. `succeeded` carries `metadata.reachable` when it published an address a person can open. |
| `proof.grade` | build success (`started`), verdict rollup (`validated`), park (`failed`) | The kill condition was measured. `metricValue` is 1 for met and 0 for missed — both are grades. Abandoning terminates as `failed`, because parking an idea is a judgement, not a measurement. |

A proof records nothing when it has no `realizations.session_id`: the ledger's grain is the session, and a proof started outside a board never entered that grain. Measurement is best-effort and can never fail a build; a lost write shows up honestly as `correlationCoverage` below 100%.

### Metric definitions

The north-star metric is **ideas reaching a graded proof**. Metrics are grouped by the act of the method they measure, and every surface renders them in this order.

| Metric | Family | Session value | Aggregate value | Direction |
|---|---|---:|---:|---|
| **Ideas reaching a graded proof** (north star) | Measure | 0 or 1 | sessions with a graded proof / eligible sessions | Higher |
| Time to a chosen proof form | Read → Prove | first `proof.choose` − first prompt | mean seconds | Lower |
| Ideas that Read before they Build | Read → Prove | 0 or 1, only once a build started | read-first builders / builders | Higher |
| Time to first meaningful artifact | Read → Prove | first non-chat artifact − first prompt | mean seconds | Lower |
| Proofs reaching a real, reachable artifact | Build | reachable builds / build attempts | same ratio over cohort | Higher |
| Sessions reaching a real deliverable | Build | 0 or 1 | delivered sessions / eligible sessions | Higher |
| Artifact validation pass rate | Build | passed validations / validations | same ratio over cohort | Higher |
| Delivery success rate | Build | successful deliveries / attempts | same ratio over cohort | Higher |
| Delivery retry rate | Build | failed attempts followed by another attempt / attempts | same ratio over cohort | Lower |
| Proofs whose kill condition was graded | Measure | graded proofs / proofs built | same ratio over cohort | Higher |
| Sessions inviting a human or agent | Collaboration | 0 or 1 | collaborative sessions / eligible sessions | Higher |
| Agent group-chat participation | Collaboration | distinct contributing agents | mean and distribution | Higher, with quality guardrail |
| Successful synthesis | Collaboration | 0 or 1 after agent turns | synthesized group sessions / group sessions | Higher |
| Sessions resumed in 7/30 days | Compounding value | 0 or 1 for each window | resumed sessions / eligible sessions | Higher |
| Outputs reused as inputs | Compounding value | reuse events | sum and per-session mean | Higher |
| Human intervention per delivery | Efficiency | intervention events / successful deliveries | same ratio over cohort | Lower, with safety guardrails |
| Cost per delivered outcome | Efficiency | attributed cost / successful deliveries | same ratio over cohort | Lower |
| Latency per delivered outcome | Efficiency | outcome duration | mean seconds | Lower |
| Correlation coverage | Measurement integrity | matched terminal events / terminal events | same ratio over cohort | Higher; target 100% |

“Real deliverable” requires a successful canonical delivery action such as publish, project handoff, or workflow execution. Creating a draft canvas object does not qualify. “Successful synthesis” requires an explicit Brain synthesis after participating agent turns; agent message volume alone does not qualify. “Graded” requires a measured verdict — met **or** missed; a proof that was abandoned was not graded, and the artifact validation pass rate deliberately excludes proof grading, because a missed kill condition is a finding rather than a defect.

### Metric definitions — Cost per delivered outcome

| Metric | Family | Session value | Aggregate value | Direction |
|---|---|---:|---:|---|
| Cost per delivered outcome | Efficiency | attributed cost / successful deliveries | same ratio over cohort | Lower |

**Status:** see [OUT-01](#features-and-tasks--status) (Incomplete). The metric is defined (`outcomeMetricContract.ts`, key `costPerDelivery`) and the ledger accepts `costUsdMillicents`, but no producer sends it, so it reads "Not measured"; the cost source is `llm_usage_log.cost_usd_millicents` via `costMetricsStore.ts`.

### Diagnostics that are not value

GitHub stars, package downloads, workflow counts, MCP connections, and active-agent counts remain operational or acquisition diagnostics. They are not evidence of customer value, they are absent from the metric registry, and they do not lead roadmap prioritization or any value review.

### Aggregation and sales-deck rules

- Session is the source grain. Project, tenant, and platform values are derived, never separately hand-entered.
- Project rollups include only sessions explicitly linked to that project.
- Tenant comparisons expose aggregates, sample size, scope, and time window—not peer session titles, prompts, artifacts, or users.
- The session scorecard's baseline is a cohort aggregate over the workspace's most recently active boards (`OUTCOME_BASELINE_COHORT`), computed with the same expressions the rollups use, and excludes the session being scored.
- Platform sales-deck figures use minimum cohort thresholds, suppress small segments, and include denominator, time window, and data freshness.
- Cost and latency remain `Not measured` until authoritative telemetry is attached. The UI never substitutes zero for missing data.
- Historical definitions are versioned. A deck states the definition version so a changing qualification rule cannot silently rewrite prior claims.

### Instrumentation rollout

The outcome ledger and scorecard are the foundation. Session open, prompt evaluation, validation, delivery, output reuse, and the full proof lifecycle (read, choose, build, grade) are correlated actions today. The superadmin Value outcomes dashboard supplies platform, tenant, and project cohorts; equal-period comparisons; trends including graded proofs; and a content-free sales brief guarded by a ten-session external-use threshold and stamped with its definition version. Canvas card acts share that contract through `packages/creation-canvas-contract/src/canvasActionOutcomes.ts`: the runner (and the poll / gate paths that are not card acts) emit `started` then one terminal with the same `correlationId`. `idea.explore`/`test`/`reveal` map onto `idea.read` / `proof.choose` / `proof.grade`; `form.publish` and `poll.publish` map onto `artifact.publish` + `proof.build` with `metadata.reachable` derived from the join URL (`/f/{slug}`, `/p/{slug}`). Unmapped connected acts still record as `{kind}.{action}` so coverage never depends on remembering a case. Notice-only refusals (no questions, unpublished, nothing to grade) do not start a correlation. Binding live experiment traffic is a different ticket — an authored table is not a measured split. A rendered presentation export remains follow-up work.

**Status:** presentation export — [OUT-02](#features-and-tasks--status) (Incomplete); live experiment traffic — [OUT-03](#features-and-tasks--status) (Incomplete; also tracked in ROADMAP Measure, "`experiment` cards are never measured").

*Verified 2026-11-18:* `OUTCOME_DEFINITION_VERSION` (`outcomeMetricContract.ts:65`, currently `2026.10-prescription-verify`); `OUTCOME_BASELINE_COHORT` (`:72`, 500 boards); the metric registry (`:264-467`; its families are `read-prove`, `build`, `measure`, `collaboration`, `compounding`, `efficiency`, `integrity`, in the table's order); proof actions (`api/src/application/realization/proofOutcomes.ts:53`); `resolveOutcomeSession` (`outcomeLedger.ts:129`, used by `api/src/presentation/routes/realizationRoutes.ts:53`); latency comes from the recorded `durationMs`. No drift in the contract text. The registry's labels are worded slightly differently from the table: "Successful agent synthesis", "Sessions resumed within 7 days" and "within 30 days" (two keys), "Created outputs reused as inputs", "Human interventions per delivery" and "Actions with a correlated outcome". The table names the concepts; `outcomeMetrics.ts` owns the labels on screen.

---
