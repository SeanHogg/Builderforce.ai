# Builderforce.ai — Roadmap & Gap Register

> **Outstanding work only.** Finished work moves to **[DONE.md](./DONE.md)**. Re-validated against production data 2026-10-10.
>
> **Grouped by the method.** Every entry sits under the arc stage it moves a user through — **Idea · Make · Run · Measure · Reach** — and carries its owning domain as a tag (`[canvas]`, `[delivery]`, …, the seats in [DomainService.ts](./api/src/application/kernel/DomainService.ts)). Work that moves nobody through the arc (runtime, gateway, data model, CI, code health, cost) is under **OTHER**.
>
> **Traffic context.** Production is nearly idle (20–130 gateway calls/day; no cloud executions or role dispatches since 2026-10-05). A blocker that waits for "a live occurrence" will not clear itself — someone must run the scenario on purpose.

## How an entry is written

One owner, one verifiable state, one acceptance criterion. Name the blocker, or it is not blocked — scheduling around other work is not a blocker. A Build item names its proof form and the kill condition Measure grades. Authenticated UI registers a destination or Canvas object in the shell and meets PRD 21 (canonical primitives, five locales, both themes, 360px, keyboard/coarse-pointer parity, bottom-centre composer).

## North Star — **Idea to Real**

Declared as spec data and ratcheted by `frontend/scripts/check-methodology.mjs`. This roadmap uses that vocabulary and no other.

- **THE ARC — `Idea → Make → Run → Measure → Reach`.** Five stages: where you are. One source: `ARC_STAGES` in [navGroups.ts](./frontend/src/lib/navGroups.ts); `STAGES` adds `admin` (settings, not a stage). The rail, Product ▾ menu, panel header switcher, canvas phases and the method section all read it.
- **THE LOOP — `Read → Prove → Build`.** How you cross from Idea into Make. Read and Prove (Idea) spend nothing; Build (Make) spends run budget. Owned by [application/realization/](./api/src/application/realization/).
- **Eight proof forms** — `demo-video`, `clickable-prototype`, `smoke-test`, `wizard-of-oz`, `poc`, `pilot`, `phone-line`, `live-system`. A ninth is a registry entry, never a branch.
- **Every proof carries a kill condition**, graded in Measure, which closes the loop back to Idea.

Enabling work is legitimate but never outranks a broken Idea→Real journey.

## The Buyer — the founder, then the team they hire

- **First buyer:** a founder raising in the next few months. The arc is their company's arc; `DOMAIN_MANIFEST` gives them all seventeen seats from day one.
- **Hook:** the fundraising pack (deck, model, metrics, data room) grounded on connected books — mostly built already in [`rfpService.ts`](./api/src/application/rfp/rfpService.ts) and [`dataRoomSharing.ts`](./api/src/application/investor/dataRoomSharing.ts).
- **Retention:** a diligence document at `requested` is a hole in the raise; its `category` names the seat that closes it.
- **Expansion:** a seat becomes a person. Pricing is fixed (2026-08-24); packaging is open — Pro caps `maxSeats: 1`, so the first teammate jumps $29 → five-seat Teams.
- **Guardrail:** the pack is `🔄 Partial` until a release-gated journey test passes. No accounting adapter has run against live data, and no BurnRateOS rows have moved — copy must not say otherwise.

## Consolidated Feature Register

| Feature | Area | P | Target | Status |
|---|---|---|---|---|
| Managed Agent hosting add-on ($49/mo/Agent) | Revenue | P0 | Q3 2026 | 🔄 In Progress |
| Onboarding — first Agent in < 5 min | Revenue | P1 | Q3 2026 | 📋 Planned |
| Marketplace monetization (listing + tx fee, Stripe) | Revenue | P1 | Q3 2026 | 🔄 Partial — awaits Stripe secrets |
| Enterprise license GA (on-prem Docker) | Revenue | P1 | Q4 2026 | 📋 Planned |
| SOC 2 Type I audit | Revenue | P1 | Q4 2026 | 📋 Planned |
| Live orchestration workspace (real-time DAG) | Agents | P0 | Q3 2026 | 🔄 Partial |
| Inline diff / pair-programming (TUI accept/reject) | Agents | P1 | Q3 2026 | 🔄 Partial |
| Session auto-checkpoint (`/sessions`, `/undo`, `/fork`) | Agents | P1 | Q3 2026 | 🔄 Partial |
| Remote task result streaming | Agents | P2 | Q3 2026 | 📋 Planned |
| Multi-model role routing | Agents | P2 | Q3 2026 | 📋 Planned |
| Spec import from GitHub Issues / Linear / Jira | Agents | P2 | Q3 2026 | 📋 Planned |
| Remaining Canvas actions onto the outcome contract | Analytics | P0 | Q3 2026 | 🔄 In Progress |
| Rendered presentation export of the value brief | Revenue | P1 | Q3 2026 | 🔄 Partial |
| Phase 6 — activity/integration engines, scheduled reporting, PRD orchestration, analytics UI | 6 | P0–P1 | Q3–Q4 2026 | 📋 Planned |
| Phase 7 — policy packs, governance-auditor, BLOCKER-gates-merge, SOC2 evidence ([PRD 08](./specs/builderforce/08-prd-agentic-governance.md)) | 7 | P1–P2 | Q3 2026 | 📋 Planned |
| Local LLM execution (llama.cpp/Ollama tools, hybrid routing) | 3 | P2–P3 | Q3 2026 | 📋 Planned |
| Multi-agent orchestration at scale (DAG UI, memory mesh) | 4 | P1–P2 | Q3–Q4 2026 | 📋 Planned |
| Production hardening (self-hosted, fleet failover, SIEM export) | 5 | P1–P3 | Q4 2026 | 📋 Planned |

## ARR Milestones

| Period | Target ARR | Key driver |
|---|---|---|
| Q3 2026 | $50K | Teams plan + Agents LLM |
| Q4 2026 | $200K | Enterprise pilots + marketplace |
| Q1 2027 | $500K | Enterprise + marketplace |
| Q2 2027 | $1M | Scale + enterprise contracts |

## Key Metrics

**North star:** share of ideas reaching a **graded proof** (kill condition measured, not just a deliverable).

Read→Prove: time to a chosen proof form · share of ideas Read before Build. Build: proofs reaching a reachable artifact · pass rate · retry rate. Measure: share of proofs graded. Collaboration · Compounding (resumed in 7/30 days, outputs reused) · Efficiency (interventions and cost per outcome) · Integrity (actions with a correlated terminal outcome). Stars, downloads and agent counts are diagnostics only. All computed from the correlated outcome ledger — contract: [OUTCOME-METRICS.md](./docs/design/creation-canvas/OUTCOME-METRICS.md).

## Claim-to-Proof Product Program

Public copy describes today's evidence. **Available** = shipped + repeatably verified · **Beta** = named limitation · **Planned** = never presented as current. No `every`/`always`/`never`/`100%`/`zero`/`instant` unless a test proves the boundary.

