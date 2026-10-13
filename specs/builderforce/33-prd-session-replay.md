# PRD 33 — Insights: session replay, heatmaps, live visitors and prescriptive fixes

> **Status:** consolidated 2026-10-12. This file merges the former PRD 33 and its hand-off 33a, which is deleted. Where the two disagreed, the later amendments (D15 scale, D16 one screen, D17 customer #1) were folded in, and the superseded text was removed rather than left beside its replacement.
> **Owner:** the planning session, which also audits each slice (§10).
> **Mockup:** https://claude.ai/artifact/ThFJoMFxQ8hguwVJWV82Ea (layout only; this PRD wins on any conflict).
> **Arc:** Measure. It turns a live app (Run) into evidence about what to change (Measure → back to Make and Idea).
> **Correction on record:** DONE.md's 2026-10-11 "full S0–S8 launch" entry overstated the build. On 2026-10-12 an audit found S1, S3–S7 almost entirely unbuilt, the commerce modules unwired, and release note 1211 advertising a feature that did not run. §0.1 is the true status, kept current per slice.

## 0. The problem, stated against the code

Builderforce cannot see what a visitor does on a page. `lib/visitorJourney.ts` → `POST /api/visitor/events` → `activity_log` records that a visitor arrived, which pages they opened, what they typed into the composer, errors and sign-up. Nothing records where they clicked, what they clicked that did nothing, what they rage-clicked, how far they scrolled, or what the page looked like when they gave up, and nothing ties behaviour to a release. Customers who publish an app from a canvas get page views only (`site_traffic_daily`).

### 0.1 Build status (kept current; updated by the planning session after each slice audit)

| Slice | Status 2026-10-12 | What exists | What remains |
|---|---|---|---|
| S0 Consolidation | Partial | `StatTile`; `UserDetailDrawer` on `SlideOutPanel`; `TenantApiKeyUsageRow`; `FlowView`, `LeadsView`, `RecordingPanel` (journey, lead), `VisitorJourneyTimeline`, `VisitorLeadDetail`; erase wired; `heatZones.ts`; `packages/interaction-contract` (diverged shapes) | contract realignment (§3.4); `InsightsHome` + bands; `InsightsPanel` + `INSIGHT_PANEL_KINDS`; `?panel=` addressing; `LEGACY_ADMIN_SUB`; dead `VisitorJourneyDrawer.tsx`; tests |
| S1 Data plane | Not built | pure folds in `domain/replay/*` (unused); core `replay_visits` (wrong track, nullable tenant); superadmin `GET /api/admin/replay-visits` (violates D17) | everything in §3.2–3.3 and §8 S1 |
| S2 Recorder + CDN | Partial | `replay-sdk` (builds; size test); `emit-assets.mjs`; `cdn-ensure.sh`, `cdn-publish.sh`, `infra/cdn/*` | public API `BFReplay`, loader contract (config fetch, DNT/GPC, consent, sampling, stub queue), buffer mode + keep triggers, gzip, block/mask selectors, canvas, release key, error fingerprint, `vital` marks at pagehide, `bfr_` id namespace, `publish-cdn` job + npm matrix in `release.yml` |
| S3 Dogfood + player | Not built | — | all |
| S4 Heatmaps + S4b MP4 | Not built | — | all |
| S4c Analysis parity | Not built | filter / smart-event / frustration primitives in the contract | all services, routes and views |
| S4d Method link | Not built | `useFounderJourney` (idea/run only) | all |
| S4e Prescriptions | Not built | — | all |
| S4f Page review | Not built | — | all |
| S5 Live + Flow links | Not built | `VisitorFlowGraph.onSelectNode` prop (unused) | all |
| S6 Commerce + buyer path | Partial, unwired | `commerce/replayCatalog.ts`, `replayWallet.ts`, `replayPacks.ts` (no caller); `metering/replayUsage.ts` (hard-coded 50/month, contradicts D4); sitemap lists listings | capability kind, catalog row, entitlement, settler registration, routes, keys, sites, set-up, landing, `/apps/[slug]`, `resumeIntent`; retire the 50/month meter |
| S7 Buyer surfaces | Partial | canvas `sessions` surface registered (phases, i18n) rendering `CanvasSessionsSurface` from the superadmin route | hosted injection; `CanvasInsightsSurface` with three entitlement states; dock side |
| S8 Ship | Content only | release note 1211, blog ×5 | release note corrected to what ships; runbook (operator) |

## 1. Outcome

**The point is to tell people how to improve their website, render the improvement, hand it to an AI as a prompt, and measure the result.** Fixes lead the home of the Insights app for every site, Builderforce's own included (D17). Recordings, heatmaps, funnels, flow, live and overview are evidence, reached from a fix or browsed beside it.

1. **Every workspace, through the Marketplace.** A workspace installs **Insights** (listing slug `session-replay`) for free, gets 5,000 kept recordings a month, and buys prepaid packs above that. On an external site it pastes one loader tag once; recorder updates and releases are detected automatically. A Builderforce-hosted app needs only a switch. It reviews everything at `/apps/insights` and in the canvas under Measure ▸ Visitors.
2. **Builderforce is customer #1 (D17).** The Builderforce workspace installs Insights like anyone else and builderforce.ai carries the same public snippet. Superadmins see Builderforce's recordings as members of that workspace. Admin gets only an aggregated Insights operations view.
3. **At least Clarity's web analysis** (D11, §2.1): Overview dashboard, one filter bar with saved segments, frustration signals, funnels over pages/clicks/smart events, AI summaries of one recording or a segment, and Brain answers over the same numbers.
4. **The method runs on it** (D12, §5.3). Proofs are graded by what visitors did; each grade carries its evidence; "Read again with what we learned" closes the loop; tickets raised from a replay moment are measured on the release that ships the fix; the journey learns Make and Measure; builderforce.ai sees where people drop out of the method.
5. **Prescriptive AI** (D13, §5.1): ranked fixes, each with a deterministic finding, a prescription, an impact range from the site's own data, one action (Fix it / Test it / Follow up / Ticket), and a measured verdict on the next release.
6. **The page review** (D14, §5.2): screen + metrics + SEO + content per key page per release → a rendered before/after → an improvement prompt for the ONE composer, a coding agent or any AI tool → measured.
7. **Privacy by default:** inputs masked in the browser; password and card fields never captured; DNT and GPC honoured; builderforce.ai records only after analytics consent; deleting a visitor deletes their recordings; recordings expire.

## 2. Decisions

Each decision is settled. An implementing agent never changes one; if one proves wrong it stops and reports to the planning session.

| # | Decision |
|---|---|
| D1 | **Recorder engine: rrweb**, pinned exactly (`2.1.7` today). |
| D2 | **Storage tiers are §3.2** (D18 replaces the original D2 and the D15 tier list). Recording bytes live in R2 (`UPLOADS`) as gzip NDJSON chunks under `replay/`. Telemetry tables live in the **transactional** database (`buildTransactionalDatabase`); definitions people edit live in core. |
| D3 | **Retention:** 30 days per recording by default; a site setting may raise it to 90 (`settings.retentionDays`). Daily rollups keep 13 months. |
| D4 | **Pricing:** billable unit = one **kept** recording, up to 2 MiB compressed; each further 2 MiB counts again (`max(1, ceil(bytes / 2 MiB))`). 5,000 free a month per installed workspace. Above that, prepaid packs (credits last 12 months): 10k **$40** · 50k **$140** · 150k **$240** · 500k **$650** · 1M **$1,200** — data in the catalog item's `body.packs`. Events of unkept sessions are never billed. Auto-recharge is an emailed top-up link (the provider has no off-session charge). |
| D5 | **CDN:** `https://cdn.builderforce.ai`, public R2 bucket `builderforce-cdn` with a no-Worker route. `/replay/v1/loader.js` (max-age 300), `/replay/r/recorder.<hash>.js` (immutable), `/replay/manifest.json` (max-age 60), `/embed/v1.js` (max-age 300). Config and ingest stay on `https://api.builderforce.ai/api/replay-ingest/v1/*`. |
| D6 | **Liveness:** polling about every 5 s; no WebSockets in v1. |
| D7 | **Consent:** builderforce.ai records only after `CookieConsentManager` reports analytics consent. Buyer sites: setting "Wait for consent" (default off) plus `BFReplay.consent(true)`. |
| D8 | **Real-payment validation** by a dedicated non-superadmin workspace with `replayFreeAllowanceOverride = 0` (runbook §11). |
| D9 | **Signed-in recording on builderforce.ai** is gated by the platform setting `replay.recordSignedIn` (default `false` until the legal disclosure is published) and the per-workspace `tenants.settings.replayExcluded`. Sensitive regions carry `data-bf-block` / `data-bf-mask`. |
| D10 | **Replay is a DOM reconstruction played like a video**, never OS screen capture. Canvas/WebGL content is captured as frames when the site enables `recordCanvas` (2 fps, JPEG 0.4; on for builderforce.ai). MP4 export renders the replay headlessly in the QA runner and costs 10 units. |
| D11 | **Competitive bar:** every Clarity web analysis feature in §2.1 ships for every site. |
| D12 | **Method link:** replay is the Measure instrument; proof sites are recorded with no install and count toward the free allowance. |
| D13 | **Findings are deterministic** (`PRESCRIPTION_RULES`); AI only phrases cited findings and drafts changes; uncited sentences are dropped; nothing reaches production on its own. A finding observed by vision is shown only when it names an element in the capture's rect map AND cites a measured page fact; it is labelled "observed". |
| D14 | **Page review per release** for key pages (§5.2). |
| D15 | **Scale principles:** count every session, keep only recordings that matter, group into issues, never browse raw sessions; Postgres rows grow with routes, issues, releases and kept recordings only; every number says whether it is exact or estimated (≈). |
| D16 | **One screen, one panel:** ONE home (`InsightsHome`) that fits the viewport plus ONE stacked `SlideOutPanel` (`InsightsPanel`) whose levels are registered **panel kinds** (§4.1). No view switcher, no second overlay. |
| D17 | **Customer #1:** scope is `{ tenantId, siteId }`, nothing else. No platform scope, no `tenant_id NULL` site, no superadmin data path, no unmetered back door. The Builderforce workspace holds an audited credit grant (`ledger_entries`, reference `replay-grant:<audit id>`). Admin sees aggregates only (`/api/admin/replay-ops/*`). |
| D18 | **Storage works with zero extra provisioning** (decided 2026-10-12, replaces the Analytics Engine + Pipelines/R2 SQL tiers of the earlier D15 text). A Pipelines binding fails the deploy when its pipeline does not exist, and Analytics Engine reads need an API token the platform does not hold; a design that cannot run is not shipped. Instead: (1) **additive daily rollups** in transactional Postgres, written by per-isolate buffers at ingest (`INSERT … ON CONFLICT DO UPDATE SET n = n + EXCLUDED.n`), keyed by route × day × release × device — bounded by routes, never by sessions; (2) **one compact row per kept recording** with the arrays filters and funnels need; (3) R2 chunks + `marks.json` per kept recording. Funnels, flow, segments and AI digests run over kept recordings weighted by `sample_weight` and are shown as ≈; route counts, frustration counts, heat cells and vitals are exact over every session. An event lake is a later scale-up, recorded on the ROADMAP; it is not a dependency of anything in this PRD. |

### 2.1 Competitive matrix (Clarity web feature → ours)

| Capability | Ours | Slice |
|---|---|---|
| Recordings with masking | Inputs always masked; `data-bf-mask` / `data-bf-block` | S2, S3 |
| Click / scroll / area heatmaps | Per release; Areas mode boxes the top elements | S4, S4c |
| Rage, dead clicks, quick backs, excessive scrolling, JS errors | Detected in the browser, folded into issues | S2, S1 |
| Dashboard | the `metric` panel kind and the home tiles | S4c |
| Filters + saved segments | ONE `ReplayFilter`, ONE compiler, every band and panel | S4c |
| Custom tags / identifier | `BFReplay.tag(key, value)`; `BFReplay.identify(id, traits)` when the site allows it | S2 |
| Smart events (auto + custom, retroactive) | `BUILTIN_SMART_EVENTS`, `BFReplay.event(name)`, point-and-click rules | S4c |
| Funnels | with "watch who dropped at step N" | S4c |
| AI summary of one recording / a segment | cited, deep-linked | S4c |
| Chat with your data | Brain `replay.*` tools | S4c |
| Share a recording link | `?panel=recording:<id>&t=<s>` | S3 |
| Data export API | documented read API with `replay:read` keys | S4c |
| Mobile SDKs, GA/Ads integrations | **No** (non-goals) | — |
| **beyond:** release compare, live view + follow, canvas frames, MP4 export, replay → ticket → measured fix, prescriptions, page review | Yes | S1, S4, S4b, S5, S4d–S4f |

## 3. Architecture

```
Browser (any site)
  <script async src=https://cdn.builderforce.ai/replay/v1/loader.js data-site=bfr_… | hosted:<siteId> [data-release]>
    loader (≤2 KB gz): DNT/GPC → GET /api/replay-ingest/v1/config → sample/consent → inject recorder
    recorder.<hash>.js: ids · release key · marks · rrweb ring buffer (60 s) · keep triggers
      └─ POST /api/replay-ingest/v1/chunks (gzip, every 5 s visible + pagehide keepalive)
API Worker
  ReplayIngestService ─┬─ rollup buffers  → replay_route_daily, replay_breakdown_daily, replay_heat_daily,
                       │                    replay_vitals_daily, replay_issues + replay_issue_daily, replay_live
                       ├─ kept only       → R2 replay/t<tenant>/<site>/<day>/<recording>/<seq>.ndjson.gz + marks.json
                       │                    + replay_recordings upsert + usage debit
                       └─ replay_releases first/last seen
  /api/replay/*  (membership + requireFeature('sessionReplay'); ?site= must belong to the caller's workspace)
  /api/projects/:projectId/replay/*  (hosted site of that project; same handlers)
  /api/admin/replay-ops/*  (superadmin, aggregates only)
Frontend: /apps/insights · canvas Measure ▸ Visitors · Admin link → ONE InsightsHome + ONE InsightsPanel
```

**Scope** is `ReplayScope = { tenantId: number; siteId: string }`. Every read takes it as a parameter; a read never infers scope from a row.

### 3.1 Release identity
First match wins: (1) `data-release` / `window.BF_RELEASE`; (2) hosted apps: `site_releases.version_token` written onto the injected tag; (3) builderforce.ai: `NEXT_PUBLIC_APP_VERSION` on the tag; (4) fingerprint: first 12 hex of SHA-256 over sorted `script[src]` + `link[rel=stylesheet][href]` URLs containing a `[.-][0-9a-f]{6,}[.-]` segment. Releases read `R<n> · first seen <date>` until renamed.

### 3.2 Data model (final)

**Core** (definitions; one migration):
- `replay_sites`: `id uuid pk`, `tenant_id int not null` → tenants, `kind varchar(16)` (`hosted|external`), `project_id int null` (bare id), `label varchar(200)`, `api_key_id uuid null` → `tenant_api_keys.id` (the `bfr_` key; allowed origins live on the key), `settings jsonb` (`maskAllText`, `consentRequired`, `keepRate`, `recordCanvas`, `identify`, `retentionDays`, `recorderChannel`, `publicKey`), `status varchar(16)`, timestamps. Unique `(tenant_id, project_id)` where `project_id` is not null.
- `replay_segments` (`id, site_id, name, filter jsonb, created_by, created_at`; unique `(site_id, name)`).
- `replay_smart_events` (`id, site_id, name, rule_kind page|click|custom, match, match_mode equals|prefix|contains, created_by, created_at`; unique `(site_id, name)`). Built-ins are code data.
- `replay_funnels` (`id, site_id, name, window_minutes default 30, created_by, created_at`) + `replay_funnel_steps` (`funnel_id, ord, step_kind page|click|event, match, match_mode`; pk `(funnel_id, ord)`).
- `replay_prescriptions`: `id, site_id, rule_id varchar(48), area varchar(16)` (`funnel|ux|site|sales|seo|content|performance|accessibility`), `source rule|observed`, `subject_key varchar(400)`, `page_path null`, `capture_id null`, `status` (`proposed|applied|measuring|worked|no_effect|worse|dismissed`), `finding jsonb`, `prescription text null`, `change jsonb null`, `visual jsonb null`, `impact jsonb`, `action_kind null`, `action_ref null`, `acceptance jsonb null`, `measured jsonb null`, `dismiss_reason null`, `decided_by null`, timestamps. Unique `(site_id, rule_id, subject_key)` where status is not terminal. One writer per column group: sweep (finding, impact, prescription, change, visual), action route (action, status), verifier (measured, status).
- `replay_page_captures`: `id, site_id, path, release_key, device_class, captured_at, screenshot_key, fold_screenshot_key, rect_map_key, seo jsonb, content jsonb, lab_perf jsonb, a11y jsonb, score jsonb`; unique `(site_id, path, release_key, device_class)`.
- `realizations.measure jsonb null` (S4d).
- The `catalog_items` row for `session-replay` (S6).
- `DROP TABLE replay_visits` (the misplaced 0486 table; its only reader is retired in S1).

**Transactional** (`0015_replay.sql`):
- `replay_recordings` — one row per **kept** recording: `id uuid pk, site_id, tenant_id not null, visitor_id, visit_id` (unique `(site_id, visit_id)`), `started_at, last_event_at, ended_at, duration_ms, active_ms, entry_path, exit_path, page_count, release_key, recorder_version, device_class, viewport_w, viewport_h, browser, os, country, referrer_host, click_count, rage_count, dead_count, error_count, quickback_count, excessive_scroll_count, converted, keep_reason` (`sample|frustration|error|goal|tag|manual`), `sample_weight real, variant null, identified_id null, traits jsonb null, billable_units, chunk_count, bytes, routes text[], events text[], frustrations text[], clicked text[]` (≤50), `issue_fps text[], steps text[]` (ordered route/event sequence, ≤60, for funnels and flow), `tags jsonb`. Indexes: `(site_id, started_at desc)`, `(site_id, release_key)`, `(visitor_id)`, GIN on `routes`, `events`, `frustrations`, `issue_fps`.
- `replay_releases` (`site_id, release_key` pk, `label, source explicit|hosted|fingerprint, first_seen_at, last_seen_at`).
- `replay_route_daily` (`site_id, day, release_key, route, device_class` unique; `sessions, entries, exits, pageviews, new_visitors, conversions, frustrated, errors, active_ms_sum, scroll_depth_sum`).
- `replay_breakdown_daily` (`site_id, day, dim` (`country|device|browser|os|referrer|entry|exit`), `value` unique; `sessions`).
- `replay_heat_daily` (`site_id, day, release_key, route, device_class, kind click|rage|dead|scroll, selector, label, gx, gy` unique; `n`). Scroll uses `gy` = depth decile, empty selector.
- `replay_vitals_daily` (`site_id, day, release_key, route, device_class, metric LCP|CLS|INP, bucket smallint` unique; `n`). p75 is read from the histogram; buckets are a contract constant.
- `replay_issues` (`id uuid, site_id, fingerprint` unique per site, `kind, route, subject, title, first_release, last_release, first_seen_at, last_seen_at, status new|ongoing|regressed|proposed|preview|measuring|verified|ignored, prescription_id null`) + `replay_issue_daily` (`issue_id, day, release_key, device_class` unique; `sessions`) + `replay_issue_representatives` (`issue_id, rank, recording_id, share, label`).
- `replay_visit_summaries` (`recording_id pk, summary, citations jsonb, model, generated_at`).
- `replay_live` (`site_id, visit_id` pk, `last_seen_at, route, device_class, x, y, recording_id null`); rows older than 5 minutes are purged by the cron sweep.

Nothing in the visitor stream is copied: builderforce.ai's page views and prompts stay `activity_log` rows; replay joins on `visit_id`.

### 3.3 Ingest (`ReplayIngestService.ingest`, never throws to the route, always 202)
1. Resolve the site (`bfr_` key hash → `tenant_api_keys` with scope `replay:ingest`, not revoked, `originAllowed`; or `hosted:<siteId>` whose origin equals the hosted subdomain or custom domain). Cached 5 min.
2. Per-IP daily budget (`replay:ingest:ip:` KV prefix, `REPLAY_IP_DAILY_CHUNKS = 3000`, fail-open), max chunk size, gunzip, `parseReplayChunk`.
3. Fold every chunk's marks into the rollup buffers (route, breakdown on `seq 0`, heat, vitals, issues via `issueFingerprint`, live).
4. Kept chunks only: `replayEntitledForSite` + usage (`canKeepNewRecording`: free allowance, then credits; drops NEW kept recordings when spent, keeps recordings in progress), store chunk, upsert `replay_recordings` (via `foldVisit`), append `marks.json`, debit units through the wallet (reference `replay-use:<recordingId>:<unit>`).
5. Release first/last seen; bump the site's cache version at most once per 60 s.
Trace verbs (`recordActivity`, separate module): `replay.loader.hit` (first config hit per site per day), `replay.ingest.first_event`, `replay.credits.first_debit`, `replay.allowance.exhausted`.

### 3.4 Contracts (`packages/interaction-contract`, shared by recorder, API and frontend)
Realign the existing package to these exact shapes; migrate every caller in the same pass.
- `selector.ts`: `deriveSelector(el)`, `redactInput`.
- `kinds.ts`: `MARK_KINDS = ['page','click','event','rage','dead','quickback','excessive_scroll','error','vital','scroll'] as const`; `GRID = 50`; `toGridCell(x, y, docW, docH)`.
- `frustration.ts`: `FRUSTRATION_THRESHOLDS` (rage ≥3 in 700 ms within 30 px; dead = non-interactive + no navigation/mutation in 500 ms; quick back = last three pages A→B→A with B < 7 s; excessive scroll = ≥3 reversals in 5 s, or > 3 viewport heights in 10 s with no click) and `isRageClick`, `isDeadClickCandidate`, `isQuickBack`, `isExcessiveScroll`.
- `chunk.ts`: `ReplayMark = { kind, key, label?, atMs, gx?, gy?, value? }`; `ReplayChunk = { v:1, visitorId, visitId, seq, startedAt, release, recorderVersion, device: { class, w, h, docW?, docH? }, browser?, os?, referrer?, newVisitor, keep: KeepReason | null, sampleWeight, marks, tags?, identify?, variant?, events?: unknown[], end? }`; `parseReplayChunk`; `REPLAY_LIMITS = { maxChunkBytes: 512_000, maxEventsPerChunk: 5_000, flushMs: 5_000, maxMarksPerVisit: 300, maxTagsPerVisit: 20, bufferMs: 60_000 }`; `VISIT_IDLE_MS`, `VISITOR_ID_PATTERN`; `VITAL_BUCKETS`.
- `routeTemplate(path, learned?)` (numeric, uuid, hex and long-token segments → `:id`) and `issueFingerprint({ siteId, route, kind, subject })`.
- `filters.ts`: `ReplayFilter = { all: ReplayFilterClause[] }`, `FILTER_FIELDS` (`{ id, ops, valueKind }`: device, browser, os, country, referrer, entryPath, exitPath, visitedPath, clickedSelector, frustration, durationMs, activeMs, pageCount, release, smartEvent, tag, converted, variant), `parseReplayFilter` (≤12 clauses, rejects unknowns), `filterToQuery` / `filterFromQuery`.
- `smartEvents.ts`: `SmartEventRule = { name, ruleKind: 'page'|'click'|'custom', match, matchMode }`, `BUILTIN_SMART_EVENTS` (sign up, purchase, add to cart, begin checkout, contact, download; five locales), `markMatchesRule`.
- `release.ts`: `releaseKeyFromAssets(urls): Promise<string | null>`.
- `snippets.ts`: `replaySnippets({ siteKey })` → script tag, npm, GTM.
- `proofMeasure.ts` (S4d), `visualPatch.ts` + `improvementPrompt.ts` (S4f).

### 3.5 Recorder delivery
The loader URL never changes. On each page load the config answer names the recorder (site channel, platform pin, else the manifest's latest, read from `REPLAY_MANIFEST_URL` and cached 10 min). Rollback is a pin. Every recording stores `recorder_version`.

## 4. Experience

### 4.1 One screen, one panel (D16)
`InsightsHome` fits 1440×900 with nothing below the fold (reflows to 1024; stacks and may scroll at ≤900):

| Band | Content | Click → kind |
|---|---|---|
| Header | breadcrumb, the query bar (`ReplayFilterBar`), period, release compare, proof chip while a proof is live | `proof` |
| Goal + numbers | goal selector (Activation · Revenue · Sign-ups · Retention) + six tiles (sessions, goal metric ≈ interval, frustrated sessions, JS errors per 1k, p75 LCP, site score), each with a sparkline | `metric` |
| Funnel | the site's funnel as one row of segments | `funnel` |
| Body | **Issues** (38%, issue groups ranked by goal impact, rows that fit + "View all") · **Page stage** (34%, the selected route with lenses Heat · Stuck · Fixes · Live) · **Do next** (28%, ranked fixes as before → after, "Apply all", score-by-release strip) | `issue`, `issues`, `fix`, `route`, `release`, `live` |

`InsightsPanel` is ONE `SlideOutPanel` (`width="wide"`, `widthStorageKey="insights-panel"`) holding a stack of levels with a breadcrumb. `INSIGHT_PANEL_KINDS` (data, `components/insights/panelKinds.ts`):

| Kind | Tabs |
|---|---|
| `recording` | Replay · Journey · Lead (identified visitors) |
| `issue` | Overview · Recordings · Fix · History |
| `fix` | Change · Prompt · Measure |
| `route` | the page review |
| `metric` | trend, breakdowns, segments |
| `funnel` | Steps · Clusters · Flow |
| `live`, `proof`, `release`, `issues`, `sites`, `plan` | — |

Rules: a slice registers a kind or a tab row, never a route or a second overlay; `?panel=<kind>:<id>[:<tab>]` (and `&t=<s>` for a recording) opens the panel on load; home lists are bounded, panel lists cursor-paginated; legacy admin URLs alias to the app with the matching `?panel=`. Canvas Measure ▸ Visitors renders the same home with the panel docked opposite the Brain.

### 4.2 The buyer's path (D17)
1. **Find:** `/marketplace/listing/session-replay` carries a landing from `LISTING_LANDINGS` (data by slug; sections hero, install, pillars, compare, pricing, faq, proof).
2. **Sign up:** "Start free" → `registerHref('/apps/insights/setup', 'install:insights')`; `resumeIntent(intent)` in `lib/auth.ts` survives sign-up, verification and workspace choice (used by every free listing).
3. **Licence:** `acquireListing` (free) → `template_licenses`; that licence IS the entitlement (`heldCapabilityFeatures` → `sessionReplay`).
4. **Site:** name, allowed domains, privacy switches → `replay_sites` + a `bfr_` key (`mintTenantApiKey`, scope `replay:ingest`).
5. **Snippet:** script tag · npm · GTM · Builderforce app switch.
6. **Verify:** live checks from trace verbs (loader hit, origin ok, first event, first kept recording).
7. **Plan:** 5,000 free; packs via one-off checkout.
8. **Use:** `/apps/insights` (`/apps/[slug]` from `CAPABILITY_APPS`) with the site switcher (`sites` kind) and usage chip (`plan` kind). The workspace nav lists installed capability apps from `GET /acquired`.

### 4.3 Theme, responsive, accessibility
Tokens only (`var(--surface-card)`, `var(--text-primary)`, `var(--border)`, `var(--accent)`, `var(--error)`, `var(--warning)`, `var(--success)`); fixed colours only inside the replay iframe. Tables scroll in their own box. 44 px targets on phones. The scrubber is `<input type="range">`; timeline markers are buttons with `aria-label`; tablists use `role="tab"` / `aria-selected`; the heat legend carries "cold/hot" text.

## 5. Behaviour specifications

### 5.1 Prescriptions (D13)
1. **Diagnose:** `PRESCRIPTION_RULES` (`domain/replay/prescriptions/rules.ts`): `{ id, area, detect(aggregates): Finding[], effort 1|2|3, actions, thresholds }`, pure over aggregates the application passes in. Rules: `rage_on_element` (≥3% of visits reaching an element rage it), `error_on_step` (an error fingerprint in ≥30% of drops at a step), `dead_click_heading`, `cta_below_fold` (CTA below the depth ≥40% reach), `quickback_after_reveal`, `excessive_scroll_missing_info`, `device_gap` (phone < 50% of desktop), `release_regression` (≥10 points down vs previous release), `pricing_hesitation` and `checkout_abandon_known` (identifiable visitors only), `objection_pattern`, `proof_missed_reason`; plus the page-review rules of §5.2.
2. **Estimate:** `estimateImpact(finding, cohorts)` = affected × (conversion without − with), 30-day projection, Wilson interval on both cohorts; `confidence: 'low'` and no point estimate below 100 visits in either cohort. Ranked by impact ÷ effort.
3. **Prescribe:** for the top ≤5 new findings per site per day, `condenseTranscript` (moved to `application/llm/condense.ts`) gets the finding, cited recording digests and the element map, and returns prescription, change and acceptance; uncited sentences are dropped. Shares `REPLAY_SUMMARY_DAILY_LIMIT = 200` per tenant per day.
4. **Apply:** `PRESCRIPTION_ACTIONS` registry — **Fix it** (task + `dispatchCloudRunForTask` for hosted sites with a coding agent → a preview release a person publishes), **Test it** (`ab_tests` draft via `marketing/experimentation.ts`; the sites Worker serves a sticky `bf_ab_<testId>` split and the loader carries `data-variant`), **Follow up** (sequence enrolment through `salesPolicy.ts`, contacts only via `resolveKnownContacts`), **Ticket**, **Dismiss** (reason required; 30-day suppression), and from §5.2 **Apply in composer**, **Copy prompt**, **Apply page**.
5. **Verify:** fix/ticket by the ticket effect (§5.3.4), test by `variantResults`, follow-up by enrolled vs matched-not-enrolled conversion. Status `worked|no_effect|worse`, outcome event `prescription.verify` (phase `validated`); `worse` on a published Fix it offers Revert.

### 5.2 The page review (D14)
- **Which pages:** entry pages, funnel steps, proof pages and the top 20 routes, ≤25 per site per release; a new release (first seen) triggers capture, otherwise weekly.
- **Capture:** `dispatchQaRunner` job `page_capture` in `api/qa-container/server.mjs`: Playwright at 1440×900 and 390×844, full and fold screenshots, rect map (`{selector,x,y,w,h,label,role}`), SEO facts, content facts (skipping masked/blocked regions), lab performance, accessibility facts. Never submits forms or signs in. Search Console via the analytics port when connected, never fabricated.
- **Review:** rules `seo_title_length`, `seo_missing_meta_description`, `seo_multiple_h1`, `seo_no_structured_data`, `seo_low_ctr_high_impressions`, `content_no_value_prop_above_fold`, `content_cta_vague`, `content_readability`, `content_missing_trust`, `perf_lcp_poor`, `perf_cls_poor`, `perf_heavy_hero_image`, `a11y_contrast`, `a11y_tap_targets`, `a11y_missing_labels`; plus ONE multimodal vision request per page through the gateway capability gate (≤5 observed findings, kept only by `acceptObserved`).
- **Render:** `VisualPatch` ops (`setText`, `setAttr` allow-list, `setStyle` allow-list, `moveBefore`, `moveAfter`, `insertAfter` sanitised, `hide`), validated by `validateVisualPatch`, applied in the runner (`page_render_after`) → before (numbered callouts) / after screenshots; SEO meta changes render as a SERP preview + JSON-LD diff.
- **Prompt:** `compileImprovementPrompt(input, { audience: 'composer'|'coding_agent'|'site_builder' })`, pure, fixed sections, never stored.
- **Measure:** `pageScore(facts, PAGE_SCORE_WEIGHTS)` per capture; the improvement ledger shows releases with the fixes they shipped and their verdicts.

### 5.3 The method link (D12)
1. **Proof measures:** `ProofMeasure = { sample: { filter, min }, success: { kind: 'smartEvent'|'funnel', ref }, threshold: { op, value, unit }, windowDays }` on `RealizationOutput.measure`, filled by each live target from its charter numbers (left undefined, and said so, where a criterion is not visitor behaviour); persisted in `realizations.measure`; generated pages call `BFReplay.event(<success>)` and tag `source`. `evaluateProofMeasure` → `collecting|met|missed` with evidence. `replayEntitledForSite` is true for a licensed workspace OR a project with a live realization.
2. **Measured verdicts:** `syncRealizationVerdict` precedence: a person's abandon; a posted verdict only when the sample is reached or with a written early-call reason (numbers replaced by the measured ones); otherwise `verdictMetric.held = 'sample_not_reached'`; at window end the measured verdict is written by the daily maintenance runner. `proof.grade` metadata gains `evidence`.
3. **Read again:** `realizationApi.plan(…, { priorRealizationId })` → `idea.read` with `metadata.priorGrade`; `PRIOR_GRADE_RULES` steer the recommender; `proofJourney` chains attempts.
4. **Ticket effect:** a ticket from a replay moment stores `replayMoment` in task metadata; `effectFor(task)` (on read, never stored) reports before/after once the newer release has ≥200 visits on the route.
5. **Journey signal:** `GET /api/realizations/journey-signal` → `make|measure|null`; `useFounderJourney` widens to make/measure.
6. **Method funnel:** `emitMethodEvent` from the `realizationApi` wrappers only; on builderforce.ai the four acts are smart events and "The method" funnel is seeded for the Builderforce workspace's site once it exists (seeded by the site-creation path, not a fixed uuid).

## 6. Guardrails (audited per slice)
- **One of each:** one visitor panel, one player, one stat tile, one selector derivation, one zone-ranking rule (`rankHeatZones`), one site key type (a scope on `tenant_api_keys`), one credit mechanism (`ledger_entries` denomination `replay_recordings` + one `ONE_OFF_SETTLERS` row), one usage meter (`application/consumption/meters.ts`, displayed == enforced), one filter contract and one compiler, one flow fold (`buildVisitorFlowGraph`), one condense primitive, one A/B engine, one runner, one prescription table, one entitlement function.
- **Layering:** routes construct application services and never import tables; components fetch through `lib/replayApi.ts` (and `lib/capabilityApi.ts`) only.
- **Size:** no new file over ~400 lines; `adminRoutes.ts`, `adminApi.ts` and `CreationCanvas.tsx` are not grown.
- **Caching:** every read through `getOrSetCached` with keys from `application/replay/replayCacheKeys.ts` carrying the site's version token; live TTL ~5 s; chunk bytes served with `Cache-Control: private, max-age=31536000, immutable` instead.
- **Abuse ceilings:** origin-bound keys, per-IP budget, max chunk size, monthly allowance; ingest never says why it dropped a chunk.
- **Privacy:** masking in the browser only; `VISITOR_DATA_ERASERS` (prompts, journey, replay) behind the one erase route; retention registered in `retentionPurge.ts` + an R2 prefix sweep.
- **i18n:** every string in all five catalogs with real translations: `replay.*`, `insights.*`, `creationCanvas.surface.sessions.*`, `marketplace.landing.insights.*`, `marketplace.capability.*`, `admin.insights.*`.

## 7. Non-goals (v1)
Native mobile SDKs; OS screen capture; metered subscriptions; cross-domain stitching; WebSocket push; fingerprinting (identity only via `BFReplay.identify` with the site's setting on); staff reading another workspace's recordings; GA / ad integrations; an event lake (ROADMAP scale-up).

## 8. Slices — remaining build work

Each slice lists only what remains. Tests ship with the code.

### S0 — Consolidation (finish)
- Realign `interaction-contract` to §3.4 and migrate callers (`replay-sdk`, `lib/qa/telemetry.ts`, `lib/visitorJourney.ts`); add `routeTemplate`, `issueFingerprint`, `snippets`; a test asserting `telemetry.ts` re-exports the shared `deriveSelector`; a `QaHeatmapService` byte-identical ranking test.
- `components/insights/panelKinds.ts` (`InsightPanelKind`, `InsightPanelLevel`, `INSIGHT_PANEL_KINDS` with `{ kind, labelKey, tabs: { id, labelKey, Component }[] }`), `InsightsPanel.tsx` (stack, breadcrumb, `?panel=` parse, Esc), `usePanel` context, `InsightsHome.tsx` + bands (`GoalBar`, `KpiTiles`, `FunnelBand`, `IssuesTable`, `PageStage`, `DoNext`, `ScoreStrip`), each ≤150 lines taking `{ scope, filter, days }`.
- `RecordingPanel` content becomes the `recording` kind (tabs `VISITOR_PANEL_TABS` registry with `requires`), `widthStorageKey="insights-panel"`.
- `adminGroups.ts`: export `LEGACY_ADMIN_SUB`; `resolveAdminRoute` returns `panel`. Admin ▸ Growth ▸ Visitors keeps Flow and Leads (builderforce.ai's `activity_log` journey) and links to `/apps/insights` and Insights operations.
- Delete `components/admin/visitor-flow/VisitorJourneyDrawer.tsx`.
- Tests: `InsightsHome.test.tsx`, `InsightsPanel.test.tsx`, `RecordingPanel.test.tsx`, `adminGroups.test.ts`.

### S1 — Data plane
- Migrations per §3.2 (core `1216_replay_core.sql` incl. `DROP TABLE replay_visits`; transactional `0015_replay.sql`) + Drizzle schema; update the entity-catalog ratchet.
- `domain/replay/`: realign `foldVisit`, `aggregateInteractions` (→ rollup cells), `marksToInsert` (→ `marks.json` cap), `replayScope` (`{tenantId, siteId}`, no platform); `billing.ts` `billableUnits`.
- `application/replay/`: `replayCacheKeys`, `replayChunkStore` (R2), `replaySites` (`resolveSiteForIngest`, `getSite`, `listSitesForTenant`), `ReplayConfigService`, `ReplayIngestService`, `replayRollupBuffer` (the `siteTraffic.ts` shape), `ReplayReadService` (`listRecordings` cursor 50, `getRecording` + marks, `chunk`, `releases`, `renameRelease`), `replayEntitlement` (`replayEntitledForSite`), `replayTrace` (trace verbs), `ReplayOpsService` (admin aggregates).
- Usage: retire `metering/replayUsage.ts`'s 50/month cap; ONE `replayUsage` over the wallet (`freeAllowance` with `replayFreeAllowanceOverride`, `creditBalance`, `canKeepNewRecording`, `chargeUnits`); `replay_recordings` meter in `meters.ts` + `usageMeter.replay_recordings` ×5.
- `visitorDataErasers.ts` registry (prompts, journey, replay); `GuestPromptService.forgetVisitor` runs it. Retention: register the transactional tables and the R2 sweep; purge `replay_live` > 5 min.
- Keys: `'bfr'` in `HashService.generateApiKey`; `replay:ingest`, `replay:read` in `TENANT_API_SCOPES`; security test: a key with only `replay:ingest` is refused by `GET /api/projects`.
- Routes: `replayIngestRoutes.ts` (`/api/replay-ingest`, CORS public prefix), `replayRoutes.ts` (`/api/replay`), `replayProjectRoutes.ts` (`/api/projects/:projectId/replay`), `replayOpsRoutes.ts` (`/api/admin/replay-ops`), sharing handler factories. Remove `GET /api/admin/replay-visits`, `adminApi.replayVisits`, `ReplayVisitService`.
- Tests: ingest (bad key, wrong origin, oversize, unkept chunk rolls up without a recording, kept chunk writes R2 + row, exhausted allowance stops new kept recordings only, retry never double-debits), sites, usage, erasers, routes (scope 403 across workspaces; `REPLAY_VIEWED`/`replay.session.viewed`), security.

### S2 — Recorder + CDN (finish)
Loader (`data-site`, `data-release`, `data-variant`, `data-api`; DNT/GPC first; config fetch `credentials:'omit'`; sampling; consent wait; queued `BFReplay` stub; `window.__bfReplay` hand-off). Recorder: ids (`bf_*` on builderforce.ai, `bfr_*` elsewhere), release key, rrweb (`maskAllInputs: true` hard, `maskTextSelector`, `blockSelector: '[data-bf-block]'`, password/`cc-*` never, sampling, `recordCanvas`), 60 s ring buffer, keep on sample/trigger, marks + `active_ms`, `vital` marks at pagehide, `scroll` depth per page, error + `unhandledrejection` (120 chars, fingerprint), gzip via `CompressionStream`, self-disable on error. `window.BFReplay = { consent, event, tag, identify, keep, stop, version }` with name/length checks and email/card refusal. `npm.ts` → `startReplay({ site, release })` injecting the loader. Splice `infra/cdn/publish-cdn.job.yml` into `release.yml` and add `replay-sdk` to the npm matrix. Tests as listed for each behaviour.

### S3 — Dogfood + player
`ReplayLoader.tsx` in `app/layout.tsx` (Builderforce workspace's site key from `NEXT_PUBLIC_REPLAY_SITE_KEY`; nothing rendered when unset; consent; `replay.recordSignedIn`; `replayExcluded`; identify on sign-in). `data-bf-block` / `data-bf-mask` on the sensitive components + test. Legal disclosure as a DRAFT legal version. `lib/replayApi.ts` (scope `{ siteId } | { projectId }`). `components/replay/RecordingsList`, `ReplayPlayer` (+ `useReplayPlayback`, `ReplayTimeline`, `ReplayEventList`, rrweb Replayer lazy-loaded), ticket-from-moment through the existing task flow, link-at-time. Recording kind's replay tab; issue kind's recordings tab.

### S4 — Heatmaps; S4b — MP4
`ReplayHeatmapService` (`grid`, `elements` ranked by `rankHeatZones`, `scrollDepth`, `routes`) over `replay_heat_daily`; `HeatmapView` (+ `HeatmapOverlay`, `ElementTable`, `ReleaseCompare`, `HeatmapInsights` with `HEATMAP_INSIGHT_RULES`) as the Page stage's Heat lens and inside the `route` kind; background = the latest kept recording's first full snapshot rebuilt in a sandboxed iframe. S4b: `replayVideoExport` via the QA runner job `replay_export`, 10 units once, `unavailable` honestly when no runner.

### S4c — Analysis parity
`replayFilterCompiler` (parameterised WHERE over `replay_recordings` arrays/columns; rollup target for exact counts), `replaySegments`, `filter-options`, `ReplayFilterBar` + `useReplayFilter` (URL-synced), `ReplayOverviewService` (rollups), `replaySmartEvents`, `ReplayFunnelService` + `domain/replay/funnelFold.ts` (batched, 20k ceiling, `truncated`), `replayFlow` (→ `buildVisitorFlowGraph`), `condenseTranscript` → `application/llm/condense.ts`, `domain/replay/visitDigest.ts`, `replaySummaries` (visit + segment, cited, cached, limited), `REPLAY_TOOLS` in `builtinMcpService.ts` (entitlement-gated, read-only), the `metric`, `issues`, `issue` (overview, recordings) and `funnel` (steps, clusters, flow) kinds, and the read-API docs.

### S4d — Method link
Per §5.3, with tests per target and `ProofScoreboard.tsx`.

### S4e — Prescriptions
Per §5.1: domain rules/impact/rank, `prescriptionSweep` (daily runner + "Find fixes now" hourly-limited), `prescriptionActions`, `prescriptionVerify`, `resolveKnownContacts`, the sites Worker A/B split (`check:sites-worker-graph`), `PrescriptionCard` + `PrescriptionActions` (registry-rendered), `DoNext`, `ScoreStrip`, the `fix` and `release` kinds and the issue kind's fix/history tabs, Brain `replay.prescriptions` / `replay.prescription_draft`.

### S4f — Page review
Per §5.2: `pageSelection`, `pageCapture` + runner handlers (`page_capture`, `page_render_after`), `visionReview` + `acceptObserved`, `visualPatch`, `improvementPrompt`, `pageScore`, `BeforeAfter`, `SerpPreview`, the `route` kind, Fixes as the home's lead column.

### S5 — Live + Flow links
`ReplayLiveService` (`active`, `byRoute` from `replay_live`, TTL 5 s; `tail`), `LiveView` (polling pauses while hidden), follow mode, `FlowView` detail strip via `onSelectNode` → recordings filtered by path, the `live` kind.

### S6 — Commerce + buyer path
`capability` kind (`deliveries: ['entitlement']`) in `marketplaceListings.ts`; the `catalog_items` row; `sessionReplay` in `PlanLimits` + `PLAN_FEATURE_LABEL`; `heldCapabilityFeatures` + `CAPABILITY_FEATURES` in `evaluateFeatureEntitlement`; `replay_pack` settler in `purchaseRegistry.ts`; refund hook; `capabilityRoutes.ts` (`POST /api/capabilities/session-replay/packs/:packId/checkout`, `MANAGER` + `BILLING_MANAGE`, 503 when unconfigured; `GET /api/capabilities/:slug/state`); `replaySiteAdmin` (external + hosted sites, key minting, settings); `LISTING_LANDINGS`, `resumeIntent`, `/apps/[slug]` + `CAPABILITY_APPS`, `/apps/insights/setup` (`CapabilityInstall`, `CapabilityVerify`), the `sites` and `plan` kinds, the superadmin credit grant (audited).

### S7 — Buyer surfaces
`injectBeforeBodyClose` extracted from `injectSiteBadge`; `siteReplayInjection.withReplayLoader` composed at both sites-Worker call sites (dependency-light); `CanvasInsightsSurface` replacing `CanvasSessionsSurface` (not entitled → listing link, no fetch; entitled + off → switch; else `InsightsHome` with `{ projectId }`, panel opposite the Brain via `useCounterBrainDockSide`); `useCapability(slug)`.

### S8 — Ship
Correct release note 1211's body to what ships (a new migration updating the row); keep the blog; version bumps; ROADMAP/DONE moves; operator runbook (§11).

## 9. Verification (Sonnet subagent)
Never the full vitest suite. Per slice: `api` type-check + `npm run check`; `frontend` type-check + `npm run check`; `packages/interaction-contract` tests; `replay-sdk` type-check/test/build/size; the slice's named test files; `check:sites-worker-graph` for S4e/S7; `bash .github/scripts/cdn-ensure.sh --dry-run` and `cdn-publish.sh --dry-run` for S2.

## 10. Audit checklist (planning session)
Decisions obeyed; no duplicates (`function (FunnelStat|Stat)\b` → 0; `0\.97` only in `heatZones.ts`; one `condenseTranscript`; `ReplayFilter` only from the contract); layering (no `schema` imports in `replay*Routes.ts`/`capabilityRoutes.ts`; no `fetch(` in `components/replay|visitors|insights`); sizes; registries not branches; caching on every GET; i18n ×5 with real translations; tokens only; accessibility; dead code removed; tests assert behaviour. Per slice: S1 `bfr_` refused elsewhere, 202 always, no `activity_log` writes in the ingest service; S2 `maskAllInputs` hard-true, DNT/GPC before any network call, manifest uploaded last; S3 signed-in gate + consent, rrweb only dynamically imported in the frontend; S4c one compiler, parameterised; S4d one verdict sync; S4e human gates hold; S4f one runner, anchored observed findings; S6 one install path, one payment path, idempotent ledger; S7 graph guard green.

## 11. Live validation runbook (operator + planning session)
Prerequisites: Stripe secrets and webhook; `CLOUDFLARE_API_TOKEN` with R2/DNS/Routes; the legal disclosure published; a non-superadmin test workspace.
1. Deploy api + frontend + `publish-cdn`; `curl -sI https://cdn.builderforce.ai/replay/v1/loader.js` → 200, `max-age=300`, no `cf-worker`, second request `HIT`; manifest names a hashed recorder; `/embed/v1.js` resolves.
2. Customer #1: the Builderforce workspace walks §4.2, sets `NEXT_PUBLIC_REPLAY_SITE_KEY`, records an anonymous visit with a rage click → it appears in `/apps/insights` with release chip and markers; `replay.session.viewed` written.
3. Test workspace installs (`replay.entitlement.granted`), superadmin sets `replayFreeAllowanceOverride = 0`, buys the 10k pack → trace chain, ledger credit 10,000, meter shows it.
4. External site + snippet → `site_key.issued`, `loader.hit`, `ingest.first_event`; Verify green.
5. Hosted app switch → injected loader with `data-release`; recording in canvas Measure ▸ Visitors.
6. Events/tags/quick back/excessive scroll, a 3-step funnel, a segment, a summary, a Brain question; walk §2.1.
7. Debits, a canvas-heavy recording > 1 unit, an MP4 export (10 units), refund → remainder debited; with 0 credits new kept recordings stop (`allowance.exhausted`), old ones still play.
8. Erase a visitor → recordings and chunks gone, audit counts per eraser.
9. Smoke-test proof end to end (held before sample, measured after, evidence, read-again).
10. Prescriptions on a hosted app with a broken button and a link-styled heading → Fix it preview, Test it split, verdicts.
11. Page review on an external fixture → captures, areas, before/after, copied prompt, redeploy detected, verdicts.
