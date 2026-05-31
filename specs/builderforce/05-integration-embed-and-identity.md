# 05 — PRD: Integration, Embed-Back & Identity Federation

This is the **contract between the two apps**. It specifies how BurnRateOS authenticates into
BuilderForce, how Segments are provisioned, how BuilderForce surfaces re-embed into BurnRateOS,
the cross-domain API seams, and how the BurnRateOS PM/Agile pages become thin shells.

---

## 1. Topology

```
┌──────────────────────────────┐                         ┌──────────────────────────────┐
│           BurnRateOS          │                         │          BuilderForce.ai       │
│                              │                         │                                │
│  Identity Provider (OIDC)    │ ──(1) SSO: OIDC/JWT────► │  Tenant: "burnrateos"          │
│  Account / Company / User    │      tenant+acct+co      │  resolveSegment() → Segment    │
│                              │                         │                                │
│  Embed rail (embed.ts)       │ ──(2) embed snippet────► │  Embeddable surfaces           │
│   SystemFeature/AccountFeature│      view=ideas|kanban   │   (ideas, backlog, kanban,…)   │
│                              │                         │                                │
│  BI / CRM / Investor domains │ ◄─(3) cross-domain API─► │  /v1 PM+Agile+Agent API        │
│                              │                         │                                │
│  api.builderforce.ai (LLM)   │ ◄─(4) gateway (unchanged)│  callAiAndCharge (per Segment) │
└──────────────────────────────┘                         └──────────────────────────────┘
```

Four channels: **(1) identity**, **(2) embed UI**, **(3) data API**, **(4) LLM gateway**
(already exists, unchanged).

---

## 2. Identity federation (BurnRateOS = IdP)

### 2.1 SSO

- BurnRateOS exposes an OIDC issuer. BuilderForce trusts it for the `burnrateos` tenant
  (`Tenant.idpIssuer`).
- On embed load (or direct visit), BuilderForce receives a signed JWT with claims:

```jsonc
{
  "iss": "https://app.burnrateos.com",
  "sub": "<userId>",                 // BurnRateOS user id
  "tenant": "burnrateos",
  "accountId": "<accountId>",        // BurnRateOS account
  "companyId": "<companyId>",        // BurnRateOS current company
  "role": "OWNER|ADMIN|MEMBER|…",
  "persona": "CTO|CPO|…",
  "plan": "FREE|PRO|ENTERPRISE",
  "teamIds": ["…"],
  "displayName": "…", "email": "…", "avatarUrl": "…",
  "exp": 1234567890
}
```

- BuilderForce verifies signature + issuer + expiry, then `resolveSegment()`:
  `(tenant, accountId, companyId)` → `Segment` (lazy-create on first sight, `provisionedAt = now`).
- Claims hydrate `IdentityCache`; `role`/`persona`/`plan` gate features and seed the credit
  ledger tier for that Segment.

### 2.2 Tenancy enforcement (the no-bleed guarantee)

- `resolveSegment(jwt)` is the **only** entry to data. Every `/v1` handler and every agent action
  runs inside a `(tenantId, segmentId)` context object; repositories require it.
- A JWT for company A can never resolve to company B's Segment (the `Segment` unique key is
  `(tenantId, externalAccountId, externalCompanyId)`).
- Company switch in BurnRateOS → new `companyId` claim → different Segment. No caching across
  Segments in request scope.

### 2.3 Service-to-service auth

For channel (3) (cross-domain API, no end-user present, e.g. a CRM webhook), use a **tenant
service token** (client-credentials) that carries `tenant` + the target `accountId`/`companyId`
in the request so BuilderForce resolves the Segment server-side. Scope tokens to specific
endpoints (e.g. `ingest:feedback`).

---

## 3. Segment provisioning handshake

1. First authenticated request for an unknown `(accountId, companyId)` lazily creates a Segment
   (`status = ACTIVE`, `plan` from claim).
2. Optional eager provisioning: BurnRateOS can call
   `POST /v1/admin/segments { accountId, companyId, displayName, plan }` (tenant service token)
   when a company first enables the embed — pre-warms the Segment and seeds defaults (a default
   board, default card decks).
3. Plan changes in BurnRateOS propagate via `PUT /v1/admin/segments/:id { plan }` or the next
   JWT claim; BuilderForce updates feature gating + credit tier.