| P | Promise | Honest position today | Proof required | Status |
|---|---|---|---|---|
| P0 | One canvas from idea to real | Connects supported artifacts into supported delivery | Release-gated journey test per marketed artifact | 🔄 Partial |
| P0 | People control agent work | Policy gates on configured paths | Classify every mutating tool; CI fails on an unclassified one | 🔄 In Progress |
| P0 | Complete agent auditability | Supported workflows emit records | One audit envelope at every mutation entry point | 🔄 Partial |
| P0 | Private, local AI work | WebGPU is local; collab/eval/publish transmit | Boundary manifest per action, shown before execution | 🔄 In Progress |
| P1 | Evermind stays current | Keyed updates replace superseded facts | Provenance, contradiction detection, freshness budgets, stale-recall evals | 📋 Planned |
| P1 | Same work in VS Code | Engineering surface for canvas + delivery | Web↔extension parity matrix + contract tests | 🔄 Partial |
| P1 | Connected delivery, no sprawl | Services stay independent | Per-connector health, sync direction, conflict + recovery | 🔄 Partial |
| P1 | Costs connect to outcomes | Rolls up where instrumented | Unattributed-spend coverage, reconciliation, task→initiative rollups | 🔄 Partial |
| P2 | Create "anything" | A named set of artifact types | Limits, exports, owner, working example per registry entry | 🔄 In Progress |
| P2 | Model/provider freedom | Many options; availability varies | Provider copy generated from the live catalog | 📋 Planned |
| P2 | Fair comparisons | Criteria-first, five indexed pages | Sourced, dated, reviewed, auto-expiring vendor facts | 🔄 In Progress |
| P2 | Value for CEOs/revenue leaders | Broad capability, little outcome proof | Measure Idea → proof → Build → graded kill condition | 🔄 In Progress |

**Marketing release gate:** status, owning capability, automated evidence, prerequisites, data boundary, tested wording, sourced comparisons, runtime-derived pricing.

## Programs

- **hired.video absorption** ([PRD 18](./specs/builderforce/18-prd-hired-video-port.md)) — 100% deprecation to a redirect shell. Every remaining table maps to an existing primitive (`data-model/source-to-target.tsv`, 363/363); the rest is application code over existing tables. Affiliates = the Associate program.
- **burnrateos.com shutdown** ([PRD 19](./specs/builderforce/19-prd-burnrateos-consolidation.md)) — a parity obligation: an unbuilt, unretired capability is LOST at shutdown. Held by `check:burnrate-parity`, `check:no-burnrate-runtime`, `check:burnrate-policy`. No row migration (2026-09-05). B1/B2 founder loop shipped 2026-09-15. PRD 19 §2 governs twelve capabilities both programs claim. *Operator work:* provider customer actions, identity-cutover comms, redirect verification.

## Risk Register

| Risk | Prob | Impact | Mitigation |
|---|---|---|---|
| Anthropic/OpenAI ships a multi-agent IDE | High | High | Self-hosting + open-source moat |
| Cursor/Windsurf add MCP + multi-agent | Med | High | Live workflow DAG + agent mesh |
| Free-tier model costs too high | Med | Med | Rate limiting + gateway margin |
| Long enterprise sales cycle | High | Low | SMB Teams plan first |

---

## Consolidated Gap Register — by stage of the arc

