# Integration note — Catalog Analytics + Prompt History/Analyzer + FACTS

All edits below target **shared files another process owns** (schema.ts, index.ts,
version.ts, rbac.ts, i18n messages). Apply them verbatim. Everything else
(routes, application compute, migrations, components, pages, the i18n patch mjs,
the API client methods) was created directly.

The migration `.sql` files are already written under `api/migrations/`:
`0300_facts.sql`, `0301_catalog_adoption_events.sql`.

---

## (a) Drizzle pgTable definitions — append to `api/src/infrastructure/database/schema.ts`

Uses `pgTable, uuid, integer, varchar, text, real, timestamp, index` — all already
imported/used in schema.ts (see existing `real(...)` at ~L949, `index(...)` at ~L1157).

```ts
/**
 * FACTS library — structured (subject, predicate, object) triples with provenance.
 * Powers /api/facts + the /facts page; recallable by agent tooling. Migration 0300.
 *   project_id NULL → tenant-global fact; set → scoped to one project.
 */
export const facts = pgTable('facts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  subject:    varchar('subject', { length: 255 }).notNull(),
  predicate:  varchar('predicate', { length: 255 }).notNull(),
  object:     text('object').notNull(),
  source:     varchar('source', { length: 255 }),
  confidence: real('confidence'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_facts_tenant_updated').on(t.tenantId, t.updatedAt),
  index('idx_facts_tenant_subject').on(t.tenantId, t.subject),
  index('idx_facts_tenant_predicate').on(t.tenantId, t.predicate),
  index('idx_facts_tenant_project').on(t.tenantId, t.projectId),
]);

/**
 * Generic, timestamped catalog adoption event log (skill | persona | prompt).
 * Feeds the over-time series in /api/catalog-analytics for events with no other
 * timestamped home (notably true prompt "uses"). Append-only. Migration 0301.
 */
export const catalogAdoptionEvents = pgTable('catalog_adoption_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 16 }).notNull(),        // skill | persona | prompt
  itemId:     varchar('item_id', { length: 128 }).notNull(),
  itemName:   varchar('item_name', { length: 255 }),
  eventType:  varchar('event_type', { length: 16 }).notNull().default('install'), // install | usage
  actorId:    varchar('actor_id', { length: 64 }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_catalog_events_tenant_kind_time').on(t.tenantId, t.kind, t.createdAt),
  index('idx_catalog_events_tenant_kind_item').on(t.tenantId, t.kind, t.itemId),
]);
```

> Until these two tables land in schema.ts, `tsc` in `api/` will report
> "has no exported member 'facts'/'catalogAdoptionEvents'" in the new files
> (`catalogAnalytics.ts`, `factsQuery.ts`, `factsRoutes.ts`, `promptAnalyzerRoutes.ts`
> imports them). **Expected-until-integrated.**

---

## (b) Migration files (already created)

- `api/migrations/0300_facts.sql` — `facts` table + 4 indexes.
- `api/migrations/0301_catalog_adoption_events.sql` — `catalog_adoption_events` + 2 indexes.

Both are idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).

---

## (c) Route registration — add to `api/src/index.ts`

Imports (near the other route imports, ~L54–L120):

```ts
import { createCatalogAnalyticsRoutes } from './presentation/routes/catalogAnalyticsRoutes';
import { createFactsRoutes }            from './presentation/routes/factsRoutes';
import { createPromptAnalyzerRoutes }   from './presentation/routes/promptAnalyzerRoutes';
```

Mounts (near the other `app.route('/api/...')` calls, ~L420–L450):

```ts
app.route('/api/catalog-analytics', createCatalogAnalyticsRoutes(db));
app.route('/api/facts',             createFactsRoutes(db));
app.route('/api/prompt-analyzer',   createPromptAnalyzerRoutes(db));
```