4. Company deletion / GDPR erasure in BurnRateOS → `DELETE /v1/admin/segments/:id` cascades
   delete of all Segment-scoped rows (honors the BurnRateOS DSR/erasure posture).

---

## 4. Cross-domain API seams (channel 3)

These replace the in-process coupling that existed when PM/Agile lived inside BurnRateOS. All are
async/eventual and never block a render path.

### 4.1 BI → cost-aware planning (runway/burn) — *BuilderForce pulls*

- BuilderForce calls BurnRateOS `GET /api/bi/burn-rate?companyId=…` (tenant service token, scope
  `read:bi.burn`) to get the Segment's current monthly burn + runway months.
- Used by AS-7 cost-per-point and AS-4 runway-aware sprint caps. Cached on
  `RunwayForecastLink.externalBurnRateMetricRef`. **Closes the "cost-aware agile" marketing gap
  that the BurnRateOS code never wired.**
- Graceful fallback to manual burn input if the scope isn't granted or BI is unavailable.

### 4.2 CRM feedback → backlog/validation — *BurnRateOS pushes*

- BurnRateOS Customer Engagement posts feedback events to BuilderForce
  `POST /v1/ingest/feedback { companyId, widgetId, eventId, text, sentiment, contact }`
  (service token, scope `ingest:feedback`).
- BuilderForce creates a `CustomerInsight(insightType=FEEDBACK)` candidate with `externalRef`
  and/or a backlog `WorkItem` candidate (per Segment setting). The founder triages from a
  "Voice of customer" inbox. **Implements the catalog's promised feedback→backlog flow that was
  only manually linkable before.**
- Validation Lab's `GET /v1/validation/engagements` proxies BurnRateOS to list the Segment's
  feedback widgets/cohorts for the engagement link (PM-4).

### 4.3 Build results → host metrics — *BuilderForce pushes (webhooks)*

- BuilderForce emits webhooks BurnRateOS can subscribe to (HMAC-signed, per tenant):
  - `workitem.released` → feeds Investor board decks / Changelog.
  - `sprint.completed` (velocity, financial impact) → feeds BI / health scoring.
  - `roadmap.published` → feeds Investor Intelligence roadmap slides.
- Lets BurnRateOS's Investor/BI domains read velocity/roadmap/release data they previously had no
  coupling to (a gap the inventory found).

### 4.4 Embedded read for cross-links

BurnRateOS pages that deep-link into PM/Agile (e.g. an MVP scenario referenced from a CFO view)
call BuilderForce `GET /v1/…` with the user JWT and render inline or link out to the embed.

---

## 5. Embed-back: BurnRateOS thin shells (channel 2)

### 5.1 Reuse the existing embed rail — do not build a parallel one

Per the unified-embed-snippet rule, BuilderForce embedding rides the **same rail** as the
heatmap/support/feedback widgets:

1. Add **one** embed feature key `embed_builderforce` to `EMBED_FEATURE_KEYS` in
   `routes/embed.ts`.
2. Migration: one `SystemFeature` row (`type = SUB_FEATURE`, `parentFeatureId = product_management`
   or a new `builderforce` parent), `requiredPlan` set, default `HIDDEN` until wired.
3. Extend `/api/embed/config` with the BuilderForce bootstrap (the BuilderForce embed base URL +
   the per-view route map).
4. Add a subsystem block to the snippet that mounts a BuilderForce surface where the page markup
   requests it.
5. Add the toggle card to `EmbedBurnRateOSPage.tsx`; reuse the existing consent modal +
   `PUT /api/embed/settings` flow (records `consentVersion`).
6. Default OFF; opt-in per (account, company) with the consent moment — same legal posture.

### 5.2 The thin-shell pages

Each BurnRateOS PM/Agile page becomes a shell that mounts the corresponding BuilderForce view,
passing the SSO JWT (so BuilderForce resolves the Segment):

```
/product/ideas           → <BuilderForceEmbed view="ideas" />
/product/mvp             → <BuilderForceEmbed view="mvp" />
/product/backlog         → <BuilderForceEmbed view="backlog" />
/product/validation      → <BuilderForceEmbed view="validation" />
/product/roadmap         → <BuilderForceEmbed view="roadmap" />
/product/feature-roi     → <BuilderForceEmbed view="feature-roi" />
/agile/kanban            → <BuilderForceEmbed view="kanban" />
/planning-poker          → <BuilderForceEmbed view="poker" />
/retrospectives          → <BuilderForceEmbed view="retros" />
/agile/sprint-planning   → <BuilderForceEmbed view="sprints" />
/velocity                → <BuilderForceEmbed view="velocity" />
/feature-scoring         → <BuilderForceEmbed view="feature-scoring" />
```

