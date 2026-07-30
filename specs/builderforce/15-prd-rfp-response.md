# PRD 15 — RFP / RFQ Response (Pre-Sales Proposal Generation)

**Status:** In build (2026-07-12) · **Owner:** Operator · **Migration:** `0335_rfp_response.sql`

## 1. Problem & Vision

Businesses in a pre-sales cycle must respond to an RFQ/RFP. A strong response:

1. **Co-brands** — incorporates the *requesting* organisation's themes/colours **and** the responder tenant's own logo/colours (blended, not one-or-the-other).
2. Is authored with help from a **CTO** and a **Product Owner** persona.
3. Is grounded either in a **new** build (greenfield — no existing product to lean on) or is **"similar to an existing project"**, in which case the tenant's **portfolio** (every project in the tenant) is the search space for the closest match.
4. Includes a **P&L**: build-out cost, a **% profit margin**, **agentic costs**, and **marketing** — rolled into a quoted price.
5. Ships a **project plan** — phases + milestones (Gantt), key **dependencies**, **risks**, and a **delivery timeline**.
6. When grounded on an existing project, the capability claims must be **grounded in real facts** via a capability **roster + visualisation**. **Freshness rule:** if the project's last diagnostics scan is **older than 5 days**, a full **code scan + feature mapping** runs **first**, before the response is produced.

There is no RFP subsystem today; this PRD introduces one that **orchestrates existing primitives** rather than reinventing them.

## 2. Reuse map (what we compose, not rebuild)

| Need | Existing primitive | Location |
|---|---|---|
| Grounding scan + freshness timestamp | `ToolService.getProjectScore()` → `diagnostics[].createdAt` (backed by `tool_runs.created_at`) | `api/src/application/tools/ToolService.ts` |
| Re-trigger a stale scan | `AuditRunner.runAudit()` (deterministic, synchronous repo file scan) + `POST /api/repo-analysis/.../architect` (deep LLM) | `AuditRunner.ts`, `repoAnalysisRoutes.ts` |
| Capability roster facts | `repo_analysis_artifacts.data_json` → `business` `{valueProps,capabilities}` + `diagnostic` `{keyComponents,frameworks,primaryLanguages}` | `ArchitectAnalysisService.ts` |
| Portfolio search space | `loadPmoTree()` / project rows within tenant | `api/src/application/pmo/portfolioRollup.ts` |
| Agentic $ cost | `computeCostMillicents()` + `llm_usage_log.costUsdMillicents` rolled up by `projectId` | `api/src/application/llm/usageLedger.ts` |
| Human build cost | member `costRateUsdCents` × effort | `schema.ts` members |
| Server-side structured LLM analysis | `ideProxy(env).complete({response_format: json_schema})` + `readProxyChoice` + `recordProxyUsage` | `LlmProxyService.ts`, template `businessValueAI.ts` |
| Persona-steered generation | persona directive param (as in `businessValueAI`) using the agent's `bio`/`skills` | `provisionBuiltinAgents.ts` |
| Self-contained branded doc | HTML-string export (inline CSS, print-to-PDF) | `api/src/application/export/tabularExport.ts` |
| Read-through cache | `getOrSetCached` + version-token bump | `infrastructure/cache/readThroughCache.ts` |

**Net-new (no primitive exists):** RFP data model, **brand-palette storage** (there is no per-tenant/per-org colour store), **CTO + Product Owner** builtin agents (only `product_manager/designer/validator/security/incident_manager` exist), the **P&L composer**, the **phases/milestones/risks/dependencies** RFP plan (the Planning Spine has no phase/milestone/risk tables — those are RFP-owned JSON), and the branded-doc renderer.

## 3. Data model — migration `0335_rfp_response.sql`

Postgres/Neon, idempotent (`IF NOT EXISTS`). Two tables + one agent backfill.

### `rfp_requests` — the incoming ask
```
id UUID PK, tenant_id INT→tenants (cascade), segment_id UUID,
title VARCHAR(255), requester_org_name VARCHAR(255),
requester_brand JSONB,           -- BrandPalette of the ASKING business
requirements TEXT,               -- pasted RFP/RFQ text
source_mode VARCHAR(16) DEFAULT 'new',   -- 'new' | 'existing_project'
based_on_project_id INT→projects (set null),
due_date TIMESTAMPTZ,
status VARCHAR(24) DEFAULT 'draft',  -- draft | analyzing | ready | submitted
created_by VARCHAR(36)→users, created_at, updated_at
```

