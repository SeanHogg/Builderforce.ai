# PRD 16 — Insights Answer Engine (Vague → Informed)

**Status:** Proposed (2026-07-12) · **Owner:** Operator · **Migration:** `0338_insights_answer_engine.sql`
**Foundation already shipped (2026-07-12):** incidents-as-widgets (`incidentWidgets.tsx`), the reusable Ishikawa/5-Why `FishboneChart`, and the `quality.incidents` scalar metric. This PRD builds the remaining vision on top of that.

## 1. Problem & Vision

Every executive asks the same vague question in a hundred phrasings: **"Give me a summary of how things are looking."** Behind it sit the real questions a CTO/CIO actually needs answered on demand:

1. **Do we have a breach?** (open incidents, severity, MTTR)
2. **Are we behind on projects?** (at-risk delivery, velocity vs plan)
3. **What's the RCA summary — why did this occur?** (fishbone / 5-Why / causal graph)
4. **Who is overworked? Who is idle?** (allocation health)
5. How are we spending? · How fast do we ship? · Is quality holding? · How effective is our AI? · What changed this week? · What needs my attention?

Today Insights can *show* all of this if a human hand-assembles a dashboard, and the **Ask** box maps a question to **one scalar** ([`nlQuery.ts`](../../api/src/application/dashboards/nlQuery.ts) → [`metricRegistry.ts`](../../api/src/application/dashboards/metricRegistry.ts)). The gap is the **last mile from a number to an answer**: a vague question should return a **composed, visual, situational answer** — a narrative plus the *right* widgets from the app-wide registry — not a lone figure, and `/insights` should have an **out-of-box executive view** instead of starting empty.

**Vision:** the widget registry is already the atomic vocabulary of "things worth knowing." This PRD turns a question into a **selection over that vocabulary** — deterministic, safe (no SQL, no un-whitelisted surface), cached — rendered as an inline mini-dashboard, and reachable from both the Ask box and the Brain.

## 2. Reuse map (what we compose, not rebuild)

| Need | Existing primitive | Location |
|---|---|---|
| Question → whitelisted metric + window | `parseIntent` / `answerQuery` (deterministic keyword rules) | `api/.../dashboards/nlQuery.ts` |
| Safe metric vocabulary (compute paths) | `METRIC_REGISTRY` (+ `quality.incidents` shipped today) | `api/.../dashboards/metricRegistry.ts` |
| Answer vocabulary (renderable tiles) | app-wide `WidgetDef` registry — self-fetching, self-gating cards | `frontend/src/lib/widgets/registry.ts` |
| Render a widget by id anywhere | `WidgetCard` + `getWidget(id)` | `frontend/src/components/widgets/WidgetCard.tsx` |
| Deduped reads across many tiles | `useSharedSource` (single-flight + short TTL) | `frontend/src/lib/widgets/sharedSource.ts` |
| Read-through server cache | `getOrSetCached` + version-token bump | `infrastructure/cache/readThroughCache.ts` |
| Conversational answer channel | `WidgetBrainBridge` (`list_widgets`/`pin_widget`/`show_widget`) | `frontend/src/components/widgets/WidgetBrainBridge.tsx` |
| Seed rows per tenant + backfill | `provisionBuiltinAgents.ts` pattern (NOT-EXISTS guarded) | `api/.../agent/provisionBuiltinAgents.ts` |
| Shared dashboard storage | `saved_dashboards` + `dashboard_widgets` (metric OR widget key) | `schema.ts:6233` |
| Delivery "behind?" verdict | `deliveryVerdict.ts` (DORA + flow) | `frontend/src/lib/deliveryVerdict.ts` |
| Over/under-allocation signal | `emp.over-allocated` widget + allocation insights | `empMetricsWidgets.tsx`, `allocationInsights.ts` |
| Incident aggregate for RCA | `/api/monitoring/report` (total/open/bySeverity/bySystem/MTTR) | `monitoringApi.getReport` |
| Fishbone / 5-Why render | `FishboneChart` (shipped) | `frontend/src/components/charts/FishboneChart.tsx` |
| CTO persona for narrative steering | `builtin_kind='cto'` agent (shipped PRD 15) | `provisionBuiltinAgents.ts` |

**Net-new:** an **answer-template registry** (question intent → widget ids + headline metric + narrative), the `/api/dashboards/answer` composer, **intent keyword tags on `WidgetDef`**, a seeded **Executive dashboard**, a reusable **`DependencyGraph`** chart primitive, and **structured 5-Why capture** on incidents.

## 3. Data model — migration `0338_insights_answer_engine.sql`

Postgres/Neon, idempotent (`IF NOT EXISTS`). No new relational surface for the answer engine itself (it composes over the existing registries — the safety property). Two additive changes:

