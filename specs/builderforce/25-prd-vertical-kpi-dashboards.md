# PRD 25 — Vertical KPI Dashboards: the Carta comparison and the marketplace product

**Status:** Approved direction 2026-09-15 (vocabulary shipped; product build next, slice A first) · **Owner:** platform (CFO seat) · **Created:** 2026-09-15
**Implementation hand-off:** [PRD 25a](./25a-vertical-kpi-dashboards-implementation.md) — every remaining piece, in build order, with the exact seams, signatures, tests and definition of done for a coding agent.
**Companion to:** [PRD 19 — BurnRateOS consolidation](./19-prd-burnrateos-consolidation.md) §10 (runway, startup listing), [PRD 16 — Insights answer engine](./16-prd-insights-answer-engine.md) (metric registry, presets), [PRD 24 — Developer portal](./24-prd-developer-portal.md) (the extension marketplace this product deliberately does not use)
**Goal:** make KPI management and dashboarding simple: a preconfigured dashboard per vertical, sold and installed through the marketplace as a first-party product that Builderforce itself dogfoods, with runway, ownership, dilution, market size and LTV tranches on the same surface.

**Operator decisions (2026-09-15):**
1. The vocabulary change (§6.4) is approved — shipped as migration 1176.
2. Name the verticals from research on the top ten — §5.
3. Dogfood this as a capability built on top of Builderforce and available through the marketplace — §6.

---

## 1. Verdict

Carta is an **equity system of record**. Its analysis is ownership and exit mathematics (cap table, pro forma, waterfall, breakpoints, sensitivity) plus the benchmark data that falls out of hosting 33K+ cap tables (round sizes, valuations, dilution, compensation bands). It does **not** run the company: no runway, no burn, no revenue, no product, no clinical or payments metrics. A founder on Carta still keeps the operating dashboard in a spreadsheet.

Builderforce should **not** chase 409A valuations, ASC 718, fund administration, or liquidity. Those are regulated services with a human back office and they are the part of Carta that is expensive to replicate and cheap to partner for. Builderforce competes on the two things Carta cannot do from its position:

1. **The operating dashboard, per vertical, preconfigured.** The founder declares a sector at listing (`companies.sector`) and installs the vertical's dashboard from the marketplace: the right KPIs, the right benchmark cohort and the right next actions, with nothing to configure.
2. **Ownership math beside the operating numbers.** The cap-table engine, round model and SAFE conversion already exist in the repo. Adding the exit waterfall over the share-class terms that are already stored closes the only analysis gap that matters to a founder, on the same canvas as runway and revenue.

Carta's own retreat from secondaries after the 2024 data-misuse allegation is the positioning: **Builderforce never trades on your data.** The tier rule in `toPublicProfile()` (public sees runway health only, cash never leaves the workspace) is the same promise applied to a number.

---

## 2. What Carta provides

Grouped by who uses it. "Tier" is Carta's public plan structure: Launch (free, ≤25 stakeholders and <$1M raised), Build, Grow, Scale/Enterprise (quote only; median startup spend about $15.4K a year, early-stage $3–8K, late-stage $30K+).

### 2.1 Company and founder analyses

| # | Analysis | Inputs | Outputs and the decision it supports | Tier |
|---|---|---|---|---|
| 1 | **Cap table** (fully diluted) | Issuances, option grants, SAFEs, notes, pool | Ownership % by holder and class, FD share count, history by round. *Who owns what.* | Launch |
| 2 | **Financing round modeling / pro forma** | Pre-money, raise amount, pool top-up, SAFE/note conversion terms | Post-money, price per share, new share count, dilution per holder, pro forma cap table you can switch scenarios on. *Should I take this term sheet.* | Build |
| 3 | **Exit waterfall** | Exit value, exit date, non-convertible debt, vesting treatment (normal or accelerated), share-class terms (preference multiple, participation, seniority, conversion) | Payout per class and per holder, breakpoints where each class converts, IRR and multiple per investor, goal-seek "what exit value yields X% IRR". *What do I actually get at $50M / $200M.* | Grow |
| 4 | **Sensitivity analysis** | A range of exit values over the waterfall | Payout curves per holder across the range. *Where the preferences bite.* | Grow |
| 5 | **Option pool planning** | Hiring plan, target grant sizes | Pool size needed, unallocated pool, dilution of the top-up. | Build |
| 6 | **409A valuation** | Financials, cap table, comparable set | Audit-ready FMV for option strike prices, refreshed yearly or on a round. Regulated deliverable. | Grow (included) |
| 7 | **ASC 718 stock-comp expense** | Grants, vesting, FMV | GAAP expense schedule for the auditor. | Grow |
| 8 | **Equity plan administration** | Grants, vesting schedules, exercises, terminations | Cliff and vest calendars, exercise windows, 83(b) and QSBS tracking, employee portal. | Build |
| 9 | **Total Compensation benchmarks** | Role, level, location, stage, valuation band | Salary and equity bands at p25/p50/p75, custom pay bands, offer letters against the band. Refreshed quarterly from Carta's own grant data. | Add-on |
| 10 | **Board consents and signatures** | Round documents, option grants | Signed approvals tied to the cap-table event. | Build |
| 11 | **Investor updates** | Narrative plus metrics | Distributed update to the investor list. | Build |

