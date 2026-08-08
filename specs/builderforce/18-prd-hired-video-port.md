# PRD 18 — hired.video → Builderforce.ai port

**Status:** Proposed · **Owner:** platform · **Created:** 2026-08-07
**Goal:** absorb the whole of `C:\code\hired\hired.video` into Builderforce.ai so
`hired.video` traffic can be redirected at `builderforce.ai` with nothing lost, and so
**two new built-in agents — Recruiter and HR — own the recruiting and people work as
first-class Builderforce teammates.**

The headline capability that has to work on day one of Phase 1:

> A Recruiter agent is given a résumé and a job description, and returns a
> **tailored résumé** — as a real Canvas object the user can edit and export to PDF/DOCX.

---

## 0 · Why this is cheaper than it looks

The two codebases already share a spine. This is not a rewrite; it is a **re-homing**.

| Layer | hired.video | Builderforce.ai | Port cost |
|---|---|---|---|
| API framework | Hono | Hono | **none** |
| DB | Neon Postgres + Drizzle | Neon Postgres + Drizzle | **none** — same dialect, same driver, same `neon-http` no-interactive-tx constraint |
| Runtime | Cloudflare Workers + R2 + KV + Durable Objects | Cloudflare Workers + R2 + KV + Durable Objects | **none** |
| Shared types | `shared/*.ts` compiled into both sides | `packages/*` | mechanical |
| Frontend | Vite + React Router 6 SPA + i18next | Next 15 App Router (`next-on-pages`, edge) + next-intl | **route shells rewritten, leaf components move as-is** |
| AI tools | `shared/ai-tools` registry + `shared/mcp/dispatch.ts` | `application/llm/builtinMcpService.ts` CATALOG | 1:1 mapping |
| Creative surface | Studio (`mediaKind` → canvas runtime) | Creation Canvas (`CreationObjectKind`) | **the kinds already line up** |

Three facts do most of the work:

