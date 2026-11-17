# PRD 47 — One Collection view: Card | List, selection, bulk Delete/Archive/Merge, server paging and sort

**Status:** Design for review · 2026-11-17 · **Owner:** frontend design system + api platform
**Requested by the operator (2026-11-17):** every page that shows a list or cards uses ONE shared Card | List
component, with checkbox selection + select-all, bulk **Delete / Archive / Merge** executed server-side in ONE
request (ids + tenant), pagination at **50 / 100 / 250**, a fixed header and footer with only the rows/cards
scrolling, and column sorting. List-only pages gain Card (e.g. `/projects?tab=tasks`); bespoke data pages adopt
the component (e.g. `/workforce?tab=roles`).
**Builds on:** [PRD 21 — Unified Experience](./21-prd-unified-experience.md) (design system, tokens, panels).

---

## 1. Why — what the analysis found

| # | Finding | Evidence |
|---|---|---|
| F1 | The Card \| List toggle is shared, the collection is not. `ViewToggle` has ~31 importers; each one re-implements the grid, the `<table>`, the empty state and the count. | `components/ViewToggle.tsx`; e.g. `ProjectsContent.tsx` + `ProjectTable.tsx`, `TeamsView.tsx`, `PersonasClient.tsx` |
| F2 | A paging chrome exists and is almost unused. `DataList` has ONE consumer (Tasks); `DataTable` has ZERO. Page sizes are 50/100/200, not 50/100/250. | `components/dataTable/*`, `usePageSize.ts:18` |
| F3 | Pagination reaches 5 surfaces (blog, marketplace, prompts, startups, tasks). Four others roll their own "Load more" (creation library, quality, ceremony history, replay). ~120 surfaces render every row. | `components/Pagination.tsx` importers |
| F4 | Sorting exists only in admin (`useTableSort`/`SortableTh` in `admin/adminShared.tsx:214-320`), plus one-offs in `LeadsView`, `RecordingsTable`, `SkillsBrowser`, `/prompts`. | — |
| F5 | Selection is hand-rolled 4 times (`CreationLibraryPanel`, `TaskMgmtContent`, `SessionList`, `SuspectAccountsPanel`); no shared hook, no indeterminate header checkbox, no select-all on the creation library. | — |
| F6 | **The bulk actions that exist fan out one request per record** — the 429 the operator hit. `useCreationLibraryActions.ts:82,89` (`Promise.all(ids.map(update/remove))`), `:93-96` (sequential merge loop), `TaskMgmtContent.tsx:978-1002` (sequential status/move loops). Seven more per-id `Promise.all` fan-outs in galleries/settings. | rate limiter: one per-tenant sliding window, FREE 300 / PRO 1200 / TEAMS 3000 rpm (`api/src/application/ratelimit/tenantBuckets.ts:27`) |
| F7 | The server has no bulk contract, no page contract, no sort allowlist helper. Every collection `GET` is unbounded or capped at `LIST_ROW_CAP = 1000` and returns a bare array or `{plural}`. Only `/api/personas/public` and `/api/prompts/public` take `sort + limit + offset`. | `api/src/domain/shared/boundedInt.ts:33-71`; `personaRoutes.ts:145-179`, `promptLibraryRoutes.ts:125-176` |
| F8 | Archive is represented four ways (`tasks.archived` bool, `projects.status='archived'`, `creation_sessions.archived_at`+`status`, `brain_chats.is_archived`) and is absent for most entities (workflows, teams, personas, prompts, …). | `api/src/infrastructure/database/schema/*` |
| F9 | Merge exists for 3 entities, each with its own route and shape: contributors (preview + apply + revert), creation sessions (pairwise), brain chats (`consolidate`). | `contributorRoutes.ts:177-198`, `creationSessionRoutes.ts:1941`, `brainRoutes.ts:479` |
| F10 | `CreationLibraryPanel` already has the target UX (Card\|List, checkboxes, `SessionBulkBar` with Merge/Archive/Delete, merge slide-out, `useConfirm`, persisted view) — but it is local to creation-sessions and uses raw `localStorage`. | `components/creation-sessions/*` |

The pieces are all present. The work is to **extract them into one component, add the missing server contracts, and migrate every surface** — not to write a new parallel copy.

## 2. Scope rule

**In scope:** every surface that browses a collection of records — persisted entities (projects, tasks, roles, …)
and read-only catalogs (marketplace, blog, models, traces, audit log, report rows). Each one renders through
`<Collection>` with Card and List modes, sort, paging and a pinned header and footer. Selection and the bulk bar
appear **only** when the entity has a registered bulk port and the viewer holds the permission (§5). The
component makes that decision itself; the page passes no `canX` flag.

**Out of scope (named, with reason):**

