# PRD 18 — hired.video → Builderforce.ai port

**Status:** Proposed · **Port audit:** 2026-08-11 · **Owner:** platform · **Created:** 2026-08-07
**Companion to:** [PRD 19 — burnrateos.com consolidation](./19-prd-burnrateos-consolidation.md)
**Goal:** absorb the whole of `C:\code\hired\hired.video` into Builderforce.ai so
`hired.video` traffic can be redirected at `builderforce.ai` with nothing lost, and so
**two new built-in agents — Recruiter and HR — own the recruiting and people work as
first-class Builderforce teammates.**

> **Read [PRD 19 §2](./19-prd-burnrateos-consolidation.md#2--capability-ownership-register--governs-prd-18-and-prd-19) before scheduling any track here.** hired.video and BurnRateOS
> collide with *each other* on twelve capabilities — affiliates, bookings, phone/VoIP, the
> campaign engine, the OKR store, people/HR, payouts, content, support and more. That register
> names one owner per capability and governs both PRDs. In several rows hired.video's
> implementation is the one that survives (payouts, tax reporting); in others it is dropped
> rather than ported (bookings, phone).

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

The Creation Canvas keeps its contract. **“Studio” is only the name of the hired.video source
folder; it does not survive as a Builderforce destination, page, panel, project type or product
area.** Each ported runtime mounts as the **editor body inside the existing Canvas** for a kind
that already exists, replacing the manifest-only placeholder:

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

For `video`, AI authoring and direct manipulation operate on the **same Canvas object and the
same persisted revision**. A person can prompt Brain to create or change a video, record their
screen or camera, import media, arrange scenes and clips, overlay music/voice/SFX, preview, and
export without opening another application surface. AI tool calls emit the same typed Canvas
operations as pointer/keyboard editing; they must not create a parallel “AI video” document or a
render-only manifest that cannot be edited afterward.

The continuous authoring loop is:

`prompt / capture / import → editable video object → timeline + scene + audio edits → preview → export / publish`

Every step returns to the editable object. Exported renditions are children of that object, not a
replacement for it.

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

**Non-destructive source invariant:** an uploaded résumé is an immutable source revision. “Create
me a new résumé” creates a derived résumé with `source_resume_id` and `source_revision_id`; it
never overwrites the uploaded source. The Canvas résumé header exposes **Original**, every named
derived version, **Compare**, **Restore as new version**, **Make active**, and **Promote to master**.
Canvas session history is useful recovery infrastructure but is not a substitute for this
résumé-domain lineage: the user must be able to return to the original without knowing when a
checkpoint was created or restoring unrelated Canvas objects.

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

> **Hard dependency on the navigation architecture.** Each runtime mounts as a **Canvas stage
> mode**, never as a page, panel, “Studio” destination or separately mounted editor. Slice 1 can
> land against today's canvas, but **Phase 4 of the navigation design (canvas hoisted into the
> shell behind active-canvas state) must land before slice 3**, or the hoist gets redone once per
> runtime. `/create/[id]` resolves the object's `mediaKind` to an editor body *inside* the
> already-mounted Canvas. Switching from a document to a video or from a comic to a CAD model is
> Canvas state, not navigation and not a remount.

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
- Components sourced from hired.video's `components/studio` are **leaf React** — they move nearly
  verbatim under `'use client'`; “Studio” is provenance only and is not used in Builderforce
  navigation or user-facing copy.
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
| `pages/studio/*` (8 + `v2`), `EmbeddedStudioProject`, `PlayInvite`, `MarketplaceTemplatePreview` | ~12 | T4 — source surfaces collapse into Canvas kinds and share/embed states; **no Studio destination is created** |
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

---

## 8 · Studio → Canvas UI/UX parity audit (2026-08-11)

This is the implementation-status register for the `/studio` port. Sections 0–7 describe the
target; this section records what a user can actually reach in Builderforce today. A matching
type, manifest entry, API client, or commented roadmap item does **not** count as ported.

### 8.1 Audit method, scope and status vocabulary

Source-of-truth surfaces inspected:

- Hired shell and editor: `pages/studio/StudioLanding.tsx`, `StudioWizard.tsx`,
  `v2/StudioEditorV2.tsx`, `components/studio/**`, `lib/studio/**`, and
  `shared/media-kinds.ts`.
- Hired résumé workflow: `ResumeUpload.tsx`, `resume-service.ts`,
  `types/resume-template.ts`, `resume-renderer/**`, `resume-sections/**`, and the document
  runtime under `components/studio/document/**`.
- Builderforce destination: `CreationCanvas.tsx`, `CreationNode.tsx`, `DocumentEditor.tsx`,
  `CanvasVideoEditor.tsx`, `creationObjectRegistry.ts`, `creationTemplates.ts`,
  `canvasFileImport.ts`, `canvasExports.ts`, and the creation-session API/history service.

| Status | Meaning |
|---|---|
| **PORTED** | User-reachable in the existing Canvas, persisted, and backed by a real implementation. |
| **PARTIAL** | Some behavior exists, but Hired parity or the end-to-end user journey is incomplete. |
| **DECLARED** | Kind/action/manifest exists, but the Hired editor/runtime is not mounted. |
| **MISSING** | No Builderforce user-facing implementation was found. |
| **REPLACE** | Hired behavior must use an existing Builderforce convention rather than be copied literally. |

**Audit result:** the Studio port is **not complete**. Builderforce already has a stronger generic
Canvas shell in several areas—Brain operations, session persistence, multiplayer presence,
object locks, undo/redo, checkpoints, branches/merge, fullscreen, file library, and generic
exports. It has a basic four-track video editor. The Hired résumé renderer, all 27 résumé-oriented
template assets, structured résumé lifecycle, and most kind-specific Studio runtimes are not
ported. The “every capability lands” statement in §7 is therefore a target-state confirmation,
not a claim about current implementation.

Numbered-row baseline (template-asset rows in §8.3 and catalog-family rows in §8.8 are additional):

| PORTED | PARTIAL | DECLARED | MISSING | REPLACE | Total numbered checks |
|---:|---:|---:|---:|---:|---:|
| 31 | 71 | 17 | 185 | 10 | **314** |

The source itself also contains explicit scaffolds and deferrals. Examples include document export
still throwing from `export-facade.ts`, the `DocumentStage` note that two-column/sidebar editing is
still to land, Phase-1 CAD scaffolding, and unwired Wav2Lip/OpenVoice providers. This register
inventories the discoverable Studio UX and contracts because they are the port target, but a port
must not blindly preserve a source placeholder. Where Hired is incomplete, Builderforce either
finishes the behavior against the acceptance gate here or records a product-approved removal.