### 2.2 Investor and fund analyses

| # | Analysis | Outputs |
|---|---|---|
| 12 | **Fund administration** | IRR, TVPI, DPI, RVPI per fund, capital calls, distributions, LP statements. |
| 13 | **Portfolio waterfall** | The same exit waterfall run from the investor's side: proceeds and multiple to each fund. |
| 14 | **ASC 820 portfolio valuations, K-1s, SPVs, capital-call credit lines** | Regulated back-office deliverables. |

### 2.3 Data products

| # | Report | What it benchmarks |
|---|---|---|
| 15 | **State of Private Markets** (quarterly) | Round sizes, pre-money valuations, dilution and down-round share by stage and industry (SaaS, healthtech, hardware, fintech, consumer, biopharma, energy, medical devices, adtech, education); Q1 2026: $30.4B raised, 60%+ to AI companies, foundational-model Series A median $300M vs $55M non-AI. |
| 16 | **State of Pre-Seed** (quarterly) | SAFE volumes and valuation caps by size; Q2 2026: $3.19B across 11.5K instruments, 90th-percentile caps to $100M on SAFEs over $2.5M. |
| 17 | **State of Startup Compensation** (half-yearly) plus the quarterly benchmark refresh | Salary, total cash and equity by function, level and geography. |

### 2.4 What Carta does not do

Runway and burn. Revenue, MRR/ARR, retention, CAC, LTV. Product or usage metrics. Anything clinical, regulatory, climate or payments-specific. Market sizing. Its scenario tools model **the cap table**, not the business.

---

## 3. What a business actually uses, by stage

| Stage | Uses weekly | Uses at an event (raise, hire, exit) | Never touches |
|---|---|---|---|
| **Pre-seed / SAFE** | Runway, burn, cash-zero date | Cap table (who owns what after the SAFEs), pro forma for the first priced round | Waterfall, 409A, ASC 718, comp bands |
| **Seed** | Runway, burn, the vertical KPI set | Pro forma per term sheet, option-pool sizing, SAFE conversion, first 409A (regulated, buy it), cliff calendar | ASC 718, fund admin |
| **Series A** | Vertical KPI set with benchmarks, board pack | Waterfall and sensitivity (the preference stack now matters), comp bands for the hiring plan, 409A refresh, investor updates | Fund admin |
| **Series B+** | Everything above plus cohort LTV, NRR by segment | ASC 718 (auditor asks), tender-offer modeling, secondary sales | — |

The weekly surface is the operating dashboard, which Carta does not have, and it is the surface that earns the login. The event surfaces are already mostly built in Builderforce (§4); the waterfall is the one that is not.

---

## 4. Builderforce today: coverage against Carta

Evidence is a file path. "Partial" means the data or terms exist and the calculation or surface does not.