| Stage | What belongs here | Next milestone |
|---|---|---|
| [💡 Idea](#-idea--read--prove) | Starting a session, reading a brief, choosing and running a cheap proof | Release-gate the group-chat journey; idea validation by asking the market |
| [🔨 Make](#-make--build) | Agents and people building: cloud/IDE runs, PR loop, boards, canvas runtimes, previews, hosting | Every marketed delivery adapter release-gated; container runtime live |
| [⚙️ Run](#️-run--operate-the-company) | Operating the company: finance, hiring, people, governance, phone, investor | The fundraising pack end to end on connected books |
| [📊 Measure](#-measure--grade-the-proof) | Grading proofs and seats: metrics, dashboards, experiments, OKRs, sessions | The 45 domain metric keys written by real rollups |
| [📣 Reach](#-reach--sell-be-found-grow) | Marketplace, marketing, paid/social, SEO, public surfaces, distribution | First customer proof; live ad/social consent flows |
| [🧰 OTHER](#-other--enabling-work-outside-the-arc) | Runtime, gateway, Evermind, desktop, data model, VS Code, CI/CD, code health, cost, ops | $0 platform plan; core inside Neon Free |

---

## 💡 Idea — Read · Prove

- **[canvas] Ideas surface and Brain's "no data" reply read as unfinished.** Lede and empty body repeat; both point at "the prompt below" while the composer is in the right rail; the stepper stays on Make; Capture misses request-shaped text; the reply asks for an object ID instead of offering Paste / Upload / Plan an interview; header says "Brain" not the chat title. Mockup: frames 1–3 of https://claude.ai/artifact/KcEJGhrZaQMQWEMSHNJjyE. *Blocker: operator go-ahead (the 2026-10-04 pass was scoped to the chat panel).*
- **[canvas] Validating an idea by asking the market is unbuilt ([PRD 27](./specs/builderforce/27-prd-idea-validation-surveys.md)).** The `form` primitive has a server and zero frontend callers (`publishForm`/`closeForm` unused; `canvas_publish_form` doesn't exist); `idea` advertises `explore`/`test` but isn't in `CONNECTED_CANVAS_ACTIONS`; `IDEA_EVIDENCE_KINDS` has no consumers. Tracks B0–B5. Adjacent: `builtin_canvas_bind_ab_test` missing, no SMS/scheduled sends, clicks don't record the link, four unjoined contact stores, two survey stores, CSAT/NPS `question_set_id` unrendered, `newsletter_subscribers` siloed. Not blocked.
- **[canvas] Wizard-of-oz `/queue` and `/pilot-report` are public and expose participant contacts.** They ship `verify: 'none'`; a seeded blocking ticket is a request, not a control. Fix = per-realization read secret, signed link, or the console behind app auth. *Blocker: product decision on where an operator console lives.*
- **[canvas] Instrumented `/api/creation-sessions/claim` failure not yet observed.** The catch now logs PG code, constraint, statement and id counts to tell the fixed case-collision cause from any other. *Blocker: a live occurrence.*

---

## 🔨 Make — Build

### Cloud and IDE agent runs `[agents]`

- **Cloud agents only happy-path validated — 50-gap PRD ([09](./specs/builderforce/09-prd-cloud-agent-validation.md)).** P0: V2 runs `bypassPermissions` + Bash on shared infra with no documented sandbox (G1); Worker fallback ignores steering/cancel (S5/S6); errored runs leak the workspace (W2); a missing BYO key may fall to a platform key (B2).
- **`cloud-container` executor needs a live image.** Built; account is Containers-paid (2026-09-22). Until `wrangler deploy` builds it and `/health` passes, `chooseCloudExecutor` silently demotes container runs to durable — paid workspaces defaulting to container get serverless with no explanation. Bounds: `sleepAfter` 20m, clone token in shell, GitHub-only tokened clones, no `ask_human` on containers. *Blocker: image build + deploy.*
- **Container / Actions runners still cap at `CONTAINER_MAX_STEPS` = 40.** Every other surface stops only on the kernel failure-streak breaker. The image (`api/container/server.mjs`, Actions template) must be rebuilt with the breaker; until then the launcher keeps sending 40. *Blocker: container build + deploy.*
- **Brain-created project with no repo → board-dispatched coder returns prose** (`builderforce-coding-dispatch.ts` "No repo bound"). Fix = scratch repo at project-create, or route designer projects through the IDE workspace.
- **Cloud loop can't build/type-check/test in-run (no shell).** Falls to CI-on-PR + webhook auto-fix, or Container/on-prem. No pre-`finish` self-review. V1 auto-merges unverified code when `CLOUD_AUTOMERGE_REQUIRE_GREEN` is off — make green the default once webhooks are everywhere.
- **Cloud execution doesn't clone/analyze the repo or write `PRD.md`.** Hoist the PRD-first step into `dispatchAndQueue`; PRD commit is GitHub-only; no agent task-mutation tool or agent identity; Auto runs carry no `cloudAgentRef`.
- **IDE agent calls tools one at a time.** Chat #115: 63 turns for 82 calls (8m41s model vs 5m45s tools); it can batch (turns 47–52) but nothing asks. *Blocker: an A/B over real runs.* Unblocks ~halving survey-run wall-clock.
- **`review_ticket_branches` excluded from read-dedupe** — `ReadCoverage` needs repo-state-aware invalidation (a cached review would survive `git_push`). Not blocked; repeats cost 21–31s.
- **Staffed-chat dispatch and chat run-history not run end to end.** *Blocker: one deliberate cloud run on a staffed chat with a bound repo.*
- **Grok (`xai-oauth/grok-4.6`) tool calling has no live verdict** (chat #104: 0 tool calls). *Blocker: an xAI credential in a shell* — then `node api/scripts/xai-tool-call-smoke.mjs --tools 2`, `5`, `67`, `67 --stream`, and `xaiOAuth.live.test.ts`.
- **Cloud observability is poll-only.** Needs a per-execution SSE/WS tail; auto-run creation isn't pushed; container hard-death can't push a live event (needs a cross-isolate notifier).
- **Multi-repo spanning:** one run = one repo/branch/PR. Needs a per-task repo set routed by matchHints/pathGlobs.
- **Architect/auto-merge finalize:** `AnalysisRunnerDO` has no per-tool timeline/steering; project list omits `hasArchitecturePrd`; no `POST /runs/:id/retry`; no commit-webhook re-analysis; `json_object` not strict `json_schema`.

### Autonomous delivery `[delivery]`

> Measured 2026-07-26 across 767 tickets: 6 fully autonomous, 755 stalled, 409 never dispatched; 69% of 6,195 runs failed. Stall causes: 313 `no_agent`, 149 `lane_requirement_gate`, 116 `run_cap_exhausted`, 100 `will_run`, 70 `no_board`/`no_lane`. The manager's census measures this continuously.

- **Backlog lanes seed `gate:'auto'`, so parked work can spend tokens** (299 of 313 `no_agent` tickets sit there). *Blocker: operator decision* — it changes every built-in template on live boards.
- **`never_started` cohort fell 370 → 200 after 0384/0385; the rest may be refused for an unmodelled reason.** *Blocker: query `auto_run_skip.reason` for five cohort task ids.*
- **Lane chaining is single-hop** (`RUNNING→in_progress`, `COMPLETED→in_review`); unify with `SwimlaneCoordinator` for BA→Dev→QA. Bypassed status writers (`staleExecutionReaper`, DO `db.update`) surface only via the backstop poll — funnel through one notifier or an outbox.
- **Board columns are hardcoded `TASK_STATUSES`, not the board's swimlanes** — custom lanes show no column; needs lane merge/reassign and per-lane automation flags.
- **Teams/assignee scoping:** lane picker not team-scoped; all-projects board can't scope per-task; agent chips are a load-time snapshot; no epic parent/child tree; three "assign an agent" notions (`assignedAgentHostId`, `project_agents`, `project_agent_id`) want unifying; template sales are free grants.
- **Capability guardrail** only enforces an explicit `required_capabilities` (no capability-aware routing or lane default); cross-board moves don't re-point `tasks.segment_id`.
- **A reviewer's `changes_requested` doesn't reopen the producer slot itself** — the manager return path does (`reopenProducerSlots.ts`). Design call: should a verdict alone spend a run (needs a loop-safe "asked since" marker)?
- **`decideTicketReadiness` may bounce mis-classified spec tickets** back to implementation (bounded by 3-attempt escalation). Verify `expectsCode` against `taskType`/`actionType`.
- **Role participation:** PRD per-role sections aren't audit-verified; outbound stakeholder notifications aren't all routed through the Coordinator identity ([PRD](./PRD-coordinated-role-participation.md)).
- **Manager pass still carries the mechanical PR loop** — move it to its own registry sweep; if `notReached` stays near `projects`, use a per-project DO alarm, not a bigger pool. Sequenced behind one `notReached` capture.
- **Delta→ticket capture:** marketplace-hired Validator unverified; chat deltas off the PR branch won't auto-complete.
- **Personality** isn't on a person profile page or brain @-mentions (needs `AssigneeProfilesProvider` there).

### Ceremonies and meetings `[delivery]`

- **A finished meeting's minutes never reach the canvas.** The `standup` node launches `ceremony_sessions`, but nothing writes minutes or action items back to it.
- **Ceremonies:** presence not re-verified per frame; client-driven `changed` and auto-dispatch; no session history or retro/poker integration; drag has no ghost or keyboard a11y and doesn't work on touch (mobile is view-only — add tap-to-assign); no turn pause/resume.
- **Mesh WebRTC caps at ~4–5 cameras.** *Blocker: a Cloudflare Calls app + server-side track push/pull.*
- **TURN relay not provisioned** (~10–15% of symmetric-NAT pairs fail). *Blocker: create the TURN key and `wrangler secret put CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`.*
- **Meeting agent voice is browser `speechSynthesis`.** *Blocker: product decision on each agent's voice.*

### Canvas runtimes and studio `[canvas]`

- **Eight kinds have no editing runtime** (`video, voice, podcast, image, animation, comic, cad, model3d`, plus `drawing`) — they return a manifest ([PRD 18](./specs/builderforce/18-prd-hired-video-port.md)). Port from `C:\code\hired\hired.video\frontend\lib\studio` one kind per slice, dynamically importing heavy deps, through `creationObjectRegistry` data — never grow `CreationCanvas.tsx` (1,165 lines). Not blocked.
- **One build-file write took 35.7s vs 38ms median** (session `local-148925cf`, `Layout.css`). *Blocker: a profile of a Studio build turn with preview running.*
- **Knowledge editor has no `drawing` block.** Add a `BlockType` opened through the canvas drawing runtime once ported.
- **Real-time co-editing live smoke.** *Blocker: next api deploy + a 2-client smoke.*
- **Generated `.rbxlx` never opened in Roblox Studio.** *Blocker: one human opening one place.*
- **Spawn not run end to end** (install → device sign-in → age gate → Stripe membership → `SpawnPlugin.lua` → build as one undo → play-test `/log`), plus the `spawn.builderforce.ai` zone route. *Blocker: a desktop with Studio and a Stripe-enabled account.*
- **Room:** speech bubble doesn't scroll to its `brainMessageAnchorId` (not blocked); no video/audio in the Room (needs a `video` prop surface, texture budget, distance gain); station faces and widget iframe untested in a real browser; `GET …/widgets/:widgetId` has no route test.
- **Voice:** consent/provenance gate blocks GA; no in-IDE marketplace browse/checkout; embeddings localStorage-only; Studio video IndexedDB-only (mirror to R2).
- **Video engine:** `advanceState()` is a CPU placeholder; no learned interpolation or motion module; img2img drifts; no ControlNet/inpainting; Safari needs a WebM fallback. Brain-created dataset files bypass registration.
- **4 WebDiT models registered `available: false`.** *Blocker: diffusers→ONNX export per architecture uploaded to R2.*
- **In-editor voice cloning needs the ONNX runtime on the CDN.** *Blocker: next frontend `cf-deploy`* — verify `curl -I https://builderforce.ai/ort/ort-wasm-simd-threaded.jsep.wasm`. Keep `onnxruntime-web` pinned to `1.22.0-dev.20250409-89f8206ba4` (newer `jsep` exceeds the 25 MiB asset cap).
- **Workflow builder (canvas IS the workflow):** branch nodes don't prune; transforms are template-only; `mcp` nodes have no transport; no per-integration credential capture; definitions not project-scoped; claim→execute→report not integration-tested; wire `WorkflowConfig`/`StepTypeRegistry` + a "Run Stack Check" timeline.

### Mobile modality `[canvas]`

- **Device simulator is react-native-web**, not native (camera/push/navigation differ). Needs Metro or an Expo build service.
- **Scan-to-phone QR points at a built deploy**, not a live dev server.
- **The 0-byte-scaffold writer is unidentified.** Audit every empty `put` under `ide/projects/` and reject 0-byte writes to scaffold paths at the route.

### Previews, repos and hosting `[canvas]` `[integrations]`

- **Live container preview (phase 2).** Code complete behind `PREVIEW_INGRESS_ENABLED`. *Blocker: `wrangler deploy`, migration `0948_preview_sessions.sql`, a proxied `preview` DNS record, the flag secret* — then confirm WS upgrade and phone HMR.
- **Repo-backed Designer:** `createRemoteRepo` GitHub-only; commit-back has no merge guard (`last_synced_sha` never populated); import capped at 200 files/5MB and one-way; worker vs api R2 prefixes diverge; no server-side file-content guard; WebContainer new-tab preview loses `window.opener` under COOP.
- **Drive as a project's primary storage isn't wired** — IDE storage is inline R2 in `ideRoutes.ts`. Needs a `StorageProvider` port, per-project `storage_backend`, Drive path↔id mapping. *Blocker: a live Google OAuth app.*
- **GitHub App doesn't exist** — calls use the tenant PAT (Checks degrade to statuses; 28 GraphQL 403s this week; rate limit on 2026-09-16). *Blocker: register the App and `wrangler secret put GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`.* Same for the refused PR-reconciliation PAT: a fresh token or the App.
- **Multi-provider PR loop needs live GitLab/Bitbucket creds;** Bitbucket detail is state-only, GitLab lacks per-file stats, both return null `commitUrl`. Bitbucket Server can't use PR detail, repo bridge or CI context (`allowBitbucketServer` only on branch/PR callers); neither edition can revert.
- **Post-merge validation + auto-fix is Actions-only**, reuses the merged branch, needs a `merge_sha`, gets step names not log tails.
- **Actions never-scheduled reconcile is precise only for repos re-enabled after 2026-07-19.** Others fall to the 20-min reaper. Fix = "Enable agent runs" again or re-commit the workflow everywhere.
- **Surface picker warns rather than disabling Actions** on a repo that can't run it.
- **QA and security findings have no `{path, line}`** — no inline PR comments or annotations from those producers.
- **A published site can't run customer-authored server code** (no `eval` on Workers). Needs Workers-for-Platforms or container-mode web serving.
- **Custom-domain certificates code-complete, not live.** *Blocker: Cloudflare for SaaS entitlement + `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_SAAS_API_TOKEN`.*
- **No generated self-hosted deploy (AWS/GCP/Azure) has run against a real account.** *Blocker: three cloud accounts.*

### QA `[canvas]`

- **Agentic Tester:** container deploy pending a green build (<2000MB, first live browser run); lifecycle unproven; not an `ide_agents` entry or workflow trigger. Pipeline gaps: no network sandbox, screenshots not in R2, routes beyond `/`, single-actor only, heat not project-scoped. A cross-browser verdict needs this container.

---

## ⚙️ Run — operate the company

- **[finance] Report schedules have no frontend** — `POST /api/reports/schedules` accepts a `board_pack` subject and the frame picker endpoint exists; build `ReportSchedulesPanel`. `biApi.getValidationEngagements` has no card.
- **[hiring] FO-B4 `jobPosting.distribute` has no adapter.** Connectors exist (Greenhouse, Lever, Workable, Indeed, LinkedIn, `job-feed`); missing: a `job_posting_distributions` table and a `response` mapping on manifest actions. Then add it to `CONNECTED_CANVAS_ACTIONS`. Unblocks source attribution.
- **[integrations] Business Phone is a Twilio CPaaS number, not a carrier** (no port-in, SIM, call-forward). *Blocker: business decision.*
- **[integrations] Phone numbers have no A2P 10DLC registration** (`phoneNumbers.ts` `purchaseNumber`), so outbound SMS can degrade. *Blocker: operator decision on Trust Hub/Messaging Service resources and fees.*
- **[integrations] Google Drive / OneDrive can't complete consent.** *Blocker: enable Drive API + `drive.readonly` on the consent screen, delegated `Files.Read` in Azure, register both `/api/drive/callback/*` URIs.*
- **[governance] Security automation incomplete:** scanners and repo-access population, one mutation-audit envelope, governance-auditor findings, automated evidence, merge gating, per-segment DSR. Live agent audit run needs a repo credential + cloud runtime. Reconcile PRD 08's checklist first.

---

## 📊 Measure — grade the proof

- **[platform] 14 of 17 seats write no domain metric.** `DOMAIN_MANIFEST` declares 45 keys; only `kernel/rollups/{finance,operations,legal}.ts` write `metric_facts`. Also missing: `channel_performance`, `site_traffic_daily`, `arr_projections`, `quota_attainment`, `rd_financials_quarterly`. Follows the PRD 20 data move. This is the open half of Measure.
- **[finance] Vertical KPI Dashboards — Slice B next ([PRD 25](./specs/builderforce/25-prd-vertical-kpi-dashboards.md), build hand-off [25a](./specs/builderforce/25a-vertical-kpi-dashboards-implementation.md)).** Slice A shipped 2026-09-16. B: `growth.*` keys, LTV tranches, benchmark seeds for `saas`/`ai_ml` (kill: tiles read "Not measured"). C: `exitWaterfall.ts`, `exitScenario`/`marketSize` kinds (kill: disagrees with a hand spreadsheet). D: remaining eight verticals (kill per vertical: no design partner). No new tables.
- **[growth] Session replay, heatmaps and live visitors — designed, not built ([design 2026-10-10](https://claude.ai/artifact/ThFJoMFxQ8hguwVJWV82Ea)).** Superadmin first, then a Marketplace capability reviewed in the buyer's canvas under Measure ▸ Sessions. Must extend the existing visitor stack: (1) merge Users ▸ sessions (`GuestSessionsPanel`) and Growth ▸ visitorFlow into one Growth ▸ **Visitors** destination (Flow · Leads · Recordings · Heatmaps · Live), retiring both `lib/adminGroups.ts` sub-keys; (2) one SlideOutPanel visitor drawer (Replay · Journey · Lead) replacing `GuestSessionsPanel`'s own and `VisitorJourneyDrawer`; (3) one `StatTile` in `admin/adminShared.tsx` replacing the identical `FunnelStat`/`Stat`; (4) one capture stream — events stay `visitorJourney.ts` → `activity_log`, recordings go to R2 by `visitId`, clicks reuse `deriveSelector` (extracted from `lib/qa/telemetry.ts`), `QaHeatmapService` becomes the one heatmap read model, error markers from `qualityIngestRoutes.ts` `visitor.error`; (5) one identity — `bf_visitor_id` + `bf_visit_id`, minted first-party by the customer loader; numbers from `useSiteAudience`; (6) replay opens audited via `writeAdminAudit`. *Blocker: operator go-ahead plus three decisions — rrweb vs in-house recorder, storage/retention per plan, per-site vs per-workspace pricing; the paid leg also needs the Stripe secrets.*
- **[growth] `experiment` records results nothing produced.** It stores authored variants with no binding to `ab_tests`, no landing-page variant, no traffic split. Bind to `ab_tests` + a variant field on `website`/`prototype`.
- **[growth] `useFounderJourney()` computes only `idea`/`run`.** Make/Measure need a per-tenant read of the graded-proof ledger (`outcomeMetricContract`).
- **[delivery] hired.video `people_strategic_objectives` would fork the OKR store** — map onto `objectives`/`key_results` and invalidate `projectsList` on write.
- **[canvas] Phone surface switcher isn't phase-gated** — a phone user reaches Insights from Idea; desktop withholds it until Measure. *Blocker: a phone design for the phase control.*
- **[canvas] Academic integrity ledger is never written,** so every verdict reads "no record" while the composer says turns "are recorded". Append events on the `edits.patch` → `updateNodeData` path. Not blocked.

---

## 📣 Reach — sell, be found, grow

### Marketplace and commerce `[commerce]`

- **Buyer can't drive a listing before buying (Stage sandbox parked).** *Blocker: infrastructure decision on the throwaway tenant and who pays.*
- **Monetization partial:** `'agent'` isn't an `artifactTypeEnum` value (no purchase/payout); "Hire" only bumps `hire_count`; template/skill/persona installs are free; hosted-card one-off settlement for knowledge listings isn't wired (`{ requiresConfig: true }`) — settle once, landing on the `ledger_entries` unique reference. *Blocker for the live leg: Stripe secrets (see OTHER · billing).*
- **Affiliates = the Associate program** — reconcile six tables onto `sales_*` with commissions as `ledger_entries`; retire `growth.affiliate_referrals`.
- **Company directory family is inert** — `companies` is tenant-scoped with no owner/verification column. Level 2 nav waits on PRD 19 tracks; `earnedRung()` vs `RosterNav.earned()` want reconciling. *Blocker: PRD 19 B0 company graph + an answer to PRD 21 §7 decision 4 (list non-opted-in businesses?).*
- **Marketplace categories:** add `jobs` (reuse `listJobs()`); `projects` needs a decision on visibility.
- **`requiresWorkspace(delivery)` has no frontend seam** — wire a `SessionGate`-shaped refusal into the buy control.
- **Gigs:** fixed bids have no escrow/milestones; two publish paths could converge; eval scores aren't on an insights lens.
- **Upwork parity:** escrow books are correct but money out rides the env-gated `PAYOUT_WEBHOOK_URL` stub; no 1099/W-8BEN/W-9; no payment-verified badge, bid economy, packages or agency accounts.
- **Freelance/talent:** avatars full-size; payout and notify-email webhooks unset; `available_for_hire` schema drift needs a migration or allowlist.
- **Advisor platform specified, not built ([PRD 26](./specs/builderforce/26-prd-advisor-platform.md))** — no Book on talent profiles, `/api/meetings/*` all authed, minutes don't create follow-ups.
- **[integrations] Publishers can't list a canvas pack or prompt** — need `canvas`/`prompt` output kinds. *Blocker: product decision on what a purchased pack becomes.*
- **[integrations] Developer Portal:** no live card run (Stripe secrets); hyperscaler listings need seller accounts; design-partner work is human.

### Marketing and campaigns `[growth]`

- **Prompt-driven campaign ([PRD 30](./specs/builderforce/30-prd-guided-marketing-campaign.md))** — "run a marketing campaign" still maps to a portfolio table. Next: C1 `canvas_connect_mailbox`, C2 catalog use-case, C3 ICP on canvas, C4 campaign ROI. Don't clone HubSpot.
- **Sales deck has zero customer proof.** *Blocker: one design partner and one measured result.*
- **No ad adapter has run against a live account** (eight, all recorded-payload tested). *Blocker: a sandbox/live account + developer app per network.*
- **Ad and social accounts connect by pasted token, not OAuth.** Code side is a registry entry + callback per network. *Blocker: a developer app and publishing/spend review per network.*
- **LinkedIn rows retired by 1102 (`retired:li-*`)** — needs a reconciler to re-point them, or an operator call to drop.
- **YouTube publishes from the canvas, not from a social campaign** (`publishMode: 'none'`); `youtube_uploads` (1095) has no writer. Build the chunk sweep, then flip to `'media'`.

### Public surfaces, copy and SEO `[growth]`

- **Wordmark spelled two ways** (`Builderforce.ai` ×84, `BuilderForce.ai` ×7; logo says BuilderForce.ai). *Blocker: operator picks one.*
- **First-visit locale detection runs only on `/`** (assets bypass middleware). *Blocker: cost decision* — `run_worker_first` per path vs a Transform Rule vs client detection.
- **Claim `credential-encryption` passed `reviewBy` (2026-10-03); `capabilityProof.test.ts` fails.** *Blocker: owner re-reviews and resets the date.*
- **Free-site badge:** add "Remove the badge" to Pro/Teams pricing and announce it. *Blocker: admin-UI actions.*
- **Chat/canvas merge (VSIX `2026.9.36`) has no `release_notes` row.** *Blocker: a superadmin session.*
- **Blog translation partial** — 162 posts; title/description for 8; bodies de 61 · es 69 · fr 54 · zh 67; `blogLocale.test.ts` fails. Diff each stopped-mid-write body for truncation. *Blocker: translation content + batch-vs-slice call.*
- **English marketing copy in TS:** `lib/content/*`, `routeMarketing.ts`, `blogData.ts`, auth panels, `buildLlmCourse()` — translate all (2026-09-12). Re-measure literals first.
- **`/compare`: six arenas, leaf pages for one.** *Blocker: operator picks which of 23 markets get a "vs" page.*
- **Related-article cards gone from 34 app routes** after guest preview. *Blocker: placement decision.*
- **Tenant web surface has no renderer** for `GET /api/public/web/:owner/p/*` or the impression POST. Hoist `structured-data.ts` server-side in the same pass. Not blocked.
- **Guest fixtures cover 16 endpoints** — add `/api/pmo/*`, `/api/insights/funnel`, marketplace lists.
- **Docs/marketing residuals:** verify `/docs/*` proxies not redirects; `.page-inner` vs `PageContainer`; client-set teaser heads; per-article OG images; three unconnected feature lists; CSS-only header dropdowns; hero pacing in light mode.
- **Distribution:** Hugging Face (account + write token), a reviewer test tenant (gate for Anthropic/Slack/Atlassian/AWS/Microsoft review), cloud marketplaces (legal entity + partner programs); `VSCE_PAT`, `OVSX_PAT`, `ACTION_MIRROR_*` unset.
- **[integrations] Miro connector uses a personal token.** *Blocker: a registered Miro app + `MIRO_CLIENT_ID`/`MIRO_CLIENT_SECRET`.*

---

## 🧰 OTHER — enabling work outside the arc

### Production ops (2026-10-10 log review)

- **Disconnect Moonshot on tenant 1** (empty pay-as-you-go balance; use the Kimi Code subscription). *Blocker: operator clicks Disconnect in Settings.*
- **Together, FluxAPI and Hugging Face are out of credit** (fail over cleanly). *Blocker: top up, or remove `TOGETHER_API_KEY` / `FLUX_API_KEY` / `HF_API_TOKEN`.*
- **Plain `http://` still served for prerendered paths;** the www rule targets `http://`. *Blocker: a zone-edit Cloudflare credential* → "Always Use HTTPS" + an `https://` www rule.
- **Project memory has no embedding fallback** (`vector(1536)` vs 1024-wide BGE). *Blocker: design decision* — second vector column or the same model from a second host.
- **Vision gate skips `@cf/google/gemma-4-26b-a4b-it`** (declares `['tools']`). *Blocker: one live image request;* add `'vision'` if it works.
- **`/incidents?tab=escalation` 404 in production** — likely an RSC prefetch miss. *Blocker: response headers from the deployed Worker.*

### LLM gateway, routing and cost `[agents]`

- **Video vendors and the ffmpeg render container have never run live** (Pollinations ids, Google `veo-3.1-fast-generate-preview`, `MediaRenderContainerDO`). *Blocker: a deploy, one clip per vendor, one server render.*
- **`SUPERSEDED_MODEL_IDS` is hand-maintained** — extend live-`/models` reconciliation to assert keys/values.
- **Drift guard reads only OpenRouter, NIM, Cerebras;** listing ≠ serving (NIM `kimi-k2.6` 404s). *Blocker: credentialed sources must refresh from inside the Worker.* Derive FREE/PRO/CODING pools from the live payload.
- **A known-broken BYO provider still leads the seed.** Feed `providerAuthAlerts` into `byoAutoSeedModels` as `demotedVendors`. *Blocker: import cycle with `resolveTenantLlmCredentials`.*
- **Only Qwen offers a model choice;** OpenAI, DeepSeek, xAI, Moonshot, MiniMax, Mistral need chat filters from real `/models` payloads. *Blocker: one live key each.*
- **Cost caps:** confirm paid-overflow cap + cooldown; no cap on premium fallback for FREE (`useCase` is caller-supplied); Pro fixed at 2 attempts; no per-user sub-ledger; gateway and on-prem runs unattributed.
- **Image generation has no BYO path** (`imageProxyForPlan` gets no tenant keys).
- **Orphaned usage rows:** `llm_usage_log.tenant_id ON DELETE SET NULL` drops a deleted tenant from tenant views but not the admin rollup (0 rows today).
- **Caching:** prompt-cache TTL fixed at 5 min (wire `cacheTtl:'1h'`); `CachingBridge`/`ResponseCache` unused; semantic L2 is a 200-entry KV scan (move to Vectorize).
- **Reliability:** `applyCooldowns` 2N KV writes; no cooldown re-check per attempt; streams don't surface `failovers[]` or detect empty-200; strict schema capability not advertised; hired.video tailor has its own cascade.
- **Gateway hardening:** no message-shape sanitizer for strict vendors (Gemini `INVALID_ARGUMENT`); `llm` workflow nodes use the host key.
- **Sampling `params` apply at the gateway only,** not in the V2 loop; no persona picker in My-LLMs. *Decision:* retire `tenant_model` presets or rename.
- **Codex:** 403 stands the vendor down, not the run — decide if one dead BYO account should fail a request. Contract unverified live (*blocker: a Codex credential*); OAuth races a local Codex CLI on `localhost:1455` (*blocker: an OpenAI client registration*).
- **No `web_search` adapter has hit its live API** (Tavily, Exa, Linkup, SearXNG, Wikipedia). *Blocker: accounts + a SearXNG instance;* an operator's first "Test connection" is the proof.
- **Kimi from hosted cloud agents:** Kimi's edge refuses Cloudflare egress before reading credentials. *Blocker: Kimi's approval of `docs/partnerships/kimi-code-hosted-integration-request.md`, then a paid non-Cloudflare egress host.*
- **LLM trace capture:** `/v1/images` has no `logTrace`; streams lack `response_body`; `ideAiRoutes` not back-filled; runs don't deep-link to `llm_trace`.
- **Per-tenant rate limiting has never run** — `TENANT_RATE_LIMITER` isn't bound. *Blocker: operator decision* — bind as-is, raise caps, or gateway-only.

### Brain chat `[agents]`

- **No cross-turn guard against re-deriving a finished analysis.** `seedFrom` drops tool rows, so a guard must re-serve prior results with a staleness rule. *Blocker: a captured repro.*
- **Ask-the-Manager zero tool calls — suspect the vendor path.** Instrument `buildResponsesBody` with a real 102-tool payload. *Blocker: a live turn on a known vendor.*
- **Verify 308→64 tool selection restores tool calling on chat #71.** *Blocker: a live turn.*
- **Inherited Evermind endpoints still accept writes** (UI is read-only); a 409 would change the front-door contract.

### Evermind / SSM `[agents]`

- **Coding gate (≥90% of frontier) is built and closed;** no checkpoint passes it. *Blocker: a trained checkpoint and a recorded `POST /:projectId/evermind/coding-eval`.*
- **GPU backward pass:** WGSL backward kernels and the GPU tape are unwired; CPU backward is exact. Grad-norm clip races across workgroups; WGSL path lacks LoRA/QLoRA/mixed precision. *Blocker: a WebGPU device for numerical validation.*
- **P1 one run-context assembly:** context built 3× (cloud, on-prem, VS Code); on-prem/VS Code lack strategic/PRD/governance context; no delta via `EvermindCognition`. Fix = one `ContextSource` + `ContextReconciler`. *Blocker: execution-critical rewrite; each surface's run must validate.*
- **Two canonical-JSON serialisers** because `api/src/domain/shared/stableStringify.ts` feeds stored hashes. *Blocker: a `v2:` versioned hash + production backfill.*
- **Foreign-checkpoint weight port** (Codestral-/Falcon-Mamba). *Blocker: the real checkpoints.*
- **Learned-routing on-prem consumer** and **auto-routing eval gate** (Evermind is pin-only). *Blockers: a running host; a product decision on gate criteria.*
- **Delta `/evermind/learn` door unit-verified only;** opt-in `BUILDERFORCE_EVERMIND_DELTA`. *Blocker: deployed coordinator DO + on-prem host.*
- **Teach reports success before the teacher runs;** legacy ring entries lack provenance. *Blockers: a per-contribution status channel; a per-DO storage migration.*
- **Import from builderforce-memory:** a running stdio server re-snapshots over stubs; Markdown auto-memory isn't importable. *Blocker: a live MCP stdio + VS Code host.*
- **Tool-calling turn costs one forward pass per candidate** — needs a prefix cache or batched scoring.
- **Video/image codebooks untrained.** *Blocker: GPU training on a media corpus.*
- **Vendor dialects (`qdrant`, `pinecone`, `vertex-ai`) never hit a live service.** *Blocker: credentials.*
- **API uses retrieval primitives, not the enterprise ports** (`VectorStore`, `IngestionPipeline`, `Tracer`, `EvalHarness`) — its own adoption program. Two lexical scorers want a `Bm25Options.tokenize` hook. `Tracer` lacks W3C `traceparent`.
- **Externally blocked:** transformers.js `model_type:"evermind"`, llama.cpp GGUF, a live HF push; on-prem adaptation unbenchmarked; stdio recall is lexical; Prompt API ignores per-turn system prompts.
- **Knowledge & Learning Pipeline (baseline → extract → review → retrain).** KRs: extraction rate 80%, review in 24h, transfer uplift 15%, contradictions ≤5%. Re-implement abandoned #161 (review queue, PR #101), #674 (delta format, PR #332), #675 (extraction, PR #333) over `utils/delta.ts`, `export/index.ts`, `import/evermind.ts`, `bench/`.

### Agent runtime, desktop (Synapse) and VS Code `[agents]` `[platform]`

> Synapse goal (2026-09-27): Evermind is each person's private capability, stored and learned on their machine. Capability gaps G1–G12 are closed; what remains is verification and platform coverage.

- **Synapse chat, sign-in, brain, Evermind console, local models, connectors and phone approvals are build/unit-verified only.** *Blocker: an interactive desktop session with a Builderforce account.*
- **Self-Directed Agents are Windows-only and not run on a real desktop.** macOS needs AX (*blocker: a Mac with Xcode*); Linux needs X11 XRecord (*blocker: an interactive X11 session*).
- **Installers unsigned; no in-place updater.** Workflows are ready to sign. *Blocker: Azure Trusted Signing or a cert, Apple Developer ID + notarization, the Tauri updater key.* Delete Spawn's `firstRunWindows`/`firstRunMac` hints when done.
- **No measured proof the index improves runs.** *Blocker: live VS Code runs on real tickets with and without the app* — gates phase 3.
- **~3.3 GB memory after indexing one small package.** *Blocker: an idle-vs-embedding memory profile.*
- **Phase 3 local browser/VM agent host.** *Blocker: content guardrails + prompt-injection defence first.*
- **On-prem runtime doesn't back `repo.semantic`** — move `desktopContext.ts` into an `agent-tools` node subpath and probe at catalog time. Not blocked.
- **Native apps:** no Evermind recall or agent invite in phone chat; no Approvals screen in `apps/android` / `apps/shared/BuilderforceKit`.
- **Two plain-Node runners duplicate the loop skeleton** (`server.mjs`, `githubActionsRunner.ts`). Fix = bundle the kernel into both. *Blocker: a container build and an Actions dispatch to verify.*
- **pi-tui is the last `@mariozechner/pi-*` dependency** — migrate `src/tui/*` to Ink, then remove.
- **Engine/tool convergence:** converged file tools default OFF; needs a cross-provider smoke, sandbox-aware provider, `read`/`exec` convergence, `RelayTaskEngine` collapse.
- **plugin-sdk DTS build broken** (9× TS6059; `agent-tools` is source-only).
- **Brain embeddable is headless only** — extract the UI to `brain-embedded/ui` plus shared `useToolConfirmationGate` and `buildComposerDirectives`.
- **Portal channel config flows up only** — needs a `channel.configure` push + runtime consumer. *Blocker: a running on-prem host.*
- **Cloud affect can't run GPU-trained limbic models in the Worker** (inherent).
- **VS Code:** `@builderforce` participant forgets tool work after restart (*decision:* durable step trail?); native sessions tab needs the proposed `chatSessionsProvider` (keep the webview?); sign-in isn't covered by the extension-host suite (*blocker: a test tenant + `BF_EDITOR_KEY` secret*); `/embed` views need a frontend deploy.

### Data model — PRD 20 `[platform]`

- **The 25 kernel primitives await acceptance (PRD 20 §6)** — and the winner of nine contested areas. Coverage map: 1,130 source tables, 0 unaccounted. Primitive adoption today: `activity_log` 18, `connections` 6, `runs`/`work_items`/`annotations`/`revisions` 0. *Blocker: operator decision.*
- **214 open ratchet violations:** 187 tables reachable only via the entity layer, 22 cross-module imports, 3 polymorphic refs without FK, 2 duplicate clusters (`drive`=`mailbox_connections`, `initiatives`=`portfolios`). `domain-boundary` at 34.
- **Step 5: 95 legacy shape tables hold live rows** — backfill → read cutover → drop, per family.
- **Steps 6–7 moving the wrong way:** 129 application folders (target 16), 237 route files, 166 `page.tsx`; layering at 126. Needs a lane that owns the migration.
- **Behaviour of the two merged products isn't here yet** (ATS funnel, finance/investor/growth workflows) — the entity layer is the floor.
- **Legacy routes register into `objects` only on the sweep,** not at write.
- **`marketing_sessions` sits in `schema/identity.ts`;** moving it adds a counted `growth → identity` edge.
- **54 table families straddle schema modules** — needs an ownership manifest, not a prefix heuristic.
- **Drop `calendar_connections` plaintext token columns** (0 rows) and the fallback read. Not blocked.
- **Migration numbering:** grandfathered prefix collisions; five ledger rows with no file; ~75 push-only tables in the drift allowlist. Renumber + backfill creates.

### Frontend, i18n and code health `[platform]`

- **Two admin overlays break the SlideOutPanel convention.** `UserDetailDrawer.tsx` is a hand-rolled fixed overlay (`.user-drawer*`, `globals.css:4520-4537`, z-index 900, no portal, no Esc or width control); `TenantApiKeyUsageDrawer` renders inline but is named a drawer. Rebuild on `SlideOutPanel`, delete the CSS, rename the inline one. Not blocked — slice 0 of the Visitors consolidation (Measure), with the `StatTile` extraction.
- **Layering ratchet at 126;** 110 presentation modules import the schema (286 selects inline). Worst: `adminRoutes`, `agentHostRoutes`, `qaRoutes`, `knowledgeRoutes`.
- **271 unscoped tenant queries** — each needs a per-chain decision (thread `tenantId` or record the parent check).
- **15 of 38 permissions advisory for structural reasons:** no surface (`project:archive`), a non-member caller (`marketplace:*`), a machine caller (`agentHost:*`, `workflow:execute`).
- **God modules, still growing:** `adminRoutes.ts` 4,047, `llmRoutes.ts` 3,574, `brainRunStore.ts` 2,940, `TaskMgmtContent.tsx` 2,761, `cloudAgentEngine.ts` 2,768, `agentHostRoutes.ts` 2,365, `ManagerService.ts` 2,109, `managerDiagnostics.ts` 1,878, `bfApi.ts` 1,684, `index.ts` 1,470, `extension.ts` 1,420, `MarketplacePageClient.tsx` 1,338, `jobRoutes.ts` 1,301. Splits named in the 2026-09-05 review (manager `MANAGER_STAGES` registry, `routeTable.ts`, `commandRegistry.ts`, per-category lazy marketplace). Pattern proven by `cloudAgentEngine`.
- **Root closure is 596 modules;** `builderforceApi.ts` (10,633 lines, 96 namespaces, 96 uncached) → `lib/api/<domain>.ts`, `withQuery`, `apiPost/Patch/Delete`, client caching. Component-level `next/dynamic` in only 9 files.
- **Unused primitives:** cards re-declared in 110 files, loading/error/empty in ~101, `ui/Field` 4 consumers vs 76 copies, 13 `fetchProjects()` callers, 143 raw storage sites; 818 raw `<button>`/`<input>` on marketing.
- **Duplication left by the `CreationCanvas` split:** 68 hand-written `canEdit` guards, 44 `smoothstep` literals (`stage.connect()` has no call sites).
- **Phone chrome untested** — `usePhoneViewport()` is `false` in jsdom; add a seam. PRD 28's four decisions await a ruling.
- **i18n:** ~330 components hardcoded English; no CJK font fallback; catalogs partitioned by locale rather than bounded context (243 namespaces) — re-partition as `messages/<domain>/`, one commit.
- **Retire-or-build decisions (yours):** `BUILDERFORCE_MODELS` fallback; the unlinked `app/import/*` scaffold.
- **Smaller:** object timeline — 5 of 109 `recordActivity` sites pass `objectId`; `GET /api/tenants/mine` duplicates `my-tenants` (release decision); `mailbox/mime.ts` extraction; `feedback-sdk` has no in-repo consumer; worker doesn't check `jti` revocation (*decision:* introspection call vs DB access); three points-fraud heuristics need unsent signals; no sweep for pre-OTP fake accounts.

### Identity and governance `[identity]` `[governance]`

- **OAuth consent screen says "Builder Force".** *Blocker: Google Cloud Console field → `Builderforce.ai`.* Gmail/Calendar/Drive/YouTube work for test users only until verification. *Blocker: publish + demo video + resubmit.*
- **OAuth over `/gateway/*` builds the wrong callback** (`stripGatewayPrefix` loses the prefix). *Blocker: register `https://builderforce.ai/gateway/api/auth/oauth/<provider>/callback` in all four consoles, then ship together.*
- **A signed-in canvas turn once sent no tenant token** (session `bf886fc1`). *Blocker: a storage timeline or two-tab repro.*
- **Segmented mode not usable:** ~35 insert sites lack `segmentId`; isolation is app-level (add RLS); no segment roles or claim; no no-bleed DB test.
- **Spec/impl identity contradiction (docs 01/04/05):** add inbound OIDC, `resolveSegment(jwt)`, S2S tokens, `tenant_webhooks`; unify PM onto `projects`/`tasks`/`specs` (decided 2026-09-12).
- **SOC 2 Type I** is the enterprise gate (Q4 2026). Embed rail: `sprints`/`velocity` views render blank; `SessionRoomDO` needs a deploy.

### Billing (Builderforce's own) `[finance]`

- **Stripe webhook unregistered and `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` unset — no tenant can upgrade.** Subscribe `https://api.builderforce.ai/api/webhooks/payment` to five events. *Blocker: operator Stripe + `wrangler secret put`.* Then one test card through checkout and card-validation.
- **Entitlement-error live run** would write to production (no staging Neon). *Blocker: a staging branch or explicit authorisation.*

### Infrastructure, CI/CD and cost `[platform]`

- **🔴 $0 platform: Cloudflare Free + Neon Free (plan 2026-10-03).** Sizes 10-10: core 444 MB, transactional 184 MB, apps 8.2 MB. Run-telemetry copy hasn't run — `npm run db:copy-run-telemetry`, then `--purge-source` (*blocker: operator with production credentials*). `VACUUM FULL` reclaims ~50 MB. Keep `builderforce-apps` (live sites); delete only `builderforce-primary`. Target: thin router Worker; agents on the user's host → GitHub Actions → shell-less DO; WebContainer previews; Playwright on Actions; CPU-heavy routes client-side; Containers for paid via `planFeatures.containerRuntime`. Sequence: enable observability and measure → cut telemetry + gate cron → re-default cloud surface → move QA → move CPU routes + per-sweep DO alarms → cache L2 off KV → hosted Checkout → downgrade Cloudflare → downgrade Neon. *Blockers: WebContainer licence, consoles, CPU measurements, acceptance of 2–4 concurrent agents.* In-browser runtime live check needs a deploy; Next/Nuxt/SvelteKit dev servers unsupported; Studio Database has no file storage (*decision: quota/abuse policy*).
- **🟠 Confirm core autosuspends ≥45% of the month** (Neon console chart); enable autosuspend + 0.25 CU (console toggle).
- **Cutover rows on the old primary** (12 telemetry rows would be lost). *Blocker: operator runs `reconcile.sh` + `merge.sql`.* Then delete `builderforce-primary` (console) and drop core's stale site tables (not blocked).
- **No retention on canvas history** (`creation_session_events` 50 MB, `_snapshots` 41 MB, `brain_chat_messages` 37 MB). *Blocker: decision on history kept.*
- **`inTransaction` (WebSocket Pool) unrun against docker or Neon;** 402 not mapped on the pool path. *Blocker: the docker stack + a live booking.*
- **Smart Placement unmeasured** — remove if p50 doesn't fall after a deploy.
- **Sites Worker hasn't taken traffic;** needs `SITE_VISITOR_SALT` on both Workers. *Blocker: the secret + one release.*
- **API Worker ~21 MB** — next split is `/llm` + `/v1`, after cutting the `replayApp.ts` → `index.ts` cycle.
- **Flaky/heap-bound tests:** api full run fails a different 1–2 files each time; `CreationCanvas.test.tsx` fails a moving four (shared `localStorage`, bare `fireEvent`); `startupListing.test.ts` 1 ms `zeroCashDate` (pass one `now`); `registry.test.ts:207`; `useBrainConversation.test.tsx` and `harness/scenarios.test.ts` exhaust the heap; three `subagent-registry` announce-retry tests red (owner of `634dc1200`/`52a480513`).
- **CI safety:** no ephemeral-DB migrate dry-run; the `production` environment's reviewer rule is unset (operator); CodeQL `query-filters` untuned; `agent-runtime` tests advisory (`continue-on-error`), 3,449 unformatted files, 588 lint errors, 12 files over 500 LOC; `qa-e2e` can't gate PRs; `pnpm dev` Turbopack fails on Windows symlinks.
- **Brand residuals:** `clk_`→`bfa_` dual-accept — rotate legacy keys, then drop. Schema/`/api/claws`/`CODERCLAW_*` kept by decision.
