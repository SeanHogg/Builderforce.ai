# Builderforce.ai — Done / Completed

> Record of completed, shipped, and resolved work, moved out of [ROADMAP.md](./ROADMAP.md) (which tracks only outstanding TODO/In-Progress/Partial items). Entries are condensed to *what shipped + when + key migration/files*; `git log` is the full audit trail. Open follow-ups for any feature below live in the roadmap.

---

## Completed Features (Consolidated Feature Register)

| Feature | Area | Done |
|---------|------|------|
| Stripe checkout + webhook · FREE/PRO enforcement · Teams tier ($20/seat) · per-plan limits · Managed-Agent waitlist · Slack approval · cost forecast · GitHub Issues→dispatch | Revenue | Q1–Q2 2026 |
| BuilderForce Agents LLM routing proxy (OpenAI-compatible) | Revenue | Q2 2026 |
| Runtime: `executeWorkflow`+orchestrate · agent-roles (7 built-in+custom) · session handoff · YAML workflow persistence · KnowledgeLoop · agent mesh (fleet/HMAC) · transport abstraction · task lifecycle SM · RBAC/device-trust/audit · capability routing `remote:auto[caps]` · persona plugins+injection · syscheck+fallback · `/spec`/`/workflow`/`/compact` TUI | Agents | Q1 2026 |
| Workflow live relay frames · MCP codebase semantic search · GitHub Issue→PR end-to-end | Agents | Q2 2026 |
| Full observability (OTel agent metrics, cost forecast, `X-Trace-Id`, telemetry domain + trace proxy) | 1 | Q2 2026 |
| HITL: approval SM (PENDING→COMPLETED) · manager dashboard (inbox/diff/cost/risk) · per-agent spend limits · auto-approval rules · notify+escalation | 2 | Q2 2026 |
| Managed orchestration + workflow templates (Feature/BugFix/Refactor/SecurityAudit) | 4 | Q3 2026 |
| Multi-claw layer: visual task DAG · cross-claw context bundle · streaming aggregation (backpressure/retries/mesh UX) · shared OpenAPI contract · team-memory mesh | 4 | Q3 2026 |
| Team hierarchy + rollup · manager↔employee 1:1 · job-title mgmt · team comparison · inactive-contributors report | 6c | Q3 2026 |
| Rate limiting per tenant (API + execution throughput) | 5 | Q4 2026 |

## Resolved Implementation Gaps (Builderforce.ai API)