1. **`packages/creation-canvas-contract/src/index.ts` already declares every kind
   hired.video's Studio implements** — `video, voice, image, animation, podcast, comic,
   game, cad, model3d, resume, document, template, drawing, slides, diagram`. Today those
   kinds resolve to `builtin_creative_compose`, which returns a *manifest* — a description
   of an artifact, not an artifact. hired.video has the **runtimes** that turn that manifest
   into a thing you can edit: `TimelineCanvas`, `GameStage`/`GameStage3D`, `DrawingStage`,
   `CadStage`, `Cad3DStage`, `DocumentStage`, `ComicReader`, `AnimationStage`,
   `MusicComposer`, `WebcamRecorder`, `useScreenRecording`/`useScreenshotCapture`.
   **The port is: fill the kinds that are already declared.**

2. **`api/src/application/integrations/hiredVideo.ts` already exists** — Builderforce
   consumes hired.video through a narrow provider seam (`provisionJobSeeker`,
   `uploadResume`, `getProfile`, `createEmbedToken`, `connectExisting`), env-gated on
   `HIRED_API_KEY` with a native fallback. **Invert that seam** — reimplement it natively —
   and the freelance marketplace cuts over with a config flip and zero call-site churn.
   This is the strangler-fig anchor for the whole program.

3. **The connector platform (migration 0410) makes HRMS integrations DATA, not code.**
   Workday / BambooHR / Greenhouse / Lever / ADP / SuccessFactors / Rippling / HiBob are
   manifests in `api/src/application/connectors/defaults/`, executed by the shared
   runtime that already owns SSRF guarding, credential decryption and audit logging. No
   per-vendor code path, no per-vendor deploy.

### Scale, measured

| Thing | Count |
|---|---|
| hired.video Postgres tables | **428** (`export const … = pgTable(`) across 94 schema files |
| hired.video API route modules | **199** top-level + 9 `scorecards/*` + 11 `superadmin/*` |
| hired.video services / domains | 80 service dirs, 8 domains |
| hired.video frontend pages | **137** top-level + ~72 across 16 page subdirectories |
| Studio frontend LOC (`lib/studio` + `components/studio`, tests excluded) | **~85,000** |
| Durable Objects / background workers / browser workers | 3 / 7 / 3 |
| Builderforce migrations today | 0413 |

> **Count correction (2026-08-07).** An earlier draft of this PRD said 215 tables. That was
> a measurement error — it counted only `pgTable("name", …)` declared on ONE line and missed
> every multi-line declaration. The real figure is **428**, and the correction matters
> because it roughly doubles T0's tenant-scoping codemod and the Neon row-count budget.

Roughly **175 of the 428 tables sit in platform/shared domains** (users, workspaces, billing,
usage, admin, analytics, messaging, taxonomies, …). Only about **60–70 of those genuinely
map onto a Builderforce equivalent**; the rest still port. See §6 for the table-by-table
verdict — including five domains an earlier draft wrongly called "already covered".

| Group | Tables | Track |
|---|---|---|
| Recruiting / ATS core | ~100 | **T1 + T2** |
| People-Ops / HR | ~33 | **T3** |
| Studio / Canvas | ~44 | **T4** |
| Marketing / campaigns / content / community | ~56 | **T5** |
| Learning / courses | ~22 | **T6** |
| Platform / shared (~60–70 map, ~105 port) | ~173 | **T0 + T6** |

---

## 1 · Target architecture

### 1.1 Two new built-in agents

Both are ordinary `ide_agents` rows carrying a stable `builtin_kind` (the pattern set by
migration 0289 and `application/agent/provisionBuiltinAgents.ts`), so the roster, the
designation picker, lane dispatch, `manager.*` staffing and per-project Brain chat all
reach them through machinery that already exists. Add both to `BUILTIN_AGENTS` **and** ship
the backfill migration in the same pass, or existing tenants never get them.

**`builtin_kind = 'recruiter'` — Recruiter**
> Sources, screens and packages candidates. Given a résumé and a job description it produces
> a tailored résumé, an ATS score with the specific gaps named, a match explanation, and a
> candidate packet. Runs intake on a role brief, builds the pipeline, drafts outreach, sets
> up screening and interview kits, and scores submissions against the scorecard it published.

**`builtin_kind = 'hr'` — HR** (Human Resources / People)
> Owns the people side: Career 360 and career coaching for individuals, and organisational
> design for the company. Reads the connected HRMS, reviews the org plan against the
> strategic objectives, and recommends where to hire, where to redeploy and where to reduce —
> with the headcount, cost and capability evidence for each recommendation. It never issues
> an employment decision; it produces a reviewable recommendation with its evidence attached.

Both bios must name **no tool ids** — the persisted-bio-vs-code-catalog trap documented on
the Manager seed (migration 0376/0379). Tools are resolved live and named by the framing
helper in `brain/BrainService.ts`.

### 1.2 One tool catalog

hired.video's `shared/ai-tools/index.ts` registry (23 tools) and `shared/mcp/descriptors.ts`
collapse into `application/llm/builtinMcpService.ts` `CATALOG` — the single source both the
web Brain and the VS Code extension already read ([[brain-mcp-catalog-single-source]]).

New namespaces:

```
recruiter.tailor_resume      recruiter.score_resume        recruiter.match_job
recruiter.parse_resume       recruiter.optimize_resume     recruiter.roast_resume
recruiter.extract_skills     recruiter.interview_questions recruiter.screen_candidate
recruiter.build_packet       recruiter.source_candidates   recruiter.publish_job

hr.career360_suggest_targets hr.career360_select_target    hr.career360_state
hr.coach                     hr.profile_audit              hr.value_proposition
hr.salary_analyze            hr.comp_analyze
hr.org_review                hr.headcount_plan             hr.performance_review
hr.hrms_sync                 hr.team_health
```

Every one of these is a **thin adapter over a ported service**, not new logic — e.g.
`recruiter.tailor_resume` → `handleTailor` from
`api/src/services/job/match-handlers.ts` (1,522 LOC, already dependency-injected behind a
`MatchDeps` port with `db` / `now` / `llm` seams, and already test-covered without Hono or
network). That injectable shape is why the recruiting core ports first: it needs a `db`
swap and a tenant scope, not a rewrite.

**Contract rule:** prompts reference `advertisedName()`, never the catalog id, and a test
asserts it ([[prompt-tool-name-contract]]) — otherwise the agents silently describe tools
instead of calling them.

### 1.3 Canvas: fill the declared kinds

The Creation Canvas keeps its contract. Each ported runtime mounts as the **editor body**
for a kind that already exists, replacing the manifest-only placeholder:

| Canvas kind | hired.video runtime to port | Export path |
|---|---|---|
| `resume`, `document` | `DocumentStage` + `ResumeDocumentView` + `document-state.ts` + `document-templates.ts` | PDF via browser print (preview === render), DOCX |
| `video`, `podcast`, `voice` | `TimelineCanvas` + `editor-v2/*` + `export-facade.ts` | MP4/MP3 via ffmpeg.wasm / WebCodecs |
| `image`, `drawing` | `DrawingStage` + `image-state.ts` + `ag-psd` | PNG/JPG/WebP/PSD |
| `animation` | `AnimationStage` + `FramesRail` | GIF / WebP / APNG / MP4 |
| `comic` | `InteractiveComicStage` + `ComicReader` + `comic-page-builder.ts` | PNG strip / PDF / CBZ |
| `game` | `GameStage` / `GameStage3D` + `lib/studio/game/*` (blocks, runtime, export) | HTML5 ZIP / web embed |
| `cad` | `CadStage` + `lib/studio/cad/*` | SVG / PDF / DXF |
| `model3d` | `Cad3DStage` + `cad-3d-edit.ts` (react-three-fiber) | STL / STEP / GLB |
| — (new) | `WebcamRecorder`, `useScreenRecording`, `useScreenshotCapture` | capture → R2 → widget |

**Screen capture** is `getDisplayMedia` → `MediaRecorder` → R2 upload → a Video widget on the
canvas (142 LOC in `use-screen-recording.ts`, 85 in `use-screenshot-capture.ts`, self-gating
on `isSupported` so no `canRecord` boolean is prop-drilled). It lands in Builderforce as a
Canvas capture action wired through `workspaceStore.ts` — **all IDE/R2 file access goes
through that module** ([[ide-workspace-store-contract]]); no inline bucket calls.

`media-kinds.ts` (`OUTPUT_PROFILES`, `PUBLISH_DESTINATIONS`, `MEDIA_KIND_UI`, the
`mediaKindUses*` predicates) is the single source hired.video uses for export/publish
gating. It **merges into `creation-canvas-contract`** rather than being copied beside it —
one `CREATIVE_CAPABILITIES` table, extended with `outputProfiles` and
`publishDestinations`, so the save menu, the export facade and MCP `creative.capabilities`
keep agreeing. Preview tiles keep obeying `creativePreviewImageUrl()`
([[canvas-creative-preview-rule]]) — a DXF or an STL is drawn back, never `<img src>`d.

### 1.4 HRMS integrations = connector manifests

New `api/src/application/connectors/defaults/hrms.ts`, merged by `defaults/index.ts` beside
`business.ts` / `productivity.ts`, validated by the same `parseConnectorManifest` gate the
tenant-authored path uses:

`workday`, `bamboohr`, `greenhouse`, `lever`, `ashby`, `successfactors`, `adp`,
`rippling`, `hibob`, `personio`, `namely`, `gusto`

Actions per connector: `list_employees`, `get_employee`, `list_departments`,
`list_positions`, `list_requisitions`, `create_requisition`, `list_candidates`,
`advance_candidate`, `list_time_off`, `list_compensation`. The HR agent reaches all of them
through `connectorTools.ts` — one code path, credentials encrypted per tenant, every call
audited. **Adding an HRMS after launch is a manifest, not a deploy.**

### 1.5 Marketing campaigns

hired.video's `CampaignService` (590 LOC) + `campaigns-public` + audiences/targeting
(`shared/audiences.ts`, `ad-targeting.ts`, `content-audiences.ts`) merge **into**
`api/src/application/marketing/campaignEngine.ts` (894 LOC), which already covers site
campaigns after migration 0412. This is a merge, not a second engine — two campaign engines
is exactly the technical debt the standing rule forbids ([[no-technical-debt-rule]]).

---

## 2 · The tracks

Six tracks. **T0 and T1 are strictly sequential and gate everything else.** T2–T6 are
independent once T1 lands and can run in parallel.

### T0 · Foundation (blocks everything)

1. **Tenant scoping.** hired.video is user/workspace-scoped; Builderforce is tenant-scoped.
   Every ported table gains `tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE
   CASCADE` plus a `(tenant_id, …)` index. Write the mapping once as a codemod over the
   Drizzle schema files; do not hand-edit 155 tables.
2. **Migration renumbering.** hired.video's `api/drizzle/*` is replayed as Builderforce
   migrations starting at `0414`, one per track slice. `neon-http` has **no interactive
   transactions** ([[gap-register-burndown]]) — every migration must be
   independently re-runnable, `IF NOT EXISTS` throughout.
3. **Identity mapping.** hired `users.id` (uuid string) → Builderforce `users.id`
   (varchar 36). Same shape. `user_profiles` merges into the Builderforce profile row;
   `career_target` (the Career 360 document) becomes a JSONB column on it.
4. **Auth/roles.** hired's `shared/user-roles.ts` + `role-access.ts` + `ModuleGate` fold
   into `lib/rbac.ts` + `<RoleGate>` ([[rbac-rolegate-primitives]]) — disable, never hide.
   hired's `NON_CANDIDATE_ROLES` becomes a role-catalog entry, not a second enum.
5. **Plan gating.** hired's tier enforcement (`attachTokenBudget` / `requireTokenBudget`)
   maps onto `planFeatures.ts` + `featureGate.ts` — **one evaluator**, superadmin bypass,
   miss = 402 ([[paid-plan-feature-gate]]). Do **not** port `tierEnforcement.ts`.
6. **Caching.** hired's `utils/edge-cache.ts` `getOrSetCached` maps onto Builderforce's
   canonical `getOrSetCached` (L1 Map + L2 KV). Every ported read endpoint is cached or
   states why it cannot be.

**Exit criteria:** a ported table can be created, tenant-scoped, read through the cache, and
gated by plan — proven end-to-end on one table (`resumes`) before T1 starts.

### T1 · Résumé spine + the Recruiter agent — *the Phase 1 deliverable*

This is the smallest slice that makes the headline capability real.

**Port:**
- `services/resume/*` — `parse.ts` (814), `merge.ts` (988), `ResumeService.ts` (1,010),
  `analyze.ts`, `rewrite-xyz.ts`, `skills.ts` (620), `extractFile.ts`, `redaction.ts`,
  `summarize.ts`, `score-with-llm.ts`, `view.ts`
- `services/job/match-handlers.ts` — `handleAnalyze` / `handleTailor` / `handleByContent`
- `shared/resume.ts` (655) + `resume-markdown.ts` + `tool-schemas.ts` +
  `shared/ai-prompts/*` → a new `packages/recruiting-contract`
- Tables: `resumes` (8), `resumeFeedback` (2), `jobs` (6), `match` (1), `candidates` (6)
- `DocumentStage` + `ResumeDocumentView` + `document-state.ts` + `document-templates.ts` +
  `resume-sections/*` + `resume-renderer/*` → the `resume` Canvas kind

**Build:**
- `builtin_kind='recruiter'` seed in `provisionBuiltinAgents.ts` + backfill migration
- `recruiter.*` MCP tools in `builtinMcpService.ts`, with the `advertisedName()` assertion test
- Canvas `resume` object: generate → **edit in `DocumentStage`** → export PDF/DOCX via
  `canvasExports.ts` ([[canvas-document-editing-and-export]] — `richText.ts` /
  `printDocument.ts` / `canvasExports.ts` are the only implementations; do not add a second)

**Cut over:** reimplement `application/integrations/hiredVideo.ts` natively behind its
existing exported signatures. `isHiredConfigured()` becomes `true` unconditionally; the
remote SDK path is deleted once the native path is green. `provisionForHire.ts` and the
freelance marketplace change **zero call sites** — this is the whole point of anchoring on
the seam.

> Also closes an open roadmap item: *"Résumé auto-fill can't parse binary PDF/DOCX locally
> without a linked hired.video."* `extractFile.ts` ports server-side text extraction, so the
> binary-résumé gap dies with T1.

**Demo that proves the track:** upload a résumé + paste a JD → Recruiter returns a tailored
résumé as an editable Canvas document → export PDF. No hired.video key involved.

### T2 · Recruiting / ATS

Pipelines (`jobpipeline`), talent pools + placements + splits (`recruiter`, 22 tables),
BD (`recruiterBd`), retained search, sourcing bids, screening + live screening,
interviews + question sets + assignments, scorecards (9), assessments + predictive,
take-home invites, references, company profiles + reviews, job scraper + job boards +
`apply-button` + `auto-apply`, the Chrome extension endpoints, `autofill`.

Recruiter agent gains `source_candidates`, `screen_candidate`, `build_packet`
(`domains/recruiter/candidatePacket.ts` + `packet-renderer.ts`), `publish_job`. Jobs
publish through the existing marketplace surface rather than a second board
(the roadmap already flags two publish paths converging).

### T3 · HR agent — Career 360, coaching, org design

**Career 360** — `services/career360/Career360Service.ts` (1,036) + `shared/career360-types.ts`
(379) + `components/career360/*` (`CareerHealthWheel`, `TargetPicker`, `TargetRoadmap`,
`ScoreHistorySparkline`). Three moves: suggest targets → select a target (derives rubric +
gap analysis + roadmap, persisted as one document) → score history assembled from tool runs.
In Builderforce the score history reads `activity_log` — the ONE audit store
([[unified-activity-audit-log]]) — not a ported `tool_runs` table.

**Career coaching** — `ai-prompts/career-coach.ts`, `career.ts`, `interview.ts`,
`resume-roast.ts`, `video-pitch.ts`; the `/AICoach` surface becomes an HR-agent Brain chat
with `origin='hr'`, the pattern the Manager already uses ([[manager-is-an-agent]]).

**Org design** — `domains/people-ops/*` (`peopleOpsService.ts`, `teamHealth.ts`, events),
`people-strategy.ts` (strategic objectives + outcomes + milestones + performance reviews),
`services/people-ops/segment.ts`, `workflow-delivery.ts`, `workforce.ts`, `calibration`,
`performance`.

`hr.org_review` and `hr.headcount_plan` are the two genuinely new pieces of work — they read
(a) the HRMS roster via connectors, (b) `people_strategic_objectives`, (c) the delivery
signal Builderforce already computes (`lib/deliveryVerdict.ts`, member metrics,
`portfolioRollup.ts`) — and emit a **recommendation with evidence**, rendered as a Canvas
`report` with charts ([[insights-everywhere-standard]]). A reduction recommendation is an
approval-gated artifact behind `<RoleGate>`, never an automated action.

**Objectives caution:** Builderforce already owns `objectives` / `key_results` with
`project_id` scope ([[okr-objectives-vs-epics]], [[objectives-project-scope]]).
hired's `people_strategic_objectives` must **map onto those tables**, not add a parallel
OKR store. Writes must `invalidateProjectsList`.

Deliver alongside: the HRMS connector manifests (§1.4).

### T4 · Canvas runtimes (the big one — ~85K LOC)

Order by leverage, one runtime per slice, each independently shippable:

1. `document`/`resume` (already in T1)
2. `image` + `drawing` — `DrawingStage`, layers, PSD round-trip
3. `video` + `voice` + `podcast` — Timeline, NLE, `export-facade.ts`, voiceover, dubbing,
   captions/chapters, teleprompter, **webcam + screen capture**
4. `animation` — `AnimationStage`, frames rail
5. `game` — `GameStage`/`GameStage3D`, block interpreter, sprite library, HTML5 export
6. `comic` / `interactive_comic`
7. `cad` + `model3d` — `CadStage`, `Cad3DStage`, DXF/STL/STEP

> **Hard dependency on the navigation architecture.** Each runtime mounts as a **stage mode**,
> not a page — the Stage bucket goes from 5 routes to ~15. Slice 1 can land against today's
> canvas, but **Phase 4 of the navigation design (canvas hoisted into the shell behind
> active-canvas state) must land before slice 3**, or the hoist gets redone once per runtime.
> The route classifier's Stage bucket becomes mode-aware: `/create/[id]` resolves `mediaKind`
> to a runtime *inside* the already-mounted stage, so switching from a comic to a CAD model is
> a state change, not a remount.

> **ONE display/camera capture primitive, two sinks.** `getDisplayMedia` has two callers the
> moment both programs land: the live session broadcasts it over WebRTC (`useScreenShare`),
> and this track records it to an artifact (`use-screen-recording` → `MediaRecorder` → R2).
> Same for `getUserMedia`: `useMediaRoom` already acquires the camera for tiles, and
> `WebcamRecorder` acquires it again to record. Ship **`lib/useDisplayCapture.ts` +
> `lib/useCameraCapture.ts`** that own acquisition, device choice, permission state and
> track-stop cleanup, and let each consumer attach its own sink. Two independent
> `getDisplayMedia` call sites is how the product ends up with two answers to "am I sharing?"
> — the same argument `useMediaRoom`'s own header makes about a second WebRTC stack.

Per-slice mechanics:
- Studio components are **leaf React** — they move nearly verbatim under `'use client'`.
  The work is the shell: React Router → App Router, i18next → next-intl, hired's Tailwind
  tokens → **canvas-palette tokens, not shell tokens**. Each runtime is a stage surface and
  declares its own light + dark ([[canvas-owns-its-palette]]); hoisting the board into the
  shell must not turn a ported runtime into a shell-themed surface.
- **Every ported component must be localized in all five catalogs (en/zh/es/fr/de) with real
  translations, and must work in light + dark + at 360px, in the same pass**
  ([[i18n-localization]], [[theme-and-responsive-ui]]). hired ships an
  `i18n-hardcoded-audit.txt` — treat it as the pre-existing debt list and clear it per slice
  rather than importing it.
- The Canvas declares its own palette ([[canvas-owns-its-palette]]); do not derive from
  app-shell tokens.
- The prompt stays bottom-centre ([[canvas-prompt-center-bottom]]); runtime panels are
  `SlideOutPanel`, and modals are only for destructive approvals
  ([[slideout-not-modal-convention]], [[confirm-modal-useconfirm]]).
- Heavy deps (`@react-three/fiber`, `@react-three/rapier`, `ag-psd`, `jszip`, `mediapipe`,
  `tiptap`) are **dynamically imported per runtime** — the canvas bundle must not grow by
  the union of all runtimes. Watch for chunk-load regressions; `chunkErrorRecovery.ts`
  covers white-screens but is not a licence to ship a 12MB entry chunk.

`@seanhogg/builderforce-studio` (the WebGPU diffusion **generator**) and the ported Studio
(the **editor**) are complementary and must not be conflated: generate frames with the
former, compose and export them with the latter. One `video` Canvas kind, two stages of one
pipeline.

### T5 · Marketing, campaigns, content, social

Campaigns merge into `campaignEngine.ts` (§1.5). Then: advertising + paid media (23 tables),
social publishing (LinkedIn/YouTube posting already partly present), articles + blog + SEO
surfaces, events + bookings, community resources, feed, `og.ts` / `sitemap.ts` /
`structured-data.ts`. Marketing pages follow the shell-routing rule
([[evermind-marketing-shell-routing]]) and the marketing-page localization rule.

### T6 · Learning, monetization, comms, platform remainder

An earlier draft said gamification, affiliates, partners and payouts "map, don't copy —
Builderforce owns these." **That was wrong**, verified 2026-08-07 by grepping
`api/src/application` + `api/migrations`. Corrected verdicts:

| hired.video domain | Tables | Builderforce today | Verdict |
|---|---|---|---|
| Gamification (points, streaks, badges, rewards, leaderboards) | 10 | **none** — the 148 "points" hits are `task_story_points` (0246) | **PORT** |
| Affiliates (programs, referrals, commissions, payouts) | 6 | **none** — 0402 is sales-associate commissions, a different economy | **PORT** |
| Whitelabel (per-tenant branded domains) | 1 | **none** | **PORT** — reconcile with the site-backend custom-domain work (0412) |
| WebAuthn / passkeys | 2 | **none** — BF has MFA (0010), OAuth + magic link (0034), no passkeys | **PORT** |
| Payouts + tax reporting (ledger, onboarding, Tremendous, Helcim ACH, encrypted tax IDs, 1099) | 3 tables + 9 services | **stub only** — `isPayoutsConfigured`; the roadmap already flags "no escrow/milestone flow" | **PORT** — hired.video is ahead here; this *closes* an open BF gap |
| Phone / SMS (numbers, call logs, balances, top-ups) | 5 | Twilio **connector** only — no phone-number product | **PORT** |
| Courses / LMS / learning paths / xAPI LRS | 22 | **none** | **PORT** |
| Bookings / calendar / reservations | 9 | **none** | **PORT** |
| Messaging (conversations, read receipts, email campaigns, suppressions) | 12 | chat + email exist; campaigns merge into `campaignEngine.ts` | **PARTIAL** |
| Boards / tasks (`productivity.ts`) | 3 | full kanban | **MAP** |
| Gigs / services marketplace | 9 | 0269/0273/0293 freelance + gig marketplace | **MAP** (reconcile schemas) |
| Billing / usage / API keys / admin / analytics / taxonomies / legal | ~40 | equivalents exist | **MAP** |
| Users / workspaces / grants | 26 | tenants + users + memberships | **PARTIAL** — hired's 24 user-side tables include profiles, preferences, referrals, sessions |

Also in T6: help/support, superadmin surfaces (11 route modules), outplacement, coffee-chats,
lists, reviews, references, community, compliance, locations + geocoder cache, vendor sync,
and the enrichment/scraping services.

> Net effect of the correction: T6 is **not** a mop-up track. It carries a points economy, an
> affiliate program, a payout/tax-reporting stack, an LMS and a passkey implementation that
> Builderforce does not have today. Size it accordingly.

---

## 3 · Traffic cutover

Only after T1–T6 land for a surface. Per-surface, not big-bang:

1. **Dual-run.** The native path serves Builderforce; hired.video keeps serving hired.video.
   `application/integrations/hiredVideo.ts` becomes the comparison harness — same inputs,
   both paths, diff the outputs on résumé parse/score/tailor until they agree.
2. **Data migration.** One `pg_dump` → transform → load per group, tenant-scoped by
   workspace. Résumé/video blobs move R2→R2 by key rewrite (no re-upload).
3. **URL map.** `hired.video/*` → `builderforce.ai/*` 301s, authored as a data table so a
   redirect is not a deploy. Public surfaces that carry SEO (`/jobs/*`, `/companies/*`,
   `/articles/*`, `/tools/*`) map 1:1 and keep their slugs; `PUBLIC_SHELL_PREFIXES` gains
   the ported public prefixes so logged-out visitors get the marketing shell.
4. **Embeds + SDK.** Builderforce is the only *known* `@seanhogg/hired-video-sdk` consumer, and
   T1 removes that dependency. If §6.6 exception 1 resolves to "no third-party holders",
   **delete the SDK, the package and `createEmbedToken`'s hired-side implementation outright**
   — a compatibility shim for zero consumers is dead code. If holders do exist, publish the
   shim (hired wire contract → Builderforce endpoints, still minting 15-minute embed URLs)
   and give it a dated end-of-life rather than keeping it indefinitely.
5. **Chrome extension + Outlook plugin** repoint at `api.builderforce.ai` — version-bumped,
   store-reviewed, so start this early; it is the longest external lead time.
6. **Retire — 100% deprecation.** `hired.video` becomes a redirect shell with **no running
   product behind it**: the Worker serves 301s only, its Durable Objects and cron triggers
   are removed, and its R2/KV bindings are released once the data migration is verified.
   Delete `application/integrations/hiredVideo.ts` in full (not just its remote branch), the
   `@seanhogg/hired-video-sdk` dependency, `HIRED_API_KEY` / `HIRED_API_BASE_URL` from
   `env.ts` and every `wrangler.toml`, and close the roadmap items they anchor. A grep for
   `hired` across `api/src` + `frontend/src` must return only redirect-map data and this PRD.

---

## 4 · Sequencing

| Phase | Tracks | Deliverable |
|---|---|---|
| 1 | T0 + T1 | **Recruiter agent tailors a résumé against a JD, editable on Canvas, exports PDF.** Native résumé path replaces the hired.video SDK for the freelance marketplace. |
| 2 | T3 (Career 360 + coaching + HRMS connectors) | **HR agent** ships Career 360, coaching chat, and reads a connected HRMS. |
| 3 | T2 + T3 (org design) | Full ATS; `hr.org_review` / `hr.headcount_plan` recommendations with evidence. |
| 4 | T4 | Canvas runtimes, one kind per slice. Longest track — starts at Phase 1 and runs in parallel throughout. |
| 5 | T5 + T6 | Marketing + campaigns; then the monetization/comms/platform block — points economy, affiliates, payouts + tax reporting, LMS, bookings, phone, passkeys, whitelabel. **Not a mop-up phase** (§T6). |
| 6 | Cutover | Dual-run → data migration → redirects → **full retirement** (§3.6). |

---

## 5 · Standing rules this port must not break

- **No second implementation of anything.** Campaigns → `campaignEngine.ts`. Objectives →
  `objectives`/`key_results`. Audit → `activity_log`. Exports → `canvasExports.ts`. Board
  view toggles → `@/components/ViewToggle`. Model selection → the shared
  `PromptOptionsMenu` ([[prompt-options-menu-single-model-control]]). If a duplicate is
  extracted, **every** call site migrates in the same pass ([[no-technical-debt-rule]]).
- **Localize + theme + responsive in the same pass** as each ported component.
- **Cache or justify.** Every ported read endpoint goes through `getOrSetCached` with
  write-invalidation, or says in the PR why it cannot.
- **Delete as you go.** A ported module's hired.video original, and any Builderforce
  scaffold it supersedes, is deleted in the same pass. Zero-reference check across api +
  frontend + packages first.
- **Neon cost.** ~360 new tables on the Free tier is the single biggest operational risk
  ([[neon-cost-under-5-dollars]]). Budget row counts per track, keep the KV work-gate
  (`cronWorkSignal.ts`) in front of every ported cron, and re-check after each track. If the
  budget cannot hold, the decision to move off Free is an operator call, not an engineering
  workaround — do not shard, do not drop retention silently.
- **Log then fix.** Every gap found during a slice is registered *and closed* in that slice,
  or names its single concrete blocker.

---

## 6 · Coverage appendix — every hired.video surface, mapped

This section is the answer to "confirm all functionality lands in Builderforce.ai." Nothing
in hired.video is unlisted. A surface is either assigned a track, marked **MAP** (a
Builderforce equivalent already exists and the port reconciles onto it), or appears in §6.6
as an explicit exception requiring a decision.

### 6.1 API route modules (199 top-level + 20 nested) → track

**T1 — résumé spine (13):** `resumes`, `resume-optimizer`, `resume-scorer`, `resume-roast`,
`resume-feedback`, `match`, `jobs`, `job-analytics`, `skill-extractor`, `summarize`(via ai),
`template-extractor`, `pdf-to-json`(tool), `upload`

**T2 — recruiting / ATS (48):** `recruiter`, `recruiter-bd`, `retained-search`,
`sourcing-bids`, `candidates`, `jobpipeline`, `pipeline-all`, `pipeline-share`,
`bulk-scoring`, `cohorts`, `screening`, `live-screen`, `interview`,
`interview-question-sets`, `interview-assignments`, `scorecards` + `scorecards/{bias,
competencies, decisions, kits, sla, submissions, takehome, templates, visibility}`,
`take-home-invites`, `assessments`, `predictive-assessments`, `calibration`, `references`,
`ats`, `apply-button`, `auto-apply`, `autofill`, `extension`, `jobscraper`, `discovery`,
`companies`, `company-embed`, `exclusive-boards`, `hiring-insights`, `onboarding-hiring`,
`hubs`, `channels`, `boosts`, `boost-checkout`, `verify`, `transcript-search`,
`bootstrap`, `search`

**T3 — HR / people (14):** `career360`, `career`, `people`, `people-strategy`,
`people-cadence`, `people-cost`, `people-engagement`, `performance`, `workforce`,
`profile-audit`, `profile`, `value-proposition`, `salary`, `outplacement`

**T4 — Canvas / Studio (14):** `studio`, `studio-features`, `studio-templates`,
`studio-dubbing`, `studio-socket`, `nle`, `games`, `game-agent`, `game-socket`,
`video-pitch`, `photoreal-avatar`, `youtube`, `embed-runtime`, `artifact-metrics`

**T5 — marketing / content / community (28):** `campaigns-public`, `admin-campaigns`,
`campaign-dollars`, `ads`, `advertising`, `paid-media`, `social`, `admin-social`,
`linkedin-post`, `articles`, `admin-articles`, `content-audiences`, `feed`,
`feed-features`, `admin-feed-features`, `featured-creators`, `creators`, `community`,
`community-resources`, `events`, `coffee`, `reviews`, `sentiment`, `og`, `sitemap`,
`locations`, `map`, `marketing`

**T6 — learning, monetization, comms, platform (79):** `courses`, `course-authoring`,
`course-checkout`, `admin-courses`, `learning`, `learning-paths`, `learning-goals`,
`learning-portability`, `xapi-lrs`, `lrs-credentials`, `lms-oauth`, `points`, `affiliates`,
`payouts`, `admin-payouts`, `tax-reporting`, `payment`, `billing`, `checkout`(via payment),
`partner`, `partner-account`, `partner-consent`, `admin-partners`, `whitelabel`, `passkeys`,
`password-management`, `auth`, `oauth`, `account`, `users`, `settings`, `workspaces`,
`apikeys`, `phone`, `messages`, `communication`, `inbox`, `notifications`, `email-integration`,
`email-preferences`, `calendar`, `bookings`, `followups`, `gigs`, `services`, `lists`,
`wishlist`(page), `tasks`/`task`, `activities`, `network`, `graph`, `help`, `legal`,
`security`, `adminSecurity`, `user-audit`, `role-access`, `admin-role-access`, `modules`,
`featureflag`, `meta`, `openapi`, `errors`, `reports`, `usage`, `admin-usage`, `tool-runs`,
`taxonomies`, `vendor-sync`, `dashboard`, `admin`, `admin-r2`, `admin-workers`,
`admin-templates-review`, `ai`, `ai-cost-reconciliation`, `mcp`, `chat-socket`,
`superadmin/{ai-vendors, audit, companies, extension, index, modules, points, security,
sessions, tool-usage, users}`, `pitch-decks`, `connect`(ConnectAuthorize)

**MAP (no port — Builderforce equivalent is authoritative):** `productivity` boards/tasks →
kanban; `integrations` → connector platform; `analytics` → `activity_log` + insights;
`chat-socket` → existing relay DO.

### 6.2 Frontend pages (137 top-level + 16 subdirectories) → track

| Page group | Count | Track |
|---|---|---|
| Résumé (`Resumes`, `ResumeDetail`, `ResumeUploadPage`, `ResumeRoast`, `ResumeReviewPage`, `ResumeTemplatesGallery`, `EmbeddedResume`, `SharedCandidateResume`, `PublicVideoResume`) | 9 | T1 |
| `pages/tools/*` (21 AI tools incl. `ResumeTailor`, `Career360`, `AIResumeScorer`, `JobResumeMatch`, `SkillExtractor`, `SalaryCalculator`, `CompAnalyzer`, `InterviewQuestions`, `ProfileAudit`, `ValueProposition`, `VideoPitchLab`, …) + `Tools`, `ToolDetail` | 23 | T1 (résumé/JD tools) · T3 (career/salary tools) |
| Jobs, companies, screening, interviews, references, take-home, sourcing, `pages/recruit/*`, `pages/recruiter/*`, `pages/services/*` (scorecards, screening templates, pitch decks, candidate detail, hiring onboarding) | ~40 | T2 |
| `AICoach`, `pages/people/*` (7: hub, roster, goals, 1:1s, TCO, team health, surface), `PeopleOperations`, `PersonaSelection`, `People`, `PeopleDetail`, `Outreach`, `WarmIntros` | ~15 | T3 |
| `pages/studio/*` (8 + `v2`), `EmbeddedStudioProject`, `PlayInvite`, `MarketplaceTemplatePreview` | ~12 | T4 |
| `pages/blog/*`, `pages/guides/*` (6), `pages/landing/*` (5), `pages/seo/*` (3), `pages/paid-media/*`, `Feed`, `PostDetail`, `Articles*`, `Events*`, `Companies`, `Competitors`, `SectorLanding`, `SectorsIndex`, `SitemapLocations`, `FeaturedCreators`, `Contributors` | ~30 | T5 |
| Auth (`Login`, `Signup`, `MagicLinkVerify`, `OAuthCallback`, `ForgotPassword`, `ResetPassword`, `VerifyEmail`, `ConfirmEmail`, `TwoFactorApprove`, `AcceptInvitation`, `ConnectAuthorize`), courses/learning (6), marketplace (2), bookings (3), `pages/admin/*` (31), `Settings`, `pages/settings/Connections`, `Points`, `Rewards`, `AffiliateDashboard`, `AffiliateProgram`, `Checkout`, `Pricing`, `Help`, legal (4), `Security`, `SecuritySessions`, `PhoneDashboard`, `GigMarketplace`, `GigCreatePage`, `GigDetail`, `ServiceInquiries`, `ServicesManagement`, `Wishlist`, `Tasks`, `Search`, `TranscriptSearch`, `PivotExplorer`, `Dashboard`, `Home`/`Index`, `NotFound` | ~85 | T6 |

### 6.3 Runtime infrastructure

| hired.video | Builderforce target | Track |
|---|---|---|
| DO `ChatRoom` | existing chat/steering relay DO | T2 |
| DO `StudioRoom` | `CollaborationRoom` (extend for canvas presence) | T4 |
| DO `GameSignalingRoom` | **new** DO — no equivalent | T4 |
| Browser workers `ffmpeg-encode`, `render-encode`, `animation-encode` | port as-is; they ARE the export pipeline | T4 |
| Background workers `recruiter-agent-followup`, `scorecard-sla-reminder`, `assessment-norms-recompute`, `job-body-cleanse`, `streak-at-risk-reminder` + `registry`/`runner` | `cronSweeps.ts`, each behind the KV work-gate (`cronWorkSignal.ts`) | T2/T6 |
| `frontend/functions/*` (Pages Functions: SSR/OG/sitemap for jobs, companies, resumes, people, courses, creators, events, articles, voice) | Next App Router edge routes + `opengraph-image`; **URL shapes must not change** | T5 |
| `wrangler.toml` bindings: `VIDEO_BUCKET` (R2), `KV_CACHE`, `AI`, cron `*/5` | R2 via `workspaceStore.ts`, KV via `getOrSetCached`, existing cron | T0 |
| `packages/sdk` (`@seanhogg/hired-video-sdk` — client, embed, react, errors) | see §6.6 exception 1 | Cutover |
| `hiredvideo-chrome-extension` (2 builds: jobseeker + recruiter) | repoint at `api.builderforce.ai`; store re-review | T2 |
| `outlook-plugin` (manifest + taskpane) | repoint; Microsoft add-in re-validation | T2 |
| `microsoft-identity-association.json`, `public/*`, `scripts/prerender.mjs` | domain-verification + prerender move with the redirect | Cutover |

### 6.4 Shared contracts (`shared/*.ts`, 90 modules)

All fold into Builderforce packages — **no `shared/` directory is created**:
- `resume.ts`, `resume-markdown.ts`, `tool-schemas.ts`, `job.ts`, `screening.ts`,
  `recruiter-pipeline.ts`, `scores.ts`, `skill-evidence.ts`, `seniority.ts`,
  `employment-types.ts`, `work-settings.ts`, `career360-types.ts`, `comp-analyzer.ts`,
  `people-ops.ts`, `assessments/`, `reviews/` → **new `packages/recruiting-contract`**
- `media-kinds.ts`, `timeline.ts`, `scene-types.ts`, `game-state.ts`, `game-blocks.ts`,
  `cad-state.ts`, `cad-3d-state.ts`, `image-state.ts`, `animation-state.ts`,
  `comic-spec.ts`, `interactive-comic-state.ts`, `world-3d-edit.ts`, `nle-*.ts`,
  `page-video-spec.ts`, `artifact-views.ts`, `course-*.ts` → **merge into
  `packages/creation-canvas-contract`**
- `ai-tools/`, `ai-prompts/`, `mcp/`, `ai-context-types.ts`, `feature-registry.ts`,
  `game-agent-tools.ts` → **`builtinMcpService.ts` CATALOG + prompt modules**
- `audiences*.ts`, `ad-targeting.ts`, `campaigns.ts`, `content-*.ts`, `social-*.ts`,
  `sector-*.ts`, `structured-data.ts`, `embed.ts` → **`campaignEngine.ts` + marketing lib**
- `billing.ts`, `pricing.ts`, `usage*.ts`, `tier-copy.ts`, `upgrade-slugs.ts`,
  `role-access.ts`, `user-roles.ts`, `settings.ts`, `validation.ts`, `errors/`,
  `security/`, `jurisdictions.ts`, `i18n.ts`, `slugify.ts` → **map onto
  `planFeatures.ts` / `featureGate.ts` / `lib/rbac.ts` / existing utils**

### 6.5 Explicitly out of scope (not hired.video)

- `C:\code\hired\energizelms` — a separate Vite LMS product with its own `package.json`;
  it is not imported by hired.video and is not covered by this port.
- `C:\code\hired\resumes\*` — sample résumé files (test fixtures / personal documents).
- `C:\code\hired\c:tmppartials.txt` — a stray artifact of a mis-quoted shell redirect.

### 6.6 Exceptions — decisions, not engineering

Every one of these is answerable; none blocks T0/T1 from starting.

1. **Third-party API-key / partner / whitelabel holders.** hired.video ships a public partner
   surface — `routes/apikeys.ts`, `partner.ts`, `partner-account.ts`, `partner-consent.ts`,
   `whitelabel.ts`, the published `@seanhogg/hired-video-sdk`, and `createEmbedToken`
   (15-minute embed URLs). Code can port all of it, and a compatibility shim can keep the SDK
   wire contract alive against Builderforce endpoints. **What engineering cannot decide is
   whether external partners exist and whether their contracts are migrated or terminated.**
   If none exist beyond Builderforce itself, delete the SDK and shim entirely at cutover.
2. **SEO equity on the public URL surface.** ~30 public page groups plus nine Pages-Functions
   SSR entities carry organic traffic. Slugs port 1:1 and 301s are authored as data — but the
   decision to consolidate `hired.video` domain authority into `builderforce.ai` rather than
   keep the domain serving is a marketing call.
3. **Neon tier.** ~360 net-new tables against the Free-tier budget.
4. **Store-published clients.** Two Chrome extensions and one Outlook add-in need re-review
   under the Builderforce publisher identity — a 1–3 week external lead time, so file early.

---

## 7 · Confirmation

With §6 complete: **yes — every hired.video capability lands inside Builderforce.ai.**
There is no functional area the port drops. Concretely:

- Every one of the 219 API route modules is assigned a track or marked MAP.
- Every one of the 137 top-level pages and 16 page subdirectories is assigned a track.
- All 428 tables are accounted for across T1–T6 (~60–70 MAP onto existing Builderforce
  tables; the rest port).
- All 3 Durable Objects, 7 background workers, 3 browser workers, both Chrome extensions and
  the Outlook add-in have a named destination.
- All 90 `shared/*` contract modules fold into Builderforce packages; no `shared/` directory
  is recreated.

The four items in §6.6 are business decisions (partner contracts, SEO consolidation, database
tier, store re-review), not missing functionality. hired.video ends as a redirect shell with
no running product behind it.
