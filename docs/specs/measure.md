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


**Remaining (verified 2026-11-17):**
- Every vertical preset is the founder tiles + `bench.position` only (`api/src/application/dashboards/dashboardPresets.ts:123-126,159`). No vertical KPI is in any preset.

### §5.4 LTV tranches

A single blended LTV is a vanity number. A **tranche** is a partition of the customer base that gets its own LTV, CAC and payback so the founder sees which pocket pays. Tranche dimensions, in priority order: **plan tier**, **acquisition cohort** (month of first payment), **acquisition channel**, **segment** (SMB / mid-market / enterprise). The dashboard shows LTV:CAC per tranche as one chart and names the tranche below 3:1 as the next action.

LTV per tranche = ARPA(tranche) × gross margin ÷ monthly churn(tranche). Cohort tranches use observed retention curves once 12+ months of `metric_facts` exist; before that the churn calculator's assumption is used and the tile is labelled *declared*, the same claim-to-proof rule `/finance` already applies.

**Remaining (verified 2026-11-17):**
- Not started: no `ltvTranches.ts`, `computeLtvTranches`, `customerEconomics.ts` or `growth.ltv-tranches` widget anywhere in `api/src` / `frontend/src`.

### §5.5 TAM / SAM / SOM

Both methods, side by side, with the assumptions written down. **Bottom-up** is primary: SOM = reachable customers × ARPA × achievable share; SAM = serviceable customers × ARPA; TAM = all potential customers × ARPA. **Top-down** triangulates from a cited market figure and a share assumption. Rules the object enforces: SOM ≤ SAM ≤ TAM; SOM is tied to the plan; the two methods within 15% of each other is a health mark; every figure carries a source.

**Remaining (verified 2026-11-17):**
- Not started: no `marketSize` kind in `packages/creation-canvas-contract/src`, `frontend/src/lib/founderObjects.ts` or `api/src/application/deck/dataSources.ts`.

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

**Remaining (verified 2026-11-17):**
- No `growth.*` MRR-economics producer: `api/src/application/kernel/rollups/growth.ts` emits only marketing `growth.leads` / `growth.conversions` / `growth.spend` (`:146,189,244`). The `growth.*` keys above need new fact names that do not collide with these.
- Only `founderWidgets.tsx` exists; no vertical widget module.

### §6.3 Exit waterfall and market size

`api/src/application/finance/exitWaterfall.ts` (new module beside `equity.ts`, not inside it): pure `computeWaterfall({capTable, shareClasses, exitValue, debt, vestingTreatment})` returning payout per class and holder, the breakpoints at which each class converts, and per-holder multiple. `POST /api/equity/waterfall` in `equityRoutes.ts` (cached under `equityVersionKey`). Canvas kind `exitScenario` with `derive` fields for the payouts. Sensitivity is the same function over a range; goal-seek is a bisection.

Canvas kind `marketSize` in `FOUNDER_OBJECT_SPECS`: fields `method`, `potentialCustomers`, `serviceableCustomers`, `reachableCustomers`, `arpa`, `achievableShare`, `topDownMarket`, `topDownShare`, `sources`; `derive` fields `tam`, `sam`, `som`, `triangulationGap`, returning `undefined` on missing inputs. The deck engine's `dataSources.ts` binds the market slide to it.

**Remaining (verified 2026-11-17):**
- Nothing built: `api/src/application/finance/` holds only `equity.ts`; `exitWaterfall`, `computeWaterfall`, `exitScenario`, `marketSize` return no hits in `api/src`, `packages`, `frontend/src`. Stored terms to use: `share_classes.liquidation_multiple`, `participating`, `seniority`, `conversion_ratio`.

### §6.5 Benchmark seeds

Add `industry_benchmarks` rows for the §5.3 metrics per vertical and size band, each with a `source` naming the public report and quarter; a seed row with no source is rejected. Carta's own reports are a legitimate source for round-size, valuation and dilution bands. Compensation bands stay out until there is a licensed source.

