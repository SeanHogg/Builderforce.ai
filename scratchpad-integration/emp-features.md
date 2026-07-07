# EMP features — integration snippets

Paste-ready edits for the **shared files that must not be edited directly**. All
NEW files (compute modules, routers, migrations, components, API clients, i18n
patch) are already written. This doc covers only the wiring into shared files.

Feature map:
- **EMP-5** cross-team benchmarking — `crossTeamBenchmark.ts` + `/api/insights/benchmarking/cross-team`
- **EMP-9** delay taxonomy — mig `0315`, `delayTaxonomy.ts`, `/api/insights/delay-taxonomy`
- **EMP-10a** release picker — mig `0316`, `releasesRoutes.ts`, `/api/releases` (task route already accepts `releaseId`)
- **EMP-15** pulse survey — mig `0317`, `pulseSurvey.ts`, `/api/pulse`
- **EMP-20** export formats — mig `0318`, `tabularExport.ts`, `/api/insights/export`
- **R&D reconciliation** — `rdReconciliation.ts`, `/api/finops/rd-reconciliation`

> Migration numbering: repo HEAD is at `0299`; per task instruction the four new
> migrations use `0315`–`0318`. Renumber down to `0300`–`0303` if the gap is
> undesirable (keep filenames + drizzle in lockstep).

---

## 1. `api/src/infrastructure/database/schema.ts`

### 1a. New tables (append near the other insight/board tables)

```ts
// EMP-9 — delay root-cause taxonomy (migration 0315).
export const delayReasons = pgTable('delay_reasons', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  reasonCode: varchar('reason_code', { length: 24 }).notNull(), // blocked_dependency | awaiting_review | scope_change | unclear_requirements | external | capacity | other
  notes:      text('notes'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  // matches the migration's CREATE UNIQUE INDEX (drift-check parity); upsert target
  uqTask: uniqueIndex('uq_delay_reasons_task').on(t.taskId),
}));

// EMP-15 — internal sentiment / pulse survey (migration 0317).
export const pulseSurveys = pgTable('pulse_surveys', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  question:  varchar('question', { length: 255 }).notNull(),
  scale:     integer('scale').notNull().default(5),
  active:    boolean('active').notNull().default(true),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  closedAt:  timestamp('closed_at'),
});

export const pulseResponses = pgTable('pulse_responses', {
  id:        uuid('id').primaryKey().defaultRandom(),
  surveyId:  uuid('survey_id').notNull().references(() => pulseSurveys.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // stored only to enforce one-response-per-user (unique) + "have I answered"; never
  // returned by any aggregate read (anonymity is server-enforced).
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  score:     integer('score').notNull(),
  comment:   text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  // matches the migration's CREATE UNIQUE INDEX (drift-check parity); upsert target
  uqUser: uniqueIndex('uq_pulse_response_user').on(t.surveyId, t.userId),
}));
```

### 1b. Column additions to existing tables

`productReleases` (add inside the existing `pgTable('product_releases', { … })`) — EMP-10a, migration 0316:

```ts
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  targetDate: timestamp('target_date'),
  releasedAt: timestamp('released_at'),
```

`reportSchedules` (add inside `pgTable('report_schedules', { … })`) — EMP-20 scheduled, migration 0318:

```ts
  exportFormat: varchar('export_format', { length: 8 }).notNull().default('csv'), // csv | html
```

---

## 2. Migrations (already written to `api/migrations/`)

- `0315_delay_reasons.sql`
- `0316_release_task_association.sql`  (ALTER product_releases: project_id, target_date, released_at)
- `0317_pulse_surveys.sql`  (pulse_surveys + pulse_responses)
- `0318_report_schedule_export_format.sql`  (ALTER report_schedules: export_format)

All idempotent (`IF NOT EXISTS`) and segment-triggered where the table is segment-scoped.

---

## 3. `api/src/index.ts` — route registration

Imports (near the other route imports, ~line 54):

```ts
import { createEmpFeatureRoutes } from './presentation/routes/empFeatureRoutes';
import { createReleasesRoutes }   from './presentation/routes/releasesRoutes';
import { createPulseRoutes }      from './presentation/routes/pulseRoutes';
import { createEmpFinopsRoutes }  from './presentation/routes/empFinopsRoutes';
```

Mounts:

```ts
// after app.route('/api/insights', createBenchmarkingRoutes(db));
app.route('/api/insights', createEmpFeatureRoutes(db));   // cross-team, delay-taxonomy, export
// after app.route('/api/finops', createFinopsRoutes(db));
app.route('/api/finops',   createEmpFinopsRoutes(db));    // rd-reconciliation
app.route('/api/releases', createReleasesRoutes(db));
app.route('/api/pulse',    createPulseRoutes(db));
```

---

## 4. `frontend/src/lib/rbac.ts` — capabilities

Add to the `CAPABILITIES` map (all manager-gated, mirroring the server `requireRole(MANAGER)`):

```ts
  'insights.crossTeam':      'manager', // EMP-5 internal cross-team benchmarking
  'insights.delayTaxonomy':  'manager', // EMP-9 delay root-cause lens
  'insights.pulse':          'manager', // EMP-15 pulse aggregate/admin (submit is any-role, server-gated)
  'finops.rdReconciliation': 'manager', // R&D derived-vs-reported reconciliation
```