| Surface | Why it is not a collection |
|---|---|
| `CeremonyHistoryPanel`, `CeremonyStage`, `PmVisualizersContent`, `TaskPrdTab` ViewToggles | The toggle picks a filter or a mode (ceremony kind, stage, tree/timeline, preview/raw), not a layout. `ViewToggle` with `options` stays for these. |
| `components/insights/*` lens/widget tables | Chart companions inside a widget, sized by the widget. |
| `PermissionsPanel` role × permission matrix | An editable matrix, not rows. |
| `app/import/BulkDryRunReport`, `BulkMappingTable` | Local, transient wizard state. |
| Canvas internals (`creation-canvas/*`, `domains/canvas`) | Canvas object selection is a different model. |
| Board, Calendar, Gantt views | They stay and become **extra views** on the Collection (§4.4), not replacements. |

## 3. End state

```
page (≤ ~150 lines: descriptor + filters only)
 └─ <Collection descriptor={tasksCollection} source={useServerSource(tasksPage)} filters={…} extraViews={{board, calendar, gantt}} />
     ├─ CollectionHeader      (fixed)  search · filter slot · count · sort (card mode) · ViewToggle
     ├─ CollectionBulkBar     (fixed, when selection > 0)  N selected · Select all {total} · Archive/Restore · Merge · Delete · Clear
     ├─ body                  (scrolls)
     │   ├─ CollectionTable   sticky <thead>, checkbox column, SortableTh per sortable column
     │   └─ CollectionCards   auto-fill grid, checkbox per card, header "select page" checkbox
     ├─ CollectionFooter      (fixed)  "1–50 of 4,453" · <Pagination> · per page [50|100|250]
     └─ MergeTargetPanel      SlideOutPanel: pick the record to keep → preview counts → Merge

api
 GET  /api/<entity>?page=1&pageSize=50&sort=updatedAt&dir=desc&archived=exclude|only|all&q=…   → Page<T>
 POST /api/collections/:entity/bulk   { action, ids[], targetId?, dryRun? }                  → BulkResult
       └─ runBulkAction (application/collections) → BulkEntityPort registry (one port per entity, owned by its domain)
```

### 3.1 Frontend files — `frontend/src/components/collection/`

Each module has one job and stays well under 400 lines. A new entity adds DATA (a descriptor and a port row),
never a branch.

| File | Responsibility | Origin (extract, then delete the original) |
|---|---|---|
| `Collection.tsx` | Composes header, bulk bar, body, footer; flex-column layout that fills the parent, `min-height:0`, body `overflow:auto` | `DataList.tsx` + `DataTable.tsx` layout contract |
| `CollectionHeader.tsx` | search, filter `children` slot, result count, card-mode sort select, ViewToggle | `CatalogToolbar.tsx` |
| `CollectionTable.tsx` | `<table>`, sticky `<thead>`, checkbox column (sticky-left), sortable headers | `DataTable.tsx`, `dataTableStyles.ts`, `.data-table` CSS |
| `CollectionCards.tsx` | auto-fill `minmax()` grid; wraps the descriptor's `card(row)` with a selection checkbox | `CreationSessionTile.tsx` card chrome |
| `CollectionFooter.tsx` | range text, `Pagination`, per-page select | `DataTable.tsx` footer |
| `CollectionBulkBar.tsx` | selection count, select-all-matching, Archive/Restore, Merge, Delete, Clear; `useConfirm({destructive:true})` for Delete | `creation-sessions/SessionBulkBar.tsx` (+ module css) |
| `MergeTargetPanel.tsx` | `SlideOutPanel` with a target `Select` and `dryRun` preview counts | `SessionEditorPanel.tsx` merge usage |
| `SortableTh.tsx`, `useCollectionSort.ts` | `aria-sort` header button; local comparator sort or server `sort/dir` state | `admin/adminShared.tsx:214-320` |
| `useCollectionSelection.ts` | `Set<string>` keyed by row id, survives page changes, page-scoped header state (none/some/all → `indeterminate`), `selectAllMatching()` | new; replaces 4 hand-rolled copies |
| `useCollectionPaging.ts` | page + pageSize (50/100/250), resets page on filter/sort change | `dataTable/usePageSize.ts` |
| `collectionPreferences.ts` | per-surface persisted view mode + page size via `lib/storage.ts` (`readLocalJson`/`writeLocalJson`), `useSyncExternalStore`, legacy `list`→`table` mapping | `creation-sessions/libraryViewPreference.ts` (removes a raw-storage site) |
| `sources.ts` | `CollectionSource<Row>` port: `useLocalSource(rows, comparators)` (static catalogs, client sort/slice) and `useServerSource(fetchPage)` (server page/sort, keeps previous page while loading) | new |
| `useBulkAction.ts` | calls `collectionsApi.bulk`, then refetches the page, clears the selection, shows the toast with `succeeded`/`skipped` counts | new; replaces `useCreationLibraryActions` loops |
| `descriptor.ts` | `CollectionDescriptor<Row>` type (below) | new |
| `lib/collectionsApi.ts` | typed client over `apiRequest` for `bulk` | new |