### 8.2 Required résumé user journey — release blocker

| ID | User-visible behavior | Hired evidence | Builderforce evidence / current result | Status | Done when |
|---|---|---|---|---|---|
| R-001 | Drop or choose a résumé file | `ResumeUpload.tsx` dropzone and picker | `CanvasResumeEditor` has a résumé-specific empty state, picker and accepted-format guidance | **PORTED** | A résumé-specific empty state and picker exist inside the `resume` object. |
| R-002 | Accept PDF | Hired parses PDF server-side | `canvasFileImport.ts` extracts PDF text | **PARTIAL** | Import produces structured résumé data and preserves the source file. |
| R-003 | Accept DOC/DOCX | Hired accepts `.doc`/`.docx` | Builderforce reads DOCX; legacy DOC is attachment-only | **PARTIAL** | DOC and DOCX both parse into the canonical résumé schema. |
| R-004 | Accept image/photo scans | Hired accepts JPG/PNG and vision OCR | Canvas imports the image as an Image object | **MISSING** | OCR produces a reviewable structured résumé and keeps the scan. |
| R-005 | Accept Markdown/TXT | Hired parses both | Résumé picker routes Markdown/TXT through `canvasFileImport` and stores the result in the résumé family | **PORTED** | Import recognizes résumé intent and creates a `resume`, not only `document`. |
| R-006 | Accept JSON Resume without flattening | `parseJsonResumeFile` preserves structure | Résumé picker maps basics, work, education and skills into editable Markdown; lossless canonical JSON retention remains | **PARTIAL** | JSON Resume fields round-trip losslessly. |
| R-007 | Validate file type and show an actionable error | Hired names accepted formats | Résumé picker restricts formats and gives a localized unreadable-file error; format-specific recovery copy remains | **PARTIAL** | Resume object gives localized, format-specific errors. |
| R-008 | Show selected filename, size and type icon | Hired upload review card | Generic file objects show file metadata | **PARTIAL** | Resume import review shows this before mutation. |
| R-009 | Show parse/upload progress | Hired progress bar | No résumé parse progress state | **MISSING** | Upload, extraction, OCR and structuring phases are visible and retryable. |
| R-010 | Auto-name from embedded JSON title or filename | Hired does both | Generic imports use filename | **PARTIAL** | Structured résumé name wins, filename is fallback. |
| R-011 | Choose public/private privacy at creation | Hired resume privacy | Canvas sharing is session-wide | **MISSING** | Résumé artifact privacy is independently persisted. |
| R-012 | Mark first résumé as master automatically | Hired service promotes first upload | `createResumeFamily` makes the imported source both active and master | **PORTED** | First source is master; later imports do not silently replace it. |
| R-013 | Import into an existing résumé with confirmation | Hired `targetResumeId` overwrite flow | Generic document editing mutates in place | **MISSING** | Confirmation snapshots current résumé, then imports into a new version. |
| R-014 | Preserve a named pre-import version | Hired creates “Before résumé import” | Canvas has session snapshots, not résumé versions | **PARTIAL** | A résumé-domain version is created automatically before replacement. |
| R-015 | Keep uploaded original immutable | Required product invariant | `updateActiveResume` rejects original mutation and the editor disables original editing/template changes | **PORTED** | Original source/revision cannot be overwritten or deleted while derivatives exist. |
| R-016 | Ask Brain/Recruiter “create me a new résumé” | Hired resume editor tools | `resume` kind advertises `generate`; generic creative compose runs | **DECLARED** | Recruiter creates a structured derived résumé on the same Canvas. |
| R-017 | Derive from original without replacing it | Hired parent/variation APIs | Canvas résumé family persists original, active and source revision IDs; new versions default to the original | **PORTED** | Derived résumé stores source résumé + exact source revision IDs. |
| R-018 | Name and rename a derived résumé | Hired variation title | Canvas object title is editable | **PARTIAL** | Rename persists on the résumé artifact and its version list. |
| R-019 | See Original and all derived résumés together | Hired master résumé groups | Canvas résumé header lists every family revision, with Original labeled and master marked | **PORTED** | Canvas resume header lists lineage with Original pinned first. |
| R-020 | Switch back to Original in one action | Hired master/variant model | Revision selector changes only the active rendition and synchronizes exported `markdown`/`content` | **PORTED** | “Original” switches the active rendition without changing other Canvas state. |
| R-021 | Compare original vs generated résumé | Hired merge analysis/preview APIs | Compare mode renders original and selected version side by side; structured field/bullet diff remains | **PARTIAL** | Side-by-side and field/bullet diff use the canonical résumé schema. |
| R-022 | Restore an old résumé version without destroying head | Hired version restore | “Restore as new” derives a new head from the selected revision and retains all prior revisions | **PORTED** | Restore creates a new résumé head version and preserves both states. |
| R-023 | Promote a variant to master | Hired `promoteVariantToMaster` | Canvas exposes “Make master” and persists master/active IDs; confirmation and audit event remain | **PARTIAL** | Promotion is explicit, confirmed, atomic and audited. |
| R-024 | Detach a variant from its parent | Hired `detachFromParent` | No résumé lineage model | **MISSING** | User can copy a variant into an independent résumé. |
| R-025 | Clone a résumé | Hired `cloneResume` | Canvas duplicates generic objects | **PARTIAL** | Clone includes structured content, template and metadata with a new identity. |
| R-026 | Archive/unarchive a résumé | Hired archive APIs | No artifact-level résumé archive | **MISSING** | Archive hides without deleting; family and versions remain recoverable. |
| R-027 | Delete with lineage-aware confirmation | Hired delete/promote tests | Generic object delete has undo, but no lineage rules | **PARTIAL** | Deletion explains descendants and protects the last original/master. |
| R-028 | Make a résumé active | Hired `setActiveResume` | Active revision persists in the Canvas object and drives preview/export content; workspace-level application default remains | **PARTIAL** | Active résumé persists per user/workspace and drives downstream applications. |
| R-029 | Watch/unwatch a résumé | Hired watch APIs | No résumé watch control | **MISSING** | Watch state and notifications port or are explicitly removed by product decision. |
| R-030 | Merge one résumé into another | Hired analyze, preview, execute merge | Generic branch merge is object-level | **MISSING** | Field-level merge preview supports choose-source and undo. |
| R-031 | Consolidate duplicate bullets | Hired consolidate API | No résumé-specific action | **MISSING** | Recruiter suggests, previews and applies bullet consolidation. |
| R-032 | Parse and structure contact basics | Hired canonical resume schema | Imported docs remain Markdown | **MISSING** | Name, label, email, phone, location, URLs and summary are typed fields. |
| R-033 | Edit work experience | Hired `SectionEditor` | Generic rich-text document editor only | **MISSING** | Add/edit/remove/reorder jobs, dates and highlights. |
| R-034 | Edit education | Hired `SectionEditor` | Generic rich text only | **MISSING** | Add/edit/remove/reorder institutions, study, dates and score. |
| R-035 | Edit volunteer experience | Hired renderer/section schema | None | **MISSING** | Structured volunteer entries render and export. |
| R-036 | Edit skills | Hired renderer/section schema | None | **MISSING** | Structured skills can be grouped and reordered. |
| R-037 | Edit languages | Hired renderer/section schema | None | **MISSING** | Language and fluency fields render and export. |
| R-038 | Edit projects and media | Hired renderer supports project media | None | **MISSING** | Structured projects support URL, role, dates, highlights and media. |
| R-039 | Edit awards, certificates and publications | Hired renderer/section schema | None | **MISSING** | Each section has structured CRUD and ordering. |
| R-040 | Edit interests and references | Hired renderer/section schema | None | **MISSING** | Each section has structured CRUD and privacy-safe export behavior. |
| R-041 | Reorder sections | Hired sortable sections and document blocks | Generic object ordering only | **MISSING** | Drag and keyboard reorder persist per résumé/template. |
| R-042 | Collapse/expand sections while editing | Hired collapse context | None | **MISSING** | Collapse is view preference and does not alter export. |
| R-043 | Hide/show sections | Template descriptor `enabled` | None | **MISSING** | Visibility toggles persist without deleting content. |
| R-044 | Inline edit and double-click text | Hired `DocumentStage` | `DocumentEditor` supports rich-text body editing | **PARTIAL** | Typed résumé fields and free text both edit in place. |
| R-045 | AI rewrite selected content | Hired AI Rewrite action | Brain can propose generic object updates | **PARTIAL** | Selection-scoped rewrite previews a résumé-field patch. |
| R-046 | AI create a hook/summary | Hired AI Hook action | Generic Brain prompt only | **PARTIAL** | Dedicated action targets summary/headline and is reversible. |
| R-047 | ATS/job-tailor workflow | Hired match/tailor handlers | Not natively ported | **MISSING** | JD + source résumé returns scored, editable derivative with cited changes. |
| R-048 | Export PDF | Hired WYSIWYG browser-print renderer | Resume advertises PDF; generic print path exists | **PARTIAL** | Export uses the exact selected résumé template and pagination. |
| R-049 | Export DOCX | Hired service/export path | Builderforce offers DOCX from Markdown | **PARTIAL** | DOCX preserves résumé hierarchy, links, sections and selected design semantics. |
| R-050 | Export HTML/Markdown/copy | Hired has export/download helpers | Builderforce exposes all four | **PORTED** | Keep existing Canvas implementation; feed it canonical résumé content. |
| R-051 | Public share URL/slug | Hired public résumé and slug validation | Canvas shares sessions, not résumé public views | **MISSING** | Résumé-specific public view has stable slug, privacy and revocation. |
| R-052 | Embedded résumé view | Hired embed endpoint | No résumé embed surface | **MISSING** | Tokenized embed uses the same renderer and privacy policy. |
| R-053 | Review sessions, pins and comments | Hired review sidebar/annotation layer | Canvas collaboration exists, no résumé text anchors | **PARTIAL** | Comments anchor to résumé fields/text and survive edits. |
| R-054 | Version history dialog | Hired entity version history | Canvas session history is user-reachable | **PARTIAL** | Dialog filters to the résumé and distinguishes source, AI, import and manual versions. |
| R-055 | Autosave and visible save status | Hired server autosave indicator | Canvas autosaves and shows state | **PORTED** | Keep Canvas persistence; include structured résumé payload. |
| R-056 | Offline/retry safety | Hired save pipeline | Canvas shows offline/reconnecting and retains local state | **PORTED** | Resume mutations use the same persistence queue. |

