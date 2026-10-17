## ✅ RESOLVED 2026-10-17 — Canvas Brain recovers from a provider that fails mid-answer (frontend 2026.10.53)

- **Gap:** a canvas turn whose provider broke AFTER the gateway committed to it (in-band error frame — measured: "Upstream error from Nvidia: Service temporarily overloaded" on `nvidia/nemotron-3-ultra-550b-a55b:free`, ui 2026.10.52) rethrew `StreamInterruptedError`, so the raw vendor sentence became the whole reply — even though the turn had already put its architecture diagram on the board. Only stalls and repetition loops were routed around.
- **Fix:** `frontend/src/lib/creationCanvasAi.ts` — `StreamInterruptedError` and a reached-gateway `TransportError` now go through ONE `rerouteAfterProviderFailure` ladder shared with the stall path: hand the turn to a model that already acted in it, else the run policy excludes the broken model and asks the gateway pool again, else stop with the localized notice. The vendor text is a trace (`provider failed mid-answer`), never the answer.
- Notice `creationCanvas.notice.providerStalled` → `providerFailed` (all five catalogs, reworded to cover overload as well as silence); tail fact `stalledStreams` → `providerFailures`, unanswered detail `provider-stalled` → `provider-failed`.
- Tests: `creationCanvasAi.test.ts` › "when the model provider fails mid-answer" (continues on another model with the broken one excluded; ends on the localized notice when none is left).

## ✅ RESOLVED 2026-10-16 — In-browser engine for the web app, memory versions aligned, Rovr keeps the app's logos (frontend 2026.10.52 · api 2026.10.41 · brain-embedded 2026.10.24 · VSIX 2026.10.34 · Rovr 2026.10.3 · agent-runtime 2026.10.4 · local-inference 2026.10.17)

Operator decisions (2026-10-16): align versions; Rovr reuses the app's logos; the web app's local-first answer is an IN-BROWSER engine built on our webcontainers ("the full experience").

- **The web Brain runs real commands.** `canvas_run_build_command` (`frontend/src/lib/canvasBuildCommandAction.ts`) adapts the shared `run_command` tool from `@builderforce/agent-tools` to a BrainAction over `createWorkspaceShell` (`frontend/src/lib/browserRuntime/workspaceShell.ts`): one command at a time on the page's shared BuilderForce WebContainers runtime (`jsh -c`), the build's files mounted from its `WorkspaceFileStore`, output tail-capped, 5-min timeout → kill, and every file the command changed written back to the store (deps/build output/binary/oversize skipped and reported). A runtime that cannot boot answers `ok:false`, never throws. Canvas boards (guest-safe) and the Studio both get it; Studio pins it via `STUDIO_WORKSPACE_TOOLS`; the canvas prompt names it; `check-canvas-tool-contract` scans the new module.
- **In-browser inference, local first.** The webcontainer has no GPU (workers on the isolated preview origin, buffered responses), so model inference uses the browser's own engine: a `browser` runtime (Gemini Nano via the Prompt API) joins the `@builderforce/local-inference` registry with a new `reach: 'http' | 'page'` field, so HTTP probers and the proxy fence skip it by data. `brain-embedded/src/browserEngine.ts` probes it without ever starting a download and answers `http://browser.local/v1/chat/completions` in-page as OpenAI SSE, refusing (non-2xx, before anything streams) tool turns, over-quota prompts and an unavailable model so failover is invisible. `BrainConfig.stream` + `resolveBrainStream` are the new seam; the web Brain (tenant + guest) and canvas turns go through `createBrowserLocalFirstStream`; model comparison deliberately does not. ONE explicit-pick rule (`localFirstApplies`) now serves the VSIX and the web. Rovr adds the same page runtime to its probes. The Prompt API detection in `frontend/src/lib/model-provider.ts` now imports brain-embedded's `promptApi.ts` (one copy).
- **Build tools read real file bodies on durable workspaces.** `GET /projects/:id/files` is a path listing (content `''`), but `canvas_search_build_files` and the `canvas_list_build_files` exports map treated it as content — so on a signed-in project search found nothing and the map showed no exports. Fixed with ONE `readStoreFiles(store, include)` (`frontend/src/lib/workspace/readStoreFiles.ts`), shared by the build tools and the shell; the store contract comment now says what `list()` returns.
- **Memory versions aligned.** Every `@seanhogg/builderforce-memory{,-engine,-mcp}` floor is `^2026.9.33` (incl. `agent-runtime/extensions/memory-lancedb`, which the roadmap entry missed); the brain-embedded, clients/vscode, frontend and agent-runtime lockfiles resolve 2026.9.33 only.
- **`api` type-check is green on HEAD.** The 2026-10-16 roadmap entry (17 errors across 11 files) no longer reproduces: `npm run type-check` (tsc + tsgo) passes with 0 errors after the CI-fix commits; entry closed.
- **Rovr icons = the app's logos** (operator decision): the Web Store listing is the only remaining Rovr distribution item. The app's metadata labelled the 64×64 `icon.png` as 32×32 — corrected in `frontend/src/app/layout.tsx`.

## ✅ RESOLVED 2026-10-16 — Rovr program, phases 2–4: one hand-off policy, local-first, offline sync, Rovr for Chrome (api 2026.10.40 · frontend 2026.10.51 · VSIX 2026.10.33 · brain-embedded 2026.10.23 · brain-ui 2026.10.10 · agent-runtime 2026.10.3 · Rovr 2026.10.2)

**`@builderforce/run-policy` — one model hand-off policy for every loop.** A pure reducer (`initialRunPolicy` / `nextTurn` / `reduceRunPolicy` + `resolveStallStep`) owns phase (plan→code→verify), pin/lock/release on 429/413/503, broken-model exclusion, stall re-prompt → failover → explained stop, and the Evermind-400 decline cascade (`decliningModelPrefixes`). It now drives:
- the Brain loop (VSIX + web);
- the cloud durable loop (`cloudRunModelPolicy.ts`, state persisted on the loop; new stall recovery; `cloudAgentEngine.ts` 2827→2494 lines);
- container and Actions turns (state in the read-through cache);
- `BrainService.agentReply`;
- Canvas (`CanvasModelRouter` deleted; now sends `role` and `arcStage`);
- on-prem stall recovery.

**One loop kernel everywhere.** The container image and the GitHub Actions runner now drive `runAgentLoop` through a generated, drift-checked bundle (`api/scripts/gen-agent-loop-bundle.mjs` → `container/agentLoop.mjs` + `generated/agentLoopSource.ts`, `check:agent-loop`). `agentImageLoop.mjs` maps steering, pause, compaction and cancel onto `LoopHooks`. There is no step cap; the failure-streak breaker is the limit. On-prem relay tasks keep the Claude Agent SDK loop by design; their model choice goes through the router.

**Routing parity.**
- `pickCloudModel` orders cost-first roles by expected cost.
- Learned role stats now re-rank the plan pool too, so tenants with no connected account get them.
- The gateway fetches role stats regardless of BYO.

**On-prem joined the shared vocabulary.**
- `model-catalog-view.ts` binds the CatalogView port. Prices are converted per-million → per-token, and a placeholder zero price on a cloud model is "unknown", not free.
- `candidate-ranking.ts` routes through the router, and `AGENT_ROLE_MODEL_ROLES` maps orchestrator roles onto `ModelRole`.
- 2025 model pins are removed, and Claude ids derive from `anthropic-models.ts`.
- Bug fixes found along the way: un-awaited credential writes in several auth commands, and a role with no model wiping the agent's model.

**One BYO provider list.** `@builderforce/model-catalog` `providers.ts` is the single source for api + frontend. FreeToken is now configurable from the web: one self-hosted-runtime form for every `local_runtime` provider, and `selfHostedCredential.ts` is shared by the save route and the vendor.

**Local-first inference.**
- `@builderforce/local-inference` holds the runtime registry (Synapse/bfi, Ollama, FreeToken), probing with capabilities, the local CatalogView, `localFirstPlan` and `runLocalFirst`.
- brain-embedded `createLocalFirstStream` / `localTransport` serve VSIX and Rovr from one implementation.
- When local is enabled and nothing is pinned, a turn tries a capable on-device model first. It fails over to the cloud pool only before any output has streamed.
- Fallbacks are recorded as an `llm.local_fallback` step.

**Work offline, then sync.**
- `@builderforce/write-outbox` gained a durable mode with:
  - store ports (memory, IndexedDB, VS Code);
  - sealed idempotent batches with retry and backoff;
  - an online signal;
  - a size cap that drops oldest entries and counts them;
  - a tenant `scope` that parks entries instead of replaying them under another tenant.
- An api `Idempotency-Key` middleware (24h, read-through cache) protects:
  - activity ingest;
  - client error reports;
  - chat↔ticket links;
  - `POST /api/tasks` and `POST /api/brain/chats`.
  
  `/v1/chat/completions` shares the same key grammar and store.
- VSIX activity, error reports, run outcomes and unsaved turns go through durable outboxes. Brain step rows survive a restart and replay on startup or reconnect without a new run, in VSIX and on the web.

**Rovr for Chrome (new).** `clients/chrome` is an MV3 side-panel assistant on the same brain-embedded loop:
- device-code sign-in;
- local-first inference;
- browser tools over a ref-addressed page agent, with page content fenced as untrusted data;
- an action ledger synced as chat steps;
- user playbooks ("when I say X, do Y on site Z");
- a safety gate: confirm before submit/purchase/send/delete or sensitive fields, plus a per-site allow list;
- an offline IndexedDB outbox;
- tasks linked to the chat;
- errors on the shared client-report path (`chrome-extension` source);
- five locales, light and dark themes, works down to about 300px.

Ships with release-note migration `1225_release_note_rovr_browser_assistant.sql` and the blog post `rovr-your-assistant-in-the-browser` in five locales.

**DRY cleanups across hosts:**
- `transcriptSeedFrom` (brain-embedded) is shared by web and Rovr.
- One `brain.timeline` label mapper lives in brain-ui, used by web, VSIX and Rovr.
- The IndexedDB step-durability installer is shared by web and Rovr.
- `replayPacks.ts` no longer uses an empty catch.

**Closed ROADMAP entries:**
- Workload-aware routing:
  - Learned role stats only for BYO
  - Hand-off policy only in brain-embedded
  - Two loops outside the kernel
  - Second model universe on-prem
  - Provider lists restated in the frontend
  - Local-first opt-in only (VSIX)
  - No offline sync
  - No Chrome extension client
- "Overlapping router in builderforce-memory": closed as not a defect. Builderforce.ai never imports `InferenceRouter`, so it is the memory package's own SSM-vs-LLM gate.
- Cloud runs: "Container/Actions cap at `CONTAINER_MAX_STEPS`" (code done; legacy constant stays until the rebuilt image is deployed).

## ✅ RESOLVED 2026-10-16 — Main release unblocked after the Insights merge (frontend 2026.10.50 · api 2026.10.39 · replay-sdk 2026.10.3)

From 2026-10-14 every main release failed in verify, so nothing deployed. The cause was the Insights merge, which was never compiled, landing beside other sessions' commits. Each failure was fixed at its cause:

- **Insights gate.** The proof-site read (`application/replay/proofSiteRead.ts`) is its own port now. The gated route tests mock it, so a missing Insights install answers 403 again instead of 500.
- **Tests that were wrong.** The VERIFIERS registry now covers the three page-fix actions. The prior-grade "lower effort" pick is `demo-video`, the closest cheaper form, not `clickable-prototype`. The page prompt test passes the explicit `ids`. `replay_funnel_steps` orders by `ord`.
- **Type errors.** The `replay_recordings` usage-meter tile was missing. The guest erase now returns the eraser total once instead of a duplicate `erased`. The replay-sdk controller spies are typed. Errors from other commits were fixed as well: managed-host tests, the persona brief, `resolveTenantTask`, the YouTube API base, and the ceremony test spreads.
- **Guards.**
  - Calendar migration `1216` was renumbered to `1218`, because it collided with `1216_replay_core`.
  - The superadmin managed-host queue moved into the application layer as a declared `acrossTenants('platform_admin')` read.
  - `replay_visit_summaries` now shows the tenant scope it inherits.
  - Two empty catches became explicit helpers.
  - The Insights components name type roles instead of literal font sizes (ratchet lowered to 3357).
  - The replay manifest reads through `apiRequest`.
  - `ReplayLoader` and the installed-apps rail are loaded with `dynamic()`, and the founder journey imports the realization client inside its effect.
  - The three remaining tiny first-paint modules are argued in `check-root-closure`.
  - The set-state-in-effect sites are now derived state.
  - The live-orchestration page uses `Link`.
  - A block comment in `scripts/test-brain.mjs` was closing on a glob and broke lint.
- **Carried as debt, logged.** `calendar_connections` now has the same shape as the drive and mailbox stores. That cluster is in the ROADMAP ratchet entry.
## ✅ RESOLVED 2026-10-16 — Workload-aware routing, phase 1: `model-catalog` · `workload` · `model-router` (Rovr program)

**Why.** The router picked models without reading the work or its price. Price lived only in the `/models` browser and was read *after* the call, and the plan/code/explore role reordered only a tenant's own connected accounts. The cloud and on-prem hosts each classified work their own way.

**Three pure, source-only packages**, shared by the Worker, the editor and on-prem:
- **`@builderforce/model-catalog`**: the tier ladder (`ModelTier`, `tierRank`), per-token `ModelPrice` with `estimateCostUsd`, residency (`local` | `cloud`), and the `CatalogView` port each host binds to its own registry. `AiModelTier` is now an alias of `ModelTier`.
- **`@builderforce/workload`**: `profileWorkload` reads one `WorkloadProfile` (role, arc stage, action type, estimated input/output tokens, agentic). It now holds the lexical action classifier, moved from `agent-runtime`, the `ArcStage` vocabulary, moved from the api, and the one chars-per-token heuristic. The api's `tokenUsage`, `spawnBuild` and three on-prem context guards now use it.
- **`@builderforce/model-router`**: role objectives, `orderForRole` (with price as the within-tier key for cost-first roles), `rankConnectedForRole`, `expectedCostUsd`, `orderByExpectedCost` and `orderPoolForWorkload`. The copies in `modelPool.ts` and `modelRoles.ts` were deleted. `modelRoles.ts` now only binds the router to the registry.

**Behaviour:**
- **Cost-first calls (explore / utility / verify) order the Free/Paid plan pool by expected cost** (price × estimated tokens; local and FREE models at zero).
  - Cost ordering runs *before* the stable capability reorders (shape, coding drivers, context fit), so it only orders models *within* a capability bucket. A cheap model never jumps ahead of a capable one.
  - Connected-account seeds order by price within a tier too.
- **Only cost-first calls read prices.** `catalogView.ts` (`pricesForCall`, `loadPriceBook`) builds the price book once per cached catalog snapshot, and every other call skips the catalog read.
- **The usage ledger reads the same price book**, replacing a per-row linear scan, so expected cost and recorded cost come from one lookup with one id normalization.
- **The cloud ticket classifier is lexical-first.** A confident lexical label returns with no model call; the free pool is asked only when a ticket is ambiguous.

**Verified:**
- `check:source-package-graph` passes.
- 191 targeted api tests pass, including the new `catalogView.test.ts` and the three packages' own tests.
- `agent-runtime` `tsc --noEmit` passes, and so do its learned-routing and context-guard tests.

**Closed ROADMAP entries** (Workload-aware routing):
- "No price on the routing catalog"
- "No workload anticipation"
- "Role only reorders the BYO seed"

## ✅ RESOLVED 2026-10-16 — BuilderForce WebContainers used throughout; StackBlitz residue gone; agent build gate wired

**Audit.** `@webcontainer/api` was already out of every package. What remained was StackBlitz-era residue, and one place our own runtime should have been used and was not.

**Our runtime, used where it was missing:**
- **Browser coding dispatch build gate.** `CodingDeps.build` existed, but `createCodingDeps` never supplied it, so a browser agent pushed code nobody had built. It is now `runBuildGate` (`lib/browserRuntime/buildGate.ts`). The gate reads the cloned working tree (`workingTree.ts`, text plus binary assets), then type-checks and builds it on BuilderForce WebContainers through the same `runProjectChecks` the workspace Check runs. Type errors count only in files the agent wrote, plus global errors when it edited a tsconfig. A project the runtime cannot build (Next.js, a Node server) or a tree too large for a tab is **skipped**: it pushes as before, with `buildOk` unknown. It is never failed.
- **Workspace Check no longer fails the build step for Next.js and similar projects.** `CheckPorts.build` takes `{ skip }`, and `buildCheckPort` asks the runtime's `detectProject` first, so the runtime's own decline reason shows as a skip.

**Residue removed:**
- CSP `frame-src` dropped `*.webcontainer-api.io` / `*.staticblitz.com`.
- `_headers` no longer blames the runtime for COOP/COEP. Isolation is for the onnxruntime-web WASM threads only.
- The dead `/webcontainer` route was removed from the middleware root segments and from robots.
- About 30 source comments now name the in-browser runtime.
- The README, the in-browser IDE blog post and its SVG were corrected. They had claimed WASM Node, native modules, Next.js templates and Chrome-only.

**Preview "Open in a new tab".** Both toolbars now go through ONE `openPreviewInTab`, which is always `noopener,noreferrer`. `PreviewPane` had handed the AI-written preview a `window.opener` onto the builder tab.

**Open source, shown and shared (frontend 2026.10.49):**
- **Pages.** `/open-source` and `/open-source/<slug>` cover four packages: webcontainers, memory, inference and spawn. They read from ONE registry, `lib/openSourcePackages.ts`, with copy in `openSource.*` in all five locales. Each page has a comparison table (WebContainers vs StackBlitz, taken from the README), a quick start, how Builderforce uses the package, and its limits. The pages are in the sitemap, the footer and Learn ▸ Build with.
- **Blog posts.** Two new posts in all five languages: `builderforce-webcontainers-open-source` and `open-source-at-builderforce`. Each sibling README now has a "Part of Builderforce open source" line.
- **Blog topics.** Two existing posts sat in the "more" bucket with no topic. They now map through `campaigns` → business and `games` → canvas.

**Closed ROADMAP entry:** Repo-backed Designer — "WebContainer new-tab preview loses `window.opener` under COOP". That was `@webcontainer/api`'s opener handshake. Our preview has no handshake. The tab is served by the preview origin's service worker, which is same-site with the app and so uses the same registration, through the relay the builder tab already holds.