```ts
export interface CollectionDescriptor<Row> {
  entity: BulkEntityKey | null;          // null = read-only collection (no selection, no bulk bar)
  surfaceKey: string;                     // preference key, e.g. 'projects.tasks'
  rowId: (row: Row) => string;
  columns: CollectionColumn<Row>[];       // List mode
  card: (row: Row) => React.ReactNode;    // Card mode body (selection checkbox is added by CollectionCards)
  label: (row: Row) => string;            // merge picker + confirm copy
  defaultView?: 'card' | 'table';
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  emptyKey: string;                       // i18n key
}
export interface CollectionColumn<Row> {
  key: string; header: string;            // header is an already-translated string
  cell: (row: Row) => React.ReactNode;
  sortKey?: string;                       // must match the server allowlist for server sources
  compare?: (a: Row, b: Row) => number;   // local sources
  width?: string; align?: 'start' | 'end';
}
```

The bulk bar decides its own visibility. It renders nothing when `entity` is null or the selection is empty, and
it shows each action only if the entity's capability row lists it **and** `usePermission(capability.permission)`
passes. Disabled-with-reason follows the RoleGate convention: an action is disabled, never hidden, when the
entity supports it but the viewer's role does not allow it.

### 3.2 Behaviour contract

- **Fixed header and footer.** The header, the bulk bar, the table `<thead>` and the footer never scroll. Only the
  row or card area scrolls. `Collection` fills its parent's height. A page that is not a flex column gets a
  `max-height: calc(100dvh - var(--shell-top))` default.
- **Page sizes** are 50, 100 and 250 (default 50), persisted per surface. Changing the size, the sort or a filter
  returns to page 1.
- **Sorting.** In List mode a header click cycles asc → desc. In Card mode a "Sort by" select lists the same
  sortable columns. Sort is persisted per surface. Server sources send `sort`/`dir`. Local sources use `compare`.
- **Selection.**
  - The header checkbox selects or clears the **current page**, and shows `indeterminate` when part of the page
    is selected.
  - When the whole page is selected and `total > pageSize`, a banner offers **"Select all {total}"**. That calls
    the same list endpoint with `fields=id` (one request, ids only), capped at `BULK_MAX = 1000`. Above the cap
    the banner says so, and the action can run on the first 1000.
  - Selection survives page changes. A filter change clears it.
- **Bulk actions.**
  - **Delete:** `useConfirm({destructive:true})` with the count and the first three labels.
  - **Archive:** no confirm. A toast offers Undo (a Restore call). When the view shows archived items, Archive
    becomes **Restore**.
  - **Merge:** enabled at 2 or more selected. The slide-out picks the record to keep, shows a `dryRun` preview
    ("moves 34 tasks, 3 PRDs; 2 projects archived"), then applies.
- **One request per action**, regardless of the count. The response reports `succeeded[]` and `skipped[{id,
  reason}]`, and the toast reads "Archived 48 · 2 skipped" with the reasons expandable.
- **Archived filter.** Every entity with archive support shows a uniform Active / Archived / All segmented filter
  in the header. It maps to `archived=exclude|only|all`, the param `brainRoutes` already uses.
- **Responsive.** List mode scrolls horizontally inside the body, with the checkbox column and the first column
  sticky. Under a 640px container width the default view is Card. Tap targets are at least 40px. The layout must
  not overflow at 360px.
- **Theme.** Tokens only (`--bg-elevated`, `--border-subtle`, `--text-*`, `--coral-bright`). No literals
  (`check:design-scale`).
- **i18n.** New `common.collection.*` keys cover selection, bulk, sort, the archived filter, merge, the range
  text and the skipped reasons. Add them to en/zh/es/fr/de with real translations. Retire the duplicate
  `sessionManagement.bulk*` and `taskMgmt` hardcoded "selected" string.
- **a11y.** Row checkboxes get `aria-label` "Select {label}". The bulk bar is `role="toolbar"`. Range changes are
  announced through `aria-live="polite"`.

### 3.3 Server contracts

**Shared types** live in `packages/interaction-contract/src/api/collection.ts`, consumed by both api and
frontend.

```ts
export const PAGE_SIZES = [50, 100, 250] as const;
export const BULK_MAX = 1000;
export interface PageQuery { page: number; pageSize: 50 | 100 | 250; sort: string; dir: 'asc' | 'desc'; archived: 'exclude' | 'only' | 'all'; q?: string }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number; sort: string; dir: 'asc' | 'desc' }
export type BulkAction = 'delete' | 'archive' | 'restore' | 'merge';
export interface BulkRequest { action: BulkAction; ids: string[]; targetId?: string; dryRun?: boolean }
export interface BulkResult { action: BulkAction; succeeded: string[]; skipped: { id: string; reason: 'not_found' | 'forbidden' | 'builtin' | 'conflict' | 'already' }[]; preview?: Record<string, number> }
```