### `rfp_responses` — the generated proposal
```
id UUID PK, tenant_id INT→tenants (cascade), segment_id UUID,
request_id UUID→rfp_requests (cascade),
project_id INT→projects (set null),        -- grounding project (existing mode)
status VARCHAR(24) DEFAULT 'draft',
body JSONB,                    -- RfpResponseBody (typed, below)
doc_html TEXT,                 -- rendered self-contained branded document
quoted_price_usd_cents INT,    -- queryable headline number
margin_pct REAL,
scan_refreshed BOOLEAN DEFAULT false,   -- did the freshness gate run a scan
generated_by JSONB,            -- {cto, productOwner} agent refs used
created_by VARCHAR(36)→users, created_at, updated_at
```

### `RfpResponseBody` (TS shape stored in `rfp_responses.body`)
```ts
{
  executiveSummary: string;
  grounding: { mode:'new'|'existing'; projectId?:number; projectName?:string;
    scanFreshness?: { toolId:string; lastScanAt:string|null; ageDays:number|null; refreshed:boolean } };
  capabilityRoster: { capabilities:string[]; keyComponents:{name:string;responsibility:string}[];
    frameworks:string[]; primaryLanguages:string[]; valueProps:string[]; source:'diagnostics'|'audit'|'greenfield' };
  costModel: RfpCostModel;                    // §5
  plan: { phases: { name:string; startDate:string; endDate:string;
    milestones:{name:string;date:string}[] }[] };
  risks: { title:string; severity:'low'|'medium'|'high'; mitigation:string }[];
  dependencies: { title:string; type:'internal'|'external'|'third_party'; note:string }[];
  timeline: { startDate:string; endDate:string; weeks:number };
  branding: { requester:BrandPalette; tenant:BrandPalette; blended:BrandPalette };
  portfolioMatches?: { projectId:number; name:string; score:number; rationale:string }[];
}
```
`BrandPalette = { primary:string; secondary:string; accent:string; text:string; background:string; logoUrl?:string }`.

### Agent backfill (mirror `0293_gig_marketplace.sql`)
`INSERT ... ide_agents (... builtin_kind='cto')` and `('product_owner')` per existing tenant, NOT-EXISTS guarded. New tenants get them via `provisionBuiltinAgents.ts` (§6).

## 4. Orchestration — `generateRfpResponse(env, db, {tenantId, requestId, userId})`

1. **Load** `rfp_requests` row. Resolve tenant brand palette (from tenant settings / default tokens) and requester brand (from `requester_brand`).
2. **Grounding + freshness gate** (existing mode only): `getProjectScore(env, tenantId, projectId)`; compute `ageDays` from newest `diagnostics[].createdAt`. If **missing or > 5 days**: run `AuditRunner.runAudit()` for the capability audits **synchronously** (real repo file scan → refreshes `tool_runs`, real signals) and set `scan_refreshed=true`; if the deep `architecture-analysis` artifact is also stale, fire the architect DO **async** (best-available now, deep refresh in background — logged as a known nuance). Read the roster from `repo_analysis_artifacts` (`business`+`diagnostic`); fall back to audit signals. Greenfield mode → `source:'greenfield'`, roster derived from requirements only.
3. **Portfolio match** (new mode, or always as suggestions): rank tenant projects against `requirements` (LLM structured rank via `ideProxy`, keyword fallback) → `portfolioMatches`.
4. **P&L** — `computeRfpCostModel()` (§5).
5. **Plan / risks / dependencies / exec summary** — one `ideProxy(env).complete({response_format: json_schema})` call **steered by the CTO + Product Owner personas** (their `bio`/`skills` composed into the system directive); `recordProxyUsage` after. Deterministic fallback if the model declines.
6. **Branding** — `blendPalettes(requester, tenant)` → `blended`; `renderRfpDocHtml(body)` → self-contained HTML.
7. **Persist** `rfp_responses` (body + doc_html + headline columns), bump cache version, return.

## 5. P&L — `computeRfpCostModel()` (pure, testable)