| Carta analysis | State | Where it lives |
|---|---|---|
| Cap table, fully diluted | **Have** | `api/src/application/finance/equity.ts` `capTable()`, `GET /api/equity/cap-table`, canvas kind `capTable` (`frontend/src/lib/founderObjects.ts`), `/investor?tab=round` |
| Round modeling / pro forma | **Have** | `modelRound()` and `applyRoundConversions()` in `equity.ts`, `POST /api/equity/rounds/model` and `/rounds/apply`, `funding_rounds` with `pre_money`/`post_money` |
| SAFE / convertible conversion (pre- and post-money) | **Have** | `recordConvertible()`, `convertible_instruments.post_money`, `equity.test.ts` |
| Vesting schedules, cliffs | **Have** | `grantVesting()` derived from terms (never stored), `GET /api/equity/cliffs` |
| Exit waterfall, breakpoints, sensitivity | **Partial** | Terms are stored: `share_classes.liquidation_multiple`, `participating`, `seniority`, `conversion_ratio`. No payout calculation, no route, no canvas kind. |
| Option pool planning | **Partial** | Pool is a `share_classes` row; no "pool needed for this hiring plan" calculation. |
| 409A valuation | **Missing, do not build** | `equity_grants` has an FMV column for the result. Partner or import. |
| ASC 718 | **Missing, do not build** | Grants and vesting exist; expense schedule is an export for a later stage. |
| Compensation benchmarks | **Partial** | `compensation_structures` holds the tenant's own bands; `industry_benchmarks` is DORA metrics only, no pay data. |
| Market benchmarks (round size, valuation, dilution) | **Partial** | `investor_peer_comparables` stores hand-entered comparables per company; no seeded distribution. |
| Investor updates | **Have** | `investorUpdateDelivery.ts`, `/api/investor-updates`, canvas kind `investorUpdate` |
| Data room, diligence, fundraising pack | **Have** | `dataRoomSharing.ts`, `fundraisingPack.ts`, `/investor?tab=dataroom|diligence|pack` |
| Fund administration, LP reporting | **Missing, do not build** | Out of scope by design. |
| Board consents / e-signature | **Missing** | Not required for the dashboard thesis; revisit with the governance seat. |

The operating layer Carta lacks, where Builderforce already leads:

| Capability | State | Where it lives |
|---|---|---|
| Runway, net burn, cash-zero date, 12-month projection | **Have** | `computeRunway`/`projectCashflow` in `packages/creation-canvas-contract/src/startupListing.ts`, `runwayReport.ts`, `/finance`, `GET /api/bi/runway` |
| Observed finance series | **Have** | `metric_facts` keys `finance.burn`, `finance.revenue`, `finance.cash`, `finance.mrr`, `finance.runway_months`, `finance.monthly_burn` (`kernel/rollups/finance.ts`) |
| Break-even, forecast, what-if, Monte Carlo | **Have** | `scenarioModelling.ts`, `/api/scenarios/*` |
| Composable dashboards, pins, presets | **Have** | `metricRegistry.ts` (whitelist), `dashboardPresets.ts` (one preset: `executive`), `widgetIds.ts`, `frontend/src/components/widgets/allComponents.ts`, `dashboard_pins` |
| Custom KPIs with versioned formulas | **Have** | `custom_kpis` + `kpi_formulas` (`schema/finance.ts`) |
| Industry benchmarking (DORA, six cohorts) | **Have** | `benchmarkingInsights.ts`, `industry_benchmarks` (p10–p90), `tenant_benchmark_profiles` |
| **One industry vocabulary** | **Have (1176)** | `STARTUP_SECTORS` is canonical; cohorts renamed; `alignBenchmarkIndustry` on listing; `verticalForSector()` — §6.4 |
| Marketplace templates that install into a tenant | **Have** | `catalog_items` kind `template`, `templateRegistry.ts` (builtin/tenant/marketplace origins), `installTemplate.ts`, output kinds `workflow` and `tasks` — §6.1 |
| Free calculators (runway, burn, churn/LTV, break-even, pricing) | **Have** | `startupFinanceTools.ts`, `/tools` |
| TAM / SAM / SOM | **Missing** | Nothing in api, frontend or packages. Nearest kinds: canvas `targetMarket`, `customerSegment`. |
| LTV, CAC, LTV:CAC, CAC payback as tracked metrics | **Missing** | Calculator-only. No metric key, no `metric_facts` producer, no widget. |
| Revenue / customer cohorts | **Missing** | `cohort_retention` is a hiring table. |
| Vertical KPI sets | **Missing** | No preset beyond `executive`; no `dashboard` template output kind. |

---

## 5. The ten verticals

### 5.1 How they were chosen

Ranked by 2025–2026 venture dollars, cross-checked against the industries Carta reports on and the verticals with a KPI set distinct enough to deserve its own dashboard. Sources in §9.