**Paging.**
- `api/src/presentation/routes/pageQuery.ts` exports
  `parsePageQuery(c, { sorts: Record<string, Column>, defaultSort })`. It is built on `limitParam`/`offsetParam`,
  rejects any sort key outside the allowlist with a 400, and returns `{ limit, offset, orderBy, archived, q }`.
- `total` comes from `count(*) over()` in the same query, so one round trip returns both rows and total.
- Every list `GET` behind a Collection accepts the params. It returns `Page<T>` **when `page` is present**. With
  no `page` it returns its current shape, which keeps the non-UI callers (VS Code, MCP tools, agents) working.
- A `check:collection-endpoints` guard keeps the frontend honest: no Collection calls a list endpoint without
  `page`.
- **Caching:** a list already on `getOrSetCached` (projects, teams, workflow definitions) folds `page`, `pageSize`,
  `sort`, `dir`, `archived` and a `q` hash into its key under the existing version token. Bulk writes bump that
  token. Lists that are not cached today (tasks: per-row enrichment) state the reason in the route.
- **Fix the workflows list in place.** It filters in memory after an unbounded select (`workflowRoutes.ts:259-263`).
  Push those filters into SQL.

**Bulk.**
- The route is `POST /api/collections/:entity/bulk` in `presentation/routes/collectionBulkRoutes.ts`. It parses
  with zod: `ids` holds 1 to `BULK_MAX` unique strings, and `merge` needs a `targetId` that is one of `ids`. It
  then calls `runBulkAction`. It never imports a table.
- `application/collections/runBulkAction.ts` runs these steps in order:
  1. Resolve the port from the registry. An unknown entity is a 404.
  2. Check the action is in `port.capabilities`. If not, 400.
  3. `requirePermission(port.permissions[action])`.
  4. Call the port with `{ tenantId, segmentId, actor, db, env }`. The tenant is **always** the authenticated
     tenant from the JWT. The body carries no tenant id, and any id outside the tenant comes back as
     `skipped: not_found`, so the response never confirms that a record exists.
  5. `recordActivityBatch` writes one activity per succeeded id.
  6. `port.invalidate(touched)` bumps the version tokens and broadcasts.
  7. Return `BulkResult`.
- **Idempotency:** reuse `middleware/idempotentReplay.ts`. The client sends `Idempotency-Key`.
- **Rate limiting:** a bulk call costs one token in the tenant bucket. That is the fix for F6.
- **The port** is `application/collections/BulkEntityPort.ts`, and each domain implements its own under
  `application/<domain>/bulk/<entity>BulkPort.ts`:
  ```ts
  interface BulkEntityPort {
    entity: BulkEntityKey;
    capabilities: BulkAction[];
    permissions: Partial<Record<BulkAction, Permission>>;
    delete?(ctx, ids): Promise<BulkOutcome>;
    archive?(ctx, ids, archived: boolean): Promise<BulkOutcome>;   // archive + restore
    merge?(ctx, targetId, sourceIds, dryRun): Promise<BulkOutcome>;
    invalidate(ctx, touched: Touched): Promise<void>;
  }
  ```
- **One path per action.** Each port does its work set-based: `scopedToTenant(tbl, tenantId, inArray(tbl.id,
  ids))`, `bulkUpdateById` for per-row values, and `db.batch([...])` where several tables move together (Neon
  http has no interactive transaction). The existing single-record route for that entity is rewritten to call the
  same port with `[id]`. There must not be two delete implementations per entity.
- **Superadmin entities** (users, tenants, suspect accounts) use the same registry with `scope: 'admin'`. They
  are served at `POST /api/admin/collections/:entity/bulk` behind `superAdminMiddleware`. This is the only case
  where `tenantId` is a body field, and it matches the existing `backlogDispositionRoutes` pattern.

**Archive storage.**
- An entity that already represents archive keeps its column. Its port is the one adapter that translates it:
  `tasks.archived`, `projects.status`, `creation_sessions.status`+`archived_at`, `brain_chats.is_archived`,
  `specs.status`.
- An entity with no archive state gets `archived_at timestamptz NULL` plus a partial index on
  `(tenant_id) WHERE archived_at IS NULL`. This ships as **one expand migration** with no drops, so it is a single
  push under the expand/contract rule.
- A Collection list excludes archived rows by default.

## 4. Entity matrix

Legend: **D** delete · **A** archive/restore · **M** merge · — not offered (the action is hidden because the
entity does not support it).

The "Merge semantics" column says what moves to the kept record. Every merged-away source is archived (or
tombstoned with `merged_into_id` where the entity already uses that pattern), never hard-deleted, so a merge can
be revisited.

