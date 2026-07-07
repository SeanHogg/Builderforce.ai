# Integration note — Persona-role 2D RBAC · Annual-calendar cadence · Blended workforce planning

Paste-ready edits for the **shared files this feature must not edit directly**
(`schema.ts`, `index.ts`, `rbac.ts`, `allWidgets.ts`, i18n messages, and the shared
insights/settings/workforce surfaces). Everything else (routes, application logic,
components, pages, migrations, the i18n patch script) already ships as NEW files.

Migration numbers used: **0308** (member_personas), **0309** (lens_snapshots). No
0310 needed — deliverable C reuses the existing `member_profiles` (mig 0116).

---

## 1. Drizzle schema defs — `api/src/infrastructure/database/schema.ts`

Append these two `pgTable`s (near `memberProfiles` / `reportSchedules`). All the
column helpers (`serial`? no — we use `uuid`, `integer`, `varchar`, `boolean`,
`timestamp`, `jsonb`, `unique`) are already imported in this file.

```ts
// ---------------------------------------------------------------------------
// Persona-role 2D RBAC — the lateral "lens persona" dimension (migration 0308)
// ---------------------------------------------------------------------------

/**
 * A user's lateral lens persona(s) — ceo|cfo|cto|ciso|pmo|em|ic. Orthogonal to the
 * four-tier access level: it reorders/highlights insight lenses, it is NOT an
 * access grant. Exactly one row per (tenant,user) is is_primary (DB partial-unique
 * index in the migration; the route also flips siblings off). See migration 0308.
 */
export const memberPersonas = pgTable('member_personas', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 64 }).notNull(),
  persona:   varchar('persona', { length: 16 }).notNull(), // ceo|cfo|cto|ciso|pmo|em|ic
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_member_persona').on(t.tenantId, t.userId, t.persona),
]);

// ---------------------------------------------------------------------------
// Annual-calendar cadence — periodic lens review snapshots (migration 0309)
// ---------------------------------------------------------------------------

/**
 * A frozen point-in-time capture of an insight lens for a review period. Written
 * by the cron sweep (dueSnapshots) as rolling month/quarter/year snapshots that
 * freeze at period close; the (tenant,lens,period) unique index is the upsert
 * target. period = 'YYYY-MM' | 'YYYY-Qn' | 'YYYY'. See migration 0309.
 */
export const lensSnapshots = pgTable('lens_snapshots', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  lens:        varchar('lens', { length: 32 }).notNull(),
  period:      varchar('period', { length: 16 }).notNull(),
  payload:     jsonb('payload').notNull().default({}),
  generatedAt: timestamp('generated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_lens_snapshot').on(t.tenantId, t.lens, t.period),
]);
```

> Once these are pasted, the only remaining `tsgo` errors in the new API files
> (`memberPersonas` / `lensSnapshots` "has no exported member", and the downstream
> `never` insert in memberPersonaRoutes) all resolve — they are purely the
> schema-not-yet-present errors noted during build.

Migration files already created:
- `api/migrations/0308_member_personas.sql` — table + `uq_member_persona`, tenant/user
  indexes, and the **partial unique** `uq_member_persona_primary … WHERE is_primary`.
- `api/migrations/0309_lens_snapshots.sql` — table + `uq_lens_snapshot`, lens/tenant
  indexes, and the `set_default_segment_id()` trigger (matches report_schedules).

---

## 2. Route registration + cron wiring — `api/src/index.ts`

**Imports** (near the other route imports):

```ts
import { createMemberPersonaRoutes } from './presentation/routes/memberPersonaRoutes';
import { createLensSnapshotRoutes }  from './presentation/routes/lensSnapshotRoutes';
import { createWorkforcePlanRoutes } from './presentation/routes/workforcePlanRoutes';
import { dueSnapshots }              from './application/reports/lensSnapshots';
```

**Mounts** (in the `app.route(...)` block):

```ts
app.route('/api/member-personas', createMemberPersonaRoutes(db));
// Mounts alongside the other /api/insights creators (adds GET/POST /snapshots*).
app.route('/api/insights',        createLensSnapshotRoutes(db));
// Mounts alongside createWorkforceRoutes (adds GET /plan).
app.route('/api/workforce',       createWorkforcePlanRoutes(db));
```

**Cron** — add beside the existing `runDueReports(...)` waitUntil in the scheduled
handler (~line 743), same frequent tick:

```ts
// Annual-calendar cadence — capture the rolling month/quarter/year lens snapshots
// for each tenant (freezes at period close). Same sweep pattern as runDueReports;
// bounded + staleness-gated so it's safe on every tick.
ctx.waitUntil(
  dueSnapshots(env).catch((err) => {
    console.error('[cron:lens-snapshots] failed', err);
  }),
);
```

---

