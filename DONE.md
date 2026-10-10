## ✅ RESOLVED 2026-10-10 — A strict-pin "model unavailable" answers 503 again, not 500 (api)

**Was:** `POST /llm/v1/chat/completions` stamped the trace id with `upstream.error.details = …`. The gateway's own strict-pin envelope (`LlmProxyService.ts`, `code: 'model_unavailable'`) carries `error` as a **string**, so the assignment threw `TypeError: Cannot create property 'details' on string 'Strict-pin: …'`. Every intended 503 "model unavailable (cooldown)" became a 500 from `errorHandler`. Production `api_error_log` held 80 of these in 2026-10-03 → 10-10 (`claude-opus-5-5` 54, `claude-sonnet-5-5` 22, free-pool pins 4), plus 66 more in `error_groups`.

**Now:** `llmRoutes.ts` stamps the error object when `error` is an object, and the envelope's top-level `details` when it is a string. The status and body pass through unchanged. Regression test: `llmRoutes.test.ts` "keeps a strict-pin 503 a 503 and stamps the trace id on the top-level details". Verified by a Sonnet run: llmRoutes.test.ts 62/62, `type-check` (tsc + tsgo) 0 errors.

## ✅ RESOLVED 2026-10-10 — Roadmap re-validated against production data

Production was read (read-only) on the core, transactional and apps databases: `api_error_log`, `llm_failover_log`, `llm_health_probes`, `llm_usage_log`, `error_groups`, `activity_log`, `executions`, `pull_requests`, `projects`, `calendar_connections`, `release_notes` and `_migrations`. These entries closed:

- **"One ticket carries three `pull_requests` rows for the same PR number."** The query the entry was blocked on found **0** groups of duplicate `(task_id, number)` rows and 0 NULL-`repo_id` duplicates. There is no uniqueness hole to backfill.
- **"Retiring the legacy `video` project modality could not be checked against tenant data."** Exactly one project has `modality = 'video'`: #34 "Video Gen", tenant 1 (the operator's workspace), created 2026-07-18 and never updated. No data migration is needed.
- **"Verify chat #55's actual `brainChats.projectId`."** Chat #55 ("Self Diagnostics") is on project 11, the same project as chats #71, #103, #104, #113 and #115.
- **"⏸️ STATUS — the 2026-09-12 operator-decision pass was stopped mid-flight."** Migrations 1152–1157, 1160 and 1161 were all applied on 2026-09-12 21:49Z, so the "read 1160 before migrating" step is moot. `lib/content.ts` was split into `lib/content/*` and its oversized-file carve-out removed. Merge-driven closes go through `reviewGateAuthority` (`completeDeltaOnMerge.ts`, `mergeRecordedPr.ts`). What was left, partial blog translation and three operator items, moved onto the marketing-copy entry.
- **"frontend `2026.9.33` — the fix making Ideas reachable is unverified and uncommitted."** `canvasPhases.test.ts` is committed (`94ef8e435`), and `'ideas'` is in every phase of `canvasPhases.ts`.
- **"Run-visibility + ticket-parent changes are written but UNVERIFIED and unpackaged (PRD 29)."** Superseded. The packages have shipped since: brain-embedded 2026.10.4 (was staged at 2026.9.30), VSIX 2026.10.4 (2026.9.71), api 2026.10.18, frontend 2026.10.32.
- **"`next build` fails: `@webdit/torch` cannot be resolved."** `webdit/runtime/node_modules/@webdit/torch` is now linked.
- **"`CreationCanvas.tsx` is a 13,656-line god component."** It is 1,165 lines and out of the react-hooks baseline. The duplication that moved out with the code (68 role guards, 44 edge literals) stays open as its own entry.
- **"The four new image vendors have not answered a live call."** The daily probe has now run six times. Cloudflare and Pollinations are proven `ok`. The entry was rewritten around the two that fail every sweep (Hugging Face, Gemini image).
- **"A cloud-agent burst drove most of Sep 16's growth — confirm whether it was intended."** Merged into the role-slot re-open entry. `activity_log` shows the burst's mechanism: the business-analyst slot re-dispatched after each completion, interleaved with PRD-commit failures.

**Re-measured, still open:** the run-telemetry copy has not run (core still holds 71,465 `tool_audit_events` and 3,107 `brain_chat_trace` rows). `builderforce-apps` holds 4 live sites, so the $0 plan's "delete builderforce-apps" was corrected. Blog translation stands at 8/162 catalog entries. The four run-path god modules and the three VS Code files have all grown. The ~40 entries that sat unsorted above the domain index were moved into their owning domain sections. New findings from the logs sit under "Production signals — 2026-10-10" in the roadmap.

## ✅ RESOLVED 2026-10-10 — Opened boards are released, and a board (or its App) can be closed (frontend 2026.10.32)

**Was:**
- `ActiveCanvasContext.opened` only grew. Every board visited in a shell session stayed mounted behind `CanvasStage`, each with any App runtime and polls it held. The only way to release one was a project switch, which dropped all of them.
- There was no per-board close.
- The App surface had no visible way back to the board, only the switcher chip and Escape. Its stylesheet still described a "Back to the board" control that no longer existed.

**Now:**
- **`lib/canvas/boardRetention.ts`** (new, pure, tested) decides which kept boards may go. At most `KEPT_BOARD_CAP` (3) boards stay mounted, the one on stage included. A board is released only when that loses nothing:
  - it is not the board on stage;
  - no Brain turn is in flight on it;
  - it is not held only in this browser;
  - it has been off stage for at least `RELEASE_IDLE_MS` (5s), so the 300ms autosave behind its last edit has already written.

  The least recently on stage goes first. A board that isn't yet releasable is checked again when it becomes so.
- **`ActiveCanvasContext`** gains `closeBoard(board)` and `publishBusy(sessionId, busy)`. It tracks when each board left the stage and applies the bound.
- **`usePublishBoardToShell`** publishes the board's Brain turn (`thinking`) as `busy`. `CreationCanvas` passes one more argument and does not grow.
- **`SessionList`:** the ACTIVE row has a close ✕. It puts the board away, releasing its instance and runtime, and lands in the library. Nothing is deleted; the board stays in Recents. It is localized in five locales (`sessions.closeAria`), uses theme tokens, and is a 32px target on a coarse pointer.
- **`CanvasAppSurface`:** a header carries the shared `.objectSurfaceExit` "Back to the board" with a close icon. The surface works out whether it can be left at all; under the Studio lens, App is home and none is drawn.

## ✅ RESOLVED 2026-10-10 — A hidden board's App no longer paints over the board on stage (frontend 2026.10.31)

**Was:** after opening a board's App surface and switching to another session, the first board's live preview (address bar, "Select to edit", device toggles, the running app) stayed on screen over the new board, whatever surface it was on. There was no way to close it, because it belonged to a board that was no longer on stage.

**Cause:** `CanvasStage` keeps every opened board mounted and hides the inactive ones with `visibility:hidden; pointer-events:none`. `components/builder/PaneLayer.tsx` gave its ACTIVE layer an explicit inline `visibility:visible; pointer-events:auto`. Both properties inherit, and an explicit value on a descendant overrides the ancestor's, so the hidden board's preview pane both painted and caught clicks.

**Now:** an active `PaneLayer` sets neither property and inherits from its ancestors. Only an inactive layer sets `hidden`/`none`. This covers the canvas App surface, Studio and the workspace side panels. `PaneLayer.test.tsx` pins the contract.

## ✅ RESOLVED 2026-10-09 — The Studio/canvas prompt is a chat box again, not a form (frontend)

**Was (Studio, session `local-148925cf`):** the docked prompt under the Brain transcript had seven controls on two rows, inside three nested borders:
- a "Thought for 7s · 1 actions" strip repeating the transcript's own "Thought for…" line;
- the sent prompt still standing in the box;
- a "/ ⚡ Work · Builderforce Free" chip;
- an "Entire canvas" scope chip with nothing selectable;
- a mic on a different row from Send.

The stale text was a real bug. The auto-submitted entry prompt was copied into the composer (`setPrompt(request)`) and then sent as an override, and `evaluateCanvas` clears the composer only for a typed turn.

**Now:**
- **`hooks/useCanvasProposalReview.ts`** sends the seeded or entry prompt without copying it into the composer (`setPrompt` dropped from the hook's deps).
- **`chat-input/ComposerSendOrVoice.tsx`** (new): one trailing button shows the mic while there's nothing to send or stop, Send once there's text, and Stop while a run streams. A live recording keeps the mic in place. `VoiceDictationButton` is now presentational. This applies to every `showVoice` composer: Studio and canvas, workspace Brain, dashboard, landing hero.
- **`CanvasComposer`** uses `density="compact"`: two rows, scope in the tool row, no plan-chip row. The `contextPlacement` prop is retired (no other caller). The compact `/` trigger is quiet text naming only the armed mode, with no border, no mode icon and no model name. The model is still named in its tooltip and accessible name, and in the menu.
- **`CanvasScopeChip`** renders nothing when there's nothing to narrow to.
- **`BrainSurfaceBody`** shows the activity strip only while a turn is live.
- The docked composer card is a filled box with no rule, border or shadow, from canvas palette tokens in both themes.

## ✅ RESOLVED 2026-10-09 — No "Built with" badge in the Studio/canvas preview (frontend 2026.10.29)

**Was:** the in-browser preview runtime injects its "Built with Builderforce.ai" badge by default, and `bootSharedPreviewRuntime` never turned it off, so every Studio and canvas preview showed it over the builder's own app.

**Now:** `lib/browserRuntime/previewRuntime.ts` boots with `attribution: false`. The badge stays on published sites, where the API adds its own "Made with Builderforce.ai" (free tier, `api/src/application/ide/siteAttribution.ts`).

## ✅ RESOLVED 2026-10-09 — Studio build turns, second pass: written files reach the preview, imports get declared, and a replayed prompt gets its answer (frontend 2026.10.30, api 2026.10.18)

**Was (session `local-148925cf`, second turn, 16 steps):** the Brain wrote thirteen files (`src/App.jsx`, pages, components, CSS), every one `applied: true`, and the preview still read "Hello World!", with no reply in the conversation. Four faults:
1. The vanilla scaffold's `src/main.jsx` declared its own inline `App` and never imported `src/App.jsx`, the file every model writes the app into.
2. The writes went to the second build, while the surface kept running the starter.
3. `react-router-dom` was imported across seven files and never added to `package.json`. The preview runs a real `npm install`, so it could not resolve.
4. The prompt was re-sent with the same text as the board's seeded first message, so the turn adopted that message's id. Its reply (`<id>:assistant`) collided with the first turn's reply and `appendTimeline` dropped it.

**Now:**
- **Scaffold** (`packages/ide-templates/src/scaffolds.ts`): `src/main.jsx` mounts `./App`, and `src/App.jsx` holds the starter page.
- **`scaffoldPathStoodInFor`** (`packages/ide-templates`): a missing scaffold file counts as present when the project has a file with the same module stem (`src/App.tsx`). This applies in `templateNeedsBackfill`, the API backfill and `repairScaffold`, so a restored `App.jsx` never shadows a real `App.tsx` (Vite resolves `.jsx` first). Older projects get the unused `App.jsx` once.
- **`writtenAppTakesPrimary`** + `appWritten` (`lib/canvasSessionApp.ts`, `useCanvasSessionApp`): the build tools report every committed write through one `committed()` seam (`onBuildWritten`). A write to an app while the surface shows a lens starter makes that app primary. An app someone chose keeps the surface.
- **`lib/undeclaredDependencies.ts`**: `canvas_write_build_file` and `canvas_edit_build_file` answer `undeclaredDependencies` plus a `next` naming the packages to add to `package.json`.
- **`adoptableInitialMessage`** (`brainTurn/`): the seeded first message is adopted only while it has no reply, so a re-sent prompt gets its own id and its own answer.

## ✅ RESOLVED 2026-10-09 — Studio build turns: provisioning is not the app, and a same-platform build claims the starter (frontend 2026.10.28)

**Was (session `local-148925cf`, "Build a social media website that offers phone plans", gemini-2.5-flash):** the Brain called `canvas_create_build`, then ended with "I've created a new web project… you can now start adding files" above a "Hello World!" preview. Two faults. (1) Provisioning answers `applied: true`, so `canvasChanged` was true and no act-now ladder fired; the runner accepted the scaffold as the deliverable. (2) The board already held Studio's web starter, and the Brain made a SECOND website beside it instead of reusing it (the BUILD prompt only asked it to). A same-platform app never takes primary, so the App surface kept running the untouched starter; code written to the new build would have gone to an app nobody was looking at.

**Now:**
- **`CANVAS_BUILD_FILE_WRITE_TOOLS`** (`lib/canvasBuildTools.ts`): the workspace write tools minus `canvas_create_build`. The runner tracks `buildAuthored` separately from `buildTurn`.
- **Build-authoring ladder** (`lib/creationCanvasAi.ts`, `BUILD_NOT_AUTHORED_DIRECTIVE` in `lib/canvasAiTurnBudget.ts`): a build turn that tries to end before writing a file is sent back to write the app. The rungs match the act-now ladder: re-state, hand off to a proven model, re-state once more. When they are spent, the user gets the new `buildNotAuthored` notice (all five catalogs) instead of the model's claim. The loop tail no longer reports a template-only build as "added to the canvas".
- **`claimableStarter`** (`lib/canvasSessionApp.ts`): `createApp` hands a requested app of the starter's platform the starter itself. It renames it, drops the starter flag and makes it primary, so there is no second workspace.

## ✅ RESOLVED 2026-10-09 — Studio lens second review: the right app in front, no stray starter, one exit, one origin (frontend 2026.10.27)

**Was (second review of 42c0674a8 + fixes):** Studio's web starter stayed the app the surface ran when the request was for a mobile app (logged in the roadmap the same day). A starter that answered after its 30s wait still landed, beside the build the released first turn made. The room's exit dropped a Studio reader on the bare board. "Open on canvas" left Studio's left-docked Brain on the canvas until a reload. The two Studio home lists each sorted and capped their cards. `studio.<apex>` sent only `/`, `/studio` and `/create` to the apex, so `/login` or `/dashboard` there still signed someone in on a second origin. `/brainstorm?prompt=` swallowed a plan limit.

**Now:**
- **Starter apps** (`APP_STARTER_FIELD`, `newAppTakesPrimary` in `lib/canvasSessionApp.ts`): the lens's app is created as a starter, and a build of another platform takes over as primary; one of the same platform does not (the BUILD prompt reuses it).
- **A starter lands only while wanted**: `createApp` takes `starter` and an `AbortSignal`; `useCanvasEntryApp` aborts on timeout or failure, and a starter answering late, or after the board got an app another way, is dropped (its browser workspace discarded) with `StarterAppNotNeededError`, which is not reported as a failure.
- **One exit** (`canvasLensExit`): the App surface, the chat and the room all leave through it; the room via `useCanvasLens().leaveSurface`.
- **Leaving a lens restores the dock** the person keeps (stored mode, side, open; never open on a phone).
- **`StudioCardList` owns order and cap** (`newestStudioCards`); `useStudioApps` and `StudioRecentProjects` hand it cards unsorted.
- **Apex-homed product host**: `PRODUCT_HOSTS[]` is `home: 'apex' | 'host'` + `hostPaths`; Studio's host keeps only `/auth/*` and sends every other path the middleware sees to the apex (prerendered pages the assets binding answers are out of the middleware's reach).
- **`/brainstorm` shows `UpgradeModal`** on a plan limit; the `guest_prompts.surface` schema comment points at `GUEST_PROMPT_SURFACES`.

## ✅ RESOLVED 2026-10-09 — Studio lens review: the lens holds its surface, sign-up keeps it, and the shell steps aside (frontend 2026.10.26)

**Was (review of 42c0674a8):** Escape in the App surface, a card revealed from the conversation, or a Brain-made room dropped a Studio visitor onto a bare board with no way back. The lens lifted the phase before the board loaded and SAVED it, pinning mature boards to Make. Guest sign-up (the turn limit, the account gate) and the Files panel's OAuth return went to `/create/<id>`, losing the lens. A create that never settled held the first turn forever, and leaving Studio mid-create released it early. The canvas tour was offered over Studio's app. Signed-in visitors without a workspace were filed as guest leads. The new "never a second build" rule forbade a mobile app beside a website on every board. The operator top-bar menu button, bottom nav and team footer still framed Studio. `studio.builderforce.ai` kept guest boards (and a host-only sign-in) apart from the apex. The Studio home listed only durable projects nothing creates any more.

**Now:**
- **The lens keeps a home surface** (`holdsSurface`, `canvasLensHome`): Escape from it is a no-op, leaving any other surface returns to it, and `CanvasLensBar` shows "Back to App" while the reader is elsewhere.
- **Phase floor after load**: `useCanvasLens` lifts the phase only once `boardLoaded`, against the board's own loaded phase.
- **One board path**: `useCanvasLens` returns `boardPath` (`canvasLensSessionPath`), published in the session facts and used by the guest sign-up CTA, the account gate and the Files panel `returnTo`.
- **Entry app** is raced against `ENTRY_APP_TIMEOUT_MS` (new `lib/withTimeout.ts`) and holds the first turn while its own create is in flight, whatever the lens.
- **Registry fields** `tours`, `appSurfaceLink`, `shellMobileNav`, `shellTeamBar`: no tour in Studio; "Open in Studio" comes from data, not a URL comparison; `AppShell` drops the bottom nav (zeroing `--mobile-nav-height` at the frame), the team footer and the top bar's dead menu button for the Studio lens. The dock's "float the prompt" control is hidden while a lens forces the placement. `lib/canvasLens.ts` no longer imports from `components/`; the Studio route no longer matches deeper paths.
- **`startCreationSession` takes `isAuthenticated`**: signed in without a workspace means a local board, never a guest lead. The brainstorm redirect now waits for `authReady`.
- **BUILD prompt**: reuse the build a request is about; a second build only for a different app or platform.
- **One origin**: `PRODUCT_HOSTS[].apexPaths` sends `studio.<apex>` `/`, `/studio/*` and `/create/*` to the apex; auth callbacks stay on the host.
- **Studio home** lists "Your apps" (`useStudioApps`: this browser's boards and the workspace's with an app, each opening at `/studio/<id>`), plus durable Studio projects only when there are some; both through the new `StudioCardList`.
- **Leaving mid-turn** via the Studio mark asks first (`useConfirm`); `BrandLockup.onClick` now receives the event.
- **Phone lens bar**: at most two rows; "Open on canvas" becomes icon-only, surface controls scroll sideways.
- **`UpgradeModal` works out its own target** (`planAfter`); the four copies of the expression are gone.
- **Board sessions are `noindex`** (`/create/<id>`, `/studio/<id>`); the middleware COI comment now says what the isolation is for (in-page WASM, not Run).

## ✅ RESOLVED 2026-10-08 — Studio needs no sign-in: it is a lens over the one canvas (frontend 2026.10.25, api 2026.10.17)

**Was:** Studio's "Build it" waited for a signed-in workspace, popped the sign-in dialog and created a durable project, while the canvas gave the same visitor a `local-<uuid>` board and a running app with no account. The Studio home drew its own bar instead of the site header. The API still keyword-seeded empty website/workflow/dataset cards from the prompt wording, which the client had removed because it failed the first turn. A guest board was given the build tools but never the BUILD instructions, so "build me an app" produced a website card.

**Now:**
- **Studio is a lens, not a second runtime.** `lib/canvasLens.ts` is a registry: `canvas` (`/create/<id>`) and `studio` (`/studio/<id>`) present the SAME mounted board. The Studio lens opens the App surface with the Brain docked left, hides the operator sidebar, the phase/surface chrome and the session command bar, and draws one slim bar (`CanvasLensBar`) carrying the App surface's own Run, Preview/Code, Files, Publish and "Open on canvas". Going back and forth is a route change with the board kept.
- **No login.** "Build it" calls the ONE session use case `lib/canvas/startCreationSession.ts` (also migrated: `/create/new`, the brainstorm redirect, the dashboard box). Guests get a local board; signed-in people a server session; a plan limit is rethrown to `UpgradeModal`; a signed-in fallback is no longer filed as a guest lead. `GuestPromptSurface` gains `studio` (frontend and API).
- **Entry app, safely.** `useCanvasEntryApp` creates the lens's app once, only after the board has loaded, and releases the first Brain turn on failure. `useCanvasLens` applies surface, phase floor and dock as a presentation without overwriting stored preferences.
- **`buildOpen` folded into `surface`** on `ActiveCanvas`; `?build=1` is kept as a legacy alias for `?surface=app`.
- **Header and slogan.** `/studio` is a public page under the site header; `/studio/project/*` stays the chrome-less durable IDE. Slogan "What will you build?" in all five catalogs.
- **Server seeding removed** from `POST /api/creation-sessions`; the chat object and `initial:` timeline row are the whole starter.
- **Guest BUILD instructions** now ship for local boards too, plus "write into an existing build, never create a second".
- **Dead code removed:** `useStartStudioProject`, `lib/studio/promptHandoff.ts`, and the orphaned `initialPrompt` prop chain through `BuilderWorkspace` → `WorkspaceBrainColumn` → `useWorkspaceBrainContext`.

## ✅ RESOLVED 2026-10-07 — Marketing persuasion layer: live social proof, loss framing, risk reversal, and a published line we will not cross

**Was:** the marketing site described the product carefully but used almost none of the levers that move a reader. There was no social proof, the problem section's heading ("Ideas become real") framed no loss, the exit prompt was a generic "Before you go…", and no page said what the site would and would not do to persuade.

**Now:**
- **Live social proof, real counts only.** `GET /api/public/proof` (`application/marketing/platformProof.ts`, one-hour `getOrSetCached`) counts verified builders, builders this week, non-archived projects and completed agent runs. Cross-tenant reads are declared `acrossTenants(..., 'platform_aggregate', ...)`. `SocialProofBar` renders it in the homepage hero and the shared `CreationCtaSection`. `PROOF_FLOORS` in `lib/platformProof.ts` hides any metric below its floor, so a weak number is never shown and none is ever inflated.
- **One shared persuasion layer** in `components/marketing/TrustSignals.tsx`:
  - `TrustLine` (risk reversal plus real immediacy) sits under every primary ask.
  - `ProofLinks` (authority you can open: /method, the Evermind architecture post, /compare, /diagnostics) also sits under every primary ask.
  - `HonestyPledge` is in the marketing footer on every marketing page, loaded via `next/dynamic`.
- **Copy:**
  - The hero uses in-group identity and loss/FOMO framing.
  - The CTA repeats the core promise and adds urgency.
  - The problem heading is now "Ideas die in the hand-offs".
  - The exit prompt uses loss framing ("Leaving your idea behind?").
  - All five catalogs are updated.
- **`/about#how-we-market`** (`HonestMarketingSection`) lists every lever the site pulls and the one line it does not cross: no fake timers or scarcity, no testimonials or numbers we cannot back, no hypotheses presented as results, no buried opt-outs.

**Verified (Sonnet):** api and frontend type-checks pass (tsc + tsgo). `npm run check` passes 37/37 on the api and 25/25 on the frontend. All targeted tests pass: `platformProof`, `SocialProofBar`, `LandingCanvasHero`, `ExitIntentPrompt`, `MethodologySection`, `MarketingShell`, `TensionBeat` and `AboutAppSection`.

## ✅ RESOLVED 2026-10-05 — "Deploy the app" opens the app's Publish panel, and a live app is recorded on the board (frontend 2026.10.24)

**Was:** found on a live session: a canvas with an idea and an app, in Run. The Operate surface offered "Let Brain deploy it". Brain read the build card, tried `canvas_invoke_object_action` with `deploy`, `publish` and `build` (all three refused; a build card only declared `open`), and answered "I cannot directly deploy the app from the canvas … use an external deployment process", which is false. There were three faults:
- **"Let Brain deploy it" promised something Brain had no tool for.** Deploying an app is the App surface's own Publish panel (`SitePublishPanel`): the site is built in the browser runtime, then uploaded.
- **A real publish never reached the board.** `publishSite` notified only the Database view. Run's ✓, Measure's readiness, Operate and the room's ops station all read "live" off a `deployment` card (`isLiveDeployment`), so a published app kept showing as "not deployed".
- **On a guest canvas, the next step never said an account was needed.**

**Now:**
- **The live step is a direct act.** `REQUIREMENT_ACTIONS.live` names `act: 'publishApp'` with its own label ("Publish the app"). `useLetBrain` returns `requirementLabel` / `runRequirement` and `phaseLabel` / `runPhase`, so the ghost card, path card, Operate and Insights read one table. Run's own step is the same act, so the two cannot disagree.
- **`useCanvasPublishing.publishApp`** opens the App surface on that app with its Publish panel open. It uses a new `whenReady` option on `sendWorkspaceCommand`, which holds the command until the workspace mounts. A board saved only in this browser gets the account prompt instead; a board with no app yet is given one.
- **Brain can do it too.** A build card declares `publish` (registry and `CONNECTED_CANVAS_ACTIONS`), and `performBrainAction` routes it to `publishApp`. `HANDOFF_ACTION_NOTES` tells the model the panel is open for the person and that it must never claim the app is deployed. The system prompt names the action.
- **The deployment lands on the board by itself.** The publish event now carries the published site. `useRecordAppDeployments` (rule: `lib/canvas/appDeployment.ts`) creates or updates one `deployment` card per app, connected app → deployment, with the url, version, `production` and publish time, then says "Live at {url} — recorded on the board."
- **Apps published before this change are picked up once, quietly, on load.** One `fetchSite` per app per mount, and only for apps with no deployment card yet; viewers who cannot edit write nothing.
- **Copy:** the `requirement.live` verb and prompt keys and `phaseGhost.verb.run` are removed. `requirement.live.act`, the `appPublish.*` keys and the reworded `phaseStarters.run.deploy` prompt are in all five catalogs. The "canvas knows where you are" blog post is updated in all five locales.

**Verified (Sonnet):** type-check passes (tsc + tsgo), `npm run check` passes 25/25, and 287/287 tests pass across 16 files. Those include the new `appDeployment`, `workspaceCommands` (`whenReady` waits for the mount and delivers once to every handler) and `useRecordAppDeployments` (publish → card, re-publish updates it, a foreign project is ignored, an already-live site is recorded quietly, no request when a card exists, viewers write nothing) tests, plus `canvasChange`, `canvasPhasePath`, `phaseGhostCard`, `canvasOperateSurface`, `canvasSurfaces` and every phase-provider consumer. `CreationCanvas.tsx` and `creationObjectRegistry.ts` end smaller than before, and the `lib/api.ts` ceiling was lowered to 1105.