> Cross-team could instead reuse the existing `insights.benchmarking`, and
> reconciliation `finops.manage`, if you prefer not to grow the map. The panel
> snippets below reference the new capabilities.

---

## 5. `frontend/src/lib/builderforceApi.ts` — task update accepts `releaseId`

The API task route (`taskRoutes.ts`) already accepts `releaseId` end-to-end. Only the
client body type needs it. In `tasksApi.update`'s body union add:

```ts
    releaseId?: string | null;
```

The `ReleasePicker` then persists via `tasksApi.update(taskId, { releaseId })`.

---

## 6. i18n patch

Run the merge (adds `insights.emp.*` + two `insights.delivhub.panel.*` keys to all 5
locales; idempotent, additive-only):

```
cd frontend && node scripts/i18n-merge.mjs scripts/i18n-patch-emp-features.mjs
```

(84 leaf keys per locale, symmetric across en/zh/es/fr/de.)

---

## 7. Frontend panel / control wiring (component files already written)

### 7a. Delivery hub — `frontend/src/components/insights/deliveryPanels.tsx`

```ts
import { CrossTeamBenchmarkLens } from './CrossTeamBenchmarkLens';
import { DelayTaxonomyLens } from './DelayTaxonomyLens';

// extend the union:
export type DeliveryPanelId = … | 'crossTeam' | 'delayTaxonomy';

// add to DELIVERY_PANELS (Summary can be a trivial tile or reuse an existing one):
crossTeam: {
  id: 'crossTeam', icon: '🏁', titleKey: 'panel.crossTeam', descKey: 'panel.crossTeamDesc',
  capability: 'insights.crossTeam', width: WIDE, Summary: () => null, render: () => <CrossTeamBenchmarkLens />,
},
delayTaxonomy: {
  id: 'delayTaxonomy', icon: '🧭', titleKey: 'panel.delayTaxonomy', descKey: 'panel.delayTaxonomyDesc',
  capability: 'insights.delayTaxonomy', width: WIDE, Summary: () => null, render: () => <DelayTaxonomyLens />,
},
```

`panel.crossTeam` / `panel.crossTeamDesc` / `panel.delayTaxonomy` / `panel.delayTaxonomyDesc`
are added under `insights.delivhub` by the i18n patch.

### 7b. Export menu — `frontend/src/components/insights/DeliveryDashboard.tsx`

In the flex-end header row (beside `DaysWindowSelect`):

```tsx
import { ExportMenu } from './ExportMenu';
…
<div style={{ display: 'flex', gap: 8 }}>
  <ExportMenu days={days} />
  <DaysWindowSelect value={days} onChange={setDays} />
</div>
```

### 7c. Finance hub — R&D reconciliation panel (`financePanels.tsx` or equivalent)

```tsx
import { RdReconciliationLens } from '@/components/insights/RdReconciliationLens';
// register a panel: capability 'finops.rdReconciliation' (or 'finops.manage'),
// render: () => <RdReconciliationLens />. Add a title/desc key to that hub's namespace.
```

### 7d. Pulse — people/DevEx hub + a dashboard widget

```tsx
import { PulseLens, PulseSubmitCard } from '@/components/insights/PulseWidget';
// Manager lens: register PulseLens as a panel (capability 'insights.pulse').
// Member widget: drop <PulseSubmitCard /> onto the home/insights dashboard — it
// renders nothing when there is no open survey, and shows a thank-you once answered.
```

### 7e. Task drawer — ReleasePicker + DelayReasonTag (`TaskMgmtContent.tsx`)

Inline-edit rows in the drawer, mirroring the existing `AssigneeSelect` pattern:

```tsx
import { ReleasePicker } from '@/components/ReleasePicker';
import { DelayReasonTag } from '@/components/DelayReasonTag';

// Release (persists through the existing task update path):
<ReleasePicker
  value={drawerTask.releaseId ?? null}
  projectId={drawerTask.projectId}
  onChange={(releaseId) => saveTaskField({ releaseId })}
/>

// Delay reason (owns its own persistence — writes to /api/insights/delay-taxonomy):
<DelayReasonTag taskId={drawerTask.id} value={drawerTask.delayReason ?? null} />
```

> Add `releaseId?: string | null` to the frontend `Task` type (`delayReason` is not a
> task column — it lives in `delay_reasons`; the tag control fetches/writes it itself,
> so `drawerTask.delayReason` is optional/omittable).

---

## 8. Scheduled export format (EMP-20) — `reportRoutes.ts`

`report_schedules.export_format` (mig 0318) lets a scheduled report attach the same
CSV / printable-HTML artifact. Wire it wherever the schedule is created/updated:

```ts
// in the schedule create/update body + insert/set:
exportFormat: body.exportFormat === 'html' ? 'html' : 'csv',
```

and in the delivery job, branch on `schedule.exportFormat` to call
`toCsv(rows)` vs `toHtmlTable(rows, { title })` from
`api/src/application/export/tabularExport.ts`.

---

## 9. Verification

- New backend files typecheck clean **except** the expected schema-dependent errors
  (missing `delayReasons` / `pulseSurveys` / `pulseResponses` exports and the three
  new `productReleases` columns) — all resolved by pasting §1.
- New frontend files: `tsgo --noEmit` passes with **0 errors**.
- i18n patch parses and is symmetric (84 leaves × 5 locales).