1. **`prod_incidents.rca_whys JSONB`** — the structured 5-Why ladder for an incident: `[{ ordinal:int, statement:string }]` (the chain the fishbone renders). Additive column, nullable.
2. **Executive dashboard backfill** — insert one `saved_dashboards` row (`name='Executive'`, `is_default=true`) + its `dashboard_widgets` per existing tenant, NOT-EXISTS guarded (mirrors the agent backfill). New tenants get it from `provisionExecutiveDashboard` (§6). Seeded widget keys: `inc.status`, `delivery.atRisk` (see §9), `quality.mttr`→`inc.mttr`, `finance.spend`, `emp.over-allocated`, `obs.quality-resolution`.

No answer/query-history table is added — the existing best-effort query log in `dashboardsRoutes.ts /query` is extended to record the composed answer's template id.

## 4. Answer-template registry — the core primitive

A **template** binds an intent to a renderable answer. Declared once, server-side, so both the Ask box and the Brain resolve identically and the surface can never widen beyond the whitelist.

```ts
// api/src/application/dashboards/answerTemplates.ts
interface AnswerTemplate {
  id: string;                     // 'breach' | 'behind' | 'overworked' | 'overview' | 'rca' | ...
  match: Rule;                    // reuse nlQuery Rule shape (all[]/any[] keyword AND/OR)
  headlineMetric?: string;        // METRIC_REGISTRY key → the one-line scalar
  widgets: string[];              // WidgetDef ids → the composed tiles (order = layout)
  narrative(ctx): string;         // localized, templated verdict sentence (no free-form LLM required)
  capability?: Capability;        // gate the whole answer
}
```

Seed set (the "top-10 questions"):

| id | Fires on | Headline metric | Widgets |
|---|---|---|---|
| `breach` | breach, incident, outage, down, sev1 | `quality.incidents` | `inc.status`, `inc.severity`, `inc.mttr` |
| `behind` | behind, on track, slipping, at risk, delivery | (delivery verdict) | `delivery.atRisk`, `deliv.velocityTrend` |
| `overworked` | overworked, overloaded, idle, capacity, who is | — | `emp.over-allocated`, `wfp.capacity` |
| `overview` | how are things, summary, looking, status, health | `quality.incidents` | the Executive set (§6) |
| `rca` | why did, root cause, rca, postmortem | `quality.mttr` | `inc.severity`, `inc.systems` (+ deep-link to the incident fishbone) |
| `spend` | spend, cost, budget, burn | `finance.spend` | `fin.spendTrend`, `fin.byProject` |
| `velocity` | how fast, velocity, throughput | `dora.deployFreq` | `deliv.velocityTrend`, `doraDeployFreq` |
| `quality` | quality, errors, bugs, failing | `quality.errorEvents` | `obs.quality-volume`, `obs.quality-resolution` |
| `ai` | ai impact, how effective, productivity | `aiImpact.productivity` | `aiProductivity`, `aiMergeRate` |
| `attention` | what needs, my attention, action | — | `inc.status`, `delivery.atRisk`, `pendingApprovals` |

Fallthrough = today's single-scalar `answerQuery` (never regresses). Adding a question = adding a row — no engine change.

## 5. Composer — `answerSituational(env, db, tenantId, question)`

Extends `answerQuery` (keeps it for the scalar fallback):

1. `parseDays(question)` for the window; evaluate templates in order (first match wins).
2. Resolve `headlineMetric` via `METRIC_REGISTRY` (already cached) for the narrative number.
3. Return a typed **`SituationalAnswer`**:
   ```ts
   { templateId, question, days,
     headline?: { label, value, unit, goodWhenUp },
     narrative: string,           // localized verdict, e.g. "1 open SEV2; MTTR 42m, within target."
     widgets: string[],           // registry ids the client renders via WidgetCard
     drill?: { href } }           // deep-link (e.g. the incident's fishbone)
   ```
4. **No widget data is fetched server-side** — the composer returns widget **ids**; the client renders `WidgetCard`s that self-fetch through `useSharedSource` (one request per source, cache-shared with the rest of `/insights`). The composer response itself is `getOrSetCached` under `answer:t:<tenantId>:<hash(question,days)>` (short TTL) — a re-ask is free.

## 6. Executive dashboard preset — `provisionExecutiveDashboard(db, tenantId)`

The out-of-box answer to "how are things looking." Idempotent seed of a shared `Executive` dashboard (`is_default`), NOT-EXISTS guarded, invoked from the same path that provisions builtin agents + on the migration backfill. `/insights` shows it by default when the user has no personal pins (the empty-state currently shown in `app/insights/page.tsx`). Managers can edit/clone it like any shared dashboard; it is not special-cased in the UI beyond being seeded.