## ✅ RESOLVED 2026-10-05 — The canvas never moves a reader between phases on its own; it offers the next one

**Was:** a canvas whose phase had never been chosen resolved as `chosen ?? stored ?? frontier`, and the frontier was re-derived from the board every render. Someone working in Run who added a deployment with a URL was moved to Measure mid-task: the lens changed, Insights appeared and the bar tint moved. `useTaskRunner` also sent that live frontier as `arcStage`. Found in the PRD 32 review. The operator chose option (b).

**Now:**
- **The phase settles once, at load.** `useCanvasSession` reports the board it actually loaded, once, through a new `onBoardLoaded` callback on both the local-snapshot and server-load paths. `useCanvasSurfaceState.settleLoadedPhase` stores that frontier per canvas, and the first report wins.
- **Resolution order** is a choice made this session, then the choice remembered for this canvas, then the frontier as loaded. The live frontier applies only while the board is still loading, so SSR and hydration still agree.
- **The path card offers the next phase instead of moving the reader.** `nextPhaseOffer` in `lib/canvasPhaseReadiness.ts` returns the next phase when this phase's own output is on the board and the next phase is ready. The card then reads "Run has what it needs — Measure is ready when you are." with "Go to Measure" and "Stay in Run". "Stay" is remembered in memory, per phase. The new `phasePath.advance` and `phasePath.stay` keys are in all five catalogs.
- **Also fixed:** `room.module.css` carried a `var(--text-on-accent, #fff)` fallback, which failed `check:design-scale` on main. The token is declared in both themes, so the literal was dropped.

**Verified (Sonnet):** type-check passes, `npm run check` passes 25/25, and 258/258 tests pass across `canvasPhaseReadiness`, `canvasSurfaces` (including settle once, settle per canvas, and a remembered choice beating the settled frontier), `canvasPhasePath` (offer, go, stay, nothing past Reach), `canvasTopChromePath`, `CreationCanvas` and `canvasPhases`.

## ✅ RESOLVED 2026-10-05 — Spawn has a 7-day free trial with the free plan's tokens, and the grown-up is emailed a way to keep it going (api 2026.10.16 · frontend 2026.10.23)

**Was:** a new Spawn player could do nothing without a $1.99 membership, which most 13-year-olds cannot pay. The account page went straight from the age gate to "Join".

**Now:**
- **The trial** (`application/spawn/spawnTrial.ts`) lasts `SPAWN_TRIAL_DAYS = 7`. That length is chosen from the 2025 paywall benchmarks (Superwall/RevenueCat/Adapty): 7-day trials converted at 5.2% vs 3.1% for 3-day, and 84% of 3-day cancellations happen on day 0–1. A week also always contains a weekend, when a parent can act.
- **Tokens:** the trial grants `SPAWN_TRIAL_TOKENS`, which is `PLAN_LIMITS[FREE].tokenMonthlyLimit` (50,000) read from the plan table so the two can't drift. The credit uses a per-workspace ledger reference, so it can't be paid twice.
- **No card.** The player must give a grown-up's email.
- **One trial per person, workspace and grown-up:**
  - per person: `users.spawn_trial_at` (migration 1202), claimed with an atomic `UPDATE … WHERE NULL`;
  - per workspace: the membership row keeps a `trial` record that survives joining;
  - per grown-up: a declared `global_uniqueness` check on the trial's `parentEmail`.
- **Membership states:**
  - `trial` and `trial_ended` are added. `getSpawnMembership` derives `trial_ended` by the clock.
  - `writeMembership` merges, so a payment never erases the trial record.
  - `membershipCanBuild` is the one rule for which statuses may build. It is exposed as `membershipOpen` on the account view, and the desktop app now gates on that flag instead of `=== 'active'`; a trial-eligible player sees a "try it free" gate in 5 locales.
  - Token packs require a PAID membership (`assertSpawnPaidMember`), so a trial that ends can't strand bought tokens.
- **Grown-up emails** (`infrastructure/email/spawnParentEmail.ts`, its own copy table in 5 locales, built on `deliver`/`p`/`cta` now exported from `EmailService`):
  - Four emails: when the trial starts, halfway, on the last day, and when it ends.
  - They go through `sendLifecycleEmail('onboarding_tips')`, so the address's consent and the unsubscribe link apply.
  - The daily `spawn-trial-reminders` sweep sends only the latest notice due, and persists `trial_ended` once its email has been sent or the address has opted out.
- **Grown-up's page** `/spawn/parent?t=…` (`SpawnParentPage`, `useSpawnParent`, `application/spawn/spawnParent.ts`):
  - The signed link (`spawnParentLink.ts`, the shared `signState`, valid 60 days) names one workspace and one player, and grants no session.
  - It shows the trial's state and three tiles, and offers Join or, once joined, token packs.
  - Its checkouts return to the parent page through `spawnReturn.ts`. That return handling is now one hook, `useSpawnCheckoutReturn`, shared by the account page and the parent page.