| Gap | Location | Resolution |
|-----|----------|------------|
| User-suspension enforcement (no `is_suspended`; token revoke didn't block new logins) | `adminRoutes.ts:2247` | `0039_user_suspension.sql` + login/middleware check |
| Admin password reset sent no email | `adminRoutes.ts:2230` | Generates 24-hr magic link + sends email |
| Confluence / Freshservice connectivity test always `ok:true` | `integrationRoutes.ts:316` | Real `testConfluence()`/`testFreshservice()` |
| Magic-link email was a `console.log` stub | `oauthRoutes.ts:350` | `EmailService.ts` wired to Resend |
| Marketplace pricing migration orphaned (`price_cents does not exist`) | wrong folder | Ported to `0042_marketplace_pricing_and_developer_api.sql` |

---

## Resolved — by theme

### 🧠 Evermind / SSM

- **Frontier-LLM TEACHER distillation** (2026-07-03, api+frontend 2026.7.7) — pin any frontier model (Opus/Mistral/GLM) as a `teacher_model` (mig 0277) whose exemplar answers train a project's Evermind; coordinator DO distils in its alarm, cost-gated once/alarm via `getTenantTokenAvailability`, task-prompt distillation across all modalities (cloud/on-prem/VS Code), best-effort fallback to raw-text. `evermindTeacher.ts` + 13 tests.
- **Project Evermind — unified learning + default provisioning** (2026-07-03) — every project gets a default `EvermindLM`+BPE base on creation; all 3 modalities post text to ONE coordinator door (`…/evermind/learn-text`) that fits in its DO alarm (`MAX_FITS_PER_ALARM`, env-tunable) → FedAvg merge → R2; inference opt-in server-gated; editable in the LLM IDE; panel on all 4 modalities.
- **Facts tier — shared per-project write-through store** (2026-07-03) — `project_facts` (mig 0276) + `projectFacts.ts` (write-through by `(tenant,project,key)`, read-through cached) replaces VS Code local-disk `cognition.json`; backs cloud `memory_recall/remember`, on-prem knowledge-loop mirror, and web/VS-Code MCP tools.
- **Concurrent-learning coordinator — read-replica + single-writer** (2026-06-30) — per-project Evermind coordinator DO (weight-delta, pull-on-run-boundary); LIVE opt-in `inference_enabled` across all 3 surfaces + `ProjectEvermindPanel`.
- **Generative LM shipped** (`EvermindLM` in memory-engine `src/lm/`) — token embedding + depthwise causal conv mixer + shared-expert MoE FFN + tied head; CPU forward+backward (finite-diff checked), `generate()`, fp16/f32 checkpoint, trainer; overfit→generate + publish→buy→run tests pass. Closes the "not yet an LM" gap.
- **Shared-expert MoE generator core** — `SharedExpertMoE` + `MoETrainer` (AdamW + load-balance aux gradient) + `EvermindModelPackage` (portable `.evermind` artifact, FNV-1a integrity, model card); 15 tests.
- **Coding-skill foundation** (2026-06-30) — Phase 1 shipped; Phase 2 importer BUILT (v2026.6.36): `safetensorsToTensors`/`inferArchFromTensors`/`importEvermind` round-trips own exports, warm-starts a foreign checkpoint via a rename map, wired as the `import-model` workflow step.
- **Held-out coding benchmark** (2026-07-04, memory 2026.7.0) — `code-benchmark` workflow step scores strict pass@1 over unseen tasks via `runJsCases`, optional `minPass1` gate; wired into Teach-Code; 3 tests.
- **Benchmarking capability** (RESOLVED 2026-06-29, v2026.6.35) — engine republished exporting canonical `trainAndBenchmark`; frontend delegates (local duplicate deleted); server-side `benchmarkEvermind()` scores the user's actual trained `.evermind` via its own tokenizer; `POST /api/studio/models/:slug/benchmark` + BenchmarkPanel "Score a trained model" mode.
- **Model export / HF publishing** — IDE export wired 2026-06-30; ONNX/GGUF/safetensors emit; remaining items external/credential-blocked (transformers.js `pipeline()`, llama.cpp GGUF exec, live HF push).
- **Train→serve loop** (RESOLVED 2026-06-29) — Evermind is a generation backend in the gateway (`vendors/evermind.ts` runs a tenant's published `.evermind` on-CPU in the Worker); trained-SSM tenant base made live (`resolveTenantModel` falls back to `evermind/${trainedModelRef}`).
- **Learned-routing write-back for non-cloud runs** (2026-07-04, api 2026.7.11) — `POST /llm/v1/run-outcome` + `recordClientRunOutcome` + mig 0283 (`source`/`client_run_id`/nullable `execution_id`) fold IDE/on-prem/SDK run outcomes into the same routing table cloud runs teach.
- **Architecture review EVM-1..8** (RESOLVED 2026-06-28, v2026.6.34) + follow-ups EVM-1b/6b.
- **"Brain dies after several executions"** (2026-07-04) — root-caused to context exhaustion (primary) + `learn()` weight drift; fixed both: self-diagnosing copy button (`computeBrainDiagnostics` verdict, shared web+VS Code), 6KB tool-result cap + 24K-token window + compact list projections; Evermind stability rails (true WSLA freeze, `A_log` clamp, overflow-safe softplus, non-finite-step drop + trust region, rollback-on-regression).
- **Stale register entries retired** (2026-07-04): Project Evermind panel already on all 4 modalities; limbic `embedEvent` already uses the SSM hippocampus embedding; memory-package test suite (TS6059 → 0 tests) fixed via `isolatedModules:true` (22 tests green).
- **Seven-layer stack e2e (headless)** — `seven-layers.test.ts` exercises all 7 blog layers (L1/L3/L4/L7 real components).

### ⚙️ Agent runtime & engine consolidation

- **V1 RETIRED** (2026-06-13) — `builderforce-v2` is the consolidated default on every surface via one `DEFAULT_ENGINE_ID`; `runV1Engine` deleted, creation restricted to v2, mig 0120 back-fills legacy rows. (Cloud V1 dispatch branch + `builderforce-local` fate = tail items in ROADMAP.)
- **pi cutover — 3 of 4 `@mariozechner/pi-*` deps removed** (2026-06-13) — pi-agent-core/pi-coding-agent/pi-ai all deleted; native loop/tools/model-client/completion/OAuth+Codex; agent-runtime is pi-free + tsgo 0 + ~80 tests. 100 files/dirs renamed off `pi-*` names. Only pi-tui remains (→ ink behind the built `@builderforce/tui` `TuiRenderer` seam; migration is the ROADMAP tail).
- **Unified engine seam** — on-prem implements the shared `AgentEngine`; `resolveEngineById` shared; converged file tools behind `tools.fs.convergedFileTools`; `ask_human` on on-prem Node registry; `PolicyGate` `evaluatePolicyGate` hard-enforced at every engine's tool seam (cloud/on-prem/IDE), gates persist across DO ticks.
- **Shared tool catalogue** — 12 cross-runtime core + 21 Node-native tools under `@builderforce/agent-tools`; media tools port via the `ToolResult.content` block extension; `find-a-file-by-name` glob added to `list_files` across all 4 engines (2026-07-04, VSIX 2026.7.22).
- **`loadJsonFile` sync→async drift** — propagated `await` through the entire auth/credential/model subsystem; `tsc` green; github-copilot-token cache bug fixed.
- **SSM hippocampus loop** (DONE 2026-06-18) — agent-runtime loads `@seanhogg/builderforce-memory` (optionalDep), recall injected into prompts, KnowledgeLoop remembers per run; active cross-run `memory_recall/remember` tools for Node agents; server-side semantic cache wired into the cortex call; Worker/DO active memory (Postgres `agent_memory`, mig 0200); web `SemanticCache` L1.
- **frontend consumes engine via `@seanhogg/builderforce-memory-engine` npm** (DONE 2026-06-18), not the git URL.
- **TypeScript 6.0 + tsgo** (2026-06-27) — all ~20 packages on `typescript ^6.0.3` + `@typescript/native-preview`; TS6 breakages fixed (`ignoreDeprecations`, explicit `types`, `*.css` decl).
- **DRY / dead-code audit** (2026-07-04) — closed the deferred tail across api caching/perf (N+1 batching), api DRY utils (money/slugify/json/clamp/tokens/host-auth/R2-key single-sourced + permission-drift test), llm vendors (shared transport/probe/SSE parser, `slice(5)` fix), agent-runtime, agent-tools, VS Code (shared webview panels + `vscodeBridge` leak fix), frontend dead-code + i18n.

### ☁️ Cloud agent execution & PR loop

- **Always-on autonomous cloud execution** (global cron) + token gate + out-of-tokens upgrade email (2026-07-01).
- **Cloud V2 real Cloudflare Container + durable `CloudRunnerDO`** built (deploy verification remains in ROADMAP); Fly.io orphan deleted (Cloudflare-only).
- **Cloud git tools** — get-latest/undo/redo/status/diff/history added to the shared registry (shell-gated); full clone (dropped `--depth 1`); system prompt calls `git_sync_latest` first.
- **Multi-provider PR/repo loop** — GitHub/GitLab/Bitbucket Cloud create/merge/detail + read/write/PR (live-provider validation remains).
- **Context compaction + context-aware model selection** — 413 → cascade to bigger-window model; `compactMessages.ts` summarizes the bulky middle before each paid call; both cloud loops persist compacted state.
- **Cloud HITL `ask_human`** (mig 0120) for durable/Worker surfaces; `paused` state + Slack/email + `PATCH /approvals/:id` resume.
- **Anti-stub / honesty gates** — `scanForPlaceholders` blocks a `finish` with stubs; `run_checks` real static validator (`verifyWrittenFiles`); `assertsUnrunVerification` blocks claiming an unrun check passed; "⚠ Not verified in-agent" annotation.
- **Post-merge build validation + auto-fix** — `merge_sha` correlation → failed-jobs fetch → capped auto-fix dispatch; opt-in merge-only-on-green gate.
- **Model-selection observability** — run-start `model.select` + `coding_model_degraded` events spell out cause + consequence.
- **Board execution-approval override** (board setting, 2026-06-30); autonomous lane chaining fires the next lane's agent on completion (2026-06-14); swimlane autonomous-agent trigger + ownership-clobber fix (2026-06-29).
- **Cost attribution** — ticket→project→tenant on `llm_usage_log` (migs 0103/0104); ticket spend on the execution panel + By-Project card; gateway tool-call portability (execution #91 triage, 2026-06-30).

### 🔀 LLM gateway, routing & cost

- **Anthropic cost-drain root-caused + fixed** (2026-06-15) — `CLOUDFLARE_ACCOUNT_ID` was unbound (killing free-neuron routing); added + live CF coders; capacity-limit 4xx → retryable failover; `CODING_FREE_ATTEMPT_BUDGET` walks the whole free coding pool first; 60-min vendor cooldown on a capacity strike.
- **Paid-overflow cap** (mig 0130) — `tenants.paid_overflow_daily_cap` + `llm_usage_log.paid_overflow`; `isPaidOverflowExhausted` gate closes the funded path per-tenant while the primary pool keeps serving; superadmin cap editor; image-gen overflow classified + capped (2026-06-21).
- **Consumption meter framework** (`/api/consumption` multi-meter: `ai_tokens` + `ingestion`) — `enforceTokenCaps` (daily + monthly, cache-discounted, shared resolver so displayed==enforced); ingestion ledger (mig 0218, repo-import metered → 402); image credits separated from chat budget (mig 0131).
- **Prompt caching ON for every call** — `applyPromptCaching` in the shared body builder + direct-Anthropic floor; `_builderforce.cacheTtl:'1h'` honored gateway-side + on-prem (OpenRouter-Anthropic long TTL).
- **Cloudflare leads every paid pool** (free-neuron-first); CF moved to the OpenAI-compatible endpoint + one shared `buildOpenAIChatBody`.
- **Learned model routing (PRD 13)** — action-type classifier (mig 0197) → outcome scorer (0198) → `routing:<scope>` KV reorders `pickCloudModel`; kill switch.
- **Direct-Anthropic coding floor** (`CLAUDE_API_KEY`, sonnet-4-6→opus-4-8, `autoRoute:false`) as funded last-resort.
- **Claude subscription BYO OAuth** (mig 0198) — tenants connect own Pro/Max (PKCE) for $0-token V2.
- **Vendor hardening (T3 sweep, 2026-06-14/21)** — metadata-driven schema-dialect strip; image-gen health probe; FluxAPI async-poll; vendor-prefix image pools; plan-aware `FREE_ATTEMPT_BUDGET` (Free 2 / Pro 5); cascade no longer falls back to the same 429-ing seed; awaited cooldown writes; failover breakdown on the success path.
- **`/v1/usage` bySource split** (shared `usageSource.ts`); daily/monthly cap gate shared across `/v1/messages` + `/v1/chat/completions`; cache-read tokens discounted in the ledger.

### 🧠 Brain / chat

- **Unified Brain chat experience — web + VS Code** (SHIPPED 2026-06-29, consolidation CLOSED VSIX 2026.6.38) — shared tool catalog + transcript UI + system prompt; webview gained platform tools; two chat surfaces consolidated; webview localized.
- **Brain agent loop survives navigation** (2026-06-14/16) — loop hoisted into a module-level single-flight `brainRunStore` (LRU-bounded) keyed by chatId; confirm gate in the store; drawer persists open+activeChat to sessionStorage; internal links route client-side.
- **Brain rendering fixes** — per-turn durable message blocks (no erased narration); inline `<tool_call>` XML lifted + executed (`xmlToolCalls.ts`).
- **Brain can create real OKRs** (objectives+key results, not fake "Epic" OKRs) (2026-06-29); Brain reads external URLs/files (`POST /api/brain/fetch-url`, rate-limited + `outbound_fetches` meter mig 0262).
- **One brain, one tool catalog** — web Brain + VS Code share the gateway MCP catalog (`builtinMcpService.ts`, `/llm/v1/mcp/*`); full READ parity across domains.
- **Brain chat triage + web/VS Code parity** (2026-06-29, VSIX 2026.6.39); Brain drives dashboards & alerts (`alerts.*`/`dashboards.*` caps).
- **Consolidate + Fork** (VS Code, 2026-07-04, VSIX 2026.7.22) — summarize→compressed seed / new seeded chat; marker convention in shared `brain-embedded/src/consolidation.ts`; project label + model/Evermind provenance in the copied transcript.

### 🖥️ VS Code extension

- **Coding agent + browser device-code sign-in built** (2026-06-17..20) — agentic tool loop over sandboxed path-guarded file tools; codebase scan → `.builderforce/architecture.md` grounding; RFC 8628 device flow + `DeviceAuthService` (mig 0201, mints `bfk_*`) + `/activate` (backend deploy pending — ROADMAP).
- **Northstar Tiers 1–3** (2026-06-30, VSIX 2026.6.42 + gateway 2026.6.32) — CLOSED.
- **Native in-editor pages** — pivoted from `/embed` iframes to bundled-React webview screens: Project 360 (2026.7.3), Board, Backlog/PRDs/Roadmap/Retros/Poker via a DRY `<ProjectListView>`/`ProjectPageScreen`; broken `/embed`-in-webview picker deleted.
- **Project tree** — Flat/Hierarchy + group/sort/filter (VSIX 2026.7.7); OKR/objective tier + "Needs attention" + right-click type conversion (2026.7.8); "Assigned to me" filter + runtime l10n via `GET /api/vscode/me` (2026.7.9).
- **Sidebar workspace → project → work flow** (2026-07-03) — first-class workspace row; Sessions filter by project.
- **VS Code as 3rd agent runtime** — `POST /api/auth/tenant-api-key-token` + `vscode_connections` (mig 0202) + heartbeat; project/task tree + task-linked sessions + set-status (fires lane automation). 401/superadmin-cap/gateway-500 fixed in code (deploy pending).
- **Chats tied to work** — link chats to tickets/health/lineage/merge/agent tagging (2026-07-03).
- **AI Manager** — designated coordinator that keeps the team moving (2026-07-03); auto-approve mid-run fix (VSIX 2026.7.6, via `autoApproveRef`).
- **Builder-level insights pushed to IDE/CLI** — `GET /llm/v1/builder-insights` + SSE stream; VS Code status bar + Insights tree; MCP `token_usage`/`model_efficiency`; `builderforce usage` CLI.

### 👥 Workforce, boards, kanban, ceremonies, personality

- **Agentic Workforce Kanban** (SHIPPED 2026-07-03, api+frontend 2026.7.4) — job-role taxonomy (mig 0274), KanbanTemplate engine + `swimlane_requirements`, recommended roster, per-ticket role/diagnostic audit (mig 0275), requirement gating, template marketplace.
- **Delta→ticket capture + Validator agent** (2026-07-03, migs 0270/0271) — GAP task type + review ledger + `work_deltas` provenance; `tickets.from_delta`/`reviews.record` MCP tools; `completeTaskOnMerge` shared Done path; daily validation sweep.
- **Convert work-item TYPE across board⇄OKR** (2026-07-03) — one shared `convertWorkItemType` (task⇄epic, →objective mig 0268, objective→task); MCP `work_items.convert_type` + REST + UI.
- **Project 360** — whole-picture management view in the VS Code webview (2026-07-03); objectives gain a direct PROJECT scope (mig 0268) so 360 "Direction" counts created OKRs; full project inspection (multi-dimension PM rating + prescriptive panel) (2026-06-29).
- **Personality LIVE end-to-end** (2026-06-30) — test → persona/agent → cloud runtime + Evermind setpoints (migs 0259/0260); extended to HUMAN users (every user takes the test, shown on their card, 2026-07-03).
- **Limbic system** — trainable WebGPU affective layer + runtime wiring across all surfaces (shared compiler, cloud V3 per-step directive seam, on-prem SDK parity, VS Code); "personality=setpoints, limbic=dynamics".
- **Agent engine consolidated to V3** (loop + limbic always-on) (2026-06-30).
- **Member metrics + DORA + planner + Calendar sync** (migs 0116–0118, 0122) — profiles, `task_status_transitions`, `member_metrics_period`, `deployment_events`, `assigneeRecommender`, Google Calendar overlay.
- **Ceremonies** — standup/planning round-table (live multiplayer `CeremonyRoomDO`, Epic/sprint drag) + tracking/scorecards/power-meters (mig 0119, consumes member-metrics).
- **Teams** (mig 0114) drive assignee scoping; canonical `agent_assignments` (mig 0082); Workforce/Members consolidation (shared `WorkforceCard`, pending-invite lifecycle mig 0114); single AgentCard convention (mig 0101 soft-delete).
- **Activity consolidation** (migs 0205/0212) — reversible contributor merge + tenant rollup + engagement scoring; multi-provider activity ingest (GitHub/GitLab/Bitbucket webhooks + zero-config poller); discipline lens (mig 0228).
- **Nav simplified** (2026-06-25) — primary destinations + shared `SectionTabs`/`navGroups`; PMO/Ceremonies folded into Projects; Projects tab count badge restored.

### 📊 Insights, analytics, PMO & metrics

- **PMO portfolio tier** (mig 0213) — portfolios/initiatives/objectives/key-results + `portfolioRollup.ts` (cost/DORA/OKR); LENS #4 + dependency graph/critical path (mig 0219); project→initiative link; scheduled portfolio exec-summary; report dispatcher (`runDueReports`).
- **Role-insight lenses #1/2/3/5/6** (mig 0220) — engineering (AI-effectiveness over `run_model_outcomes`), DORA, finance (FinOps + budgets + forecast), compliance (evidence-pack export), funnel; shared `LensShell`; consumption + monthly allowance enforced.
- **Planning spine** (mig 0225) — unified Gantt + Portfolio/OKR into one dated CAPEX/OPEX hierarchy; `/api/pmo/spine` (+ project scope, roadmap folded in, period-bounded CSV export); real time-tracking `time_entries` (mig 0247) replaces the labour estimate; lineage inheritance.
- **Jellyfish EMP parity** — [EMP-1] categorical time-allocation lens (mig 0226) + [EMP-2] goals/variance + [EMP-1a] project scope; [EMP-3] Jira ingest via board-sync; [EMP-4] story points (mig 0246) + derived velocity; [EMP-6/7/8] delivery lens (burnup/forecast/scope-creep); [EMP-10] release↔deliverable (mig 0235); [EMP-11] deliverable update stream (mig 0248); [EMP-18] CapEx/OpEx split; bottleneck root-cause drill-down.
- **AI-Usage visualization layer** — `charts/*` primitives; AI Impact + Finance lenses; `/api/insights/ai-impact`; SPACE metrics; NL queries; industry benchmarking; DevEx surveys; DevFinOps + R&D tax credit.
- **Insights-everywhere + pinnable-widget dashboard** — `InsightStat` primitive DRYs recency/stat widgets; no-new-endpoint surfaces ported to `registry-modules/*` (16 widgets/9 groups); app-wide widget registry (mig 0253).
- **Insights/Delivery/Finance/AI hub consolidations** (2026-06-28) — merged tabs into panel hubs (`<hub>Panels` registry + `<Hub>PanelProvider` + `<Hub>Dashboard`).
- **Maturity diagnostic → generic Diagnostics & Tools engine** (`/api/tools`) — data-provider capability, +8 tools; project diagnostics scoring → tenant rollup; arch-agent removed (architecture is a diagnostic); RBAC RoleGate primitives + `<RoleGate>` (disable, never hide).
- **FinOps `soc_controls` collision** — migs 0057 & 0233 both named it → renamed `finops_soc_controls` (mig 0254).
- **Consolidated Feature Register** table + gap-register organization; Jellyfish-parity audit closed (token analytics team/repo/user, bottleneck lens, alerts subsystem mig 0234).

### 🛍️ Marketplace, talent & freelance

- **Freelance marketplace** (2026-07-03, migs 0269/0273) — `account_type='freelancer'` restricted shell + for-hire profiles + cross-tenant engagements + activity→timecard billing; round-3 built all 7 gaps (bidding board, invoices/payouts, ratings, talent search, notifications, accept/decline, per-profile SEO).
- **For-hire opt-in** (mig 0282) — existing builders opt in via `users.available_for_hire`; `/freelancers/me/availability` + ForHireCard.
- **Talent/Workforce role assignment** (mig 0281) — explicit roster assignment (`project_role_assignments`); `/hires`→Workforce Talent tab + Roles tab; shared `RoleAssigneePicker`.
- **Talent + Models merged into Marketplace** (2026-07-04) — `/talent` + `/models` → `/marketplace` categories (lazy-loaded, `?category=` reactive); standalone routes redirect; `ModelsExplorer` + `SkeletonGrid` extracted.
- **Single-pane / migration connectors** (mig 0221) — 8 board-sync providers (Linear/Sentry/PagerDuty/Freshservice/ServiceNow/monday/Asana/ClickUp) via `providerCatalog` + `BoardProvider` registry; per-provider webhook signatures; full-drain pagination; scheduled `runBoardSyncSweep`; initial full pull = migration-in.
- **Public Prompt Library seeded** (mig 0210) — 15 curated system prompts as first-class public rows (client-side built-ins deleted).

### 📖 Knowledge, compile primitive & workflows

- **Compile primitive spine COMPLETE** (C1–C5) — canonical `AgentSpec` IR + `lowerAgentSpec` + `compile()`/`deploy()` registries + 6 modality adapters (prose/dataset/graph/persona/diagnostic/policy) + `PolicyGate` + `POST /api/compile` + `/compile` page; `deployAndDispatch` starts the run; `AgentSpec.steps`/`surfaces` consumed end-to-end.
- **Pillar-2 train-on-data (PRD C3)** — `agent_knowledge_chunks` (mig 0249) + `ingestAgentKnowledge` (chunk→embed→BM25 recall) + `POST /api/ide/agents/:id/ingest`; recall wired into `/agents/:id/chat` and the `/v1` workforce-ref gateway path.
- **Knowledge management subsystem** (mig 0227, `/api/knowledge`) — SOP/Process/Doc base with versioning, read-ack audit, AI authoring (streams), per-page collaborators; SOP analysis (`/analyze` → findings + improved flow); invite/training-assignment notifications.
- **Agent-stack parity — Layers 4 (hybrid RAG) & 6 (semantic eval + drift)** — `@seanhogg/builderforce-memory/retrieval` (chunk/BM25/RRF/MMR); `application/eval/` (faithfulness/relevance/hallucination + drift monitor, mig 0222); `POST /api/eval` + daily drift sweep.
- **Agentic workflow builder** (mig 0060) — visual IPAAS builder w/ LLM-logic nodes; portal→host execution (`/api/workflows/claim`), memory-write/KB-ingest/train delegates, ETL eval, YAML isomorphism; `workflow_triggers` webhook transport; workflow fork-on-edit.
- **Board Deck Generator** (2026-06-27) — generative + in-place-fill decks (pptxgenjs).
- **Knowledge canvas** — `CanvasSlideOver` built; real-time co-editing code-complete (infra-blocked).

### 🎬 Studio (video / voice)

- **Voice clone foundation** — Phase 1+2 (speaker encoder/RVQ codec/SSM acoustic) in builderforce-studio + builderforce-voice; server route #1994 + IDE `VoiceClonePanel` (`/ide/voice`, on-device WebGPU preferred, mic capture, consent); scoped per IDE project (`studio_voice_clones.ide_project_id`).
- **Voice consolidated into the IDE** (2026-06-28); voice sub-panels localized.
- **Studio engine** — noise-scaled latent-residual bias formula composes with img2img; anchor-refresh + zoom (`scaleLatent`); coarse-to-fine block optical-flow motion interpolator; 9-layer ONNX-execution invariants unit-tested; `/api/studio/weights/*` R2 proxy + upload tooling; quality-tier effective-chain single source + badge + debug snapshot; custom refinement-pair picker; mp4-muxer codec probe.

### 🧪 QA

- **Agentic QA pipeline** (mig 0063) — capture → aggregate → AI-generate → authenticated Playwright → report; per-project suite (mig 0068, encrypted personas); escaped-defect→producer attribution; cross-exploration fix-task dedupe.
- **Agentic Tester** (migs 0206/0209) — heatmap-driven exploratory testing; schedulable platform-native agent (deleted the GitHub-Action surface); managed Cloudflare Container dispatch (`QaRunnerContainerDO`, chromium-slim image).
- **Product Quality / Error Observability** (mig 0240) — ingest via adapter seam (native/OTLP/Sentry/PostHog/LogRocket) → `error_groups` → `/quality` → one-click agent fix; project = one collector (`error_collectors` mig 0250, mapping rules); [QUAL-1] retention, [QUAL-2] OTLP protobuf, [QUAL-3] exact user_count (mig 0245), [QUAL-4] Sentry backfill.

### 🏢 Multi-tenant, embed & governance

- **Segment tier foundation** (migs 0054/0056) — `segments` + tenant `kind`/`idp_issuer`/`isolation_mode`; `segment_id` on 34 tables + DB default-fill trigger (single fills, segmented RAISEs); `resolveSegment()` chokepoint; provisioning routes. (Read-isolation RLS + write-threading cutover remain in ROADMAP.)
- **Embed rail** — `@seanhogg/builderforce-embedded` `<BuilderForceEmbed>` (sandboxed iframe + postMessage JWT); `/embed/[view]` frame; `frame-ancestors` CSP; SuperAdmin enablement (`/api/embed/config`); default-CLOSED trust (`isTrustedHostOrigin`); all 30 views live (shared `segmentTrackerRoutes` factory + `TrackerSurface`); poker/retros real-time over `SessionRoomDO`; lean `/embed` layout + in-band error reporter; `vscode-webview:` trusted.
- **Governance/security trackers** (migs 0057/0058) — SOC2 controls/evidence, vendors, incidents, PII, DPAs, trainings, compliance events, DSR, suppression — segment-threaded; `TrackerSurface` + `Soc2Content`.
- **Agentic governance PRD 08** — policy-packs + `governance-auditor` design; identity federation accepted as HS256 shared-secret (revisit for non-first-party hosts).
- **BurnRateOS embed / identity-federation spec** (doc 05) reviewed; consent + per-scope tokens (mig 0070) + DSR cascade + channel-3 seams (feedback ingest, BI pull, HMAC webhooks mig 0071) shipped.
- **Marketplace edge-runtime fix** — server-component fetch needs `runtime='edge'` (/models pattern).

### 🌐 Marketing / SEO / public

- **Marketing site refreshed** (2026-07-04) — 6 new feature cards + 5 FAQ + 5 GEO terms + `/compare` "Self-Improving Models & Proof of Done" category + `/product` Workforce-Kanban surface; feature-icon index-drift bug fixed (missing "Hire Human Talent" entry realigned 29 icons).
- **Programmatic SEO leaf pages** (2026-06-14) — `/compare/{slug}` (7 competitors) + `/integrations/{slug}` (10 tools) + index, each with `generateStaticParams`/metadata/JSON-LD/OG/sitemap.
- **Feature-route marketing pages** (2026-06-21) — rich per-route content (highlights/FAQ/RelatedArticles/JSON-LD) at the shared `RouteMarketing` chokepoint; flagship `/agents` + `/prompts` server-wrapped; dedicated marketing pages surfaced past the RouteMarketing teaser.
- **Marketing content + SEO/GEO refresh** — blog posts + `RELATED_ARTICLES` mechanism + pagination; social link-preview PNG fixed on the edge; brand mascot + lockup (B-bolt); marketing pages localized in all 5 locales.
- **Static rendering restored** (2026-06-24) — client-side locale (`LocaleProvider`) keeps 51 routes static; CI build-and-deploy green; branded localized 404.
- **Canonical footer** — one `AppFooter` (variant `legal`/`full`); per-page footers dropped.
- **Cold-invite email** + configured-quickstart installer env-wiring (both OSes).

### 🌍 i18n / localization

- **next-intl scaffold** (2026-06-23) — cookie-based locale (EN/ZH/ES/FR/DE, no `/[locale]/` segment), `Accept-Language` detect, `/settings` reference; marketing/public pages fully localized in all 5 (2026-06-29); many app surfaces migrated (`BrainPanel`, `TaskMgmtContent`, `AgentPublishPanel`, `ProjectTable`, `PsychometricEditor`, `ProjectDetailsPanel`, PMO, insights lenses, catalog chrome).

### 🛠️ CI/CD, migrations, tech-debt & rebrand

- **CoderClaw → BuilderForce rebrand** (2026-06-02..03, all 8 phases) — DB rename mig 0078 (applied+verified, `coderclaw_instances`→`agent_hosts`, `ClawRelayDO`→`AgentHostRelayDO`); full `api`/`frontend`/`docs-site` rename; product deep-renamed + folded into `agent-runtime/` (`@seanhogg/builderforce-agents`, 755 test files green); repo renamed; `/api/claws` back-compat alias; `bfa_` key prefix dual-accept. Load-bearing `claw`/`coderclaw` (migrations, live columns, published npm/domain/env, DO history) intentionally frozen.
- **Mascot retired** — 🦀/🦞 swept to `MascotIcon`; lobster workflow-tool + banner + `LOBSTER_PALETTE` deleted; taglines/quips removed.
- **Enforceable isolation tracks** — `.github/isolation-tracks.json` + `check-track-scope` (CI + pre-commit) reject out-of-scope files / out-of-band migrations.
- **Migration runner hardening** — transactional per file (`sql.transaction`); duplicate prefixes renumbered into bands + `.migration-collisions-allowlist.txt`; `check-migrations` fails CI on new duplicates; drift checker rename-aware (follows `RENAME`/directives, allowlist 106→~75).
- **Push-only tables backfilled** — contributor/team subsystem (`0068a`), `telemetry_spans` (`0073`), `agents`+`approval_rules` (`0123`); business tables 0208.
- **Webhook retry/backoff** (mig 0160, capped exp + dead-letter); `awaiting_workflow` parked-ticket lifecycle (mig 0171) + park-age timeout; `brain-embedded` built in CI link-dep step; frontend Vitest React dedupe.
- **Cost-control confirmations** (2026-06-14) — verified agent-runtime Anthropic caching IS on + gateway does NOT strip `cache_control` (not bugs).
- **Paid-plan feature gating centralized** (2026-07-04) — one `evaluateFeatureEntitlement` (superadmin→override→plan) + `requireFeature` → 402 naming feature+requiredPlan; personality test ungated; voice-cloning a real `PlanLimits` flag.
- **API compile breakages from concurrent edits** cleared (2026-07-03) — duplicate `timeEntries` / missing hired-video SDK / Neon typing / stale fixtures.
- **Multi-track gap-burndown sweeps** (2026-06-14 & 2026-06-21) — closed the code-actionable subset across T1–T10 (Select component, canonical footer, `/v1/messages` cap, PR-dispatch repo resolution, host-auth dual-branch, `runtime_support` enforcement, async credential writes, webhook retry, board-sync poller, orphaned-task reassign, migration renumber/transaction, track-scope guard, i18n leaf pages, PWA toast stack, slim `list_tasks`, metadata-driven schema strip, `pr_opened` claim, on-prem `ask_human`, embed error reporter, `workitem.released`, host BI config, feedback triage).
- **Global tenant→project scope** — `ProjectScopeContext` + TopBar switcher (null=All); `usePmScope` follows it; IDE projects as first-class child of Project (mig 0224); voice/repo/LLM modalities.