| Rank | Vertical (`sector` value) | Signal | Why its own dashboard |
|---|---|---|---|
| 1 | AI-native (`ai_ml`) | ~50–60% of all 2025–26 venture dollars ($211B–$259B in 2025; 60¢ of every Carta dollar in Q1 2026) | Inference sits in COGS: gross margin ~52% vs 75–85% SaaS; investors ask for the margin trajectory |
| 2 | SaaS (`saas`) | Largest company count on every platform; the default cohort | NRR, CAC payback, magic number, burn multiple |
| 3 | FinTech (`fintech`) | $52–53B in 2025 | TPV, take rate, fraud loss, licences |
| 4 | Digital health (`healthtech`) | Healthcare + biotech $71.7B in 2025; healthcare #1 vertical by deal count | Patient acquisition, engaged patients, payer contracts, outcomes |
| 5 | MedTech / devices (`medtech`) | Carta reports "medical devices" as its own industry; 510(k) path averages $31M | Regulatory pathway is the spine; runway vs months-to-milestone |
| 6 | BioTech / biopharma (`biotech`) | $33.8B biopharma VC in 2025 | IND and phase milestones; 20%/15% Phase 2/3 success; 24+ months cash survives |
| 7 | Climate & energy (`climate_energy`) | $40–42B in 2025 | LCOE, tCO2e abated, MW deployed, offtake |
| 8 | Hardware, robotics, defence (`hardware_robotics`) | Defence tech $49B broad / robotics $13.8B in 2025; manufacturing fastest-growing vertical | BOM cost, hardware gross margin, backlog, contract pipeline |
| 9 | Cybersecurity (`cybersecurity`) | A top-five VC category every year; $3M ARR is the institutional threshold | ARR, NRR 110%+, pipeline coverage 3–5×, POC conversion |
| 10 | Marketplaces & consumer commerce (`marketplace`) | Largest consumer category; e-commerce, marketplace and consumer apps fold here | GMV, take rate, liquidity, DAU/MAU |

Sectors without a vertical of their own fold by `verticalForSector()` (`packages/creation-canvas-contract/src/verticals.ts`): `ecommerce` and `consumer_apps` → marketplace; `enterprise_software` and `edtech` → saas; `blockchain` → fintech; `gaming`, `media_entertainment`, `real_estate`, `logistics`, `other` → the founder layer alone. Watch-list for an eleventh: legal, manufacturing and AEC were 2025's fastest-growing vertical-software categories.

### 5.2 Universal founder layer (every vertical)

| KPI | Definition | Source in repo | Benchmark / rule |
|---|---|---|---|
| Cash on hand | Declared or ledger-observed | `companies.cash_on_hand`, `finance.cash` | — |
| Net burn | Spend − revenue, monthly | `finance.monthly_burn`, `computeRunway` | — |
| Runway (months) and cash-zero date | cash ÷ net burn, never stored | `computeRunway`, `zeroCashDateFrom` | Watch < 12, critical < 6; post-raise target 18–24 months |
| Fully diluted ownership | Founders, investors, pool, unallocated | `capTable()` | — |
| Dilution this round (pro forma) | Ownership before vs after the modeled round | `modelRound()` | Carta medians by stage once seeded |
| Exit payout at three exit values | Waterfall over stored share-class terms | **New:** `exitWaterfall()` §6.3 | — |
| Cliffs due in 90 days | Grants reaching cliff | `cliffsDueWithin()` | — |
| TAM / SAM / SOM | Bottom-up primary, top-down to triangulate | **New:** canvas kind `marketSize` §6.3 | Methods within 15% = sound; SOM tied to plan |
| Benchmark position | Percentile against the sector cohort | `computeBenchmarking()` | Elite / high / medium / low; `cohortSeeded: false` says when there is no cohort yet |

### 5.3 The vertical layers

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

### 5.4 LTV tranches

A single blended LTV is a vanity number. A **tranche** is a partition of the customer base that gets its own LTV, CAC and payback so the founder sees which pocket pays. Tranche dimensions, in priority order: **plan tier**, **acquisition cohort** (month of first payment), **acquisition channel**, **segment** (SMB / mid-market / enterprise). The dashboard shows LTV:CAC per tranche as one chart and names the tranche below 3:1 as the next action.