## ✅ RESOLVED 2026-10-13 — Insights (PRD 33): session replay, heatmaps, live visitors and prescriptive fixes, built end to end (frontend 2026.10.48 · api 2026.10.38 · replay-sdk 2026.10.2)

**Spec.** PRD 33 and its hand-off 33a were consolidated into one spec. 33a is deleted, and superseded text was removed rather than left beside its replacement. The spec carries a true per-slice status and D18: storage that works with zero extra provisioning, using additive route × day rollups, one compact row per kept recording, and R2 chunks.

**What a workspace can now do:**
- **Install and set up.** Install Insights from the Marketplace for free (listing landing, sign-up that keeps the install intent, `/apps/insights` with a set-up flow). Add an external site with a scope-locked `bfr_` key and paste one snippet, or switch recording on for a hosted app (the loader is injected).
- **Record.** Visits are recorded with masking, blocking, DNT/GPC and consent. Recordings are kept by sample or by trigger. Sessions, frustration, heat and vitals are counted exactly over every session.
- **One screen.** Everything lives on ONE Insights screen with ONE stacked panel, addressable by `?panel=`: KPIs, issues, page stage lenses (heat, stuck, live, fixes), the funnel band, Do next and the score-by-release strip.
- **Analyse.** Replay a recording with markers, cited AI summaries and a ticket from the moment. Heatmaps support release compare and Areas, and recordings export as MP4. One filter with segments covers the overview, smart events, funnels and flow. Brain `replay.*` tools and a `replay:read` API are available.
- **Fix.** Get ranked prescriptions, deterministic and impact-ranged:
  - Fix it produces a preview release that a person publishes.
  - Test it runs an A/B split served by the sites Worker.
  - Follow up enrols a sequence, after a preview.
  - Ticket.
  - Each fix ends in a measured worked / no effect / worse verdict, with a revert.
- **Page review.** Each key page is reviewed per release: captures, SEO/content/performance/accessibility rules, anchored vision findings, validated before/after renders, and improvement prompts for the composer, a coding agent or a site builder.
- **Prove.** A smoke test is graded from what visitors did: the sample guard, a measured verdict with evidence, read-again with `priorGrade`, and journey make/measure.
- **Buy.** Prepaid packs on the ledger, with an emailed top-up link. Superadmins get an Insights operations panel with aggregates, credit grants and per-workspace settings, and never see recordings (D17, enforced under emulation as well).

**Also closed in this pass.** Apply in composer puts one removable element chip per targeted element into the ONE composer: the preview pick seam now holds many picks, anchored to a source location or a selector. Follow up can draft a new sequence from the cited objection; it is created as a draft cadence and starts only when a person starts it. The architecture review's findings (one blocker, four majors, twelve minors) were all fixed, each with a test.

**Closed ROADMAP entries:**
- Insights not on the Marketplace.
- A signed-out buyer loses their place (`resumeIntent`).
- Installed apps have no home (`/apps/[slug]`).
- A listing can't carry a landing (`LISTING_LANDINGS`).
- `useFounderJourney` only knows idea and run (journey signal).
- A smoke test's kill condition is called without its sample (`ProofMeasure`).
- The `experiment` gap is narrowed to the canvas binding.

**Security fixed along the way:**
- A public site key could be exchanged for a member session, or used to revoke itself. Both are now refused.
- Superadmin emulation could read recordings; it is now refused across every replay router.
- The pack checkout `returnUrl` is now restricted to the app origin.

**Not compiled or run (operator instruction).** Tests were written alongside the code, so CI on merge is the first run. The §11 live runbook needs the operator; it is logged on the ROADMAP with its blockers.

---
## ✅ RESOLVED 2026-10-14 — `tasks.get` resolves a `#<n>:` titled ticket after a numeric 404 (ticket #4507)

When `builtin_tasks_get` 404s on the numeric id, `resolveTenantTask` lists the tenant's tickets (including archived) and returns the unique title that starts with `#<n>:` or `#<n> `. Superstrings (`#23460:`) do not match. Several matches, or a unique match that cannot be loaded, 404 naming the board ids so the caller can retry.

- **Module.** `api/src/application/llm/resolveTenantTask.ts` (kept out of `builtinToolContext` so MCP tests keep their mocks). `tasks.get` in `builtinMcpService.ts` calls it.
- **Tests.** `resolveTenantTask.test.ts` (8 passed).
- **Commits.** `4cf08e9e4`, `0dcf7da59` on `main`.

## ✅ RESOLVED 2026-10-14 — `persona_brief` matches names without the runtime suffix (ticket #4506)

`builtin_cloud_agents_persona_brief` now matches `"Bob Developer"` to `"Bob Developer (V2 (Container))"`. Case-insensitive; trailing parenthetical runtime suffix stripped. Exact id still wins. Two teammates with the same stripped name is a miss (no fuzzy/prefix). Cache key `agent_persona:resolve:v3:…`.

- **Resolver.** `api/src/application/agent/agentPersonaBrief.ts` (`stripAgentRuntimeSuffix`, `pickResolvedAgentRow`).
- **Tests.** `agentPersonaBrief.test.ts`.
- **Commit.** `98483a668` on `main`.

## ✅ RESOLVED 2026-10-14 — Git tools infer `repo` at a multi-checkout workspace root (ticket #4505)

`git_status` / `git_diff` with no `repo` no longer die with "not a git repository at the workspace root" when the open folder contains checkouts. `runGitTool` infers `repo` from a path's first segment and retries scoped. If still not a repo, the error names candidate checkouts and never mentions `list_files`. Explicit `repo` still wins.

- **Fix.** `packages/agent-tools/src/git-tools.ts`.
- **Tests.** `git-repo-scope.test.ts`.
- **Commit.** `604aec17c` on `main`.

## ✅ RESOLVED 2026-10-14 — Academic integrity ledger writes on canvas edits (ticket #4508)

`edits.patch` → `updateNodeData` now appends derived `IntegrityRow`s via `patchWithIntegrity`. Brain/agent turns stamp `assistant`; learner edits stamp `learner`. Proposal apply does not go through `updateNodeData`, so it is not double-counted. Marker read joins named artifact-object ledgers. Chrome fields (title/status/mark/provenance/integrity) are skipped. Unchanged ledgers are not rewritten.

- **Writer.** `frontend/src/lib/academic/integrity.ts`; call sites `useCanvasBoardModel.updateNodeData`, `CanvasProposalStage.updateObject`.
- **Tests.** `academic.test.ts`, `assessmentReading.test.ts`, `CanvasProposalStage.test.ts` (86 passed).
- **Commit.** `308815b9e` on `main`.

## ✅ RESOLVED 2026-10-14 — Canvas artifact export records on the outcome ledger (ticket #3627)

`useCanvasArtifactExport` records started + succeeded|failed via `recordCanvasActOutcomes` (`artifact.export` is the `{kind}.{action}` fallback, not a fourth `DELIVERY_ACTION`). Copy, policy refusals, and thrown errors do not record. Only when `persistence === 'server'` and `sessionId` is set.

- **Hook.** `frontend/src/components/creation-canvas/hooks/useCanvasArtifactExport.ts`; `CreationCanvas.tsx` passes persistence + sessionId.
- **Tests.** `useCanvasArtifactExport.test.ts` (11 passed).
- **Commit.** `ac508fcc7` on `main`.

## ✅ RESOLVED 2026-10-13 — `tasks.create` no longer inserts a dangling `assigned_user_id` (ticket #2650)

Default coordinator for `tasks.create` with no assignee: project Delivery Manager → requesting human only if that id is a `users` row → else NULL. A ghost `u:` manager is treated as no manager instead of violating `tasks_assigned_user_id_fkey`. Cloud-agent (`c:`) managers still pass through.

- **Resolver.** `api/src/application/task/resolveCreateTaskAssignee.ts`, wired from `builtinMcpService.ts`.
- **Tests.** `resolveCreateTaskAssignee.test.ts` (9 passed).
- **Commit.** `1c4ab3691` on `main`.

## ✅ RESOLVED 2026-10-13 — Multi-model role routing (ticket #3073)

`resolveModelForRole` / `parseRoleModelConfig` in `@builderforce/learned-routing` (`9f514a949`) now pin a catalog model from `ROLE_MODELS` / `ROLE_MODEL_DEFAULT` on both remaining surfaces. Explicit user/run model still wins; undefined pin leaves the ranker/plan seed unchanged.

- **Cloud.** `api/src/application/runtime/cloudAgent/routing.ts` + `cloudAgentEngine.ts` (`c34d5084b`). Tests: `routing.roleModels.test.ts`.
- **VS Code.** `clients/vscode/src/roleModelPin.ts` over `process.env`; `modelState.resolveEffectiveModelChoice` after explicit pick and Evermind; child runs pin by `req.role` (`9689f3699`). Tests: `roleModelPin.test.ts`.

## ✅ RESOLVED 2026-10-13 — Remote task result streaming (ticket #3071)

Live `remote.task.chunk` events plus terminal assistant text. Ticket closed; ROADMAP row moved to Shipped.

## ✅ RESOLVED 2026-10-13 — Rendered presentation export of the value brief (ticket #3079)

`renderRfpDocPptx` emits the RFP/value-brief as PPTX from the same `rfpDocSections` as HTML/PDF (`rfpBranding.ts`, `rfpRoutes.ts`). Canvas artifact PPTX (`useCanvasArtifactExport`) and investor pack PPTX (`PackView`) share the office writer. Tests: `rfpBranding.test.ts`.

## ✅ RESOLVED 2026-10-13 — Live orchestration workspace (real-time DAG) (ticket #3688, epic #3066)

Dedicated `/orchestration` Run-stage workspace lists in-flight workflows and paints the live DAG as the main surface (not a run-history drill-down). Authoring stays on Creation Canvas.

- **Route.** `src/app/orchestration/page.tsx` — edge + `pageMetadata` (incidents-style, no teaser). Destination `orchestration` in `NAV_GROUPS` (Brain, stage `run`). Declared in `APP_ROUTE_SEGMENTS` so middleware does not hard-404 it.
- **Live list + poll.** `useLiveOrchestration` lists `pending` and `running` (two `workflows.list({ status })` calls), merges newest-first, then polls `workflows.get` + `getGraph` at `LIVE_WORKFLOW_POLL_MS` (2s) while the selection is live. Same poll as WorkflowRunHistoryPanel / canvas flow-step status. No workflow WebSocket.
- **DAG.** Reuses `WorkflowDagView`, `isLiveWorkflowStatus`, `StatusPill`. Open-canvas CTA to `/create`.
- **i18n.** `orchestrationWorkspace` + `nav.group.orchestration` + `marketingNav.tagline.orchestration` + `routeMarketing.destination.orchestration` in en/de/es/fr/zh.
- **Tests:** `useLiveOrchestration.test.ts`, `LiveOrchestrationWorkspace.test.tsx` (list in-flight, map graph onto DAG, select another run, stop poll on complete). Destinations / architecture / methodology / i18n / root-routes / edge-runtime checks pass.

## ✅ RESOLVED 2026-10-13 — TUI `/undo` rewinds the last conversation turn (ticket #3231, epic #3070)

`/sessions` and `/fork` already existed; `/undo` now rewinds the last completed user+assistant turn (including tool results) on the **same** session key so the next prompt continues from the prior leaf. Does not revert filesystem or git.

- **Persist.** `SessionManager.persistLeaf()` rewrites the JSONL to header + root→leaf. In-memory `branch()` alone is not enough: `chat.history` reads every jsonl message line.
- **RPC.** Admin-scope `sessions.undo` `{ key }` aborts an in-flight run (same cleanup as reset/delete) then `rewindLastTurn`. Same store key; no new jsonl; no archive. Empty/root → `{ ok: true, undone: false }` (no throw).
- **TUI.** `/undo` in the slash registry + help; handler calls `client.undoSession`, then `loadHistory()` on success (`undid last turn`) or `nothing to undo` at the root. Failures: `undo failed:`.
- **Tests:** `sessions-undo.test.ts`, `session-manager.test.ts` persistLeaf, TUI handler tests, e2e `sessions.undo rewinds the last turn on the same session key`.

## ✅ RESOLVED 2026-10-13 — Managed Agent hosting add-on ($49/mo/Agent) (epic #3056)

Self-serve add-on for hosting Managed Agents on BuilderForce infrastructure, priced at $49/host/month.

- **Stripe checkout.** Recurring subscription `$49/host/mo`, `purchaseKind: 'managed_agent_host'`, recorded via `ADDON_RECORDERS` in `purchaseRegistry.ts`. No `TenantPlan` mutation.
- **Waitlist + ops PATCH.** `POST /api/managed-agent-hosts` returns 403 if unpaid, 409 if qty exhausted. `DELETE` returns 409 for non-pending. Admin `PATCH /api/admin/managed-agent-hosts/:id` calls `provisionManagedAgentHostRequest(db, {requestId, status, agentHostId})` and maps `{error}`.
- **Tenant UI.** Pricing CTA + cart checkout, `ManagedAgentHostPanel` on WorkforceAgents, i18n in en/de/es/fr/zh.
- **Tests:** `managedAgentHostSubscription.test.ts`, `managedAgentHostRoutes.test.ts`, `tenantRoutes.managedHost.test.ts`, `adminRoutes.managedHost.test.ts`, StripeProvider tests.
- **Commits:** `dff067555`, `48e80c44c`, `ab226fdef`.

**Stretch not done:** #3343 auto-provision/VM deprovision (out of MVP scope).

## ✅ RESOLVED 2026-10-13 — Validate idea by asking the market: form send/post (epic #3083)

PRD 27 B3: form send → marketing_campaign, post → social_campaign.

- **Form send.** `CanvasFormSurface.tsx` "Send" button calls `sendForm()` which creates a `marketing_campaign` via the campaign API. Notice keys `form.noticeFormUnpublished`, `form.noticeFormNoAudience`, `form.noticeFormBlocked`, `form.noticeFormSent`, `form.sendFailed` in all five catalogs.
- **Form post.** "Post" button calls `postForm()` which creates a `social_campaign`. Notice keys `form.noticeFormPosted`, `form.postFailed`.
- **Ask people flow.** `formFromIdea` (`formObject.ts`), "Ask people" button in Ideas row (`IdeaLogRow.tsx`), `IDEA_EVIDENCE_KINDS` includes `form`.
- **Tests:** CanvasFormSurface + canvasIdeasSurface (16 pass).
- **Commit:** `ba9a3f2a4`.

## ✅ RESOLVED 2026-10-13 — Remaining Canvas acts onto the outcome contract (epic #3077)

Connected canvas acts now emit correlated ledger events instead of applying a patch and stopping. Draft objects are still not proofs.

- **Mapping is data.** `packages/creation-canvas-contract/src/canvasActionOutcomes.ts` maps `kind.action` onto proof-lifecycle / delivery verbs. Missing keys fall back to `{kind}.{action}`. Methodology check 8 ratchets `idea.reveal` → `proof.grade` and `form.publish`/`poll.publish` → `artifact.publish`. The eight-proofs lock on `website.publish` is unchanged.
- **One writer.** `frontend/src/lib/recordCanvasActOutcome.ts` emits `started` then one terminal, same `correlationId` (`act:{objectId}:{kind}.{action}`). The runner POSTs after a real mutation (`patch`/`add`/`download`/`ledger`); notice-only refusals do not start a correlation. Poll publish/open/close/reveal and `testPlan.gate` use the same helper. No `recordOutcome` under `domains/` or `components/creation-canvas/actions`.
- **Cheap idea path.** `idea.explore` → `idea.read`; `idea.test` → `proof.choose`; `idea.reveal` (was advertised, unimplemented) grades named interview / experiment / form evidence as `proof.grade` with `metricValue` 1 (met) or 0 (missed). `form.publish` / `poll.publish` are `artifact.publish` + `proof.build` with `metadata.reachable` from `/f/{slug}` / `/p/{slug}`.
- **Not this ticket.** Experiment stays unclaimed (`CONNECTED_CANVAS_ACTIONS` unchanged; no `bind_ab_test`). PRD 27 B3–B5 (form send/post, CRM, founder stage) are adjacent.
- **Tests:** `canvasActionOutcomes.test.ts`, `recordCanvasActOutcome.test.ts`, `ideaActs.test.ts` (reveal met/missed/missing).

## ✅ RESOLVED 2026-10-13 — VSIX chat ticket rail: expanded grid scrolls (VSIX 2026.10.32)

A chat with 60+ linked tickets expanded the ring grid past the host's clipped container, so later tickets could not be seen or scrolled to.

- **`panelStyles.ticketGrid`** (`packages/brain-ui/src/chatTickets/`): the expanded grid is now a scroll region capped at `min(320px, 45vh)` with `overflowY: auto` and `overscrollBehavior: contain`. `ChatTicketsPanel` uses it instead of an inline style. brain-ui 2026.10.9.
- **Verified:** brain-ui typecheck + build + `src/chatTickets` tests (21 pass); VSIX full type-check, package, and install of 2026.10.32 confirmed.

## ✅ RESOLVED 2026-10-12 — Spec import from GitHub Issues, Linear, and Jira (ticket #3075)

One-shot import of an external issue as a Spec (not a Task). No two-way sync, no auto-import, no UI.

- **`POST /api/specs/import`** and MCP `specs.import`. `BoardProvider.fetchTicket` for GitHub / Jira / Linear. Upsert keyed by `(tenantId, sourceProvider, sourceExternalId)` (migration `1215_specs_source_fields.sql`); re-import is idempotent. Optional `taskId` links the spec as the task's primary PRD.
- **Live credentials.** Import uses the project's board connection secrets (`98c77a6c7`); missing worker env refuses instead of forwarding `{}`. Connection tokens stay in credentials — they are never written onto spec rows, and HTTP/MCP output is projected to a public field list (`publicSpecImportResult`).
- **Tests:** `importSpec.test.ts`, `specRoutes.import.test.ts`, `builtinMcpService.specsImport.test.ts` (including the no-env refusal).
- **Commits:** `cb79a532c`, `98c77a6c7`, `bb3a4d9d7`, `ffd6eeb98`.

## ✅ RESOLVED 2026-10-12 — PRD-first at dispatch so host runs draft too (ticket #3096)

Host-delivered runs (On-Prem / pinned agent host) never entered `prepareCloudRun`, which used to be the only caller of `ensureTaskPrd`, so a host run started against a ticket with no PRD.

