# Builderforce.ai — Roadmap & Gap Register

> **Outstanding work only.** Finished work moves to [DONE.md](./DONE.md). Validated against the code 2026-10-31. Entries sit under the arc stage they move a user through; work that moves nobody through the arc is under OTHER. Tags are the domains in [DomainService.ts](./api/src/application/kernel/DomainService.ts).
>
> **Traffic, 30 days to 2026-10-25:** VS Code 452 runs, Web ≈230 calls, cloud tickets 4 runs.

## How an entry is written

One line: the gap, the next step or done-when, and `*Blocker: …*` if there is one. **No blocker named means not blocked**; scheduling around other work is not a blocker. Detail lives in the PRD or the code, not here. Human or production validation is never an entry or a blocker: telemetry and logs validate shipped work. A Build item names its proof form and kill condition. Authenticated UI meets PRD 21.

## North Star — Idea to Real

Vocabulary is spec data, ratcheted by `frontend/scripts/check-methodology.mjs`.

- **Arc:** `Idea → Make → Run → Measure → Reach` (`ARC_STAGES`, [navGroups.ts](./frontend/src/lib/navGroups.ts)).
- **Loop:** `Read → Prove → Build`, crossing Idea into Make. Read and Prove spend nothing; Build spends run budget ([application/realization/](./api/src/application/realization/)).
- **Proof forms:** `PROOF_FORMS` in [methodology.ts](./frontend/src/lib/methodology.ts). A new one is a registry entry, never a branch. Each proof carries a kill condition graded in Measure.

Enabling work never outranks a broken Idea→Real journey.

**North-star metric:** share of ideas reaching a graded proof. Contract: [OUTCOME-METRICS.md](./docs/design/creation-canvas/OUTCOME-METRICS.md).

## Claim-to-Proof

Public copy states today's evidence. **Available** = shipped and repeatably verified · **Beta** = named limitation · **Planned** = never presented as current. These are the statuses in `MARKETING_CLAIMS` ([product.ts](./frontend/src/lib/content/product.ts)), which holds the reviewed wording; this table holds what each promise still needs.

| P | Promise | Status | Proof still missing |
|---|---|---|---|
| P0 | One canvas from idea to real | Beta | A release gate per marketed artifact. `qa-e2e` runs in no workflow and its `ci` script swallows failure |
| P0 | People control agent work | Beta | Wired, failing closed and guarded in CI (2026-11-08). Still missing: a release that ships it on green CI |
| P0 | Complete agent auditability | Beta | The `mutationAudit` envelope exists and covers the governance and security writes. Still missing: coverage at every other mutation entry point |
| P0 | Private, local AI work | Planned | A boundary manifest per action, shown before execution |
| P1 | Evermind stays current | Beta | Freshness budgets, stale-recall evals, contradiction detection beyond docs |
| P1 | Same work in VS Code | Beta | A web↔extension parity matrix; contract tests are partial |
| P1 | Connected delivery, no sprawl | Beta | Health and recovery in `connectorManifest.ts`; board sync has them |
| P1 | Costs connect to outcomes | Beta | Unattributed-spend coverage and reconciliation |
| P2 | Create "anything" | Beta | Limits, exports and owner in `creationObjectRegistry` |
| P2 | Model/provider freedom | Planned | Provider copy from the live catalog; "30+ providers" is hardcoded |
| P2 | Fair comparisons | Planned | Sourced, dated, expiring vendor facts |
| P2 | Value for CEOs/revenue leaders | Beta | Measured production values and one customer proof |

## Programs

- **hired.video absorption** ([PRD 18](./docs/specs/18-prd-hired-video-port.md)): deprecate to a redirect shell. Every table maps to a primitive (`docs/specs/data-model/source-to-target.tsv`); the rest is application code.
- **burnrateos.com shutdown** ([PRD 19](./docs/specs/19-prd-burnrateos-consolidation.md)): an unbuilt, unretired capability is lost at shutdown. Held by `check:burnrate-parity`, `check:no-burnrate-runtime`, `check:burnrate-policy`. *Blocker: operator provider actions, identity-cutover comms, redirect verification.*

---

## Consolidated Gap Register — by stage of the arc