**Remaining (verified 2026-11-17):**
- No seed migration exists after `1176_vertical_vocabulary.sql`; the numbers 1177/1178 named in 25a were used by unrelated migrations, so seeds need new numbers. Cohorts with no seed today: `ai_ml`, `medtech`, `biotech`, `climate_energy`, `hardware_robotics`, `cybersecurity`, `marketplace` (lens reports `cohortSeeded: false`).

### §6.6 Where it appears

- **Insights hub:** the same dashboard under the Finance lens, pinnable per user through `dashboard_pins`.
- **Marketplace company profile:** benchmark position only (elite/high/medium/low), never the numbers, extending `toPublicProfile()`.

**Remaining (verified 2026-11-17):**
- `frontend/src/components/insights/FinanceLens.tsx` never reads the installed preset dashboard.
- `toPublicProfile` (`api/src/application/investor/startupDirectory.ts:187`) carries no benchmark rating.

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

**Remaining (verified 2026-11-17):**
- Not built, by design. *Blocker: operator provisions the pipeline (a Pipelines binding fails deploy when the pipeline does not exist).*

### §11 Production provisioning (operator)
Prerequisites: Stripe secrets and webhook; `CLOUDFLARE_API_TOKEN` with R2/DNS/Routes; the legal disclosure published (draft from migration 1219); `NEXT_PUBLIC_REPLAY_SITE_KEY` set for builderforce.ai; a non-superadmin test workspace.

**Remaining (verified 2026-11-17):**
- `NEXT_PUBLIC_REPLAY_SITE_KEY` is read by `frontend/src/components/ReplayLoader.tsx:44` but set nowhere except `frontend/.env.local.example:12`; no workflow injects it, so builderforce.ai records nothing.
- Stripe secrets unset (see Reach › Billing), so `POST /api/capabilities/session-replay/packs/:packId/checkout` answers 503.

---

## Design — Creation outcome metrics

> Consolidated 2026-11-17 from `docs/design/creation-canvas/OUTCOME-METRICS.md`. Verified against code 2026-11-17: Mostly built.
> This document is the north-star metric contract that ROADMAP.md:21 links to. Repoint that link to `docs/specs/measure.md` when this fragment lands.
> Its finished sections are archived in DONE.md ("Design — Creation outcome metrics — finished sections, archived 2026-11-17").
> The standing rules below stay in force, because every new metric must follow them:
> - Every metric is declared exactly once, in `api/src/application/outcomes/outcomeMetricContract.ts`, with both its session and its aggregate halves.
> - The ledger has a single write path, `outcomeLedger.ts`.
> - `OUTCOME_DEFINITION_VERSION` rides every payload.
> - Diagnostics such as stars, downloads, workflow counts, MCP connections and active agents are never value.
> - Cost and latency stay `Not measured` until authoritative telemetry is attached. The UI never substitutes zero.

### Metric definitions — Cost per delivered outcome

| Metric | Family | Session value | Aggregate value | Direction |
|---|---|---:|---:|---|
| Cost per delivered outcome | Efficiency | attributed cost / successful deliveries | same ratio over cohort | Lower |

**Remaining (verified 2026-11-17):**
- The metric is defined at `outcomeMetricContract.ts:435-446`, and the ledger accepts `costUsdMillicents` (`outcomeLedger.ts:58,94,111`; `api/src/presentation/routes/creationSessionRoutes.ts:337,1188`).
- No producer ever sends it. The only references outside the ledger are the route schema and the client type at `frontend/src/lib/builderforceApi.ts:8880`, so the metric is permanently "Not measured".
- The fix is to attach authoritative run cost to delivery outcomes. The source is the run's LLM usage, which `costMetrics/costMetricsStore.ts` already aggregates.

### Instrumentation rollout

A rendered presentation export of the sales brief remains follow-up work. Binding live experiment traffic is a different ticket, because an authored table is not a measured split.

**Remaining (verified 2026-11-17):**
- No presentation export of the sales brief exists. The brief is assembled from `outcomeMetricContract.ts` and `frontend/src/lib/outcomeMetrics.ts`, and nothing renders it as slides or a PDF.
- No live experiment-traffic binding exists. The experiment-measurement owner should track this (ROADMAP Measure, "`experiment` cards measured").
