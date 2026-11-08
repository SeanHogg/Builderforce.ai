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
| P0 | People control agent work | Beta | `TOOL_SIDE_EFFECT` wired into policy, failing closed, with a CI check. It has no runtime caller today |
| P0 | Complete agent auditability | Beta | One audit envelope at every mutation entry point. None exists |
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
| [⚙️ Run](#️-run--operate-the-company) | Finance, hiring, people, governance, phone, investor | Tool classification wired; SOC 2 Type I |
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

- **PRD 38 residual items (docs sweep 2026-11-01).** Its Review Persistence section says `docs/knowledge/38-review-*.md`; the actual contract is the `--review-root` CLI flag plus `packages/agent-tools/src/knowledge/reviewRunner.ts` (which writes only `.review/`), and no caller passes a `knowledge/` root. Its Knowledge Client §3 table maps step kinds to statuses (triggered/awaiting_results/etc.) with no corresponding runtime code; either implement or strike. Its §4 asserts the knowledge graph has quote-level and learning-level nodes — only file-level nodes exist.
- **No source of recorded runtime values for the knowledge view (PRD 38).** Several features are wired and tested but have nothing to show yet:
  - The Simulate drawer's recorded and editable values, which use the optional `recordedValues` source port.
  - Path-hop payload sizes ("PUT 1.4 MB"), which need a `payloadBytes` file badge.
  - The Sync drawer's "Traces" row.

  Each one stays honestly empty and never shows a guess. Hop labels show the route only. The cause is that nothing captures the argument and return value at each stop, or the request and response size, during a request or test run. Static extraction (`codeFileBadges`) cannot see these. What fixing it needs:
  - a runtime recorder;
  - a traces source that serves its output to `recordedValues`;
  - a `payloadBytes` badge.

  *Blocker: no runtime trace recorder exists. It is a new subsystem, a candidate for PRD 41's run delta.*
- **Predicted measures over the knowledge graph (planned, not started).** The graph has the inputs, but nothing predicts a measure; only PageRank importance is computed. The shared maths and the per-file predictions are planned in PRD 41 Part D: risk, entropy, shrunk rates, trends and cost estimates. Its formulas live in the builderforce-memory `stats` module (D13); there is no new package.

  PRD 38 adds the graph-only formulas, computed at graph build and stored as badges:
  - P1 Louvain partitions (closes the ≤5% "No partition" acceptance)
  - P4 co-change impact
  - P7 Markov transitions for Simulate

  P2 shows Part D's results on the map. P1 comes first ([PRD 38 › Predicted measures](./docs/specs/38-prd-knowledge-graph.md)).
- **No run delta, and understanding needs `/review` ([PRD 41](./docs/specs/41-prd-offline-understanding-and-run-delta.md)).** Run change sets are recorded (`brainRunHostPorts.ts:381-401`) but nothing reads them. Indexing starts only from `/review`. Analyzers download via `npm exec` (offline fails). A signed-out project selection throws `NOT_SIGNED_IN`. `findingId` changes when a group's members change. Operator decisions taken 2026-11-06 (PRD 41 §12). Next: WS1 (offline closure) and WS2 (SQLite fact store in `.builderforce/cache/`, Opus-reviewed).
- **Cloud run isolation (G1, [PRD 09](./docs/specs/09-prd-cloud-agent-validation.md)).** `enableInternet = true` (`AgentContainerDO.ts:45`) with no egress allowlist or red-team. S5, S6, W2 and B2 are closed; re-audit the rest of the 50.
- **Sandbox capacity.** `max_instances = 25` is shared with previews; when full, a run gets no sandbox rather than waiting.
- **A run with no sandbox cannot build.** It polls branch CI, but `on: pull_request` workflows report `none` until the PR exists.
- **A Stop on one draft can lose another's flushed turn.** Every draft shares the null key in `brain-embedded/src/doorStop.ts`. Key by draft token and test the restore.
- **Failed journal compaction has no backoff.** When a rename or lock keeps failing, the policy stays true, so each queued job in `clients/vscode/src/localFirstCompaction.ts` streams and rewrites the whole store again, delaying commits (no data loss). Next: back off after a failure.
- **The snapshot cache write has no rename retry.** `writeCache` in `durableLocalFirstStore.ts` uses plain `fs.rename`, while the comment at `localFirstAtomicFile.ts:2-4` says it shares `renameDurably`. A transient EPERM skips that cache write until the next commit. Next: use `renameDurably`.
- **`generation` is unused by the VSIX journal.** `packages/local-first/src/journalReplay.ts:92-96` says hosts compare `generation`, but `localFirstJournalIo.ts` uses stat identity, and node's `ino` loses precision. Next: compare `generation`, or correct the comment.
- **`main` is red in 5 CI jobs (since at least `ccee605a5`, still failing on `47fdf4dae`).** `src/tui/tui.ts` was deleted in `4ad0bac97` while `src/cli/tui-cli.ts:79`, `src/commands/builderforce.ts:18` and `src/wizard/onboarding.finalize.ts:31` still use it, which fails the agents typecheck. `brain-embedded/src/run/parity/oracle.test.ts` expects 49 files and finds 48, and most of `snapshot.test.ts` no longer matches the stored record, which fails the oracle and conformance jobs. API guards and frontend guards also fail; their cause is not yet read. Blocker: someone must decide whether the snapshot drift is intended, because regenerating an oracle without that decision hides a real behaviour change. Next: restore or retire the TUI callers, then settle the parity drift.
- **A failed run's branch residue is never swept,** and cancelled-run teardown can delete a live parent's or earlier run's work, because `runCommitMarker` is per task. Needs per-execution attribution. *Blocker: operator decision on deleting run branches.*
- **VS Code chat history doesn't follow the person.** `isOwnRecord` filters other devices' records and `openableLocalChat` doesn't pull the transcript. Fix: re-key on arrival, hydrate from `GET /api/brain/chats/:id/messages`. *Blocker: operator decision; changes what "local first" promises.*
- **Autonomous trigger errors.** 282 `auto_run_error` in 30 days to 2026-10-25 (`autoRunSkipLedger.ts`). Group by reason, fix the top causes.
- **Auto runs may carry no `cloudAgentRef`** (`laneEntryTrigger.ts:323` sets it only with `decision.agentRef`).
- **IDE agent calls tools one at a time** (chat #115: 63 turns, 82 calls). *Blocker: an A/B over real runs.*
- **Multi-repo sandbox.** Per-task repo sets route and open PRs, but `sandboxOpenSpec.ts:26` clones one repo.
- **Architect runs:** `AnalysisRunnerDO` has no per-tool timeline or steering; no commit-webhook re-analysis.

### Local-first `[agents]` `[platform]`

Source: [offline-first review](./docs/design/vsix-offline-first-architecture-review.md).

- **G27: no packaged acceptance suite runs with the network denied.** `deniedNetworkAcceptance.test.ts` mocks `vscode`. Assert zero platform requests and local-only completion in the packaged VSIX, Rovr and Web. Unblocks claiming offline behaviour.
- **G21 + G23: bound-chat rail and sync status.** The rail is live reads with no local copy, and `syncStatusPresenter.ts` has no caller. Both need a local record list UI (G05; `localWorkRepository.ts` serves agent tools only) and a chat-ticket link importer (G15–G18).
- **G03 SQLite store built, unwired.** `node:sqlite` needs VS Code ≥ 1.101; `engines.vscode` is `^1.95.0`. Operator decided 2026-11-06 to raise it to `^1.101.0` (PRD 41 §12.7). Next: bump the floor and wire the store, starting with the PRD 41 fact store (WS2).
- **Sync residuals:** `sync_changes.seq` can skip a late commit (needs a commit-ordered watermark); one transaction per event; a purged dependency leaves `dependency_pending` forever.
- **Three hosts still upload per file, beside the ONE pack (in progress 2026-11-08).** Web and Rovr (`packages/knowledge-browser/src/knowledgeSource.ts:153`, `knowledgeReview.worker.ts`) and on-prem (`agent-runtime/src/agents/knowledge/onPremKnowledge.ts` `reviewPorts`) review straight against `knowledge-client` `client.store`, so each extraction goes up as `PUT …/knowledge/extracted/:hash` (`knowledgePerception.putExtracted`). That breaks the one-upload-path rule. VS Code alone uses the replica stack (`localSnapshotStore` + `replicatedKnowledgeStore` + persisted `ReplicaQueue` + `pumpReplica`). Fix: move the editor's replica stack out of `clients/vscode/src/knowledge/knowledgeStores.ts` into `packages/agent-tools` behind a host `KnowledgeFiles` port (IndexedDB in the browser, the container filesystem on-prem), run all three hosts through it, then delete the PUT route, `client.putExtracted` and `knowledgePerception.putExtracted`. The end-state design goes first.
- **Kimi Code `k3` sends no response headers for 240s on large prompts.** Seen four times: 2026-11-04 in chat #46121, and twice on 2026-11-06 in chat #46169. Each time the editor called `api.kimi.ai/coding/v1` directly with a prompt of about 75K tokens, and the request was dropped at the header deadline in `streamChatCompletion.ts`. One failure was step 0 of a fresh run with a fresh token. The 2026-11-06 pass makes the failure diagnosable (destination, phase, request size and credential state on the failed step, plus an output-channel line) and offers "Choose another model". A live probe on 2026-11-06 with the CLI token found the following. Kimi holds response headers until the first token, so time-to-headers equals queue plus prefill time. A ~75K-token `k3` prompt with 67 tools and `max_tokens: 4096` answered in 11–27s. So prompt size and tool count do not reproduce the stall. Still open are the workspace-connection token (which the failing runs used), the real multi-turn tool history, and a transient Kimi-side stall. **Blocker:** the original request bodies were not recorded, so there is nothing to replay. The new failure detail records request bytes, message and tool counts, and credential state. The next occurrence will narrow the cause down, then replay it against both tokens.

### Autonomous delivery `[delivery]`

Last measured 2026-07-26: 6 of 767 tickets fully autonomous; 69% of 6,195 runs failed. The manager's census tracks this.

- **Backlog lanes in `templateCatalog.ts` seed `gate:'auto'`,** so parked work can spend tokens. `defaultSwimlanes.ts` seeds `human`; existing boards keep their gate. *Blocker: operator decision on re-gating live boards.*
- **`never_started` cohort may be refused for an unmodelled reason.** Query `auto_run_skipped` for five cohort task ids.
- **Status writers bypass the notifier:** `staleExecutionReaper` and self-heal write raw `update(executions)`, and a legacy lane path runs beside the coordinator.
- **Board scoping:** agent chips are a load-time snapshot; `assignedAgentHostId` is separate from `agent_assignments`; priced kanban templates aren't charged at apply.
- **A reviewer's `changes_requested` doesn't reopen the producer slot.** Design call: should a verdict alone spend a run?
- **Stakeholder notifications ([PRD 37](./docs/specs/37-prd-coordinated-role-participation.md)):** `coordinatorVoice` has two callers; the rest are unrouted.
- **Manager pass still conducts PRs** (`ManagerService.ts:1374`). Move it to a registry sweep.
- **Delta→ticket:** a delta on a non-platform branch with no PR link never completes.
- **Manager PR→ticket recovery ([PRD 23](./docs/specs/23-prd-manager-pr-ticket-recovery.md)).** Link `task_reviews` to lifecycle slots; add disposition fields; run the backlog pass; a Manager canary before auto-merge.
- **Boards have no earned-budget ledger or investor milestone.** Build on `ledger_entries`; the milestone rolls up to Run's investor seam.
- **Personality:** no person profile page; `MentionAutocomplete` doesn't use the provider.

### Ceremonies and meetings `[delivery]`

- **Ceremony presence** is set at connect, not re-verified per frame.
- **Retros:** no theme clusters, sentiment trend or action carry-forward.
- **Mesh WebRTC caps at ~4–5 cameras.** *Blocker: a Cloudflare Calls app.*
- **TURN not provisioned** (~10–15% of symmetric-NAT pairs fail). *Blocker: `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`.*
- **Meeting agent voice is browser `speechSynthesis`.** *Blocker: product decision.*

### Canvas runtimes and studio `[canvas]`

- **Six kinds have no editing runtime:** `image, animation, podcast, comic, cad, model3d`. Port one per slice from hired.video through `creationObjectRegistry` data.
- **Knowledge editor has no `drawing` block.** Add a `BlockType` using the canvas drawing runtime.
- **Published `@seanhogg/builderforce-studio` can't be installed:** runtime deps are `file:` paths to private `@webdit/*`. *Blocker: decide to bundle or publish.*
- **Workflow builder:** claim→report has no test; no credential capture on the step form.
- **Voice:** provenance missing for GA; no in-IDE marketplace; embeddings localStorage-only.
- **Video engine:** `advanceState()` is a CPU placeholder; no learned interpolation, ControlNet, inpainting or WebM fallback.
- **3 WebDiT models `available: false`** (wan2.5, mochi-1, ltx2-distilled). *Blocker: ONNX exports on R2.*
- **In-editor voice cloning:** `/ort/ort-wasm-simd-threaded.jsep.wasm` 404s. Keep `onnxruntime-web` at `1.22.0-dev.20250409-89f8206ba4` (asset cap).
- **One build-file write took 35.7s vs 38ms median.** *Blocker: a profile of a build turn with preview running.*
- **Room** has no video or audio.

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

- **[governance] Tool classification is unwired.** `TOOL_SIDE_EFFECT` is reached only by its test; `evaluatePolicyGate` matches by name and defaults to allow; `clients/vscode/src/policy.ts` is a second copy; `BrainActionsContext` and agent-runtime's heuristic fail open. One classifier, fail closed, CI check.
- **[governance] Security automation ([PRD 08 §10](./docs/specs/08-prd-agentic-governance.md)).** Not built: `SECURITY_SCAN`, `SECURITY_REVIEW`, governance-auditor, one mutation-audit envelope, automated evidence, merge gating. `/vuln-scans`, `/dsr` and `/suppression` are CRUD only.
- **[governance] SOC 2 Type I,** the enterprise gate, not started (epic #3062).
- **[finance] Delivery doesn't reach the investor seam.** No milestone tag; `workitem.released` is an outbound webhook only.
- **[hiring] Greenhouse, Indeed and LinkedIn postings have no public URL.** Indeed has none; build the others from the id.
- **[hiring] Source attribution is exact-match;** no applicants imported.
- **[hiring] No Workable connector.**
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

- **Expired claims.** `credential-encryption` and `private-runtime-deployment` passed `reviewBy` 2026-10-03, and the other four expire 2026-11-02, failing `capabilityProof.test.ts`. *Blocker: each claim's owner re-reviews.*
- **Marketing release gate isn't enforced.** `capabilityProof.test.ts` runs in no CI job, and `docs/marketing/CLAIMS-PROCESS.md` claims CI fails on expiry and cites a missing `lib/content.ts`. Run it in the frontend vitest job and fix the doc. Vendor-fact and tested-wording rules have no check.
- **Absolute wording in public copy.** 101 `every/always/never/zero` hits in en.json with no guard. `compare.ctaDesc` ("audit trail on every action") and `definedTerms.writeThroughCognition` ("never a stale-then-reconcile step") contradict Claim-to-Proof. Add a guard, rewrite the false ones.
- **Wordmark spelled two ways.** `BRAND.name` is `Builderforce.ai`; `BuilderForce.ai` remains in places. *Blocker: operator confirms.*
- **First-visit locale detection runs only on `/`.** *Blocker: cost decision.*
- **Free-site badge removal** isn't on pricing. *Blocker: admin-UI action.*
- **Chat/canvas merge (VSIX `2026.9.36`) has no `release_notes` row.** *Blocker: a superadmin session.*
- **Blog translation partial:** 184 English posts, de 78 · es 86 · fr 71 · zh 84, titles for 22; `blogLocale.test.ts` fails. Check bodies for truncation. *Blocker: batch-vs-slice call.*
- **English left in TS:** the fallback at `courseLms.ts:94`, `creationTemplates.ts:40`.
- **`/compare`: six arenas, leaf pages for one.** *Blocker: operator picks which 23 vendors get a page.*
- **Related-article cards may be missing after guest preview.** Check what it renders. *Blocker: placement decision.*
- **Tenant web surface has no renderer** for `/api/public/web/:owner/p/*` or `/:tenantId/seo/impression`.
- **`.page-inner` remains** in `FactsPageClient.tsx`, `RfpDetailClient.tsx`, `globals.css`.

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
- **`builderforceApi.ts` 9,988 lines.** Split to `lib/api/<domain>.ts`.
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