### 8.3 Résumé template and renderer inventory

Hired contains **12 document résumé designs** in `types/resume-template.ts`. Each descriptor
controls document mode, theme, font, heading style, density, card style, title sizing, one/two
columns, sidebar placement, hero/avatar/contact/summary/video visibility, section order, section
layout, and optional media/highlights. Builderforce now registers all 12 IDs with a first-pass
declarative Canvas renderer (mode, columns, palette, font and density); the remaining descriptor
fields and print-parity work stay explicitly partial below.

| Template ID | Hired design behavior | Builderforce status |
|---|---|---|
| `hired-default` | Hired Purple hero; split layout; avatar, contacts, summary, video; career timeline | **PARTIAL** — ID, hero mode, purple palette, font/density and live selection render; split hero entities remain |
| `payroll-iron-gray` | Finance; serif; compact two-column; skills/education/credentials sidebar | **PARTIAL** — ID, serif/compact/two-column palette render; section assignment remains |
| `risk-asphalt` | Consulting; sans; caps; two-column credential sidebar | **PARTIAL** — ID, sans/two-column palette render; credential sidebar semantics remain |
| `executive-taupe` | Executive; serif; spacious one-column divider layout | **PARTIAL** — ID, serif/spacious/taupe presentation render; descriptor-perfect dividers remain |
| `intern-education-first` | New-grad; education first; projects/skills emphasis | **PARTIAL** — ID and visual presentation render; canonical section ordering remains |
| `hospitality-amber` | Hospitality; warm amber; caps; one column | **PARTIAL** — ID, amber palette and one-column presentation render; heading descriptor remains |
| `creative-minimal` | Minimal slate; mono; spacious plain headings | **PARTIAL** — ID, mono/spacious presentation render; exact heading rules remain |
| `software-engineer-graphite` | Developer graphite; mono; two-column skills/projects sidebar | **PARTIAL** — ID, mono/two-column presentation render; skills/project routing remains |
| `healthcare-clinical-blue` | Clinical blue; compact two-column credentials sidebar | **PARTIAL** — ID, clinical palette/compact/two-column presentation render; credentials routing remains |
| `sales-growth-emerald` | Sales; emerald; achievement-led caps headings | **PARTIAL** — ID, emerald palette and presentation render; achievement ordering remains |
| `actor-headshot-hero` | Headshot/video hero; credits first; special skills/dialects/representation | **PARTIAL** — ID and hero presentation render; headshot/video and canonical credits remain |
| `director-filmography-serif` | Filmography/festivals/press first; spacious serif print design | **PARTIAL** — ID, serif/spacious print presentation render; filmography ordering remains |