```
buildCostUsd        = effortWeeks × blendedWeeklyRate         (human build-out)
agenticCostUsd      = forward estimate via computeCostMillicents(pricing, projectedTokens)
                      grounded on the project's historical llm_usage_log $/similar-scope
marketingCostUsd    = marketingPct × (buildCost + agenticCost)
contingencyUsd      = contingencyPct × subtotal
subtotalCostUsd     = build + agentic + marketing + contingency
marginUsd           = subtotalCostUsd × marginPct/(1-marginPct)   (margin on cost)
quotedPriceUsd      = subtotalCostUsd + marginUsd
lineItems[]         = itemised {label, category, amountUsd}
```
All money stored/derived in cents; `marginPct`, `marketingPct`, `contingencyPct` are inputs with sane defaults (0.25 / 0.12 / 0.10) overridable per request.

## 6. Agents — CTO + Product Owner

Add two seeds to `BUILTIN_AGENTS` in `provisionBuiltinAgents.ts` (`builtin_kind` `cto`, `product_owner`) with bios/skills that make them credible RFP authors (CTO = architecture/feasibility/risk/effort; PO = scope/value/roadmap/positioning). Generalise validator's `findTenantValidatorRef` into `findBuiltinAgentRef(db, tenantId, kind)` (DRY — shared lookup). Their bios steer the §4.5 generation directive. Surface in `BuiltinKindBadge.tsx` + `types.ts` kind enum.

## 7. API — `/api/rfp` (`createRfpRoutes`, registered in `index.ts`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | VIEWER | list requests + response summaries (cached, version token) |
| POST | `/requests` | DEVELOPER | create an RFP request |
| GET | `/requests/:id` | VIEWER | request detail |
| PATCH | `/requests/:id` | DEVELOPER | edit request (brand, requirements, params) |
| POST | `/requests/:id/generate` | DEVELOPER | run `generateRfpResponse` |
| GET | `/responses/:id` | VIEWER | response detail (body) |
| GET | `/responses/:id/document` | VIEWER | branded self-contained HTML doc (print-to-PDF) |
| POST | `/portfolio-match` | VIEWER | rank similar projects for a requirements blob |

Writes bump the `rfp:t:<tenantId>` cache version. All reads through `getOrSetCached`.

## 8. Frontend — `/rfp`

- `/rfp` — list of RFP requests + "New response" create (org name, requester brand colours, requirements, new-vs-existing + project picker, P&L knobs). Thin `page.tsx` (`runtime='edge'`) → `RfpPageClient`.
- `/rfp/[id]` — response workspace: **executive summary**, **capability roster** visualisation (components/frameworks/value-props, with a freshness badge + "scan re-run" note), **P&L** breakdown (line-items + margin + quoted price, charted per `dataviz`), **phase/milestone Gantt**, **risks** & **dependencies**, and a **branded document preview** with download. `RoleGate capability="rfp.manage"` on all mutating UI.
- Nav: add `/rfp` tab under an existing group in `navGroups.ts` (`nav.tab.rfp`).
- API client: `rfpApi` in `builderforceApi.ts`.
- **Localisation:** new `rfpPage` namespace + `nav.tab.rfp` in **all five** catalogs (`en/zh/es/fr/de`). Theme tokens only; mobile-friendly.

## 9. Non-goals / follow-ups (logged to Gap Register)

- Deep `architecture-analysis` refresh is **async** — a >5-day-stale deep artifact is re-run in the background while the response uses audit signals + last-known artifacts; the response marks the deep roster "refreshing". A future pass can block on DO completion.
- Native PDF is out of scope — we emit self-contained HTML (browser print-to-PDF), matching the existing export mechanism.
- First-class RFP **risk register** table (vs JSON in `body.risks`) deferred; JSON is sufficient for v1.
- Requester brand-colour **auto-extraction** from a logo/URL is manual entry in v1.

## 10. Acceptance

Create a request (existing-project mode, stale scan) → generate → observe: a fresh scan ran (`scan_refreshed=true`), roster reflects real components, P&L shows build+agentic+marketing+margin+quoted price, a phase/milestone Gantt + risks + dependencies render, and the branded doc blends requester + tenant palettes and downloads. Typecheck green (api + frontend), all 5 i18n catalogs populated, both themes + 360px verified, versions bumped, VSIX packaged.