## 7. Dependency graph primitive — `DependencyGraph`

New reusable chart (`frontend/src/components/charts/DependencyGraph.tsx`) — the one chart family not yet present (charts today: donut/bar/trend/gauge/radar/sparkline/fishbone). A directed node-edge graph (pure SVG, layered left→right, theme-driven, responsive, `role="img"` + text summary), generic like the others:

```ts
interface GraphNode { id:string; label:string; kind?:'system'|'service'|'incident'|'cause'; status?:'ok'|'degraded'|'down'; }
interface GraphEdge { from:string; to:string; label?:string; }
```

**RCA wiring:** on an incident, build the graph from `affectedSystem` + monitor topology (`/api/monitoring/report` `bySystem`) + linked incidents so a viewer traces a failure across services. Added to the incident detail beside the fishbone (fishbone = *why*; graph = *where/what propagated*). Also reusable by delivery ("blocked-by" task dependencies) later.

## 8. Structured 5-Why capture

Today `FishboneChart` renders from **flat** free-text RCA fields. Add a real ladder:

- **Capture:** in the RCA form (`IncidentsPageClient` `RcaSection`), a "5 Whys" laddered input (why₁ → why₂ → … → root), persisted to `prod_incidents.rca_whys` (§3) on publish.
- **Render:** the fishbone's first bone becomes the ordered why-chain (each *why* a twig in sequence); other bones keep the categorical contributing factors. When `rca_whys` is empty, behaviour is exactly today's (no regression).
- **Answer engine:** the `rca` template's drill deep-links to this chain.

## 9. Delivery "at-risk" widget — `delivery.atRisk`

The `behind`/`overview`/`attention` templates need a delivery-health tile. `deliveryVerdict.ts` already computes the verdict but there is no **widget** wrapping it. Add `delivery.atRisk` to `deliveryWidgets.tsx` (donut/stat of on-track vs at-risk vs off-track projects, drill `/insights/delivery`) — a thin wrapper over the existing verdict, no new endpoint.

## 10. Frontend wiring

- **Ask box** (`app/insights/page.tsx`): when the answer is a `SituationalAnswer`, render the headline + localized narrative + the returned widgets via `WidgetCard` in a responsive `auto-fill minmax(240px,1fr)` grid, plus a "Pin these" affordance (reuses `usePins`). Scalar answers render as today.
- **Brain**: extend `WidgetBrainBridge` with `answer_situation(question)` returning `{narrative, widgets[]}` so the assistant answers "how are things looking?" with the same composed set it would show in the Ask box (then can `pin_widget` any of them). One resolver, two surfaces — no divergence.
- **API client**: `dashboardsApi.answer(question)` alongside the existing `query`.
- **Localization:** new `insights.answer.*` + `charts.dependencyGraph.*` + `incidents.rca.why*` keys in **all five** catalogs (`en/zh/es/fr/de`). Narratives are templated from localized fragments — never server-side English. Theme tokens only; verified at 360px.

## 11. API surface — `/api/dashboards`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/answer` | member | `answerSituational` → composed `SituationalAnswer` (cached) |
| POST | `/query` | member | unchanged scalar answer (fallback / back-comat) |

Writes that change dashboards/incidents bump the relevant cache version; `/answer` reads through `getOrSetCached`.

## 12. Non-goals / follow-ups (log to Gap Register on build)

- **LLM-refined intent** is optional and always **constrained to registry ids** — the deterministic template matcher must fully function with no model wired (mirrors `nlQuery`'s standing rule). A gateway LLM may later re-rank templates but can never widen the surface.
- Cross-incident **RCA rollup** (patterns across many post-mortems) is out of scope; this PRD answers per-incident + aggregate counts.
- The dependency graph is **read-only** (no drag/edit); auto-layout is layered, not force-directed.
- Free-form "build me a chart of X" (arbitrary new visualizations) stays out — answers are compositions of **pre-declared** widgets, which is the safety guarantee.

## 13. Acceptance

Ask "how are things looking?" → an Executive composed answer (breach status · at-risk delivery · MTTR · spend · over-allocation) renders inline with a localized narrative headline; "do we have a breach?" → incident tiles + count; "why did this occur?" on a resolved incident → the 5-Why fishbone renders the stored `rca_whys` chain and a dependency graph shows affected systems; a new tenant boots with a seeded **Executive** dashboard on `/insights`; the Brain answers the same questions with the same widget set and can pin them. Typecheck green (api + frontend), all 5 i18n catalogs populated, both themes + 360px verified, versions bumped.