LTV per tranche = ARPA(tranche) × gross margin ÷ monthly churn(tranche). Cohort tranches use observed retention curves once 12+ months of `metric_facts` exist; before that the churn calculator's assumption is used and the tile is labelled *declared*, the same claim-to-proof rule `/finance` already applies.

### 5.5 TAM / SAM / SOM

Both methods, side by side, with the assumptions written down. **Bottom-up** is primary: SOM = reachable customers × ARPA × achievable share; SAM = serviceable customers × ARPA; TAM = all potential customers × ARPA. **Top-down** triangulates from a cited market figure and a share assumption. Rules the object enforces: SOM ≤ SAM ≤ TAM; SOM is tied to the plan; the two methods within 15% of each other is a health mark; every figure carries a source.

---

## 6. Design: a first-party marketplace product

**No new tables.** `newTablesAllowed: false` from the BurnRateOS cutover still holds and nothing here needs one: dashboards are `saved_dashboards` + `dashboard_widgets`, products are `catalog_items`, metrics are `metric_facts`, hand-entered KPIs are `custom_kpis`, market sizes are canvas objects, benchmarks are `industry_benchmarks` rows.

### 6.1 The product is a template; the template installs a dashboard

The repo already has the seam. A template **is** a `catalog_items` row (`kind='template'`, manifest in `body`) with three origins (`builtin` from code in `api/src/application/templates/defaults/`, `tenant`, `marketplace`), an install path (`installTemplate.ts`: re-validate → bind `{{setup.x}}` → materialise each output → bump `install_count`) and an open registry of **output kinds** (`outputKinds.ts`: `workflow`, `tasks`) whose own header names "publish a dashboard" as the intended next extension.

The build is therefore:

1. **A `dashboard` output kind.** `registerOutputKind({ kind: 'dashboard', … })` in `api/src/application/templates/outputKinds.ts` and `'dashboard'` added to `TEMPLATE_OUTPUT_KINDS` in `domain/template/templateManifest.ts` (the contract test that every declarable kind has a materialiser covers it). The materialiser calls the existing `applyDashboardPreset(db, tenantId, segmentId, presetKey, createdBy)` and, when the manifest names a vertical, `alignBenchmarkIndustry`. Idempotent by construction: `applyDashboardPreset` already re-applies onto a partially built dashboard without doubling tiles.
2. **Presets are data.** `DASHBOARD_PRESETS` gains `founder` and one key per `DashboardVertical` (`ai_ml`, `saas`, …, `marketplace`), each an ordered list of registry keys. The existing test that every preset key is whitelisted covers them. A vertical preset lists the founder layer's tiles first, then its own.
3. **Ten built-in templates.** `templates/defaults/vertical-dashboards.ts`: one `TemplateManifest` per vertical (`key: 'vertical-dashboard-<sector>'`, one `choice` step for the size band, output `{ kind: 'dashboard', preset: '<sector>' }`), plus `vertical-dashboard-founder`. Built-ins are code, protected by `isReservedTemplateKey`, origin `builtin`, and they surface in the marketplace's asset family under the `template` chip with no publisher step. This is the "built by Builderforce" marker the platform already has; `catalog_items.tenantId IS NULL` remains the public-listing rule.
4. **Install is the existing door.** `POST /api/templates/:key/install` (DEVELOPER role) and the `/templates?open=<key>` wizard. The marketplace card's launch verb is `install`. No new route.
5. **Dogfood.** The Builderforce workspace declares `saas` on its own `companies` row and installs `vertical-dashboard-saas`. The kill conditions in §7 are measured on that install first.
6. **Not the extension marketplace.** PRD 24's `extension_packages` is for third-party connectors and MCP servers with scopes, plans and metering. A dashboard has no scopes to consent to and no metering; forcing it through that path would add a publisher flow for a product the platform ships itself. `EXTENSION_KINDS` already lists `template` as declared-not-submittable, which is consistent with this choice.

### 6.2 Metric keys and widgets

Every metric a preset names must be a `MetricDef` in `metricRegistry.ts`, which is the whitelist. New keys, each with a `compute(db, tenantId, days)` over existing services:

- `finance.runwayMonths`, `finance.netBurn`, `finance.cash` (read `runwayReport`)
- `growth.mrr`, `growth.arrGrowth`, `growth.nrr`, `growth.grr`, `growth.grossMargin`, `growth.cac`, `growth.cacPayback`, `growth.ltv`, `growth.ltvCac`, `growth.magicNumber`, `growth.burnMultiple`, `growth.logoChurn`
- `ai.inferenceMarginPct`, `ai.inferenceCostPerUnit`, `ai.inferenceEfficiency`
- `clinical.stage`, `clinical.monthsToMilestone`, `clinical.regulatorySpendPct`, `clinical.costPerDataPoint`, `clinical.enrollmentRate`, `clinical.reimbursementStatus`
- `payments.tpv`, `payments.takeRate`, `payments.fundedAccountRatio`, `payments.fraudLossBps`, `payments.payoutLatency`
- `climate.unitCostVsIncumbent`, `climate.tco2eAbated`, `climate.capacityDeployed`, `climate.offtakePipeline`
- `hardware.bomCost`, `hardware.grossMargin`, `hardware.backlog`, `hardware.productionStage`
- `security.pipelineCoverage`, `security.pocConversion`, `security.timeToValue`
- `market.gmv`, `market.liquidity`, `market.repeatRate`, `market.contributionPerOrder`
- `equity.founderOwnership`, `equity.poolUnallocated`, `equity.cliffsDue90d`, `equity.exitPayoutAt`

`compute` reads `metric_facts` for observed series and `custom_kpis`/`kpi_formulas` for hand-entered ones (the milestone tiles — regulatory stage, development stage, production stage, licences — are `custom_kpis` with an ordinal unit). No observed and no declared value returns `null`, rendered "Not measured", never zero.

Widgets: one `*_COMPONENTS` module per vertical under `frontend/src/components/insights/widgets/` (`founderWidgets.tsx`, `saasWidgets.tsx`, …), spread into `allComponents.ts`, ids added to `COMPOSABLE_WIDGET_IDS`; `askWidgetIds.test.ts` enforces the three-way contract. Each tile: value, benchmark band, delta, next action. Titles under `widgets.title.*` in all five catalogs.

### 6.3 Exit waterfall and market size

`api/src/application/finance/exitWaterfall.ts` (new module beside `equity.ts`, not inside it): pure `computeWaterfall({capTable, shareClasses, exitValue, debt, vestingTreatment})` returning payout per class and holder, the breakpoints at which each class converts, and per-holder multiple. `POST /api/equity/waterfall` in `equityRoutes.ts` (cached under `equityVersionKey`). Canvas kind `exitScenario` with `derive` fields for the payouts. Sensitivity is the same function over a range; goal-seek is a bisection.

Canvas kind `marketSize` in `FOUNDER_OBJECT_SPECS`: fields `method`, `potentialCustomers`, `serviceableCustomers`, `reachableCustomers`, `arpa`, `achievableShare`, `topDownMarket`, `topDownShare`, `sources`; `derive` fields `tam`, `sam`, `som`, `triangulationGap`, returning `undefined` on missing inputs. The deck engine's `dataSources.ts` binds the market slide to it.

### 6.4 One vertical vocabulary — SHIPPED 2026-09-15 (migration 1176)

`STARTUP_SECTORS` is canonical. `industry_benchmarks.industry` and `tenant_benchmark_profiles.industry` were migrated (`software_saas` → `saas`, `enterprise_it` → `enterprise_software`, `agency_services` → `other`), the profile default is `saas`, and `companies.sector = 'sustainability'` became `climate_energy`. `application/insights/benchmarkProfile.ts` is the one writer; `updateStartupListing` calls `alignBenchmarkIndustry` so a declared sector places the company in its cohort. A sector with no seeded cohort is reported (`cohortSeeded: false`, localized notice), not refused. `verticals.ts` carries `DASHBOARD_VERTICALS` and `verticalForSector()`.

### 6.5 Benchmark seeds

Add `industry_benchmarks` rows for the §5.3 metrics per vertical and size band, each with a `source` naming the public report and quarter; a seed row with no source is rejected. Carta's own reports are a legitimate source for round-size, valuation and dilution bands. Compensation bands stay out until there is a licensed source.

### 6.6 Where it appears