| Entity (bulk key) | Surfaces | D | A (storage) | M — merge semantics | Permission |
|---|---|---|---|---|---|
| `project` | /projects, /dashboard | hard (existing `deleteProject`) | `status` | tasks, specs, integrations, creation sessions, role assignments → target | `PROJECT_DELETE` / `PROJECT_WRITE` |
| `task` | /projects?tab=tasks, drawers | ✓ | `archived` | comments, links, subtasks, attachments → target; sources archived with a "merged into #N" note (reuse backlog-disposition `consolidate`) | `TASK_DELETE` / `TASK_WRITE` |
| `creationSession` | /create, /dashboard | soft (`status=deleted`) | `status` | existing graph merge, run sequentially **inside** the port | existing |
| `spec` (PRDs) | /prds, project drawer | ✓ | `status` | — | `SPEC_WRITE` |
| `workflow` | /workflows | ✓ | new `archived_at` | — | workflow write |
| `workflowDefinition` | workflow library | ✓ | new `archived_at` | — | workflow write |
| `team` | /workforce?tab=teams | ✓ | new `archived_at` | members and agent seats → target | team write |
| `role` (custom roles) | /workforce?tab=roles, roster | custom only (built-ins → `skipped: builtin`) | — | assignments → target role | MANAGER |
| `member` / `invitation` | /workforce | remove / revoke | — | existing consolidate in `WorkforceAgents` moves here | MANAGER |
| `contributor` | /workforce?tab=performance | — | — | existing `mergeContributors` (tombstone + revert), applied per source inside the port | existing |
| `brainChat` | chats | = archive (existing semantics) | `is_archived` | existing `consolidate` | existing |
| `chatSession` | /workforce?tab=chats | ✓ | new `archived_at` | — | — |
| `persona` (own) | /personas | ✓ | new `archived_at` | — | owner |
| `prompt` (own) | /prompts | ✓ | new `archived_at` | — | owner |
| `workspaceSkill` | /skills | ✓ | `status` | — | skill write |
| `integration` / `connection` | /settings/integrations | disconnect | — | — | integration write |
| `mcpServer` | /settings/integrations | ✓ | — | — | integration write |
| `apiKey` | /settings/api-keys | revoke | — | — | `APIKEY_WRITE` |
| `providerKey` | /settings (models) | ✓ | — | — | owner |
| `ceremonySchedule` | /projects?tab=ceremonies | ✓ | — | — | MANAGER |
| `meeting` | /workforce?tab=meetings | cancel | — | — | organizer |
| `alert` | /alerts | ✓ | new `archived_at` | — | — |
| `fact` | /facts | ✓ | — | — | — |
| `knowledgeDoc` | /knowledge | ✓ | new `archived_at` | — | — |
| `template` | /templates | custom only | — | — | MANAGER |
| `incident` | /incidents | ✓ | new `archived_at` | duplicates → target (timeline, war-room notes) | incident write |
| `rfp` | /projects?tab=rfp | ✓ | new `archived_at` | — | — |
| `errorGroup` | /quality | — | resolve-as-archive | events → target group | — |
| `recording` | /replay | ✓ | — | — | — |
| `humanRequest` | /workforce?tab=approvals | — | dismiss-as-archive | — | approver |
| admin `user` / `tenant` / `suspectAccount` | /admin | deactivate / — / revoke | — / `status` / — | — | superadmin |

Every other collection is **read-only**: marketplace sections, blog, models, startups, showcase, shoutouts,
public skills, the integrations catalog, LLM traces, audit and error logs, report and finance tables, metrics,
and leads. Those collections get Card | List, sort and paging, but no checkbox column.

### 4.4 Extra views

`<Collection extraViews={{ board, calendar, gantt }}>` adds those modes to the ViewToggle in canonical order, and
renders the supplied component in the body slot. The header, filters and archived toggle still apply. Selection
and the bulk bar apply in Board as well (the card checkbox). Tasks and Projects keep their current Board,
Calendar and Gantt this way, and `/projects?tab=tasks` gains **Card**.

## 5. Surface migration

This is the full inventory from the 2026-11-17 analysis. Paths are under `frontend/src`. Surfaces are grouped
into waves on disjoint files so implementers can work in parallel. A surface counts as migrated only when the
page holds a descriptor and filters and nothing else: its private grid, `<table>`, pager, selection state and
toggle state are deleted.

**W0 — contracts and primitives.** These land first, and nothing migrates before they do.
- Shared types in `interaction-contract`.
- `parsePageQuery`.
- `runBulkAction`, the port registry and `collectionBulkRoutes`.
- The archive `archived_at` expand migration.
- `components/collection/*` and `lib/collectionsApi.ts`.
- The `common.collection.*` i18n keys.
- Change `PAGE_SIZE_OPTIONS` to 50/100/250.

**W1 — the operator's examples and the existing bulk surfaces.**