The separate Hired data bundle contains **15 video-résumé compositions**. All are absent from
Builderforce; the generic `video` node and timeline do not load these scene/theme definitions.

| Template asset | Intended résumé story | Builderforce status |
|---|---|---|
| `video-resume-professional` | General professional introduction, achievements, skills and close | **MISSING** |
| `video-resume-minimal` | Minimal visual résumé | **MISSING** |
| `video-resume-candidate-intro` | Candidate introduction | **MISSING** |
| `video-resume-hook-led` | Hook-first pitch | **MISSING** |
| `video-resume-story-led` | Narrative/story-first pitch | **MISSING** |
| `video-resume-pivot-led` | Career-pivot narrative | **MISSING** |
| `video-resume-gig-rapid-deploy` | Gig/rapid-availability pitch | **MISSING** |
| `video-resume-campaign-staff` | Political/campaign staff pitch | **MISSING** |
| `video-resume-government-clearance` | Government-cleared candidate | **MISSING** |
| `video-resume-security-cleared` | Security-cleared candidate | **MISSING** |
| `video-resume-law-enforcement` | Law-enforcement candidate | **MISSING** |
| `video-resume-legal-bar` | Legal/bar-qualified candidate | **MISSING** |
| `video-resume-medical-credentialed` | Medical/credentialed candidate | **MISSING** |
| `video-resume-trade-licensed` | Licensed-trade candidate | **MISSING** |
| `video-resume-beauty-portfolio` | Beauty/portfolio candidate | **MISSING** |

Renderer parity is independently required; copying IDs is not completion.

| ID | Renderer/editor capability | Current status | Acceptance evidence |
|---|---|---|---|
| RR-001 | One canonical renderer for edit preview, public view and PDF | **MISSING** | Snapshot tests prove identical descriptor/content input across all surfaces. |
| RR-002 | Hero and print document modes | **PARTIAL** | Both modes render all 12 descriptors. |
| RR-003 | Letter, Legal and A4 page sizes | **MISSING** | Preview and exported PDF dimensions match. |
| RR-004 | Portrait and landscape orientation | **MISSING** | Toggle persists and export matches. |
| RR-005 | One- and two-column/sidebar layouts | **PARTIAL** | Sidebar assignment is visible in preview and PDF. |
| RR-006 | Page-break guides and page numbers | **MISSING** | True-size editor displays computed boundaries. |
| RR-007 | Continuous and paged/spread view modes | **MISSING** | Toggle changes only editor presentation, not content. |
| RR-008 | Zoom control bound to the document sheet | **MISSING** | Zoom persists as a view preference and never affects print dimensions. |
| RR-009 | Move blocks up/down | **MISSING** | Buttons and keyboard action update persisted order. |
| RR-010 | Drag blocks from palette and reorder in flow | **MISSING** | Drop indicator and keyboard alternative are tested. |
| RR-011 | Detach block to free position / return to flow | **MISSING** | Round-trip retains content and coordinates. |
| RR-012 | Delete block with undo | **MISSING** | Canvas undo restores block and typed data. |
| RR-013 | Add text, heading, divider and entity-section blocks | **MISSING** | Palette is entity-aware and prevents duplicate singleton sections. |
| RR-014 | Empty-section state without fake content | **MISSING** | Empty sections remain editable and omit themselves from export when hidden. |
| RR-015 | Apply template to live document | **PORTED** | Content survives every template switch. |
| RR-016 | Set current template as résumé default | **MISSING** | Default persists on the résumé and opens everywhere. |
| RR-017 | Template gallery thumbnails and selected/default states | **MISSING** | All 12 render real thumbnails with accessible selection. |
| RR-018 | Template JSON validation/version compatibility | **MISSING** | Invalid descriptors fail safely; v1.0–v1.2 fixtures migrate. |
| RR-019 | Theme palette, font family, heading style and density | **PARTIAL** | Every descriptor field visibly affects preview and export. |
| RR-020 | Avatar, contact buttons, summary and video hero controls | **MISSING** | Each flag is independently test-covered. |
| RR-021 | Section layouts: timeline, grid, cards and list | **MISSING** | Canonical fixtures cover every layout. |
| RR-022 | Date sorting and highlights/media flags | **MISSING** | Order and optional detail match renderer rules. |
| RR-023 | Print/PDF from preview overlay | **PARTIAL** | Existing PDF action invokes the canonical résumé renderer, not Markdown print. |
| RR-024 | Escape/close preview and responsive preview chrome | **MISSING** | Keyboard and 360px tests pass. |

### 8.4 Studio landing, template discovery and project chrome