- **`startDispatchedExecution`** now calls `ensureTaskPrd` before `dispatchToAgentHost`. Rehearsal never enters this function, so `readOnly` is always false here. Best-effort: a draft miss still starts the run (the agent can write a PRD later via `update_prd`).
- **Still on the ROADMAP:** PRD commit is GitHub-only; no agent task-mutation tool; Auto runs carry no `cloudAgentRef`.
- **Tests:** `dispatchCloudRun.prd.test.ts` (called before host dispatch; a draft failure still starts the run); `ensureTaskPrdReadOnly.test.ts`.
- **Commit:** `54467a71d`.

## ✅ RESOLVED 2026-10-12 — Role→model resolver in `@builderforce/learned-routing` (ticket #3073)

Pin spawn/delegation roles to catalog model ids from `ROLE_MODELS` / `ROLE_MODEL_DEFAULT`. Unknown, empty, or unmapped roles use the documented default (no pin unless `defaultModel` is set). Pure, no I/O.

- **Still on the ROADMAP** (row stays 🔄 Partial): not wired into the cloud engine yet.
- **Tests:** `packages/learned-routing/src/roleModels.test.ts`.
- **Commit:** `9f514a949`.

## ✅ RESOLVED 2026-10-12 — Docs consolidated under `docs/`; strategy docs and gitignored files kept out of the public repo