| Surface | File(s) | Change |
|---|---|---|
| /projects | `ProjectsContent.tsx`, `ProjectTable.tsx`, `ProjectCard.tsx` | Descriptor. Card and List with Calendar and Gantt as extras. Bulk D/A/M. Delete `ProjectTable.tsx`. `ProjectCard.tsx` (430 lines) loses its outer chrome to `CollectionCards`. |
| /projects?tab=tasks | `TaskMgmtContent.tsx` (2,771 lines) | Gains Card. Board, Calendar and Gantt become extras. The bespoke selection and the per-id status/move loops are replaced by `useCollectionSelection` and bulk ports. Status change and move become two more bulk actions on the `task` port: `setStatus` and `move`. **Split the file** into `tasks/TasksCollection.tsx` (descriptor), `tasks/TaskBoardView.tsx`, `tasks/TaskCalendarView.tsx`, `tasks/TaskGanttView.tsx`, `tasks/TaskFilters.tsx`, `tasks/useTaskBoardData.ts`. That clears the god-module entry in ROADMAP › Code health. |
| /workforce?tab=roles | `workforce/RolesView.tsx`, `RoleAssigneePicker.tsx` | Stacked cards become a Collection. Card mode keeps the role card with its Assign button and chips. List mode columns: Role, Kind (Standard/Custom), Discipline, Assignees, Actions. The template select and discipline filter move into the header slot. Bulk D (custom only) and M. |
| /create, /dashboard library | `creation-sessions/CreationLibraryPanel.tsx`, `CreationSessionTile.tsx`, `SessionBulkBar.tsx`, `useCreationLibraryActions.ts`, `libraryViewPreference.ts` | Becomes a descriptor. `SessionBulkBar`, `libraryViewPreference` and the loop actions are deleted after the extraction. "Load more" becomes pages. |

**W2 — surfaces that already have ViewToggle (group A).**
- `WorkflowsContent`, `PRDsContent`
- `workforce/WorkforceAgents` (892 lines; split into members and invitations descriptors)
- `teams/TeamsView` (642 lines; split list from detail), `TeamPeopleView`
- `humanRequests/HumanRequestsView`, `contributors/ContributorsView`
- `ceremony/CeremonySchedulesPanel`
- `hiring/HiringClient` (Board is an extra view)
- `quality/QualityDashboard`
- `settings/ApiKeysContent`
- `ProviderKeysSettings` (1,332 lines; split per provider section)
- `connectors/ConnectorsGallery`, `mcp/McpServersGallery`, `integrations/IntegrationsGallery`,
  `MailboxIntegrations`
- `app/settings/integrations/page.tsx` (drops its own `viewMode` prop drilling)
- `app/skills/SkillsClient`, `app/agents/skills/SkillsBrowser`
- `app/personas/PersonasClient` (602 lines)
- `app/prompts/PromptsPageClient`
- `app/marketplace/MarketplacePageClient` (1,161 lines; one descriptor per section), `ModelsExplorer`,
  `components/startups/StartupDirectory`
- `app/blog/BlogPageClient`
- `app/agents/integrations/IntegrationGrid`, `app/agents/showcase/ShowcaseGrid`, `app/agents/shoutouts/ShoutoutsView`
- `app/admin/LlmTracesPanel`, `admin/panels/UsersPanel`, `admin/panels/TenantsPanel`

**W3 — list-only surfaces gain Card (group B).**
- `app/alerts/AlertsClient`, `app/facts/FactsPageClient` (uses the existing server paging)
- `app/knowledge/KnowledgeTraining`, `app/projects/rfp/[id]/RfpDetailClient` (sections)
- `app/evermind/page.tsx`
- `workforce/EmpMetricsView`, `task/AccountabilityTab`
- `manager/ManagerContent` (1,138 lines; split blocked-PR and stall registers into their own descriptors),
  `ManagerBlockedPrs`, `ManagerStallRegister`
- `pm/PmoRollup`, `pm/RoiDashboard`, `pm/EpicTreeView` (its table mode)
- `security/WorkspaceAuditLogPanel`
- `replay/RecordingsTable` + `RecordingsList` (merged into one descriptor), `replay/heatmap/ElementTable`,
  `replay/funnels/SmartEventsView`
- `agent-ops/MemoryPanel`, `CoordinationPanel`, `RehearsalPanel`
- `TenantApiKeyUsageRow`, `admin/TenantApiKeysAdminTab`
- finance: `CashflowView`, `RunwayView`, `EarningsReport`, `TaxReportPanel`, `BillingClient`
- sales: `SalesHubClient`, `SalesReportView`, `sell/ProspectDealView`
- governance: `TrackerSurface`, `Soc2AutomationPanel`, `VulnerabilityFindingsPanel`, `RunScanPanel`
- `builder/database/RecordsTable`, `ProjectBackendPanel`
- `kernel/EntityBrowser`

**W4 — card-only surfaces gain List (group C).**
- `studio/StudioCardList`, `StudioApps`, `StudioRecentProjects`
- `builder/BuilderProjectsContent`
- `app/knowledge/KnowledgeClient`
- marketplace sections: `BuiltinAgentsSection`, `CreationsSection`, `KnowledgeMarketSection`,
  `MarketplaceGigsSection` (662 lines), `TalentCard`, `SellerEarnings`