- **Account page:** `SpawnTrialPanel` offers the free week (grown-up's email field) or shows the days left.
- **Copy:** the landing hero says "Start your free week", the pricing strip says "first 7 days free", and the FAQ leads with the trial, all in 5 locales. The Spawn blog post's pricing section and steps mention the free week in all 5 languages.
- **Release note:** migration 1203 (`new`).

**Verified (Sonnet):**
- API: type-check passes, guards 37/37, and vitest for `application/spawn` + `infrastructure/email` + the cron sweep tests passes (158).
- Frontend: type-check passes; i18n tests pass (118); guards 24/25, the one failure being `design-scale` on the concurrent session's `creation-canvas/room/room.module.css`.
- Desktop: the Spawn JS files pass `node --check`, and all 5 locales have the same 74 keys.

## ✅ RESOLVED 2026-10-04 — The canvas knows which phase it is in, and what the next one needs (PRD 32 · frontend 2026.10.21 · api 2026.10.14+ · migration 1201)

**Was:** canvas phases were a tab filter stored once per browser (`builderforce:create:phase`). Measure and Reach opened on boards with nothing live and said nothing. Board, Room, command bar and starting points all ignored the phase, and Idea already offered App. Operate could not show who had signed up: the apps DB held `site_users`, `site_traffic_daily` and `site_collections.record_count`, but there was no count read.

**Now:**
- **Readiness is derived, never stored.** `lib/canvasPhaseReadiness.ts` reads the board in one pass: an idea, then an app, then a live deployment (`lib/canvas/boardDeployments.ts` `isLiveDeployment`, the one live predicate), then a metric. It returns the readiness of every phase and the frontier. The phase is stored per canvas (`builderforce:create:phase:<sessionId>`), and an unchosen canvas opens at its frontier. The legacy global key is ignored on read and removed on write. `CanvasPhaseContext`, hosted by `CanvasShell`, is the one reader. `CreationCanvas.tsx` net change is 0 lines.
- **Board lens.** Each kind a phase is about comes forward (`data-phase-focus`) and the rest recede. Edges between two receding cards fade, and frames are never dimmed. The lens toggles from the ••• menu. A dashed **ghost card** (`ViewportPortal`, never a node) shows where the phase's first object goes. It sits right of the board, or below it when that slot is past the pane edge, and offers "Let Brain …" (through `startCanvasTurn`) or a hand-add.
- **Path card, never a lock.** An unready phase gets a card under the phase selector: what is missing, numbered steps, "Go to {phase}" and "Let Brain {verb}". It collapses, in memory only. Reach without a metric gets a warning-tone advisory. The stepper shows ✓ and lock glyphs and an accessible state. The phone stage sheet lists each stage's status and what it adds, and the path card folds away while that sheet is open.
- **Surfaces follow the arc.** Idea offers Chat · Board · Ideas · Room. Make adds App, Run adds **Operate** (new), Measure adds Insights (this canvas's metrics first, via the shared `BoardMetricReadingList`), and Reach adds **Launch** (new: listing, releases, social and publish doors, composed from the existing panels).
- **Operate → People.** `GET /api/projects/:projectId/site/audience-summary` returns users, new sign-ups, visitors, page views and leads in three single-row reads. It is cached through `getOrSetCached` for 120 s and cleared on sign-up, form submission and owner deletes. The published-site Worker shares `AUTH_CACHE_KV` with the API, so those writes clear the shared tier too.
- **Room.** Stations are data with an optional `phase`. The current phase's station is lit and listed first. Evidence, Build, Ops and Launch stations are new. While a phase is unready, a sign station names what it needs, and the chrome's path card stands down on the Room (`phasePathInScene`).
- **Starting points** lead with the phase's three starters ("Starting points · Measure"), and the bar group for the current phase is tinted.
- Release note in migration 1201, plus the blog post `the-canvas-knows-where-you-are` in five languages. All five catalogs carry real translations.
- **Found and fixed along the way** (all from the review screenshots):
  - `chatInput.localDetail` was formatted without its `{runtime}` value, which raised FORMATTING_ERROR on every composer mount.
  - The Room's Look/Walk/Design bar sat under the floating top chrome. It now clears `--canvas-top-chrome-space`.
  - Its active pill was accent-on-accent. It now uses `--text-on-accent`.
  - The station list's auto grid track pushed Open buttons under the docked Brain. It is now `minmax(0, 1fr)`.
  - The ghost card is placed in the board's clear area: the pane minus the chrome bands the shell already publishes (`--canvas-top-chrome-space`, `--composer-space`, `--canvas-command-bar-space`, `--brain-dock-*`). It tries right, left, below and above the board, and stands down when none fits, because the path card says the same thing.

**Verified (Sonnet):** api type-check passes, and `siteAudienceSummary` and `siteData` pass (40/40). The VS Code client type-check passes. Frontend guards pass 25/25. The targeted PRD 32 suites pass, including `CreationCanvas.test.tsx` (147/147 across the four re-run files), along with i18n parity. §9 review was done by Opus. Four rounds of screenshots of Measure before anything is live, on Board, Room and phone in both themes, drove the fixes above, along with the path card standing down on the Room and folding away while the phone stage sheet is open. No console errors remain.

**Planning-session review (2026-10-05, against PRD 32 §9).** Checked:
- the ghost card is never a node;
- one live predicate;
- no branches on phase names;
- the legacy phase key has no readers;
- `CreationCanvas.tsx` net 0;
- real translations;
- the cached audience route.

Fixed:
- `usePhaseLensEdges` re-mapped every edge on every drag frame (its memo was keyed on `nodes`). It is now keyed on the set of receding ids.
- `useStageHue` kept a lit station in the previous theme's hue after a theme toggle. It now re-reads on `useTheme`.
- `canvasTopChromePath.test.tsx` passed `'board'` (not a `CanvasSurfaceId`), which failed the frontend type-check. It now passes `'graph'`.

Re-verified (Sonnet): type-check, 25/25 guards (including `check:react-hooks`), and 312/312 tests across the 19 PRD 32 test files, plus a 50/50 re-run of the touched four.

## ✅ RESOLVED 2026-10-05 — A model release is one catalog edit; Claude 5.5 is routed and the gateway publishes current flagships (api 2026.10.15 · sdk 2026.10.1)

**Was:** model versions were hand-copied into every routing list: `SUPERSEDED_MODEL_IDS`, `BYO_FRONTIER_FLAGSHIPS`, `CODING_MODEL_POOL`, `CODING_PREMIUM_FALLBACK_MODELS`, `PAID_OVERFLOW_MODELS`, and `VISION_MODELS`. Adding Claude Opus 5.5 / Sonnet 5.5 meant editing six lists in two files, and missing one meant a silently stale route. The catalog also stopped at Opus 5 / Sonnet 5. The adapter sent `thinking:{type:'disabled'}` and forced `tool_choice`, which are hard 400s on Opus 5.5, Sonnet 5.5 and Fable 5.1. Consumers had no way to ask for "the current Claude", so hired.video hand-copied `anthropic/claude-opus-5-5`. That slug does not exist on OpenRouter (it spells versions with a dot), so every Claude fallback 400'd and silently cascaded to Nemotron.

**Now:**
- **The vendor catalogs are the ONE place a model version lives.** `VendorModelEntry.supersedes` lists the ids an entry replaces. `catalogSupersessions()` folds them, including every route-prefixed spelling such as `direct/amazon-bedrock/…`, into `SUPERSEDED_MODEL_IDS`. `VendorModule.flagships` declares each vendor's agentic/chat flagship. The BYO seeds, coder recognition, the coding fallback tail and the OpenRouter paid coder all derive from those via `vendorFlagship`. `BYO_FLAGSHIP_VENDORS` names vendors, never models. Vision comes from catalog `capabilities`; the hand list (and its never-routable phi-4 id) is gone.
- **Claude line:**
  - Anthropic direct: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1` and `claude-haiku-4-5-20251001`, each superseding its predecessors.
  - OpenRouter: `anthropic/claude-sonnet-5.5`, plus a pin-only `anthropic/claude-opus-5.5` (`autoRoute:false` on the entry keeps an Opus-priced model out of the cascade). The dashed `anthropic/claude-*-5-5` spellings are aliased.
  - Bedrock: Sonnet and Opus 5.5. Their entries omit `temperature`/`topP`, which Claude 5.x rejects.
- **Per-model Anthropic request rules are catalog data (`AnthropicRequestProfile`):**
  - Turning thinking off is spelled per model: `disabled` (5 / 4.8 / Haiku), `between_tools` (Sonnet 5.5), or omitted entirely with effort `low` (Opus 5.5 / Fable 5.1).
  - Forced `tool_choice` becomes `auto` where the model rejects it.
  - Haiku never thinks and is capped at 64K output.
- **`GET /v1/models` returns `flagships`.** The SDK adds the `ModelFlagships` type and `models.flagship(vendor, shape)`, so a consumer can ask for "Anthropic's agentic flagship" instead of hard-coding a version.
- **Guard:** `modelCatalogCentralization.test.ts` fails the build if `modelPool.ts` or `poolRouting.ts` names a Claude version in code. It also fails if a flagship doesn't route to its vendor's catalog, an old id is claimed by two entries, or a supersession targets a non-catalog id. The touched tests read expected ids from the catalog flagships instead of literals.

**Verified (Sonnet):** api, sdk and frontend typecheck pass, and api guards pass (37/37). The 11 targeted api test files pass (241/241); sdk `index.test.ts` passes (26/26). Not yet published: the SDK `2026.10.1` npm release, and the api deploy that serves `flagships`.

## ✅ RESOLVED 2026-10-05 — A Mobile app canvas previews in the browser again (webcontainers 2026.10.5 · api 2026.10.13 · frontend 2026.10.20)

**Was:** choosing **Mobile app** on the canvas showed a blank phone frame and the Problems tab reported `Runtime  Failed to load script: https://preview.builderforce.ai/__bfwc/<id>/index.js`. The mobile scaffold (`MOBILE_TEMPLATE` in `packages/ide-templates`) imports `react-native` and relies on its `vite.config.js` alias `react-native → react-native-web`. The in-browser dev server never executes `vite.config.js`, so it sent `react-native` to esm.sh as the real React Native package. That module graph cannot load in a browser, and a module script reports any failure in its graph against the entry script, so the error named `index.js`.

**Now:** `@seanhogg/builderforce-webcontainers-core` derives `ProjectConfig.packageAliases` from package.json using a data table, `BROWSER_TWINS` (`react-native` → `react-native-web` whenever the project depends on `react-native-web`). The one primitive, `resolvePackage`, resolves bare imports for both the dev server (`compileScript.mapSpecifier`) and the production build (`buildHost`, JS and package CSS), and subpaths carry over (`react-native/x` → `react-native-web/x`). A project without `react-native-web` is unchanged. The frontend and api now depend on `^2026.10.5`. The api was still on 2026.10.3.

**Verified (Sonnet):** webcontainers build and typecheck pass. The targeted core tests pass, 44 of 44 in `resolution`, `devServer` and `build`, including new RN-Web dev-server and build cases. Release run 37251050856 published 2026.10.5. In the frontend, `useInstantPreview`, `scaffoldRepair` and `previewAddress` pass (20 of 20). `pnpm update` also moved some unrelated transitive packages within their ranges (`lightningcss` 1.33, `@napi-rs/wasm-runtime` 1.2.4, and others).

## ✅ RESOLVED 2026-10-05 — Spawn has real installers, and its site is tap-first with the Builderforce mark (api 2026.10.12 · frontend 2026.10.19 · Spawn 2026.10.2)

**Was:** spawn.builderforce.ai's Download button opened a GitHub search with "No releases found". Neither `spawn-release.yml` nor Synapse's `desktop-release.yml` had ever run, and both would have failed: the Linux test job lacked libdbus, WiX refuses a major version above 255 (ours is the year), and Tauri tries to sign macOS builds whenever `APPLE_CERTIFICATE` is *set*, even to the empty string an unset secret becomes. The landing page itself was eight text-heavy sections (features, a compare table, FAQ of six) with no Builderforce branding, for an audience of 13-year-olds who click rather than read.

**Now:**
- **Release `spawn-v2026.10.2` is published**: `Spawn_2026.10.2_x64-setup.exe`, `_aarch64.dmg` and `_x64.dmg` (unsigned until the signing secrets exist). Both release workflows build Windows as NSIS only, and both take their Apple variables from ONE composite action, `.github/actions/macos-signing`, which exports them only for a certificate that actually imports.
- **`GET /api/spawn/downloads`** (public; `application/spawn/spawnDownloads.ts` over `infrastructure/github/publicReleases.ts`, cached 10 min through `getOrSetCached`) names the newest published `spawn-v*` release's installers. A Synapse release above it is skipped, because GitHub's `releases/latest` cannot tell the two apart.
- **`SpawnDownloadButton`** is the one download control in the header, the hero, the closing band and the account page. It detects Windows or Mac (`useSyncExternalStore`, so it is server-safe) and links straight to the file. Phones get a "needs a computer" line and the release list.
- **Landing page:** the hero is one line plus a big Download button, beside `SpawnPlayground`. In the playground you tap Obby, Tycoon, Racing, Simulator or Tower defense and watch the chat answer and the blocks drop into a pretend Studio. The scenes are geometry in `spawnScenes.ts`; the words are catalog data. Below it: three icon steps, four safety badges (the parents' note sits behind a tap), a one-row membership strip plus the pack grid, four collapsed questions, and a closing Download band. The features grid, compare table and download prose are deleted, along with their catalog keys in all five locales.
- **Builderforce branding:** the bar is `BrandLockup` (the Builderforce mark) + "Spawn" + "by Builderforce", and the footer carries the Builderforce lockup home.
- `fetchSpawnPrices` and `fetchSpawnInstallers` share one `oncePerPage` reader. The dead `SPAWN_POST_PATH` is removed.

**Verified (Sonnet):** api type-check passes, api guards pass 37/37, and `src/application/spawn` vitest passes (27, including the new `spawnDownloads.test.ts`). Frontend i18n tests pass (118). The frontend's react-hooks finding in `SpawnDownloadButton` was fixed after the run. The other frontend guard and type failures belong to the concurrent canvas-phase work (`canvasPhaseLens.ts`, `CreationCanvas.tsx`, `DeploymentList.module.css`), not to Spawn. The three installers were built by `spawn-release.yml` run 37249949491.

## ✅ RESOLVED 2026-10-05 — Every blog article renders again, and non-English catalogs actually load on the server (frontend 2026.10.18)

**Was:** every `/blog/<slug>` page (first reported on `spawn.builderforce.ai/blog/build-roblox-games-by-talking`) rendered the route error boundary: "An error occurred in the Server Components render", digest `10747649` on every post. The page metadata rendered, but the page component threw. `loadPostBody` read the body by fetching the worker's own public hostname with `fetch(url, { cache: 'force-cache' })`. workerd rejects that cache mode, so even the English read failed, and `loadPostBody` throws when the English body can't be read. `loadCatalog` used the same fetch and **silently** fell back to English, so every server render with `NEXT_LOCALE=de|fr|es|zh` was English. In production a `NEXT_LOCALE=de` request to `/blog` showed "Latest" instead of "Neueste Artikel".

**Now:** `infrastructure/http/publishedAsset.ts` `fetchPublishedAsset` is the one reader for a deploy's published assets. On the worker it reads through the `ASSETS` binding (`getOptionalRequestContext().env.ASSETS`), so there is no self-subrequest and no cache mode. Elsewhere (browser, `next dev`, tests) it does a plain fetch, which the build-versioned immutable URLs already cache. `loadCatalog` and `loadPostBody` both use it.

**Verified (Sonnet):** `publishedAsset.test.ts`, `catalog.test.ts` and `blogLocale.test.ts` pass (31/31). eslint is clean on the 5 files. Root-closure baseline gained `infrastructure/http/publishedAsset.ts`, a dependency-free module that reads next-on-pages' request-context slot directly so that `server-only` stays out of the client and root closure. Type-check: no errors in the changed files. A separate `canvasPhaseLens.ts` TS2352 comes from concurrent work.

## ✅ RESOLVED 2026-10-04 — The Brain chat panel is one header row and one composer card; "Starting points" lives inside it (frontend 2026.10.17)

**Was:** the canvas Brain rail had two header rows (Brain + a "CHAT" caption with a Context icon) and seven unlabelled glyph buttons. Above the composer, "Choose a starting point ^" floated as a half-bordered tab belonging to nothing, the Idea / Ask Brain segment was a second floating pill outside the box it controls, the height grip sat on the card's border, and the "Entire canvas" scope select was a 9px row wedged under the text. Design: frame 0 of https://claude.ai/artifact/KcEJGhrZaQMQWEMSHNJjyE.

**Now:**
- **One composer card** (`CanvasComposer` → `.composerCard`, a grid): the intent segment and a **Starting points** button share its top row. The catalogue opens INSIDE the card above that row (`PromptUseCaseCatalog variant="inline"`), growing the card upward. The field and its tool row follow. The grip is a full-width strip along the card's top edge, and the inner `PromptPanel` stands its own border down.
- **Scope is a chip in the tool row** — `ChatInput` gained `contextPlacement: 'row' | 'tools'` — with a target icon, at 12px instead of 9px.
- **After the first message** the Starting points button stands down and the `+` menu gains a "Starting points" row (`ChatInput.addMenuItems` → `ComposerAddMenu`), which opens the same catalogue. The open state lives in `CanvasPromptComposer`.
- **One header row:** Context, Copy diagnostics, a labelled **More Brain options** menu (`BrainSurfaceMenu`, on `AnchoredPopover`: execution steps, float prompt, Brain Object / edge, dock left/right — withheld on a phone — and expand/slim), and Close. The Context view is shared between header and body through `brainSurfaceView` (one provider per placement: edge dock, Brain Object, chat surface), so the CAPTION row is gone.
- `PromptUseCasePicker` split into `PromptUseCaseCatalog` (list) + the picker (tab + dismissal, landing hero only). Its unused `placement="top"` and `align` variants are deleted. `useDismissable` now builds on an exported `useDismissOnOutsidePress` that the picker and the canvas starter share. Dead keys `creationCanvas.chat` / `showExecutionSteps` / `hideExecutionSteps` were removed; `creationCanvas.startingPoints` and `creationCanvas.brainMenu.{label,executionSteps}` were added in all five locales.

**Verified (Sonnet):** frontend `type-check` (tsc + tsgo) passes. eslint passes on all 17 changed files. Targeted tests pass: `PromptUseCasePicker`, `CanvasComposer`, `brainActivityView`, `brainMessageActions`, and the three `ChatInput.*` files (40 tests). `CreationCanvas.test.tsx` passes 87/87. The VS Code `webview/tsconfig.json` tsgo build passes. `pnpm run check` passes all 25 guards, after replacing two literal font sizes with `--font-size-small` and lowering the hooks baseline for `BrainDock.tsx` from 1 to 0.

## ✅ RESOLVED 2026-10-04 — Renaming a chat with a long title no longer fails with a 500 (api 2026.10.11)

**Was:** `PATCH /api/brain/chats/129` from Studio returned 500 (ref `4a72dc90e93d`). `api_error_log` showed `value too long for type character varying(500)` thrown in `BrainService.updateChat`. `brain_chats.title` is `varchar(500)`, but no writer bounded the title: `createChat`, `updateChat` and the `brain.create` / `brain.update` MCP tools passed it straight through, and clients that derive a title from the first prompt can send any length.

**Now:** `application/brain/chatTitle.ts` `normalizeChatTitle` is the one rule for a chat title. It trims, falls back to `New chat`, and clamps to 500 code points (what Postgres counts) with a trailing `…`, so an emoji is never split. All four free-text writers use it. The incident war-room and team/manager chat titles were already bounded.

**Verified:** `npm run type-check` (tsc + tsgo) passes. `chatTitle.test.ts`, `chatMode.test.ts` and `builtinToolAuthority.test.ts` pass (14 tests).

## ✅ RESOLVED 2026-10-04 — Synapse's Brain acts with the workspace's tools and streams its answer (desktop 2026.10.2)

**Was:** in Synapse the Brain's reply was one non-streamed gateway completion with Evermind recall (`app/src-tauri/src/cloud/brain.rs`). It could answer but not act. The web and VS Code Brains run the agent loop with platform tools. The reply also appeared all at once after a 2-second poll.

**Now:** the Brain turn runs the same client-side loop as the other surfaces:
- `bf-cloud::tools`: `Session::platform_tools(surface)` and `call_platform_tool`, over the one server catalog (`GET /llm/v1/mcp/tools`, `POST /llm/v1/mcp/call`). Synapse asks for the `delivery` surface (projects, tickets, boards, specs, OKRs, connectors), not the platform's administration tools.
- `bf-cloud::llm`: `Session::stream_chat`, an SSE reader that hands over `delta.content` as it arrives and stitches `delta.tool_calls` by index. It also reads a whole JSON body when the gateway ignores `stream`. The one-shot `Session::complete` had only the Brain as a caller and was removed.
- `cloud/live.rs` (`Replies`): each chat's reply in flight (the draft so far, the tool in use, a pending approval). It replaces the `replying`/`reply_errors` sets. The brain thread emits `brain-reply` events, and `chat_messages` returns `live` so a reopened view picks the reply up mid-stream.
- Read-only tools run at once. A tool that changes something, or that does not declare `mutates: false`, waits for **Approve / Decline** in the transcript (`chat_tool_decide`). Silence for 5 minutes counts as a decline. A decline reaches the model as `{cancelled: true}`.
- There is no limit on tool calls. After 5 tool failures in a row, the next round runs without tools, so the model answers from what it already has.
- Window: `chat/liveReply.js` updates the streaming bubble in place, and the transcript is no longer polled for the Brain's reply. New strings are in all five locales: `chat.usingTool`, `chat.toolAsk`, `chat.toolAskBody`, `chat.toolApprove`, `chat.toolDeny`, plus an updated `chat.intro`.

**Also:** `bf-vault` gained its Secret Service backend on Linux, and the dead `bf_vault::supported()` was removed. That entry stays in the roadmap until it is built on Linux.

**Verified:** `cargo test -p bf-cloud -p bf-vault`: 6 passed. `cargo test -p synapse cloud::`: 5 passed. `cargo check -p spawn`: passes. The Windows Credential Manager round-trip passes. All changed JS passes `node --check`. Live use with a signed-in account is tracked under the existing "build-verified, not yet exercised with a real account" entry.

## ✅ RESOLVED 2026-10-04 — Spawn: a Roblox game builder for creators 13+, with its own site, desktop app, membership and token packs (api 2026.10.10 · frontend 2026.10.16 · desktop 2026.10.1)

**What shipped.** Spawn (`spawn.builderforce.ai`) builds Roblox games from a description, in Roblox Studio. Competitive brief: Superbullet's 7-step setup (app + plugin + Rojo bridge + local server), billing on failed attempts and no young-creator safety layer are the gaps it closes.

- **Desktop app** `desktop/spawn` (Tauri, vanilla UI, 5 locales) + `desktop/crates/bf-roblox`: the app writes `SpawnPlugin.lua` into Studio's local plugins folder on every start, with its loopback port and a private bridge key baked in; the plugin long-polls `127.0.0.1` (key-guarded, browser origins refused), sends the Explorer tree + scripts when asked, applies each build's operations inside ONE `ChangeHistoryService` recording, and forwards play-test Output errors from the server/client DataModels.
- **Server** `api/src/application/spawn/`: `/api/spawn/build` gates age → membership → wallet floor BEFORE the model call, asks the coding pool (`completeForTenant`, `codingOnly`, metered `spawn_build`) for JSON operations, reads them through `spawnOps.ts` — paths limited to the game's services, an allow-list of classes, and refusals for `HttpService`, `loadstring`, `getfenv/setfenv`, `require(<id>)` and every asset-id property — and debits the actual token usage only when the build produced something (failed, unreadable, all-refused and declined builds are free).
- **Billing**: $1.99/month add-on membership (`spawn_plan`, a `settings` singleton — never the workspace plan) and $10/$20/$50/$100 token packs (`spawn_tokens`, a new ledger denomination), both verified against Stripe on return and on webhook.
- **13+**: birth MONTH asked once on `/spawn/account` (`users.birth_month`, mig 1198), checked conservatively (born on the month's last day).
- **Website**: `/spawn` landing (hero, how it works, features, comparison, safety, pricing from the API, download, FAQ) and `/spawn/account` (age → membership → tokens → app), own chrome, theme tokens only, all 5 catalogs (`spawn.*`). Host routing generalised into `lib/productHosts.ts` (Studio + Spawn rows; `isStudioHost`/`studioHostRedirect` retired), zone route in `frontend/wrangler.toml`, `spawn` reserved in `siteHosting.ts`, footer destination row.
- **Release + marketing**: mig 1200 release note; blog `build-roblox-games-by-talking` (+ es/fr/de/zh); `.github/workflows/spawn-release.yml` (`spawn-v*`, Windows + macOS).

**Seams fixed on the way (same pass).**
- *Paid one-off checkouts could be read as a Pro activation.* `StripeProvider.parseWebhook` sent every `checkout.session.completed` whose `purchaseKind` it did not name (comms top-ups, workforce agents, site subscriptions, extension plans) to `subscription.activated` defaulting to Pro; only a customer-id miss kept it harmless. Every self-named session is now `checkout.completed` (pay-once) or `addon.*` (recurring), dispatched through `application/billing/purchaseRegistry.ts`; comms top-ups and workforce agents now also settle when a buyer pays and closes the tab.
- *Sessions minted from a Synapse key were tagged as VS Code (roadmap 2026-09-27).* `tenant_api_keys.client` (mig 1199, backfilled from key names) is set by the device flow and stamped as `clientSurface` (`DeviceClient`) by the key exchange and kept across the workspace switch.
- *Duplicated machinery extracted:* `application/kernel/prepaidBalance.ts` (comms moved onto it), `bf_cloud::Account` (Synapse moved onto it; `AppIdentity` per app so Spawn and Synapse keep separate keys), `useWorkspaceSession` + `WorkspacePicker` shared by Studio and Spawn (`workspaceChooser` namespace).

Still open (ROADMAP, Synapse section): live end-to-end run with Studio + Stripe; unsigned installers.

## ✅ RESOLVED 2026-10-04 — Studio's AI reviews its own change in the live preview and closes the ticket (frontend 2026.10.15 · brain-embedded 2026.10.4)

In chat #129 ("Build a marketing website for he-man") the Studio fixed a pill that stretched to the card's full height and rebuilt the mobile layout. It filed both tickets, and both stayed at `in_review` (75%). It had no way to check either fix: `canvas_read_build_diagnostics` reported "no errors", and a layout bug isn't an error. It tried to dispatch the invited QA agent (402, execution switched off). No agent can reach a preview that runs in someone's browser, so nothing could ever move those tickets.

- **The agent can now inspect the preview.** New `frontend/src/lib/previewProbe/`.
  - A probe script is injected into the MOUNTED `index.html` only, never the files on disk or a published build.
  - `runPreviewProbe` loads the running preview in a hidden off-screen frame at each width, so the user's frame is never touched.
  - The tool `canvas_inspect_preview` measures what is on screen at mobile 390 / tablet 834 / desktop 1280, or at exact widths. It reports page width against viewport, elements past the edge that nothing clips, broken images, runtime errors, small tap targets and missing alt text. For each named selector it gives the rect, key computed styles and `occludedBy`.
  - `assessProbe` is the ONE pass/fail verdict. Content cut off by `overflow-x: hidden` fails, because cutting it off doesn't fix it. A fixed drawer parked off-screen is only a warning.
- **The Studio reviews its own change.** New `brain-embedded/src/previewReview.ts` is the Studio twin of `selfReviewShip.ts`.
  - The directive is VERIFY (diagnostics, then inspect at the widths the request is about), RECORD (`builtin_reviews_record` quoting the measurements), CLOSE.
  - It says that even in a staffed chat the review of a change this session made is the session's own.
  - A loop gate (`loop.recover_unreviewed_change`, one re-prompt) catches a turn that changed the app and ended without both an inspection and a review.
- **Closing the ticket.** `completeShippedTickets` became `completeLinkedTickets(select, reason)`.
  - It closes `ticketsReviewedInPreview`: a "complete" review recorded after a passing inspection that came after the run's LAST change.
  - Only tickets linked to the chat and still `in_progress`/`in_review` are closed (`linkedTicketsReviewedComplete`), and only the ones that were reviewed. The step carries `reason: 'reviewed-in-preview'`.
- **Studio edits count as code changes.** `canvas_write/edit/restore_build_file` joined `CODE_CHANGE_TOOLS`. A Studio edit now opens its ticket on the first edit, advances linked tickets, routes to the coder model, and counts as a real write in the triage honesty check.
- **Studio tools are always offered.** `STUDIO_WORKSPACE_TOOLS` / `studioToolsIn` keep the build vocabulary and the inspect tool offered every turn, and only where the inspect tool is advertised, so the creation canvas keeps its relevance-based selection. Chat #129 spent calls on `builtin_tools_find` / `builtin_tools_describe` rediscovering these tools.
- **DRY.** The head-injection arithmetic that `withPreviewErrorReporter` and `withVisualEditor` each carried is now one `lib/previewInjection.ts#injectIntoHead`. The tool name is spelled once as `CANVAS_INSPECT_PREVIEW_TOOL` (contract, guest-safe). A test pins it to brain-embedded's `PREVIEW_REVIEW_TOOL`. `check-canvas-tool-contract.mjs` now scans the new module.
- Tests: `previewReview.test.ts`, `localWorkspaceTools.test.ts`, `previewProbe/{probeScript,probeReport,inspectPreviewAction}.test.ts`.

## ✅ RESOLVED 2026-10-04 — A project started in Studio can now go to the canvas, not only canvas-born apps (api 2026.10.9 · frontend 2026.10.14)

Studio's "Open on canvas" rendered only when the project had a build record (`ide_projects` row). A Studio-born project (`useStartStudioProject`, `origin: 'studio'`) has none, so the link was hidden and `/create/build/<id>` fell through to the build list.

- **Bind in place.** New `application/project/ideProjectBinding.ts` (`ensureIdeProjectForStorage`) gives an existing project a build record without minting a second storage project. It is exposed as `PUT /api/ide-projects/by-storage/:storageProjectId`: 200 with the existing record, 201 when bound now, 404 outside the tenant. A race is safe because `storage_project_id` is unique (insert `onConflictDoNothing`, then re-read). `is_ide_storage` stays false, so the project keeps its listing, and deleting the build later only unlinks it, which the delete route already did for backfilled rows.
- **Board choice (the logged operator decision).** Settled by the existing primitive, not a new rule. `creationSessionsApi.openIdeProject` reopens the board that already holds the build. Otherwise it creates a new board named after the project, exactly as for a canvas-born app.
- **Frontend.** `BuildCanvasRedirect` calls `ensureIdeProjectForStorage` instead of giving up. `OpenOnCanvasLink` drops its probe and always renders.
- **DRY.** The modality allow-list moved from the route into the binding module (`IDE_MODALITIES`, `toIdeModality`), shared by create and bind.

## ✅ RESOLVED 2026-10-04 — Chat #129 tool-call review: stale build diagnostics, identical re-writes, and a "healthy" triage over a broken app

In chat #129 ("Build a marketing website for he-man") a MiniMax-M1 run kept failing on `Cannot read properties of null (reading 'useState')`. It re-read files, rewrote `src/App.jsx` twice with the identical 8.6 KB body, and triage still called the run healthy.

- **Root cause of the app error (already fixed).** The app had two copies of React loaded from esm.sh. The `react@18.3.1` URL carried the pins `@vitejs/plugin-react,react-dom,vite`, which is the "manifest didn't load, pin everything" fallback, and `react-dom` linked a different copy. Fixed in builderforce-webcontainers 2026.10.4 (`b91e070`, pins only the packages each package imports). The frontend shipped it at 20:02Z in `f915abbe8`. The failing turns ran at 19:36Z, before that deploy. The project's own files were never the problem.
- **Stale diagnostics.** `canvas_read_build_diagnostics` cleared failures only when a run started. An edit pushed into a live preview isn't a run, so after its rewrite the model was handed the old errors (`failures: 2 → 6`) as if its fix had failed.
  - `buildDiagnostics.ts` now tracks `markBuildSourceChanged`. It is fed by `workspaceFileEvents` (agent writes, restores) and by `writePreviewFile` (editor saves).
  - `formatBuildFailures` returns `{ current, stale }`. The tool reports stale failures separately, with a note not to rewrite over them.
- **Identical re-writes.** New `brain-embedded/src/repeatedWrite.ts` (`WriteLedger`): a full-content write (`path` + `content`) identical to the last one that landed on that path, with nothing touching the path since, is answered `unchanged` without running.
  - Matched on the call's shape, so it covers `write_file` and `canvas_write_build_file` alike.
  - find/replace edits are excluded, because repeating one isn't a no-op.
  - The "could this change any file" check is now one exported `isUnscopedMutation` in `readCoverage.ts`.
- **Triage blind to a broken app.** New verdict `app-errors-unresolved` (`unresolvedAppFailuresInTrace`): when the run's last diagnostics read still reported failures, the report says APP STILL BROKEN instead of "No failure signal".
- **Not a bug: the `<think>` text in the trace.** The trace logs "I've</think> generated…" raw. `stitchSplitSentence` already rejoins it for display.
- Tests: `repeatedWrite.test.ts`, `buildDiagnostics.test.ts` (stale/current split), `brainTriage.test.ts` (new verdict).

## ✅ RESOLVED 2026-10-04 — Studio now follows its layout mockup: one header, a framed preview, a status bar, and the project's own chat (frontend 2026.10.11 · 2026.10.13)

The operator compared the shipped Studio with the design canvas (claude.ai artifact "Studio Layout Redesign") and asked why they differed. The pass that shipped it had been built from the old screenshots' complaints, reusing the existing host components, and was never compared with the mockup. This pass works from the mockup.

- **Empty Brain panel (a real bug).** The docked chat shares its selection with the floating drawer, and that selection lives in `sessionStorage` (`brain.drawer.activeChatId`). Opening a project restored whatever chat the tab last had, from any project. Nothing then selected the project's own conversation, so a built site sat next to an empty or foreign thread. New `usePinnedProjectChat` runs once, after the project's chats load. A selection outside the project gives way to its most recent chat. A deep link, ticket or prompt keeps the selection it asked for. Tests: `usePinnedProjectChat.test.ts`.
- **Header.**
  - The header reads `Projects / <name>`. The title sizes to the name and no longer looks like a form field.
  - The view switch says **Data**, not "Database".
  - A `Saved · vN` chip (`WorkspaceVersionChip`) opens Versions.
  - The plan, the avatar and Sign out are one account pill with a menu (`StudioAccountControl`: plan and upgrade, settings, feedback, sign out).
  - Publish is a split button whose ▾ offers the repository and deploy settings.
  - Team chat moved from the header to the Brain panel's chip row.
  - The plan logic is one hook, `lib/usePlanSummary.ts`, used by both `PlanBadge` and the pill.
- **Brain panel.**
  - `BrainDockedHeader`: ✦ Brain with History (a toggle, still badged), New chat and Expand as icon buttons. The Chat / History tab strip is gone.
  - The context line is a row of chips: what the agent sees, and Team chat.
  - Composer: the placeholder is "Describe a change, or ask a question…" on the build surface. The footnote is one line ("You approve every change before it ships. How AI works").
  - In compact density, the `/` trigger reads as one chip (`⚡ Work · model ▾`). This is CSS only (`composerCompact.module.css`), so VS Code is unchanged.
- **Preview.**
  - The toolbar has Back / Forward, which travel through a new `PREVIEW_NAV_MESSAGE` in the overlay the preview already carries.
  - The address bar adds "updated 12s ago" (`usePreviewFreshness`).
  - Select to edit is a labelled button.
  - The app is framed as a page on the workspace ground, not a full-bleed hole.
  - Stopped preview: shows the recorded error. **Fix it for me** sends it to Brain through a new `DockedBrain.ask`, using the same gate and queue as a typed message. Versions and Show terminal sit beside it.
  - Empty project: three starter suggestions that fill the chat (never send).
  - An agent turn landing shows **Preview updated · N files · Undo** (`PreviewChangeToast`). Undo restores the version before the turn.
- **Status bar.** Closed, the bottom panel reads `● Running · ✓ No problems … Terminal ▴` (`RunStatusItem`). Check and "Block preview on failed checks" are in the opened panel.
- **Chrome bleed.**
  - The app's fixed starfield painted over every non-positioned Studio surface. The Studio root is now its own stacking layer.
  - The Feedback edge tab sat on the preview. On `/studio` the form opens from the account menu (`lib/feedbackEvents.ts`).
- **One versions recorder.** `useProjectVersions` moved from `VersionsPanel` into `useBuilderWorkspace` (`ws.versions`). The panel, the header chip and the toast read one instance. A second caller would have recorded every turn twice.
- **i18n.** New and reworded keys in all five catalogs. Removed the now-dead `brain.tabChat`, `brain.tabHistory`, `brain.sectionsAria`, `ide.brainContext.codingAgent` and `ide.brainContext.voiceDirector`.
- **Tests.** `PreviewStatus.test.tsx`, `PreviewChangeToast.test.tsx`, `usePinnedProjectChat.test.ts`. `BuilderWorkspace.modality.test.tsx` gained breadcrumb, version-chip and status-bar cases.
- **The four items first left over, closed the same day (operator: "Why did you not resolve these?").**
  - **Readable preview address.** The toolbar shows `<project>-preview.builderforce.ai/<path>` (`lib/browserRuntime/previewAddress.ts`). It is a display name, by the operator's call: the in-browser preview is one relay origin whose service worker serves every project, so a real host per project would need a relay per origin. `<project>.preview.…` would also need a second-level wildcard certificate that Cloudflare's free plan does not issue. The real URL stays in the tooltip and behind Open in a new tab.
  - **Files-changed card in the chat.** `TurnChangesCard` sits under a turn's last reply. It shows "N files changed", each path opens in the Code view (new workspace command `openFile`), and Review changes opens Versions. The files come from the turn's persisted steps, read by result shape (`{ applied: true, path }` / `{ created }`) rather than tool name (`lib/brain/turnChanges.ts`). It is web-only through the existing `renderAssistantActions` hook, so no brain-ui release was needed. It renders only beside the workspace that owns the files.
  - **Build / Ask.** Mode names are catalog data selected by surface (`lib/brain/useChatModeCopy.ts`). The build surface reads Ask / Build (`brain.buildModes`) and everywhere else keeps Chat / Work. One hook feeds the `/` menu, its trigger and the empty-state toggle. The hints are accurate rather than the mockup's: Ask can still edit files, so it does not claim "changes nothing".
  - **Collapse panel.** The docked Brain's header has a hide button (new `headerActions` slot). On a wide screen the workspace header then shows a Chat button to bring it back. The column stays mounted, so the conversation survives.
- **Deliberately not built:** the "Link ticket" chip (the chat's ticket strip already does it, and a second control would duplicate it) and "vite · :5173" in the status bar (the runtime does not report a server name or port to the UI).

## ✅ RESOLVED 2026-10-04 — Studio: one chat panel, and generated media is previewed before the app uses it (api 2026.10.8 · frontend 2026.10.10)

Operator report: the 💬 in the Studio header opened a second chat panel on the right while the Brain was already docked on the left. Also asked: how do people see generated images and video before they go into the app? Decision: **always preview first**.

- **One chat panel.** `TeamChatButton` opened the floating Brain drawer even where the Brain is docked.
  - `lib/brain/dockedBrain.tsx` (`DockedBrainProvider`, mounted by `BuilderWorkspace` when the modality docks the Brain) tells the button to select the team chat in the docked panel and reveal it instead.
  - The drawer only opens on surfaces with no docked panel.
  - The same context lets a neighbouring surface seed the docked composer (`useDockedComposerSeed`). It never sends.
- **The Media panel** is a new rail tab `media`, on Designer, Mobile and Web+Mobile, and in browser-held workspaces too.
  - `useMediaStudio`, owned by `useBuilderWorkspace`, so Studio and the canvas App surface share it: the library plus the review broker.
  - `useProjectMediaLibrary`: generate, record, resume rendering videos, mark used, remove.
  - The panel itself is `MediaPanel` (composition) with `MediaReviewCard`, `MediaGenerateForm`, `MediaLibraryGrid` and `MediaPreview`.
- **Preview first.** `generate_image_asset` and `generate_video_asset` now run through `generateReviewedMedia`:
  - Generate, then show the item in the panel, then wait for the person.
  - **Use it** returns the URL and marks it in use. **Try again** re-renders with the edited prompt, up to 4 times. **Discard** returns a decline the model must respect.
  - "Use in app" on any library item seeds the docked composer with a ready-made request.
- **Storage.** There is no new table. Each item is a `kernel.artifacts` row (kind `image`/`video`) on the project's registry object (`objects` kind `project`), via `application/media/projectMedia.ts` and `/api/projects/:projectId/media` (GET/POST/PATCH/DELETE).
  - Status is `rendering`, `ready` or `failed`; `attrs` holds url, prompt, model, jobId, error and usedAt.
  - The list is read-through cached per project and invalidated on every write.
  - The ownership gate is `projectInTenantCached` / `loadProjectInTenant`.
- **i18n.** `ide.rightTab.media` and `ide.media.*` are in all five catalogs.
- **Shipped with:** release note migration `1197`, plus a "You see it first" section and update banner in the blog post `studio-makes-the-images-your-app-needs`.
- **Verified (targeted):**
  - api type-check and nine guards (layering, application-layering, project-ownership, unvalidated-bodies, db-access, tenant-scope, signature-duplication, domain-boundary, source).
  - `projectMedia.test.ts`.
  - Frontend typecheck, `check:i18n-keys`, `check:architecture`, redundant-use-client and silent-catches.
  - Frontend vitest: 6 files, 28 tests, plus `canvasAppSurface.test.tsx` (13).

## ✅ RESOLVED 2026-10-04 — Go back and forth between a canvas app and Studio (frontend 2026.10.9)

Request: "from the canvas you should be able to launch the app directly into the studio as well => go back and forth as needed."

- **Canvas to Studio.** The App surface's "Open in Studio" was an unlabelled icon among the panel toggles that opened a new tab. It is now a labelled link (`.appStudioLink`, canvas palette in both themes) that opens the same app in Studio in the same tab.
  - The address bar's external-link button still opens the raw live preview, as it does in Studio.
- **Studio to canvas.** This direction was new. `OpenOnCanvasLink` sits in the Studio project header and links to `canvasAppPath(publicId ?? id)`, and `BuildCanvasRedirect` lands on the App surface of the board that holds the app.
  - It shows only when the project has a canvas build. A Studio-born project has none, which is logged in the Gap Register with its blocker.
  - Localized in all five catalogs (`studio.project.openOnCanvas`, `openOnCanvasTitle`).
- **ONE spelling of the canvas-app path.** `lib/studio/studioHost.ts` `canvasAppPath()` sits beside `studioProjectPath()`. Every hand-built `/create/build/…` string now uses it:
  - the Brain conversation header, the project Workspace tab, Project 360's actions, `ProjectCard` and `ProjectTable`;
  - the Brain's `open_project` and `ide_project` routes;
  - the `/ide/<ref>` middleware redirect.
  - Root closure 331 → 332, argued in the guard header. The module is import-free and already ships in the middleware.

## ✅ RESOLVED 2026-10-04 — Studio previews crashed on the first hook; Studio still asked for a workspace (frontend 2026.10.8 · webcontainers 2026.10.4)

Report: "This was deployed but it's not working on the studio — this shouldn't be shown." Studio showed "Choose a workspace", and the generated He-Man app's preview failed with `Cannot read properties of null (reading 'useState')`. The Brain could not fix that error, because it was not in the app's code.

- **Two Reacts in every preview.** The cause was in `builderforce-webcontainers` `packages/core/src/packageCdn.ts`.
  - Every declared package's esm.sh URL carried `deps=` for every OTHER declared package. So the app imported `react?deps=react-dom,vite,…`, which is a distinct esm.sh build.
  - Meanwhile react-dom's own `import 'react'` links to the plain build, carrying only the pins react itself uses (none). This was verified against esm.sh.
  - Result: two React instances, and the app's first `useState` read a null dispatcher. It hit every React app with a hook.
- **Fix (2026.10.4).**
  - `esmShCdnFactory` is now async. It loads each declared package's `package.json` from the CDN (`loadPackageManifests`, cached per session), and a package's URL pins only the declared packages it depends on or peers on. That is exactly the module esm.sh links to.
  - Undeclared packages, and any whose manifest fails to load, still carry every pin.
  - The dev server caches the CDN as a promise, and `buildProject` awaits it.
  - Tests answer manifest requests offline (`tests/offlineManifests.ts`). The build test that asserted the broken `jsx-runtime?deps=` shape was corrected.
- **Workspace picker in Studio.** No account had a default yet, because the defaults people set before 2026.10.7 lived only in browser storage.
  - `getMyTenants` now adopts that legacy key once (`takeLegacyDefaultTenantId`, then `saveDefaultTenant`).
  - A first hand-made pick, made with several workspaces and no default, becomes the default (`rememberWorkspaceChoice`) in both `/tenants` and Studio (`useStudioWorkspace`). The picker is asked once.
  - `saveDefaultTenant` in `auth/credentials` is now the ONE client for `PUT /api/auth/default-tenant`, and `workspacesApi.setDefault` was removed.

## ✅ RESOLVED 2026-10-04 — Default workspace forgotten on every sign-in; `/tenants` crash (api 2026.10.7 · frontend 2026.10.7)

Report: "Setting a default tenant is not being saved — users consistently have to select their tenant even though a default has been set." A second ticket the same day: `/tenants` crashed with `TypeError: useEffectEvent is not a function`.

- **Default workspace: root cause.** "Set as default" only wrote `bf_default_tenant_id` to localStorage, and `clearSession()` deleted that key on every sign-out and every 401/expired session. That is exactly when the default is needed to skip the picker. It also never left the browser, so a second device always asked.
- **Default workspace: fix.** The default now lives on the account.
  - Migration 1196 adds `users.default_tenant_id` (FK to tenants, ON DELETE SET NULL).
  - `IUserRepository.get/setDefaultTenantId` and `AuthService.setDefaultTenant` handle the write; only a member can set a workspace as their default.
  - `PUT /api/auth/default-tenant` sets or clears it, and `GET /api/auth/my-tenants` returns `defaultTenantId`, which applies only while the person is still a member.
  - Frontend: `getMyTenants` marks `Tenant.isDefault`. ONE `autoSelectTenant` rule (the only workspace, else the default) is used by sign-in (`resolveAndSelectTenant`), the `/tenants` picker, onboarding (`selectSoleTenant`) and Studio (`useStudioWorkspace`). The last two had their own "exactly one" copy that ignored the default. `workspacesApi.setDefault` saves it, applied optimistically with rollback.
  - The localStorage helpers and the QA harnesses' seeded key were deleted.
- **Crash (shipped first, `4c8f15e99`).** Next 15.5's App Router renders with its vendored React (`19.2.0-canary-20250818`), which does not export `useEffectEvent`. The `react@19.2.8` in package.json type-checks it but is not what runs. `CreationCanvas` and `useCanvasSessionSync` now use `@/hooks/useEffectEvent`, built on `useLatestRef`. An eslint `no-restricted-imports` rule bans importing it from `react`.

## ✅ RESOLVED 2026-10-04 — Video: clips, planned scenes and movies on the canvas and in Studio (api 2026.10.6 · frontend 2026.10.6)

Request: "Because we generate images, we now need to generate video and scenes and movies." Operator decisions: cheap models first, quality models on Pro; assembly in the browser, plus an offline server render on paid plans; surfaces are canvas scene and video objects, Studio agent tools and canvas Brain tools.

- **Vendors.** `application/llm/mediaVendorRegistry.ts` is ONE interleaved, vendor-prefixed pool, used by both images and video. `imageVendors/registry.ts` was rebuilt on it, which fixes the prefixed-tier bug. `videoVendors/` holds two vendors:
  - Pollinations: `wan-2.2-fast` (free), `seedance-1-pro-fast` and `veo-3.1-fast` (paid).
  - Google AI: `veo-3.1-fast-generate-preview` (paid).
  - `videoModelChainForPlan` returns the free chain or the paid chain.
- **Jobs.** A clip takes from 30 s to minutes, so `/llm/v1/videos/{generations,renders}` returns 202 with a job id, and `GET /jobs/:id` reports status.
  - `MediaJobDO` advances `advanceMediaJob` on its own alarm, with a 20-minute deadline. It stores the result in tenant R2 and logs usage per second.
  - Another tenant's job reads as 404.
- **Credits.** The credit gate is shared by image and video (`presentation/routes/mediaCreditGate.ts`, `application/llm/mediaCredits.ts`). Video is billed in seconds against `videoSecondsDailyLimit`: free 15, pro 120, teams 600. The gate reserves the longest clip any model in the chain could bill.
- **Server render.** `serverVideoRender` is a new plan feature: free false, Pro and Teams true. It gates `POST /renders` with a 402 through `featureGateBody`.
  - `MediaRenderContainerDO` is an ffmpeg container (`api/media-render/`). It takes a request built by `buildMovieRenderRequest`, which only accepts tenant-owned asset keys and SSRF-checked URLs.
  - In the canvas, `ServerMovieRenderButton` sits next to the browser export and renders null without the feature. `useServerMovieRender` keeps the job id on the `video` object (`serverRenderJobId`), so the render outlives the tab and the next visit lands the MP4.
- **Canvas scene.**
  - The `CanvasSceneSpec` contract gained `engine` (cloud/device), `aspectRatio`, `storyboard`, `shots` and `canvasSceneMovie`.
  - The scene panel is split into `scene/SceneCloudBody`, `SceneDeviceBody` and `SceneShotList`, with orchestration in `hooks/useCloudScene`.
  - Shots are planned by the studio planner (`lib/sceneStoryboard`) and rendered three at a time (`lib/sceneRendering`), resuming in-flight jobs. "Make movie" lands a `video` object on the timeline editor.
- **Brain and Studio.**
  - `canvas_add_video` and `canvas_create_scene` (`actions/video.ts`) are guest-gated (`canvasVideoTools.ts`), and the PICTURES block of the canvas prompt names them.
  - The Studio agent has `generate_video_asset`.
  - `check-canvas-tool-contract.mjs` now resolves tool-name constants from every contract module, not only `canvasTools.ts`.
- **i18n.** `creationCanvas.scene.*`, `videoEditor.*` (server render), `gateVideo*` and `video.*` are in all five catalogs.
- **Shipped with:** release note migration `1195` and the blog post `make-video-scenes-and-movies-on-the-canvas`.
- **Verified (targeted):**
  - api type-check plus all 37 `npm run check` guards.
  - api vitest: 13 files, 225 tests.
  - Contract `scene.test.ts`.
  - Frontend typecheck plus `check:i18n-keys`.
  - Frontend vitest: 8 files, 38 tests, including the new `videoGenerationApi`, `sceneStoryboard`, `sceneRendering`, `useServerMovieRender`, `actions/video` and `generateVideoAssetAction` tests.

## ✅ RESOLVED 2026-10-04 — The Creation Canvas god files are split, and the Brain's 68 canvas tools are no longer rebuilt on every edit

Gap Register entry "Codebase review 2026-09-05 — `CreationCanvas.tsx` is 13,857 lines and its size ratchet cannot see it grow".

- **`CreationCanvas.tsx` 14,642 → 1,171 lines.** `CanvasInner` is now a composition root: about 50 `hooks/useCanvas*` hooks (session, session sync, presence, scope, editing, interaction, proposal review, Brain turn, publishing, surface state, …), `brainTurn/` (snapshot, participants, group turn, settle), and module helpers (`canvasSeed`, `canvasBoardLoad`, `canvasNodeHelpers`, `canvasArtifactExport`, `canvasFileDrop`, `canvasReleaseEvidence`, `canvasAgentTest`, `canvasProjectSync`, …). Chrome lives in `chrome/`, the stage in `stage/`, and the lazy panels in `canvasLazyPanels`.
- **`canvasActions` (one 4,258-line `useMemo` with 33 deps, `nodes`/`edges` among them) → `actions/*.ts`,** 16 domain modules of 186–361 lines plus `context.ts`. The tools read the live board through getters on a stable `CanvasActionContext`, so a board edit no longer rebuilds them. Before, `stageImageAsset` was re-created on every render and sat in the deps, which rebuilt all 68 tools on every render, not only on edits.
- **The 74-prop Inspector → `inspector/CanvasInspector.tsx`,** which reads its bindings from `CanvasInspectorProvider`. The kind sections are separate files.
- **`CreationNode.tsx` 3,102 → 391 lines.** About 40 `*Body` renderers moved to `bodies/<kind>Body.tsx` behind a typed registry and `CreationNodeActionsContext`. **`BrainPanel.tsx` 1,961 → 37** (19 hooks, 16 panel modules), **`ChatInput` 785 → 262**, **`CanvasCommands` 722 → 143**.
- **React rules.** All 122 split files, `CreationCanvas.tsx` included, are at 0 react-hooks findings; its baseline of 92 is gone. Render-time ref writes go through `hooks/useLatestRef.ts` (insertion-effect sync). Factories that closed over refs became module-level builders. Stale closures were fixed by real deps, and inputs no hook read were dropped. No `eslint-disable` was added.
- **The size ratchet now sees size.** `check-frontend-architecture.mjs` holds a per-file line ceiling (`oversizedProductionFileLines`): growth fails ("split it, do not raise the ceiling"), shrinkage is reported as slack, and a new file over 800 lines fails. The `CreationCanvas.tsx` ceiling is 1,172.
- **Found and fixed on the way.**
  - Hardcoded English scope labels, lock/hidden notices, review-applied notices and the website publish account prompt are now localized in all five catalogs, with ICU plurals; "1 reviewed Brain changes" now reads "1 … change".
  - The test-only offline-turn branch is out of production; `src/test/canvasTurnRunnerMock.ts` replaces it.
  - A comment-only catch in `localFileStore.writeRecord` now reports through `reportBackgroundFailure`.
  - The object lock no longer releases and re-acquires on every save.
  - `CreationCanvas.build.test.tsx` now asserts the guest flow, a browser-held workspace on the App surface. It also clears storage between tests, so the remembered App surface no longer leaks from one test into the next.

## ✅ RESOLVED 2026-10-04 — The canvas App surface IS the Studio workspace (frontend 2026.10.5)

Pressing **App** on a canvas now opens the full Studio workspace in place. It replaces the old single-document preview frame. Operator decisions (2026-10-04): a guest runs a browser-held workspace that "Keep your work" promotes; existing code cards are converted silently; one primary app per session, with a switcher only when there is a second.

- **One workspace, two layouts.** The hook `useBuilderWorkspace` holds the workspace's state. Three shared regions render it: `WorkspaceCenter`, `WorkspaceSidePanels` and `WorkspaceOverlays`. `BuilderWorkspace` is now the Studio layout. `CanvasAppWorkspace` is the canvas layout, and it puts its controls into the session bar through ONE `CanvasBarGroup`: Run, view tabs, Files/Terminal/Publish/Open in Studio, the app switcher and a local badge. `.appWorkspace` maps the shell tokens to the canvas palette, so it works in light and dark.
- **A file-store port.** `WorkspaceFileStore` (`lib/workspace/`) has two adapters: `serverFileStore` and `localFileStore` (IndexedDB, single-flight load, in-memory fallback). `WorkspaceId = number | local:<key>` replaces the storage-project id in diagnostics, the command bus, file events, run, files, point-and-edit, search and the Brain's build tools. A local workspace offers Preview and Code, plus Files, and leaves out the panes that need a project.
- **Session app.** `lib/canvasSessionApp.ts`:
  - `sessionApps`, `primarySessionApp`, and ONE writer of the `appPrimary` flag (`withPrimaryApp`).
  - Code cards are imported silently, hashed per card. The root `index.html` redirect is added only when the entry card itself is imported.
  - `canvasAppLocalKey`.
  - `useCanvasSessionApp` creates and provisions apps, imports cards, and promotes a local app to a durable project once the board is claimed.
- **Guests build.** The contract moves the build tools (create, list, read, search, write, edit, diagnostics) to `GUEST_SAFE_CANVAS_TOOLS`. History and restore still need an account. `hasCodeWorkspace` and `appModalityFor` (`lib/canvasBuildTools.ts`) are the ONE rule for which types a browser-held app can be: the start picker, the inspector, the create tool and provisioning all use them.
- **The build card.** The card and its inspector recognise a browser-held app ("In this browser"). The inspector opens it, and its delete control discards it. The inspector's list of existing projects is now derived during render instead of set inside an effect.
- **Deep links.** `?chat` and `?ticket` links to a build go to Studio (`lib/studio/studioDeepLink.ts`). Plain build links open the canvas App surface. `buildChatId` and `buildTicket` are gone from `ActiveCanvasContext` and the session client.
- **Retired.** The canvas build dialog (`CanvasBuildPanel`), `canvasApp`/`canvasAppDocument`/the frame sandbox, the runner CSS and the `.buildFocusBody` CSS, plus ten orphaned `creationCanvas.build.*` keys in all five catalogs.
- **Shipped with:** release note migration `1194` (2026.10.5) and the blog post `your-canvas-app-is-a-real-project`, with update banners on `run-your-app-on-the-canvas` in all five locales.
- **One Publish door** (operator decision, 2026-10-04; closes the "two Publish doors" gap opened earlier the same day). The surface-actions seam gained `publish?: { run, active }`. While App is open on a durable app, the bar's ONE Publish (`useCanvasSessionActionHandlers`, so the desktop bar, Make it real menu and phone sheet all use it) opens the app's `SitePublishPanel` and not the board's release lifecycle. The App surface's own Publish glyph and the `surface.app.publish` key are gone. A browser-held app contributes nothing, so Publish keeps the board's account gate.

## ✅ RESOLVED 2026-10-04 — Image generation: four more free vendors, durable links, Studio's agent can make pictures, and a split + hardened diffusion engine

- **More image vendors in the gateway cascade** (`api/src/application/llm/imageVendors/`). New modules: `cloudflare.ts` (Workers AI: Flux Schnell, SDXL Lightning, DreamShaper 8 LCM FREE; Leonardo Lucid Origin / Phoenix STANDARD), `huggingface.ts` (Inference Providers: Flux Schnell, SDXL; FREE), `pollinations.ts` (gen.pollinations.ai with an `sk_` secret key: Flux Schnell, Z-Image Turbo, DreamShaper LCM; FREE) and `googleai.ts` (Gemini 2.5 Flash Image STANDARD, Gemini 3 Pro Image PREMIUM, on the existing `GOOGLE_API_KEY`). Together and FluxAPI are kept. NVIDIA was left out at the operator's request.
- **One copy of everything.** The registry derives its by-id map, its vendor prefixes and the health-probe vendor list from ONE `MODULES` array. A new `anyImageVendorBound(env)` replaces the route's hardcoded "Together or Flux" check. `ImageProxyService` passes env straight through (the hand-written key mapping is gone). The size parser and aspect-ratio ladder moved to `types.ts` (Together and FluxAPI migrated). `readImageBody` / `imageResultFromBase64` / `noImageError` normalise byte-producing vendors. Unused `imageModelsByTier` and the unused module re-exports in the barrel were deleted. `webScreenshot.ts`'s private `bytesToBase64` was migrated to `domain/shared/bytes`.
- **Transport.** `executeVendorPost` gained `method` (GET), `authorization` (override or omit, for Google's `x-goog-api-key`) and `readOk` (bytes). For images only, 402 (credit spent) now cascades to the next vendor instead of failing the request.
- **Cascade.** Pools are interleaved by vendor, so one vendor's outage can't use up the free budget, and the FREE budget went from 2 to 3 attempts.
- **Durable links.** `persistGeneratedImages` stores `data:` results in the tenant asset store (`storeTenantAsset`) and returns `/api/assets/<key>`, so consumers never persist megabytes of base64.
- **Studio can make images.** New `generate_image_asset` Brain action (`components/builder/generateImageAssetAction.ts`, registered in `useWorkspaceBrainActions`) returns a durable URL the agent writes into the app. The canvas and Studio share ONE client, `lib/imageGenerationApi.ts` (`generateCanvasImage` migrated). Release note: migration 1193. Blog: `studio-makes-the-images-your-app-needs`.
- **Diffusion engine** (`studio/src/engine/`). The 1,140-line `diffusion-engine.ts` is now five modules: `diffusion-models.ts` (registry), `diffusion-schedule.ts` (pure schedule, noise, the in-place LCM step, guidance), `ort-session.ts` (tensor/session helpers, error translation), `progress.ts` and `abort.ts`. The engine class kept the session lifecycle. Behaviour changes:
  - A failed `init()` now releases the sessions it had already created.
  - Prompt embeddings are memoised per engine (LRU of 8, copy-on-read).
  - `denoise` takes an `AbortSignal` and checks it between UNet steps. Video-engine passes it through, and its seven inline abort checks now use `throwIfAborted`.
  - `denoise` validates latent and embedding shapes before the first UNet run.
  - The step loop and the CFG mix work in place.
  - `alphaCumprodAt` clamps and rounds timesteps instead of falling back to ᾱ=0.001.
  - The deprecated `explainSessionCreateError` alias was removed.
- **Tests.** `freeImageVendors.test.ts`, `persistGeneratedImages.test.ts`, new interleave/Cloudflare cases in `ImageProxyService.test.ts`, `generateImageAssetAction.test.ts`, `diffusion-schedule.test.ts`, `diffusion-engine.lifecycle.test.ts`.
- **Versions.** api 2026.10.5 · studio 2026.10.1.

## ✅ RESOLVED 2026-10-04 — Studio workspace: one header row, a preview that starts by itself, a two-row composer

From operator screenshots of project #67: two stacked header rows of actions, a preview squeezed between a 300px file rail and a 240px terminal that said "Run your project to see a preview", and a composer with nine controls in four rows.

- **One header row.** `BuilderWorkspace` renders `WorkspaceHeader` (projects · host mark · rename-in-place title · type chip | Preview · Code · Data | plan · team chat · ⋯ · host actions). Studio no longer stacks `StudioTopBar` over an open project: it passes `StudioBrand compact` and Share / Publish / account as `headerLeading` / `headerTrailing`. The Studio GitHub button is gone (it opened the same settings panel as the cog); settings, details and every side panel live in one `WorkspaceMoreMenu`. Collab presence is a dot, not a second "Live" label that was easy to read as the preview's.
- **No Run button.** `useAutoRun` starts the preview when the workspace opens and whenever the file list changes while nothing is live; it never restarts a live preview (hot reload carries edits) and after a failure waits for new input rather than looping. The run pipeline moved to `useWorkspaceRun`, which now reports a `RunPhase`/`RunStep`, and `PreviewStatus` shows starting (with steps), failed / blocked (Try again, Show terminal), or empty. `hasLivePreview()` in `lib/modality.ts` decides which types get this; Voice keeps its Generate button (`VoiceGenerateButton`). `showRunButton` is unchanged — it still feeds the canvas dev-server pill.
- **Bigger preview.** `PreviewPane` toolbar: restart, live address, Point & edit (`usePointAndEdit` + `PointAndEditPanel`, which used to be a permanent bar under the preview), desktop / tablet / phone widths, open in a tab. The side panel (`WorkspaceRail`) is closed by default for live-preview types, opens itself for Code, and stays mounted while closed (Versions records per turn). The bottom panel starts collapsed to a status bar that carries Check and "Block preview on failed checks" (`ChecksControl`, was `Gate Run` in the header).
- **Composer.** `ChatInput` / `BrainPanel` gained `density="compact"`, used by the workspace's docked Brain: context pickers join the tool row, the plan/memory row is dropped (plan chip moved to the workspace header; memory is in the `/` menu), and "Acting as" / "Making" render only when they are a real choice.
- **Narrow screens.** Below 760px chat and workspace take turns behind a Chat segment in the same view switch; the chat column stays mounted so the conversation survives the switch.
- **God-file split.** `BuilderWorkspace.tsx` 1,666 → ~420 lines: `useWorkspaceLogs`, `useWorkspaceRun`, `useAutoRun`, `useWorkspaceFiles`, `usePointAndEdit`, `useArtifactReviews`, `useWorkspaceBrainActions`, `useWorkspaceBrainContext`, plus the presentational pieces above. `PreviewFrame` is now the iframe only.
- **i18n.** New `ide.workspace.*` in all five catalogs; `ide.gateRun` / `ide.blockOnFailHint` reworded; dead `ide.previewEmpty`, `ide.previewOpen`, `ide.projectSettingsAria`, `ide.runtimeStatus`, `studio.project.github` removed. Also closed a stale Gap Register entry ("the Builder run terminal is hardcoded English"): every run-log line already goes through `ide.runLog.*` (39 keys, translated in all five catalogs).
- **Tests.** `useAutoRun.test.ts` pins when the preview starts; `BuilderWorkspace.modality.test.tsx` adds no-Run-button / empty-state and host-actions-in-the-one-header cases.

## ✅ RESOLVED 2026-10-04 — VS Code sidebar: eight sections merged into five (Work, Inbox, Changes, Health, Evermind)

- Sessions + Project & Tasks → **Work**; Inbox + Meetings → **Inbox**; Insights + Diagnostics → **Health**. VSIX 2026.10.4.
- New primitive `clients/vscode/src/sectionedTreeView.ts`: one view composed from existing tree providers as collapsible groups. It hands each provider's own elements to VS Code (no wrapping), so every context-menu command still receives its original argument, and it scopes item ids per group so two providers can never collide on an id.
- `sidebarViews.ts` assembles the three views; `projectContextTree.ts` takes the workspace/project rows out of `projectsTree.ts`; `inboxTree.ts` splits quick actions into their own provider; Insights/Diagnostics/Meetings stop creating views of their own. `MeetingsController`, `refreshWorkspaceHeader`, the `refreshMeetings` command and the old view ids, welcome texts and nls keys are removed.
- Also fixed while there: the duplicated run-host/panel callbacks in `extension.ts` are one pair; the tasks and insights rows that were hardcoded English now go through `vscode.l10n.t` with de/es/fr/zh-cn translations.

## ✅ RESOLVED 2026-10-03 — Studio, round two: the agent handed over CSS instead of writing it, the name printed twice, the composer was four scrambled rows, and Upgrade was on screen twice

The first pass removed the name from the Studio bar but missed the real duplicate one row down.

- **Name shown twice.** A Studio project's name is the prompt's first six words and its description is the whole prompt, and `BuilderWorkspace`'s bar rendered both side by side ("Build me a marketing websi — Build me a marketing website f…"). New `lib/projectSubtitle.ts` returns the description only when it says something the name does not (ignoring case, whitespace and a trailing ellipsis); tested against `projectNameFromPrompt` itself. Both fields are still stored; only the restatement is hidden. The bar's hardcoded "Details" now uses the existing `ide.details` key.
- **Composer scrambled.** `ChatInput` put the `+` menu, the `/` menu, Acting as, the capability picker, To, the plan chip, the Evermind badge and the mic in ONE wrapping flex row, so a ~320px Brain panel broke it into four lines at random. The shared `PromptPanel` (brain-ui) now owns three rows: `context` (Acting as · capability · To / canvas scope), the tools with Send pinned right, and `meta` (plan chip + memory status, right-aligned). Web and VS Code composers both moved to it; `ChatInput`'s `modeControls` lost its last caller and was deleted. brain-ui and the extension bumped to 2026.10.3.
- **Upgrade twice.** `StudioProjectActions` had its own free-plan Upgrade link while the composer's `PlanBadge` already says "Free · Upgrade". The bar's link is gone, with its `studio.project.upgrade` key in all five catalogs.
- **The agent could not write a file, then asked the user to paste the CSS.** Two causes, neither of them the model. (1) The composer's Effort ceiling (`max_tokens` 4096 on Balanced, 2048 on Quick) applied to tool-calling turns, and a file write is output: three consecutive ~12 KB `canvas_write_build_file` calls stopped at exactly 4096 completion tokens, mid-JSON. The malformed-call guard from the first pass was live (CI rebuilds `brain-embedded` via `prepare`), so each came back "cut off — re-issue it smaller", which a whole file cannot be. New `turnMaxTokens` in `brain-embedded/src/effort.ts` raises any turn that advertises tools to `TOOL_TURN_MIN_MAX_TOKENS` (Thorough's 16384 — a value every vendor already receives; a ceiling is not a spend), applied once in `brainRunStore` so web, Studio and VS Code all get it. The Grok adapter had already dropped the cap for its own vendor for this reason. (2) The prompts permitted it: the Website persona said "use a normal code block so the user can apply it" and hand-named `create_file`; the mobile personas and all five build capabilities required path-tagged code blocks. One exported `FILE_DELIVERY_RULE` (write files with your file tools, edit in place, never hand code over, retry a failed write, code blocks only on a surface with NO file tools) now rides every builder persona and every build capability, and names no tool, per the prompt tool-name contract. Pinned by `turnMaxTokens.test.ts`, `fileDeliveryRule.test.ts` and `capabilities.test.ts`. `brain-embedded` bumped to 2026.10.3.

## ✅ RESOLVED 2026-10-03 — Studio: the agent could not write files, and the screen said everything twice

From a Studio session on project #67 — duplicate titles, duplicate upgrade prompts, and a wall of red 404s.

- **The agent could not write files, and nothing said why.** The run's own trace: `canvas_write_build_file` called four times with ~12.5 KB of arguments, every call answered `A path is required.`, the repeat-failure guard firing at attempt 3. The tool was not at fault and neither were the arguments — every one of those turns ended on exactly 4,096 completion tokens, so the JSON was cut off mid-string. The kernel's policy is that bad JSON never aborts a run (`parseToolArgs` → `args: {}` + `malformed: true`), which only works if the consumer then DECLINES TO RUN the call. `creationCanvasAi.ts` declined. **`brainRunStore.ts` had no such guard**, so it dispatched `{}` and the tool said the only thing it could — leaving the model to re-send the same oversized call until the run was spent. Fixed where it cannot drift again: `malformedCallOutcome`/`malformedCallLabel` now live in `@builderforce/agent-loop` beside the parse that sets the flag, exported from the same barrel, and BOTH loops call them. The two messages stay opposite on purpose — a truncated call must be made smaller, a malformed one is the right size and encoded wrong, and telling a cut-off model to "send valid JSON" is what sends it round the loop. The canvas keeps its own `CANVAS_TRUNCATED_RETRY_HINT` (naming `canvas_update_object`), which is true there and meaningless elsewhere.
- **Duplicate titles.** The project name was on screen three times in two stacked rows: `StudioTopBar`'s `title`, the workspace's rename field, and its description — each truncated differently. The bar no longer takes a `title` at all (prop deleted, not just unused); the workspace owns the project's identity.
- **Duplicate upgrade prompts.** Three at once: the bar's `Upgrade` link and `PlanBadge` in BOTH the docked Brain header and the composer inside that same panel. The header chip is gone; the composer's stays, because that is where the allowance is actually spent.
- **The wall of 404s.** `siteDomainApi.get` and `siteDataApi.listCollections` answer 404 for a project with no published site — a normal state for every unpublished project, raised as a red toast AND filed as a support ticket on every workspace open. Both now declare `expectedErrors: [404]`; the writes deliberately do not, because a 404 there is real.
- **Verified:** typecheck, the full guard suite, and the touched test files. `check:root-closure` was re-baselined 331 → 332 deliberately, with the argument written into the guard's header: `BrandLockup` is reached from `MarketingHeader` on every marketing first paint, so no `import()` helps, and the closure's LINE count went down because it removes six hand-written copies.
- **Still open, with blockers named:** the wordmark is spelled `Builderforce.ai` 84 times, `BuilderForce.ai` 7 times, and the logo art a third way — an operator decision, in the Gap Register. `agent-runtime`'s browser-registry race test is flaky in CI (10/10 locally). First-visit locale detection is still dead on `/about`, `/pricing` and `/blog`.
- **Not changed, deliberately:** Studio renders no app chrome — `/studio` is in `NO_CHROME_PREFIXES`, so there is no left rail and no global header. That is the standalone-IDE decision the Studio slice shipped with, not drift, and reversing it changes what Studio IS. Raised with the operator rather than flipped.

## ✅ RESOLVED 2026-10-03 — One brand lockup: Studio had no mark and a blue “Studio”, because six surfaces each drew the logo themselves

Reported from a screenshot of `studio.builderforce.ai/studio`: “The logo is wrong. Its missing the icon. The Studio in blue should be white.”

- **What was wrong.** `StudioTopBar` hand-rolled `Builderforce <span style={{ color: 'var(--accent)' }}>Studio</span>` — no mark at all, and the second word in the accent blue, so the first thing a visitor from the Studio subdomain saw was a wordmark the brand does not have.
- **Why it could happen.** There was no one logo to be wrong about. `MascotIcon` already existed and its own docstring said “one component so the brand mark stays consistent everywhere” — and **two** files used it while **seven** hardcoded `/agentHost.png`. Six of those were full lockups (mark + wordmark + home link), each with its own markup: `MarketingHeader`, `TopBar`, `AppFooter`, `LoginPageClient`, `RegisterPageClient` and Studio, which simply omitted the mark and nothing noticed.
- **Fix — one lockup, composed from the mark that already existed.** New `components/BrandLockup.tsx` wraps `MascotIcon`; it does NOT declare a second mark beside it. The WORDMARK is `children`, not a variant prop, because the surfaces genuinely differ (`Builderforce.ai` + beta badge vs `Builderforce Studio`). What it owns is what must never differ: which image is the mark, that the mark comes first, and the glow. All six migrated. `/agentHost.png` now appears in exactly one file.
- **Studio specifically:** the mark at 26px, and both halves of the wordmark on `--text-primary` — white on the dark bar, dark on a light one, rather than a hardcoded white that would vanish in light mode.
- **Three defects found and fixed while migrating**, none of them the reported one:
  - `.brand` (the app `TopBar`) had no `text-decoration: none` — it relied on an inline style the lockup replaced, so the brand would have rendered underlined. Moved into the class, where every sibling lockup class already had it.
  - The marketing header's `onClick={closeNav}` would have ended up on the wordmark rather than the link, so tapping the mark would no longer close the mobile drawer. `BrandLockup` takes `onClick` on the LINK.
  - `AppFooter`'s mark is not plain: `.global-footer-mascot` floats and pauses on hover. That is real, not drift, so `markClassName` keeps it — the default is the plain glow.
- **Dead code removed:** `.mh-brand-logo` and the `brand-logo` class (which had no CSS at all), and five now-unused `next/image` imports. The 8px glow string was inline in five places and is now `.bf-mark-glow`; the two auth-screen mark treatments became `.bf-mark-muted` / `.bf-mark-pulse`.
- **Not changed, deliberately:** the reference art spells the wordmark “BuilderForce.ai” with a capital F while every surface ships “Builderforce.ai”. That is a brand decision across the whole site, not a logo bug, and it is in the Gap Register rather than changed unasked.

## ✅ RESOLVED 2026-10-03 — `'use client'` stops failing the frontend build: 828 redundant directives removed, the count cap replaced by a boundary check

- **Symptom.** `Deploy frontend` failed at `check:architecture` (`'use client' files: 1001 exceeds baseline 1000`) and `check:root-closure` (`lib/sitePublishEvents.ts` newly reachable from `app/layout.tsx`). The count cap had failed this way repeatedly: the guard's changelog has ~100 raise/trim entries.
- **Root cause.** 828 of the 1001 directives marked no boundary, because every importer was already client code. New components got the directive by habit, and the cap punished each one.
- **Fix (operator decision: retire the cap AND strip):**
  - `frontend/scripts/check-redundant-use-client.mjs` (`check:use-client-boundaries`): a directive must have a server-side importer, or no importer at all (an entry). "Client side" is a least fixpoint over static, re-export and dynamic imports, so a one-pass `--fix` cannot strip a boundary a chain depends on. The check names each offender and offers `--fix`.
  - The 828 directives were stripped with `--fix`, taking the count from 1001 to 173. A re-run reports zero.
  - `useClientFiles` was removed from `check-frontend-architecture.mjs`, the baseline and the tally. The header records the retirement and supersedes the old "directive is the component's contract" paragraph. `useClientPages` and `check-root-closure` stay, because they measure real first-paint cost.
  - `lib/api.ts` `publishSite` loads `sitePublishEvents` with `import()`, so the publish signal is out of the root layout's static closure.
- **Verified:** locally, `pnpm run check` passed 25/25 guards, brain-ui 154 tests passed, and `next build` passed with no server/client boundary errors (Sonnet). In CI, run 37161295563 deployed frontend and API successfully, including the Linux `cf-build`.

## ✅ RESOLVED 2026-10-03 — Studio was unreachable three ways: the frontend had not deployed, the host root served marketing, and nothing on the site linked to it

Reported as “I don’t see a studio.builderforce.ai in cloudflare or the UI/UX on the site.” Both halves were true, for three independent reasons.

- **(1) The frontend Worker had not deployed since Studio landed.** `Deploy frontend` failed in EVERY release run after `20a04c60d` (the Studio commit); the last green one was `494ad5dc1`, the commit before it. Two guards: `check:architecture` (`'use client'` files 1001 over a baseline of 1000) and `check:root-closure` (`lib/sitePublishEvents.ts`, the Database view’s publish signal, newly static-reachable from `app/layout.tsx`). So the `studio.builderforce.ai/*` zone route **was never created in Cloudflare** — `wrangler deploy` is what creates it, and it had not run. That is why it was not in the dashboard. Live proof while it was broken: `builderforce.ai/studio` answered `404` with `x-matched-path: /404` (stale frontend), and `studio.builderforce.ai/` answered a **JSON** `404` carrying `x-builderforce-*` headers — the API Worker, whose greedy `*.builderforce.ai/*` zone route caught the host exactly as `wrangler.toml` had predicted it would. DNS was never the problem (the proxied wildcard resolves). Both guard fixes landed on main independently (`0268e01f8` replaced the use-client ratchet with `check-redundant-use-client.mjs`; `lib/api.ts:474` became `void import('./sitePublishEvents')`), and the run on `549dbdb23` went green. `/studio` now serves `Builderforce Studio` and the zone route exists.
- **(2) `studio.builderforce.ai/` served the marketing home page, and always would have.** The host redirect could not fire. With the Workers assets binding, a request whose path has a matching static file is answered by the asset layer and the Worker script is **never invoked** — and `/` is prerendered to `index.html`. `studioHostRedirect` handles exactly one path, `/`, so the function was unreachable in production while its unit tests passed. Proven by the locale cookie: `/dashboard` answers with `x-middleware-set-cookie: NEXT_LOCALE=…`, `/` answers with no `Set-Cookie` at all. **Fix:** `assets.run_worker_first = ["/"]` in `frontend/wrangler.toml` — scoped to the one path, not `true`, which would bill a Worker invocation for every `_next/static/*` asset. Two new tests in `studioHost.test.ts` assert the redirect is REACHABLE, not just correct: that `run_worker_first` contains `/`, and that the middleware matcher contains `'/'`. They are the tests that would have caught this.
- **(3) Nothing on the site linked to Studio.** It shipped with a subdomain, release notes (migration 1192) and a blog post, and with no entry point: not in `MarketingHeader`, not in `navGroups`, not in the footer. Its only route in was a sentence inside one article. **Fix:** one DATA row in `PUBLIC_DESTINATIONS` on the flat bar (`id: 'studio'`, seat CTO, `marketingHref: '/studio'`, `kind: 'link'`, `placement: 'bar'`, `panel: false`) plus `'studio'` in the footer’s `colProduct` — the header is a renderer of that registry, so no component changed. **It went in as `placement: 'make'` first, and that was wrong in a way the live site proved:** the Product ▾ menu is a projection of `NAV_GROUPS` (`productFacesFor` → `groupsForStage`), not of `placement`, so a product-column row reaches it only by declaring a rail row’s `groupId` — and a `kind: 'link'` row is filtered out of `/features` as well, leaving the footer as the only entry. The deployed page carried exactly one `href="/studio"`, which is what caught it. `check-destinations` gained a `[placement]` rule that fails that combination outright, so the next person cannot repeat it. `marketingHref` is the PATH, not the subdomain, so one row works from the apex, the studio host and localhost. Copy added as `marketingNav.dest.studio` in all five catalogs with real translations.
- **Logged, not fixed:** first-visit locale detection is dead on every OTHER prerendered marketing path (`/about`, `/pricing`, `/blog`) for the same asset-bypass reason as (2). In the Gap Register, blocked on an operator cost decision — covering it bills a Worker invocation per view on the highest-traffic, most-cacheable pages, against the $0-platform constraint.

## ✅ RESOLVED 2026-10-03 — VS Code release gate: the panels booted a worker instead of the app

- **Symptom.** The `Publish VS Code extension` job failed. The extension-host test "the shipped webview boots and its first message reaches the host" timed out with no error, which blocked `2026.9.96`. The `chatSessionsProvider` proposal errors in the same log are caught and logged, and did not fail it.
- **Root cause, a real shipping bug.** The new browser runtime (`@seanhogg/builderforce-webcontainers`, `check/` and `node/`) starts workers with `new Worker(new URL('./worker.js', import.meta.url))`, so Vite emits them as ASSETS. The webview config named every asset `index.[ext]`. The two workers took `index.js` and `index2.js`, and Rollup quietly renamed the real entry to `index3.js`. The shell loads `index.js` by name, so every bundled panel would have booted a worker as the app: a blank panel, no `ready`, and no error.
- **Fix:**
  - `webview/vite.config.ts`: only the stylesheet takes `index.css`; other assets are `asset-[name][extname]`. A new `bf-entry-keeps-shell-names` plugin fails the build if the entry isn't `index.js` or any `index<N>` file appears.
  - `src/webviewAssets.test.ts`: asserts that the file named `index.js` IS the entry.
- **Gate drift fixed in the same pass.** The integration test kept a hand copy of the panel CSP, which had fallen behind (nonce-only `script-src`). The shell is now one pure module, `src/webviewBundleShell.ts` (`makeNonce`, `bundleCsp`, `renderBundleShell`). Both `renderWebviewHtml` and the test render it, and the test forwards webview script errors, rejections and CSP violations into its failure message instead of an unexplained timeout.
- **Verified (Sonnet):** type-check clean; `npm test` 44 files / 465 tests; `build:webview` emits `index.js` (the entry) plus `asset-worker*.js`; `test:integration` 7/7, with the bridge test passing in 1.9 s.

## ✅ RESOLVED 2026-10-03 — StackBlitz is gone: Run, Publish, Check, the terminal and Node servers all run on our own runtime

- **The gap.** The canvas Run fell back to a StackBlitz WebContainer for anything the instant preview could not serve (Node servers, Vue, Svelte). Publish builds, Check and the terminal also ran there. That meant a metered, non-commercial-licence session, `@webcontainer/api`, a `/webcontainer/connect` handshake route with its own isolation carve-outs, and an attribution badge. The user asked for StackBlitz to be "obsolete and never used".
- **Runtime (builderforce-webcontainers 2026.10.3, on npm with provenance):**
  - `spawn()`: node, npm (install, run), npx and a `jsh` shell. Each process runs in its own Web Worker, with the same shape as `@webcontainer/api`. Servers answer at `/__port/<n>/` and announce `server-ready`.
  - A registry-backed npm installer.
  - `buildProject()` / `runtime.build()` for production builds.
  - A `/check` type-check worker.
  - Vue and Svelte support.
  - Found in review and fixed before release: process workers were being started on the HOST origin, so npm packages and the user's server would have shared builderforce.ai's storage. In relay mode the relay frame now starts them on the preview origin (`relayWorker.ts`, `RELAY_SPAWN`, `process-worker.js` in `./assets`), with a regression test.
- **api:** `browserPreviewOrigin.ts` serves `process-worker.js` beside `relay.html` and `sw.js`, from a table of assets looked up by own keys only, so `/__bfwc/constructor` no longer resolves to `Object`. Tests are added.
- **frontend:**
  - `hooks/useProjectRuntime.ts` replaces `useWebContainer`.
  - `lib/browserRuntime/siteTools.ts` builds (Publish) and type-checks (Check) from the files, without touching the live preview.
  - `lib/browserRuntime/projectChecks.ts` runs the check steps through ports and has tests.
  - `replaceProjectFiles` keeps `node_modules` across runs, so an unchanged `package.json` does not reinstall.
  - Deleted: `useWebContainer`, `webcontainerSession`, `webcontainer.ts` (+test), `WebContainerAttribution`, `WebContainerConnect`, both `/webcontainer/connect` pages, the agent worker's dead `buildCommand` gate, the connect COOP/COEP carve-outs in middleware / next.config / `_headers`, the `webcontainer` route entries, and the `@webcontainer/api` dependency.
  - App-wide isolation stays, because it gives onnxruntime-web its WASM threads.
  - The runtime status label is localized. Orphaned i18n keys were removed.
- **Known:** Check's `lint` step mounts the clean files into the shared runtime, so the preview's overlays drop until the next Run. StackBlitz behaved the same way, and only projects with a `lint` script are affected.
- **Verified:**
  - Runtime: build, typecheck, core 170 tests and browser 23 tests, plus a pack check of the tarball contents.
  - api: tsgo clean; `browserPreviewOrigin` 5/5.
  - frontend: tsgo clean in `src/`; 9 files / 72 tests (workspace, instant preview, browserRuntime, COI parity, shell routing); edit ratchets 6/6; i18n, declared-deps, root-routes, design-scale, methodology and blog-index checks pass.
  - **Not run in a real browser.** That check is still on the roadmap and needs a deploy.

## ✅ RESOLVED 2026-10-03 — Builderforce Studio on studio.builderforce.ai: pop-up sign-in, a version per agent turn, search and panel tabs, header actions, a Database view

- **Subdomain:** the same Next app. The studio host redirects `/` → `/studio`. A frontend zone route `studio.builderforce.ai/*` is added, and `appOrigins()` derives `studio.<apex>`.
- **Pop-up sign-in:**
  - OAuth and SSO carry a signed `return_origin`, checked by `trustedReturnOrigin`. The pop-up lands on `/auth/popup-done`.
  - The opener rehydrates on `storage` events. A blocked pop-up falls back to a full redirect.
- **Versions:**
  - R2 manifests of `{path, etag}`, with metadata listed in one call.
  - An automatic version when a burst of agent writes settles, plus named saves.
  - Restore saves the current state first. Deleted files are archived to history so they can be restored.
- **Workspace:**
  - Project-wide search (server-side, bounded).
  - Terminal / Output / Problems tabs.
  - Header actions: Publish, GitHub, Share, and Upgrade on the free plan.
  - A `workspaceCommands` bus so surfaces outside the workspace can drive its panels.
  - `PaneLayer` replaced nine hand-written pane wrappers in `BuilderWorkspace.tsx`, which went from 1768 to 1692 lines.
- **Database view** (Preview · Code · Database, for site-backed modalities):
  - **Tables:** collections and records, add a table, delete a row or a table, page through rows.
  - **Users:** the app's `site_users`. Suspend, which also ends their sessions, reinstate, or remove.
  - **Server functions:** `ProjectBackendPanel`.
  - It notices a first publish without a reload (`sitePublishEvents`).
  - New owner routes, all project-scoped. This fixed an existing gap: PATCH on a collection and reading its records only checked the tenant.
  - The overlapping `SiteFormsPanel` was retired.
- **Marketing:** release notes in migration 1192 (two `new` rows) and the post `builderforce-studio-describe-it-run-it`.
- **Not built:** File storage. It is on the roadmap, blocked on an operator decision about per-app quota and abuse policy.
- **Verified:** api tests for siteDataAdmin, siteUsersAdmin, workspaceCheckpoints, searchWorkspace and cors; frontend studio, versions and workspace suites; ratchets green on the touched files.

## ✅ RESOLVED 2026-10-03 — Second performance pass: polled reads cached, cache misses stop waiting on KV, N+1 queries batched, published sites on their own 1.4 MB Worker

- **Polled reads, shared until something changes.**
  - **`GET /runtime/active` (polled every 4s) and `GET /runtime/executions`.** Both are cached per tenant behind the new execution-state version token (`application/runtime/executionStateVersion.ts`). Every status change bumps it through the existing lifecycle outbox, and the attention badge uses the same token. The active-runs query moved out of the route into `application/runtime/activeRuns.ts`; `elapsedMs` is still computed per request.
  - **The notification feed.** Its reads and writes live in `application/notifications/notificationFeed.ts`. It is invalidated by `notify()` and by mark-read, and is declared as `subject_own_rows`.
  - **Both conversation inboxes.** `application/marketplace/conversationLists.ts`, invalidated by all six handlers that write a conversation, each after its read watermark.
  - **`GET /tenants/:id/security/users`.** Bounded by a 60s TTL rather than invalidated. The code states why: its session counts drift by the clock.
  - **Workforce presence** now polls through the shared `usePolledResource`, so a background tab stops firing four requests every 30 seconds.
- **Cache misses no longer wait for KV.**
  - `@builderforce/read-through-cache` gained a `defer` hook. The API wires it to the invocation's `waitUntil` through a new `application/shared/requestScope.ts`, which now owns the per-request AsyncLocalStorage the error reporter used to own privately.
  - It also gained single-flight: concurrent misses share one loader call, and a load overtaken by an `invalidate` is not cached.
  - Four package tests cover this.
- **N+1 queries and sequential round trips** (from the 2026-10-03 audit):
  - Lane capability resolution: up to 3N queries → 2.
  - Creation-session search: an object select per row → 1, with access checks deduplicated.
  - Pulse list and trend: N → 1.
  - Chat-ticket consolidation: 2M + L writes → 3.
  - Contributor aggregation: chunked in parallel.
  - `listChats`: 5 sequential steps → 3. `appendMessages`: ~5 → 3, with membership as an upsert.
  - Routing-table scope reads, portfolio rollups, participant writes, the cascade-to-done, pin reorders and template application now run in parallel or as one `db.batch`.
- **Published sites run on their own Worker.**
  - **The bundle:** `src/sitesWorker.ts` + `api/wrangler.sites.toml` measure **1.41 MB / 304 KB gzip, against the API's 21.2 MB / 4.7 MB**.
  - **What it serves:** it serves the static half of a site itself (`application/ide/siteStaticServe.ts`). Everything dynamic — the site datastore and sign-in, server code, the landing-page fork, a page view a workflow listens to — goes to the API over a service binding.
  - **What made it possible:** two small extractions. `siteLandingRule.ts` (the pure landing predicate) and `workflow/eventTriggerListeners.ts` (the cached listener gate, apart from the workflow runner).
  - **Route and deploy:** the wildcard route moved from the API's config to this one. The deploy-api job deploys it after the API, syncing its secrets from GitHub.
  - **Guard:** `check:sites-worker-graph` fails if its import graph ever reaches the API's composition root, routers or agent runtime again. The first measurement came out larger than the API because of one such chain.
  - **Privacy fix:** `visitorSalt` returns `undefined` when no secret is bound, and both callers then skip hashing instead of fingerprinting an IP unsalted.
- **Verified (Sonnet):**
  - The read-through-cache package: 21/21.
  - API vitest: 890 files and 10,562 tests pass.
  - Frontend vitest: 4,811/4,812. The one failure is the known expired `credential-encryption` review date.
  - Both bundles were measured.
  - The fixes made after that run (the package typing, the creation-search typing, per-user scoping on the notification feed, the silent catch) were re-verified before commit.
- **Versions.** api 2026.10.3, frontend 2026.10.2.

## ✅ RESOLVED 2026-10-03 — Canvas previews run on our own runtime, isolated on preview.builderforce.ai

- **The gap.** Every Run on the canvas needed a StackBlitz WebContainer: a metered session, an `npm install` and a dev server before anything showed. The IDE also booted one on every open just to start the terminal.
- **Runtime (builderforce-webcontainers 2026.10.1 and 2026.10.2, on npm):**
  - Relay mode, `bootPreviewRuntime({ relayUrl })`. The preview is served from a separate origin through a hidden `relay.html`, so AI-written code and arbitrary packages never share builderforce.ai's cookies, storage or DOM.
  - Live reload: edits reload every frame showing the preview.
  - Documents send COEP `credentialless` and CORP `cross-origin`, so the cross-origin-isolated canvas can frame them.
  - The service worker leaves dotted paths (`sw.js`, `relay.html`) to the network.
- **api:**
  - `presentation/middleware/browserPreviewOrigin.ts` serves the relay and worker at `preview.builderforce.ai/__bfwc/`, straight from the package (`/assets`).
  - `frame-ancestors` comes from the new shared `appOrigins()` in `cors.ts`, which `resolveAllowedOrigin` now uses too.
  - `preview` was already a reserved label routed to this worker, so no DNS change.
- **frontend:**
  - `lib/browserRuntime/previewRuntime.ts` is the page-wide boot.
  - `hooks/useInstantPreview.ts` mounts the run's files (overlays included) and serves when the project is supported, otherwise declines with the reason.
  - `BuilderWorkspace.handleRun` tries it first and falls back to the WebContainer path unchanged.
  - Every live edit goes through one `writePreviewFile`, which reaches whichever runtime is showing.
  - `hooks/useLazyShell.ts` starts the terminal shell on the first keystroke, buffering input, instead of booting a WebContainer on page open.
  - Run-log strings are in all five catalogs.
  - Dead exports `getOrBootWebContainer` and `runCommand` were dropped from `useWebContainer`.
- **Verified:**
  - webcontainers: build, typecheck and 47/47 tests.
  - api: tsgo clean, 23/23 tests across the touched files.
  - frontend: tsgo clean; the hook, BuilderWorkspace and i18n suites pass; edit ratchets 6/6.

## ✅ RESOLVED 2026-10-03 — Performance pass: transactions that threw, blog bodies out of the client, fewer Neon round trips, cached CI

- **Thirteen write paths threw on every real request.**
  - **The bug.** `db.transaction()` on the neon-HTTP driver throws "No transactions support in neon-http driver". Their tests passed only because the doubles implement `transaction`.
  - **The paths:**
    - Booking a slot.
    - Recording an estimate.
    - Setting a baseline scenario, a default brand kit or a default ICP.
    - Replacing A/B variants.
    - Reordering landing blocks and deleting a website page.
    - Answering a job invite.
    - Rolling back an import.
    - Adding an emergency contact or a current role.
    - **Accepting a proposal (hiring).**
  - **Fix: `inTransaction(db, work)`** in `infrastructure/database/connection.ts`, the one module allowed to touch the driver. It opens a short-lived WebSocket `Pool` to the same database for a real interactive transaction, so every site keeps its read-check-write logic unchanged. Test doubles fall back to their own `transaction()`.
  - **Guard.** `check:db-access` now fails on any `.transaction(async` outside the access layer.
  - **Layering.**
    - The accept transaction moved out of `jobRoutes.ts` into the use case `application/marketplace/jobs/acceptProposal.ts`.
    - `jobRoutes.ts` also dropped its byte-identical copy of `jobColumns`, `proposalColumns`, `mapJob`, `mapProposal` and `clientRating*`, and imports them from `jobs/jobRows.ts`.
- **Every blog body shipped in client JavaScript.**
  - **The problem.** `blogData.ts` statically imported all 154 posts (about 1.2 MB of markdown) into the home page, the blog index, every page with related reading, and the edge functions.
  - **Now.** `scripts/publish-blog-content.mjs` (renamed from `publish-blog-translations.mjs`) does two things:
    - It publishes every body, English included, under `/blog-i18n/<locale>/<slug>.md`. The post route fetches the one body it needs on the server.
    - It generates a metadata-only `src/lib/blogIndex.generated.json`.
  - **Drift fixed.** The index is generated from the directory. Two shipped posts were missing from the old hand-kept import list, so they had OG cards but 404'd:
    - `install-your-verticals-kpi-dashboard`
    - `the-run-that-teaches-the-next-one`

    Both now have catalog copy in all five locales, and the missing German body.
  - **Kept honest.** The index is committed, and `check:blog-index` fails when it is stale. `scripts/lib/blogFrontMatter.mjs` is now the one front-matter parser, shared with `gen-blog-og.mjs`.
  - **Dead code removed:** the `.md` loader plumbing (the webpack and turbopack rules, `rawContentLoader.cjs`, the vitest plugin, and the `*.md` module declaration).
- **Neon round trips.**
  - Smart Placement is on (`api/wrangler.toml`).
  - `buildDatabase` is memoised per env and isolate, so there is no new client per request.
  - **Parallelised:**
    - `loadAttention`: 5 sequential round trips down to 2.
    - The projects list: 8 sequential round trips down to 1, with the two task aggregates merged into one statement.
    - Board detail, board list and board lanes.
    - Task detail: the tenant gate and the aggregate load run together.
  - The chat-membership sync is one statement instead of a read plus an update. `getUserEmail` had no callers left and was deleted.
- **API cold start.** `pptxgenjs` (through the shared `office/pptxPresentation.ts`) and `pdf-lib` now load on first use. Measured bundle: 21 MB raw / 4.7 MB gzip.
- **CI.**
  - The pnpm store is cached per job (`.github/actions/pnpm-store-cache`).
  - The Next build cache is restored per lockfile.
  - The docs job uses setup-node's npm cache.
  - `deploy-api` no longer installs a global Wrangler it never called.
  - `Dockerfile.frontend` publishes the catalogs and blog bodies before `next build`.
- **Considered and not done:**
  - A Bun runtime: the product runs on workerd.
  - oxlint: ESLint is not in CI.
  - A Turbopack production build: blocked by the custom webpack config and next-on-pages.
  - Turborepo: the repo is not a workspace, and the per-job caches above give its gain.
- **Residuals** are in ROADMAP.md → Infrastructure: the unbound rate limiter, the rest of the round-trip audit, the KV write on every cache miss, live verification of `inTransaction` and of placement, and the Worker's size.
- **Versions.** api 2026.10.2, frontend 2026.10.1.
- **Verified (Sonnet).** One known, unrelated failure remains: the expired `credential-encryption` review date in `capabilityProof`.
  - **api:** tsc and tsgo clean; guards 36/36 (the tenant-scope baseline was lowered: `jobRoutes` 5 → 4, `projectRoutes` 2 → 1); vitest 886 files and 10,535 tests pass. Twelve source-text assertions were updated from `db.transaction` to `inTransaction(db`.
  - **frontend:** tsc and tsgo clean; guards 24/24; vitest 4,805/4,806.
- **Guards repaired for the unpushed commits it ships with** (ea4072fbd, e6c99d499), which had pushed `check:architecture` to 1003 against a ceiling of 998 and made `check:react-hooks` fail on `useLazyShell`:
  - The directive was dropped from three non-component modules: `useInstantPreview`, `useLazyShell` and `webcontainerSession`.
  - The ceiling was raised 998 → 1000 for `SiteBadgeNotice` and `WebContainerAttribution`, with the entry in the guard.
  - `useLazyShell` now updates its ref in an effect.

## ✅ RESOLVED 2026-10-03 — "Made with Builderforce.ai" on free published sites, and the default-on preview badge

- **The aim.** Free users drive traffic back to builderforce.ai, the Framer/Webflow way, without making attribution a licence condition.
- **New plan feature `removeBranding`.** Free: false. Pro and Teams: true. Defined in `domain/tenant/PlanLimits.ts` with its label in `planFeatures.ts`, and resolved by the one entitlement evaluator, so superadmins and comped tenants are covered.
- **`application/ide/siteAttribution.ts` → `withSiteBadge`:**
  - It adds a plain-HTML backlink (UTM-tagged, inline `!important` styles, no script) to every HTML document a free tenant's site serves. A plain link survives a site's CSP and is crawlable.
  - Non-HTML responses skip the plan read entirely. The plan read is the cached `resolveTenantPlan`, so an upgrade removes the badge as soon as the plan cache is invalidated.
  - It is applied at the document exits in `siteServer.ts`: subdomain/custom-domain serving, the landing page and the path-based `/sites/:subdomain` route.
- **Frontend:**
  - `usePlanFeature(feature)` is the shared hook. `RuntimeSurfaceSelect`'s private copy was deleted and migrated to it.
  - `components/site/SiteBadgeNotice.tsx` decides its own visibility and is shown in the site release panel: "Free sites show a … badge — Upgrade to remove it". Strings are in `siteBadge.*` in all five catalogs.
- **builderforce-webcontainers.** A default-on "Built with Builderforce.ai" badge in previews (shadow DOM, UTM-tagged, light/dark), disabled with `attribution: false`. The README asks forks to keep it. The licence stays MIT.
- **Verified:**
  - api: tsgo clean, 96/96 tests.
  - frontend: typecheck clean; 3080/3081 tests. The one failure is the unrelated expired-claim entry in the roadmap.
  - webcontainers: build, typecheck and 44/44 tests.

## ✅ RESOLVED 2026-10-03 — Agent-run telemetry moves from core to the operational endpoint (Neon grouping rule)

- **The gap.** Neon bills each project by its own awake time. Agent-run telemetry was written on core while every run also wrote the usage ledger on transactional, so each run kept both projects awake. `tool_audit_events` alone took ~77k writes between two of core's sleeps.
- **What moved** (`transactional-migrations/0013_run_telemetry.sql`): `tool_audit_events`, `tool_audit_daily`, `usage_snapshots`, `brain_chat_trace`, `run_context_state` and `run_model_outcomes`. Two more went with them, beyond the roadmap's list:
  - `execution_claims` and `execution_claim_evidence`. They are written at run finish, and their attach trigger reads the audit trail in the same statement. Leaving them on core would have rejected every completion claim once core's trail froze.
- **Plain ids.** References to tenants, segments, projects, tasks, executions, agent hosts and chats are plain ids now. Only the claim → evidence → trail keys remain.
  - `brain_chat_trace` gained a `tenant_id` (core 1191, backfilled), because it can no longer inherit its tenant through the chat.
- **One primitive.** `application/shared/runTelemetryDatabase.ts` resolves the endpoint from the core handle. Its `RUN_TELEMETRY_TABLES` set feeds `application/shared/databaseForTable.ts`, which moved out of the apps module, for the generic entity and registry readers.
  - A test pins that set to exactly the tables 0013 creates.
- **Cross-database joins split** into two reads matched in memory:
  - QA escaped-defect attribution (was a LATERAL join from `qa_findings`).
  - The recall seed (was a join to `tasks`).
  - The CI auto-fix loop guard (was a join to `executions`).
  - The Changes tab's per-run models (was a correlated subquery). It is now `auditedModelsByExecution`, beside `modelUsageByExecution`.
- **Cascades the foreign keys used to perform.** These are in `application/shared/siblingCascade.ts`, which replaces `infrastructure/database/appsCascade.ts`:
  - Tenant, project and agent-host deletes.
  - Segment erasure: the route collects the segment's run and host ids before the core delete. New rows carry no `segment_id` (there's no default-segment trigger on transactional), so segment filters on telemetry were dropped. The segment boundary is now the execution or host that is checked on core.
  - Rows a claim cites are kept, as are the immutable claims themselves.
- **Retention.** `tool_audit_events`, `tool_audit_daily` and `brain_chat_trace` are swept on both endpoints until the core copies are drained. The trace purge is now tenant-scoped.
- **Data.** `scripts/copy-run-telemetry.mjs` (`npm run db:copy-run-telemetry`) copies with ids preserved and advances the transactional sequences past core's max + 1M. `--purge-source` verifies every row arrived, then truncates the core copies. The production run is still open in ROADMAP.md.
- **Dead code.** Removed `forgetRunContextScope` (no callers) and an unused import in `cloudAgentEngine.ts`.
- **Verified (Sonnet):** `tsgo` clean; `npm run check` 36/36 (the tenant-scope baseline was lowered after `agentHostRoutes` improved 3 → 2); vitest 885 files / 10,531 tests pass. The segment route tests now assert the erasure cascade, and that it does not run on a 404.
- **Version.** api 2026.10.1.

## ✅ RESOLVED 2026-10-03 — WebContainer attribution and the single shared boot

- **The gap.** Free-tier WebContainer use is licensed for non-commercial use with attribution, up to 25,000 API sessions a month. Nothing in the app showed the attribution.
- **A latent bug.** Two independent `WebContainer.boot()` calls existed: the IDE hook (`hooks/useWebContainer.ts`) and the agent worker's build step (`lib/browserRuntime/factory.ts`). A page may hold only one instance, so whichever booted second threw "Unable to create more instances".
- **Fix:**
  - `lib/browserRuntime/webcontainerSession.ts` is now the one boot singleton. It also records that a session started.
  - `components/webcontainer/WebContainerAttribution.tsx` decides its own visibility: it renders nothing until the page has booted one, then links to webcontainers.io. It uses theme tokens and a wrapping layout.
  - It is mounted under the IDE preview pane and on the agent-worker page.
  - Strings live in `webcontainer.*` in all five catalogs.
- **Verified:** typecheck clean; 163/163 tests pass, including the catalog parity test.

## ✅ RESOLVED 2026-09-29 — One limbic implementation (P2 (f)), and the release/deploy CI failures

- **Gap.** `packages/agent-tools/src/limbic.ts` and the engine's `limbic/regions.ts` each held the 8-dim affect schema and the personality → setpoint formula ("keep in sync" comments); agent-runtime re-exported agent-tools through a barrel; the frontend hand-copied `LimbicDimName`; api and agent-runtime each averaged setpoints across personas by hand.
- **Fix.** The engine is the one implementation (builderforce-memory 2026.9.33): `limbic/regions.ts` owns the schema and ONE setpoint formula (`limbicSetpoints`, with `personalitySetpoint` its dense form); new `limbic/affect.ts` holds the heuristic regions (amygdala, homeostasis, thalamus gate, basal ganglia), `appraiseTask`, `meanLimbicSetpoints`, `compileLimbicState` and `buildLimbicBlock`, shipped dependency-free as `@seanhogg/builderforce-memory-engine/limbic`. agent-tools keeps only its own seams: `maxThink` in `spec.ts`; `PsychProfile` (was `LimbicPsychProfile`), `limbicTraits` (PSYCH_DIM → traits) and `mergeLimbicWithPsychometric` in `psychometrics.ts`. api (`capabilityContext`, `projectEvermind`, `cloudAgentEngine`, `limbicRoutes`, `CloudRunnerDO`) and agent-runtime (`limbic-system-service`, `orchestrator-ports-adapter`, `ports`, `assigned-capabilities`) import the engine; the runtime barrel + its test, the runtime `TrainingSample` copy and the dead `arrayToState` re-export are gone; agent-runtime now depends on the engine (it was optional, but the heuristic regions must always load). Tests moved to `memory-engine/tests/limbic_affect.test.ts` and `agent-tools/src/psychometrics.limbic.test.ts`.
- **CI.** Deploy frontend: `HuggingFacePublishForm` dropped a redundant `'use client'` (ratchet 999 > 998); `lib/sseFrames.ts` (deleted with its last callers) removed from the root-closure baseline. Package agents: the release workflow cancels in-progress runs, so a cancelled run can leave a version STAGED on npm and the next run's publish returns E409 — `npm-publish-if-new.sh` now treats "previously staged" as in flight and polls before failing. Dependabot `security_update_not_possible` (transitive): pnpm overrides morgan 1.12.1 (agent-runtime), fast-uri 3.1.8 (clients/vscode), undici 7.30.0 (worker), adm-zip 0.6.1 (voice). builderforce-memory release: plugin manifest/README regenerated for 2026.9.33.
- **Verification (Sonnet).** Engine 460/460, memory 758/758, memory-mcp 53/53, `/limbic` subpath resolves; plugin + registry checks clean; 2026.9.33 on npm. Lockfiles refreshed and checked (engine/memory 2026.9.33 in api + agent-runtime; morgan 1.12.1, fast-uri 3.1.8, undici 7.30.0, adm-zip 0.6.1, no vulnerable versions left). Host gates (api `npm test`, agent-runtime, frontend checks) were not run this pass at the operator's direction; CI runs them on deploy.
- **Versions.** builderforce-memory 2026.9.33; agent-tools 2026.9.29, api 2026.9.48, agent-runtime 2026.9.6, frontend 2026.9.43, VS Code 2026.9.96.

## ✅ RESOLVED 2026-09-28 — Evermind consolidation, second slice: serving, the console contract and the step catalog each exist once (P2 (a), (d), (e))

- **(a) Evermind serving → `@seanhogg/builderforce-memory/evermind` (package 2026.9.32).** The text-coherence gate (`textCoherence`, `wordLexicon`), the constrained-decoding tool planner (`toolCall`, with a pure `resolveToolChoiceMinMargin`) and the model-driving runtime (`messagesToPrompt`, deadline-sliced `generateEvermindText`, `assessLMCoherence`/`probeEvermindText`, `createEvermindToolDecoder`, `generateEvermindWithTools`) moved out of `api/src/application/llm/`. The subpath stays dependency-free: the runtime takes structural model/tokenizer shapes the engine's `EvermindLM`/`BPETokenizer` satisfy. The api keeps R2 loading + the per-isolate cache (`evermindRuntime.ts` wrappers), benchmark/export/media, and the gateway's margin env knob + decision log (`evermindToolCall.ts`, 40 lines). Tests moved with the code (83 in the package).
- **(d) One Evermind console contract.** The web `ProjectEvermindPanel` runs on brain-ui's `createEvermindRestAdapter` (the one VS Code and Synapse use) through `evermindConsoleRequest`; `projectEvermindTypes.ts` aliases the brain-ui contract (which gained `fitted`, target `ref`, probe `projectId`); 13 panel-only web calls deleted. Fixed on the way: the shared adapter gated the teacher on the plan snapshot alone, so Synapse showed BYO and superadmin tenants a false paid-only wall — it now reads the server's `canUseFrontierModels`/`teacherModels` (`resolveTeacherOptions`), and declares per-call `expectedErrors` so the web keeps console-handled statuses off its global toast. `publishedEvermindModels` replaces the copied filter in `studioModelsApi`. brain-ui 2026.9.15.
- **(e) One workflow step-kind vocabulary.** `WORKFLOW_NODE_KINDS` / `WorkflowNodeKind` in `@builderforce/creation-canvas-contract` (`workflowNodeKinds.ts`); `api/src/domain/workflowGraph.ts` and `frontend/src/lib/builderforceApi.ts` import it instead of two unions "kept in sync manually". The 44-entry `NODE_HANDLER_ROLES` map (every value `node:<kind>`, identical to its own fallback) is gone — `roleForNode` returns `node:${kind}`.
- **Still open.** (f) two limbic implementations — blocked on an operator decision (ROADMAP.md).
- **Versions.** builderforce-memory 2026.9.32; api 2026.9.47, frontend 2026.9.42, brain-ui 2026.9.15.

## ✅ RESOLVED 2026-09-28 — Every builderforce-memory capability has a consumer, and no algorithm is kept twice (P1 audit + P2 (b)/(c))

- **Gap.** A compiler-resolved reachability pass over `builderforce-memory` found ~6,100 lines no host reached, while the hosts kept their own copies of the same logic (cosine ×3, MMR, BM25 ×2, RRF, three query tokenizers, weighted fusion, temporal decay, SSE framing ×4, usage normalisers, canonical JSON ×3, an OpenAI-compatible client ×3). Operator decision: deprecate nothing, keep one copy, use it.
- **Slice 1 — shared primitives (package 2026.9.30).** Engine-free `@seanhogg/builderforce-memory/retrieval` (cosine/Jaccard/tokenize, vector + text MMR, RRF + `rrfTerm`, weighted hybrid fusion, temporal decay, BM25 primitives) and `/wire` (SSE framing, `readUsageFields`, `AnthropicStreamUsage`). api (`vectorMath.ts`, `sseFrames.ts`, `hybrid-rank`, three tokenizers → `domain/shared/queryTerms.ts`), agent-runtime (`mmr.ts`, `temporal-decay.ts`, cosine, BM25) and brain-embedded moved onto them; `@builderforce/agent-tools` `stableStringify` replaced the agent-runtime and brain-embedded copies.
- **Slice 2 — P2 (b) + (c).** `DistillationEngine` takes teacher/student ports (`/distillation` subpath); `api/src/application/llm/evermindDistillation.ts` runs the Evermind teacher on it (quality gate, fallback text, `skipReason`). The coding gate's baseline ratio became `EvalGate.minBaselineRatio` + `baselineRatio`/`meetsBaselineRatio` in `/eval`; `evermindCodingGate.ts` calls them.
- **Slice 3 — one chat client (package 2026.9.31).** `/wire` `chatComplete`/`chatStream` + `readSseDataPayloads`; `OpenAIBridge`/`FetchBridge` run on it (`serverDefaults`, `timeoutMs`, `extra`). agent-runtime `native-llm.ts` and `GatewayLlmService` became thin adapters over it — fixing a dropped final SSE frame and an unreleased stream reader; unused `createNativeLlmClient` deleted. Frontend `lib/sseFrames.ts` → `readSseDataPayloads`. The V2 (Claude Agent SDK) runner now mounts the package's `createMemoryMcpServer` over the SSM memory service's store (`agents/sdk-memory-server.ts`, belief writes via `commitFact`, gated by policy gates) — V1 parity for active memory.
- **Slice 4 — engine + a new destination.** `tools/convert.html` on the library port (BF16, vocab resize), `findHost`/`LoadBalanceAccumulator` replace inline copies, and **Publish to Hugging Face** in `ModelExportPanel` (`components/HuggingFacePublishForm.tsx`, `lib/huggingFacePublish.ts`: the export bundle unzipped with fflate and pushed through `publishToHuggingFace` + `@huggingface/hub`, with the person's own token, never sent to Builderforce). i18n in all five catalogs, scale tokens, release note 1190 (`new`), blog post `publish-your-evermind-to-hugging-face` + OG card.
- **Kept, deliberately.** `AgentOrchestrator.executeWorkflow` is NOT moved onto `AgentGraph`: `AgentGraph` is a superstep engine for cyclic agents with no join barrier (a task whose parents finish at different depths would run once per parent, early), while `executeWorkflow` is a dependency-DAG scheduler with per-task retry and durable per-task status. Same call as keeping `runAgentLoop`. The api `stableStringify` stays until its persisted hashes are versioned (⛔ entry in ROADMAP.md).
- **Also fixed on the way.** Release workflow: idempotent npm publish, waits for npm before the MCP Registry, `workflow_dispatch` re-run. brain-embedded now declares `builderforce-memory-engine` itself (the lockfile kept an unmet 2026.9.30 peer on every bump). Flaky tests: `agent-tools/node-symbols` (fixed sleep → `vi.waitFor`), `msteams/conversation-store-fs` (1 s TTL → 30 s). Stale tests from the tabbed options menu and the `useOptionalAuth` mock (`ChatInput.modelMenu`, `GuestAccountPrompt`).
- **Verification (Sonnet).** Package: memory 675/675, engine 429/429, mcp 53/53, tsgo + plugin/registry checks clean; 2026.9.31 on npm and latest on the MCP Registry. api: 36/36 guards, 885 files / 10,592 tests. agent-runtime: typecheck clean, 8,403 tests (one timing flake, fixed and 5/5 since). brain-embedded 829, agent-tools 138. frontend: type-check 2/2, design-scale/tokens/error-fallback/i18n guards pass.
- **Versions.** builderforce-memory 2026.9.30 → 2026.9.31; frontend 2026.9.41, api 2026.9.46, agent-runtime 2026.9.5, brain-embedded 2026.9.40, agent-tools 2026.9.28.

## ✅ RESOLVED 2026-09-28 — Synapse opens on the workspace's Evermind models with the shared Teach / Test / Check / Maintain console, and its sidebar is your chats

- **Gap.** Signed in, Synapse's Evermind page still showed only the private model on the machine ("I've logged in but the UI is showing no evermind"); the workspace's models (`/api/ide-projects` → `/api/projects/:id/evermind/*`) were never read, and the VS Code console's four tabs had no Synapse counterpart. The sidebar was a list of setup pages rather than the conversations.
- **One adapter, both desktop hosts.** `packages/brain-ui/src/evermind/restAdapter.ts`: `createEvermindRestAdapter({ request, projectId, copyText?, pickMemory?, compactMemory? })` (every console call, lifted out of the VS Code `EvermindScreen`), `loadEvermindBuilds` / `preferredEvermindBuild` (the build picker's rules), `planIsPaid` (the one paid-plan rule — the VSIX `accountPlan` chip and teacher picker now read it; the dead `fetchIsPaidPlan` is gone). `labelBundle.ts`: `evermindLabelsFromBundle` (the `ev.*` → labels mapping, lifted out of the screen). `EvermindHost` gains `synapse` for the diagnostics export. `isManagerRole` moved to brain-embedded (`workspaceRoles.ts`), so the VS Code host's own `MANAGER_ROLES` copy is gone. The VS Code screen is now picker + the shared adapter.
- **Synapse console bundle.** `desktop/app/console` builds `ui/vendor/evermind.js` (one ES module, React + `<EvermindConsole>` + the web's `evermindRegionSignals`/`recentForRegion`), loaded on demand. Its labels are derived at build time from the extension's `buildEvermindLabels` literals and five `l10n` catalogs (`labels.ts`) — never a committed copy. The desktop release rebuilds it. `frontend/src/lib/projectEvermindTypes.ts` holds the payload types so the region derivation no longer type-imports the web API client.
- **Through the session, not the page.** `cloud_request` (`app/src-tauri/src/cloud/request.rs`) is the window's one authenticated call — `/api/` and `/llm/v1/` only, no `..`/`//`, five-minute timeout (`Session::api_with_timeout`); the key and token never reach the page. Import from builderforce-memory folds this machine's facts in (`facts_learnable`) and stubs the absorbed ones through the live store's `memory_compact` (`facts_compact`, reclaimed bytes measured from the store).
- **Which Evermind.** `js/cloud/evermindSource.js` is the one choice (this machine / a workspace model), remembered per machine, opening on the workspace model at first sign-in. `js/brain/brainView.js` gives the brain one shape for either source; `regions.js` is now layout only; a workspace model's neocortex/hippocampus and limbic charges come from the web derivation. The page: source picker → brain (tiles hidden for a workspace model, since the console carries them) → console (`js/cloud/workspaceConsole.js`) or this machine's learning/facts/forget sections.
- **Navigation.** The sidebar is chats (`js/chat/{chatStore,sidebarChats}.js`, newest first, a new chat beside the brand), the account chip, and at its foot the brain, Evermind and Settings. Setup moved into Settings (`js/settingsNav.js`, groups as data: Account · Code index — Workspaces, Search, Activity · Agents — Teach, Skills, Runs · Connect), with `views/account.js` for sign-in/workspace/sign-out. `chatList.js` retired.
- **i18n / theme.** 38 new keys in all five catalogs (353 each); `nav.css`, console `--bf-ev-*` mapped to Synapse tokens; both navigations scroll sideways under 760/900px.
- **Verification (Sonnet).** brain-embedded 829 tests + type-check + dist; frontend typecheck 2/2 guards + evermindRegions/CreationCanvas 95 tests; console typecheck clean; brain-ui 151 tests + typecheck + dist; console labels tests + bundle (765 KB, no stray `process.env`/dynamic imports); VSIX webview tsgo/tsc + 52 webview tests + build + `builderforce-ai-2026.9.95.vsix`; desktop `cargo check`, clippy `-D warnings`, `cargo test` (incl. the `cloud_request` path test), every UI module parses, import/export and i18n cross-checks, migration guard (1189); release `synapse.exe` rebuilt and relaunched.
- **Versions.** Synapse 2026.9.31, brain-ui 2026.9.14, brain-embedded 2026.9.39, VSIX 2026.9.95; release note 1189 (`improvement`).

## ✅ RESOLVED 2026-09-27 — Synapse signs in to Builderforce: chat with the Brain and assigned agents, and a live brain that shows learning

- **Gap.** Synapse had no chat, could not sign in to builderforce.ai, could not reach the workspace's agents, and showed what Evermind learned only as lists (Gap Register G5, plus the operator's 2026-09-27 report: "missing all the concepts of the chat and assigning an agent … they should also login to builderforce.ai … need a large brain (left / right hemispheres) … visualisations of learning").
- **Sign-in.** `desktop/crates/bf-cloud` is the builderforce.ai client: the platform's device flow (`/api/auth/device/code` with `client: "synapse"` → `/activate` → the `bfk_` key), the key → workspace-token exchange with refresh and workspace re-scoping (`/api/vscode/tenants/:id/token`), API calls that re-exchange once on a 401 and sign out on a refused key, and the LLM gateway. The key lives in the OS credential store through `desktop/crates/bf-vault` — the skill-secret vault moved out of `bf-teach` so there is ONE wrapper (entry names unchanged, so saved skill passwords still resolve). App side: `app/src-tauri/src/cloud/{mod,account}.rs`; UI `js/cloud/{accountStore,accountPanel}.js` (sidebar account line, sign-in card with the code, workspace switcher, sign out). The platform half: `DEVICE_CLIENTS` (`packages/creation-canvas-contract/src/deviceClients.ts`) names the minted key after the app and `/activate` names the app to check the code against (`1031c53ad`).
- **Chat.** `app/src-tauri/src/cloud/chat.rs` + `js/views/chat.js` and `js/chat/{chatList,transcript,composer,agentsBar}.js`: the workspace's Brain chats (`/api/brain/chats`, the same store as the web and VS Code), create, transcript with author and recipient, assign/remove agents from the workspace pool (own + purchased workforce, active registered), address an agent in *To* or with `@Name` (posted with `addressedTo` metadata — the platform dispatches that agent's reply with its own tools, as the person), and *Open on the web*. The Brain's own turn runs in Synapse (`cloud/brain.rs`): the person's private Evermind recall (`memory_recall`) as context, one gateway completion, posted back as the assistant turn; a failure is shown beside the chat, not written into the shared transcript.
- **The brain.** `js/brain/{regions,brainStore,brainSvg,sidebarBrain,brainPanel,charts}.js` + `brain.css`: two hemispheres — left KNOWS (neocortex = procedures learned into the private model, semantic memory = facts, thalamus = what tools ask the index), right DOES (hippocampus = demonstrations, basal ganglia = skills + runs, amygdala = approval decisions, hypothalamus = routines). ONE region taxonomy feeds the sidebar brain and the Evermind page's knowledge map, legend (click to filter), stat tiles (model, learned, queued, training loss), recently-learned list, loss-per-adaptation chart and 30-day activity chart. Every number comes from the store: builderforce-memory `9ccf503` (released 2026.9.29) records each adaptation with its measured loss (`recordAdaptation`), computes `experienceOverview` in the engine, and serves it as `experience_overview`; `agents/evermind.rs` (the Evermind commands split out of `commands.rs`) adds the facts count and the most important facts.
- **Also.** `semantic_search` hit sources now serialize in the shared contract's words (`keyword | embedding | hybrid`, `bf-index/src/search.rs`, pinned by a serialization test) — the Gap Register's three-vocabularies entry. `app/src-tauri/src/pool.rs` is the one off-UI-thread helper both command modules use. Synapse 2026.9.30. Release note 1188 and the post *A private brain on your desktop that hands the work to your agents* (5 locales).
- **Verification (Sonnet).** Desktop: `cargo check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace` 33/33, release build `synapse.exe` (44,993,024 bytes), every UI module parses. Platform: api `npm test` 36/36 guards + 10,603 tests; frontend typecheck, i18n key guard, i18n tests 117/117, blog tests 45/45; contract package incl. `deviceClients.test.ts`; migration sequence guard. Still open: a live run with a real account (Gap Register).
## ✅ RESOLVED 2026-09-27 — builderforce-memory 2026.9.29 reaches the MCP Registry again (2026.9.27 and 2026.9.28 never did)

- **Gap.** The v2026.9.27 and v2026.9.28 release runs published to npm, then failed at "Publish to the MCP Registry": the registry rejects a `server.json` description longer than 100 characters (ours was 197). The registry listing stayed at the older version, and nothing checked the limit before publishing.
- **Fix.** The description is shortened to 95 characters. `scripts/sync-mcp-registry.mjs` now fails `registry:check`, the CI gate that runs before npm publish, when the description is over 100 characters.
- **Contents.** 2026.9.29 also ships the experience fixes (`8d39e1f`, `005116d`) and adaptation history plus the `experience_overview` tool (`9ccf503`).
- **Verification (Sonnet, clean worktree at `c47119a`).** Engine 425/425, runtime 634/634, mcp 53/53; plugin and registry checks and tsgo clean; generated artifacts byte-identical. Release run 36357995369 is green: the first registry attempt raced npm propagation and passed on re-run. npm `latest` is 2026.9.29 for engine, runtime and mcp, and the MCP Registry lists 2026.9.29.

## ✅ RESOLVED 2026-09-27 — An Evermind on the board stands in the Room as a 3D brain with its learning centres

- **Gap.** Switching from Board to Room with an Evermind on the canvas showed only the session diorama and the approval desk; the model's Knowledge Map existed only as a flat SVG on the card.
- **Station.** `evermind` joins `ROOM_STATION_SPECS` (`lib/canvas/roomStations.ts`) — one brain per Evermind object, carrying its project (`evermind:<id>`) once attached. The station contract (`room-stations/types.ts`) now takes a `look` of either a `face` (DOM on a board) or a `body` (scene-graph content in the board's box, `ROOM_STATION_BODY_BOX`); `RoomStationStand` stands a body on the same post, caption and drag.
- **The brain.** `room-stations/evermind/EvermindBrain3D.tsx` + `evermindBrainAnatomy.ts`: a translucent, folded cortex (neocortex) with the centres placed anatomically — personality at the prefrontal pole, paired hippocampi and amygdalae, thalamus as the relay every pathway runs to, basal ganglia beside it, hypothalamus beneath, plus cerebellum and brainstem. One lit point per fitted learning on the cortex and per taught memory at the hippocampi; centres pulse while learning; sway, never spin; honours reduced motion. Hues are the theme's `--ev-*` tokens, re-read on theme change; names float as DOM labels.
- **One derivation, one read.** `evermindRegionSignals` (`lib/evermindRegions.ts`) is the charge/count/active rule the Studio's `EvermindBrainMap` now uses too; `hooks/useProjectEvermindActivity.ts` is the ONE live read (server-cached endpoint, 20 s poll), migrated into `EvermindStudioCenter`. The station's panel is `EvermindStudioCenter` itself, so the room adds no third reading. A blueprint (local draft / unattached) stands dormant with a hint to attach it.
- **i18n.** `roomStations.evermind.*` in all five catalogs; centre names reuse `creationCanvas.node.region*`.
- **Verification (Sonnet).** `npm run typecheck` 2/2 guards; vitest evermindRegions, roomStations (lib + component), i18n catalog/messages parity — 129/129.
- **Deploy fix.** The first push failed `check:design-scale` (hex fallbacks in the brain, `999px` radii and raw font sizes in its label CSS). Colours now come only from theme tokens, labels use `--radius-full` and the eyebrow/field-label size roles; `npm run check` 23/23.
- **Version.** UI 2026.9.40.

## ✅ RESOLVED 2026-09-27 — The experience "already learned" ledger is tied to the adaptation that learned each procedure

`memory-mcp/src/experience/train.ts` trusted the store's `learned` ledger for any `+expN` model, so rolling back by renaming `<model>.prev` over the current model left the discarded version's procedures marked as learned forever. Each ledger entry now records N of the `+expN` adaptation that learned it (same `Record<id, number>` shape, so Synapse's client is unaffected), and `pendingDocuments` trusts only entries at or below the loaded model's N: a rollback re-teaches exactly what was discarded, and a fresh base (N = 0) relearns everything. Covered by a rollback case in `tests/experience.test.mjs`; builderforce-memory engine/mcp suites and a stdio end-to-end smoke of Synapse's call sequence are green.

## ✅ RESOLVED 2026-09-27 — Experience review: owner-only HTTP exposure, scoped forget-all, atomic writes, step validation

A review of the unreleased experience work (builderforce-memory `acf8c5a`) found five defects, all fixed in `8d39e1f` before any release:
- **Open HTTP exposure.** With `BUILDERFORCE_MEMORY_EXPERIENCE=1` and no token, the HTTP bin (listening on all interfaces) served `experience_forget_all` and `experience_train` to anyone who could reach the port. Experience tools are now served only to a caller holding the owner's `BUILDERFORCE_MEMORY_TOKEN`, never in open mode or to a token-selected tenant. Synapse uses stdio, so it is unaffected.
- **Forget-all deleted a user folder.** It removed `dirname(memoryFile)/episodes` recursively, which could be the user's own folder. It now removes only the folders of episodes the store knows.
- **Non-atomic writes.** `SharedJsonFile` writes to a temp file and then renames it, so a crash no longer truncates `memory.json` or `experience.json` into an empty store that the next write persists. The trained model is staged and renamed the same way.
- **One bad step broke training.** `episode_save` now checks every action field the corpus and replay read. A secret value is never stored, and `skill_schedule` drops values for secret parameters. An empty secret value is still accepted, as the Synapse recorder sends one.
- **Unknown schema overwritten.** A snapshot in a newer schema is refused, and the file is left untouched.
- Unconsumed experience exports were dropped from the memory-mcp and engine barrels.
- **Verification (Sonnet).** Engine 422/422, runtime 634/634, mcp 53/53 (3 new regression tests), plugin and registry checks and tsgo all green.

## ✅ RESOLVED 2026-09-27 — "This chat's changes": the pending-changes pill scoped to the chat, without a cross-tenant read

- **What was on the tree.** An uncommitted edit, carried over from `feat/app-blueprint-detection`, started scoping the VS Code "Changes (N)" pill to the files the active chat changed. As written it could not ship. `WorkDeltaService.getDeltasForChat` read `work_deltas` by `chat_id` alone, and the new `GET /api/brain/chats/:id/files` checked no chat access, so any signed-in user could list another tenant's changed files; `check:tenant-scope` failed (0 → 1) and blocked the API deploy. The webview read `window.__INIT_DATA__.baseUrl`, which does not exist, and its caller still passed one argument, so the VS Code build failed and the filter could never run. Its matching used `endsWith` in both directions without a path boundary, so `a.ts` claimed `data.ts`.
- **Fix.** `application/delta/chatChangedFiles.ts` is a tenant-scoped read (`tenant_id` AND `chat_id`), kept out of `WorkDeltaService`. The route gates on `brainService.canAccess`, like `/chats/:id/stream`, and answers 404 otherwise. Migration 1187 adds `idx_work_deltas_tenant_chat` (partial, `chat_id IS NOT NULL`). The read is not cached: a running chat records deltas turn by turn, and each read is one indexed lookup. Webview: `useChatChangedFiles(apiReq, chatId, ticketRefresh)` fetches through the shared `authedFetch`; this is an ambient read, so a failure shows every change. The pure `scopeChangesToChat` matches whole paths only (repo-relative, absolute, or absolute ending in `/<recorded>`), ignoring case and separators, and an unknown or empty list keeps every change. `usePendingChangesExtension(labels, chatFiles)` only builds the view model.
- **Verification (Sonnet).** api `npm test` (the deploy gate): 36/36 guards, including `check:tenant-scope`, and 10,603 tests passed; `src/application/delta` 8/8. VS Code: type-check clean on all four projects; `chatChangeScope` 4/4; full suite 464/464.
- **Versions.** api 2026.9.45 · VS Code 2026.9.94.

## ✅ RESOLVED 2026-09-27 — Evermind is a module of builderforce-memory; every host copy now consumes it

- **Gap (composition audit 2026-09-27).** The model and cognition lived in the packages, but the portable Evermind pipeline (adapt → delta wire → FedAvg merge → eval, recall ranking, the teach floor, the memory block) lived in the api and was copied across agent-runtime, brain-embedded, frontend and the VS Code client behind "mirrors / keep in sync" comments. The frontend copy had already drifted (no tier fields) and the Brain memory block bypassed recall sanitisation.
- **Engine — `@seanhogg/builderforce-memory-engine` `evermind/`.** The `.evermind` package moved out of `moe/`; `adaptAndDiff` is the ONE adapt recipe; the delta wire contract (`parseDeltaLearnPayload`, `buildDeltaLearnPayload`, `decodeDeltaPayload`, `deltaUnusableReason`, `MAX_DELTA_B64_CHARS`); FedAvg `mergeCheckpointDiffs`; forward-only `meanEvalLoss`; `bytesToBase64`/`base64ToBytes`. The stale `VERSION`/`DESCRIPTION` ("MambaCode.js 2.0.0") are gone.
- **Runtime — `@seanhogg/builderforce-memory/evermind`.** Recall contract types, `EVERMIND_MIN_TEACH_CHARS`, `rankEvermindRecall`, `hashRecallQuery`, `countReconciledMemories`, and `formatEvermindMemoryBlock`, which now runs every memory through `sanitizeRecalledFact` and tells the model recalled memories are data, never instructions.
- **MCP — `@seanhogg/builderforce-memory-mcp/compaction`.** VS Code `memorySnapshot.ts` plans with `planCompaction` instead of its fork.
- **Hosts.** api: `evermindMerge`, `evermindEval`, `evermindRecall` (+ tests) deleted; `evermindEmbed` is `lm.embed` + the package base64; `evermindDeltaLearn` keeps only the HTTP status map and head admission; the coordinator DO, routes, delta dispatch, `projectEvermind` and `brainEvermindLearning` import the packages. agent-runtime: the delta producer adapts and builds its payload with the engine. brain-embedded: re-exports the runtime module (its tests moved into the package). frontend: its drifted recall types/client are gone; `CreationCanvas` uses `projectMemoryHooks`. `agent-runtime/extensions/memory-lancedb` was still pinned to 2026.7.11 — aligned.
- **Public API = the consumed surface.** 2026.9.28 removed seven exports nothing outside the package used. memory + memory-mcp tsconfig moved to `moduleResolution: bundler` like the engine (emitted JS byte-identical; tsgo/TS 7 now clean).
- **Kept on purpose.** The three Evermind version-ref parsers: the ref grammar is owned by the api's R2 layout and each parser answers a different question.
- **Also fixed.** `EvermindConsole.operate.test.tsx` had 5 failures since the CTA became "Copy full diagnostics" (d3a9237dc) — selector updated.
- **Verification (Sonnet).** Packages on clean worktrees at 2026.9.27 and 2026.9.28: engine 405/405, runtime 634/634, mcp 44/44, plugin + registry checks green. api type-check green, full vitest 10,601 passed, Evermind suites 103/103; agent-runtime typecheck + 20/20; brain-embedded 828/828; brain-ui 140/140; frontend type-check green; VS Code memory suites 20/20.
- **Versions.** builderforce-memory 2026.9.28 (npm) · api 2026.9.44 · agent-runtime 2026.9.4 · brain-embedded 2026.9.38 · frontend 2026.9.39 · VS Code 2026.9.93.
- **Next slice.** ROADMAP → Evermind / SSM → "P2 — Evermind consolidation, second slice".

## ✅ RESOLVED 2026-09-27 — Synapse Self-Directed Agents: teach a task once, it does it again (opt-in), on the ONE Evermind store

Closes gap-list rows G1 (acting in native apps), G2 (vault + takeover), G3 (routines), G4 (approval gate + audit trail), G9 (Train Once), G10 (memory you can see and edit) and G12's training half.

- **No second Evermind.** An earlier draft had built a Rust `bf-evermind` crate (its own store, compiler and schedule); it was deleted. Experience is the engine's third kind of learned item beside facts and weights: `@seanhogg/builderforce-memory-engine` `src/experience/` owns the types (Episode, Skill, Run), `trainOnce`, the approval rule (irreversible labels in all five product languages), routines (`isDue`/`dueSkills`), the learning corpus (`experienceDocuments`/`packDocuments`) and the `ExperienceStore` port + `InMemoryExperienceStore`, with a learned ledger so each procedure is fitted once. Pure, no I/O.
- **Persistence is memory-mcp's.** `FileExperienceStore` keeps `experience.json` beside `memory.json` (plus `episodes/<id>/` screenshots, deleted with the episode) through `SharedJsonFile` — the freshness check and loop guard extracted from `DiskPersistedBackend`, which now uses it too, so memory and experience share one implementation. 19 experience tools (`episode_*`, `skill_*`, `skills_due`, `run_*`, `experience_info`, `experience_forget_all`, `experience_train`) register only with `BUILDERFORCE_MEMORY_EXPERIENCE=1` (ordinary coding-agent installs never carry them) and never for a token-selected HTTP tenant.
- **Training uses the ONE recipe.** `experience_train` adapts the person's `.evermind` (`BUILDERFORCE_MEMORY_MODEL`) with the engine's new `adaptPackage` — the exact `adaptAndDiff` diff, applied locally — and `EvermindModelPackage.withCheckpoint` (checksum recomputed). Versions go `<base>+expN`; the previous model is kept as `.prev`; a fresh base relearns everything.
- **Synapse keeps only hands, eyes and its opt-in.** `bf-teach` (UI Automation capture/replay, vault, Esc takeover) now carries its own copy of the engine's wire types; the new `bf-memory` crate is an MCP stdio client that launches the same memory-mcp every host uses (env override → sibling checkout → the installer's `npx` spec). Agents, runs, scheduler (`skills_due` every 30 s) and the window's commands all go through it; commands run off the UI thread; training runs on its own server child. The opt-in and the model path live in Synapse's `agents.json`.
- **UI:** Teach, Review, Skills (run form + routine form), Runs (live run + audit trail), Evermind (facts from the shared snapshot, forget via `memory_forget`, choose/train the model, forget everything learned) and a global approval prompt; all five locales; token-driven theme; narrow-window layout.
- **Also fixed on the way:** `builderforce-memory-mcp-http` never passed `persistFile`, so the HTTP server lost its store on every restart; the dynamic-import helper (3 copies), the `.evermind` + tokenizer loader (embedder vs training) and the tool-result helpers were each extracted once and every copy migrated; `tools.ts` split (tool core, gateway cost tools).
- **Shipped as:** Synapse 2026.9.29 · release note migration 1186 · blog post `teach-it-once-and-it-does-it-again` (5 locales).
- **Verification:** engine jest (28 suites, 422 tests) and memory-mcp node tests (incl. `tests/experience.test.mjs`) green; Rust workspace check/clippy/tests and the release build by the Sonnet runner. Still open: exercising record → replay on a real desktop (Gap Register, blocker: an interactive session).

## ✅ RESOLVED 2026-09-26 — Both deploys red: 17 API type errors, two frontend ratchets, and what was underneath them

- **What broke.** The API deploy failed type-check (tsgo AND tsc) on 17 errors and the frontend deploy failed two ratchets (`check:design-scale` +4, `check:architecture` 1002 > 1001). All of it was committed at HEAD by the blueprint-detection merge (`58be2cdf4`), the W5/W6 commit (`fa87083ca`) and the cloud-connector catalog (`58cca921a`). The errors were the visible edge of five real defects, each fixed at its seam rather than at the compiler's line number.
- **1. `cloud` connector category never reached the integrations catalog.** `CONNECTOR_CATEGORIES` gained `cloud` (ten manifests carry it); `integrationCatalog.ts`'s total map had no row for it, so the API did not compile — and had it compiled, the frontend mirror would have grouped every cloud connector under "Other". `cloud` is now an `IntegrationCategory` (after `devtools`, with the same reasoning `hiring` records) on both sides, and `integrationsIndex.category.cloud` is in all five catalogs.
- **2. The blueprint tool catalog described a blueprint that does not exist, and nobody could ever have called it.** `appBlueprintToolCatalog.ts` read `packageManager / framework / environmentVariables / customDomains` off `AppBlueprint`, none of which the contract has (they live on `services[]`). Its `app_blueprint.write_override` replied "Blueprint override saved" and saved nothing. Its `app_blueprint.detect` called `detectAndStoreBlueprint` with neither a repo dir nor credentials, which THROWS — so did the W5 webhook path, silently, on every push, behind the placeholder `// For now, we'll try without token for public repos`. And `getLatestBlueprint` sorted ascending, returning the OLDEST blueprint to the run loop. Now: one `summarizeBlueprint` shape for both read tools (secrets as names only); `write_override` deleted — the contract's override path is `builderforce.json`, which nothing read, so `builderforceJsonDetector` now reads it and a pure `applyOverrides` (allowlisted top-level fields, arrays replaced) lays it over detection; ONE use case `detectBlueprintForProject(db, env, { tenantId, projectId, commitSha? })` — project → default repo (`resolveDefaultRepoForProject`, split out of the task resolver, one query body) → `resolveRepoCredential` → head sha via `resolveRepoRefSha` when no commit is given → sources → detect → store, never throwing — used by the webhook (for EVERY tenant that links the repo, via the new `resolveRepoLinks`; branch-delete pushes skipped) and by the tool (now `mutates: true`, `commitSha` optional, and tenant-scoped through `projects.getProject` before any read or write, since `project_app_blueprints` is keyed by project alone). The two hand-rolled readers are gone: a Node `fs` one that cannot run in a Worker, and a raw GitHub `fetch` one with a non-UTF-8 `atob`, each carrying its own copy of a 14-file list that had drifted from the detectors' own `reads` (`vite.config.mts`, `next.config.ts`, `prisma/schema.prisma` were never fetched). `blueprintSources.ts` derives the list from the detector registry and reads through the provider-agnostic `readRepoFile` — ONE tree listing, then only files that exist (each read is a subrequest inside a webhook `waitUntil`), falling back to read-everything when the listing fails or is truncated.
- **3. `edit_file` promised a hint it never computed.** `cloudAgentEngine` spread `edit.nearest` and `edit.region` that `applyStringEdit` did not return. Built rather than deleted: the shared primitive now returns `nearest` (the line matching `old_string`'s first non-empty line, ±3 lines, equality before a ≥8-char "contains" fallback) on a miss and `region` (1-based span of the first replacement, CRLF-safe) on a hit; `RepoEditResult` types both. The run transcript that prompted this pass shows an agent failing `old_string not found` five times in a row on one file — this is the answer to that.
- **4. `companyId` (W8) was required on `ProjectProps` and persisted nowhere.** `ProjectRepository` neither read nor wrote it (so "company → project in one step" created projects with no company), three fixtures lacked it, and `UpsertProjectBody` / `ScaffoldProjectBody` did not declare the field their handlers read. Repository maps it in `toDomain`/`save`/`update` (null persists so it can be cleared); one `companyField` is spread into all three schemas.
- **5. Frontend ratchets.** Seven files had added 29 literal font sizes (`AgentHostProjectsContent` 14, `CredentialKeyForm` 4, `LivePreviewPanel.module.css` 4, `integrationStyles` 3, `LateSteerNote` 2, `ContentManagerRedirect` 1, `CanvasLibraryClient` 1) — every one now names its role token (10 → field-label, 11 → eyebrow, 12/13 → small, 14 and 0.95rem → body); floor 3459 → **3434** (closes Gap Register "Room stations" item 4, which had been waiting on exactly this). `'use client'` 1002 → **998**: `lib/appVersions.ts`, `lib/guestChatApi.ts`, `lib/guestPromptCapture.ts`, `lib/visitorJourney.ts` export functions, not components — the directive marked no boundary (the `domainExtras.tsx` rule, stated in each file); `ImportStatCard` keeps its directive because `ImportProgressBar`'s docblock already argues for it.
- **Also closed while here.** `webdit/converter/pnpm-lock.yaml` still pinned vitest 2.1.9 against the `^4.0.18` manifest (commit `43b94a797` bumped the manifest without the lock), so CI's frozen install failed and silently fell back to a non-frozen one — and a `--lockfile-only` refresh kept a stale `vite@5.4.21` entry that nothing requests, so vitest 4 could not even start (`./module-runner` is not exported by vite 5). The lockfile AND `node_modules` were deleted and re-resolved from scratch (deleting the lockfile alone re-adopts the cached vite 5 from `node_modules`); `webdit/shared` and `webdit/torch` had the identical stale pin against their own `^4.1.11` manifests and got the same treatment (`webdit/runtime` is on vitest ^2 consistently and was left alone). `packages/agent-tools` had no `typecheck` script and could not be type-checked standalone: no `@types/node` or `typescript` devDependency for its `node:*` modules, five "possibly undefined" index reads in tests, and `semantic-tools.test.ts` building a hit with `source: 'both'` against a `'embedding' | 'keyword' | 'hybrid'` union. It now has `typecheck`, both devDependencies at the repo's common specs (`@types/node ^24.7.2`, `typescript ^6.0.3`), `"types": ["node"]` in its tsconfig (TS 6 does not auto-include `@types/node` there), narrowed tests, and a fixture on `'hybrid'`. That last one uncovered a REAL drift — the Rust index emits `keyword | vector | both` and `desktopContext.ts` passes it through unmapped — which is logged in the Gap Register (Desktop section) with its blocker: those files are held uncommitted by a concurrent session.
- **Where:** `api/src/application/blueprint/{blueprintDetection,blueprintSources,blueprintOverrides,detectBlueprintForProject}.ts` (+ tests), `blueprint/detectors/{index,builderforceJsonDetector}.ts`, `llm/appBlueprintToolCatalog.ts`, `repos/resolveDefaultRepo.ts`, `contributors/activityIngest.ts` (+ test), `integrations/integrationCatalog.ts`, `infrastructure/repositories/ProjectRepository.ts`, `presentation/routes/{githubWebhookRoutes,projectRoutes.schemas}.ts`; `packages/agent-tools/src/{edit,capabilities}.ts` (+ test); `frontend/src/lib/integrationCatalog.ts`, seven styled files, four `lib/*.ts`, five message catalogs, `scripts/check-design-scale.mjs`, `scripts/.frontend-architecture-baseline.json`, `scripts/check-frontend-architecture.mjs`; `webdit/converter/pnpm-lock.yaml`; `specs/builderforce/31-prd-customer-app-platform.md` (the override row).
- **Verified (Sonnet passes):** `api` type-check GREEN on tsgo and tsc (all 17 gone); targeted suites 110/110 (`integrationCatalog`, `blueprintOverrides`, `blueprintSources`, `detectBlueprintForProject`, `resolveDefaultRepo`, `activityIngest`, `epicDecomposition`, `listTasksArchived`, `ProjectService`, `builtinMcpService`) and `application/blueprint` + `application/repos` 333/333; `agent-tools` `pnpm run typecheck` clean (first time it has been possible), `edit.test.ts` 14/14 and the package 145/145; frontend `tsgo` clean, `pnpm run check` **23/23** with design-scale and architecture both exactly at baseline, `integrationCatalog.test.ts` 8/8; `webdit/converter` 113/113, `webdit/shared` 19/19, `webdit/torch` 61/61, each on vite 8.3.1 with `pnpm install --frozen-lockfile` passing afterwards; `api` type-check re-run green after the agent-tools lockfile change. **On `main` (`12a264286`):** Deploy frontend GREEN and live (23/23 guards, worker deployed); Deploy API was one guard short — its step runs the FULL api `pnpm run check` (36 guards), not `type-check` alone, and `check:silent-catches` caught two pre-existing empty `catch {}` bodies in `capacitorConfigDetector.ts` / `expoConfigDetector.ts` (from the original blueprint merge). Both now state their fallback (`77afdd2ce`, verified with the 36-guard `pnpm run check`) — and that push was STILL red, because the step's command is `npm test` = `check && vitest run`, the whole api suite, and `entityCatalog.test.ts`'s table-coverage ratchet sat exactly at its ceiling with `project_app_blueprints` (the blueprint merge's migration) neither catalogued nor adjudicated. Adjudicated per the `brain_chat_diagnostics` precedent (`68814c19d`). Lesson, recorded twice over: verify with the deploy step's exact command (`npm test` in `api/`), not `type-check`, not `check`.
- **Versions:** api 2026.9.43, frontend 2026.9.38, agent-tools 2026.9.27.

## ✅ RESOLVED 2026-09-26 — Synapse: one local code index for every AI tool (phase 1)

- **Gap.** Every agent oriented itself in a repository by grepping and paging through files, from nothing, and each AI tool did so separately. VS Code search was ripgrep only; the workspace digest was one fact per sub-project; Evermind embedded memories but not code; and a recalled memory naming deleted code was obeyed. Nothing flagged it.
- **Rust workspace `desktop/`.**
  - `crates/bf-index`: tree-sitter chunking at definition boundaries (Rust, TS/TSX, JS, Python, Go, Java; line windows for everything else), symbols, a reference-ranked repo map, identifier-aware FTS5 BM25, local fastembed embeddings fused by reciprocal rank, a debounced file watcher, and `check_references` (which code paths and symbols in a text no longer exist). One SQLite file per workspace under `~/.builderforce/desktop`, never in the repo.
  - `crates/bf-context`: a workspace registry, ONE operation surface (`api::dispatch`), a loopback HTTP server (per-start bearer token, browser `Origin` refused, discovery file at `~/.builderforce/desktop.json`), an MCP stdio server for Claude Code / Cursor (it forwards to the running app's warm index, or serves in-process), and the headless `bf-context` binary.
  - `app/`: the Tauri 2 tray app, in the builderforce.ai design language (brand tokens, logo, light/dark from the OS, sidebar that becomes a top bar in a narrow window). It has four views. **Workspaces** shows live cards and, per workspace, stat tiles and the repo map an agent sees, at a chosen token size. **Search** runs the same query an agent would, and each hit shows whether it matched by keyword, meaning or both. **Activity** shows what VS Code and MCP clients asked, from an in-memory log (`bf-context/src/activity.rs`); clients name themselves with `X-Builderforce-Client`, and the window's own polling is not recorded. **Connect** shows when each tool last made a request. The UI is ES modules (`ui/js/`: shell, store, bridge, views/*), localized in en/de/es/fr/zh. `synapse mcp` is the same executable acting as the MCP server.
- **Shared tools.** `semantic_search` and `repo_map` are defined once in `@builderforce/agent-tools` (`semantic-tools.ts`) behind a new `repo.semantic` capability. No cloud surface backs it.
- **VS Code.**
  - `desktopContext.ts` is the one client: discovery, a cached probe, the `repo.semantic` capability, `desktopBackedTools` (the two tools are withheld per run while the app is not running), `registerWorkspace` on folder open, and `checkReferences`.
  - The repo map joins every turn's grounding (`grounding.ts`, used by both chat surfaces).
  - `memoryStaleness.ts` flags recalled memories whose references are gone. It covers both `recall_facts` (`possiblyStale`) and the Evermind recall block (`withWorkspaceStaleness`, host run and native participant).
  - The two tools are pinned in `LOCAL_WORKSPACE_TOOLS` and are in the read-dedupe and tree-wide read sets.
- **Distribution.** `.github/workflows/desktop-release.yml` (tag `desktop-v*` or manual) tests the service crates, builds installers for Windows, macOS arm64/x64 and Linux with `tauri-action`, signs when the secrets exist, and uploads `bf-context-<target>` binaries.
- **Launch.**
  - The `/agents` page has a `DesktopAppDownload` section; the backtick renderer was extracted to `components/marketing/inlineCode.tsx` and the page migrated to it.
  - Blog post `one-local-index-for-every-ai-tool` in five languages.
  - Release note migration `1185`.
- **Tests:** `bf-index` unit tests (terms, chunking, fusion, repo map, refs, index end to end), `bf-context/tests/api.rs` (dispatch plus HTTP auth/origin/discovery), `agent-tools/semantic-tools.test.ts`, VS Code `desktopContext.test.ts`, `memoryStaleness.test.ts`, and the pin case in `localToolsAdvertised.test.ts`.
- **Versions:** desktop 2026.9.27, agent-tools 2026.9.26, brain-embedded 2026.9.37, VSIX 2026.9.92, frontend 2026.9.37.
- **Still open** (ROADMAP → Synapse): signing and in-place updater (credentials), the measured with/without eval (live runs), on-prem `repo.semantic`, local model serving, and the local browser/VM host.

## ✅ RESOLVED 2026-09-24 — The execution surface is a plan decision, and the diagnostic says which one ran

- **What:** A cloud run's surface is now decided by what the workspace pays for. **Free → `durable`** (Cloudflare's on-demand serverless Durable Object — free infrastructure, shell-LESS, edits surgically over the git API). **Paid → `container`** (a long-lived Cloudflare Container with a real shell and a local clone, which is what "a cloud agent should clone the repo and work like the editor agent opened into that directory" actually means). New paid flag `planFeatures.containerRuntime` — sibling of `livePreview`, same resource, different hold. `resolveCloudSurface(surface, hasExplicitHost, { containerAllowed })` applies it and DEMOTES an explicit `runtime_surface = 'container'` for an unentitled workspace, because a gate that only moved the default would be bypassable by writing one varchar. An explicit `'durable'` is preserved on every plan — "serverless on purpose" was previously inexpressible, since an explicit choice and an unset column fell through the same `else`. A pinned on-prem host stays `container` on every plan: that is the customer's own machine, and the entitlement is about OUR compute.
- **Why the earlier default flip changed nothing:** the default was hard-coded `'durable'` in FOUR places that all ran BEFORE `resolveCloudSurface` saw the value — `cloudAgent/agent.ts` collapsed `null → 'durable'`, both workforce write paths wrote a concrete `'durable'` on create/update, and the MCP `cloud_agents.create` tool did too. The web picker defaulted to `'durable'` on top of that, so **every cloud agent ever created in the UI pinned itself to the shell-less surface permanently**, including after an upgrade. All four now leave the column UNSET and the picker's first option is **Automatic**, so an agent created on Free moves to the container the moment the workspace upgrades with nobody editing it. `ResolvedCloudAgent.runtimeSurface` is `string | null` for the same reason: that resolver does not know the plan, so it must not invent a default.
- **The UI refuses instead of degrading.** `RuntimeSurfaceSelect` already existed to stop a user choosing a surface the project cannot run (`github_actions` without the workflow); `container` is now conditional the same way, on the plan rather than the repo, with the reason in the option's own text (a screen reader announces the option, never the prose beside it). Tri-state throughout: a missing consumption snapshot is UNKNOWN and never locks anything. Both submit guards were each rebuilding the refusal sentence from the surface key, which forced one generic *"not available for this project"* onto what is actually a plan refusal — telling a free workspace to go fix its repo. One `useRuntimeSurfaceRefusal` hook now returns the right message and both forms consume it. Localized in all five catalogs.
- **A demotion narrates itself.** An agent configured for `container` before the gate existed still reaches dispatch, so a `runtime.route` tool event says the run is on durable, why, and what that costs it ("edits go through the git API rather than a shell, so this run cannot build or test in place"). The run still executes — the work gets done on the surface the plan covers.
- **The diagnostic now knows WHERE work ran.** It reported the origin client and the plan; it had **no concept of `durable` vs `container`**, and none of an on-prem host — although `executions.payload.executor` has been stamped at dispatch all along and `executions.agent_host_id` names the machine. Two runs whose only difference was whether a shell existed rendered identically. Each run line now ends `· on container` / `· on durable` / `· on on-prem "<machine>"`, with a `ran on:` summary spelling out the capability, and the plan line carries `container runtime NOT entitled`. Three new signals: every-run-shell-less (**naming the plan or a demotion as the cause — same symptom, opposite fix**), some-shell-less, and no-executor-recorded. The `Surface:` line now says it means where the CONVERSATION runs, since `ran on:` answers a different question about different machines. Host names resolve in ONE bounded `IN`, only when a run went to a machine — an id is as unreadable here as the raw agent uuids this report used to print.
- **Also fixed — GitHub Actions runs were being reaped early.** Found by a test written for something else. `parseExecutor` recognised only `'durable'` and `'container'`, while `CloudExecutor` has three values and `withExecutor` stamps all three, so both readers of the third were silently dead. `githubActionsReconcile` SQL-prefilters rows on `"executor":"github_actions"` and then filters them through `parseExecutor`, described one line above as *"what actually decides"* — so **the Actions reconcile sweep returned ZERO rows on every pass** and a run that never started was never reconciled, only ever hitting the generic backstop. And `cloudSilenceCeilingMs`'s explicit `'github_actions'` branch (20 minutes, because a queued GitHub runner legitimately sits silent for minutes) never fired, so **healthy queued Actions runs were measured against the 5-minute long-lived ceiling and could be orphaned**. `parseExecutor` now round-trips every value `withExecutor` can stamp. `'worker'` (the removed in-request executor) still reads as undefined, which the ceiling treats as long-lived, so an unknown never causes a reap. No test had pinned the old behaviour — nothing in the reaper, orphan or reconcile suites mentioned the surface at all, which is why it survived.
- **Also fixed (pre-existing, unrelated — a RED guard, so fixed rather than logged):** `frontend`'s i18n guard was failing in all five locales on `marketplace.family.kind.advisor`. `marketplaceFamilies.ts` builds that key for the `advisor` kind (an alias onto the talent family, not a fifth family), and no catalog defined it. Added to all five with real translations.
- **Also fixed (pre-existing, same class):** `clients/vscode/webview/src/planSnapshot.ts` declared its OWN copy of the plan-snapshot type and it had drifted — `/api/consumption` returns `features` (which decides, among other things, whether a run gets a shell), the local shape did not declare it, so the field was fetched, typed away and unreportable in the VSIX. It is now an alias of the shared `ChatDiagnosticsPlanSnapshot`. The hand-maintained client `PlanFeatureKey` union had drifted the same way (missing `evermindTraining`, `livePreview`); closed. `runtimeRoutes.ts` imported `resolveCloudSurface` and never called it — dropped.
- **Layering:** `resolveFeatureEntitlement` / `tenantHasFeature` / `toTenantPlan` moved from `presentation/middleware/featureGate.ts` into `application/tenant/featureEntitlements.ts` (featureGate re-exports the gates). Cloud dispatch needs the entitlement and has no route handler in scope; reaching up into presentation from the application layer would have been the violation. The read is served from the cached tenant plan snapshot (L1 + KV), so it is not a per-run round trip, and it is keyed on the TENANT, not the caller — the spend belongs to the workspace, and a board-auto run has no human at all, so keying on whoever pressed Run would hand one tenant two different surfaces depending on the pathway.
- **Where:** `api/src/domain/tenant/{PlanLimits,planFeatures}.ts`; `api/src/application/tenant/featureEntitlements.ts`; `api/src/presentation/middleware/featureGate.ts`; `api/src/application/runtime/{cloudDispatch,dispatchCloudRun}.ts` + `cloudAgent/agent.ts`; `api/src/application/brain/chatRunHistory.ts`; `api/src/application/llm/builtinMcpService.ts`; `api/src/presentation/routes/{workforceRoutes,runtimeRoutes}.ts`; `brain-embedded/src/{chatDiagnostics,gatherChatDiagnostics}.ts`; `packages/brain-ui/src/chatTickets/{types,restAdapter}.ts`; `clients/vscode/webview/src/planSnapshot.ts`; `frontend/src/lib/builderforceApi.ts`; `frontend/src/components/workforce/{RuntimeSurfaceSelect,CloudAgentFormFields,CloudAgentSlideOutPanel,WorkforceAgents}.tsx`; `frontend/src/i18n/messages/{en,zh,es,fr,de}.json`.
- **Verified (Sonnet passes):** `api` type-check clean (tsgo AND tsc); `cloudDispatch` 36/36, `chatRunHistory` 17/17, `domain/tenant` 64/64, `application/tenant` 25/25, and the broad `application/runtime` suite **67 files / 709 tests green** — which is the one that matters for the `parseExecutor` change, since it contains `githubActionsReconcile.test.ts` and `orphanReasons.test.ts`. `brain-embedded` build + tsgo + tsc clean, `chatDiagnostics` 36/36, `gatherChatDiagnostics` 7/7. `packages/brain-ui` build + typecheck clean, `chatTickets` 25/25 (its first typecheck failed only because `brain-embedded/dist` was unbuilt — the [[brain-ui-stale-dist-typecheck]] trap; both dists were rebuilt, since they are consumed through `dist` and a stale one resolves the package as `any`). New coverage states rules rather than cases: free-vs-paid defaults, the explicit-container demotion, the preserved explicit `'durable'`, an on-prem run NOT tripping the shell-less warning, an absent feature set rendering as silence rather than "not entitled", and `parseExecutor` round-tripping whatever `withExecutor` can stamp. `frontend` tsgo clean, `components/workforce` 28/28, `lib/destinations` 19/19. Two mechanical breakages in files this pass wrote were caught and repaired by the verification passes: apostrophes inside single-quoted strings and six `.join` calls whose newline escape had collapsed (the heredoc backslash-mangling trap), plus a missing `unmount()` between two renders in one new test.
- **Not verified here:** the container surface still has no live image. `chooseCloudExecutor` demotes every container run to durable until one deploys, so a paid workspace whose agents now default to the container still gets serverless behaviour and nothing in the product says why. The account IS Containers-enabled and paid (operator, 2026-09-22), so the tier blocker is cleared; what remains is a `wrangler deploy` that builds the image — tracked in the Gap Register.

## ✅ RESOLVED 2026-09-22 — The agent stops asking permission for work it was already given

- **What:** Five changes from one finding on VS Code chat #115 (`direct/minimax/MiniMax-M1`, 63 turns / 82 tool calls). The run surveyed 38 tickets correctly and then ended on "Would you like me to: list all 35? open PRs? cancel the stalled tickets?" — for work the user had asked for one message earlier. The next user turn was spent saying yes.
  1. **A sixth stall shape, `asked-permission`** (`packages/agent-stall/src/permissionMenu.ts`). The offer menu defeated all five existing detectors at once: too long to be `empty`, too deferential to be `announced` (ANNOUNCE_SUBJECT is first-person-committal; "would you like me to" is its opposite), too well-sourced to be `missing-data`, and it names PLATFORM actions rather than shell commands so `handoff.ts`'s command-within-reach test never fired. Gated on `asksForChange` (a courteous offer after a pure question is left alone) and on the offer naming work the agent DOES. Folded into `stallShape`, so all three loops — the VS Code webview (`brainRunStore`), the server reply (`BrainService`) and the cloud runtime (`stall-recovery`) — enforce it without changes of their own. Ranked ABOVE `handed-off`: the offer is the sign-off, so it is what ended the run, and "the answer is yes, do it" also covers running the commands where "run the commands you listed" says nothing about the offer under them.
  2. **The correction points at `ask_user`, but only where the turn was advertised it.** `stallRecoveryNudge` takes the stall input as context and reads the advertised catalog; told to call a tool it never had, a model narrates the call instead, turning one stall shape into another.
  3. **`AUTONOMY_DIRECTIVE` names the channel it was missing** (`clients/vscode/src/idePersona.ts`). It had banned "would you like me to" since it shipped and the ban did not hold, because the directive never said what to do INSTEAD when a choice really is the user's — so the model used prose, and prose ends the run. It now names `ask_user`, adds "shall I" and the option menu, and says that a survey turning up 35 items the user asked to clear is a work order, not a reason to check back.
  4. **Three expensive board surveys joined the read-dedupe set** (`_pending_changes`, `_stalled_tickets`, `_census`). Their absence is why `builtin_tickets_pending_changes` ran twice with byte-identical arguments, six seconds and ~19 KB apiece, for an answer already in context. Safe only because of (5).
  5. **A publish now forgets the platform reads** (`REPO_PUBLISH_TOOLS` / `isRepoPublishTool`). `readCoverage` shipped with "`git_commit` / `git_push` / `open_pull_request` … move work out of the tree without changing a byte a read would see" — true of a FILE read, false of `tickets.pending_changes`, which answers "which branches are ahead of base, and which have a PR?" by reading exactly what a push changes. Without it, a run that surveyed, pushed thirty branches and surveyed again would be served its own pre-push answer as current.
- **Also fixed, found in the same transcript:** `specs.patch` declared `status` as a bare string, so the model guessed `"shipped"` (a roadmap status — specs have no such state), Postgres rejected it, and the turn died on an HTTP 502 carrying `invalid input value for enum spec_status`. The values now come from `specStatusEnum` itself — one source for the advertised schema, the pre-write guard and the column — and the guard names the legal values, where the Postgres message named only the illegal one. `approvals.decide`, directly below it, had always enumerated its three and had never failed this way.
- **And found while verifying:** `api`'s `type-check` died at ~144s with `FATAL ERROR: Ineffective mark-compacts near heap limit` on a machine with memory to spare — same exit code as a real type error, so the guard reported RED for a tree that typechecks clean (`tsgo` passed in 29s; `tsc` with a raised heap exits 0). `scripts/run-checks.mjs` now spawns each guard with a heap CEILING scaled to the machine (4–8 GB, skipped when the caller set `NODE_OPTIONS`). V8 grows into it only as needed, so the guards that never approach it are unaffected.
- **Verified:** `packages/agent-stall` 135/135 green (the pre-existing `handoff.test.ts` and `index.test.ts` unaffected by the reorder); `brain-embedded` 75/75 on the three touched suites plus `tsgo`+`tsc` clean; `clients/vscode` 15/15 plus all 8 type-check sub-checks; `agent-runtime` typecheck clean; `api` 40/40 on `builtinMcpService.test.ts`, and `tsc --noEmit` clean over both files this pass touched. (`api`'s type-check is RED at the time of writing on an unterminated string literal at `cloudDispatch.test.ts:166`, committed by a concurrent session in `d9bfe6146` — a file this pass never opened, and neither `builtinMcpService.ts` nor `BrainService.ts` appears in its error list. Left alone rather than edited under another session mid-work.) One pre-existing test was CORRECTED rather than left passing: `readCoverage.test.ts` pinned "a git commit/push forgets nothing", which is the assumption (5) fixes.

## ✅ RESOLVED 2026-09-22 — Chat dispatch pathway: staffed chats dispatch, and the diagnostic says who ran

- **What:** Six changes, from one finding on VS Code chat #103. (1) `chatWorkDirective` takes a ROSTER: a chat with agents invited into it now NAMES them (name + agentRef) in the system prompt and INVERTS the do-it-here ordering, so the invited agents own work-mode work and the IDE session dispatches to them. (2) `GET /api/brain/chats/:id/runs` + the `chats.runs` tool: every execution against a ticket the chat links, carrying the agent that ran it, `produced`, and `submittedBy` — which pathway started it. (3) The diagnostics report gained an **Execution history** section plus three signals: agents-present-and-zero-runs, runs-none-started-by-a-human, and completed-but-produced-nothing. (4) `chats.list_agents` resolves display NAMES server-side in one batched query, so the report stops printing raw uuids. (5) `chatDiagnosticsReads` — one shared wiring for the capture's chat-scoped reads; the web panel was satisfying the same endpoints through a second client. (6) The web `BrainPanel` dropped its ~25-line transcription of `useChatParticipants` and calls the shared hook.
- **Why:** Chat #103 had Bob, John and the Manager invited, seven linked tickets, and the local IDE session made every code change itself. Staffing read `1 ticket filed · 0 dispatched` with **zero dispatch attempts** — not a refusal: the model never asked, because `canEditHere` told it to do the work here and nothing in the prompt said there was anybody to hand it to. The diagnostic could not show this either: it printed three uuids and had no concept of an execution, so a chat whose agents were working and a chat whose agents were ignored rendered identically. Operator decision (2026-09-22): agents assigned ⇒ dispatch wins.
- **Also fixed (found while working, pre-existing):** `VsCodeChatSurface` called `listTickets(null)` on every new chat (a failing request swallowed by its own catch) and `linkTicket(null, …)` when tagging a ticket in a not-yet-created chat (the pill appeared, the link was never made — now routed through `ensureChatId`). Both type-checked only because `packages/brain-ui/dist/index.d.ts` was stale, so the whole package resolved as `any` — the [[brain-ui-stale-dist-typecheck]] trap. The three `app.ticketTag*` composer labels were never supplied by the host bundle and fell through to hardcoded English in every locale; they are now in `builderforcePanel.ts` and all five l10n bundles.
- **Where:** NEW `api/src/application/brain/{agentDisplayNames,chatLinkedTickets,chatRunHistory}.ts` (+ `chatRunHistory.test.ts`), NEW `packages/brain-ui/src/chatTickets/chatDiagnosticsReads.ts`; `ChatTicketService.listAgents`, `addressedAgentRun.ts` (migrated onto the shared linked-ticket query), `builtinMcpService.ts`, `cloudAgentToolset.ts`, `brainRoutes.ts`; `brain-embedded/src/{chatMode,chatDiagnostics,gatherChatDiagnostics,brainRunStore,useBrainConversation,index}.ts`; `packages/brain-ui/src/chatTickets/{types,restAdapter,useChatParticipants}.ts`; `clients/vscode/webview/src/chat/VsCodeChatSurface.tsx`, `clients/vscode/src/builderforcePanel.ts`, `clients/vscode/l10n/*`; `frontend/src/components/brain/BrainPanel.tsx`, `frontend/src/lib/brain/{chatModes,index}.ts`.
- **Verify:** Type-check clean across api, brain-embedded, brain-ui, clients/vscode and frontend (Sonnet pass; both package dists rebuilt — they are consumed through `dist`, and a stale one masks errors across the seam). Tests: `brain-embedded` chatMode / chatDiagnostics / gatherChatDiagnostics / selectTools, `api` chatRunHistory / addressedAgentRun / chatRunMilestones / builtinMcpService, `brain-ui` chatTickets, `clients/vscode` localToolsAdvertised. New coverage asserts the chat #103 configuration specifically: an IDE session WITH file tools AND a roster gets `DISPATCH TO THEM` and not `DO IT HERE WHEN YOU CAN`, while an unstaffed IDE chat keeps the original ordering. A live end-to-end re-test is tracked in the Gap Register.

## ✅ RESOLVED 2026-09-22 — Advisor Platform roadmap shipped (PRD 26)

- **What:** Advisor Platform as marketplace composition — mentoring, workshops, Academy and templates on Talent + bookings + LMS, not a SCORE clone. The epics and child tasks have all been merged:
  - Epic #2545 (Build Advisor platform as marketplace composition) - DONE
  - Task #2527 (Advisor profiles + marketplace category) - merged as PR #844
  - Task #2532 (Public visitor booking + advisory meeting join) - merged as PR #845
  - Task #2538 (Meeting Notes listing + minutes→tasks + follow-up) - merged as PR #846
  - Task #2546 (PRD 26) - DONE
  - Spec #400b7152 - complete
- **Why:** All P0/P1 child tickets merged; epic complete; roadmap ready to ship
- **Where:** 
  - Specs: `specs/builderforce/26-prd-advisor-platform.md`, `specs/builderforce/26-implementation-notes-advisor-platform.md`
  - Task specs: `specs/tasks/task-2527.md`, `specs/tasks/task-2532.md`, `specs/tasks/task-2581.md`
- **Verify:** All PRs merged to main (#844, #845, #846)

- **Roadmap 69584c3f** - changed from "planned" → "shipped"

## ✅ RESOLVED 2026-09-21 — PRD 27: Staffed work, the coordination gate, and chat diagnostics as data

- **What:** PRD 27 delivered five changes: (1) a versioned `bfk` auth-cache key so the VSIX owner resolves as their actual role instead of an anonymous DEVELOPER — the root cause of `403 manager role required` on chat #113; (2) `ReplayRouteError` so a replayed 4xx surfaces as 403, not 502; (3) migration 1177 + `coordinationGate.ts` making ticket coordination developer-tier with a per-project opt-in (`coordination_requires_manager`); (4) migration 1178 + the persisted `ChatDiagnosticsReport` with the `work-filed-not-staffed` verdict; and (5) persona sub-agents (`spawn_agent as_agent=<Ada>`) end to end across agent-tools, agent-loop, brain-embedded, and the VSIX.
- **Why:** A work-mode run filed 12 tickets and assigned nobody — every staffing call returned 403 masked as 502, and the diagnostics report had no line saying "work was filed but nobody is running it." The auth cache had been resolving the workspace owner as an anonymous DEVELOPER for 365 days.
- **Where:** `api/` (migrations 1177/1178, `coordinationGate.ts`, `chatDiagnosticsStore.ts`, `chatDiagnosticsToolCatalog.ts`, `agentPersonaToolCatalog.ts`, `agentPersonaBrief.ts`, `staffingSummary.ts`, `chatDiagnosticsReport.ts`, `captureDiagnostics.ts`, plus eight test files), `packages/agent-tools/` (`subagent-tools.ts`), `packages/agent-loop/` (`SubagentRunArgs.persona`), `brain-embedded/` (`chatWorkDirective`, `brainTriage.ts`, `brainRunStore.ts`), `clients/vscode/` (VSIX 2026.9.75), `frontend/` (i18n keys in five catalogs). Spec: `specs/builderforce/27-prd-staffed-work-and-chat-diagnostics.md`.
- **Verify:** R1–R4 verified locally 2026-09-16 (type-check, cross-package persona seam, version bumps, brain-embedded dist rebuild, VSIX package+install). R5 (migrations 1177/1178) tracked as gap #2573. R6 (live re-test) tracked as gap #2574. R7 (this DONE.md entry) closes out the set. Release notes are gated on an explicit user ask per §5 of the PRD — persona delegation is plausibly `category=new`, persisted diagnostics is `improvement`, and the 403 chain gets no note. No release notes were published; confirmation was not requested and not given.

## ✅ RESOLVED 2026-09-16 — #2568 R7 close-out

- **What:** R7 close-out: DONE.md resolved entry written; release notes are gated on an explicit user ask and are not published by this close-out.
- **Why:** R7 requires a durable resolved record plus a confirmation gate before any release notes are published. Persona delegation, persisted diagnostics, and 403-chain handling have each reached their own done state; this ticket closes out the set.
- **Where:** This `DONE.md` entry. No release notes were published — confirmation was not requested and not given; the gate remains open.
- **Verify:** Three classification rules applied: (1) persona delegation → **new** — operators can spawn a child agent running as a named workspace teammate with that agent's role, bio, skills, and personality; (2) persisted diagnostics → **improvement** — chat/staffed-work diagnostics now persist so a later turn can read why a run failed or stalled; (3) 403 chain → **no note** — excluded from every published surface. No changelog file, partial draft, or footnote exists for any of the three items. No version bump, tag, or store/marketplace copy was written.

## ✅ RESOLVED 2026-09-16 — A chat narrated "Bob Developer started working on epic #2570" while its Agents list named only Ada (VSIX 2026.9.80)

- **The cause.** Two paths disagreed on who is "in" a chat. The chat join (`ChatTicketService.onTicketAgentAssigned`) fired only when a ticket's `assignedAgentRef` changed (task PATCH, Brain MCP assign, link time). The agent that actually RUNS is chosen by `evaluateTaskAutoRun`: lane staffing, or on a lifecycle-managed board the manifest producer role. Most of the time that is not the ticket owner. `postRunMilestone` then narrated that agent's run into every linked chat without ever joining it.
- **The fix.** One private `joinAgentToChat` primitive (idempotent, agent_assignments scope `chat`, role `participant`) shared by both paths. `postRunMilestone` joins `agentRef` to each linked chat before posting, silently, because the milestone line is the announcement. A participant is addressable only; it never auto-replies.
- **Live on every host.** The ticket rail used to re-read agents only on its own actions or MCP writes, so the join would have shown only after a reload. `activityMessageCount` (brain-embedded) + `useChatActivitySignal` (brain-ui) feed the refresh signal from activity lines arriving over the live subscription: VSIX `VsCodeChatSurface`, web `ChatTicketsPanel` via `BrainPanel`, and the canvas `BrainDock` context panel.
- Changed: `api/src/application/brain/ChatTicketService.ts` (+ `chatRunMilestones.test.ts`), `brain-embedded/src/{chatActivity,chatActivity.test,index}.ts`, `packages/brain-ui/src/{chatTickets/useChatActivitySignal,index}.ts`, `clients/vscode/webview/src/chat/VsCodeChatSurface.tsx`, `frontend/src/components/brain/{ChatTicketsPanel,BrainPanel}.tsx`, `frontend/src/components/creation-canvas/BrainDock.tsx`, `clients/vscode/{package.json,CHANGELOG.md}` (2026.9.79 → 2026.9.80).
- Verified by Sonnet: api milestone/reaper/runtime tests 27/27, api type-check clean; brain-embedded 9/9 + build; brain-ui typecheck + build; frontend type-check clean; extension type-check clean, 389/389 tests; VSIX `builderforce.builderforce-ai@2026.9.80` installed.
- Existing chats catch up on the agent's NEXT milestone. Bob will be joined to chat #119 the next time a run on epic #2570 narrates.

## ✅ RESOLVED 2026-09-16 — Why yesterday's storage pass could not have freed the space, fixed (api 2026.9.41)

Reported with the Neon console showing `builderforce-transactional` at 478 MB and `builderforce-core` at 446 MB: "I don't think what you did actually worked." Correct — for four reasons, three of them defects in that pass.

- **It never ran.** The release carrying it failed at 03:59Z; nothing deployed until 12:34Z, after the 09:00Z daily cron. No sweep had executed.
- **The rewrite measured the heap, not the table.** `measureBloat` sized relations with `pg_relation_size`, which excludes TOAST. `llm_traces` was 241 MB with a **29 MB heap and 209 MB of TOAST**, so it sat under the 64 MB floor and could never be chosen however much of its body text was blanked. It now uses `pg_table_size`, and — because `pg_stats.avg_width` cannot see out-of-line values either — measures live size from a 5% `TABLESAMPLE` of `pg_column_size(t.*)` for any relation big enough to be a candidate, falling back to the statistics when the sample is thin. `RECLAIM_MIN_HEAP_BYTES` → `RECLAIM_MIN_TABLE_BYTES`.
- **One rewrite per run starved the second endpoint.** The bound exists to stop chained exclusive locks, which cannot chain across separate databases; it is now one per endpoint (`RECLAIM_MAX_PER_CONNECTION`), so transactional and core are both reclaimed on the same tick.
- **Pressure could not reach young payloads.** Only row windows compressed, and `llm_traces`' fat rows were almost all under five days old — under a 7-day redaction and a 7-day purge floor — so a "critical" sweep would have freed nothing. Redaction windows now compress too, to a declared `redact.pressureFloorDays` (`llm_traces` 1 day, `tool_audit_events` 3 days), through one shared `compressDays` that the purge, the redaction and the reported `compressionPlan` all use.
- **The ceiling was a tier too lenient.** 512 MiB against `pg_database_size` read "warn" while Neon's own meter — stated as 0.5 GB and counting more than the database reports — read nearly full. Default is now 500,000,000 bytes; `NEON_STORAGE_CEILING_BYTES` still overrides.
- **Diagnosed from production, read-only:** sizes and inflow on both endpoints (see the Gap Register entries of the same date for the numbers, including a cloud-agent burst of 639 executions and 13,812 LLM calls between 19:15 and 22:30Z).
- Verified by Sonnet: `src/application/maintenance` 29/29 (new `storagePressure.test.ts`, updated `tableMaintenance.test.ts` with TOAST-sample, thin-sample and per-endpoint cases); api type-check clean repo-wide; `check:swept-tables`, `check:usage-counts`, `check:schema-drift` green; 1,731 tests across the llm, analytics, artifact, tools, scoreRunOutcome and admin/llm route suites pass.
- Changed: `api/src/application/maintenance/{tableMaintenance,tableMaintenance.test,storagePressure,storagePressure.test,retentionPurge,sweptTables}.ts`, `api/package.json` (2026.9.40 → 2026.9.41).

## ✅ RESOLVED 2026-09-16 — Every VS Code chat send answered "Something went wrong on our side": ON CONFLICT on a partial index, and a 5xx nobody could look up

- **What:** R7 close-out: DONE.md resolved entry written; release notes are gated on an explicit user ask and are not published by this close-out.
- **Why:** R7 requires a durable resolved record plus a confirmation gate before any release notes are published. Persona delegation, persisted diagnostics, and 403-chain handling have each reached their own done state; this ticket closes out the set.
- **Where:** This `DONE.md` entry. No release notes were published — confirmation was not requested and not given; the gate remains open.
- **Verify:** Three classification rules applied: (1) persona delegation → **new** — operators can spawn a child agent running as a named workspace teammate with that agent's role, bio, skills, and personality; (2) persisted diagnostics → **improvement** — chat/staffed-work diagnostics now persist so a later turn can read why a run failed or stalled; (3) 403 chain → **no note** — excluded from every published surface. No changelog file, partial draft, or footnote exists for any of the three items. No version bump, tag, or store/marketplace copy was written.