| ID | Hired UI/UX feature | Builderforce mapping | Status |
|---|---|---|---|
| S-001 | One landing workspace for signed-in and anonymous visitors | Creation Canvas supports local and server sessions | **PORTED** |
| S-002 | Create a real persisted draft before entering editor | Server Canvas sessions persist; guests use local state | **PORTED** |
| S-003 | Anonymous work survives sign-in | `ResumeWorkBridge`/session adoption behavior | **PORTED** |
| S-004 | New-project split button | Object palette + create actions | **REPLACE** |
| S-005 | Guided creation wizard | Canvas prompt starters/templates exist; no media-kind Studio wizard | **PARTIAL** |
| S-006 | Template catalog with thumbnails | Builderforce has 11 Canvas packs, not Hired catalog | **PARTIAL** |
| S-007 | Filter templates by category | Canvas palette groups templates but lacks Hired filters | **PARTIAL** |
| S-008 | Filter templates by media kind | No equivalent catalog filter | **MISSING** |
| S-009 | Search templates | No equivalent in Canvas template picker | **MISSING** |
| S-010 | Audience/profession template discovery | No Canvas equivalent | **MISSING** |
| S-011 | Deep-link directly to template/content type/capture/subject | Canvas can deep-link to sessions; Studio seed params absent | **MISSING** |
| S-012 | Owned/purchased/creator templates | Canvas server templates exist; commerce/ownership states differ | **PARTIAL** |
| S-013 | First-party badge and creator attribution | No Hired template metadata UI | **MISSING** |
| S-014 | Template preview/details/related templates | No Hired catalog detail flow | **MISSING** |
| S-015 | Apply template with source résumé selection | No résumé template flow | **MISSING** |
| S-016 | Recent projects grid | Canvas session list exists outside this runtime | **REPLACE** |
| S-017 | Project thumbnail per runtime | Generic previews exist; Hired runtime thumbnails absent | **PARTIAL** |
| S-018 | Media-kind badge | Canvas object labels kinds | **PORTED** |
| S-019 | Project status and visibility chips | Canvas save/realtime state exists; artifact visibility absent | **PARTIAL** |
| S-020 | Rename project inline | Canvas title is inline editable | **PORTED** |
| S-021 | Clone project | Canvas can duplicate object/branch session | **REPLACE** |
| S-022 | Delete project with confirmation | Canvas deletion/undo exists; session deletion is separate | **PARTIAL** |
| S-023 | Project details sheet | Canvas inspector supplies object details | **REPLACE** |
| S-024 | Workspace switcher | Builderforce workspace shell owns this | **REPLACE** |
| S-025 | Autosave indicator | Canvas shows saved/offline/reconnecting state | **PORTED** |
| S-026 | Collaborator presence bar | Canvas has avatars, typing, cursor/viewport follow | **PORTED** |
| S-027 | Invite/share with roles | Canvas share menu supports invitations/roles | **PORTED** |
| S-028 | Object edit locks | Canvas creation-session locks exist | **PORTED** |
| S-029 | Public share link and editor link | Canvas share link exists; artifact public URLs vary | **PARTIAL** |
| S-030 | Published-destination list and republish | No unified creative publication history | **MISSING** |
| S-031 | Version-history dialog | Canvas history/checkpoints are user-reachable | **PORTED** |
| S-032 | Named checkpoint | Canvas supports named checkpoints | **PORTED** |
| S-033 | Branch and reviewed merge | Canvas supports both | **PORTED** |
| S-034 | Undo/redo toolbar and shortcuts | Canvas supports both | **PORTED** |
| S-035 | Copy/cut/paste/duplicate/delete shortcuts | Canvas supports selection clipboard/delete; parity varies by object | **PARTIAL** |
| S-036 | Fullscreen/presentation mode | Canvas has fullscreen and present mode | **PORTED** |
| S-037 | Light, dark and mobile layouts | Canvas has responsive/theme work; runtime-specific parity unverified | **PARTIAL** |
| S-038 | Localized user-visible copy | Canvas uses next-intl, but some existing creation code remains hard-coded | **PARTIAL** |

### 8.5 Shared editor chrome and direct-manipulation inventory

| ID | Hired Studio control | Builderforce evidence / current result | Status |
|---|---|---|---|
| E-001 | Left tabs for Widgets, Design and Actions | — | **MISSING** |
| E-002 | Collapsible/resizable left and right panels | — | **MISSING** |
| E-003 | Runtime router by `mediaKind` | Kinds exist but most use a generic card | **DECLARED** |
| E-004 | Scene/unit/page rail with select/add/duplicate/delete/reorder | Basic video timeline has clips, not Hired rails | **MISSING** |
| E-005 | Central stage with runtime aspect ratio | Basic video preview only | **PARTIAL** |
| E-006 | Select widget by click or layers panel | — | **MISSING** |
| E-007 | Multi-selection/marquee | Canvas selects multiple top-level objects, not runtime widgets | **PARTIAL** |
| E-008 | Drag, resize and rotate transform handles | Top-level Canvas drag/resize exists; runtime widget transform absent | **PARTIAL** |
| E-009 | Position presets | — | **MISSING** |
| E-010 | Layer panel with ordering and visibility | — | **MISSING** |
| E-011 | Canvas/stage zoom control | Top-level Canvas zoom exists; runtime-stage zoom absent | **PARTIAL** |
| E-012 | Safe-zone overlay preference | — | **MISSING** |
| E-013 | Canvas background color/image | Basic video background color is stored, no UI parity | **PARTIAL** |
| E-014 | Preview play/pause/restart/scrub | Basic video play/pause/scrub exists | **PARTIAL** |
| E-015 | Preview overlay separate from editor chrome | — | **MISSING** |
| E-016 | Keyboard actions suppressed while typing | Canvas handles shortcuts; parity needs focused tests | **PARTIAL** |
| E-017 | Text widget | — | **MISSING** |
| E-018 | Heading widget | — | **MISSING** |
| E-019 | Rectangle and circle widgets | — | **MISSING** |
| E-020 | Divider widget | — | **MISSING** |
| E-021 | Image widget | Generic Image object exists, not a compositing widget | **DECLARED** |
| E-022 | Video widget | Basic video sources/clips exist, not positioned widgets | **PARTIAL** |
| E-023 | Webcam widget | Camera recording becomes a clip | **PARTIAL** |
| E-024 | Chart widget | Canvas Chart object exists, not a Studio widget | **REPLACE** |
| E-025 | Chips widget | — | **MISSING** |
| E-026 | CTA widget with linked entity | — | **MISSING** |
| E-027 | Speech-bubble widget | — | **MISSING** |
| E-028 | Caption-box widget | — | **MISSING** |
| E-029 | SFX-burst widget | — | **MISSING** |
| E-030 | AI avatar/presenter widget | — | **MISSING** |
| E-031 | Linked résumé/job/profile/company/article/video widgets | Canvas connections exist; inline Studio bodies absent | **PARTIAL** |
| E-032 | Engagement asset widgets: form/chapter/thumbnail/review pin | — | **MISSING** |
| E-033 | Widget X/Y/width/height/rotation inspector | Top-level object layout exists; widget inspector absent | **PARTIAL** |
| E-034 | Container background/border/radius/width/padding | — | **MISSING** |
| E-035 | Enter/exit motion preset, duration and easing | — | **MISSING** |
| E-036 | Widget in/out timing | Clip timing exists; positioned widget timing absent | **PARTIAL** |
| E-037 | Widget visual effects and filters | — | **MISSING** |
| E-038 | Text font/size/weight/color/alignment/background | Document rich text has inline marks, not this inspector | **PARTIAL** |
| E-039 | Image source/fit/alt text | Generic image metadata only | **PARTIAL** |
| E-040 | Video source/chroma key/threshold/softness/spill | — | **MISSING** |
| E-041 | Shape fill/stroke/width/corner radius | — | **MISSING** |
| E-042 | Chart type/data/format/title/takeaway/series colors | Canvas Chart object covers some fields | **PARTIAL** |
| E-043 | CTA text, URL, entity link and colors/fonts | — | **MISSING** |
| E-044 | Avatar portrait/script/TTS/voice/speed | Voice object exists; avatar editor absent | **DECLARED** |
| E-045 | Subject seed banner and link/unlink subject | — | **MISSING** |
| E-046 | Drag/drop protocol for palette/media/linked assets | Top-level file/object drop exists; runtime protocol absent | **PARTIAL** |
| E-047 | Brain edits same persisted artifact as pointer edits | Canvas proposed changes mutate canonical object data | **PORTED** |
| E-048 | AI selection chip scopes generation to selection | Canvas Brain scopes to Canvas/selection/connected/frame | **REPLACE** |