- `app/agents/page.tsx` hub
- `talent/ShortlistPanel`, `workforce/WorkforcePlanView`
- `rfp/RfpContent`
- `app/references/ReferencesClient`
- `app/tools/ToolsHubClient`
- `app/incidents/IncidentsPageClient` (1,207 lines; split list from war room)
- `learning/CourseCatalogue`, `PathDirectory`
- `templates/TemplateGallery`, `KanbanTemplatesContent`
- `video/VideoGrid`, `app/media/page.tsx`
- `app/challenges/page.tsx`
- `points/RewardsView`

**W5 — bespoke stacked lists (group D).**
- `kanban/KanbanRosterCard`
- `talent/TalentView` (jobs, proposals and engagements become three descriptors)
- `chats/ChatsView`
- `meetings/MeetingsContent` (`MeetingsCalendar` becomes its calendar extra view)
- `QaContent` (628 lines)
- agent host drawer: `AgentHostSessionsContent`, `AgentHostProjectsContent`, `AgentHostSkillsContent`,
  `AgentHostNodesContent`, `AgentHostChannelsContent`, `CronJobsContent`
- `AgentCapabilitiesContent`, `SkillAssignmentsContent`, `PersonaAssignmentsContent`, `GovernanceContent`
- `ActiveRunsPanel`, `ObservabilityContent` (1,026 lines), `FleetMeshContent`
- `settings/MyLlmsContent`
- `integrations/IntegrationCredentialsManager`, `BoardConnectionsManager`
- security: `SessionList` (its bulk revoke moves onto a `session` port), `PolicyPacksPanel`,
  `IdentityProvidersPanel`, `PasskeysPanel`, `LegalAgreementsPanel`
- sourcing: `SourcedJobsList`, `JobSourcesPanel`
- `reports/ReportSchedulesPanel`
- `inbox/InboxClient`
- `insights/SurveysManager`
- `disputes/DisputePanel`
- freelance: `JobAlertsPanel`, `MilestoneSchedulePanel`, `ProfileResumePanel`, `TalentProfileView`
- investor: `CompaniesView`, `InvestorsView`, `DataRoomView`, `ListingView`, `PackView`, `RoundView`
- `dashboard/DashboardIdeasTab`

**W6 — admin panels (group E).**
- `HealthPanel`, `SystemHealthSection`, `OutcomeMetricsPanel`
- `CronPanel`, `SecurityPanel`, `ImpersonationSessionsPanel`
- `SuspectAccountsPanel` (its bulk revoke moves onto the admin port)
- `CreationSessionsPanel`, `ModulesPanel`
- `UsagePanel` (716 lines), `LlmRatingsPanel`
- `PersonasPanel`, `GovernancePanel`, `LegalPanel`, `PrivacyPanel`
- `BillingPanel`, `NewsletterPanel`, `ReleaseNotesPanel`
- `visitors/LeadsView` (its sort moves onto the shared sort), `FlowView`, `InsightsOpsPanel`
- `SalesLeadsPanel`, `SalesCommissionsPanel`, `BroadcastsPanel`
- `ErrorsPanel`, `EmailDeliveriesPanel`, `AuditLogPanel` (server paging already exists; adopt the `Page<T>` shape)
- `app/admin/sales/page.tsx`

Every wave's endpoints accept `PageQuery` in the same wave as their surface.

**Per-id fan-outs replaced in the same pass** (F6):
- `ConnectorsGallery.tsx:131`
- `IntegrationsGallery.tsx:127-128`
- `ProviderKeysSettings.tsx:1140`
- `security/AccountSecurityPanel.tsx:60`
- `security/SecurityClient.tsx:91`
- `replay/prompt/PagePromptBundle.tsx:64`
- `replay/prompt/useRecordPromptCopy.ts:19`

Each becomes a bulk port action or a single batched read.

## 6. Retirements

Each item is deleted at the end of the wave that removes its last consumer, after a zero-reference grep.

| Delete | When |
|---|---|
| `components/dataTable/DataList.tsx`, `DataTable.tsx`, `usePageSize.ts` (+ tests, run unchanged against `Collection` first) | W1 |
| `creation-sessions/SessionBulkBar.tsx` (+ css), `libraryViewPreference.ts`, loops in `useCreationLibraryActions.ts` | W1 |
| `ProjectTable.tsx` | W1 |
| `useTableSort` / `SortableTh` in `admin/adminShared.tsx` | W6 |
| `CatalogToolbar.tsx` | W2 |
| `dataTableStyles.ts`, `.table-wrap` / `.data-table` / `.th-sort*` in `globals.css` | after W6 (insights lenses keep a local style module if still needed) |
| `sessionManagement.bulk*`, duplicate `observability.selectAll`/`security` select keys | when their surface migrates |
| `ViewToggle` card/table flag pair used outside `Collection` | after W6. `ViewToggle` stays, used by `Collection` and by the `options` mode-pickers in §2. |

## 7. Guards