- **Marketplace:** `/marketplace?family=asset&kind=template`, the ten cards plus the founder layer, launch verb *install*, free.
- **`/finance`:** the installed dashboard is the first tab when the company has a sector; Runway and Cashflow remain.
- **Insights hub:** the same dashboard under the Finance lens, pinnable per user through `dashboard_pins`.
- **Canvas:** any tile on the `dashboard` kind (registry components resolve identically on the board).
- **Marketplace company profile:** benchmark position only (elite/high/medium/low), never the numbers, extending `toPublicProfile()`.
- **Brain:** opens any tile through the existing `show_widget` bridge.

---

## 7. Sequencing

| Slice | Build | Proof | Kill condition |
|---|---|---|---|
| A | `dashboard` output kind; `founder` preset over existing services (runway, burn, ownership, cliffs, dilution); `vertical-dashboard-founder` built-in template; the ten vertical template manifests registered (each installs founder + its preset, presets initially founder-only until B/D fill them) | Installing from the marketplace produces the dashboard on `/finance` with no configuration; the Builderforce workspace installs it on its own company | Fewer than half of newly listed companies install it in their first week |
| B | `growth.*` and `ai.*` metric keys, LTV tranches, benchmark seeds; `saas` and `ai_ml` presets filled | A SaaS tenant with 3+ months of `finance.mrr` sees NRR and LTV:CAC per tranche with a band | Tiles read "Not measured" for most tenants because no producer writes `growth.*` facts (then the fix is the ledger connector, not the dashboard) |
| C | Exit waterfall + `exitScenario` kind + `marketSize` kind + deck binding | A founder models three exits and the deck's market slide binds to the canvas object | Waterfall payouts disagree with a hand-built spreadsheet on the test cap table |
| D | The remaining eight vertical presets with milestone tiles and their benchmark seeds | Two design-partner tenants per vertical run the dashboard for a month | No design partner in a vertical (the template stays listed with the founder layer until one appears) |

Ship rule for each slice: it is a new capability, so it carries a `release_notes` row (category `new`) and a methodology-framed blog post per the platform's feature-shipping rule.

### Delivered

**Slice A — shipped 2026-09-16** (frontend `2026.9.35`, api `2026.9.37`).

| Step | What landed |
|---|---|
| A1 | `dashboard` output kind + materialiser (`application/templates/outputs/dashboardOutput.ts`); `DashboardOutput` in `templateManifest.ts` |
| A2 | `DASHBOARD_VERTICALS` + `verticalForSector` fold in the canvas contract; sector ids use underscores, template keys hyphenate |
| A3 | Metric registry keys `finance.runwayMonths`, `finance.cash`, `finance.netBurn`, `finance.cashZeroDate`, `equity.founderOwnership`, `equity.poolUnallocated`, `equity.cliffsDue90d` — each resolving from existing finance/equity services, `null` when not measured |
| A4 | Founder widgets `founder.runway-projection`, `founder.ownership`, `bench.position` (`founderWidgets.tsx`, spread into `ALL_COMPONENTS`) |
| A5 | Eleven built-in templates from `VERTICAL_DASHBOARD_TEMPLATES`, derived from `DASHBOARD_VERTICALS` + founder; one size-band question; registered in `BUILTIN_TEMPLATE_SOURCES` |
| A6 | `/finance?tab=dashboard` — `FinanceDashboardView` + `DashboardInstallPrompt`, nav tab, i18n ×5 |
| A7 | Release note migration `1179_release_note_vertical_kpi_dashboards.sql` (category `new`); blog post `install-your-verticals-kpi-dashboard` ×5 locales + OG cards |

A metric with no producer renders as **not measured** — never `0`, never an invented trend line. Adding a twelfth vertical is a data change to `DASHBOARD_VERTICALS`, not a release.

---

## 8. Open items

- `practiceOpsRoutes.ts` and `founderNetworkRoutes.ts` still write `companies.sector` free-form (schema-validated to 120 chars, not to the vocabulary). Route them through `validateListingPatch` when slice A touches the listing.
- Seeded cohorts exist today for `saas`, `fintech`, `healthtech`, `ecommerce`, `enterprise_software` and `other` (DORA metrics only). The seven verticals with no cohort yet (`ai_ml`, `medtech`, `biotech`, `climate_energy`, `hardware_robotics`, `cybersecurity`, `marketplace`) get theirs with slices B and D; until then the lens reports `cohortSeeded: false` and says so.

---

## 9. Sources

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