### 8.6 Recording, media, AI, engagement and advisory actions

| ID | Hired action | Builderforce evidence / current result | Status |
|---|---|---|---|
| A-001 | Import image/video into source bin | Video imports visual media directly; no source bin | **PARTIAL** |
| A-002 | Import audio into source bin | Audio imports directly to Music track | **PARTIAL** |
| A-003 | Stock-media search/picker | — | **MISSING** |
| A-004 | AI image generation and placement | Generic creative generation exists; placement in Studio stage absent | **PARTIAL** |
| A-005 | AI headshot generation | — | **MISSING** |
| A-006 | Screenshot capture → image widget | — | **MISSING** |
| A-007 | Webcam recording | Basic Canvas video editor records camera | **PORTED** |
| A-008 | Screen recording | Basic Canvas video editor records screen | **PORTED** |
| A-009 | Screen + picture-in-picture recording | — | **MISSING** |
| A-010 | Recording as overlay or new full-bleed scene | Capture becomes a clip; user cannot choose both modes | **PARTIAL** |
| A-011 | Deep-link/shortcut opens recorder | — | **MISSING** |
| A-012 | Voiceover record/upload/generate | Audio import exists; dedicated voiceover workflow absent | **PARTIAL** |
| A-013 | Original/procedural music composer | — | **MISSING** |
| A-014 | Music catalog | — | **MISSING** |
| A-015 | Master/track/layer audio mixer and mute | Per-clip volume exists; mixer absent | **PARTIAL** |
| A-016 | Audio ducking | — | **MISSING** |
| A-017 | Generate/edit captions | — | **MISSING** |
| A-018 | Caption styles/position and burn-in | — | **MISSING** |
| A-019 | Chapter markers | — | **MISSING** |
| A-020 | Multi-language dubbing | — | **MISSING** |
| A-021 | Accessibility/WCAG advisory | — | **MISSING** |
| A-022 | AI rewrite selected text | Generic Brain update only | **PARTIAL** |
| A-023 | AI hook generation | Generic Brain prompt only | **PARTIAL** |
| A-024 | Review comments pinned to playback time | — | **MISSING** |
| A-025 | Video forms/lead capture | — | **MISSING** |
| A-026 | Thumbnail generator/stamp asset | — | **MISSING** |
| A-027 | Delivery coach | — | **MISSING** |
| A-028 | Video analytics dashboard | — | **MISSING** |
| A-029 | ATS package generator | — | **MISSING** |
| A-030 | Async interview manager | — | **MISSING** |
| A-031 | Custom banner generator | — | **MISSING** |
| A-032 | Brand kits and remove-branding entitlement | — | **MISSING** |
| A-033 | Voice clone manager | API voice-clone code exists; no Canvas UI | **PARTIAL** |
| A-034 | Attach media to course lesson | Course object exists; Studio attach flow absent | **MISSING** |
| A-035 | Page embed management | Generic website/embed capabilities differ | **MISSING** |

### 8.7 Runtime-by-runtime parity

#### Video, podcast and voice

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| V-001 | Visual, music, voiceover and SFX tracks | Four tracks exist | **PORTED** |
| V-002 | Add image/video/audio files | Supported | **PORTED** |
| V-003 | Clip start, length and trim-start | Supported | **PORTED** |
| V-004 | Per-audio-clip volume | Supported | **PORTED** |
| V-005 | Remove clip | Supported | **PORTED** |
| V-006 | Live composited preview and scrubber | Basic composition supported | **PORTED** |
| V-007 | NLE drag/reorder/ripple editing | Numeric fields only | **MISSING** |
| V-008 | Split audio/video at playhead | — | **MISSING** |
| V-009 | Multiple scenes and scene transitions | — | **MISSING** |
| V-010 | Clip/window crop and positioned overlays | — | **MISSING** |
| V-011 | Multicam/layout presets | — | **MISSING** |
| V-012 | Motion presets and scene effects | — | **MISSING** |
| V-013 | Video filters/chroma key | — | **MISSING** |
| V-014 | Captions, chapters and teleprompter | — | **MISSING** |
| V-015 | Video generation returns editable frames/clips | Generated frames become editable visual clips | **PORTED** |
| V-016 | Export real composed video | Browser renderer exists | **PORTED** |
| V-017 | H.264 MP4 | Canvas renderer output is implementation-dependent, not profile-selected | **PARTIAL** |
| V-018 | H.265, ProRes, DNxHD and VP9 profiles | — | **MISSING** |
| V-019 | Podcast MP3/M4A/Opus/WAV/video profiles | Podcast kind is a generic creative card | **DECLARED** |
| V-020 | Voice MP3/WAV/Opus profiles | Voice is a waveform placeholder | **DECLARED** |
| V-021 | YouTube publish | — | **MISSING** |
| V-022 | LinkedIn publish | — | **MISSING** |
| V-023 | Profile publish/public playback | — | **MISSING** |
| V-024 | RSS/Apple Podcasts/Spotify destinations | — | **MISSING** |

#### Image/drawing

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| I-001 | Raster stage with true document dimensions | — | **DECLARED** |
| I-002 | Brush, eraser, fill, eyedropper and marquee tools | — | **MISSING** |
| I-003 | Text, vector and raster layers | — | **MISSING** |
| I-004 | Add/delete/select/rename/reorder layers | — | **MISSING** |
| I-005 | Layer visibility, opacity and blend mode | — | **MISSING** |
| I-006 | Layer filters and transforms | — | **MISSING** |
| I-007 | Marquee delete/fill/inpaint | — | **MISSING** |
| I-008 | AI generate/inpaint/outpaint selected area | Generic image generation only | **PARTIAL** |
| I-009 | Recent colors and brush settings | — | **MISSING** |
| I-010 | Floating layers and tool palette | — | **MISSING** |
| I-011 | PSD import/export with layers | — | **MISSING** |
| I-012 | Spill large layers to R2 | — | **MISSING** |
| I-013 | Save flattened image to asset library | Generic file/deliverable library exists | **PARTIAL** |
| I-014 | PNG/JPEG/WebP export | Generic creative output may produce image, no editor export profiles | **PARTIAL** |
| I-015 | Profile gallery/asset library publish | — | **MISSING** |