Endpoints exposed:
- `GET  /api/catalog-analytics/:kind?window=`  (kind = skills | personas | prompts)
- `GET  /api/facts?subject=&predicate=&q=&projectId=` · `GET /api/facts/schema` · `POST /api/facts` · `PATCH /api/facts/:id` · `DELETE /api/facts/:id`
- `POST /api/prompt-analyzer/:id/analyze`

---

## (d) RBAC capability additions — `frontend/src/lib/rbac.ts`

Add to the `CAPABILITIES` map. (The FACTS page already gates writes defensively via
`hasMinRole(role, 'developer')`, so this is for consistency/reuse, not strictly required.)

```ts
  // FACTS library — structured knowledge store. Reads open to any member; writes
  // (create/edit/delete) developer+, mirroring the API requireRole(DEVELOPER).
  'facts.view':   'viewer',
  'facts.manage': 'developer',
```

Server enforcement is already in `factsRoutes.ts` (`requireRole(TenantRole.DEVELOPER)`
on POST/PATCH/DELETE).

---

## (e) i18n — run the merge (do NOT hand-edit messages/*.json)

The patch module is created at `frontend/scripts/i18n-patch-catalog.mjs` (PATCHES
keyed en/zh/es/fr/de, real translations). Apply with the existing merger:

```bash
cd frontend && node scripts/i18n-merge.mjs scripts/i18n-patch-catalog.mjs
```

Adds namespaces `catalogAnalytics`, `promptHistory`, `factsPage`, and extends the
existing `promptsPage` namespace (missing leaves only — never overwrites).

---

## (f) Widgets — `frontend/src/lib/widgets/allWidgets.ts`

**No change.** No new pinnable widget module was added; the adoption trend is
surfaced inline in the shared `CatalogInsightsBar` (behind a 7/30/90-day window
toggle, `showTrend` prop), not as a standalone widget. If a pinnable
"Catalog adoption trend" widget is desired later, add a `CATALOG_ANALYTICS_WIDGETS`
module and a `...CATALOG_ANALYTICS_WIDGETS,` spread line here.

---

## (g) Nav entry for /facts (snippet — apply in your nav config)

Add a Facts destination wherever app nav items are declared (e.g. the Knowledge/
Insights group):

```ts
{ href: '/facts', label: t('facts') /* add 'facts' to nav i18n */, icon: /* your icon */ }
```

`/facts` is an authed app page (`runtime='edge'`).

---

## Files created (for reference)

Backend:
- `api/src/application/insights/catalogAnalytics.ts` (compute + `recordCatalogAdoption` + version key)
- `api/src/presentation/routes/catalogAnalyticsRoutes.ts`
- `api/src/application/facts/factsQuery.ts`
- `api/src/presentation/routes/factsRoutes.ts`
- `api/src/presentation/routes/promptAnalyzerRoutes.ts`
- `api/migrations/0300_facts.sql`, `api/migrations/0301_catalog_adoption_events.sql`
- (edit) `api/src/presentation/routes/promptLibraryRoutes.ts` — records a `usage`
  event on `/public/:slug/use` via `recordCatalogAdoption` (non-forbidden file).

Frontend:
- `frontend/src/lib/textDiff.ts` (LCS line diff)
- `frontend/src/components/prompts/PromptVersionDiff.tsx`
- `frontend/src/app/facts/page.tsx` + `frontend/src/app/facts/FactsPageClient.tsx`
- `frontend/scripts/i18n-patch-catalog.mjs`
- (edit) `frontend/src/components/CatalogInsightsBar.tsx` — server adoption trend + window toggle
- (edit) `frontend/src/app/prompts/PromptsPageClient.tsx` — History + Analyze wiring
- (edit) `frontend/src/lib/builderforceApi.ts` — `catalogAnalyticsApi`, `factsApi`,
  `promptLibraryApi.analyze`, + `PromptAnalysis`/`CatalogAnalytics`/`Fact`/`FactInput` types