- The nav entries (`product_management`, `agile_survival` in the domain catalog + sidebar) stay
  unchanged — dogfooding + persona gating preserved.
- `<BuilderForceEmbed>` is a single shared component (DRY): it handles the iframe/web-component
  mount, JWT handoff, height/resize, deep-link sync (URL ↔ embed route), and a loading/erorr
  state. One component, parameterized by `view` — not N bespoke embeds.

### 5.3 Migration sequence for BurnRateOS

1. Ship `embed_builderforce` (HIDDEN) + the `<BuilderForceEmbed>` component.
2. Behind a feature flag, swap one page (e.g. `/agile/kanban`) to the shell; validate parity for
   one Segment.
3. Roll the rest; keep legacy pages importable until parity is confirmed.
4. **Then** delete the legacy `domains/productManagement` + `domains/agileSurvival` frontend code
   and the moved backend routes/models (per the "no legacy tables / clean replacement" rule).
   Verify zero references before deleting.

---

## 6. LLM gateway (channel 4) — unchanged

- BuilderForce keeps using `@seanhogg/builderforce-sdk` → `api.builderforce.ai` for all LLM
  dispatch, exactly as BurnRateOS does today: caller passes `useCase` + `viewer`; the gateway
  owns vendor failover; usage is projected to hide vendor/model from non-admins.
- The credit ledger, tier rates, and viewer projection live in BuilderForce, **scoped per
  Segment** (the `viewer` carries the Segment + role/plan from the JWT).
- New `dev.*` use cases (doc 01 §8) are added to BuilderForce's `AI_USE_CASES` registry.
- Note the naming collision to keep straight: **BuilderForce-the-gateway** (`api.builderforce.ai`,
  the LLM dispatch service) is distinct from **BuilderForce-the-product** (this PM/Agile/agent
  app). The product is a *client* of the gateway, just like BurnRateOS.

---

## 7. Security & compliance checklist

- [ ] JWT signature + issuer + expiry verified on every embed/API request.
- [ ] `resolveSegment()` is the sole data entry; no handler runs without `(tenantId, segmentId)`.
- [ ] Cross-Segment read is impossible (integration test: Segment A token cannot fetch Segment B
      rows for every `/v1` resource).
- [ ] Service tokens are per-tenant, per-scope, rotatable, and audited.
- [ ] Embed defaults OFF; opt-in records `consentVersion` via the existing consent modal.
- [ ] Webhooks HMAC-signed; replay-protected.
- [ ] Repo tokens vault-only; revoked on disconnect; agent file access confined to the Segment's
      repos.
- [ ] DSR/erasure: `DELETE /v1/admin/segments/:id` cascades; honors BurnRateOS DSR queue.
- [ ] Per-Segment credit ledger; per-run/orchestration budget caps; gateway daily breaker
      respected.

---

## 8. API surface summary (BuilderForce `/v1`)

| Group | Endpoints (see PRDs for full list) |
|-------|-------------------------------------|
| Identity/admin | `POST/PUT/DELETE /v1/admin/segments`, `resolveSegment` (internal) |
| Product Mgmt | `/v1/ideas*`, `/v1/mvp*`, `/v1/roadmap*`, `/v1/validation*`, `/v1/backlog*`, `/v1/business-value-config*`, `/v1/feature-roi*`, `/v1/ab-tests*` |
| Agile | `/v1/poker*`, `/v1/retros*`, `/v1/kanban*`, `/v1/sprints*`, `/v1/velocity*`, `/v1/feature-scoring*`, `/v1/capacity*`, `/v1/agile/*` (cost), `/v1/action-items*` |
| Agentic | `/v1/repos*`, `/v1/work-items/:id/agent-run`, `/v1/agent-runs*`, `/v1/orchestrations*`, `/v1/pull-requests/:ref/review`, `/v1/findings*` |
| Seams | `/v1/ingest/feedback`, `/v1/validation/engagements` (proxy), outbound webhooks |
| Realtime | poker/retro rooms + `agent-runs/:id` stream (WebSocket/SSE, Segment-authorized) |

All `/v1` require a Segment-scoped JWT (end-user) or a tenant service token (S2S); all are
Segment-isolated and rate-limited per Segment.