#### Animation

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| AN-001 | Frame stage and frames rail | — | **DECLARED** |
| AN-002 | Add/duplicate/delete/reorder frames | — | **MISSING** |
| AN-003 | Frame duration and loop playback | — | **MISSING** |
| AN-004 | AI-generated frame insertion | Generic animation generation only | **PARTIAL** |
| AN-005 | GIF, animated WebP and APNG export | — | **MISSING** |
| AN-006 | Transparent MP4 export | — | **MISSING** |
| AN-007 | Giphy, Tenor and hosted-CDN publish | — | **MISSING** |

#### Games

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| G-001 | 2D playable game stage | Game card shows authored summary, not runtime | **DECLARED** |
| G-002 | 3D world stage | — | **DECLARED** |
| G-003 | Play/edit mode | — | **MISSING** |
| G-004 | Level rail with add/duplicate/delete/reorder | — | **MISSING** |
| G-005 | Sprite library/palette and asset cache | — | **MISSING** |
| G-006 | Entity palette and 3D properties | — | **MISSING** |
| G-007 | Physics/colliders | — | **MISSING** |
| G-008 | Visual block vocabulary/interpreter | — | **MISSING** |
| G-009 | Script editing and runtime | — | **MISSING** |
| G-010 | Game AI-agent behaviors | — | **MISSING** |
| G-011 | Challenges panel | — | **MISSING** |
| G-012 | Multiplayer room/invite | Canvas collaboration exists, game room absent | **PARTIAL** |
| G-013 | Roblox Luau export | — | **MISSING** |
| G-014 | HTML5 ZIP and web-embed export | — | **MISSING** |
| G-015 | itch.io/GitHub Pages publish | — | **MISSING** |

#### Comics

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| C-001 | Comic page/panel authoring stage | — | **DECLARED** |
| C-002 | Linear and interactive/branching comic state | — | **MISSING** |
| C-003 | Speech bubble, caption and SFX widgets | — | **MISSING** |
| C-004 | Page reader with branch choices | — | **MISSING** |
| C-005 | AI comic/page builder | Generic creative generation only | **PARTIAL** |
| C-006 | PNG strip export | — | **MISSING** |
| C-007 | Paginated PDF export | Generic Comic PDF action exists, no comic renderer | **DECLARED** |
| C-008 | CBZ export | — | **MISSING** |
| C-009 | Motion comic MP4/GIF | — | **MISSING** |
| C-010 | Reader/Webtoon/Tapas publish | — | **MISSING** |

#### CAD and 3D

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| D-001 | 2D CAD stage | — | **DECLARED** |
| D-002 | CAD layer panel | — | **MISSING** |
| D-003 | Select/draw/edit vector entities | — | **MISSING** |
| D-004 | Floor-plan/part/electrical/blueprint seeds | — | **MISSING** |
| D-005 | SVG export | Generic CAD SVG action exists, no authored geometry | **DECLARED** |
| D-006 | PDF/PNG export | Generic CAD PDF action exists, no authored geometry | **DECLARED** |
| D-007 | DXF export | — | **MISSING** |
| D-008 | 3D model stage with orbit controls | Canvas has a board-level 3D view, not CAD modeling | **PARTIAL** |
| D-009 | Create/select/transform 3D entities | — | **MISSING** |
| D-010 | Mechanical/massing/product 3D seeds | — | **MISSING** |
| D-011 | STL/STEP/PNG export | — | **MISSING** |
| D-012 | Gallery/asset-library publish | — | **MISSING** |

### 8.8 Full Hired template-catalog inventory

`components/studio/templates/catalog.tsx` contains 68 static definitions plus 12 generated comic
genre entries; `templates-manifest.json` resolves the resulting **90 visible catalog entries**.
Builderforce has no matching template IDs. The current `creative-studio` Canvas pack merely places
generic kind cards and is therefore **DECLARED**, not template parity.

| Family | Hired template IDs | Status |
|---|---|---|
| Documents | `resume-doc`, `job-doc`, `article-doc`, `blog-doc` | **MISSING** |
| General/career video | `basic`, `profile`, `resume`, `personal-brand`, `skills-demo`, `code-walkthrough`, `design-portfolio`, `data-analysis` | **MISSING** |
| Hiring/company video | `job-ad`, `company-promo`, `sizzle-reel`, `tool-promo`, `product-promo` | **MISSING** |
| Learning video | `course-lesson-explainer`, `course-lesson-demo`, `course-lesson-walkthrough` | **MISSING** |
| Film/casting | `self-tape`, `monologue`, `showreel`, `director-pitch`, `casting-call` | **MISSING** |
| Podcast | `podcast-trailer`, `podcast-episode`, `podcast-interview` | **MISSING** |
| Voice | `voice-audition-reel`, `voice-ivr-prompt`, `voice-audiobook-chapter` | **MISSING** |
| Games | `game-3d-world`, `endless-runner`, `quiz-game`, `memory-match` | **MISSING** |
| Drawing/image | `drawing-blank`, `drawing-social-square`, `drawing-og-card` | **MISSING** |
| Animation | `animation-logo-loop`, `animation-spinner`, `animation-reaction`, `animation-explainer` | **MISSING** |
| CAD | `cad-floor-plan`, `cad-part-drawing`, `cad-electrical-schematic`, `cad-blueprint` | **MISSING** |
| CAD 3D | `cad3d-part`, `cad3d-massing`, `cad3d-product` | **MISSING** |
| Display/social ads | `ad-iab-mpu-300x250`, `ad-iab-large-rect-336x280`, `ad-iab-leaderboard-728x90`, `ad-iab-half-page-300x600`, `ad-iab-skyscraper-160x600`, `ad-iab-billboard-970x250`, `ad-iab-mobile-banner-320x50`, `ad-iab-large-mobile-320x100`, `ad-og-link-card-1200x630`, `ad-social-reel-9x16`, `ad-meta-in-feed-4x5`, `ad-pinterest-pin-2x3`, `ad-youtube-bumper-6s`, `ad-outdoor-billboard-4x1` | **MISSING** |
| Linear comics | `comic-hero`, `comic-noir`, `comic-scifi`, `comic-fantasy`, `comic-romance`, `comic-slice`, `comic-manga`, `comic-horror`, `comic-comedy`, `comic-retro80s`, `comic-webtoon`, `comic-adventure` | **MISSING** |
| Interactive comics | `icomic-branching-pitch`, `icomic-choose-path`, `icomic-case-study` | **MISSING** |
| Declarative résumé designs | The 12 IDs in §8.3 | **MISSING** |