## 3. RBAC capabilities (OPTIONAL) — `frontend/src/lib/rbac.ts`

The shipped components gate the manager surfaces on the existing
`insights.engineering` capability, so they work with **no rbac change**. If you
prefer dedicated capabilities, add to the `CAPABILITIES` map:

```ts
  // Blended human+agent workforce planning (capacity vs WIP + hire-vs-agent cost).
  'workforce.plan':      'manager',
  // Periodic lens review snapshots (monthly/quarterly/annual).
  'insights.snapshots':  'manager',
```

Then switch the gates: `WorkforcePlanView`'s page + `workforcePlanWidgets.tsx`
`METRICS_CAP` → `'workforce.plan'`; `app/insights/snapshots/page.tsx` +
`LensSnapshotsPanel` mount → `'insights.snapshots'`. (Persona set/get is available
to every member — self-service — so it needs no capability.)

---

## 4. Pinnable widgets — `frontend/src/lib/widgets/allWidgets.ts`

```ts
import { WORKFORCE_PLAN_WIDGETS } from '@/components/widgets/registry-modules/workforcePlanWidgets';
// …in the ALL_WIDGETS array, after WORKFORCE_WIDGETS:
  ...WORKFORCE_PLAN_WIDGETS,
```

---

## 5. i18n — run the patch (adds keys to all 5 locales)

The messages JSONs are shared; apply the NEW patch script with the existing merge
tool (idempotent, only adds missing leaf keys):

```bash
cd frontend
node scripts/i18n-merge.mjs scripts/i18n-patch-workforce-plan.mjs
```

Adds namespaces `personaLens`, `lensSnapshots`, `workforcePlan`, and
`widgets.{group.wfPlan,title.wfp*,wfp.*}` for en/zh/es/fr/de.

---

## 6. Wire into shared surfaces (OPTIONAL — new-file routes already work standalone)

The three surfaces already ship as **working standalone routes**
(`/settings/persona`, `/insights/snapshots`, `/workforce/plan`). To also expose
them as tabs/links inside the shared shells:

**`frontend/src/components/settings/SettingsClient.tsx`** — add a sub-tab:

```tsx
// import PersonaSelector from '@/components/settings/PersonaSelector';
// in subTabs:
{ id: 'persona', label: t('personaTab'), icon: '🎯', href: '/settings?sub=persona' },
// in the render switch:
: sub === 'persona' ? <PersonaSelector />
```
(Add `settings.personaTab` to i18n, or just rely on the `/settings/persona` route.)

**`frontend/src/app/insights/page.tsx`** — surface the persona chip + a link to the
review-snapshots hub in the header actions:

```tsx
import { PersonaLensChip } from '@/components/insights/PersonaLensChip';
// …in the header actions row:
<PersonaLensChip />
<Link href="/insights/snapshots" style={primaryBtn}>{t('home.reviewSnapshots')}</Link>
```

**`frontend/src/app/workforce/page.tsx`** — add `'plan'` to `WorkforceTab`/`TAB_IDS`
and render `<WorkforcePlanView/>` for `tab === 'plan'` (or link to `/workforce/plan`).
The nav tab bar is driven by `navGroups` (`SectionTabs`), so add a `?tab=plan` entry
there too.

---

## New files delivered (all typecheck clean except the schema-dependent errors above)

**API**
- `migrations/0308_member_personas.sql`, `migrations/0309_lens_snapshots.sql`
- `src/application/rbac/personaLens.ts` — persona→lens mapping (pure, shared source)
- `src/application/reports/lensSnapshots.ts` — captureLensSnapshot + dueSnapshots (cron)
- `src/application/insights/workforcePlanning.ts` — computeWorkforcePlan
- `src/presentation/routes/memberPersonaRoutes.ts` — `/api/member-personas`
- `src/presentation/routes/lensSnapshotRoutes.ts` — `/api/insights/snapshots`
- `src/presentation/routes/workforcePlanRoutes.ts` — `/api/workforce/plan`

**Frontend**
- `src/lib/lensPersona.ts` — client mirror of the persona→lens map + lens routes
- `src/lib/useLensPersona.ts` — the `useLensPersona` hook
- `src/lib/personaCadenceApi.ts` — API client (personas / snapshots / workforce plan)
- `src/components/settings/PersonaSelector.tsx` + `src/app/settings/persona/page.tsx`
- `src/components/insights/PersonaLensChip.tsx`
- `src/components/insights/LensSnapshotsPanel.tsx` + `src/app/insights/snapshots/page.tsx`
- `src/components/workforce/WorkforcePlanView.tsx` + `src/app/workforce/plan/page.tsx`
- `src/components/widgets/registry-modules/workforcePlanWidgets.tsx`
- `scripts/i18n-patch-workforce-plan.mjs`
