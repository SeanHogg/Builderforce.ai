# EMP metrics (EMP-12..20) — integration snippets

Paste-ready edits for the SHARED files that this task was not allowed to modify.
Everything else (compute files, routes, migration, i18n patch, widgets, panels,
API client) is already written and typechecks. Apply the snippets below to wire it up.

---

## 1. Migration files

Created directly:

- `api/migrations/0311_coaching_notes.sql` — `coaching_notes` table (EMP-16). ✅ committed to repo.

Reserved but UNUSED (no other deliverable needed a schema change; EMP-12/13/14/17/19/20
read existing tables): **0312, 0313, 0314** — leave free for the next tracks.

---

## 2. Drizzle schema (`api/src/infrastructure/database/schema.ts`)

The `coaching_notes` table is currently defined in a NEW standalone module
`api/src/infrastructure/database/empMetricsSchema.ts` (so the code compiles without
touching schema.ts). For repo convention you MAY relocate it into schema.ts. If you
do, delete `empMetricsSchema.ts` and update the import in
`api/src/presentation/routes/empMetricsRoutes.ts`:

```ts
// was:  import { coachingNotes } from '../../infrastructure/database/empMetricsSchema';
import { coachingNotes } from '../../infrastructure/database/schema';
```

Canonical pgTable def to add to schema.ts (near member_profiles / member_metrics_period):

```ts
/** Manager coaching notes attached to a workforce member (EMP-16, migration 0311).
 *  Polymorphic (member_kind, member_ref) identity; no FK on member_ref. */
export const coachingNotes = pgTable('coaching_notes', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind: varchar('member_kind', { length: 16 }).notNull(),
  memberRef:  varchar('member_ref', { length: 64 }).notNull(),
  note:       text('note').notNull(),
  authorId:   varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_coaching_notes_member').on(t.tenantId, t.memberKind, t.memberRef),
]);
```

> NOTE: keep EITHER `empMetricsSchema.ts` OR the schema.ts def — not both (the
> pgTable name `coaching_notes` would be declared twice). The standalone module is
> the default so the build is green as delivered.

---

## 3. Route registration (`api/src/index.ts`)

Add the import next to the other route imports (near line 42):

```ts
import { createEmpMetricsRoutes } from './presentation/routes/empMetricsRoutes';
```

Mount it as an ADDITIONAL router on the SAME `/api/members` prefix, immediately
after the existing member-routes mount (line ~436). Hono merges the two routers'
routes under the shared prefix, so the EMP paths resolve fine:

```ts
app.route('/api/members',  createMemberRoutes(db));
app.route('/api/members',  createEmpMetricsRoutes(db));   // ← add this line (EMP-12..20)
```

New endpoints (all MANAGER+):
`GET /allocation-health`, `GET /collaboration`, `GET /doc-activity`,
`GET /labor-cost`, `GET /performer-tiers`, `GET|POST /coaching-notes`,
`DELETE /coaching-notes/:id`, `GET /initiative-allocation`, `GET /metrics/export`.

---

## 4. RBAC (`frontend/src/lib/rbac.ts`)

No changes. All EMP surfaces reuse the existing `insights.engineering` capability
(manager), matching the API's `requireRole(MANAGER)` gates. Nothing to add.

---

## 5. Widget registry (`frontend/src/lib/widgets/allWidgets.ts`)

Register the new widget module so the 6 EMP cards become pinnable:

```ts
import { EMP_METRICS_WIDGETS } from '@/components/widgets/registry-modules/empMetricsWidgets';
// ...
export const ALL_WIDGETS: WidgetDef[] = [
  // ...existing...
  ...WORKFORCE_WIDGETS,
  ...EMP_METRICS_WIDGETS,   // ← add
];
```

Widgets: `emp.over-allocated`, `emp.collab-score`, `emp.doc-authors`,
`emp.labor-by-project`, `emp.performer-tiers`, `emp.initiative-mix`
(groups: empAllocation / empCollaboration / empDocs / empCost / empPerformers / empInitiatives).

---

## 6. i18n (`frontend/src/i18n/messages/*.json`)

Do NOT hand-edit the JSON. Apply the new patch (same mechanism as the observability
patch) which merges the `widgets.group` / `widgets.title` / `widgets.emp` keys for
all 5 locales:

```bash
cd frontend
node scripts/i18n-merge.mjs scripts/i18n-patch-emp-metrics.mjs   # confirm exact invocation vs the observability patch
```

New patch file: `frontend/scripts/i18n-patch-emp-metrics.mjs` (EN/ZH/ES/FR/DE,
identical shape to `i18n-patch-observability.mjs`). The panels + widgets read these
keys under the `widgets` namespace (`t('emp.*')`, `t('title.emp*')`, `t('group.emp*')`).
Until the patch is merged the EMP UI will render raw key paths.

---

## 7. Files delivered (new, already typechecked)

API compute (`api/src/application/metrics/`):
- `allocationHealth.ts` (EMP-12) · `collaboration.ts` (EMP-14) · `docActivity.ts` (EMP-17)
- `laborCost.ts` (EMP-19, exports shared `taskEffortHours`) · `performerTiers.ts` (EMP-16)
- `memberInitiativeAlloc.ts` (EMP-13) · `metricsCsv.ts` (EMP-20, shared `toCsv`)

API infra/routes/migration:
- `infrastructure/database/empMetricsSchema.ts` · `presentation/routes/empMetricsRoutes.ts`
- `migrations/0311_coaching_notes.sql`

Frontend:
- `components/workforce/EmpMetricsView.tsx` (all 6 panels + coaching CRUD + CSV export button)
- `components/widgets/registry-modules/empMetricsWidgets.tsx` (6 pinnable widgets)
- `scripts/i18n-patch-emp-metrics.mjs`
- edits: `lib/builderforceApi.ts` (empMetricsApi + types), `components/workforce/PerformanceView.tsx`
  (mounts EmpMetricsView), `components/workforce/WorkforceMetricsContent.tsx` (Export button)