Every catalog entry is complete only when it has: localized name/description, real thumbnail,
category and media-kind filters, preview/details, a seed that produces editable runtime state,
template-application tests, and the expected export. A card that only stores the template ID fails
this gate.

### 8.9 Export, publish and lifecycle parity

| ID | Feature | Builderforce evidence / current result | Status |
|---|---|---|---|
| X-001 | Primary Save persists draft without rendering | Canvas autosave provides equivalent behavior | **REPLACE** |
| X-002 | Save-options menu derived from media kind | Generic object export list exists, not Hired capability registry | **PARTIAL** |
| X-003 | Export creates a child rendition without replacing editable source | Canvas deliverables attach to object | **PORTED** |
| X-004 | Download/result appears in Canvas Files library | Implemented | **PORTED** |
| X-005 | Free/Pro output-profile gating | No Hired profile registry in Canvas | **MISSING** |
| X-006 | Video profiles: H.264, H.265, ProRes, DNxHD, VP9 | Only generic video export | **PARTIAL** |
| X-007 | Podcast profiles: MP3+chapters, M4A, Opus, WAV, video MP4 | — | **MISSING** |
| X-008 | Voice profiles: MP3, WAV, Opus | — | **MISSING** |
| X-009 | Animation profiles: GIF, WebP, APNG, transparent MP4 | — | **MISSING** |
| X-010 | Game profiles: HTML5 ZIP, itch ZIP, web embed | — | **MISSING** |
| X-011 | Comic profiles: PNG strip, PDF, CBZ, motion MP4/GIF | PDF action only, without renderer | **DECLARED** |
| X-012 | Image profiles: PNG, JPEG, WebP, layered PSD | Generic generated image file only | **PARTIAL** |
| X-013 | CAD profiles: SVG, PDF, DXF, PNG, STL, STEP | SVG/PDF actions declared only | **DECLARED** |
| X-014 | CAD 3D profiles: STL, STEP, PNG | — | **MISSING** |
| X-015 | Document profiles: PDF and PNG | PDF/DOCX/HTML/Markdown exist; template render/PNG absent | **PARTIAL** |
| X-016 | Copy public share link | Canvas share link exists | **PORTED** |
| X-017 | Copy editor link | Session URL provides equivalent | **REPLACE** |
| X-018 | Publish history with view/republish | — | **MISSING** |
| X-019 | YouTube, LinkedIn and profile destinations | — | **MISSING** |
| X-020 | Podcast RSS/Apple/Spotify destinations | — | **MISSING** |
| X-021 | Voice marketplace/profile audio destinations | — | **MISSING** |
| X-022 | Animation Giphy/Tenor/CDN destinations | — | **MISSING** |
| X-023 | Game itch.io/GitHub Pages/embed destinations | — | **MISSING** |
| X-024 | Comic reader/Webtoon/Tapas destinations | — | **MISSING** |
| X-025 | Image/CAD gallery and asset-library destinations | — | **MISSING** |
| X-026 | Attach time-based output to a course | — | **MISSING** |
| X-027 | Visibility private/unlisted/public | Session sharing exists; creative artifact visibility absent | **PARTIAL** |
| X-028 | Brand watermark and remove-branding entitlement | — | **MISSING** |
| X-029 | Project clone/delete/template lifecycle actions in one menu | Canvas has equivalent actions across menus | **REPLACE** |
| X-030 | Export failure, progress, retry and cancellation states | Video shows busy/error; other runtimes absent | **PARTIAL** |

### 8.10 Port order and acceptance gates

The audit changes T4 from “move runtimes” into the following shippable gates. No slice may be
marked complete from file presence alone.

1. **Résumé source + lineage.** Add the native canonical résumé schema, upload/extraction/OCR,
   immutable source revisions, derived variants, Original/Derived switcher, field diff, restore,
   active/master/archive/delete rules, and Recruiter operations. Prove R-001–R-047.
2. **Résumé renderer + 27 templates.** Port the 12 declarative document designs and 15
   video-résumé compositions, using one canonical preview/public/export renderer. Prove §8.3 and
   golden fixtures for every template.
3. **Document Canvas runtime.** Mount `DocumentStage` behavior inside the selected Canvas résumé
   object; do not open a Studio route or second editor. Prove RR-001–RR-024 at 360px, light/dark,
   keyboard-only and all five locales.
4. **Shared runtime shell.** Port editor tabs, rails, stage overlays, properties, layers, media,
   action panels, keyboard map and capability-driven save menu. Prove §8.5–§8.6.
5. **Time-based runtime.** Extend the existing `CanvasVideoEditor` rather than forking it; port
   scenes/widgets/NLE/audio/captions/engagement and all video/podcast/voice profiles.
6. **Static and interactive runtimes.** Port image/drawing, animation, games, comics, CAD and 3D
   in that order, with each runtime's import/edit/preview/export loop intact.
7. **Catalog and publishing.** Register all 90 Hired Studio entries in the canonical Builderforce
   template service, then port destination adapters and publication history.

Global completion gate:

- Every row in §8 is **PORTED** or deliberately **REPLACE** with tested Builderforce-equivalent
  behavior; no **MISSING**, **DECLARED** or **PARTIAL** row remains.
- A user can upload a PDF résumé, generate two tailored derivatives, edit each, switch to the
  immutable Original, compare them, restore an older derivative as a new head, and export the
  selected 12-template design to PDF and DOCX after a reload.
- AI and direct manipulation write the same object/revision; every export is a rendition child.
- Template and capability registries have source-to-catalog localization tests for en/zh/es/fr/de.
- Runtime bundles are dynamically loaded and meet the Canvas bundle/performance budget.
- Focused unit, integration and Playwright tests cover each status row; the release checklist links
  the test or product decision that changed it to **PORTED**/**REPLACE**.