| Stage | Holds | Next milestone |
|---|---|---|
| [💡 Idea](#-idea--read--prove) | Sessions, briefs, choosing and running a cheap proof | Experiment verdicts; validate by asking the market |
| [🔨 Make](#-make--build) | Agents and people building: runs, boards, canvas runtimes, previews, hosting | One execution core; live preview on |
| [⚙️ Run](#️-run--operate-the-company) | Finance, hiring, people, governance, phone, investor | SOC 2 Type I |
| [📊 Measure](#-measure--grade-the-proof) | Grading proofs and seats: metrics, experiments, OKRs, sessions | `experiment` cards measured |
| [📣 Reach](#-reach--sell-be-found-grow) | Billing, marketplace, marketing, SEO, distribution | First paying tenant; first customer proof |
| [🧰 OTHER](#-other--enabling-work-outside-the-arc) | CI, gateway, Evermind, runtime, data model, code health, infrastructure | $0 platform plan |

---

## 💡 Idea — Read · Prove

- **[canvas] Ideas surface reads unfinished.** Lede and empty body repeat "the prompt below", Capture misses request-shaped text, Brain's "no data" reply asks for an object ID. Mockup: https://claude.ai/artifact/KcEJGhrZaQMQWEMSHNJjyE. *Blocker: operator go-ahead.*
- **[canvas] Experiment templates and verdict.** Smoke test and wizard-of-oz exist. Add A/B and concierge templates, a decision-rule field, and a pursue / pivot / kill verdict (`revealIdea` grades met/missed only). Build as proof-form registry data.
- **[canvas] Survey delivery gaps.** `CampaignTransport` has no `twilio` or `scheduledAt` though the server supports both; clicks record no link (a per-link registry also closes the `?u=` open redirect); the CSAT/NPS widget has no renderer.
- **[canvas] Survey stores.** Move `pulse_surveys` onto `question_sets` `kind='pulse'` keeping anonymity, port DevEx eNPS logic, route `newsletter_subscribers` through the campaign rail or retire it.
- **[canvas] Four contact stores** (`sales_contacts`, `ri_prospects`, `lists`, `marketing_audience_members`) need one identity. *Blocker: operator picks the canonical store.*
- **[canvas] Idea-born survey defaults** (recommended): anonymous yes; 14-day close; Ask + Publish for any editor, Send keeps the `manager` gate; state suppression before send. *Blocker: operator decision.*
- **[canvas] Creation-session release gates (PRD 17 R-02–R-07).** Emit `creation_sessions_nav` first (nothing does), then retire legacy routes at wrapper success ≥ 99.9% and return-to-session ≥ 80%. Run the Playwright matrix in the release environment and add reconnect and packaged-VSIX specs; capacity probe; a11y suite; backup, rollback and kill-switch drills via `canvas:audit`. Unblocks Gates A–D.
- **[canvas] Wizard-of-oz `/queue` and pilot `/pilot-report` are public and expose contacts** (`verify: 'none'`). Fix with a read secret, signed link or authenticated console. *Blocker: product decision on where the console lives.*

---

## 🔨 Make — Build

### Cloud and IDE agent runs `[agents]`

- **No source of recorded runtime values for the knowledge view (PRD 38).** Several features are wired and tested but have nothing to show yet:
  - The Simulate drawer's recorded and editable values, which use the optional `recordedValues` source port.
  - Path-hop payload sizes ("PUT 1.4 MB"), which need a `payloadBytes` file badge.
  - The Sync drawer's "Traces" row.

  Each one stays honestly empty and never shows a guess. Hop labels show the route only. The cause is that nothing captures the argument and return value at each stop, or the request and response size, during a request or test run. Static extraction (`codeFileBadges`) cannot see these. What fixing it needs:
  - a runtime recorder;
  - a traces source that serves its output to `recordedValues`;
  - a `payloadBytes` badge.

  *Blocker: no runtime trace recorder exists. It is a new subsystem, a candidate for PRD 41's run delta.*
- **Predicted measures over the knowledge graph: P4 and P7 not started, P1 not yet consumed.** P1 Louvain partitions shipped in builderforce-memory 2026.10.57 (published as 2026.10.58; every package now pins ^2026.10.59). Builderforce does not read them yet: knowledge-graph-view needs the `placementOf` fallback, and the `kg:v5` / `kg-outline:v1` cache keys must move so old layouts are not served. Still open: P4 co-change impact and P7 Markov transitions for Simulate (graph-only formulas, stored as badges), and P2 (Part D results on the map). The shared maths stays in the builderforce-memory `stats` module (D13) ([PRD 38 › Predicted measures](./docs/specs/38-prd-knowledge-graph.md)).
- **No run delta yet: PRD 41 WS2 (SQLite fact store) is open ([PRD 41](./docs/specs/41-prd-offline-understanding-and-run-delta.md)).** WS1 (offline closure) shipped in 325f4faaf (see DONE.md). Still open: WS2, the SQLite fact store in `.builderforce/cache/` (Opus-reviewed), and the run delta that reads recorded change sets (`brainRunHostPorts.ts`). Another session is building the node:sqlite store (`packages/agent-tools/src/node-knowledge/*`).
- **Cloud run isolation (G1/G2, [PRD 09](./docs/specs/09-prd-cloud-agent-validation.md)): egress allowlist built but off; secret containment under rework (in progress 2026-11-08).**
  - G1 egress: the outbound allowlist and its lifecycle shipped (`sandboxEgressLifecycle.ts`, b55198fc0 / adc99aa42 / e867b3bd1) behind `SANDBOX_EGRESS_ENFORCE`, which stays off. *Blocker: a live probe in a deployed container (raw TCP/DNS blocked, HTTPS through the proxy to an allowed registry, interception installed before start, `ctx.exports.ContainerProxy` resolves) before the flag is turned on.*
  - G2 secret containment: the env scrub, `persist-credentials: false`, the one redaction package and the audit-write guard are on main (3a2c752db, e707549cf). An Opus review found the model shell could still read the runner's environ (same uid) and credentials in `.git/config`. The redesign (a separate `bfagent` user with its own group, all workspace fs/git through a helper running as that user, authenticated git only in a server-owned mirror with bundle handoff) and the redaction-quality fixes are in progress, partly swept unreviewed into local ee2222212. Next: verify, Opus re-review, commit, push.
  - Re-audit of the remaining PRD 09 items (S5, S6, W2, B2 closed) is not started.
- **Cloud dispatch admission: review fixes in progress (2026-11-08).** Admission and the early draft PR are on main (3a2c752db). An Opus review found the deferred-dispatch sweep reads the wrong database (parked dispatches are never retried), the audit table cannot serve as a queue, and the orphan-draft sweep judges the wrong run and can close a draft a new run just adopted. The rework (a `deferred_dispatches` table with claims, backoff and per-kind hooks; a sweep decided by `platform_draft_execution_id` with a compare-and-set retire) is in progress, partly swept into local ee2222212. Next: verify, review, commit, push.
- **`main` is red in CI (Release run 42483919152 on 970d6b6af, 16 jobs).** The old causes in this entry (deleted `src/tui/tui.ts`, oracle drift) no longer apply. The current red came from the 3a2c752db / ee2222212 sweeps of in-progress work from many sessions. Fixed and committed locally, not yet pushed: the builderforce-memory 2026.10.59 pin and lockfile refresh (4397dbab4: agent-tools tests and the `AnalyzerProgress` type errors), and in ee2222212 the publishable-deps scan (quality, replay), `externalUrl.test.ts` and the webview canvas tsconfig. Still red and owned by the sessions working in those areas: API vitest shards and guards (hiring, voice, SOC 2, classifier), API and frontend type-check, frontend build, lint and guards, and the VS Code extension test (`knowledgeLinkedDenied` acceptance, node:sqlite in the extension host). Next: push once the in-progress reviews above land and no CI run is in flight, then re-triage what is still red.
- **A failed run's branch residue is never swept,** and cancelled-run teardown can delete a live parent's or earlier run's work, because `runCommitMarker` is per task. Needs per-execution attribution. *Blocker: operator decision on deleting run branches.*
- **VS Code chat history doesn't follow the person.** `isOwnRecord` filters other devices' records and `openableLocalChat` doesn't pull the transcript. Fix: re-key on arrival, hydrate from `GET /api/brain/chats/:id/messages`. *Blocker: operator decision; changes what "local first" promises.*
- **Autonomous trigger errors.** 282 `auto_run_error` in 30 days to 2026-10-25 (`autoRunSkipLedger.ts`). Group by reason, fix the top causes.
- **Auto runs may carry no `cloudAgentRef`** (`laneEntryTrigger.ts:323` sets it only with `decision.agentRef`).
- **IDE agent calls tools one at a time** (chat #115: 63 turns, 82 calls). *Blocker: an A/B over real runs.*
- **Multi-repo sandbox.** Per-task repo sets route and open PRs, but `sandboxOpenSpec.ts:26` clones one repo.
- **Architect runs:** `AnalysisRunnerDO` has no per-tool timeline or steering; no commit-webhook re-analysis.

### Local-first `[agents]` `[platform]`

Source: [offline-first review](./docs/design/vsix-offline-first-architecture-review.md).

- **Created tickets are not linked to their chat (in flight, 2026-11-08).** Three things are wrong. First, on the VSIX, `ticket-create` writes no local `chat-ticket-link`, so the rail shows the ticket as unlinked until sync reaches the server. The in-chat agent's fix (`b24834e18`) links in a second transaction in `localDomainTools.ts` and threads `deviceId` through the tool options; it is being reverted. Second, the server create tools ignore the `chatId` that cloud runs stamp. Third, web, Rovr and VSIX platform creates rely on a second `builtin_chats_link_ticket` call (`autoLinkCreatedItem`). Fix: `createTicket` writes the link in its own transaction through a tx-level writer in `packages/local-first`. `callBuiltinTool` links a create's host-stamped `chatId` through `linkTicket`. `brain-embedded` stamps the run's `serverChatId`, and `autoLinkCreatedItem` is deleted. Done when every surface's create is linked by the create itself.
- **Three local ticket writers.** `frontend/src/lib/localFirst/workManagement.ts` (web), `packages/local-first/src/localWork.ts` `createLocalWork` (used by `localTools.ts` `executeDomainTool`) and `clients/vscode/src/localTicketRepository.ts` (VSIX) each build the ticket record, its create event and its dependencies separately. Only the VSIX writer carries `chatClientId`, `taskType` or server references. Fix: move the VSIX repository's rules into `packages/local-first` as the one ticket and project repository, port the web and `executeDomainTool` callers onto it, and delete the two thinner copies with their tests run unchanged. Fixing it means a chat-created ticket links on every local host, not only the editor. *Blocker: it rewrites `localTicketRepository.ts`, which the link fix above is changing in this pass, so it starts once that lands.*
- **G27: no packaged acceptance suite runs with the network denied.** `deniedNetworkAcceptance.test.ts` mocks `vscode`. Assert zero platform requests and local-only completion in the packaged VSIX, Rovr and Web. Unblocks claiming offline behaviour.
- **Legacy-migrated root: the first host to pack it can drop another host's sources.** On a root with a generation but no leaves yet, api `planSources`/`reconcileLegacyRows` (knowledge pack apply) treat every legacy source the first pack does not name as removed — the same "less-complete host deletes" pattern the client reconcile no longer has. Fix: on that one-time migration, keep unnamed legacy sources (tombstone only explicit `pack.deletes`). Fixing it makes the leaf migration safe when the less-complete machine syncs first.
- **`replicaPump.delta.test.ts` times out under machine load.** `packages/agent-tools/src/knowledge/replicaPump.delta.test.ts` exceeds its timeout on a busy machine. Fix: shrink its fixture or raise the per-test timeout to fit its work. Fixing it removes a flaky red from the agent-tools suite.
- **Kimi Code `k3` sends no response headers for 240s on large prompts.** Seen four times: 2026-11-04 in chat #46121, and twice on 2026-11-06 in chat #46169. Each time the editor called `api.kimi.ai/coding/v1` directly with a prompt of about 75K tokens, and the request was dropped at the header deadline in `streamChatCompletion.ts`. One failure was step 0 of a fresh run with a fresh token. The 2026-11-06 pass makes the failure diagnosable (destination, phase, request size and credential state on the failed step, plus an output-channel line) and offers "Choose another model". A live probe on 2026-11-06 with the CLI token found the following. Kimi holds response headers until the first token, so time-to-headers equals queue plus prefill time. A ~75K-token `k3` prompt with 67 tools and `max_tokens: 4096` answered in 11–27s. So prompt size and tool count do not reproduce the stall. Still open are the workspace-connection token (which the failing runs used), the real multi-turn tool history, and a transient Kimi-side stall. **Blocker:** the original request bodies were not recorded, so there is nothing to replay. The new failure detail records request bytes, message and tool counts, and credential state. The next occurrence will narrow the cause down, then replay it against both tokens.

### Autonomous delivery `[delivery]`

Last measured 2026-07-26: 6 of 767 tickets fully autonomous; 69% of 6,195 runs failed. The manager's census tracks this.

- **Release health: main is still red after the 3a2c752db sweep.** Part 1 is in DONE.md, but the fixes are not committed yet. A Haiku re-run on 2026-11-08 found these still failing.
  - **From the autonomous-delivery pass:**
    - `boardLiveReads.test.ts`: 5 tests fail with "load is not a function" (mock at line 4).
    - `censusRecordedRefusals.test.ts`: "db down" propagates.
    - api typecheck fails in `kanbanRoutes.templateGet.test.ts`, `kanbanTemplateService.guards.test.ts`, `kanbanTemplateService.ts`, `personProfile.test.ts`, `boardBudgetRoutes.test.ts`, `onReviewerVerdict.test.ts`, `prConductSweep.ts` and `reaperChatNarration.test.ts`.
    - frontend `root-closure`: `useKanbanTemplateCheckout.ts` and `creationListings.ts` are now reachable from the root layout.
    - frontend `react-hooks`: `PersonProfileClient.tsx` and `useKanbanTemplateCheckout.ts`.
  - **From cloud admission, which has no owner:**
    - `dispatchAdmission.test.ts`: the regression "rank by admission, not by id" fails (got [11,5]).
    - `dispatchCloudRun.admission.test.ts`: the mock is missing `resolveDefaultRepoForProject`.
    - `handleCiEventOutcome.test.ts`: the call now carries `parkIfDeferred: true`.
  - **Owned by other sessions, in flight:**
    - the voice/studio tenant-scope, layering and unvalidated-body checks;
    - `hiring_ref_salts` table adoption;
    - the `connectorManifest` typecheck;
    - the agent-tools `@seanhogg/builderforce-memory` subpaths `/working`, `/ingest` and `AnalyzerProgress`, which break the api, frontend and VS Code typechecks;
    - the frontend `creationCanvasAi` and `InvestorUpdateMilestonesPreview` tests;
    - the `KnowledgeAnalyzePanel` `'use client'` check;
    - design-scale in PersonasClient and the security and governance panels;
    - the silent-catch ratchets.
  - **Canvas webview has no CI typecheck.** `VoiceMarketplaceScreen.tsx` is now only in `webview/tsconfig.canvas.json`, and that project is not in `clients/vscode` `type-check`. Adding it is a one-line change, but today it fails with 14 errors in `packages/knowledge-graph-view/src/surface/useSurface.ts`, `packages/interaction-contract/src/improvementPrompt.ts` and agent-tools knowledge.
  - *Blocker: the user stopped this pass on 2026-11-08 before the remaining fixes and the commit, and the shared packages above are mid-change in other sessions.*
- **PRD 23 dispositions and canary are built but not live** ([PRD 23](./docs/specs/23-prd-manager-pr-ticket-recovery.md)). Turn on the Manager canary for a project and apply a reviewed disposition batch; done when the census shows the backlog shrinking. *Blocker: operator decision to go live (the operator chose build + dry-run for this pass).*

### Ceremonies and meetings `[delivery]`

- **Ceremony presence** is set at connect, not re-verified per frame.
- **Retros:** no theme clusters, sentiment trend or action carry-forward.
- **Mesh WebRTC caps at ~4–5 cameras.** *Blocker: a Cloudflare Calls app.*
- **TURN not provisioned** (~10–15% of symmetric-NAT pairs fail). *Blocker: `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`.*
- **Meeting agent voice is browser `speechSynthesis`.** *Blocker: product decision.*

### Canvas runtimes and studio `[canvas]`

- **Video engine models:** no learned interpolation, ControlNet or inpainting. The WebM fallback and GPU `advanceState` shipped. *Blocker: trained weights.*
- **3 WebDiT models `available: false`** (wan2.5, mochi-1, ltx2-distilled). *Blocker: ONNX exports on R2.*
- **One build-file write took 35.7s vs 38ms median.** `client.build_file_write` spans now ship. *Blocker: a telemetry sample from a real build turn with preview running.*
- **Voice embedding plaintext column** (pre-1326 `embedding` jsonb) is still read and resealed. *Blocker: drop it in push 2, after push 1 has deployed (expand/contract).*
- **Canvas runtimes verification gaps (2026-11-08).**
  - The 2026-11-08 canvas runtimes pass wasn't fully verified. The full API test list was never run.
  - `frontend/src/lib/markdownPipeline.test.tsx` hung during load. The `React.lazy` fix in `DocumentMarkdown.tsx` is unconfirmed.
  - `voiceEmbeddingStore.test.ts` has a `vi.hoisted` fix that hasn't been rerun.
  - The VS Code webview build and VSIX package are blocked by another session's `packages/brain-ui` `ChatTicketsPanel.tsx` type errors, and by the missing `AnalyzerProgress` export from builderforce-memory.
  - The release notes and marketing for the six editors, the drawing block, Room voice and video, and the voice marketplace and provenance are not written yet.
- **CORS still accepts localhost in production.** Return URLs are now gated. *Blocker: operator decision on whether local development against the production API is supported.*
- **Podcast uploads:** `.m4a` / `audio/mp4` are rejected by the asset allow-list.

### Mobile `[canvas]`

- **Device simulator is in-browser.** The native path (Metro/Expo) waits on live preview; no Expo build service.
- **Native apps:** no Evermind recall or agent invite in phone chat; no Approvals screen.

### Previews, repos and hosting `[canvas]` `[integrations]`

- **Live container preview off.** Host and deploy are in place; `preview.builderforce.ai` answers "not enabled". *Blocker: the `PREVIEW_INGRESS_ENABLED` secret.* Unblocks the QR live path and the native simulator.
- **Customer app platform ([PRD 31](./docs/specs/31-prd-customer-app-platform.md)).** W1 `preview_*` tools and multi-port; W3 customer cloud connections; W4 `InfraProvider`; W5 hosted compute; W6 PR previews; W7 repo-connected listings. *Blocker: W5 decisions D1/D3/D4.*
- **Repo-backed Designer:** `last_synced_sha` is never written, so no merge guard; no auto two-way sync; worker and api R2 prefixes diverge; `createRemoteRepo` refuses GitLab.
- **GitHub App not registered;** the code is wired and calls use the tenant PAT. *Blocker: `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`.*
- **Multi-provider PR loop:** Bitbucket Server can't revert; `getPullRequestDiffSummary.ts:163` is GitHub-only. *Blocker: live GitLab/Bitbucket creds.*
- **Drive as primary storage isn't wired.** `workspaceStore.ts` needs a `StorageProvider` port. *Blocker: a live Google OAuth app.*
- **Post-merge validation** needs a `merge_sha`; Bitbucket has no log tails.
- **QA and security findings have no `{path, line}`,** so no inline PR comments.
- **Published sites can't run customer server code.** Needs Workers-for-Platforms or container serving.
- **Custom-domain certificates not live.** *Blocker: Cloudflare for SaaS entitlement + `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_SAAS_API_TOKEN`.*

### QA `[canvas]`

- **Agentic Tester:** no network sandbox; single persona login; Chromium only; no workflow step starts a run.

---

## ⚙️ Run — operate the company

- **[governance] SOC 2 Type I,** the enterprise gate (epic #3062). The automation side is built: control baseline, automated evidence and the governance-auditor sweep. *Blocker: a CPA firm must be engaged to issue the Type I report.*
- **[governance] DSR erasure skips non-segment stores.** `dsrExecution.ts` erases segment-scoped rows, but `marketing_audience_members` and `candidate_records` hold the same person outside the segment tier. *Blocker: operator decision on whether erasure reaches marketing audiences and hiring records, which carry their own retention duties.*
- **[hiring] Candidate-ref hashing needs a deployment pepper.** The per-tenant salt in `hiring_ref_salts` should be combined with a secret that never rotates, and none exists yet. *Blocker: operator provisions a `HIRING_REF_PEPPER` Worker secret.* (Detail in `SECURITY-FINDINGS.local.md`.)
- **[hiring] Board API shapes unproven live.** LinkedIn's `ids=List(...)` encoding and Ashby's `jobPosting.info` → `jobId` are coded from the vendors' docs, not proven with a live call. *Blocker: a tenant's LinkedIn and Ashby credentials to probe with.*
- **[data] `tasks.tenant_id` is NOT NULL in the database but nullable in Drizzle** (`schema/delivery.ts:228`, filled by `trg_tasks_tenant`, migration 0944). `TaskRepository.toDomain` has to map `null` to `undefined`. Marking it `.notNull()` lets the mapper pass it straight through.
- **[vscode] Webview `platformPolicy` tests fail** (three time out, one mock is called three times). The rewrite in `325f4faaf` didn't update the older cases. agentic-7d is placing an owner.
- **[integrations] Business Phone is Twilio CPaaS,** no port-in or SIM. `burnrateCutoverPolicy.json` says `retire_port_out`. *Blocker: operator confirms.*
- **[integrations] No A2P 10DLC registration.** *Blocker: operator decision on fees.*
- **[integrations] Drive / OneDrive can't complete consent.** *Blocker: enable the Drive API and `drive.readonly`, `Files.Read`, register both `/api/drive/callback/*`.*

---

## 📊 Measure — grade the proof

- **[growth] `experiment` cards are never measured.** `builtin_canvas_bind_ab_test` doesn't exist and `experiment` isn't in `CONNECTED_CANVAS_ACTIONS`. Bind to `ab_tests` (the Insights traffic split exists), enforce `ab_test_segments` at serve time, cover external sites.
- **[platform] Three metric families have no writer:** `channel_performance`, `arr_projections`, `quota_attainment`. All 17 seats have rollups.
- **[finance] Vertical KPIs ([PRD 25](./docs/specs/25-prd-vertical-kpi-dashboards.md)).** Slice B `growth.*`, LTV tranches, benchmark seeds; C exit waterfall; D remaining eight verticals' KPIs.
- **[finance] `companies.sector` is written free-form** (`investorRoutes.ts:167` → `companyWorkspace.ts:368`). Route through `validateListingPatch`.
- **[growth] Insights (PRD 33) not provisioned.** *Blocker: Stripe, published disclosure, `NEXT_PUBLIC_REPLAY_SITE_KEY`, QA image-size check.*
- **[growth] Insights event lake (D18)** for exact funnels. *Blocker: operator provisions the pipeline.*

---

## 📣 Reach — sell, be found, grow

### Billing and commerce `[finance]` `[commerce]`

- **No tenant can upgrade.** Stripe webhook unregistered, `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` unset. *Blocker: operator Stripe + `wrangler secret put`.*
- **Monetization:** personas install free; confirm a paid template install charges. Agent, skill and knowledge checkout exist and need the Stripe secrets above.
- **Enterprise license:** Docker files and `enterpriseSso.ts` exist, but nothing licenses on-prem (no key or verification code). *Blocker: operator defines what GA means.*
- **Buyer can't drive a listing first.** The Stage sandbox exists; no buyer route. *Blocker: decision on the throwaway tenant and who pays.*
- **Affiliates:** PRD 18 says port, PRD 19 §2 and `burnrateCutoverPolicy.json` say retire. *Blocker: operator decision.*
- **Company directory inert.** `companies` has no owner or verification column, so the "claimed a company" rung can't be enforced. *Blocker: PRD 19 B0 + PRD 21 §7 decision 4.*
- **PRD 21 storefront domain (§11.9.5).** *Blocker: operator decision.*
- **`projects` marketplace category** needs a visibility decision.
- **Gigs:** proposal eval scores aren't on an insights lens.
- **Upwork parity:** no payment-verified badge, bid economy or packages.
- **Freelance:** avatars are served full-size.
- **Advisors ([PRD 26 §12](./docs/specs/26-prd-advisor-platform.md)).** Notetaker default-on, action items on the visitor's board, follow-up slot, guest claim link, token isolation test, P2 filters, location and stage filters.
- **[integrations] Canvas packs and prompts can't be listed.** *Blocker: decide what a purchased pack becomes.*
- **[integrations] Developer Portal:** hyperscaler listings need seller accounts.

### Marketing and campaigns `[growth]`

- **Prompt-driven campaign ([PRD 30](./docs/specs/30-prd-guided-marketing-campaign.md)).** C1 `canvas_connect_mailbox`, C2 catalog use-case, C3 ICP on canvas, C4 ROI writer.
- **Sales deck has zero customer proof.** *Blocker: one design partner, one measured result.*
- **Ad and social accounts connect by pasted token,** except YouTube. *Blocker: a developer app and review per network.*
- **LinkedIn rows retired by 1102** need a reconciler or a drop.

### Public surfaces, copy and SEO `[growth]`

- **Free-site badge removal isn't on pricing.** The entitlement is `removeBranding` (`api/src/domain/tenant/PlanLimits.ts`: Free false, Pro and Teams true). The pricing bullets come from the published JSONB document in `platform_pricing_configuration` (`key = 'public'`), not from code. *Blocker: add the line to Free, Pro and Teams in the admin Pricing panel (`PricingPanel.tsx`), then publish.*
- **Chat/canvas merge (VSIX `2026.9.36`) has no `release_notes` row.** *Blocker: a superadmin session in `ReleaseNotesPanel`.*
- **SEO pages have no public renderer.** `marketing_seo_pages` rows hold a title, meta, params and structured data, but no body or template, and no frontend route reads them. So `POST /api/public/web/:owner/seo/impression` has no caller. The counter is ready: KV-buffered `seo.impression`, published rows only. *Blocker: a content model (a template per `pattern`) for what an SEO page renders.*
- **Website pages can only be managed through the API.** `POST /api/web/website` (create, update, and since 2026-11-08 publish and unpublish) has no frontend client, so a tenant can't author or publish a `/w/<owner>/…` page from the product. Platform (NULL-tenant) pages are seed-only. Fix: a website-page editor and a publish control on the typed client. This is new authoring scope, not a regression.

### Distribution `[growth]`

- **VS Code release job goes green without publishing.** `VSCE_PAT` / `OVSX_PAT` unset, and `|| echo` swallows failures. Fail on a missing secret; only "already exists" is a no-op. *Blocker: the two tokens.*
- **Rovr isn't in the Chrome Web Store.** *Blocker: developer account + listing.*
- **Hugging Face push, reviewer test tenant, cloud marketplaces.** *Blocker: accounts, legal entity, partner programs, `ACTION_MIRROR_*`.*
- **[integrations] Miro uses a personal token.** *Blocker: a registered app.*

---

## 🧰 OTHER — enabling work outside the arc

### CI and release `[platform]`

- **CI never runs frontend unit tests; 19 fail in 12 files.** Fix them and add a vitest job.
- **Verify never bundles the Worker.** Add `wrangler deploy --dry-run`; make `deploy-frontend` and VS Code wait for `deploy-api`.
- **A red commit still publishes to the CDN.** *Blocker: operator decision; release order is deliberate.*
- **Flaky or heap-bound tests:** `CreationCanvas.test.tsx`, `agents/sandbox/registry.test.ts:207`, `useBrainConversation.test.tsx`, `harness/scenarios.test.ts`.
- **CI safety:** no ephemeral-DB migrate dry-run; `production` reviewer rule unset; `qa-e2e` in no workflow; no CodeQL workflow.
- **`packages/repo-map` doesn't declare `agent-tools`.**
- **builderforce-inference console builds only when nested.** *Blocker: operator decision on checkout layout.*
- **esbuild < 0.28.1 in `clients/chrome` (0.24.2) and `feedback-sdk` (0.27.7).** Add overrides; dev-time only.

### LLM gateway and routing `[agents]`

- **iOS has no workspace picker.** `CloudAccount.swift` builds `CloudSession` without a `workspaceID` and nothing calls `setWorkspace`, so the shared kit's workspace switch (and its `workspaceSignInNeeded` flag + `chat.workspace.signInNeeded` string) never runs on iOS. Next: add a switcher to the iOS account screen that lists `workspaces()`, calls `setWorkspace`, and shows the sign-in-needed message — parity with Android `CloudAccountSettings`.
- **Who may replace workspace subscriptions.** `/llm/provider-keys` and subscription OAuth routes check membership, not role, including PUT and DELETE. *Blocker: operator role policy.*
- **Code turns resolved to MiniMax Flash with Grok and Kimi connected (chat #6).** Read the recorded `failovers` + `gateway.byo_seed`, then fix the account or the seed rule.
- **Cloud runs have no C8 compression.** *Blocker: an ONNX image build.*
- **Drift guard reads only OpenRouter, NIM, Cerebras;** pools are hardcoded. *Blocker: credentialed refresh inside the Worker.*
- **Only Qwen and Kimi offer a model choice.** *Blocker: one live key per other vendor.*
- **No per-user spend limit;** `usageAttribution.ts` only reports.
- **Image generation has no BYO path.**
- **`llm` workflow nodes use the host key** (`orchestrator.ts:832`).
- **Decide `tenant_model` presets:** retire or rename.
- **Codex OAuth races a local CLI on port 1455.** *Blocker: an OpenAI client registration.*
- **Kimi from cloud agents** is refused at Kimi's edge. *Blocker: Kimi's approval + a non-Cloudflare egress host.*
- **SDK long tail:** split `connectTimeoutMs`/`streamTimeoutMs`; date the `coderclawllm/` prefix removal; register `vision.describe` and `ocr.extract`; move hired.video's own client and cascade onto the SDK.
- **Rovr has no BYO pool pin.** The row is hidden; add a typed pin read by `inference/route.ts`.
- **No on-device model has answered a turn in a real browser.** Add a Playwright + WebGPU run recording telemetry.

### Brain chat `[agents]`

- **Prior-research reuse is prompt guidance only** (`priorResearch.ts`). Add an enforced guard with a staleness rule.
- **Ask-the-Manager zero tool calls.** Log the payload shape in `buildResponsesBody`.
- **Duplicate label tables:** audit each host.
- **`DEFAULT_CHAT_TITLE` has two homes.** Give the Brain chat contract one shared home.

### Evermind / SSM `[agents]`

- **Offline memory, in builderforce-memory.** Open: M07 cache persistence, M08 asset resolver, M10 router, M11 mutation guard. Partial: M03–M05, M09. `clients/vscode/src/cognition.ts` is still server-bound. Done when the review's acceptance 5–7 pass.
- **Per-run faithfulness is relevance-only:** `scoreRunOutcome` passes no context to `lexicalEval`.
- **Coding gate (≥90% of frontier) closed.** *Blocker: a trained checkpoint.*
- **GPU backward pass unvalidated;** no LoRA in kernels. *Blocker: a WebGPU device.*
- **Knowledge pipeline:** review queue, extraction, KRs.
- **Two canonical-JSON serialisers.** *Blocker: a `v2:` hash + backfill.*
- **Foreign-checkpoint weight port.** *Blocker: real checkpoints.*
- **Auto-routing eval gate;** Evermind is pin-only. *Blocker: gate criteria.*
- **Teach:** confirm the console polls the status channel and the provenance backfill ran.
- **builderforce-memory import:** Markdown auto-memory isn't importable. *Blocker: a live MCP stdio host.*
- **Tool turn costs one forward pass per candidate.** Needs a prefix cache.
- **Video/image codebooks untrained.** *Blocker: GPU training.*
- **API doesn't use the enterprise ports;** it imports `bm25Search` directly.
- **External:** transformers.js `model_type`, llama.cpp GGUF, HF push.

### Agent runtime, desktop and VS Code `[agents]` `[platform]`

Synapse lives in [builderforce-inference](https://github.com/SeanHogg/builderforce-inference), Spawn in [builderforce-spawn](https://github.com/SeanHogg/builderforce-spawn).

- **The editor can act in a tenant where the person has no connections.** One VS Code session ran in tenant #1 as `contributor`, while its Kimi, Anthropic, MiniMax, Moonshot and xAI accounts and chats #195/#198 belonged to another workspace. *Blocker: which tenant the key is bound to and why it was selected needs the live membership and key rows.*
- **Direct calls for xAI, MiniMax, Moonshot and Anthropic accounts are not built.** The half-built attempt in a6937d561 was removed: only Kimi has a server credential source (`localCredential.ts`). Add a source per provider, then its runtime entry, to let these accounts run from the person's machine.
- **Packaging does not check installed dependencies against declared ranges.** `clients/vscode/node_modules` held memory 2026.10.35 and engine 2026.10.28 under `^2026.10.37`. Make `ensure-linked-builds.mjs` fail on a mismatch.
- **Shipped VSIX webview still calls `GET /api/boards/:boardId/swimlanes/:laneId/agents`.** The committed bundle `clients/vscode/media/webview/index.js` predates the board's move to `/lane-agents`. The route is kept as a cached compatibility shim in `boardRoutes.ts`; delete it once a rebuilt VSIX ships. *Blocker: VSIX rebuild and release is owned by the VS Code session.*
- **The chat journal rewrites whole rows.** `local-first-v3.journal` reached 226 MB, with a 1.25 MB chat row and 1.3 MB message rows rewritten by routine commits. Opening it is not slow (2.6 s fold), but commits take up to 1.5 s. Store large row payloads apart so a commit stays small.

- **Compaction holds the cross-window lock for the whole rewrite** (2.7 s measured on 20,847 records; `compact` in `durableLocalFirstStore.ts`). Other windows now wait instead of failing, but their writes stall that long. Stream the temp file from `memory.view()` without the lock, then lock, catch up, fsync and rename. *Blocker: operator cut this pass to data-loss fixes (weekly limit, 2026-11-01).*

RESOLVED 2026-11-01: length-prefixed frames make a torn tail detectable; the journal now carries a base-generation id minted per compaction (`mintJournalGeneration`), replacing `(ino, birthtimeMs)` identity; the EPERM-on-rename retry is bounded and falls through to keep the last-good copy; `storeContract.ts` documents that `read`/`scan` return live committed Maps. (Package-side changes shipped in this commit; verified by local-first `tsc` + 559/559 tests.)
- **A damaged journal is slow and quiet.** A refused open repeats its full load on every call (`durableLocalFirstStore.ts:251`), and a read-only window rescans the whole journal on every read (`:294`): remember the corrupt load by identity and size. A rebuild reaches only the host log, so show one notice that names the `.corrupt-` copy. The sidecar lists every row and event id and is parsed on each open: put size and mtime in a small header file. When both windows edit one row, the higher `version` wins silently: create a `SyncConflict`. *Blocker: operator cut this pass to data-loss fixes (weekly limit, 2026-11-01).*
- **Unattributed event-loop gaps.** 1028 ms during the first v3 import and 487 ms across 100 commits, with single commits at 19–34 ms. Instrument the stages. *Blocker: as above.*
- **Scans with no early exit.** `Transaction.scan` walks every type; `sendMessages`, `dropPending`, `chatSyncHost` and `chatSync.ts` repeat it, and `localAuditStore.ts` still lists whole types. A per-type index and a stop-returning visitor remove them. A 13,970-message transcript read takes about 400 ms. *Blocker: as above.*

RESOLVED 2026-11-01 (commit 67f461953): the identity bind in `brainRunHost.run` is now bounded (a documented upper bound in ms), so a slow/unreachable identity endpoint cannot stall the run indefinitely; on timeout the run proceeds on the local/unbound path.

RESOLVED 2026-11-01 (commit 67f461953): the pending-turn wiring and `servedBy` are colocated with `usePendingTurns`; `UNUSED_STORE` is now a single shared export (`composer/unusedDraftStore.ts`) imported by all three consumers; the two `clone` definitions were folded into one shared module.
- **The creation canvas shows no immediate bubble and no live model.** `creation-canvas/BrainSurface.tsx` takes `messages`, `trace` and `running` from the run store, so `pendingTurn` and `servedBy` never reach it. The run store needs to carry both. *Blocker: operator cut this pass to data-loss fixes (weekly limit, 2026-11-01).*
- **The pre-v3 store files stay on disk after import.** `local-first-v2.journal` and `local-first-v1.json.pre-v3` are the rollback copy (about 230 MB on one machine). Delete them on open once v3 has shipped. *Blocker: one release of v3 in the field.*
- **`createIndexedDbLocalFirstStore` reads and rewrites the whole snapshot per call.** `packages/local-first/src/indexedDb.ts`: web work management and Rovr scale with store size, as the VSIX did. Needs per-row persistence or a delta frame. *Blocker: not started; needs an IndexedDB schema change outside the VSIX fix, and an operator call on when.*
- **Local tool turns answered in prose are accepted.** `answered` in `localFirstTransport.ts`; the 0-tool case scores healthy. *Blocker: product decision on holding the first delta.*
- **Ollama loaded at a larger `num_ctx` overstates our window.** *Blocker: move to `/api/chat` or an upstream route.*
- **Windows command routed to bash loses backslashes** (`packages/agent-tools/src/node-posix-shell.ts`). *Blocker: a trace of the routing decision.*
- **Self-Directed Agents are Windows-only.** *Blocker: a Mac; an X11 session.*
- **Installers unsigned, no updater.** Windows and macOS signing are wired; Tauri updater signing isn't. *Blocker: signing secrets in both repos.* Then delete `SpawnDownloadButton`'s first-run hints.
- **~3.3 GB after indexing one small package.** Profiled and the dominant retention fixed (2026-11-01): host `meta.text` kept the full card text per node; now clipped to a 256-char excerpt, full text stays in the engine. See DONE.md.
- **Phase 3 browser/VM host.** *Blocker: prompt-injection defence first.*
- **pi-tui is the last `@mariozechner/pi-*` dep.** 23 importers left; migrate to Ink.
- **Engine convergence:** sandbox-aware provider; `read`, `exec`, `process` stay native; `RelayTaskEngine`.
- **Portal channel config flows up only;** `channel.configure` doesn't exist. *Blocker: a running on-prem host.*
- **`@builderforce` participant forgets tool work after restart;** native sessions tab needs the proposed API; sign-in untested (*blocker: a test tenant + `BF_EDITOR_KEY`*).

### Data model — PRD 20 `[platform]`

- **Primitive adoption:** `runs` and `work_items` have no feature writer.
- **135 ratchet violations:** 109 table adoption, 22 domain boundary, 3 polymorphic, 1 duplicate cluster (`initiatives`/`portfolios`).
- **Legacy shape tables hold live rows.** Backfill, cut over, drop per family.
- **`sessions` and `ai_usage_records` have no writer.** `table-adoption.mjs` rules them superseded. Drop them.
- **Steps 6–7 moving the wrong way:** 155 application folders (target 16), 286 route files, 204 `page.tsx`. Needs an owning lane.
- **Merged-product behaviour missing:** the ATS funnel and growth workflows.
- **Three representations of a message's author.** `brain_chat_messages.author_user_id` (PRD 42, human turns), kernel threads' `authorKind`/`authorRef`, and meeting lines' `metadata.authoredBy`. One fact, three shapes. Consolidate onto one author reference so translation, attribution and audit read the same field.
- **Legacy routes register into `objects` only on the sweep.**
- **Table families straddle modules;** needs an ownership manifest.
- **Migration numbering:** 8 collisions, five ledger rows with no file, 78 drift-allowlist entries.

### Code health `[platform]`

- **Layering ratchet at 96;** 81 presentation modules import the schema. Worst: `creationSessionRoutes`, `adminRoutes`, `qaRoutes`.
- **202 unscoped tenant queries in 89 files.**
- **14 of 37 permissions advisory.**
- **God modules:** `builtinMcpService` 4,607, `adminRoutes` 2,994, `creationSessionRoutes` 2,994, `TaskMgmtContent` 2,761, `agentHostRoutes` 2,173, `ManagerService` 2,126, `managerDiagnostics` 1,878, `boardsync/providers` 1,859, `extension.ts` 1,707, `api/src/index.ts` 1,536, `jobRoutes` 1,261, `MarketplacePageClient` 1,161.
- **QA blind spots:**
  - Coverage is configured only in `agent-runtime/vitest.config.ts`, and there with `all: false`, so files no test loads never count against the thresholds.
  - api, frontend, clients/vscode, packages and brain-embedded have tests (1,369, 699, 190, 409 and 196 files) but no coverage.
  - The API "OpenAPI" is `api/src/openapi/schema.ts`: TypeScript interfaces documenting 9 endpoints, against 2,554 route registrations in 280 modules under `presentation/routes`; only 12 modules have zod request schemas (`*.schemas.ts`). There is no machine-readable spec, so there is no contract testing and no Postman export.
  
  Fixing this unblocks the visualizer's Coverage lens and API view. *The visualizer's Coverage and API panels shipped on 2026-11-05 (VS Code 2026.10.130). They show coverage as "Not set up" and every route as undocumented until this is fixed in the repo: v8 coverage with `all: true` per package, and an OpenAPI 3.1 document generated from the routes.*
- **`builderforceApi.ts` 9,965 lines.** Split to `lib/api/<domain>.ts`. Board rosters (`boardRostersApi.ts`) and Discovery (`discoveryApi.ts`) are out; their changes are uncommitted.
- **Unused primitives:** ~21 `fetchProjects()` callers, 128 raw storage sites, 76 `canEdit` guards, 55 `smoothstep` literals; `stage.connect` has no production caller.
- **Canvas real-browser pass** misses the `+` command bar, bottom nav and Brain-not-covering.
- **PRD 21 nav:** M3 seat workbench, M5 dimmed-row preview.
- **[PRD 22](./docs/specs/22-prd-browser-performance-domain-execution-analysis.md):** LoRA off the main thread, off-thread file and diff work, cache eviction, cyclomatic ratchet, Phase-0 baseline.
- **i18n:** no CJK fallback; re-partition 349 namespaces by domain; measure the hardcoded remainder.
- **Decide:** `BUILDERFORCE_MODELS` fallback.
- **Smaller:** 24 of 113 `recordActivity` calls pass `objectId`; `buildMimeMessage` extraction; `feedback-sdk` is a CDN snippet only; no sweep for pre-OTP accounts.

### Identity `[identity]`

- **OAuth consent name; Google apps test-only.** *Blocker: console field, verification.*
- **OAuth over `/gateway/*` builds the wrong callback.** *Blocker: register in all four consoles.*
- **A canvas turn once sent no tenant token.** *Blocker: a repro.*
- **Segmented mode unusable:** inserts on `segment_id` tables lack `segmentId` (trigger 0056 raises); no RLS, segment roles or no-bleed test.
- **[PRD 05](./docs/specs/05-integration-embed-and-identity.md):** inbound host OIDC. Nothing mints the `acct`/`co` claims `resolveSegment` reads.
- **`tenant_modules` never created** (`platform_modules` and `tenant_member_modules` exist). *Blocker: operator confirms intent.*

### Infrastructure and cost `[platform]`

- **🔴 $0 platform (plan 2026-10-03).** Observability is on and cron is gated. Re-default cloud surface, move QA and CPU routes, take L2 off KV, then downgrade. *Blocker: consoles, CPU measurements, acceptance of 2–4 concurrent agents.*
- **🟠 `builderforce-core` on Neon Launch.** Enable autosuspend + 0.25 CU, then downgrade. *Blocker: Neon console.*
- **Core's stale site tables** (`project_sites`, `site_*`) still sit on core since the apps split. Dropping them is irreversible. *Blocker: a live row comparison of core against apps, which needs database access this session was refused.*
- **Production hardening:** no SIEM export or fleet failover. Design: `docs/specs/39-prd-platform-closeout.md` §4a, §4b. *Blocker: operator decisions in PRD 39.*
- **No row retention on canvas history** (`creation_session_events`, `brain_chat_messages`). Snapshots are plan-capped and command bodies are redacted at 14 days; rows are kept indefinitely. *Blocker: decision on history kept.*
- **🟡 Legacy leftover:** `agents` table still declared at `schema/agents.ts:327`. Design: PRD 39 §3. *Blocker: operator decisions in PRD 39.*
- **🟡 Two stores:** canvas comments vs kernel annotations. Design: PRD 39 §2. *Blocker: operator decisions in PRD 39.*
- **A revoked mailbox fails its campaigns for good.** `failCampaign` writes off every queued row and a failed email campaign cannot restart, so one unknown 403 loses the audience. *Blocker: operator decision to hold rows queued until the mailbox is reconnected instead.*
- **Monitors and board-sync run on the 30-minute floor on an idle platform,** so a 5-minute heartbeat can page up to about 30 minutes late. Prompt checks keep Neon awake permanently. *Blocker: operator decision, paging latency against the Neon cost ceiling.*
- **Neon's quota text over WebSocket is unobserved.** `neonAvailability.ts` matches the published wording. *Blocker: a capture from a quota-exhausted branch.*
- **Cloudflare serves a managed challenge to every datacenter caller.** `POST api.builderforce.ai/mcp` is challenged, so `release.yml` skips the MCP registry publish. Apply `scripts/cloudflare-bot-exception.mjs`. *Blocker: a zone token with Zone Settings:Edit + WAF:Edit.*
- **Strategy content in public git history.** Purge built. *Blocker: a quiet 30-minute window, then GitHub Support for `refs/pull/*`.*
- **Provider credit:** disconnect Moonshot on tenant 1; Together, FluxAPI, HF out. *Blocker: operator.*
- **`http://www` redirect** targets `http://`. *Blocker: a zone-edit credential.*
- **API Worker ~21 MB.** Split `/llm` + `/v1`. Design: PRD 39 §1. *Blocker: operator decisions in PRD 39.*
- **Brand residuals:** rotate `clk_` keys.
