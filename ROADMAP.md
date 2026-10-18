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

## Consolidated Feature Register

| Feature | Area | P | Target | Status |
|---|---|---|---|---|
| Managed Agent hosting add-on ($49/mo/Agent) | Revenue | P0 | Q3 2026 | ✅ Shipped |
| Onboarding — first Agent in < 5 min | Revenue | P1 | Q3 2026 | ✅ Shipped |
| Marketplace monetization (listing + tx fee, Stripe) | Revenue | P1 | Q3 2026 | 🔄 Partial — awaits Stripe secrets |
| Enterprise license GA (on-prem Docker) | Revenue | P1 | Q4 2026 | ✅ Shipped |
| SOC 2 Type I audit | Revenue | P1 | Q4 2026 | 📋 Planned |
| Live orchestration workspace (real-time DAG) | Agents | P0 | Q3 2026 | ✅ Shipped |
| Inline diff / pair-programming (TUI accept/reject) | Agents | P1 | Q3 2026 | ✅ Shipped |
| Session auto-checkpoint (`/sessions`, `/undo`, `/fork`) | Agents | P1 | Q3 2026 | ✅ Shipped |
| Remote task result streaming | Agents | P2 | Q3 2026 | ✅ Shipped — live `remote.task.chunk` + terminal assistant text |
| Multi-model role routing | Agents | P2 | Q3 2026 | ✅ Shipped — resolver in `@builderforce/learned-routing` (`9f514a949`); wired into cloud engine (`c34d5084b`) and VS Code native Brain (`9689f3699`) |
| Spec import from GitHub Issues / Linear / Jira | Agents | P2 | Q3 2026 | ✅ Shipped |
| Remaining Canvas actions onto the outcome contract | Analytics | P0 | Q3 2026 | ✅ Shipped — cheap proofs on the ledger (epic #3077) |
| Rendered presentation export of the value brief | Revenue | P1 | Q3 2026 | ✅ Shipped — `renderRfpDocPptx` from the same `rfpDocSections` as HTML/PDF; canvas PPTX + investor pack PPTX |
| Phase 6 — activity/integration engines, scheduled reporting, PRD orchestration, analytics UI | 6 | P0–P1 | Q3–Q4 2026 | 📋 Planned |
| Phase 7 — policy packs, governance-auditor, BLOCKER-gates-merge, SOC2 evidence ([PRD 08](./docs/specs/08-prd-agentic-governance.md)) | 7 | P1–P2 | Q3 2026 | 📋 Planned |
| Local LLM execution — native pure-Rust engine that replaces Ollama, in [builderforce-inference](https://github.com/SeanHogg/builderforce-inference) (`bfi`; Synapse supervises `bfi serve`; Ollama is not required), hybrid routing — [PRD](https://github.com/SeanHogg/builderforce-inference/blob/main/docs/PRD-native-engine.md); M1–M4 crates landed (tokenizer, sampler, prefix cache, grammar, embeddings, `mix_decode` concurrent batching); M5 Synapse cut-over shipped (`bf-local` no longer drives Ollama); M6 VSIX discovers Synapse via `~/.builderforce/desktop.json`. Remaining: GPU 70% tok/s vs llama-bench unmeasured (3762); live Bonsai 27B greedy vs PrismML fork not run (3764); unsigned GitHub Release binaries (3782) | 3 | P2–P3 | Q4 2026 | 🔄 Partial |
| Multi-agent orchestration at scale (DAG UI, memory mesh) | 4 | P1–P2 | Q3–Q4 2026 | 📋 Planned |
| Production hardening (self-hosted, fleet failover, SIEM export) | 5 | P1–P3 | Q4 2026 | 📋 Planned |

## Key Metrics

**North star:** share of ideas reaching a **graded proof** (kill condition measured, not just a deliverable).

Read→Prove: time to a chosen proof form · share of ideas Read before Build. Build: proofs reaching a reachable artifact · pass rate · retry rate. Measure: share of proofs graded. Collaboration · Compounding (resumed in 7/30 days, outputs reused) · Efficiency (interventions and cost per outcome) · Integrity (actions with a correlated terminal outcome). Stars, downloads and agent counts are diagnostics only. All computed from the correlated outcome ledger — contract: [OUTCOME-METRICS.md](./docs/design/creation-canvas/OUTCOME-METRICS.md).

## Claim-to-Proof Product Program

Public copy describes today's evidence. **Available** = shipped + repeatably verified · **Beta** = named limitation · **Planned** = never presented as current. No `every`/`always`/`never`/`100%`/`zero`/`instant` unless a test proves the boundary.

| P | Promise | Honest position today | Proof required | Status |
|---|---|---|---|---|
| P0 | One canvas from idea to real | Connects supported artifacts into supported delivery | Release-gated journey test per marketed artifact | 🔄 Partial |
| P0 | People control agent work | Policy gates on configured paths | Classify every mutating tool; CI fails on an unclassified one | ✅ Available |
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

- **hired.video absorption** ([PRD 18](./docs/specs/18-prd-hired-video-port.md)) — 100% deprecation to a redirect shell. Every remaining table maps to an existing primitive (`data-model/source-to-target.tsv`, 363/363); the rest is application code over existing tables. Affiliates = the Associate program.
- **burnrateos.com shutdown** ([PRD 19](./docs/specs/19-prd-burnrateos-consolidation.md)) — a parity obligation: an unbuilt, unretired capability is LOST at shutdown. Held by `check:burnrate-parity`, `check:no-burnrate-runtime`, `check:burnrate-policy`. No row migration (2026-09-05). B1/B2 founder loop shipped 2026-09-15. PRD 19 §2 governs twelve capabilities both programs claim. *Operator work:* provider customer actions, identity-cutover comms, redirect verification.

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
- **[canvas] Validating an idea by asking the market is shipped for B0–B5 ([PRD 27](./docs/specs/27-prd-idea-validation-surveys.md), epic #3083).** B0 form loop on main: `CanvasFormSurface` publish/close/`summarizeForm` poll, public `/f/[slug]`. B1 Ask people (`formFromIdea`, Ideas row CTA, `IDEA_EVIDENCE_KINDS` includes `form`) landed. B3 form → `marketing_campaign` Send and social Post wired (`sendForm` / `postForm`, commit `ba9a3f2a4`). B4 `addFromCrm` on the form surface. B5 founder stage select exists (FR-8 is not auto-settle). `idea.reveal` grades named evidence onto `proof.grade`. Adjacent (not this epic): `builtin_canvas_bind_ab_test` missing, no SMS/scheduled sends, clicks don't record the link, four unjoined contact stores, two survey stores, CSAT/NPS `question_set_id` unrendered, `newsletter_subscribers` siloed.
- **[canvas] Wizard-of-oz `/queue` and `/pilot-report` are public and expose participant contacts.** They ship `verify: 'none'`; a seeded blocking ticket is a request, not a control. Fix = per-realization read secret, signed link, or the console behind app auth. *Blocker: product decision on where an operator console lives.*
- **[canvas] Instrumented `/api/creation-sessions/claim` failure not yet observed.** The catch now logs PG code, constraint, statement and id counts to tell the fixed case-collision cause from any other. *Blocker: a live occurrence.*

---

## 🔨 Make — Build

### Cloud and IDE agent runs `[agents]`


- **Cloud agents only happy-path validated — 50-gap PRD ([09](./docs/specs/09-prd-cloud-agent-validation.md)).** P0: V2 runs `bypassPermissions` + Bash on shared infra with no documented sandbox (G1); Worker fallback ignores steering/cancel (S5/S6); errored runs leak the workspace (W2); a missing BYO key may fall to a platform key (B2).
- **`cloud-container` executor needs a live image.** Built; account is Containers-paid (2026-09-22). Until `wrangler deploy` builds it and `/health` passes, `chooseCloudExecutor` silently demotes container runs to durable — paid workspaces defaulting to container get serverless with no explanation. Bounds: `sleepAfter` 20m, clone token in shell, GitHub-only tokened clones, no `ask_human` on containers. *Blocker: image build + deploy.*
- **Container image predates the shared kernel loop.** `api/container/server.mjs` and the Actions runner now drive `runAgentLoop` via the generated `agentLoop.mjs` bundle with no step cap (2026-10-16), but a deployed image built before that still reads `spec.maxSteps || 20`, so the launcher keeps sending the LEGACY `CONTAINER_MAX_STEPS` = 40 (`cloudAgentTools.ts`, `containerRunLauncher.ts`). Delete both once the rebuilt image is live. *Blocker: container image rebuild + deploy.*
- **Durable cloud loop still has no local shell.** In-run verify (ticket #3092): durable polls branch CI (`run_checks` + pre-finish, `164b177e2`); container / Actions / on-prem run `typecheck`/`type-check`/`test` in-run and durable records an honest skip (`5b0670e06`). Remaining: PR-only workflows (`on: pull_request`) report `none` until the PR exists — webhook auto-fix + `CLOUD_AUTOMERGE_REQUIRE_GREEN` stay the backstop.
- **PRD commit is GitHub-only.** `ensureTaskPrd` now runs at `startDispatchedExecution` so host/on-prem runs draft too (ticket #3096, `54467a71d`). Remaining: PRD commit is GitHub-only; no agent task-mutation tool; Auto runs carry no `cloudAgentRef`.
- **IDE agent calls tools one at a time.** Chat #115: 63 turns for 82 calls (8m41s model vs 5m45s tools); it can batch (turns 47–52) but nothing asks. *Blocker: an A/B over real runs.* Unblocks ~halving survey-run wall-clock.
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
- **Capability guardrail** only enforces an explicit `required_capabilities` (no capability-aware routing or lane default).
- **`autonomyWiringAudit.ts` has no test** — it now counts spec-shaped tickets as non-code deliverables, and nothing pins that. Not blocked.
- **A reviewer's `changes_requested` doesn't reopen the producer slot itself** — the manager return path does (`reopenProducerSlots.ts`). Design call: should a verdict alone spend a run (needs a loop-safe "asked since" marker)?
- **Role participation:** PRD per-role sections aren't audit-verified; outbound stakeholder notifications aren't all routed through the Coordinator identity ([PRD](./PRD-coordinated-role-participation.md)).
- **Manager pass still carries the mechanical PR loop** — move it to its own registry sweep; if `notReached` stays near `projects`, use a per-project DO alarm, not a bigger pool. Sequenced behind one `notReached` capture.
- **Delta→ticket capture:** marketplace-hired Validator unverified; chat deltas off the PR branch won't auto-complete.
- **Personality** isn't on a person profile page or brain @-mentions (needs `AssigneeProfilesProvider` there).

### Ceremonies and meetings `[delivery]`

- **Ceremonies:** presence not re-verified per frame; client-driven `changed` and auto-dispatch; no session history or retro/poker integration; drag has no ghost; no turn pause/resume.
- **Mesh WebRTC caps at ~4–5 cameras.** *Blocker: a Cloudflare Calls app + server-side track push/pull.*
- **TURN relay not provisioned** (~10–15% of symmetric-NAT pairs fail). *Blocker: create the TURN key and `wrangler secret put CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`.*
- **Meeting agent voice is browser `speechSynthesis`.** *Blocker: product decision on each agent's voice.*

### Canvas runtimes and studio `[canvas]`

- **Eight kinds have no editing runtime** (`video, voice, podcast, image, animation, comic, cad, model3d`, plus `drawing`) — they return a manifest ([PRD 18](./docs/specs/18-prd-hired-video-port.md)). Port from `C:\code\hired\hired.video\frontend\lib\studio` one kind per slice, dynamically importing heavy deps, through `creationObjectRegistry` data — never grow `CreationCanvas.tsx` (1,165 lines). Not blocked.
- **One build-file write took 35.7s vs 38ms median** (session `local-148925cf`, `Layout.css`). *Blocker: a profile of a Studio build turn with preview running.*
- **Knowledge editor has no `drawing` block.** Add a `BlockType` opened through the canvas drawing runtime once ported.
- **Real-time co-editing live smoke.** *Blocker: next api deploy + a 2-client smoke.*
- **Generated `.rbxlx` never opened in Roblox Studio.** *Blocker: one human opening one place.*
- **Spawn not run end to end** (install → device sign-in → age gate → Stripe membership → `SpawnPlugin.lua` → build as one undo → play-test `/log`), plus the `spawn.builderforce.ai` zone route. Spawn's code lives in [builderforce-spawn](https://github.com/SeanHogg/builderforce-spawn). *Blocker: a desktop with Studio and a Stripe-enabled account.*
- **Room:** no video/audio in the Room (needs a `video` prop surface, texture budget, distance gain); station faces and widget iframe untested in a real browser.
- **Voice:** consent/provenance gate blocks GA; no in-IDE marketplace browse/checkout; embeddings localStorage-only; Studio video IndexedDB-only (mirror to R2).
- **Video engine:** `advanceState()` is a CPU placeholder; no learned interpolation or motion module; img2img drifts; no ControlNet/inpainting; Safari needs a WebM fallback. Brain-created dataset files bypass registration.
- **4 WebDiT models registered `available: false`.** *Blocker: diffusers→ONNX export per architecture uploaded to R2.*
- **In-editor voice cloning needs the ONNX runtime on the CDN.** *Blocker: next frontend `cf-deploy`* — verify `curl -I https://builderforce.ai/ort/ort-wasm-simd-threaded.jsep.wasm`. Keep `onnxruntime-web` pinned to `1.22.0-dev.20250409-89f8206ba4` (newer `jsep` exceeds the 25 MiB asset cap).
- **Workflow builder (canvas IS the workflow):** branch nodes don't prune; transforms are template-only; `mcp` nodes have no transport; no per-integration credential capture; definitions not project-scoped; claim→execute→report not integration-tested; wire `WorkflowConfig`/`StepTypeRegistry` + a "Run Stack Check" timeline.

### Mobile modality `[canvas]`

- **Device simulator is react-native-web**, not native (camera/push/navigation differ). Needs Metro or an Expo build service.
- **Scan-to-phone QR points at a built deploy**, not a live dev server.

### Previews, repos and hosting `[canvas]` `[integrations]`

- **Live container preview (phase 2).** Code complete behind `PREVIEW_INGRESS_ENABLED`. *Blocker: `wrangler deploy`, migration `0948_preview_sessions.sql`, a proxied `preview` DNS record, the flag secret* — then confirm WS upgrade and phone HMR.
- **Repo-backed Designer:** `createRemoteRepo` GitHub-only; commit-back has no merge guard (`last_synced_sha` never populated); import capped at 200 files/5MB and one-way; worker vs api R2 prefixes diverge; no server-side file-content guard.
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

- **[hiring] Greenhouse, Indeed and LinkedIn confirm a posting with no public URL** — their `response` mappings carry an id only, so the card shows it live with nothing to open. Indeed returns none for a sourced posting; the others can be built from the id. Not blocked.
- **[hiring] Source attribution is exact-match on connector key, and no applicants are imported** from the boards a posting went to. Not blocked.
- **[hiring] No Workable connector** — `defaults/hiring.ts` has Greenhouse, Lever, Ashby, Indeed, LinkedIn and `job-feed`. Not blocked.
- **[integrations] Business Phone is a Twilio CPaaS number, not a carrier** (no port-in, SIM, call-forward). *Blocker: business decision.*
- **[integrations] Phone numbers have no A2P 10DLC registration** (`phoneNumbers.ts` `purchaseNumber`), so outbound SMS can degrade. *Blocker: operator decision on Trust Hub/Messaging Service resources and fees.*
- **[integrations] Google Drive / OneDrive can't complete consent.** *Blocker: enable Drive API + `drive.readonly` on the consent screen, delegated `Files.Read` in Azure, register both `/api/drive/callback/*` URIs.*
- **[governance] Security automation incomplete:** scanners and repo-access population, one mutation-audit envelope, governance-auditor findings, automated evidence, merge gating, per-segment DSR. Live agent audit run needs a repo credential + cloud runtime. Reconcile PRD 08's checklist first.

---

## 📊 Measure — grade the proof

- **[platform] 14 of 17 seats write no domain metric.** `DOMAIN_MANIFEST` declares 45 keys; only `kernel/rollups/{finance,operations,legal}.ts` write `metric_facts`. Also missing: `channel_performance`, `site_traffic_daily`, `arr_projections`, `quota_attainment`, `rd_financials_quarterly`. Follows the PRD 20 data move. This is the open half of Measure.
- **[finance] Vertical KPI Dashboards — Slice B next ([PRD 25](./docs/specs/25-prd-vertical-kpi-dashboards.md), build hand-off [25a](./docs/specs/25a-vertical-kpi-dashboards-implementation.md)).** Slice A shipped 2026-09-16. B: `growth.*` keys, LTV tranches, benchmark seeds for `saas`/`ai_ml` (kill: tiles read "Not measured"). C: `exitWaterfall.ts`, `exitScenario`/`marketSize` kinds (kill: disagrees with a hand spreadsheet). D: remaining eight verticals (kill per vertical: no design partner). No new tables.
- **[growth] `@seanhogg/builderforce-replay` has never been published to npm, so the Release run's replay package leg fails on every push.** `npm publish` answers `404 Not Found - PUT …/@seanhogg%2fbuilderforce-replay` (2026-10-16, run 38888217456). `publishConfig.access` is already `public`, and the sibling `@seanhogg/*` packages publish fine with the same `NPM_TOKEN`. So the token most likely may only write packages that already exist (a granular token), and a first publish needs a token allowed to create packages under `@seanhogg`. The CDN publish and the frontend and API deploys do not depend on this leg; only the npm-installable SDK is missing. *Blocker: the operator. Either publish 2026.10.3 once by hand (`cd replay-sdk && npm publish`), or widen `NPM_TOKEN` to allow new packages under the scope.*
- **[growth] Insights (PRD 33) is built in code, but has never been compiled, test-run or live-validated.** All slices S0–S7, plus S8 content, landed on 2026-10-13 ([PRD 33 §0.1](./docs/specs/33-prd-session-replay.md)). Per operator instruction nothing was compiled or run, so CI on merge is the first type-check and test run. The §11 runbook is the live proof: CDN kill check, customer #1 dogfood, real-card pack purchase and refund, the method smoke test, prescriptions, and the page review. *Blocker: the operator. Needs Stripe secrets plus the webhook, `CLOUDFLARE_API_TOKEN` with R2/DNS/Routes, a published legal disclosure, `NEXT_PUBLIC_REPLAY_SITE_KEY` for the Builderforce workspace's site, and a provisioned QA runner (with ffmpeg; the image size has not been checked against the 2000 MB limit).*
- **[growth] Insights scale-up: event lake (D18).** Funnels, flow, segments and AI digests run over kept recordings weighted by `sample_weight` (≈), not over every session. For sites far above the free allowance, add an event lake (Cloudflare Pipelines → R2 SQL) behind the same `replayFilterCompiler`, so funnels become exact. *Blocker: operator provisioning of the pipeline and a token for its SQL reads. A Pipelines binding with no pipeline fails the deploy.*
- **[growth] Insights player timeline markers are 22 px, below the 44 px tap rule (§4.3).** `frontend/src/components/replay/ReplayTimeline.tsx`. On phones the event list repeats every marker as a 44 px row, so markers are reachable, but the markers themselves need a 44 px hit area (an invisible padded target) at ≤900 px. Not blocked.
- **[growth] `experiment` records results nothing produced.** It stores authored variants with no binding to `ab_tests`, no landing-page variant and no traffic split. Insights (PRD 33 S4e) built the traffic split for hosted sites. The sites Worker serves any running `ab_tests` row whose variants name an Insights site: it assigns a sticky `bf_ab_<testId>` cookie by `trafficPercent`, serves each arm's release, counts one exposure per first assignment, and writes `data-variant` on the loader. Ingest records conversions through `recordConversion`, and `variantResults` gives the verdict. Still missing: binding the canvas `experiment` object (and a variant field on `website`/`prototype`) to `ab_tests`, external sites, and `ab_test_segments` targeting. Not blocked.
- **[delivery] hired.video `people_strategic_objectives` would fork the OKR store** — map onto `objectives`/`key_results` and invalidate `projectsList` on write.
- **[canvas] Phone surface switcher isn't phase-gated** — a phone user reaches Insights from Idea; desktop withholds it until Measure. *Blocker: a phone design for the phase control.*

---

## 📣 Reach — sell, be found, grow

### Marketplace and commerce `[commerce]`

- **Buyer can't drive a listing before buying (Stage sandbox parked).** *Blocker: infrastructure decision on the throwaway tenant and who pays.*
- **Monetization partial:** `'agent'` isn't an `artifactTypeEnum` value (no purchase/payout); "Hire" only bumps `hire_count`; template/skill/persona installs are free; hosted-card one-off settlement for knowledge listings isn't wired (`{ requiresConfig: true }`) — settle once, landing on the `ledger_entries` unique reference. *Blocker for the live leg: Stripe secrets (see OTHER · billing).*
- **Affiliates = the Associate program** — reconcile six tables onto `sales_*` with commissions as `ledger_entries`; retire `growth.affiliate_referrals`.
- **Company directory family is inert** — `companies` is tenant-scoped with no owner/verification column. Level 2 nav waits on PRD 19 tracks; `earnedRung()` vs `RosterNav.earned()` want reconciling. *Blocker: PRD 19 B0 company graph + an answer to PRD 21 §7 decision 4 (list non-opted-in businesses?).*
- **Marketplace categories:** `projects` needs a decision on visibility.
- **Gigs:** fixed bids have no escrow/milestones; two publish paths could converge; eval scores aren't on an insights lens.
- **Upwork parity:** escrow books are correct but money out rides the env-gated `PAYOUT_WEBHOOK_URL` stub; no 1099/W-8BEN/W-9; no payment-verified badge, bid economy, packages or agency accounts.
- **Freelance/talent:** avatars full-size; payout and notify-email webhooks unset; `available_for_hire` schema drift needs a migration or allowlist.
- **Advisor platform specified, not built ([PRD 26](./docs/specs/26-prd-advisor-platform.md))** — no Book on talent profiles, `/api/meetings/*` all authed, minutes don't create follow-ups.
- **[integrations] Publishers can't list a canvas pack or prompt** — need `canvas`/`prompt` output kinds. *Blocker: product decision on what a purchased pack becomes.*
- **[integrations] Developer Portal:** no live card run (Stripe secrets); hyperscaler listings need seller accounts; design-partner work is human.

### Marketing and campaigns `[growth]`

- **Prompt-driven campaign ([PRD 30](./docs/specs/30-prd-guided-marketing-campaign.md))** — "run a marketing campaign" still maps to a portfolio table. Next: C1 `canvas_connect_mailbox`, C2 catalog use-case, C3 ICP on canvas, C4 campaign ROI. Don't clone HubSpot.
- **Sales deck has zero customer proof.** *Blocker: one design partner and one measured result.*
- **No ad adapter has run against a live account** (eight, all recorded-payload tested). *Blocker: a sandbox/live account + developer app per network.*
- **Ad and social accounts connect by pasted token, not OAuth.** Code side is a registry entry + callback per network. *Blocker: a developer app and publishing/spend review per network.*
- **LinkedIn rows retired by 1102 (`retired:li-*`)** — needs a reconciler to re-point them, or an operator call to drop.
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
- **Docs/marketing residuals:** verify `/docs/*` proxies not redirects; `.page-inner` vs `PageContainer`; client-set teaser heads; per-article OG images; three unconnected feature lists; hero pacing in light mode.
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
- **Strategy content is still in the public repo's git history.** The files now in `docs/private/`, `ROADMAP.md`'s old ARR/Risk/Buyer lines, and the 40 `SECURITY-FINDINGS.local.md` headings in old `.builderforce/symbols.json` snapshots. The purge is built and dry-run verified (0 traces left across 9,296 commits): `docs/private/purge/purge.sh` (gitignored, with a pre-purge backup bundle). It rewrites all 848 branches on a fresh mirror and force-pushes each ref with a lease. `refs/pull/*` are read-only, so GitHub Support must purge those afterward. *Blocker: a quiet window.* No other session may commit or push during the ~30-minute run. Afterwards, every clone and worktree (`.claude/worktrees/cifix`, `C:/tmp/bf-wt`, the main checkout) must re-clone or hard-reset to the new `origin`. A plain `git pull` would merge the old history back in.

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

### Workload-aware routing and model hand-off `[agents]`

- **Rovr is not in the Chrome Web Store.** `clients/chrome` builds and packages `dist/builderforce-rovr-*.zip` (load-unpacked works); its icons are the web app's own logos by decision (2026-10-16). *Blocker: a Chrome Web Store developer account + listing.*
- **On-device models (PRD 34) have not yet answered a turn in a real browser.** What is proven:
  - `bfi`'s Q1_0 and f16-KV kernels match the CPU reference on a real GPU (native wgpu/Vulkan, `BFI_REQUIRE_GPU=1`);
  - `bfi-web` builds for wasm32;
  - every host's page-engine wiring is unit-tested against fakes.

  What has not happened: in Chrome or Edge with WebGPU, no one has downloaded a Bonsai GGUF or a WebLLM model from the picker and chatted on it in the VSIX webview, Rovr or builderforce.ai. That run would confirm the served context (`contextTokens` after load), the WebGPU out-of-memory retry, and tokens per second. *Blocker: a person-driven browser session with a WebGPU adapter. Nothing here can drive WebGPU headless.*
- **Rovr cannot pin the BYO pool.** Its pin (`settings.pinnedModel`) is one model id, so choosing the "your keys" pool row in the `/` Model tab falls back to Auto (`clients/chrome/src/sidepanel/useRovrChatOptions.ts`). Fix = a typed pin (`{ kind: 'model' | 'pool' }`) read by `inference/route.ts`. Not blocked. Unblocks full Model-tab parity with the web and the editor.
- **`answer_cache` is a dead table.** The live Q&A cache is `project_facts` (`qa:v2:` keys, `projectMemory.ts`); `answer_cache` (`schema/agents.ts`) has no writer. *Blocker: operator go-ahead to DROP a table.* Unblocks one cache table fewer to reason about.

### Brain chat `[agents]`

- **No cross-turn guard against re-deriving a finished analysis.** `seedFrom` drops tool rows, so a guard must re-serve prior results with a staleness rule. *Blocker: a captured repro.*
- **Ask-the-Manager zero tool calls — suspect the vendor path.** Instrument `buildResponsesBody` with a real 102-tool payload. *Blocker: a live turn on a known vendor.*
- **Verify 308→64 tool selection restores tool calling on chat #71.** *Blocker: a live turn.*
- **Inherited Evermind endpoints still accept writes** (UI is read-only); a 409 would change the front-door contract.
- **AI Surface — rendered checks.** Every host (Web Brain panel/canvas/guest, VS Code, Rovr) is on `AiSurface` with `--bf-*` tokens (DONE 2026-10-17), but 360px width and dark/light have only been typechecked, not seen. Also audit each host for a second catalog→labels table inside the same host. *Blocker: a rendered pass in a browser, the VS Code webview and the Chrome side panel — not available in this session.*

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

> Synapse goal (2026-09-27): Evermind is each person's private capability, stored and learned on their machine. Capability gaps G1–G12 are closed; what remains is verification and platform coverage. Since 2026-10-11 Synapse's code lives in [builderforce-inference](https://github.com/SeanHogg/builderforce-inference) and Spawn's in [builderforce-spawn](https://github.com/SeanHogg/builderforce-spawn); the entries below are tracked here but fixed there.

- **Synapse chat, sign-in, brain, Evermind console, local models, connectors and phone approvals are build/unit-verified only.** *Blocker: an interactive desktop session with a Builderforce account.*
- **Self-Directed Agents are Windows-only and not run on a real desktop.** macOS needs AX (*blocker: a Mac with Xcode*); Linux needs X11 XRecord (*blocker: an interactive X11 session*).
- **Installers unsigned; no in-place updater.** Workflows are ready to sign (each new repo's `release.yml`; Spawn uses builderforce-inference's signing actions). *Blocker: the owner adding the Azure Trusted Signing (or .pfx), Apple Developer ID + notarization and Tauri updater-key secrets to both builderforce-inference and builderforce-spawn.* Delete Spawn's `firstRunWindows`/`firstRunMac` hints when done.
- **No measured proof the index improves runs.** *Blocker: live VS Code runs on real tickets with and without the app* — gates phase 3.
- **~3.3 GB memory after indexing one small package.** *Blocker: an idle-vs-embedding memory profile.*
- **Phase 3 local browser/VM agent host.** *Blocker: content guardrails + prompt-injection defence first.*
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
- **214 open ratchet violations:** 187 tables reachable only via the entity layer, 22 cross-module imports, 3 polymorphic refs without FK, 2 duplicate clusters (`calendar`=`drive`=`mailbox_connections` — the three connected-account stores share one encrypted-token shape since calendar dropped its plaintext columns (2026-10-14) and should fold into one table with a `kind` column; `initiatives`=`portfolios`). `domain-boundary` at 34.
- **Step 5: 95 legacy shape tables hold live rows** — backfill → read cutover → drop, per family.
- **`sessions` and `ai_usage_records` are targets with no writer (rebaselined 2026-10-18).** The `identity.active_users` and `agents.tokens`/`cost_cents` rollups were their only feature readers. They were reading empty tables, so those metrics were always zero, and they moved to the live twins (`auth_user_sessions` ⋈ `tenant_members`, and `llm_usage_log` on the operational DB). That dropped both tables back to entity-layer-only. Closing it means cutting the auth path over to `sessions` (folding in `auth_user_sessions` + `extension_sessions` via `kind`) and choosing which usage ledger survives the core/operational database split. *Blocker: operator decision on the surviving usage ledger; the session cutover is a live auth data migration.*
- **Steps 6–7 moving the wrong way:** 129 application folders (target 16), 237 route files, 166 `page.tsx`; layering at 126. Needs a lane that owns the migration.
- **Behaviour of the two merged products isn't here yet** (ATS funnel, finance/investor/growth workflows) — the entity layer is the floor.
- **Legacy routes register into `objects` only on the sweep,** not at write.
- **`marketing_sessions` sits in `schema/identity.ts`;** moving it adds a counted `growth → identity` edge.
- **54 table families straddle schema modules** — needs an ownership manifest, not a prefix heuristic.
- **Migration numbering:** grandfathered prefix collisions; five ledger rows with no file; ~75 push-only tables in the drift allowlist. Renumber + backfill creates.

### Frontend, i18n and code health `[platform]`

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
- **Smaller:** object timeline — 5 of 109 `recordActivity` sites pass `objectId`; `mailbox/mime.ts` extraction; `feedback-sdk` has no in-repo consumer; worker doesn't check `jti` revocation (*decision:* introspection call vs DB access); three points-fraud heuristics need unsent signals; no sweep for pre-OTP fake accounts.

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

- **🟠 Immutable audit tables grow without bound** (`execution_claims`, `execution_claim_evidence`, `agent_context_contributions`, `agent_outbound_inspections`, `agent_capability_grants` via `agent_run_principals`). Their BEFORE DELETE triggers make any purge fail, and `execution_claim_evidence`'s RESTRICT FK blocks the `tool_audit_events` purge. Fix = triggers allow DELETE only under `SET LOCAL app.retention = 'on'`, and the purge sets it. *Blocker: operator decision on how long claim/audit history is kept.*
- **🟡 Index and table drops from the 2026-10-17 architecture review held** (unused indexes and the dead table listed on the review's Neon storage sheet, https://claude.ai/artifact/Kzm2Pp136DUx3E5oCUWgEe). *Blocker: operator approval for destructive migrations.*
- **🟡 Cache-version primitives duplicated:** `infrastructure/cache/versionToken.ts` (`versionToken`/`bumpVersion`, 2 s L1) repeats `getCacheVersion` + `bumpExecutionState` / `bumpTicketSearchVersion` / `bumpOutcomesVersion` / `bumpPublicCanvasVersion` in `readThroughCache.ts` (30 s L1). Fold into one `getCacheVersion(…, {l1TtlMs})` + never-throwing `bumpCacheVersionSafe`; the shared `retryDelete` still backs off on KV 429s. Also: the tenant-wide unread bump on every chat append (`brainMessageStore.appendRaw`) keeps the unread cache cold in busy tenants — key unread per chat audience.
- **🟡 Legacy `agents` reads remain** in MCP `agents.list` / `registered_agents.list` (`builtinMcpService.ts`) and `creationSessionRoutes.ts:~599`; `resolveAssignedAgent` can overflow int4; suppression `identifier_type` case and the dead `isSuppressed` / `suppressedSubset` alias in `marketing/suppression.ts`.
- **🟡 Agents usage rollup no longer backfills:** the kernel rollup recomputes a trailing 3 days, so a fresh install has no `agents.tokens` / `agents.cost_cents` history before its first sweep.

- **🟠 esbuild < 0.28.1 (GHSA) still locked in 6 packages — Dependabot reports `security_update_not_possible`.** Fixed 2026-10-11 in replay-sdk + the 8 tsup packages via `pnpm.overrides.esbuild ^0.28.2` (tsup 8.5.1 pins `^0.27.0`, so no in-range fix exists). Remaining, each with a different source that needs its own check before forcing 0.28: `api` (0.18.20/0.19.12 via drizzle-kit's `@esbuild-kit` — forcing may break `drizzle-kit push` in CI), `frontend` (0.14.47/0.15.18/0.27.3 — find the old-pin consumers first), `clients/vscode` (0.24.2/0.25.12 — the VSIX bundler), `agent-runtime` (0.27.3), `webdit/runtime` (0.21.5), `docs-site` (0.27.3, npm lockfile → `overrides`). All dev/build-time only. Fix = per package: override → regenerate lockfile → typecheck/build/test (+ `drizzle-kit` run for api, VSIX package for vscode). Not blocked — scoped out of the 2026-10-11 pass pending operator go-ahead on the riskier api/vscode overrides.

- **🔴 $0 platform: Cloudflare Free + Neon Free (plan 2026-10-03).** Sizes 10-10: core 444 MB, transactional 184 MB, apps 8.2 MB. Run-telemetry copy hasn't run — `npm run db:copy-run-telemetry`, then `--purge-source` (*blocker: operator with production credentials*). `VACUUM FULL` reclaims ~50 MB. Keep `builderforce-apps` (live sites); delete only `builderforce-primary`. Target: thin router Worker; agents on the user's host → GitHub Actions → shell-less DO; in-browser previews (BuilderForce WebContainers); Playwright on Actions; CPU-heavy routes client-side; Containers for paid via `planFeatures.containerRuntime`. Sequence: enable observability and measure → cut telemetry + gate cron → re-default cloud surface → move QA → move CPU routes + per-sweep DO alarms → cache L2 off KV → hosted Checkout → downgrade Cloudflare → downgrade Neon. *Blockers: WebContainer licence, consoles, CPU measurements, acceptance of 2–4 concurrent agents.* In-browser runtime live check needs a deploy; Next/Nuxt/SvelteKit dev servers unsupported; Studio Database has no file storage (*decision: quota/abuse policy*).
- **🟠 `builderforce-core` is on Neon Launch (paid) since the 2026-10-18 quota outage.** It's 504 MB against Free's 512 MB, so moving back to Free needs storage cut first: `npm run db:copy-run-telemetry -- --purge-source`, then `VACUUM FULL`, then confirm autosuspend (entries below). After that, downgrade in the console. *Blocker: operator with production credentials for the purge/VACUUM. `neonctl` login expired (`invalid_grant`); fix with `npx neonctl auth`.*
- **🟠 Confirm core autosuspends ≥45% of the month** (Neon console chart); enable autosuspend + 0.25 CU (console toggle).
- **🟠 Neon load review: confirm autosuspend in a quiet period.** Measured live 2026-10-18 01:30 UTC: core 8.3 txn/min (was ~46), 12k rows read/min (was 70k); transactional 6.3 txn/min (was ~39); no cron writes in the window; the per-chat unread count reads 48 rows over 53 scans, so it is on migration 1231's index. Both computes were still up from live traffic. *Blocker: a window with no users and no connected clients* (check `pg_postmaster_start_time()` or the Neon console afterwards; probe script pattern in [[neon-read-only-diagnosis-authorized]]). The duplicated telemetry tables in core still need `db:copy-run-telemetry --purge-source` (*operator, production credentials*).
- **🟡 Route consolidation: four items wait on a data-migration decision** (status per row: https://claude.ai/artifact/K3mA6TPM1rknr2zJq1qT3q, section "Duplicates"). (1) Kanban and canvas templates still live in their own tables; moving them into `catalog_items` is a migration. (2) Kernel object relations (`/api/objects/:id/{activity,members,shares}`) vs the creation-session copies: the canvas owns its own rows, so merging is a migration. (3) `project_agents` vs `agent_assignments` overlap. (4) Product releases carry both `release_date` and `target_date`. Blocker for all four: an operator decision on the target table, since each needs a backfill. Also open, not blocked: campaigns are only partly consolidated (email and social share the delivery-retry rule; their state machines differ), and the VS Code webview bundle keeps the old skill-assignment paths until the next VSIX build (the aliases keep it working).
- **VS Code extension tests red on `main` (`34bc9d5`):** `webviewAssets.test.ts` (the loaded sheet lacks `.bf-header`) and `webview/src/pageEngines.test.ts` (bfi engine wasm asset). They come from the One AI surface / local-models work, and they block `Publish VS Code extension` in Release. Owner: that work's session.
- **Cutover rows on the old primary** (12 telemetry rows would be lost). *Blocker: operator runs `reconcile.sh` + `merge.sql`.* Then delete `builderforce-primary` (console) and drop core's stale site tables (not blocked).
- **No retention on canvas history** (`creation_session_events` 50 MB, `_snapshots` 41 MB, `brain_chat_messages` 37 MB). *Blocker: decision on history kept.*
- **`inTransaction` (WebSocket Pool) unrun against docker or Neon;** 402 not mapped on the pool path. *Blocker: the docker stack + a live booking.*
- **Smart Placement unmeasured** — remove if p50 doesn't fall after a deploy.
- **Sites Worker hasn't taken traffic;** needs `SITE_VISITOR_SALT` on both Workers. *Blocker: the secret + one release.*
- **API Worker ~21 MB** — next split is `/llm` + `/v1`, after cutting the `replayApp.ts` → `index.ts` cycle.
- **Flaky/heap-bound tests:** api full run fails a different 1–2 files each time; `CreationCanvas.test.tsx` fails a moving four (shared `localStorage`, bare `fireEvent`); `startupListing.test.ts` 1 ms `zeroCashDate` (pass one `now`); `registry.test.ts:207`; `useBrainConversation.test.tsx` and `harness/scenarios.test.ts` exhaust the heap; three `subagent-registry` announce-retry tests red (owner of `634dc1200`/`52a480513`).
- **CI safety:** no ephemeral-DB migrate dry-run; the `production` environment's reviewer rule is unset (operator); CodeQL `query-filters` untuned; `agent-runtime` tests advisory (`continue-on-error`), 3,449 unformatted files, 588 lint errors, 12 files over 500 LOC; `qa-e2e` can't gate PRs; `pnpm dev` Turbopack fails on Windows symlinks.
- **Brand residuals:** `clk_`→`bfa_` dual-accept — rotate legacy keys, then drop. Schema/`/api/claws`/`CODERCLAW_*` kept by decision.