- **`check:collection-surfaces`** (frontend, added to the fast edit set). It fails on `<table`, `dataTableStyles`,
  `className="data-table"`, `ViewToggle` without `options`, or `Pagination` outside `components/collection/`.
  It runs against a **shrink-only allowlist** seeded with the §5 files, so each wave removes its rows and the
  list must be empty after W6. The §2 exclusions are permanent entries, each with a reason.
- **`check:collection-endpoints`** (frontend): every `useServerSource` fetcher passes `page`.
- **`check:bulk-fanout`** (frontend): fails on `Promise.all(<ids>.map(` or `for … of ids … await` calls into
  `*Api.` (allowlist-shrink). This stops F6 from recurring.
- **Api:** a route test asserts every registered `BulkEntityPort` has a permission for each capability and an
  `invalidate`. `check:tenant-scope` already covers the `scopedToTenant` use.

## 8. Tests

- **Consolidation parity.** `DataList.test.tsx`, `DataTable.test.tsx`, `usePageSize.test.tsx`,
  `TaskMgmtContent.test.tsx` and the creation-library tests run **unchanged** against the new components before
  the originals are deleted. The one exception is the page-size option list (200 → 250), which is an operator
  decision.
- **Component tests:**
  - selection: page-scoped indeterminate state, survives a page change, cleared by a filter change, select-all
    capped at 1000
  - the bulk bar hides when `entity` is null
  - an action is disabled-with-reason without the permission
  - Delete confirms, Archive gives an Undo toast, Merge needs 2 or more items and a preview
  - sort cycles, and the card-mode sort select works
  - the footer stays pinned
  - the 360px layout does not overflow
- **Api:**
  - `parsePageQuery`: allowlist, a 400 on an unknown sort, page-size clamp
  - `runBulkAction`: an unknown entity, an unsupported action, a missing permission, a cross-tenant id returned
    as `skipped: not_found`, `BULK_MAX + 1` gives a 400, `merge` without `targetId`, `dryRun` writes nothing,
    idempotent replay
  - one test per port covering delete, archive/restore and merge with cache-version bumps
  - **`regression:` the bulk archive of 200 tasks issues ONE request** (the client test asserts one
    `apiRequest` call). This is the F6 429.
- **Performance.** A tasks list at 4,453 rows renders 50 rows, and the page payload is ≤ 250 rows. The list
  query is one SQL round trip (`count(*) over()`).

## 9. Done-checks

1. `check:collection-surfaces` allowlist holds only the §2 permanent exclusions.
2. `check:bulk-fanout` allowlist is empty.
3. Every entity in §4 with D/A/M has a registered port. `/projects?tab=tasks` shows Card. `/workforce?tab=roles`
   shows Card | List with sort, paging and bulk.
4. The §6 retirements are deleted, with zero references.
5. `TaskMgmtContent.tsx`, `WorkforceAgents.tsx`, `TeamsView.tsx`, `ProviderKeysSettings.tsx`,
   `MarketplacePageClient.tsx`, `ManagerContent.tsx`, `IncidentsPageClient.tsx` and `ObservabilityContent.tsx`
   are each split below ~400 lines per module.
6. i18n parity holds across the five catalogs. The design-token, design-scale and raw-storage guards are green.
7. `release_notes` has a row (category `new`: bulk Delete/Archive/Merge and paging everywhere), plus a blog post
   per the marketing rule.

## 10. Delivery (model roles per CLAUDE.md)

- **W0 runs as two parallel implementers on disjoint paths.**
  - Implementer 1 (api): contracts, paging, bulk framework and migration. An **Opus review** is required because
    it touches a storage migration, auth/tenant scope and cross-package types.
  - Implementer 2 (frontend): `components/collection/*`, the client and i18n. A Sonnet review covers it.
- **W1 to W6 run in parallel by wave** on disjoint file sets. Each wave lands its endpoints' `PageQuery` support
  and its bulk ports with its surfaces.
- **Per wave:** Sonnet implements, Haiku runs targeted verification (typecheck, the guards, the named test
  files), Sonnet reviews the diff (Opus for any wave that adds a migration), and fixes go back to Sonnet.

## 11. Decisions taken in this PRD (defaults; the operator may override)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| D1 | Select-all beyond the loaded page | "Select all {total}", fetching ids only, capped at 1000 per request | Keeps the "ids only" contract and bounds a single request |
| D2 | Where the tenant comes from | The authenticated JWT tenant, never the body (except superadmin admin routes) | A body tenant id would let a caller act on another tenant |
| D3 | Delete semantics | Each entity keeps its current single-delete semantics (hard vs soft), now set-based | No silent behaviour change |
| D4 | Merge result for sources | Archived or tombstoned, never hard-deleted | A merge can be revisited |
| D5 | List response shape | `Page<T>` when `page` is present, legacy shape otherwise | VS Code, MCP and agent callers stay unbroken |
| D6 | Archive storage | Existing columns kept and adapted by the port; new entities get `archived_at` | No 4-way data migration in this PRD; one adapter per entity |
| D7 | Page sizes | 50 / 100 / 250, default 50 | Operator request; replaces 200 |