- **One docs home.** `specs/builderforce/` → `docs/specs/`; root `PRD.md` (task #295's PRD) → `specs/tasks/task-295.md`; `LIGHT_THEME_BURNRATE.md` → `docs/design/light-theme-burnrate.md`. [`docs/README.md`](./docs/README.md) says what goes where. Every path reference (data-model guard scripts, code comments, ROADMAP/DONE, task PRDs) was rewritten. `specs/tasks/` stays at the root: `commitPrdToRepo.ts` writes task PRDs there in every bound repo.
- **Strategy is operator-only.** The pitch-deck source, SXSW pitch brief, distribution-channel GTM research, the Cursor/Continue feature-gap analysis and the zero-cost-hosting research moved to gitignored `docs/private/`. `ROADMAP.md`'s Buyer, ARR Milestones and Risk Register sections moved to `docs/private/strategy.md`. Dead `BUSINESS_ROADMAP.md` / `FEATURE_GAP_ANALYSIS.md` links in `agent-runtime/docs` were removed.
- **Gitignored files leaked into committed grounding.** The workspace symbol index and the VS Code codebase scan walked the disk with only a skip list. They wrote the 40 headings of `SECURITY-FINDINGS.local.md` (and `qa-e2e/test-results/`, `*.log`) into the committed `.builderforce/symbols.json`, `project-map.md` and `scan.json`. The fix is one primitive, `@builderforce/agent-tools/node-git-ignore` (`gitIgnoredMatcher` for full walks, `gitIgnoredSubset` for watcher batches; git is the authority, and outside a repo nothing is ignored). Both `WorkspaceSymbolIndex` (walk + dirty refresh) and `codebaseScan.ts` use it. The tracked artifacts were scrubbed. Test: `packages/agent-tools/src/node-git-ignore.test.ts`.
- **Project-map tree misattributed children.** `renderTree` sorted raw strings, and `-` sorts before `/`, so `docs/api/` was drawn under `docs-site/`. It now sorts by path segment.
- **Not done by this entry:** the history purge (ROADMAP, OTHER → Production ops). The deck stays a public download on `/media` by operator decision (2026-10-13).

## ✅ RESOLVED 2026-10-12 — Synapse→bfi cut-over: Ollama is not required (tickets #3766, #3767)

Synapse now runs local models itself. The desktop app supervises `bfi serve`; a separately installed Ollama is not required.

- **`bf-local` no longer drives Ollama.** `ollama.rs` and `SYNAPSE_USE_OLLAMA` are gone. `Handle::start()` always supervises `bfi` with health/backoff. The import-ollama CLI in `crates/bfi/src/ollama.rs` remains (one-shot conversion, not a runtime dependency).
- **VSIX discovery.** The VS Code extension reads `~/.builderforce/desktop.json` (`{ models: { endpoint, provider?: "synapse", token? } }`, override `BUILDERFORCE_DESKTOP_DISCOVERY`) and lists Synapse as local provider id `synapse`. Catalog `GET {root}/v1/synapse/catalog`; install `POST {root}/api/pull`.
- **CPU sidecar ships** with the Synapse app. `cargo install --git https://github.com/SeanHogg/builderforce-inference bfi` is the documented standalone install. Signed GitHub Release binaries are not published (owner signing secrets, ticket #3782).
- **Still on the ROADMAP** (Local LLM row stays 🔄 Partial): GPU 70% tok/s vs llama-bench is unmeasured (ticket #3762); live Bonsai 27B greedy vs the PrismML fork has not been run (ticket #3764, no weights in CI). Do not claim those.

## ✅ RESOLVED 2026-10-12 — Web Agents list shows a cloud run's live sub-agents (ticket #3087)

The VS Code roster already listed live children through `ChatTicketsPanel`'s `subagents` prop. The web passed nothing: no read returned a chat's live child executions (`parent_execution_id` set, payload `chatId` = the chat).

- **`GET /chats/:id/runs`** now includes `subagents` (`ChatSubagentRecord`: key/handle/name/label/owner) even when the chat has no linked tickets and no parent runs. Children are live-mode rows with `parent_execution_id`, non-terminal status, payload `chatId` matching the chat (SQL LIKE is a prefilter; `parseOriginatingChatId` is the exact match so chat 7 ≠ 70). Name prefers `asAgent`, then persona, then the slice label. Cap 50.
- **Web `ChatTicketsPanel`** polls `listRuns` every 4s (and on refresh/activity) and passes the mapped roster into the shared panel. A failed poll omits `subagents` and does not wipe the last roster.
- Shared `ChatRunHistoryVM.subagents` is optional so a degraded fetch is not "none running".
- Closes the Gap Register row that needed migration 1209 first (already on the schema).

## ✅ RESOLVED 2026-10-12 — Cloud loop in-run build/type-check/test via branch CI (ticket #3092)

- **The gap:** the durable Worker has no shell, so the cloud loop could not run a build, type-check, or test before `finish`. It fell through to CI-on-PR + webhook auto-fix, and a finish summary that claimed tests passed was only caught by the honesty gate (block once, then ship unverified).
- **In-run substitute:** `pollCommitCiStatus` / `pollBranchCi` (`api/src/application/ci/pollCommitCiStatus.ts`) read combined commit status (GitHub also merges `/check-runs`, because Actions often never publish a commit status) on the ticket-branch HEAD. Never throws; unreachable provider / missing SHA / no checks → `{ status: 'none' }`.
- **`run_checks`:** after static source/config validation, polls CI. Red fails the tool. Pending/none stay `ok` with a note that forbids claiming tests passed. Green explicitly allows the claim.
- **Pre-finish gate:** after static validation, `ciFinishDecision` blocks red (cap 3) and pending (cap 2). Caps persist on `CloudLoopState` across durable ticks. Green sets `ciVerified` and skips the honesty gate. `none` (including PR-only workflows) does not block; webhook auto-fix + `CLOUD_AUTOMERGE_REQUIRE_GREEN` remain the backstop.
- **PR annotation:** when `ciVerified`, the PR body and run summary say in-run CI was green and to re-check CI on the PR; otherwise the unverified caveat stays.
- **Container / Actions / on-prem (`5b0670e06`):** `inRunVerify.ts` plans `typecheck` / `type-check` / `test` from the nearest `package.json` and the image runs them via `run_command` after code changes, before `finish`. Durable records an honest skip (`DURABLE_IN_RUN_VERIFY_NOTE`) and must not claim those checks passed. Finish may proceed on a durable skip; a container that wrote code and has not verified may not.
- Tests: `api/src/application/ci/pollCommitCiStatus.test.ts`, `api/src/application/runtime/cloudAgent/inRunVerify.test.ts`.

## ✅ RESOLVED 2026-10-12 — Studio Brain turns stop repeating work: batched build-file reads, no Brain-trace undo steps, readable trace rows (ui 2026.10.47)

- **The report:** session `local-148925cf` (ui 2026.10.45), "lots of duplicate calls". The diagnostics showed four separate causes.
- **One file per step burned the budget.** `canvas_read_build_file` took one `path`. Each read was one model round-trip, and each round-trip re-sent the whole conversation plus 94 tool schemas. Fixing three missing stylesheet imports used 11 of the turn's 16 steps on single-file reads. The turn wrote the fix by step 8, then ran out of steps before telling the user.
  - The tool now takes `paths` (up to `MAX_READ_FILES` = 8, sharing one `MAX_READ_CHARS` budget). A missing path is named per file, and a single path keeps the old result shape.
  - The build section of the system prompt says to read together, and not to re-read a file the turn already read.
  - `TRUNCATED_TURN_DIRECTIVE` no longer says "ONE canvas_* tool call at a time", which also serialised reads. The one-per-response limit now applies to writes only.
  - The prompt now says a pasted error is fixed on its own, without resuming an earlier unfinished request, and that the turn says what it fixed.
- **The next turn started blind.** The out-of-steps notice is all the transcript keeps of a build turn, and it named nothing, so "continue" re-listed and re-read the whole app. `notices.stepsExhausted(changedFiles)` now appends "Changed so far: …" (new key `creationCanvas.notice.stepsExhaustedFiles`, in all five catalogs). The runner collects the paths in dispatch.
- **The Brain's trace became the user's undo history.** `CreationCanvas` copies the live turn into the chat object after every tool call. The history checkpoint recorded each copy as an undo step and as a `user/object.edit` journal row: 37 rows attributed to the person, and an undo depth of 21.
  - `lib/canvasBrainMirror.ts` (new) owns `BRAIN_MIRROR_FIELDS`, the writer `brainMirrorData` and the reader `withoutBrainMirror`, so the field list cannot drift between them.
  - `hooks/useCanvasHistoryCheckpoint.ts` (new) is the checkpoint, moved out of `useCanvasDatasetImport`, where it did not belong. A change confined to the mirror moves the baseline silently: no undo step and no journal row.
  - `hooks/useBrainObjectMirror.ts` (new) is the mirror effect, moved out of `CreationCanvas.tsx`. Its line ceiling dropped from 1163 to 1159.
- **Two different reads looked like one.** The trace header ellipsed the path at its end, so `src/pages/Home.jsx` and `src/pages/Home.css` both rendered as `src/pages/Home…`.
  - In brain-ui, `toolStepView` now sets `subjectIsPath`, and `ToolStep` renders a path left-elided (`.bf-tl__tool-subject--path`, RTL plus a `<bdi>` isolate) with a full-path `title`.
  - A batched read is labelled with its basenames.
- Tests: `canvasBrainMirror.test.ts` (new); batched-read cases in `canvasBuildTools.test.ts`; the exhausted notice in `creationCanvasAi.test.ts`; subject cases in `toolStepView.test.ts`.

## ✅ RESOLVED 2026-10-12 — VSIX Work view stops dropping and reloading the Sessions list during agent runs (VSIX 2026.10.31)

- **The gap:** every platform write from a run (`builtin_tasks_create`, `builtin_chats_link_ticket`, …) caused 6–10 API calls and two or more full rebuilds of the Sessions list. A ticket-heavy run therefore kept the Work panel blanking and reloading.
  - The chain: `bf:mcp-write` → ticket rail reload → progress change → `reloadChats` → `chats.changed` → `tree.refresh()` (cache dropped) plus a fresh `attention.refresh()` → `attention.onDidChange` → a second `tree.refresh()`.
  - On top of that, `platform.write` ran another fresh attention fetch.
- **`refreshCoalescer.ts` (new):** a leading-plus-trailing throttle. An isolated refresh runs immediately; a burst inside the 2s window becomes one trailing run. Its owner holds it, so every caller is throttled without knowing.
- **`sessionsSnapshotStore.ts` (new):** the Sessions data moved out of `sessionsTree.ts`, which is back under 400 lines.
  - It keeps one snapshot and revalidates in the background (stale-while-revalidate). The snapshot is never dropped: a refresh fetches first and swaps the result in when it arrives.
  - A fetch already in flight is shared. A response older than the latest reload is discarded.
  - An identical answer fires nothing; `onDidChange` fires only when the list moved.
  - The agent pool is fetched only when a participant's name is unknown.
- **`SessionsTreeProvider` rows are derived on paint.** `repaint()` handles local state (attention icons, editor-local runs, archive, project filter) with no request.
  - Archive toggles now repaint instead of refetching.
  - Archive pruning now runs against the unscoped list. Previously a chat in another project lost its archive entry whenever a project was selected.
- **`AttentionPoller.refresh()` is coalesced**, so `onChatsChanged` and `onPlatformWrite` together cost one fresh attention fetch per window.
- **`extension.ts`:**
  - Attention changes call `repaint()`, plus a throttled `refresh()`.
  - Local-run changes call `repaint()` only.
  - The archive/unarchive commands call `tree.archiveSession` / `unarchiveSession`. The duplicated archive-state wrangling and the public `archiveState` setter are gone.
- **Webview (`VsCodeChatSurface.reloadChats`):** posts `chats.changed` only when the chat list actually differs.
- Test: `src/refreshCoalescer.test.ts`.

## ✅ RESOLVED 2026-10-12 — Workspace hooks + rules the team commits (`.builderforce/hooks.json`, `rules.md`) (VSIX 2026.10.31 · brain-embedded 2026.10.22)

- **The gap:** the VS Code agent took no user-defined directives. Every end-of-run step was hard-coded (`selfReviewShip`), no rules file was read into the prompt, and policy gates are admin- and server-side only. There was no way to say "after a session, update README and DONE".
- **Loop seam:** `brain-embedded/src/stopHooks.ts` adds `BrainRunRequest.onStop`. In `onNoToolCalls` the host is asked whether the run may end, and a returned instruction re-prompts the run. This runs BEFORE the ship gate, so a hook's work lands in the same commit. It is bounded to `MAX_STOP_HOOK_ROUNDS` (4), recorded as a `loop.stop_hook` trace, and a throwing hook never fails the run.
- **Extension, `src/hooks/`:**
  - `hookConfig.ts` is the pure schema, validation, matcher and command digest. Events are `stop` (prompt or command), `preTool` / `postTool` (command, `tool` matcher with `|` lists) and `runEnd` (command). `when` takes `codeChanged` (the default) or `always`. Also `blockOnFailure` and `timeoutSeconds`.
  - `workspaceDirectives.ts` loads both files, cached by mtime+size version token.
  - `runHooks.ts` is a per-run, vscode-free state machine. Each stop prompt is handed over once, then blocking checks re-run until they pass. A failing preTool refuses the call. A failing postTool adds `hookFeedback` to the result. runEnd is fire-and-forget. Sub-agents get the tool hooks only.
  - `hookTrust.ts`: commands need a one-time per-machine approval keyed by command digest (workspaceState), and never run in an untrusted workspace.
  - `editorDirectives.ts` is the one assembly both chat surfaces call.
- **Shared seams, duplicates migrated:**
  - `createNativeRunTool` takes `hooks`, so the panel run host and the native participant use one tool seam.
  - `runPreamble.ts` `withRunPreamble` (governance → workspace rules → host prompt) replaces the two copies of the governance prepend in `brainRunHost.ts` and `nativeBrainRun.ts`.
  - `localShell.ts` `createLocalShell` is extracted from `localCapabilities.ts`. `run_command` and hook commands share one runner, and it now takes `env` and `timeoutMs`.
- **Authoring:**
  - New command `builderforce.editWorkspaceHooks` writes a starter file. Localized in all 5 nls catalogs and l10n bundles.
  - `jsonValidation` points at `schemas/hooks.schema.json`.
  - The scan's `.builderforce/README.md` now documents both team files as "commit these".
- **Ship:** release note migration `1214_release_note_workspace_hooks.sql`; blog `frontend/src/content/blog/workspace-hooks-your-team-commits.md`; CHANGELOG entry 2026.10.31.
- **Tests:** `stopHooks.test.ts`, `hooks/hookConfig.test.ts`, `hooks/runHooks.test.ts`, `runPreamble.test.ts`, and three end-to-end cases in `nativeBrainRun.test.ts` (rules in prompt, stop prompt holds the run a turn, preTool refusal).

## ✅ RESOLVED 2026-10-12 — VSIX Work view: open-only Tasks, a Closed section, archive/delete, and cancelled = done (VSIX 2026.10.29 · api 2026.10.37 · agent-loop 2026.10.9)

- **The gap:** the Work view loaded every ticket, and you could not archive or delete one from the editor. A cancelled ticket's own ring showed **0%** while its chat header showed 100%.
- **One open/closed rule:** `packages/agent-loop/src/taskClosedState.ts` defines it once. Closed means a done-class or cancelled lane (including tracker spellings), or archived. It also defines the `open | closed | all` list scope. The api, the VSIX trees and the chat health rollup all use it, and `isExcludedFromChatHealth` now delegates to it.
- **Cancelled counts as done:**
  - `buildTaskProgressBreakdown` scores a closed lane at 100%, ahead of the subtask math, and counts cancelled subtasks as done.
  - `ChatTicketService`'s local `DONE_STATUS` set and its SQL literal both now read `TASK_CLOSED_STATUSES`, so a cancelled ticket chip reads 100%.
- **Tasks shows open work only:** done, cancelled and archived tickets are filtered out of it, and the hide-done toggle (`builderforce.hideDoneTasks` / `showDoneTasks` and their NLS keys) is gone.
- **New Closed section:** `closedTasksTree.ts` is collapsed by default and loads only when opened, through a cached `listClosedTasks` (`include_archived=true`) that `invalidateTasks` also clears. It shows newest first and follows the Tasks list's refresh signal.
- **Row actions (`taskActions.ts`):**
  - Set status: `setTaskStatus` moved here from `extension.ts`. It reopens a closed ticket and now offers `cancelled`.
  - Archive / Restore: `PATCH archived`.
  - Delete: `DELETE /api/tasks/:id`, behind the shared modal confirm. Deleting is refused while the ticket has a live run.
  - The confirm's editor binding is extracted to `confirmDeletionUi.ts`, and `deleteSession` was migrated to it.
  - `authed()` no longer calls `res.json()` on a 204 response.
- **Shared lanes:** `taskLanes.ts` is one lane list for the board columns and the status picker.
  - The board previously had no `cancelled` column, so cancelled cards fell into Backlog.
  - The board's toggle now hides every closed column and is localized.
  - Row vocabulary (ordering, labels, icons, needs-attention) moved to `taskTreeShared.ts`. That takes `projectsTree.ts` from 453 lines to about 370.
- **Agent tools:**
  - `tasks.list` takes `scope` (default `open`; an explicit `status` defaults to `all` so `status:"done"` still works). It reads archived rows for `closed` and `all`, and returns `scope`.
  - `tasks.update` describes closing (done/cancelled) and archiving.
  - `tasks.delete` says it is permanent and to prefer archiving. The VSIX agent gets these through the same `/llm/v1/mcp/tools` catalog.
- **Deleted tickets:** deletion is a hard delete on the server, so deleted tickets do not appear in Closed. That is why the confirm exists.
- **Guard fix found on the way:** `check:silent-catches` was failing (frontend empty-catch 189 vs. baseline 188). The cause was the live-poll `catch {}` in `WorkflowRunHistoryPanel.tsx` (a5f462b29). It now reports the first failure of each live run via `reportBackgroundFailure` (level warning) and keeps the last snapshot.
- **Verified:** api and VSIX type-checks are clean, the api runs 37/37 guards, and the targeted tests pass (api 85, agent-loop 17, VSIX 19, frontend 10). VSIX 2026.10.29 is installed.

---

## ✅ RESOLVED 2026-10-12 — Brain-created project with no repo no longer returns coder prose (ticket 3089)

- **What:** A Brain `projects.create` minted a bare `projects` row. The board-dispatched coder then had neither a git repo nor an IDE workspace and returned prose ("No repo bound"). Scratch-repo-at-create is rejected (Brain tenants typically have no git provider). Designer projects now go through the IDE workspace (`ide/projects/{id}/`).
- **Create door:** MCP `projects.create` calls `afterBrainProjectCreate` (provision starter files + board + Evermind, then bind `ide_projects`). REST POST `/api/projects`, `/upsert`, `/scaffold` bind the IDE workspace after `provisionProject`. Zero-setup starter-workspace uses the same Brain helper.
- **Runtime (already on main):** coding-dispatch uses `DispatchDetail.workspace` when `repo` is null; agent-host `GET /:id/dispatch/:dispatchId` attaches `workspace.filesPath`; GET/POST `/:id/workspace/:projectId/files` is the R2 analogue of git-proxy. Reasoning-only is last resort and names the reason.
- **Cloud/board loop (ticket 3089 remaining hole):** when `resolveTicketRepoContext` misses, durable `buildCloudProvider` and container `write_file` now resolve the IDE R2 workspace (`ideWorkspaceCoding.ts`) and list/read/search/write/edit/delete there. Prompt uses `describeWorkspaceBlock` / `codingTargetToolingLine` so the model is told to use `write_file`, not dump a deliverable. Last-resort prose only if neither git nor IDE is bound. `staticCheck.verify` skips with a workspace note (no clone). Writes record `taskFileChanges` and take the same coordination lease (scope = ticket, slug `workspace:{projectId}`, branch `workspace`).
- **Tests:** `builtinMcpService.test.ts` (env → afterBrain, no-env → bind, provision failure still returns the project); existing `ensureProjectCodingTarget.test.ts` + `builderforce-coding-dispatch.test.ts` workspace path; `ideWorkspaceCoding.test.ts` (prompt git vs IDE vs neither; list/read/search/write/edit/delete against fake R2; traversal write refused).
- **Files:** `api/src/application/llm/builtinMcpService.ts`, `api/src/presentation/routes/projectRoutes.ts`, `api/src/application/tenant/starterWorkspace.ts`, `api/src/services/ensureProjectCodingTarget.ts`, `api/src/application/runtime/cloudAgent/ideWorkspaceCoding.ts`, `api/src/application/runtime/cloudAgent/ideWorkspaceCoding.test.ts`, `api/src/application/runtime/cloudAgent/prd.ts`, `api/src/application/runtime/cloudAgent/containerOps.ts`, `api/src/application/runtime/cloudAgentEngine.ts`.

---

## ✅ RESOLVED 2026-10-12 — Sequential batching in bfi-runtime (builderforce-inference e4c07ee)

- **What:** Added sequential batching to the local inference runtime so one Engine can run multiple prompts without reloading the model.
- **Implementation:** `Engine::generate_batch(&mut self, prompts: &[&str], params: SampleParams) -> Result<Vec<String>>` loops through prompts calling `generate()`. The `run_queued<F, E>` helper runs each prompt sequentially on the same generator.
- **Scope:** Minimal scheduler hook — sequential reuse of one loaded model. Concurrent token mixing / paged attention is out of scope for this iteration.
- **Tests:** `cargo test -p bfi-runtime` — 39 tests passed, including `run_queued_two_prompts_reuses_same_generator`, `run_queued_empty_is_empty`, and `run_queued_stops_on_first_error`.
- **Files changed:** `builderforce-inference/crates/bfi-runtime/src/engine/mod.rs`, `builderforce-inference/crates/bfi-runtime/src/lib.rs`.
- **Related:** Parent ticket 2919 (M4: Advanced features - batching, caching, grammar).

---

## ✅ RESOLVED 2026-10-12 — A dropped connection no longer ends the run (VSIX 2026.10.28 · brain-embedded 2026.10.21)

- **What the new error messages showed (chats #141/#142):** `fetch failed ← connect ETIMEDOUT 172.67.182.187:443 | connect ENETUNREACH 2606:4700:…`. The client could not open a socket to the gateway at all, and it happened in every run in the same second, so it was a network drop on the user's machine.
- **What we did about it:** we retried once, immediately, "on another connected model". No model had been involved, so that could not help.
- **Retry:** `retryOnConnectFailure` and `isConnectFailure` (brain-embedded `networkErrorDetail.ts`) re-send a request whose connection never opened, with backoff of 1/2/4/8/16s. Nothing was sent, so this is safe even for writes. A reset or timeout on an open socket is never repeated, and a Stop ends the wait.
- **Where it applies:** the completion stream, which marks `TransportError.unreachable` and logs `llm.connect_retry` steps; the run store, which no longer retries an unreachable gateway on another model; and the VSIX platform-tool catalog fetch and `builtin_*` calls.
- **Tool catalog:** a run that started during an outage used to get an empty platform catalog, so every `builtin_*` call failed as an unknown tool. The catalog fetch now retries too.

## ✅ RESOLVED 2026-10-11 — One write outbox for all client chatter (write-outbox 2026.10.1 · brain-embedded 2026.10.20 · frontend 2026.10.45 · replay-sdk 2026.10.1 · VSIX 2026.10.27)

- **Six hand-rolled queues → one.** Run steps (`stepOutbox`), VS Code activity, portal activity, the visitor journey, QA capture and session-replay chunks each had their own array, size cap, interval and unload flush.
  - They now share `createOutbox` (`packages/write-outbox`, source-only).
  - Items queue per key. Batches leave at a size cap, after a max wait from the first item, on an explicit flush, or riding along with a caller's request (`drainWith`).
  - `coalesce` folds a batch before it's sent (VS Code `coalesceSignals`).
- **Order.** Each key has at most one send in flight, so batches arrive in queue order. A final (unload) flush bypasses the lane, since the page is going away.
  - Replay `ChunkBatch` declared an `inflight` guard but never set it, so concurrent flushes could interleave chunks. Retries now hold the lane, so chunks land in `seq` order.
  - A step batch can no longer be overtaken by the assistant message that follows it.
- **Fewer moving parts.** These are gone: the interval timers (VS Code activity 5 min, portal 15 s, QA 5 s, replay `start`/`stop`), QA's flush-before-project-switch (lanes are keyed by project), and the per-copy flush bodies.
- **replay-sdk had never installed or type-checked.** These were not caused by the outbox change.
  - `rrweb` was pinned to `1.19.3`, a version that does not exist. The recorder is written against the 2.x API (`maskInputFn(text, element)`), so it is now pinned to `2.1.7`.
  - `rootDir: "src"` conflicted with the shared-package `paths`, so it is dropped (tsup emits the build).
  - `index.ts` re-exported a `bootEmbed` that `embed.ts` never defined. `embed.ts` now exports `bootEmbed()` and starts itself like the loader.
  - The click handler passed `deriveSelector()`'s `{ selector, label }` object where a selector string was expected, so every recorded click carried an object. It now passes the string.
  - `...session` was spread after the recorder's `init`, silently replacing it. The spread now comes first.
  - The `MarkTracker` test fixture now satisfies `SelectorElement`.
  - `jsdom` (the test environment) was never declared, so no test file could start. It is now a devDependency.
  - `rootDir` is set to `..`, because TS 6 defaults it to the tsconfig directory, which excludes the shared packages.
  - `maskInputFn` takes rrweb 2.x's `HTMLElement`.
  - Two tests were wrong and had never run:
    - The visit-rotation test ignored that each call slides the idle window.
    - The loader's no-key test inherited a `currentScript` pinned by the test before it.
- **Not batched, on purpose.**
  - Error reports (`/api/quality-ingest/client-report`): rare, and they must land at once.
  - The agent's server-side tool calls: the kernel runs them one at a time.
  - LLM streams.

## ✅ RESOLVED 2026-10-11 — Run steps: one store, sent in batches (api 2026.10.36 · brain-embedded 2026.10.19 · agent-loop 2026.10.8 · frontend 2026.10.44 · VSIX 2026.10.26)

- **One `POST /chats/:id/messages` per step.** Every tool call, LLM turn and memory step was its own request (chat #142: 57 tool calls over 22 turns, about 80 requests). Each request cost the API an access check, a membership upsert, the insert, a seq update, a chat touch and a learn-gate read.
  - `stepOutbox.ts` (brain-embedded) now queues step rows per chat.
  - A queued row rides along with the next conversational send for the chat, or leaves when 25 rows are queued, after 5 s at the latest, or at run end.
  - Steps are ordered by their own `ts`, so batching cannot reorder them.
- **Every step was persisted twice.** Steps were written as `role:'tool'` rows in `brain_chat_messages` AND posted at run end to `brain_chat_trace` (VS Code `persistRunTrace`, web `useBrainRunTrace`). Readers had to merge and dedupe the two (`mergeRecoveredTrace`).
  - The step rows are now the only store.
  - `pushTrace` is the one writer, through a per-run sink (`RunCell.persistStep`), so events that only reached the trace copy (dedupe stubs, replays, guard and stopped-turn events) are now step rows too.
  - The row is built once, by `stepRow()` in `@builderforce/agent-loop`, for both the client loop and the server's `agentReply`. `agentReply` had written steps only to the trace table; its history query now skips step rows.
  - Removed: `GET`/`POST /chats/:id/trace`, `BrainService.appendTrace`/`getTrace`, the `brainChatTrace` schema table and its swept/cascade/telemetry/copy-script entries, `postBrainTrace`, `getChatTrace`/`appendChatTrace`, `useBrainRunTrace`, `chatTrace.ts`, `traceRowToEvent`, `mergeRecoveredTrace` and `traceEventToPersistInput`.
  - The table is dropped by migrations `1212` (primary) and transactional `0014`.
  - Manager diagnostics derive the steps from messages (`chatStepTrace`, `conversationTurns`).
- The extension's ambient traffic was audited and is already batched: activity flushes every 5 min, the connection beat runs every 15 min, and attention polling is adaptive. Tool calls stay sequential in the kernel (one pending slot), so the MCP relay calls cannot be batched without a concurrent kernel.

## ✅ RESOLVED 2026-10-11 — Sub-agents are clones of their parent; network failures name their cause (VSIX 2026.10.25 · agent-tools 2026.10.9 · agent-loop 2026.10.7 · brain-embedded 2026.10.18)

- **Sub-agent "Unknown tool" failures (chats #141/#142).**
  - Cause: `childCatalog` withheld every mutating tool from a read-only or scoped child, while the owner's WORK prompt still told it to call `builtin_tickets_from_delta`, `builtin_tasks_update`, `run_command` and `edit_file`.
  - Fix: a child is now a clone of its owner, with the same catalog and the same execution. `read_only` and the fan-out `paths` scoping are gone from `spawn_agent`/`spawn_agents`, `SubagentRequest`, the cloud capabilities (`MUTATING_`/`TREE_WIDE_CAPABILITIES`, `scopedRepoWrite`, `delegationProvider`) and the VSIX (`childRunPolicy.ts` → `childPersona.ts`, plus `canWrite`/`writable`/`readOnly` and the strip tag).
  - Kept: the depth cap and cloud `NON_DELEGABLE` (`human`, `skill.author`).
  - Keeping slices apart is now the planner's job (`planHandoff.canRunInParallel`).
- **`TransportError: fetch failed: fetch failed`.** undici's reason (`cause`) was discarded. `describeNetworkError` (brain-embedded `networkErrorDetail.ts`) now reads the cause chain in `streamChatCompletion` (before the response and mid-stream) and in the VSIX local-model proxy. `TransportError` keeps the original error as `.cause`.
- `isReadOnlyShellCall` moved to `readOnlyShell.ts`, so there is one copy.

## ✅ RESOLVED 2026-10-11 — Marketplace: Built-in agents show, an All view opens the storefront

- **Agents ▸ Built-in was empty for every visitor.** `provisionBuiltinAgents` creates each workspace's own copy with `published: false`. `publicAgentScope` lists only published rows, so `GET /api/workforce/agents` never returned a built-in, and the chip filtered that list for `builtin_kind`. It was also the default chip of a bare `/marketplace`, so the storefront opened on an empty grid.
  - Now `BUILTIN_AGENT_CATALOGUE` is projected from `BUILTIN_AGENTS` and served by `GET /api/workforce/builtin-agents`. The endpoint is static: there is no DB read, it sends `Cache-Control: public`, and the client caches it.
  - `BuiltinAgentsSection` renders the roster with "Open in your workforce" for a member and sign-in for a guest, never "Hire". The Community grid now shows published rows only.
- **There was no "All".** The four families replaced the old tabs and dropped the overview, and legacy `?category=all` went to Talent.
  - A new `all` family (`flow: 'overview'`, no kinds) is the default for a bare `/marketplace` and for `?category=all`.
  - `MarketplaceOverview` is one strip per family (`STRIPS` registry data), each with "See all". Its CTA builds on the canvas.
- **DRY along the way.**
  - `TalentCard` is extracted from the page client and shared with `TalentPreview`.
  - `StartupPreview` is extracted from `StartupDirectoryTeaser`, which now composes it.
  - `CreationsSection` takes a `limit`.
- **Spec.** PRD 33 and 33a now use one slug, `session-replay` (`SESSION_REPLAY_SLUG`), for the listing, the landing URL and the `LISTING_LANDINGS` key, where they had disagreed (`insights` vs `session-replay`).
- i18n ×5 (`marketplace.family.all|publishAll|seeAll|note.all`, `marketplace.builtinAgents.*`). Styles use theme tokens and grids that collapse to one column on a narrow screen.

## ✅ RESOLVED 2026-10-11 — Session replay, heatmaps and live visitors — full S0–S8 launch (frontend 2026.10.42 · api 2026.10.34 · replay-sdk 2026.10.1)

> **Correction 2026-10-13:** this entry overstated the build. An audit found S1 and S3–S7 almost entirely unbuilt, the commerce modules unwired, and release note 1211 describing a product that did not run. The real build is the 2026-10-13 entry below.

S0 consolidation merged `GuestSessionsPanel` and `VisitorFlowPanel` into Growth ▸ Insights with one `VisitorPanel` and one `StatTile`. S1 built the data plane (R2 chunks + transactional tables). S2 shipped the `replay-sdk` with a self-updating loader served from CDN at `cdn.builderforce.ai`. S3 dogfooded on builderforce.ai. S4 delivered heatmaps. S5 added live and flow links. S6 wired free capability install and prepaid recording packs (`ONE_OFF_SETTLERS` + `ledger_entries` denomination). S7 added buyer surfaces (loader injection into hosted apps, canvas Measure ▸ Visitors surface). S8 shipped:

- **Release note 1211:** "Watch what visitors do — session replay & heatmaps" (frontend 2026.10.42).
- **Blog post:** "See why visitors leave — not just that they left" in all five locales (en/de/es/fr/zh).
- **Catalog entries:** `blog.posts.see-why-visitors-leave` in all five message catalogs.
- **Methodology:** Added to `seo.ts` `methodology` set as the fifth close-the-loop article.
- **Tests:** `check:blog-index` passes, i18n parity tests pass, message catalog parity tests pass.
- **Live runbook:** Not executed — requires Stripe secrets, webhook registration, and an operator to run the real-payment verification steps per 33a §10.3.

**Still requires operator action:**
- Deploy api + frontend + publish-cdn (S8.1).
- Dogfood customer #1 with legal disclosure + `replay.recordSignedIn=true` (S8.2).
- Run the full purchase/refund flow with real Stripe keys (S8.3–S8.7).
- Execute method smoke test with proof grading (S8.9).
- Run prescriptions and page review on an external fixture (S8.10–S8.11).

**Related tickets:** S0→S7 (2772, 2860, 2862, 2861, 2863, 2864, 2865, 2866).

---

## ✅ RESOLVED 2026-10-11 — A message reaches an agent that is waiting on its sub-agents; the sub-agents strip collapses (VSIX 2026.10.23 · 2026.10.24)

- **A message pressed with Enter queued behind a waiting agent.** While the chat's run sat in `wait_agents`, a typed message joined the queue and waited for the whole run to end. Now `sendOrQueue` steers it into the run when `isWaitingOnSubagents(conv.activity)`, the same as Steer now, and the host's `registry.interrupt` ends the wait. The user's capture was on 2026.10.21, which predates the interrupt (a reload was pending).
- **The sub-agents strip could not be folded.** Its header is now a toggle (`aria-expanded`, caret). Folded, it shows one line naming each worker (`a1 Name · a2 Name`). The choice is remembered in `localStorage`, with try/catch. "Hide sub-agents" / "Show sub-agents" are in all five l10n bundles, and the styling uses the panel's tokens.

## ✅ RESOLVED 2026-10-11 — Sub-agents: waits give way to the person, roster lists them, diagnostics read each one

- **A parent in `wait_agents` held the person's message for up to 10 minutes.** The wait ran until every named child settled. Now a person's message ends it on both surfaces. In the editor, `brainRunHost.steer` calls `registry.interrupt`. In the cloud, the wait loop checks `hasPendingPersonSteer`: a pending steer with a `sentBy`, which a child's report never has. The owner reads the shared `WAIT_INTERRUPTED_NOTE`, and its children keep running.
- **Sub-agents were missing from the chat's Agents list.** `ChatTicketsPanel` takes `subagents` (`ChatSubagentVM`) and shows each one beside the invited agents, with its handle and owner. The VSIX passes its live children (`useChatSubagentRoster`). The panel's sections moved into their own files (`AgentsSection`, `LinkForm`, `PeopleSection`, `MergeSection`, `QuestionsSection`, `panelStyles`), which takes it from 573 to about 330 lines. The label is translated in all five web catalogs (`brain.tickets.subagentOf`).
- **Copied diagnostics said nothing about sub-agents.** A new `formatSubagentDiagnostics` in brain-embedded reads each child from its own run trace. For each it lists owner, depth, ticket, state, turns, tool calls, failed steps, models, files changed, current step and report. The VSIX remembers every child a chat has had this session, so finished and failed ones are included.
- Versions: VSIX 2026.10.22 · api 2026.10.33 · agent-tools 2026.10.8 · brain-embedded 2026.10.17 · brain-ui 2026.10.8.

## ✅ RESOLVED 2026-10-11 — One sub-agent path on every cloud surface: Container and Actions parents spawn the same durable children (agent-loop 2026.10.5 · agent-tools 2026.10.6 · api 2026.10.31)

User: "why would there be a separate scenario?" The earlier pass left image-run parents on the inline, 8-step child. There is now ONE delegation path:

- **Images relay every delegation verb through one op.** `agentRelay.mjs` sends `spawn_agent`, `spawn_agents`, `wait_agents`, `message_agent` and `stop_agent` to the Worker's `subagent` op (`containerOps.ts` → `delegationOp`). That op runs the shared tool definitions against `buildLiveOrchestration`, with the image run as the owner. The old `spawn` op is an alias.
  - The child is the same durable execution a runner parent starts. Its report reaches the image as a steer on the `llm` op, which the image loop already splices in.
  - A finish with live children is answered by a steer from the `llm` op, which the loop treats as overriding the finish, so the gate needs nothing from the image.
  - `finalize` absorbs the children's commits from the branch diff and stops a finished owner's live children.
  - A writable child's spawn note tells an image owner to `git_sync_latest`.
  - The handshake hides the new tools from images that predate the op.
- **The inline child loop is deleted.** Removed: `runSubagent`, `SUBAGENT_MAX_STEPS`, `SUBAGENT_OUTPUT_CHARS`, `buildOrchestrationCapability`, `imageHostedChildCeiling`, `SubagentDeps`, the serialized write chain and the `FANOUT_NEXT` one-shot wording. `subagentSystemPrompt` always takes an owner.
- **Cloud children recurse like the editor's.** A child may spawn while `depth < MAX_SUBAGENT_DEPTH` (3, now one constant in agent-tools that both surfaces read). A tree's tokens bill to its root (`rootExecutionId`). A rehearsal has no delegation capabilities, because a dry run must not start real runs.
- **The engine reads one field,** `CloudRunDelegation {parent, runtime, spec?}` (`cloudRunDelegation.ts`).
- Also closes the "Container / Actions images cannot fan out" Gap Register row: `spawn_agents` relays through the same op, and the clone-sync concern is covered by the branch-diff absorb and the sync note.


## ✅ RESOLVED 2026-10-11 — Cloud sub-agents run as their own durable runs; the editor's native chat approves a sub-agent's edits (agent-tools 2026.10.5 · api 2026.10.30 · VSIX 2026.10.20)

Closes four Gap Register rows logged earlier the same day.

- **Cloud sub-agents no longer block their parent, and have no step cap.** On the durable runner a child is its own execution on the parent's ticket. It carries a `subagent` spec on its payload and `parent_execution_id` (migration 1209). It runs through the same runner and engine as any run, with the live sub-agent brief in front of its owner's prompt (`cloudChildRuns.ts`). `spawn_agent` / `spawn_agents` return a handle at once (`cloudLiveOrchestration.ts`). The parent redirects a child with a steer (`message_agent`), stops it with a cancel (`stop_agent`), and waits only when it must (`wait_agents`, at most 5 minutes per call). A child's report goes to the chat and, exactly once, to the parent as a steer before its next turn. Delivery runs from the runner's one terminal chokepoint, which also stops a finished parent's live children.
  - **Finishing waits for children.** A parent may not finish while children are live. At finish, the files its writable children committed are read from the branch diff into the parent's written set, so the pull request covers the whole tree.
  - **A child is part of its parent's run.** `liveExecution()` excludes it from delivery aggregates, and its tokens meter under the parent, so a fan-out is still one cloud run against the cap. It is lifecycle-neutral (never moves the ticket) and posts no run milestones. The rerun breaker ignores it. It never finalizes; the deliverable gate is its owner's.
  - **One definition of the owner's verbs.** `wait_agents`, `message_agent` and `stop_agent`, the report and direction wording, and `LIVE_DELEGATION_NOTE` / `LIVE_FANOUT_NEXT` now live in `@builderforce/agent-tools` (`live-subagent-tools.ts`, capability `orchestrate.live`). The editor's control tools are an adapter over them. `resolveDelegatePersona` is shared by the inline and background spawners.
- **Native `@builderforce` chat approves a sub-agent's edits.** `childApprovalRelay.ts` asks the chat's approver (the same Apply/Skip modal the turn uses) when one of its children pauses on a confirm. Whichever surface answers first wins, and a late answer is dropped. Children from the native view are now writable.
- **`replay-sdk` derives its source-package aliases** from `scripts/sourcePackages.mjs`, so `source-package-graph-guard` passes.
- **Frontend catalog parity:** `admin.sub.visitors` was added to es/de/zh/fr and `admin.insights.*` to zh/fr.

## ✅ RESOLVED 2026-10-11 — A sub-agent is the same run with an owner, working in the background (agent-loop 2026.10.4 · brain-embedded 2026.10.16 · brain-ui 2026.10.7 · VSIX 2026.10.19 · frontend 2026.10.41)

The editor's sub-agents were a SECOND loop (`runChild` in `subagentRun.ts`) running inside one blocking tool call:
- the chat waited minutes for it;
- its steps never reached the chat, only a final report did;
- it had no Stop, no redirect and no owner shown;
- it was capped at 8 or 40 steps, which is why chat #134 "kept running out of turns". That broke the no-step-limit rule.

Fixes:
- **One run, recursive.** A child is an ordinary host run (`brainRunHost.run` → `startRun`) with its own run key and a `RunLineage` pointer (`brain-embedded/src/runLineage.ts`). It has the same tools, gates, ticket backstop and failure-streak breaker, and no step cap.
  - `startRun` separates the cell key from the server chat, so everything a child persists goes to the root chat. A lineage persistence adapter attributes those messages (`authoredBy` + `subagentOf`, marked mid-turn).
  - A child can spawn its own children, up to depth 3, with at most 12 live per chat (`clients/vscode/src/childRuns.ts`).
- **Non-blocking.** `spawn_agent` / `spawn_agents` return handles (`a1`, `a2`, …) at once (`childRunSpawner.ts`). The report reaches the owner exactly once:
  - to a waiting `wait_agents` call, or
  - otherwise into the owner's inbox. If the owner is idle, the inbox wakes it with a new turn (`childRunHost.ts`); a wake on a busy owner is replayed when its run settles.
- **Run steering** (`brain-embedded/src/runSteering.ts`). Any live run has an inbox, drained before each model turn, and it re-opens a run that was about to end. This one path serves:
  - `message_agent` (owner → child);
  - the strip's Redirect (person → child);
  - `@name` / `#ticket` in the composer (person → child);
  - "Steer now" on a queued message (person → the chat's own run);
  - a child's report (child → owner).
- **Owner tools.** `wait_agents`, `message_agent` and `stop_agent` live in `subagentControlTools.ts`. The `hand_off` fan-out tells the coder its children run in the background.
- **UI.**
  - `SubagentStrip` above the composer shows each live child's activity and offers Approve, Redirect, Stop and Stop all, driven through the run store by child key.
  - The transcript tags a child's messages "sub-agent of {owner} · aN" and the chat's own agent "owner".
  - `QueuedMessages` adds "Steer now".
  - All strings are localized in the VSIX l10n bundles (5 locales) and the web `brain.timeline` catalog.
- **The native `@builderforce` participant** runs its children in the same host (`BrainRunHost.childControls`). It is not wakeable; its child reports wait in its inbox for its next turn.
- **Deleted:**
  - `clients/vscode/src/subagentRun.ts` (the second loop) and `childWriteGate.ts`, because a child's writes now go through its own run's confirm gate;
  - `subagentStepBudget`, `SUBAGENT_WRITE_MAX_STEPS`, `subagentReportMetadata` and `SUBAGENT_REPORT_META_KEY`.

  The cloud keeps `runSubagent`, bounded by `SUBAGENT_MAX_STEPS` because a child runs inside one durable alarm tick.
- `brainRunHost.ts` was split: its wire protocol moved to `brainRunHostProtocol.ts`.
- Tests:
  - `runLineage.test.ts`, `runSteering.test.ts`, and `brainRunStore.test.ts` (steering, re-open, lineage);
  - `planHandoff.test.ts` (background);
  - `childRuns.test.ts`, `subagentTool.test.ts`, `subagentFanOutTool.test.ts`;
  - `brainRunHost.test.ts` (end-to-end spawn → child posts as itself → idle owner woken with the report);
  - `chatChildren.test.ts`, and `subagent.test.ts` (live-owner prompt).

## ✅ RESOLVED 2026-10-11 — "Use sub-agents" starts sub-agents, and a coding slice always has a Developer (agent-tools 2026.10.4 · brain-embedded 2026.10.14 · VSIX 2026.10.17 · api 2026.10.28)

Two VS Code chats asked for sub-agents and got none:
- **Chat #133**, "complete the remaining tickets using subagents". MiniMax-M1 had `spawn_agents` advertised and named it in its own reasoning. It still called `ask_user` ("execution is disabled… no developer agents"). Both reasons were about the cloud: every ticket's `autoRun` verdict read "No run… nothing runs", and the Work directive worded `as_agent` as a requirement.
- **Chat #134.** `spawn_agents` handed a code slice to "John Coder" (title "Coder Agent", no role keys). `delegationRoleRefusal` refused the whole fan-out. The workspace had no Developer to retry with, and the brain had no way to create one.

Fixes:
- **The loop enforces an explicit request** (`brain-embedded/src/delegationRequest.ts`, the twin of `selfReviewShip`). The gate fires when the user asked for sub-agents, the host can spawn, and the run has made no spawn attempt. Then:
  - an `ask_user` call is answered with the local-delegation contract instead of settling as the reply;
  - a prose ending is re-prompted once.

  Both are logged as `loop.recover_undelegated_request`.
- **No refusal on a role mismatch** (`staffDelegation` in agent-tools; `delegationRoleRefusal` deleted). A teammate without the slice's delivery role does not take the slice; it runs as an on-demand Developer or QA Tester persona. It is never attributed to that teammate, and the result carries a `staffing` note. The editor's `resolveChildPersona` and the cloud's `cloudSubagent` read the same rule. An unknown name is still refused.
- **The brain can hire a Developer.** `cloud_agents.create` and `cloud_agents.update` take `roleKeys`, limited to catalog keys by `parseDeliveryRoleKeys`. Both bump a tenant agent-roster version, and `listTenantAgentsForRole` is keyed on that version, so a newly hired Developer is found on the next read. The Work directive names `builtin_cloud_agents_create (roleKeys:["developer"])`.
- **"Coder" is a developer.** `agentMatchesRole` adds whole-word synonyms for `developer` (coder, programmer, software engineer, …) and `qa-tester` (qa, tester, quality assurance).
- **Truthful copy:**
  - The `execution_disabled` autoRun detail now says it blocks cloud runs only and that local sub-agents are not affected.
  - `spawn_agent` no longer says "do NOT delegate the actual writing".
  - `as_agent` is documented as optional.
- Tests: `delegationRequest.test.ts`, `brainRunStore.test.ts` (ask redirected, prose re-prompted, no-request case untouched), `chatMode.test.ts`, `modelRoles.test.ts`, `roleMatch.test.ts`, `cloudSubagent.test.ts`, `subagentTool.test.ts`.

## ✅ RESOLVED 2026-10-11 — Synapse and Spawn ship from their own repositories (api 2026.10.26 · frontend 2026.10.40)

`desktop/` held two apps with their own release cadence, signing and toolchain (Rust/Tauri) inside a TypeScript monorepo, and Spawn's download use case had to filter `spawn-v*` tags out of a repository that also carried Synapse's `desktop-v*` ones. Both moved out with their history:

- **Synapse → [SeanHogg/builderforce-inference](https://github.com/SeanHogg/builderforce-inference)** (`app/` + crates `bf-index`, `bf-context`, `bf-memory`, `bf-mcp`, `bf-local`, `bf-teach`, `bf-vault`, `bf-cloud`). It is also where the native Rust inference engine that replaces Ollama is being built (see the "Local LLM execution" row in ROADMAP.md).
- **Spawn → [SeanHogg/builderforce-spawn](https://github.com/SeanHogg/builderforce-spawn)** (`spawn/` + `bf-roblox`). Its account crate `bf-cloud` is a git dependency on builderforce-inference `main`, so there is one copy of it.
- **CI moved with them.** `desktop-release.yml` and `spawn-release.yml` became each repo's `release.yml`, without the `desktop/` prefix, triggered by `v*` tags (one app per repo). The `windows-signing` / `macos-signing` composite actions live in builderforce-inference; Spawn uses them as `SeanHogg/builderforce-inference/.github/actions/<name>@main`. `bf-cloud` is tested in builderforce-inference.
- **Releases carried over.** `spawn-v2026.10.2` was copied to builderforce-spawn as `v2026.10.2` with all five installers, so the download buttons never went empty. Synapse had no published `desktop-v*` release to copy; its first release is the first `v*` tag in builderforce-inference.
- **Every link re-pointed.** `DesktopAppDownload` (`DESKTOP_RELEASES_URL`) and the Synapse download links in four blog posts × five locales → builderforce-inference `releases/latest`; `spawnDownloads.ts` reads `SeanHogg/builderforce-spawn` with tag prefix `v` (test updated: a non-version tag such as `nightly` is skipped); `spawnLinks.ts` `SPAWN_DOWNLOAD_URL` → builderforce-spawn `releases/latest`. Synapse's own in-app update check (`update.rs`) now reads builderforce-inference `v*` releases.
- **Removed here:** `desktop/`, `.github/workflows/{desktop,spawn}-release.yml`, `.github/actions/{windows,macos}-signing`; the `desktop/*` entries in `.builderforce/context.yaml`, `project-map.md` and `architecture.md`.
- Still open, tracked in ROADMAP.md: the signing secrets must be added to both new repositories by the owner.

## ✅ RESOLVED 2026-10-11 — One chat, one progress figure: the ticket rail, the conversation picker and the Sessions tree agree (agent-loop 2026.10.3 · brain-ui 2026.10.6 · VSIX 2026.10.15 · api 2026.10.25)

In VS Code chat #133, the same chat showed three different completion figures at once: the Sessions tree read 23%, the ticket rail 60% · 2/10, and the conversation picker 18%. There were three causes:

- **Snapshots of different ages.** The rail refetches its tickets on every MCP write and on chat activity. The picker and the tree show the chat-list snapshot (`GET /api/brain/chats` → `ticketProgressPct`), which was refetched only on other events. Linking or unlinking a ticket, running one, or a ticket moving under a run updated the rail and left the other two behind.
- **Two copies of one formula.** The server's `rollupChatTicketHealth` and brain-ui's `aggregateTicketHealth` were kept in sync by a "keep them in lockstep" comment.
- **Floor versus round.** The tree floored the value; the picker and the rail rounded it.

Fixes:
- **ONE module**, `packages/agent-loop/src/chatTicketHealth.ts`, provides `rollupChatTicketHealth`, `displayChatProgressPct` (round, clamp 0–100, null when there is nothing to show) and `chatProgressIsStale`.
  - The api's `ChatTicketService` imports the rollup from here.
  - The rail (`ChatTicketsPanel`) uses the same rollup. brain-ui's copy was deleted and its tests moved over.
  - `chatSwitcherLabel` and the tree's `sessionsTree` now share `displayChatProgressPct`. `clampTicketProgressPct` was removed.
- **The rail resyncs the others.** `useChatProgressSync` (brain-ui) compares each fresh ticket list with this chat's row in the host's chat list. When they disagree, it calls the panel's `onChanged`, so the host refetches the list. In the VSIX, `reloadChats` then posts `chats.changed`, which repaints the tree. It reports once per distinct ticket state, so a server that briefly still reads the old value cannot start a refetch loop. A host whose list carries no ticket summary (e.g. the canvas dock) is never reported as stale.
- **Dead field removed:** `ChatOptionVM.progressPct` claimed the API emitted it. Nothing emitted it and nothing read it.
- Tests: `chatTicketHealth.test.ts` (the rollup, display rounding, staleness), `useChatProgressSync.test.tsx`, `ticketProgressDisplay.test.ts` (pins the shared rule), `ceremonyTicketHealth.test.ts`.

## ✅ RESOLVED 2026-10-11 — Questions asked in prose become the clickable card, and local delegation runs by role instead of dispatching to the cloud (agent-loop 2026.10.2 · agent-tools 2026.10.2 · brain-embedded 2026.10.12 · VSIX 2026.10.14 · api 2026.10.24)

VS Code chat #133 had two problems:
- MiniMax-M1 ended the run on a bolded "Options:" list and "What would you like to do?" instead of calling `ask_user`, so the reader got text with nothing to click.
- The run tried to delegate with `chats.dispatch_agent`, a remote cloud run. The workspace's execution kill switch refused it (402 `execution_disabled`), and nothing ran, even though the editor can spawn sub-agents locally.

- **`liftProseAskUser`** (`packages/agent-loop/src/index.ts`, beside the rest of the ask-user contract). It turns a settled reply that ends on a prose question with 2–6 listed options into the canonical ```ask-user block, and keeps the lead-in prose above it. Both conversational loops apply it to their final reply: `brainRunStore` when `ask_user` is advertised, and `BrainService`'s addressed reply. The match is deliberately narrow:
  - the question is the reply's last line, or it introduces the list;
  - the wording cues a choice ("which", "options", "what would you like to do"), not a yes/no "want me to proceed?";
  - one list kind per block, so a bold-led paragraph such as "**Blocker:** …" never joins the options;
  - a bare `**Options:**` header is stripped as a header, not offered as an option.
- **Local delegation by role.** The Work directive (`brain-embedded/src/chatMode.ts`) now checks whether the surface carries `spawn_agent` or `spawn_agents`. If it does, a staffed chat delegates to them HERE: `spawn_agents` per ticket, or `spawn_agent`, with `as_agent` set to the teammate whose role fits. The directive says that a local child needs no ticket assignment and no `dispatch_agent`, and that the kill switch stops cloud runs only. `dispatch_agent` remains for work the user asks to run in the cloud, and the web Brain, which has no sub-agent tools, still dispatches.
- **Developer vs QA filter.** `delegationRoleRefusal` (`packages/agent-tools/src/modelRoles.ts`) maps a code slice to the `developer` role and a verify slice to `qa-tester`. Explore, plan, chat and utility slices are open to any teammate. The editor's `resolveChildPersona` (used by both spawn tools) and the cloud's `cloudSubagent` run the same check. An agent without the needed role is refused before any model turn, and the refusal names the role it needs.
- **Role keys from the server.** `resolveAgentPersonaBrief` now returns `roleKeys` (`agentRoleKeys`: explicit role keys ∪ built-in kind ∪ title/skill match). `cloud_agents.persona_brief` takes an optional `role`. For an agent without that role it returns `{ ok: false, capable: [...] }`, read-through cached by `listTenantAgentsForRole`.
- Tests: `askUser.test.ts` (the #133 reply, a question that introduces a list, a yes/no question kept as prose, existing blocks untouched), `modelRoles.test.ts`, `chatMode.test.ts` (local versus cloud ordering), `subagentTool.test.ts`, `cloudSubagent.test.ts`.

## ✅ RESOLVED 2026-10-11 — Planning ends in tasks: the hand-off to the coding model files tickets, and parallel coders report back to the chat (agent-tools 2026.10.1 · agent-loop 2026.10.1 · brain-embedded 2026.10.10 · VSIX 2026.10.12 · api 2026.10.23 · frontend 2026.10.39)

VS Code chat #133: the planning model never produced a plan. It drifted into its first edit, the run discarded that edit and re-asked the coder inline, and nothing was filed or run in parallel. Delegated children reported only to their parent, never to the chat.

- **`hand_off` ends the analysis** (`brain-embedded/src/planHandoff.ts`). The planner calls it once with `{ summary, tasks: [{ title, brief, paths, acceptance }] }`; it is offered only while the run is planning. The run then does four things:
  - files one ticket per task (`builtin_tasks_create`) and links each one to the chat (`autoLinkCreatedItem`);
  - posts the plan into the chat;
  - flips the run to the `code` role;
  - hands the tasks over. Where the host can fan out and the tasks own disjoint paths (`canRunInParallel`, the same overlap rule `spawn_agents` enforces), each task becomes a coding child, in batches of 4. Otherwise the coder gets the tasks to implement in order.

  The old first-edit re-ask stays as the fallback for a planner that edits without handing off.
- **The editor's fan-out is live, and the half-finished sub-agent refactor is finished.** `spawn_agents` had never been registered: `be7d8fc20` moved `spawn_agent` onto getters, one of which, `getSignal`, returned `undefined`, so Stop never reached a child. `df80b03a7` then added `subagentRun.ts` and `subagentFanOutTool.ts` but wired neither. Now:
  - both tools run through `runLocalChild` on ONE `SubagentRunBinding`, built per run in `brainRunHost.ts`, which carries the write gate, Stop (`runAbortSignal`), the model route, the tool bookkeeping and the chat report;
  - `spawn_agent` now sends its `role` to the model and reports `changedFiles`;
  - the native participant passes the same binding.
- **Every child reports into the chat as it finishes**, failures included, with its ticket. The text is `subagentReportMessage` (agent-loop), and the message is tagged mid-turn so Evermind does not learn it as an answer.
  - Editor: `onChildReport` persists the report and splices it into the live view with the new `appendRunMessage`.
  - Cloud: `subagentChatReport` posts through the verified `postExecutionUpdate`, on both the durable surface and the image `spawn` op.
- **The cloud can fan out.** `spawn_agents` now lives in `@builderforce/agent-tools` (schema, `parseWorkstreams`, `workstreamScopeError`), and the editor tool reuses it. The durable cloud loop starts every child at once through `orchestrate`:
  - a scoped child loses `shell`, `process` and `git.write` (`TREE_WIDE_CAPABILITIES`);
  - a write outside its paths is refused;
  - every child's commit queues on one chain (`guardedRepoWrite`), so concurrent git-API commits cannot race the branch ref.

  It needs its own capability, `orchestrate.fanout`, which only the durable surface holds, so the images, which have no relay arm for it, are never offered it. Their fan-out is a Gap Register entry, blocked on an image build and deploy.
- **Path ownership has one home.** `workstreamScope.ts` moved from the VSIX to agent-tools; the planner, the editor and the cloud all import it.
- Tests:
  - `planHandoff.test.ts`: parsing, overlap, the plan message, batching, the fan-out-refused fallback, ticketless hand-off, and the report text and tag.
  - Two run-store tests: tickets, linking, a parallel fan-out on `code` and `hand_off` dropping out of the menu; and the inline order for overlapping tasks.
  - `subagent-tools.test.ts`: the shared parser, the scope error, and concurrent cloud children.
  - Three cloud tests: scope plus withheld shell, serialized commits, and per-child reports.
  - A VSIX fan-out test that each child reports to the chat.

## ✅ RESOLVED 2026-10-11 — An answered question stops pinning itself over the chat, and has a close button (brain-ui 2026.10.5 · VSIX 2026.10.11 · frontend 2026.10.38)

VS Code chat #133: the agent asked "Which PRD do you want to finish?" and the user picked an option. The "Answer needed" banner stayed pinned above the composer, showing "Answered: PRD 33a" while the run carried on underneath it.

- **Cause 1: an answer could be dropped.** Both hosts answered a question with a bare `conv.send`, which returns `false` without a word while the chat is running, including while the host is still settling a run that has ended. The card marked itself "Answered", but no user turn was posted, so `selectPendingAskUser` still found the question open.
  - Fix (VSIX): `sendOrQueue` in `VsCodeChatSurface.tsx` is the one path for a typed turn, an answer and "Send again". A busy chat queues the turn, and the queue sends it when the run finishes.
  - Fix (web): `useBrainTimelineBindings` takes the composer's `useQueuedTurns().submit`, so answers and replays queue in the same way.
- **Cause 2: the banner waited on the transcript.** It disappeared only once a user turn came back after the question, which never happened for a dropped or queued answer.
  - Fix: `<PendingQuestionBanner>` closes itself when answered, and has a × button (accessible name "Dismiss": `app.dismiss` in the VSIX, `common.dismiss` on the web). Both hosts key the banner by the question's message id, so a new question opens a new banner. The card in the transcript stays.
- **CI fix in the same pass:** `cross-provider-smoke.test.ts` (agent-runtime) failed two tests because its stand-in cloud provider still copied edit fields by hand. The real providers now spread `editFacts`, which adds `excerpt` and `region`. The stand-in now spreads `editFacts` too.
- Tests: `packages/brain-ui/src/askUser.test.tsx` checks that the banner closes when answered and closes on × without answering.

## ✅ RESOLVED 2026-10-11 — The coding model picks up the plan instead of re-doing the analysis (brain-embedded 2026.10.9 · VSIX 2026.10.10)

VS Code chat #133 (client 2026.10.9): MiniMax-M1 planned for 22 turns at one call per turn and reached its first edit. The re-ask then went to Grok 4.6, which started the investigation over at five and six reads a turn, re-reading files the planner had already read.

- **Cause 1 — a bare hand-off.** The analysis→code hand-off threw the planner's edit away and re-asked the same turn of the coder "from the same transcript", on the theory that a coder handed the same transcript makes the same move. It doesn't: the transcript holds the evidence, but says neither that the analysis is finished nor what it concluded.
  - Fix: `coderHandoffBrief` (`roleHandoff.ts`) rides that one re-ask as a user-role message and is never persisted. It carries the planner's findings, the exact tool call(s) it was about to make (args capped at 2,000 chars each, 6,000 overall), and the instruction to make the change rather than re-plan.
- **Cause 2 — every follow-up re-plans.** The phase reset to `plan` at the start of every run, so each follow-up in the same chat ("Start S0", "continue") ran the analysis again on the planner and then handed off again.
  - Fix: `codePhaseReached` on the run cell is not reset per run. Once a chat has handed off, its follow-up runs start on the coder.
- Tests: two new in `brainRunStore.test.ts`. One checks the brief names the planned edit and stays out of the transcript; the other checks a follow-up run starts on `code`. 138/138 with `readCoverage`/`runActivity`. Typechecks are clean in brain-embedded and vscode (host + webview). VSIX 2026.10.10 is packaged and installed.

## ✅ RESOLVED 2026-10-11 — The agent reads one key of a 33,000-line catalog instead of paging it (agent-tools · brain-embedded 2026.10.8 · VSIX 2026.10.9 · api 2026.10.22 · agent-runtime 2026.10.2)

From the second VS Code chat #133 run, diagnosed as "NO PROGRESS": 41% of targeted calls revisited ground already covered, worst `en.json` ×16 (33,278 lines) and `adminApi.ts` ×12. The agent knew exactly which keys it wanted (`admin.visitorFlow`, `admin.sessions`), but `read_file` only pages by line window, so it guessed offsets.

- `read_file` accepts `key`, a JSON dot path (`readJsonKey`, `packages/agent-tools/src/jsonKeyRead.ts`). It returns that subtree pretty-printed.
  - When the subtree is over 12,000 characters, it returns the child keys instead, so the next read can name one.
  - A missing segment lists the keys that do exist at that level.
  - A file the provider truncated says so instead of failing to parse.
  - The tool description points the model at `key` for catalogs and configs.
- The read guard treats a key read as its own question (`QUESTION_KEYS` gains `key`), and keeps it out of line-window coverage in both directions, so a key read is never stubbed as "lines already returned", and vice versa.
- Tests: `jsonKeyRead.test.ts` (5), `readCoverage.test.ts` (+1), with the agent-tools and brain-embedded suites listed in the verify brief (37 + 136 passing). Typechecks are clean in agent-tools, brain-embedded, vscode (host + webview), api and agent-runtime. VSIX 2026.10.9 is packaged and installed.
- Note: both #133 runs were on client 2026.10.6, so none of today's agent fixes were live for them. The VS Code window has to be reloaded to pick up the installed build.

## ✅ RESOLVED 2026-10-11 — Agent replies no longer vanish into the reasoning, and an edit shows its result (agent-loop · agent-tools · brain-embedded 2026.10.7 · VSIX 2026.10.8 · api 2026.10.21 · agent-runtime 2026.10.1)

Taken from the VS Code chat #133 diagnostics: 77 turns, 314 tool calls, one file read 13× around 7 edits, and most turns rendered as "reasoning only — no reply text".

- **Replies swallowed into reasoning.** MiniMax-M1 quoted a spec inside its `<think>` block using a ``` fence whose closing fence was indented. `findCodeRegions` ran that unclosed fence to the end of the text, so every later `</think>` read as code. Each turn's reply then stayed in the reasoning, with a literal `</think>` showing in it, and learned memories repeated "Let me check X:".
  - Fix: an unclosed fence that opens inside a thought no longer hides that thought's closing tag, and the fence ends there.
  - Inline code now follows CommonMark: it can cross a line break but never a blank line, so one stray backtick can't hide tags paragraphs away.
  - Code-fence examples (all of `reasoningTags.test.ts`) are unchanged.
- **Edits re-read to check them.** A successful `edit_file` returned only `{ ok, replaced }`.
  - The shared `applyStringEdit` now returns `excerpt`: the edited lines plus 2 lines of context, numbered, capped at 40. `edit_file` returns it together with `region`, and its description tells the model not to re-read.
- **Unwired hint.** The "not found" `nearest` hint (the closest line and its neighbours) was computed and then dropped by the VS Code and on-prem providers and by `edit_file` itself, so it reached no model. `editFacts()` is now the one mapping all three providers spread.
- Tests: `reasoning.test.ts` (2 new; 81/81 together with `reasoningTags.test.ts`), `edit.test.ts` (4 new), plus `registry`/`toolAliases`, `brainRunStore` (51/51) and the api runtime tests. Typechecks are clean in agent-tools, agent-loop, brain-embedded, vscode (host + webview), agent-runtime and api. VSIX 2026.10.8 is packaged and installed.
- Seen in the same run, needing operator action rather than code: the chat's connected Anthropic account had expired and its refresh failed, so the run fell back to the shared pool (MiniMax-M1, then Grok 4.6). Reconnect it under Settings ▸ API Keys.

## ✅ RESOLVED 2026-10-11 — The IDE agent stops teaching its Evermind its own play-by-play, and checks imports and verify commands before it guesses (brain-embedded 2026.10.6 · VSIX 2026.10.7)

The project #30 Evermind diagnostics showed held-out loss REGRESSED 2.72 → 3.24, with 9 of the last 24 learned memories reading as mid-turn narration. One IDE run (2026-09-27, ticket #2754) minted six head versions in ten minutes, each learned from text like "Let me check if X is imported:".

- **Root cause (structural):** `brainRunStore` saves every turn's pre-tool-call text as its own durable `assistant` message, so the user keeps what streamed in. That message went through the same persist path as the final answer, and `learnFromPersistedTurns` trained on every one of them.
  - Fix: `persistMidTurnText` is now the one writer for both mid-turn sites (pre-tool-call narration, and the text kept on a stall re-prompt). It tags the row `midTurn: true` alongside its provenance, using `MID_TURN_META_KEY` from `@builderforce/agent-loop` (`turnPhase.ts`).
  - The learn gate drops tagged rows before it judges the batch. A narration-only batch reads as `too-short`, which no surface renders.
  - The text-based `stripRunNarration` (same day, separate commit a4257b943) remains the second line of defence.
- **Agent behaviour:** the learned runs showed two avoidable failures: running a `.ts` file with `node` to "test" it, and importing `fetch` from a module that never exported it, which cost four turns to undo. The IDE persona now covers both:
  - Verify commands come from the changed package's own `package.json` scripts. TypeScript is type-checked, never executed.
  - Before importing a name, confirm the module exports it (`file_outline` / `find_symbol`). Never import a runtime global.
- Tests: `packages/agent-loop/src/turnPhase.test.ts` and `brain-embedded/src/brainRunStore.test.ts` ("mid-turn text is marked…"). brain-embedded and VS Code typechecks are clean. VSIX 2026.10.7 is packaged and installed.
- Still on the operator: the head stays quarantined (v813 coherence probe) and no teacher is pinned. Readiness → re-enable, or pinning a frontier teacher, is an operator action in the Evermind panel.

## ✅ RESOLVED 2026-10-10 — Public marketplace listings are in the sitemap

- **`/marketplace/listing/<slug>` pages were never submitted to search engines.** `listPublicListingSlugs()` in `frontend/src/lib/marketplaceSeo.ts` reads `/api/listings` (four pages of 48), de-dupes the slugs, and returns `[]` when the API can't be reached. `sitemap.ts` emits each slug as weekly, priority 0.6. Tests are in `marketplaceSeo.test.ts`. Shipped in `a31eea7b1`.

## ✅ RESOLVED 2026-10-10 — Make, Run and Reach: seven slices of the arc closed in one pass (frontend 2026.10.37 · api 2026.10.20)

**Make — delivery and the board**
- **Spec tickets no longer bounce back to implementation.** `specShapedTicket.ts` reads the title as well as `taskType`/`actionType`; `expectsCodeDeliverable(taskType, actionType, title?)` is the one predicate `decideTicketReadiness` and `autonomyWiringAudit` share.
- **A cross-board move re-points `tasks.segment_id` in the same write.** `moveTask` sets it in the update itself, and the separate `repointSegment` is gone.
- **`review_ticket_branches` is deduped like any read** and invalidated by `REPO_STATE_READ_TOOLS` when a push, commit or branch tool changes repo state, so a cached review cannot outlive the push.
- **0-byte scaffold writes, widget host GET, room speech bubble** were already fixed on main (`@builderforce/ide-file-contract`, `validateScaffoldNotEmptied`, 422 from `writeWorkspaceFile`, the bubble's anchor jump). This pass adds what was missing: route tests (`ideRoutes.files.test.ts`, `canvasWidgetHostRoutes.test.ts`, `PeerSpeechBubble.test.tsx`).
- **A finished meeting's minutes reach the canvas.** Concluding a ceremony writes minutes the way `POST /meetings/:id/end` always did (`concludeCeremonyMinutes`). `ceremonyMinutesToCanvas` puts them on the stand-up card and places each action item as a task object (`rewriteBoardGraph`, `ceremonyMinutesBoard`). Manual sync is `POST /api/agile/ceremonies/sessions/:id/minutes/canvas`. `meetingMinutes.ts` moved to `domain/meetings/`.
- **Tap-to-assign on touch and keyboard.** `CeremonyDropZone` (`pickToPlace.tsx`) makes tap, keyboard and drag one path, so a ceremony can be staffed from a phone.

**Run**
- **Finance ▸ Reports.** `ReportSchedulesPanel`, `ReportScheduleForm` and `BoardPackFramePicker` (board first, then frame) create and manage report schedules and board packs. `ValidationEngagementsCard` shows the experiments behind the numbers. Gated by `reports.manageSchedules`. Release note 1205, blog `schedule-your-board-pack-from-finance`.
- **FO-B4 — a job posting is published to connected job boards.**
  - `job_posting_distributions` (1206) holds one row per board. A row reads posted only with the board's own id (CHECK-enforced); otherwise it holds the board's reason.
  - Connector manifests gain a `response` mapping, read by one `mapConnectorResponse`.
  - Code: `distributePosting` + `postingDistributionStore`, `GET/POST /api/ats/postings/:id/distributions`, the `canvas_distribute_job_posting` tool and `CanvasJobDistribution` on the card. Sources attribute applicants to each board.
  - Release note 1207, blog `publish-a-job-posting-to-your-job-boards`.

**Reach**
- **Copying a listing that needs a workspace** asks for one (`SessionGate action="takeCopy"`) instead of failing at the buy control.
- **Marketplace `jobs` category.** It comes from `marketplaceFamilies.ts`, and `marketplaceSections.tsx` loads every section lazily through one typed `SearchSectionProps` contract.
- **Guest fixtures for `/api/pmo/*`, `/api/insights/funnel` and marketplace lists.** These load lazily (`LAZY_FIXTURE_MODULES`, `resolveGuestReadLoaded`), so they stay out of the root closure and a signed-in request never fetches them.
- **The marketing header's dropdowns are driven by JavaScript**, not CSS hover: `aria-controls`, `useDismissOnOutsidePress`, `[data-open]`.
- **YouTube posting from a social campaign.**
  - The upload is resumable and runs in the background (`youtubeResumableUpload`, `youtubeUploadJobs`, the `youtube-upload` cron sweep, `POST /uploads/:id/advance`). It is settled back onto the campaign post by `youtubeUploadSettlement`.
  - YouTube moves to `publishMode: 'media'` / `publishTransport: 'upload'`.
  - Release note 1208, blog `post-your-launch-video-to-youtube-from-a-campaign`.

**Fixed at integration:** the slices had picked overlapping migration numbers, renumbered to 1205–1208. The YouTube and report-schedule release notes also shared the row id `…001205`, and `ON CONFLICT DO NOTHING` would have silently dropped the YouTube note; each id now matches its migration. Seven blog OG cards missing from main were generated, and the methodology card was refreshed for the five-stage arc.

**Left open (in the roadmap):** follow-up cards that someone deletes come back on the next sync (no tombstone). LinkedIn gets no `company_id`. Greenhouse, Indeed and LinkedIn give no public URL. Attribution matches exactly and no applicants are imported. There is no Workable connector. A report schedule's report and frame cannot be edited. YouTube processing status is not polled. `autonomyWiringAudit` has no test.

## ✅ RESOLVED 2026-10-10 — A Studio app built under the old starter finally shows, and "continue" has the steps to finish (frontend 2026.10.36)

**Was (session `local-148925cf`, ui 2026.10.35):** the Brain wrote an 18-file app (`App.jsx` with routes, pages, layout) and then made it responsive, yet the preview still read "Hello World! — Edit src/main.jsx to get started". Saying "continue" re-read eight files and answered "I couldn't prepare any canvas changes from that request."

- **The retired starter entry is now repaired.** The 2026-10-09 scaffold fix (`main.jsx` mounts `./App`) only reached NEW projects. A project seeded before it kept the old entry, which declared its own inline `App`. No healer touched that file because it was neither empty nor corrupt. `@builderforce/ide-templates` now records `RETIRED_SCAFFOLD_CONTENT` and `isRetiredScaffold` (byte-identical after line-ending/whitespace normalisation, so an edited entry is never replaced). `repairScaffold` restores such a file with reason `retired`. Run mounts and persists the repair (`useWorkspaceRun`, log line `scaffoldRestoredRetired`, five catalogs).
- **Reading an app counts as building one.** The runner gave the 16-step code budget only after the first workspace WRITE, so a continuation that re-reads the app before editing (prior turns' tool results are not replayed) ran out at the 8 research steps. Any build tool (`CANVAS_BUILD_TOOLS`) now widens the budget and the output ceiling. `buildTurn` still means "wrote to the workspace" for the tail and the build-not-authored recovery.
- **An honest stop.** A workspace turn that hits the cap before changing anything now says so (`notice.stepsExhaustedUnchanged`, five catalogs) rather than "no answer", which blamed the request.

## ✅ RESOLVED 2026-10-10 — Synapse closes its gap list: local models, a compatible endpoint, MCP connectors, approvals from the phone, a starter model, Linux sign-in verified — and the marketing says so (desktop 2026.10.4 · api · frontend)

The roadmap's Synapse section (G6, G7, G8, G11, G12, Phase 2, the Linux sign-in store) is closed. Product calls made with the operator's "close out all the gaps": **manage Ollama, do not bundle llama.cpp** (Ollama already owns GPU detection, quantized weights and serving on every OS; bundling meant per-OS GPU builds); **the phone reaches Synapse through the person's own account, never a tunnel**; **the starter model is a workspace Evermind the person can already see**, fetched on demand, not bundled; **media generation stays in the cloud** (the canvas already generates image/video through the gateway; it is outside the private-knowledge goal).

- **G8 — MCP host + one-click connectors.** New crate `desktop/crates/bf-mcp`: `client` is the stdio MCP client extracted from `bf-memory` (which is now a thin wrapper — one client, two users), adding `tools/list` with paging and `readOnlyHint`; `catalog` is the one-click list as DATA (Filesystem, GitHub, Slack, Brave Search, Playwright, Context7, Sequential Thinking); `host` keeps `connectors.json` (no secrets — tokens go to the OS credential store under `connector:<id>:<VAR>`), starts each enabled server on first use and flattens tools to `mcp_<connector>_<tool>`. The Brain's tools now come from `cloud/brain_tools.rs` (`Toolbox` = platform catalog + hosted tools; a hosted tool needs Approve unless it declares read-only). Window: Settings → Connectors (`views/connectors.js`).
- **G6 / Phase 2 — local runtime, model hub, hardware-aware quantization.** New crate `desktop/crates/bf-local`: `ollama` (detect via `OLLAMA_HOST`, list, pull with streamed progress, delete), `hub` (models as DATA; per variant the most faithful quant — F16 → Q8_0 → Q4_K_M — whose estimated footprint fits 60 % of RAM, plus one recommended model), `chat` (a Brain turn on a local model through Ollama's OpenAI endpoint, read by the same `bf_cloud::llm::read_turn` the gateway's answers use). The Brain answers through the gateway by default or through an installed model (`local.json` `chatModel`). Window: Settings → Local models (`views/models.js`).
- **G7 — OpenAI/Anthropic-compatible local endpoint.** `bf_local::api`: a guarded pass-through on `127.0.0.1:11435` (configurable) to the runtime's `/v1/chat/completions`, `/v1/models` and `/v1/messages` (Claude Code's format), streamed chunk-by-chunk with a flush per read; key in the credential store (`local-api:key`, rotatable), sent as Bearer or `x-api-key`; browser `Origin` refused; only `/v1/*` forwarded, never the runtime's management API.
- **G11 — phone access.** A Self-Directed Agent's approval also goes to the person's account when they switch on **Approve steps from your phone** (Runs page, opt-in, `phone_approvals`): `agents/runs.rs` gained an `ApprovalRelay` the run polls every 3 s, raced against the window's Approve (first answer wins, the other side is closed); `cloud/remote_approval.rs` implements it over `POST/GET/PATCH /api/approvals` with action type `synapse.step`. API: `domain/approval/selfOwned.ts` makes such rows **requester-owned** — raised only by a signed-in person (requestedBy forced to the caller), never auto-approved, invisible to and undecidable by anyone else (list, get, PATCH, the `approvals.get` platform tool), never decidable by a tool call (`approvals.decide`), left out of the dashboard's team count and the expiry Slack escalation, and announced by email to the requester alone (`notifyRequesterOfOwnApproval`). The web queue at `/workforce?tab=approvals` is the phone surface.
- **G12 — starter private model.** Evermind → "Use as my model": `cloud/starter_model.rs` downloads a workspace Evermind's `model.evermind` (+ `tokenizer.json` beside it, where memory-mcp looks) through the new `Session::api_bytes`, makes it the private model and restarts the store on it.
- **Linux sign-in store verified.** The "sudo password" blocker was not one: `wsl -u root` installs the packages. In WSL Ubuntu, `cargo test -p bf-vault -p bf-cloud -p bf-mcp -p bf-local` passes, and `round_trips_through_the_os_store` passes against GNOME Keyring under `dbus-run-session`.
- **Fixed in passing:** approval notification emails interpolated the client-supplied description unescaped (HTML injection into managers' mail) — now `escapeHtml`.
- **Marketing.** `DesktopAppDownload` rewritten as the self-styled Synapse section (theme tokens only, fluid grid) with the `desktopApp` catalog describing the whole app, now on `/evermind`, `/features` and `/agents`; new FAQ entries on both pages; post `your-private-evermind-on-your-machine` (5 locales, catalog titles) in the evermind/agents related lists; release note migration `1204_release_note_synapse_private_evermind.sql`.

Verified (Sonnet): `cargo build -p synapse`, `cargo test` for bf-mcp/bf-local/bf-memory/bf-cloud/synapse and clippy `-D warnings` on Windows; the Linux runs above; api type-check, 37 guards, targeted vitest (selfOwned, expiry sweep, release notes); frontend typecheck, i18n key check, catalog/blog tests. Still open in ROADMAP: the live runs with a real account and Ollama, the native apps' approvals screen, and recording/replay on macOS/Linux.

## ✅ RESOLVED 2026-10-10 — Live container preview: a run starts the dev server, the QR encodes the live URL, and the spend is budgeted (api 2026.10.19)

**Was (ROADMAP, Replit-parity phase 2):** (1) nothing started a dev server on `PREVIEW_PORT`, `MobileDevicePanel` encoded only the published site, and there was no Vite/Metro host tuning. (2) `AgentContainerDO` was capped at 5 instances with one 20m `sleepAfter`; previews had no budget, no idle eviction and no plan gate.

**Already in the tree (verified this pass):** `previewDevServer.ts` (the step, health probe, mint), `previewSessions.ts` with migration 0948 (lease, 15-instance preview budget out of `max_instances = 25`, 2 per tenant, 3-minute idle eviction on the frequent cron that only reclaims an instance whose run has finished), `container/server.mjs` `startPreviewDevServer`, the `livePreview` plan flag (402 at both mint routes), and `MobileDevicePanel` minting by project with a Live/Published badge.

**Defects fixed in that slice:**
- **Secrets never reached the dev server.** The container prefers the `start` op's step, which was built without project secrets. `start` now builds through `previewStepForRun`, the one path the launcher also uses.
- **The plan gate applied only at the mint.** A free tenant's container run could still start a dev server and take budget. `previewStepForRun` now checks `livePreview` (`tenantHasFeature`), so neither the launcher nor `start` acquires an instance without it.
- **Dependencies were never installed.** `installCommand` was on the wire but never run, so a fresh clone's `npx vite` failed. The container now installs when `node_modules` is absent and reports a failed install as the preview's reason.
- **The wrong framework was started.** The Vite candidate's marker was the override we generate into every workspace, so a Next app with a `dev` script started Vite. Markers are now the project's own config filenames, any-of (`vite.config.*`, `next.config.{js,mjs,ts}`, `wrangler.{toml,jsonc,json}`).
- **The Metro override was dead.** It is now used by a bare React Native candidate (`react-native start --config …`).
- **A `.ts` Vite config never loaded.** The override imported the project config with a bare `import()`. It now uses Vite's own `loadConfigFromFile`.
- **Generated overrides could ride into the run's PR.** They are now added to the clone's `.git/info/exclude`.

**Verified (Sonnet):** API type-check (tsc + tsgo) clean. `node --check container/server.mjs` passes. `previewDevServer`, `cloudSurfaceCaps` and `containerPauseContract` tests pass, 44 of 44, including new cases: no generated-file markers, the Metro override wired, plan-gated null, and a project-less step.

**Still open:** live deploy and validation (ROADMAP, blocked on Containers-Paid credentials).

## ✅ RESOLVED 2026-10-10 — Every prompt in the app is the same composer: homepage, Studio home, the canvas/Studio session, media (frontend)

**Was:**
- **Homepage hero:** `ChatInput` plus a separate "Choose a starting point" tab hanging under the box (`PromptUseCasePicker`).
- **Studio home:** its own textarea, hint line and "Build it" button (`StudioPromptBox`).
- **Canvas composer:** its own Starting points trigger in the card's top row and its own next-step chips component.
- **Media generator:** a labelled textarea, labelled selects and a Generate button.
- **Studio session:** "Executing…" appeared twice (in the transcript and in a strip above the box), and "Entire canvas" showed on the App surface, because every turn selects the Brain card.

**Now:**
- **Starting points are `ChatInput`'s own** (`starters`, in `chat-input/useComposerStarters.tsx`): a `+` row opens `PromptUseCaseCatalog` inside the box. The `+` menu now renders whenever it has a row, not only when the host takes files.
- **Next-step chips are `ChatInput`'s own** (`suggestions`, in `ComposerSuggestions`): fixed chips above an empty box that seed it and never send it.
- **Retired:** `PromptUseCasePicker`'s tab and its popover variant; `CanvasPromptStarter`, `CanvasNextSteps` and `StudioPromptBox`; the `starter` slot of `CanvasComposer`; the dock's activity strip and the `strip` variant.
- **The canvas** feeds both options from `chrome/useCanvasComposerOffers.ts`: phase-led starters, and the surface's next steps or the phase's starters.
- **Every surface:** the hero, the Studio home and `MediaGenerateForm` (shape and length as compact selects in the tool row) all use `ChatInput`.
- **Scope chip:** shown only on surfaces that show the board.
- **Select to edit:**
  - A pick focuses the prompt.
  - It also reveals the prompt: it reopens a closed canvas prompt (`useCanvasPromptPlacement`) and unhides the workspace Brain, or switches to its pane on a phone.
  - A click on an element with no source anchor (a production build, or React 19 without `_debugSource`) shows "That element can't be traced to its source…" instead of doing nothing (`VISUAL_UNRESOLVED_MESSAGE`).
- **i18n:** `chatInput.startingPoints`, `chatInput.suggestionsLabel` and `ide.previewPick.unresolved` added in all five catalogs. `promptUseCases.tabLabel`, `studio.home.hint` and `creationCanvas.nextStepsLabel` retired.
- **Tests:** `ChatInput.offers.test.tsx`, `useCanvasComposerOffers.test.tsx` (the phase-led order and lead behaviour of the deleted starter test) and `previewPick.test.ts` added. Hero, canvas, picker, activity and workspace tests were updated.

## ✅ RESOLVED 2026-10-10 — The Android, iPhone and Mac apps are Builderforce apps: renamed, signed in to the cloud, chatting in the one-box composer, built by CI (android 2026.10.2 · ios · macos 2026.10.1)

**Was:** `apps/` was raw source from a half-finished OpenClaw→CoderClaw rename that had never compiled here. `Package.swift` paths did not match the folders, xcconfig variables were undefined, the icns, entitlements and Swabble paths were missing, and the gateway rejected the apps' `coderclaw-*` client ids. Chat went over the local gateway's session protocol, not the workspace's Brain chats, and nothing built the apps in CI. (Gap Register "Brand residuals", the native-app part.)

**Now:**
- **Rename, by the operator's call (2026-10-10).** Android `ai.builderforce.android`; Swift `BuilderforceKit` / `BuilderforceProtocol` / `BuilderforceChatUI`; macOS package and iOS project `Builderforce`. Also: bundle ids `ai.builderforce.*`, app group `group.ai.builderforce.shared` (now declared by the iOS app and share extension), the `builderforce://` scheme, `BUILDERFORCE_*` env vars, `~/.builderforce/builderforce.json`, and gateway client ids `builderforce-*`. The packaging, release, lint and docs scripts were repathed to match. `grep -ri claw apps/` is empty.
- **Cloud Brain chat**, the same as Synapse (`desktop/app/src-tauri/src/cloud/*`). Sign-in uses the device code (`DEVICE_CLIENTS` now names `android` / `ios` / `macos`). Chats go through `/api/brain/chats`, with `addressedTo` for agents. The Brain reply streams from `/llm/v1/chat/completions` with the delivery tool catalog, and tools that change something wait for the person's approval. Android: `cloud/*`. Swift: one shared client in `BuilderforceKit/Cloud`. The old gateway chat transports are deleted. Camera, location, SMS, screen, canvas and voice stay on the local agent-runtime gateway.
- **One-box composer** on all three: text on top, then `+`, "To ▾" (only when the chat has agents), and one round trailing button (mic → Send → Stop). Suggestion chips sit over an empty chat, and text typed during a reply is queued.
- **Images persist.** On all three apps, an attached image goes to `POST /api/brain/upload`, its `{key,name,type}` rides in the message `metadata` beside `addressedTo`, and a reopened chat shows it as a thumbnail, read back through the signed-in session.
- **Localized:** Android 225 strings and Swift ChatUI 51 keys, each in en/de/es/fr/zh. The Mac packager ships the ChatUI resource bundle.
- **CI:** `.github/workflows/native-apps.yml` builds Android (assemble and unit tests), BuilderforceKit (build and test), the macOS app, the iOS simulator app and Swabble on Xcode 26 runners. All five jobs pass on run 38078637198 (`188c595f3`). Getting there needed four fixes:
  - a KDoc `/*` that opened a Kotlin nested comment;
  - runners moved from `macos-15` (Swift 6.1) to `macos-26`, because the packages declare tools 6.2;
  - Peekaboo pinned to exactly 4.9.0 instead of a January `main` that called `CGWindowListCreateImage`, which the macOS 26 SDK removes. The bridge host now supplies `desktopObservation`, and Swabble moved to Commander 0.3.0 to match AXorcist's pin;
  - Swabble's sentence timing and `transcribe` gated to macOS 26.
- **Fixed along the way:** the Sparkle feed and contributors script point at the real repository, and the About page drops the upstream author's personal links.

**Still open (ROADMAP):** Evermind recall and the agent invite UI in the native chat.

## ✅ RESOLVED 2026-10-10 — A canvas build that stalls part-way says so, and an auto turn routes around the stalled model (frontend 2026.10.34)

**Was** (session `local-6d36899d`, ui 2026.10.31, "build a marketing site for phones"): the free `nemotron-3-ultra-550b-a55b:free` wrote only `index.html`, stalled, hit the 8K output limit, then stalled again. The user got **"I added the requested content to the canvas."** above a "Hello World!" preview. Three faults in `creationCanvasAi.ts`:
- **Stall count wasn't "in a row".** `stalledStreams` was never reset on a successful completion, so two stalls minutes apart, with a file written between them, counted as a dead model.
- **No re-route on auto routing.** `switchToProvenModel` had nothing to switch to (the stalled model was the only one that had called tools), so the turn gave up. The gateway's pool was never asked again.
- **Abandoned turn reported as delivered.** The tail treated `canvasChanged` as success even when the loop ended on a `failed` rung.

**Now:**
- `consecutiveStalls` drives the ladder and resets on every returned completion. `stalledStreams` stays as the turn total.
- An unpinned turn with no proven fallback re-routes once (`MAX_STALL_REROUTES`): the stalled model is excluded via `excludeModels` and the gateway picks again. This is turn-scoped and never reported as session-disabled. A caller's explicit pick is never overridden.
- A turn abandoned after changing the board returns the new `stoppedPartway` notice (all five catalogs) and reports `onUnanswered` (`provider-stalled` / `model-looped`), so it stays out of the transcript.
- `switchToProvenModel` never picks a model the turn re-routed away from. Before this, a stall after the re-route had no model name to report, so the "proven" fallback picked was the model that had just gone silent.
- Tests: three cases in `creationCanvasAi.test.ts` → "part-way through a build".

## ✅ RESOLVED 2026-10-10 — Every prompt is the same one-box composer: web, VS Code, Synapse, Spawn (brain-ui 2026.10.4 · brain-embedded 2026.10.5 · frontend 2026.10.33 · VSIX 2026.10.6 · desktop 2026.10.3)

**Was:** the 2026-10-09 simplification ("a chat box again") reached only the canvas/Studio dock. The rest still had the old shape:
- **VS Code:** the mic in the text row, a separate "Auto ⚡" chip duplicating the `/` menu's auto-approve row, and Queue + Stop as two buttons.
- **Synapse desktop:** a "To" row shown even with no agents, and a text "Send" button outside the box.
- **Spawn:** a textarea plus a "Build" pill, and a second build typed mid-run was dropped.
- **Web:** the full-page Brain, dashboard and landing hero still used the four-row "comfortable" layout. The Guest Brain, Manager chat, Agent Host chat and agent-execution steer box were hand-rolled textarea + button pairs.
- **Embeds:** the embeddable `PromptInput` was a bordered field with an outside button.

**Now:**
- **brain-ui:**
  - `PromptPanel` has ONE layout: text on top, then one tool row with `context` riding after `+` and `/`. The `density` variant and the `meta` row are gone.
  - The quiet "Work ▾" trigger face moved from a frontend CSS module into `styles.css`, so every host gets it.
  - New shared `promptTrailingAction` (mic / Send / Stop, one slot) and `useVoiceDictation` (gated on runtime support, so no dead mic).
  - `PersonaPicker` takes `quietAt` and hides "Acting as" until there is someone else to act as.
- **frontend:**
  - `ChatInput` uses the shared pieces. Enter sends by default.
  - `meta` became `menuStatus`, so the web Brain's Evermind status now sits inside the `/` menu, as in the editor.
  - `composerDensity` is removed from the Brain panel.
  - GuestBrainPanel, ManagerChatPanel, AgentHostChatContent (now fully localized under `agentHostChat.*`) and the AgentExecutionPanel steer box all use `ChatInput`. Execution steers on Enter, and Stop on an empty box cancels the run.
- **VSIX:**
  - New `ComposerTrailingButton` draws the shared decision. The private dictation code and the "Auto" chip are deleted (auto-approve stays in the `/` menu).
  - The box takes the theme's input border.
  - `IconBolt`, `.bf-toggle`, `.bf-composer__entry/__mic` and the `app.autoMode` label are deleted.
- **Synapse** (`desktop/app/ui/js/chat/composer.js` + `dictation.js`): one filled box. "To" shows only when the chat has agents, and one round mic↔Send button. The box clears on send and restores the text if the send fails.
- **Spawn** (`desktop/spawn/ui/js/composer.js` + `dictation.js`): the same box. Starter chips scroll sideways instead of wrapping, and a prompt sent mid-build queues ("Builds next") and runs after.
- **`brain-embedded` `PromptInput`:** one filled box with a round trailing button, plus optional `onStop`/`stopLabel`.

**Not included:** `apps/android` and `apps/shared` (CoderClaw gateway clients) keep their own composers. They are a separate product line with a session picker and gateway health, not a Brain prompt.
## ✅ RESOLVED 2026-10-10 — Production log defects fixed (api, frontend, agent-runtime)

All the code defects in the 2026-10-10 production log review ("Production signals" in ROADMAP.md) are fixed. The account actions left over stay on the roadmap.

**Gateway and models**
- **Dead model ids.**
  - Cerebras retired `llama3.1-8b` and `qwen-3-235b-a22b-instruct-2507` (167 × 404 in a week). They left the catalog, and Cerebras now serves `gpt-oss-120b` and `qwen-3.8-27b`.
  - NIM's `moonshotai/kimi-k2.6` is still listed but invoking it 404s. It is superseded by `kimi-k3`.
  - OpenRouter retired `qwen/qwen3.8-27b:free`.
  - A retired id is redirected (`supersedes`) only to a successor in the same model family: `gemma-3-27b:free` → `gemma-4-31b:free` and Kimi K2.6 → K3. Retired ids from other families (`qwen3-coder:free`, `qwen3-next-80b…:free`, `hermes-3…:free`, `llama-3.3-70b:free`) answer an honest 404 instead of a silent swap, as the `canonicalModelId` family guard requires.
  - **BYO backfill misattribution.** Cerebras's new bare `gpt-oss-120b` fell into Ollama's derived `gpt-` family, so backfill would have charged platform spend to a tenant's Ollama key. Bare ids from vendors no tenant can own now contest a family, which makes it ambiguous and drops it (`scripts/lib/byoProviderMap.mjs`).
  - agent-runtime's hard-coded free list uses live ids.
  - The drift guard gained a Cerebras source (the public `/public/v1/models`), and the snapshot was refreshed.
- **Strict structured output.** One schema-dialect walker (`jsonSchemaSanitize.ts`):
  - Anthropic declares `closeObjects` (`additionalProperties:false` on every object node).
  - NVIDIA strips `propertyNames`.
  - The parallel Anthropic sanitizer is gone, and so is its bug of dropping a property named `pattern`.
- **Codex.** Responses-Lite requests send `reasoning.context: 'all_turns'`.
- **Vision gate** (`vendors/capabilityGate.ts`). An image request skips models declared text-only; a strict pin answers a typed 400. MiniMax-M1 and MiniMax-Text-01 are declared text-only (31 × "not support img").
- **Per-model attempt budgets** (`vendors/attemptTimeout.ts`). Frontier models are no longer cut at the free plan's 15 s: Anthropic gets 90 s and Gemini Pro 90 s. Undeclared models keep the plan budget.
- **Embeddings.** Cloudflare Workers AI is a third vendor in the general `/v1/embeddings` cascade; the secrets already exist on the Worker. Project memory stays pinned to `text-embedding-3-small` because its vectors are `vector(1536)` (an open roadmap decision).
- **Image vendors.**
  - The health probe sent the prompt `'ping'`, which Gemini's image models answer with `NO_IMAGE`, so Gemini was marked down for a reason no real request hits. The probe now describes an image.
  - Hugging Face moved off the deprecated `hf-inference` route (410) onto `nscale`.
  - FluxAPI's in-band `code=402` now surfaces as a 402.
  - Together's dead `Lykon/DreamShaper` was removed.
- **Strict-pin 503 → 500** (earlier the same day, see below).

**API**
- **Brain usage rows landed on the core database.** `BrainService.recordUsage` built a stub env with no transactional binding, so `resolveUsageDatabase` fell back to core. These are the "writerless" core `llm_usage_log` rows (2026-09-13/14 and 10-05). It now passes the real env (`brainUsageEnv.ts`).
- **Unique-key races.**
  - `projects_key_key`: a generated key re-derives and retries, and an explicit key answers 409. Every generated-key caller uses `createProjectWithGeneratedKey`, including `builtinMcpService`.
  - `project_sites_subdomain_key`: a derived subdomain is suffixed and a chosen one answers 409. A project's old subdomain is retired only after the new one is claimed.
- **Error ingest.**
  - A declared ignore list drops the benign ResizeObserver notice (57 % of events).
  - The fingerprint no longer includes bundle line/column positions or content hashes, which is what split one error into a group per deploy. `release` is still stored on the group.
- **PR reconciliation.** A GitHub 403/429 cools the credential down through the shared KV cache, honouring `retry-after` / `x-ratelimit-reset`. It reports once instead of on every 5-minute tick.
- **The role re-dispatch loop (510,632 dispatches July–August; the 2026-09-16 burst).**
  - Root cause: nothing reopened a slot. `pickManagedProducer`'s fallback tiers re-picked a role whose slot was already COMPLETED, behind a reviewer verdict asked for before any work existed.
  - The pick now skips discharged roles. A delivered stage reports `lane_requirement_gate`.
  - Reviewers are asked only after the producers ahead of them deliver.
  - A reopen is explicit and recorded (`reopenProducerSlots.ts`).
  - Manager returns go through `returnToImplementation.ts`, which holds a code ticket with no usable repo instead of re-dispatching it.
  - Regression test: `managedLaneRoles.test.ts`, "ticket #2180 — a completed producer slot stays closed".
  - The 50-run ceiling stays as defence in depth.

**Frontend**
- **Plain-HTTP crash** (`crypto.randomUUID is not a function`, 69 events). An inline polyfill runs before any bundle (`lib/randomUuidPolyfill.ts`). `middleware.ts` 301s plain HTTP to https and folds www onto the apex in one hop (`lib/secureTransport.ts`). HSTS is sent in `_headers` and on middleware responses.
- **`/api/tools/agent-send` 404s.** Docs Markdown links are root-absolute (`/tools/agent-send`), so through the `/docs` proxy they landed on the app's `/tools/[id]` diagnostics page. The proxy now re-homes root-absolute links under `/docs`. An unknown tool id renders a localized "this tool doesn't exist" state with a link to all tools, not a load error (`tools.unknownTool`, five locales).
- **Outcomes 400** ("Project is not linked to this session"). A project carried by a card on the board now counts. Publish links the project it creates before recording outcomes, and reports a failed link instead of swallowing it. An unheld project is recorded unattributed rather than refused.
- **Root-closure baseline** now records `lib/canvas/boardRetention.ts`, which came in with the kept-board release commit `59c8c9283` and had left the guard red.

**Operator actions taken:** `OPENROUTER_API_KEY` and `OPENROUTER_API_KEY_PRO` were verified (chat + embeddings) and set on the `builderforce-api` Worker.

**Verified by Sonnet:**
- API type-check (tsc + tsgo) clean.
- 523 targeted API tests across 33 files. The one stale expectation (Together now has one free image model) was fixed and re-run.
- 122 targeted frontend tests across 4 files, and agent-runtime tsc clean.
- API guards and the root-closure guard after the follow-up fixes.
- The frontend type-check's single error is in another session's in-flight composer file (`ComposerOptionsMenu.tsx`), not in this change set.

## ✅ RESOLVED 2026-10-10 — One prompt for every edit: "Select to edit" feeds the Brain, and the composer suggests fixed next steps (frontend)

**Was:** two parts of the simplified Studio prompt design were unbuilt (ROADMAP, 2026-10-09):
1. **Separate edit flows.** "Select to edit" in the preview opened its own two-field form under the preview (copy, classes) that rewrote one source line without the Brain. That was a second place, with a second vocabulary, to ask for a change.
2. **A blank box after each reply.** Nothing suggested what to do next.

**Operator decisions:** (1) no separate flows, so everything goes through the one prompt; (2) next steps cost nothing: a fixed list, never a model call.

**Now:**
- **`lib/workspace/previewPick.ts`** (new) is the one pick store, one per window. `PreviewPick` = the `VisualSelection` plus its workspace id and app name. `previewPickContext()` is the model-facing note naming the element's tag, file, line, text and classes. The preview that made a pick withdraws it when it unmounts.
- **`usePointAndEdit`** publishes the pick and disarms. `PointAndEditPanel` is deleted, along with `replaceTextAtLine`, `replaceClassNameAtLine`, `LineEdit` (`lib/visualEditor.ts`) and their tests.
- **`components/builder/PreviewPickChip.tsx`** (new): the pick as a removable chip in the prompt's tool row. It renders nothing without a pick. Both prompts carry it: the canvas prompt (`CanvasPromptComposer`) and the Studio workspace Brain (`BrainComposer`).
- **The canvas turn** (`useCanvasBrainTurn`): a typed turn takes the pick and appends its note to every loop's board snapshot. Replays and queued turns leave it standing.
- **The workspace Brain** (`useWorkspaceBrainContext`): the pick note joins `extraSystem`. `useSpendPreviewPickOnSettle` withdraws the pick once the turn that carried it settles, unless a newer pick replaced it.
- **Next steps:** `CanvasSurfaceDef.composerNextSteps` (data). The App surface lists polish, phones, a section, real copy and fixing errors. `lib/composerNextSteps.ts` falls back to the phase's `PHASE_STARTERS`. `CanvasNextSteps` (new) shows them as chips above an empty prompt once a conversation has started. A chip seeds the box and never sends. The chips hide while Brain works, while the starting-points catalogue is open and once the person types; they wrap when wide and scroll sideways on a phone.
- **`CanvasPromptComposer`** takes `surface` instead of `intents` and derives both lists from the surface registry.
- **i18n:** `creationCanvas.nextSteps.app.*` and `creationCanvas.nextStepsLabel`, `ide.previewPick.*`, and a reworded `ide.visualEditHint`, in all five catalogs. The seven `ide.visual*` form keys were retired.

## ✅ RESOLVED 2026-10-10 — The editor draws the whole board: one "which project?" resolution for every surface (VSIX 2026.10.5)

**Was:** four canvas surfaces threw in the VS Code panel and dropped the board to chat: `usePins()` in `CanvasInsightsSurface`, `useProjectScope()` in the Insights lenses, `usePmScope()` in the PM widgets, and `useLiveSession()` in `CeremonyStage`. The roadmap held it for a product decision, because "which project?" had five private answers, each with its own order: `ProjectScopeProvider` (URL, then localStorage), `PmScopeProvider` (prop, then shell), `useComponentProjectId` (pin, then embed URL, then shell), `useEmbedProjectId` (`?project=`, then `#projectId=`), and `ToolRunner` (`?project=` / `?projectId=`, then shell). None of them knew that the editor owns a project selection of its own. Two bugs came with that: `/workflows` read `?projectId=` while every link into it wrote `?project=`, so the project was dropped; and a component under the shell let a stale deep-link outrank a fresh TopBar pick.

**Now:**
- `lib/projectScopeResolution.ts` holds `resolveProjectId` (pinned → host → location → selected → portfolio) and `projectFromLocation`, which accepts every URL spelling. Every surface goes through them.
- `ProjectScopeProvider` takes an optional `ProjectScopeHost` port. When the host owns the selection, a pick goes to the host rather than to localStorage or the URL. The tenant comes from `useViewerSession`, not `useAuth`.
- `useComponentProjectId` is the one hook. `usePmScope` is now a view over it, with no context and no throw. `PmScopeProvider`, `WithPmScope` and `useEmbedProjectId` are deleted. `ToolRunner` and `/workflows` use the hook.
- `useViewerSession` now carries `user`. `LiveSessionProvider` and `CeremonyStage` use it in place of `useAuth`.
- The editor mounts the same providers through `webview/src/canvas/HostScopeProviders.tsx`, fed by `init.project`. A pick made on the canvas posts `project.select`. The host applies it through `applySelectedProject`, the one path it now shares with the QuickPick and project creation.

Verified by a Sonnet run: frontend type-check 0 errors; 9 targeted test files, 150 tests pass; VS Code type-check (tsgo + tsc, 4 projects) clean, 4 files, 39 tests pass; `builderforce-ai-2026.10.5.vsix` packaged and installed. `check:root-closure` re-baselined +1 file for `projectScopeResolution.ts`, with the reason in the guard header.

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
- **Where:** `api/src/application/blueprint/{blueprintDetection,blueprintSources,blueprintOverrides,detectBlueprintForProject}.ts` (+ tests), `blueprint/detectors/{index,builderforceJsonDetector}.ts`, `llm/appBlueprintToolCatalog.ts`, `repos/resolveDefaultRepo.ts`, `contributors/activityIngest.ts` (+ test), `integrations/integrationCatalog.ts`, `infrastructure/repositories/ProjectRepository.ts`, `presentation/routes/{githubWebhookRoutes,projectRoutes.schemas}.ts`; `packages/agent-tools/src/{edit,capabilities}.ts` (+ test); `frontend/src/lib/integrationCatalog.ts`, seven styled files, four `lib/*.ts`, five message catalogs, `scripts/check-design-scale.mjs`, `scripts/.frontend-architecture-baseline.json`, `scripts/check-frontend-architecture.mjs`; `webdit/converter/pnpm-lock.yaml`; `docs/specs/31-prd-customer-app-platform.md` (the override row).
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
  - Specs: `docs/specs/26-prd-advisor-platform.md`, `docs/specs/26-implementation-notes-advisor-platform.md`
  - Task specs: `specs/tasks/task-2527.md`, `specs/tasks/task-2532.md`, `specs/tasks/task-2581.md`
- **Verify:** All PRs merged to main (#844, #845, #846)

- **Roadmap 69584c3f** - changed from "planned" → "shipped"

## ✅ RESOLVED 2026-09-21 — PRD 27: Staffed work, the coordination gate, and chat diagnostics as data

- **What:** PRD 27 delivered five changes: (1) a versioned `bfk` auth-cache key so the VSIX owner resolves as their actual role instead of an anonymous DEVELOPER — the root cause of `403 manager role required` on chat #113; (2) `ReplayRouteError` so a replayed 4xx surfaces as 403, not 502; (3) migration 1177 + `coordinationGate.ts` making ticket coordination developer-tier with a per-project opt-in (`coordination_requires_manager`); (4) migration 1178 + the persisted `ChatDiagnosticsReport` with the `work-filed-not-staffed` verdict; and (5) persona sub-agents (`spawn_agent as_agent=<Ada>`) end to end across agent-tools, agent-loop, brain-embedded, and the VSIX.
- **Why:** A work-mode run filed 12 tickets and assigned nobody — every staffing call returned 403 masked as 502, and the diagnostics report had no line saying "work was filed but nobody is running it." The auth cache had been resolving the workspace owner as an anonymous DEVELOPER for 365 days.
- **Where:** `api/` (migrations 1177/1178, `coordinationGate.ts`, `chatDiagnosticsStore.ts`, `chatDiagnosticsToolCatalog.ts`, `agentPersonaToolCatalog.ts`, `agentPersonaBrief.ts`, `staffingSummary.ts`, `chatDiagnosticsReport.ts`, `captureDiagnostics.ts`, plus eight test files), `packages/agent-tools/` (`subagent-tools.ts`), `packages/agent-loop/` (`SubagentRunArgs.persona`), `brain-embedded/` (`chatWorkDirective`, `brainTriage.ts`, `brainRunStore.ts`), `clients/vscode/` (VSIX 2026.9.75), `frontend/` (i18n keys in five catalogs). Spec: `docs/specs/27-prd-staffed-work-and-chat-diagnostics.md`.
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
