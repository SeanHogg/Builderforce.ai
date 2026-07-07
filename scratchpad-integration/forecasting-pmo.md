# Forecasting + PMO — integration snippets (edits to SHARED / forbidden files)

Everything below is **paste-ready**. The new feature files (routes, application,
components, migration `0305`, i18n patch) are already created directly. This note
covers only the edits that must land in files the task marked off-limits.

Order to apply: **(A) schema.ts → (B) planFeatures.ts + PlanLimits.ts → (C) index.ts
→ (D) rbac.ts (optional) → (E) allWidgets.ts → (F) run i18n merge.** Then `npx tsc`
(api) and `npx tsgo` (frontend) are fully green (see "Known deferred type errors").

---

## (A) `api/src/infrastructure/database/schema.ts` — new `pgTable`

Add near the other insight/tracker tables (e.g. just after `budgets` /
`innovationIdeas`, ~line 5030). Matches migration `0305`. Uses helpers already
imported in schema.ts (`pgTable, uuid, integer, varchar, text, timestamp, index`).

```ts
/** Dismissed forecast anomalies (LENS forecast) — a manager mutes a known/explained
 *  z-score outlier so it stops surfacing on /api/insights/forecast. One row per
 *  (tenant, metric, point_day). Additive: no rows == every anomaly shown. Mig 0305. */
export const forecastAnomalyAcks = pgTable('forecast_anomaly_acks', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  metric:    varchar('metric', { length: 24 }).notNull(),   // cost | cycle_time | cfr | throughput
  pointDay:  varchar('point_day', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  note:      text('note'),
  ackedBy:   varchar('acked_by', { length: 36 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqAck:    uniqueIndex('uq_forecast_anomaly_ack').on(t.tenantId, t.metric, t.pointDay),
  byMetric: index('idx_forecast_anomaly_ack_metric').on(t.tenantId, t.metric),
}));
```

> `uniqueIndex` is already imported in schema.ts; if not, add it to the
> `drizzle-orm/pg-core` import (or swap the `uqAck` line for
> `unique('uq_forecast_anomaly_ack').on(...)`).

**No other schema change is required.** `budgets` already has
`scopeKind/projectId/initiativeId` (used by the new budget scope picker) and
`innovationIdeas` already has `initiativeId` + `linkedProjectId` (used by the new
funnel link picker) and `report_type` already includes `'project_status'` — so the
report generator, funnel linking and budget scoping need **no** migration.

---

## (B) Migrations

- **`api/migrations/0305_forecast_anomaly_acks.sql`** — CREATED (this repo). Backs `forecastAnomalyAcks`.
- **`0306` / `0307`** — **not required.** Every other deliverable (project_status
  report, rich digest email, funnel→initiative/project link, budget scope picker,
  the plan-gate, the forecasting math) is pure compute / reuses existing columns
  and enum values. Reserve the numbers; no DDL to write.

---

## (C) `api/src/index.ts` — register the forecast router

Add the import near the other insight route imports (~line 54):

```ts
import { createForecastRoutes } from './presentation/routes/forecastRoutes';
```

Mount it on the SAME `/api/insights` prefix (Hono merges routers; distinct
subpaths). Add right after the other `/api/insights` mounts (~line 455):

```ts
app.route('/api/insights',   createForecastRoutes(db));
```

`buildScheduledReport` (project_status) and `sendReportEmail` (rich digest) are
already wired — their existing imports/usages in index.ts are unchanged.

---

## (D) `api/src/domain/tenant/PlanLimits.ts` + `planFeatures.ts` — the `advancedInsights` flag

**PlanLimits.ts** — add the boolean to the `PlanLimits` interface (near the other
feature flags, ~line 95):

```ts
  /** Whether the premium exec insight lenses (forecasting/anomalies + the
   *  CTO/CFO/PMO analytical lenses) are available. Any paid plan. */
  advancedInsights: boolean;
```

…and to each plan in `PLAN_LIMITS`:

```ts
  // FREE:
  advancedInsights: false,
  // PRO:
  advancedInsights: true,
  // TEAMS:
  advancedInsights: true,
```

**planFeatures.ts** — add the label to `PLAN_FEATURE_LABEL` (~line 41):

```ts
  advancedInsights: 'advanced insights (forecasting & exec lenses)',
```

> Until this lands, the plan-gate `requirePlanFeature('advancedInsights')` **fails
> open** (the middleware no-ops on an unknown flag), so the lenses keep their prior
> role-only behaviour — wiring the gate never dark-launches a paywall.

---

## (D′) `frontend/src/lib/rbac.ts` — OPTIONAL dedicated capability

The forecast panel + widgets currently reuse the existing `insights.finance`
capability, so **no rbac change is required to compile or ship.** If you want the
forecast lens to have its own gate, add to `CAPABILITIES` (~line 91):

```ts
  'insights.forecast':    'manager',   // Forecasting & anomaly lens (premium)
```

Then swap `FORECAST_CAP` in `forecastWidgets.tsx` and the `forecast` panel
`capability` in `financePanels.tsx` from `'insights.finance'` to `'insights.forecast'`.

---

## (E) `frontend/src/lib/widgets/allWidgets.ts` — register the forecast widgets

Add the import beside the other insights widget modules:

```ts
import { FORECAST_WIDGETS } from '@/components/insights/widgets/forecastWidgets';
```

Add the spread to `ALL_WIDGETS` under the "Insights lenses" group:

```ts
export const ALL_WIDGETS: WidgetDef[] = [
  // ── Insights lenses ──
  ...AI_IMPACT_WIDGETS,
  ...LLM_USAGE_WIDGETS,
  ...DELIVERY_WIDGETS,
  ...FINANCE_WIDGETS,
  ...FORECAST_WIDGETS,   // ← add
  // ── Non-insights surfaces ──
  ...CORE_WIDGETS,
  ...CATALOG_WIDGETS,
  ...OPERATIONAL_WIDGETS,
  ...OBSERVABILITY_WIDGETS,
  ...WORKFORCE_WIDGETS,
];
```

---

## (F) i18n — merge the new keys into `messages/*.json`

The patch file is created at `frontend/scripts/i18n-patch-forecasting.mjs` (5 langs,
same format as `i18n-patch-observability.mjs`). Apply it with the existing merger
(idempotent — only adds missing leaf keys):

```bash
cd frontend
node scripts/i18n-merge.mjs scripts/i18n-patch-forecasting.mjs
```

Adds under `insights`: `forecast.*` (title/subtitle/metric.*/trend/anomalies/…),
`fin.scope*`, `funnel.link*`, `upgrade.*`; and under `widgets`: `group.forecast` +
`title.forecast*`.

---

## Known deferred type errors (resolve only after the above lands)

- `forecastRoutes.ts` imports `forecastAnomalyAcks` from schema → resolves after (A).
- `insightPlanGate.ts` / `insightsRoutes.ts` reference the `advancedInsights` flag
  by string; they **compile today** (param typed as `string`, fail-open at runtime)
  and simply start enforcing once (B) lands.
- Frontend compiles today (forecast widgets/panel reuse `insights.finance`); (D′) and
  (E) are additive.
