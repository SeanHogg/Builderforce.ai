# Builderforce.ai — Done / Completed

> Record of completed, shipped, and resolved work, moved out of [ROADMAP.md](./ROADMAP.md) (which tracks only outstanding TODO/In-Progress/Partial items). Entries are condensed to *what shipped + when + key migration/files*; `git log` is the full audit trail. Open follow-ups for any feature below live in the roadmap.

---

## ✅ RESOLVED 2026-07-05 — A connected BYO account was shadowed by an agent's default base model (Ada ran on `@cf/qwen` despite a live Claude subscription); DRY'd the explicit-vs-BYO rule into one tested primitive (api `2026.7.47`)

Reported: an addressed agent (Ada, Sr PM) "ran on your connected Claude subscription (model: `@cf/qwen/qwen3-30b-a3b-fp8`) but produced no reply" — i.e. the diagnostic **claimed** the connected account but a weak Cloudflare free-coder actually ran and returned an empty turn. Two root causes, both a duplication/divergence of the "explicit-model-vs-BYO" decision:

- **The decision was inlined in 3 places and drifted.** [`BrainService.agentReply`](./api/src/application/brain/BrainService.ts) passed the agent's `base_model` (`@cf/qwen`, a seeded default) as an explicit `model:` pin, which pre-empts the gateway's BYO auto-seed — so the connected Claude flagship never led. [`pickCloudModel`](./api/src/application/llm/LlmProxyService.ts) had the SAME latent bug (a Pro tenant + connected Claude + agent base-model `@cf/qwen` would strict-pin qwen). Fixed by extracting ONE shared rule — **`explicitModelPreemptsByo(explicit, byoVendors)`**: an explicit model wins over the connected account ONLY when nothing is connected OR the model is itself served by a connected BYO vendor (a deliberate pick on the owner's own account). A non-BYO pin (a default `@cf/*` base model) no longer shadows a connected account. Both `agentReply` and `pickCloudModel` now call it — no divergence possible.
- **The diagnostic lied.** `agentReply`'s "ran on your connected Claude subscription" was set from token *presence* alone. Now derived from the model that ACTUALLY resolved (`vendorForModel(lastModel)`): it names the real connected account only when a connected vendor served it, else says "the shared model pool (your connected account was NOT used for this run)".
- **Reply path vs conversation paths — correctly distinct (confirmed, not conflated):** the REPLY path (`agentReply`, an agent acting) threads the tenant's BYO account + tools + coding backstop; the conversation-support utilities (`summarizeChat`/`consolidateProjectMemory`/`summarizeSession`) intentionally stay operator-key + no-tools + no-BYO (a summary must not burn the owner's quota).
- **This should have been caught by tests — now it is.** New exhaustive unit tests in [LlmProxyService.codingPool.test.ts](./api/src/application/llm/LlmProxyService.codingPool.test.ts) for `explicitModelPreemptsByo` (no-explicit / nothing-connected / non-BYO-pin-with-account / deliberate-BYO-pin) and a `pickCloudModel` case reproducing the exact Ada/`@cf/qwen` regression (connected Opus leads, pin ignored) plus a no-regression case (non-BYO pin honored when nothing connected). Verified: api `tsgo` 0 new errors; LLM + brain + llmRoutes suites pass (47 coding-pool, 462 llm+brain, 28 routes).

## ✅ RESOLVED 2026-07-05 — Tagging an agent errored `Agent returned an empty reply`; now runs on the tenant's BYO account with actionable diagnostics (api `2026.7.46`, vscode `2026.7.41`, brain-ui `2026.7.12`)

Directing a chat turn to an invited agent (`@agent`) errored with a bare `{"error":"Agent returned an empty reply"}`, even though the tenant had a **connected, active BYO frontier account** (Claude subscription). Root cause: `BrainService.agentReply` built its LLM via `buildLlmService(apiKey) = ideProxy({ OPENROUTER_API_KEY })` — the **operator** key with `model: undefined` — so it (a) completely bypassed the tenant's BYO subscription/keys and the BYO-leads auto-select, and (b) let the gateway auto-select a weak non-coder for an agentic tool loop, which returned an empty turn.

- **BYO now leads the addressed-agent run** — `agentReply` resolves the tenant's plan (`resolveTenantRouting` → `resolveEffectivePlan`, mirroring the gateway's `resolveTenantPlan` from this service's db) and BYO credentials (`resolveTenantLlmCredentials` → `{ anthropicOAuthToken, vendorKeys }`), then builds the proxy via `llmProxyForPlan(env, plan, premium, { codingOnly: true, backstopModels: CODING_BACKSTOP_MODELS, anthropicOAuthToken, tenantVendorKeys })`. Same BYO-first ladder the Brain chat uses; an agentic tool turn, so failover is restricted to the coding pool. An agent with its own `base_model` still pins it; otherwise the model is left unset so the proxy seeds the BYO flagship (Claude) ahead of the pool. [BrainService.ts](./api/src/application/brain/BrainService.ts)
- **Always-speaks final synthesis** — replaced the last-iteration-only fallback with a post-loop guarantee: if the tool loop yields no prose (only tool calls, or an empty turn), ONE final no-tools completion forces a plain-prose reply. Reduces empties structurally.
- **Actionable diagnostics** — the remaining-empty error now names the account used (connected Claude subscription / provider key / shared pool), the resolved model, and the tool-call/step count, and suggests the fix (retry, set a stronger agent base model, or check the account) — instead of a bare "empty reply". The VS Code webview `authedFetch` now parses `{ error }`/`{ message }` from an error body so it surfaces as a sentence, not raw JSON (the web `throwApiError` already did).
- **Copy reflects tagging** — the recipient picker's per-participant hint is kind-aware (agent → "Replies & acts", person → "Notified"), and the ChatTickets `agentsHint` now reads "Type @ in the message box to tag an invited agent — it replies in the chat and can act on the team's work — or run it on a linked task/epic above" (brain-ui default + all five web i18n catalogs).
- **Verification** — api `tsc` 0 new errors (only the pre-existing `builderforce-quality/server` resolution error); LlmProxyService codingPool suite 41/41; vscode host+webview typecheck clean; brain-ui dist rebuilt; VSIX `builderforce-ai-2026.7.41.vsix` packaged. Live agent-reply on a connected BYO account needs a real subscription + deploy to exercise end-to-end (not drivable in-repo).

## ✅ RESOLVED 2026-07-05 — `@`-mention typeahead: tag an agent OR person to direct a chat turn, in every modality (vscode `2026.7.40`, brain-embedded `2026.7.12`, brain-ui `2026.7.11`)

User (VS Code webview) added two agents to a chat and expected typing `@` to open a picker to direct the message — but `@ada` was inert plain text with no typeahead. The directed-message routing spine already existed (`mentionRecipient`/`resolveRecipient`/`addressedTo` metadata + a "To:" recipient dropdown on both surfaces); what was missing was the composer typeahead UI. Built it ONCE and wired both surfaces so they behave identically.

- **Pure detection helpers (single source of truth)** — [`activeMentionToken`](./brain-embedded/src/directedMessage.ts) (detects the in-progress `@token` at the caret; never fires on an email's `@`) + [`filterMentionCandidates`](./brain-embedded/src/directedMessage.ts) (case-insensitive substring, name-start ranked first) live beside the existing `mentionRecipient`, mirroring its `@([^\s@]+)` grammar. Unit-tested (15/15 in `directedMessage.test.ts`).
- **Shared headless hook + popup** — [`useMentionAutocomplete`](./packages/brain-ui/src/mention/MentionAutocomplete.tsx) in brain-ui owns the token/selection state, returns an `onKeyDown` (↑/↓/Enter/Tab/Esc — consumes the key so it never also submits), an `onSelect` (caret sync), and a theme-aware `popup` node (agents + humans, `Avatar` + kind badge; the CSS-var fallback chain themes it in web light/dark AND the editor). Picking strips the `@query` (the recipient shows in the existing "To:" chip) and calls `onPick` → the host's `setRecipientChoice`, reusing the entire routing spine.
- **Both surfaces, all modalities** — wired into the web [`ChatInput`](./frontend/src/components/ChatInput.tsx) (new `mentionables`/`onMention` props; consumed by [`BrainPanel`](./frontend/src/components/brain/BrainPanel.tsx) passing `participants`/`setRecipientChoice`) and the VS Code webview composer ([`App.tsx`](./clients/vscode/webview/src/App.tsx)). Participants come from `useChatParticipants` (invited agents + active human members) — driven by the chat, not the persona — so tagging works in every modality by construction. Both surfaces keep their explicit "To:" dropdown as the equivalent fallback.
- **i18n + package hygiene** — `chatInput.mention*` keys added to all five catalogs (en/zh/es/fr/de); webview labels follow the existing `t(key, fallback)` pattern. brain-embedded + brain-ui dist rebuilt; frontend + webview typecheck clean (only the pre-existing unrelated `@seanhogg/builderforce-quality` resolution error remains); VSIX `builderforce-ai-2026.7.40.vsix` packaged.


Owner requirement: when an account owner connects their OWN frontier account (Anthropic Pro/Max **subscription**/OAuth, or a BYO api-key for Anthropic/OpenAI/Google), that account must be **used instead of** the free/paid gateway tiers — not merely unlocked for explicit model-picking. Diagnosed from BuilderForce chat #42 (project #11), which ran on `minimaxai/minimax-m2.7` + `deepseek/deepseek-v4-flash` (gateway auto-select) despite a live "Claude subscription connected": the connected subscription (`anthropicOAuthToken`) was threaded into the proxy but only changed **auth** when the cascade happened to land on an Anthropic model — it never **led** the pool, and `byoVendors` was consumed only by the strict-pin gate (so a connected account was used *only when the user picked its model*).

- **One DRY, registration-driven helper** — [`byoAutoSeedModels`](./api/src/application/llm/LlmProxyService.ts) maps a tenant's connected VENDOR set → the owner's OWN premium frontier model(s) to lead with, reflecting **exactly what was registered** (NO hardcoded vendor): connect only OpenAI → GPT leads; connect all three → all three frontier flagships lead, **ordered by catalog TIER (ULTRA→PREMIUM→STANDARD) from data** so the strongest is tried first and the cascade fails over across the owner's OTHER connected accounts before any free/paid model. Per-provider (`providerFrontierFlagship`): Anthropic splits by turn shape — **Opus (`claude-opus-4-8`) for agentic tool-loops, Sonnet (`claude-sonnet-4-6`) for plain chat**; OpenAI → `direct/openai/gpt-4.1`, Google → `googleai/gemini-2.5-pro` (the `direct/`/`googleai/` prefixes route to the tenant-keyed DIRECT vendor, never a bare `openai/…` that hijacks OpenRouter's operator-keyed namespace).
- **Applied on both surfaces** — the gateway completion path ([`LlmProxyService.complete`](./api/src/application/llm/LlmProxyService.ts)) leads the cascade with the WHOLE connected-flagship list when the caller pinned no model (soft seed → the free/paid pool stays as fallback; the strongest head also bypasses vendor-level cooldown), and the cloud-agent pin ([`pickCloudModel`](./api/src/application/llm/LlmProxyService.ts)) leads with the strongest connected flagship (`[0]`) — so Brain chat, on-prem, SDK, and cloud agents ("prefer BYO everywhere") all lead with the owner's account(s). A prefix-aware `isDispatchableSeed` guards the seed list against a drifted flagship constant.
- **Billing correctness (adjacent fix)** — the four paid-overflow computations now key off `isTenantFunded` (subscription **or** BYO api-key) instead of `isSubscriptionFunded`, so a BYO-api-key resolution onto a `claude-*`/overflow id is $0 → byo and never counts against the platform's paid-overflow cap.
- **Tests** — new drift-guards + behavior tests in [LlmProxyService.codingPool.test.ts](./api/src/application/llm/LlmProxyService.codingPool.test.ts) (Opus/Sonnet split, registration-driven multi-provider ordering by tier, OpenAI-only leads with GPT not Anthropic, `direct/openai/` vs bare-OpenRouter routing, every seed dispatchable, `pickCloudModel` soft-seed on free plan, explicit pin still wins). Verified: api `tsgo` 0 new errors; full LLM + llmRoutes suites pass.

---

## ✅ RESOLVED 2026-07-05 — Gig Marketplace: publish a work item as a hireable gig, MCP-first (api `2026.7.42` · frontend `2026.7.34` · mig `0293`)

"Simplify publishing a project/scope for the Gigs." One coherent slice turning any work item into a bid-able gig, with AI proposal evaluation, meetings tracked against the item, a REAL engagement→project access grant, and the FTE Job-Posting flow — all driven by MCP tools so the Brain can ideate → publish → hire.

- **New hireable work-item kinds + ticket→posting bridge** (mig `0293`): `task_type` gains `product` (a PM-authored product brief) and `design` (a UI/UX or design-review gig). `tasks.hireable` + `job_postings.source_ticket_id`/`posting_type`(project_bid|design|fte)/`engagement_type`/`requirements` link a ticket to its published gig. One-click **Publish to Marketplace** on a ticket ([PublishToMarketplaceModal.tsx](./frontend/src/components/PublishToMarketplaceModal.tsx) + the Marketplace section in [TaskMgmtContent.tsx](./frontend/src/components/TaskMgmtContent.tsx)); the server derives the scope from the ticket so the Brain can publish with just a ticketId ([gigMarketplaceRoutes.ts](./api/src/presentation/routes/gigMarketplaceRoutes.ts) `/api/marketplace/*`).
- **MCP-first**: 11 new built-in MCP tools ([builtinMcpService.ts](./api/src/application/llm/builtinMcpService.ts)) — `marketplace.publish_ticket`/`unpublish_ticket`, `jobs.create`/`list_mine`/`proposals`, `proposals.evaluate`/`shortlist`/`decline`, `meetings.schedule`, `deliverables.evaluate`/`set_status` — all on the cloud-agent allowlist with friendly audit verbs. The Brain composes "project grounded in OKRs" from the existing `projects.create`+`objectives.create`+`key_results.create`. Two new seeded built-in agents (`builtin_kind` `product_manager`, `designer`) via [provisionBuiltinAgents.ts](./api/src/application/agent/provisionBuiltinAgents.ts) + mig backfill.
- **AI proposal evaluation** ([proposalEval.ts](./api/src/application/marketplace/proposalEval.ts) reusing `semanticEval` + a DRY-extracted [gatewayJudge.ts](./api/src/application/eval/gatewayJudge.ts)): the employer AI-scores a bid OR a delivered proposal against the posting's requirements (LLM-as-judge, lexical fallback) → `proposal_evaluations`; 0..100 cached on the row. Bids get Evaluate / Shortlist / Decline-with-courteous-message in [TalentView.tsx](./frontend/src/components/talent/TalentView.tsx).
- **Real engagement access grant** ([EngagementAccessService.ts](./api/src/application/marketplace/EngagementAccessService.ts)): an ACTIVE `freelancer_engagement` is now a scoped grant — the hired worker's [/freelancer/workspace](./frontend/src/app/freelancer/workspace/page.tsx) surface reads the engaged project's board, signals a ticket for review (`request-review` → In Review lane), and presents deliverable proposals (`deliverable_proposals`) the employer AI-evaluates.
- **Meetings against an item** (mig `0293` `meetings.ticket_id`/`job_id`/`engagement_id` + `interview`/`review` kinds): schedule a review meeting (before accepting a bid) or an interview (for an FTE posting) tracked against the exact ticket/posting/engagement.
- Fully localized (`gigs.*` namespace + `workforce.builtinKind.product_manager`/`designer` + nav, all 5 catalogs) + light/dark + responsive. Verified: api `tsc` 0 errors; frontend `tsc` 0 errors; all 5 i18n catalogs valid. Also cleared the transient `gigMarketplaceRoutes.ts` `c.req.json<T>()` narrowing + `Object possibly undefined` errors flagged mid-edit by the concurrent Team-Chat work.

---

## ✅ RESOLVED 2026-07-05 — Meetings calendar, availability booking, scoped join & VS Code join (api `2026.7.41` · frontend `2026.7.33` · vsix `2026.7.37`)

A team calendar on Workforce + Portfolio, bookable availability, authorization-scoped joining, and join-from-VS-Code — built on the live-meetings foundation.

- **Shared meetings calendar** ([MeetingsCalendar.tsx](./frontend/src/components/meetings/MeetingsCalendar.tsx)) — month overview + bookable week grid; overlays app meetings + connected-calendar events, shades your availability hours, click an open slot (week) or day (month) to book, click a meeting to join. One component surfaced BOTH on **Workforce ▸ Calendar** (new tab) and **Projects ▸ Portfolio** (project-scoped panel) — DRY, self-drives its own booking modal / availability editor / join overlay.
- **Bookable availability** (mig **0296** `user_availability`) — weekly working-hours windows + timezone per user ([AvailabilityEditor.tsx](./frontend/src/components/meetings/AvailabilityEditor.tsx)); `GET/PUT /api/meetings/availability/me`. **"Find a time"** ([availabilitySolver.ts](./api/src/application/calendar/availabilitySolver.ts) + `/api/meetings/suggest`, `/freebusy`) proposes slots where every invitee is free (no conflicting meeting) AND inside their declared windows — timezone-correct via `Intl`. Wired into the schedule modal.
- **Authorization-scoped join** — `POST /api/meetings/:id/join` + `GET /:id` now enforce `canAccess` (organizer / listed attendee / manager / project-team member for a project meeting; any tenant member for a tenant-wide meeting). The invite link (`/meetings?join=<id>`) is login-gated and cross-tenant is blocked by tenant-scoped fetch — so "only members of the tenant/project with the link can join" holds. Reuses `loadProjectTeamMembers`.
- **Join via VS Code** — a **Meetings** sidebar tree ([clients/vscode/src/meetings.ts](./clients/vscode/src/meetings.ts) + [bfApi.ts](./clients/vscode/src/bfApi.ts) `listMeetings`/`joinMeeting`) lists upcoming/live meetings; **Join in browser** opens the authenticated web meeting; **Join here** runs the mesh WebRTC call natively in a VS Code webview. Reuses the existing editor-key→tenant-JWT exchange (`/api/auth/tenant-api-key-token`) — no new auth. Commands + view + menus + NLS in all 5 bundles.
- Fully localized (`meetings.*` now 80 keys + `nav.tab.calendar` + `workforce.page.sub.calendar` + `pmo.meetingsHeading`, all 5 catalogs) + light/dark + responsive (calendar grids scroll horizontally on mobile). Verified: api `tsc` 0 errors + migrations + schema-drift pass; frontend `tsc` 0 errors; extension `tsc -p ./` 0 errors.

---

## ✅ RESOLVED 2026-07-05 — Register/Login page bodies fully localized

The pre-existing hardcoded English in `RegisterPageClient.tsx` / `LoginPageClient.tsx` (which previously only had the `emailVerify.*` verification step localized) is now routed through next-intl. All literal form copy is localized in all 5 catalogs (`en/zh/es/fr/de`):

- **Register** (`register.*`, 20 new keys): nav "Sign in", heading + subtitle, the three feature pills, Name/Email/Password/Confirm labels + Name/password placeholders, the terms checkbox, the "passwords do not match" / "registration failed" errors, the submit button (idle + "Creating account…"), and the "Already have an account?" footer.
- **Login** (`login.*`, 27 new keys — namespace was previously empty): nav "Sign up free", heading + subtitle, Email/Password labels, the login/magic-link errors, the submit button (idle + "Signing in…"), the magic-link toggle + sent/sending states, the "Don't have an account?" footer, **and** the marketing panel literals (heading, four stat labels, six feature bullets, "Common Questions").

`LoginPageClient` gained the `useTranslations('login')` hook + import. Marketing copy still sourced from `content.ts` (login intro sentence, `LOGIN_FAQ`, `REGISTER_MARKETING` variants) remains English — logged as a distinct roadmap gap (shared 1591-line marketing data module, not per-page copy).

---

## ✅ RESOLVED 2026-07-05 — ONE unified audit/activity subsystem (api `2026.7.39`, mig 0295)

Collapsed the two overlapping audit trails into a single store. `activity_log` (mig 0287) is now the ONLY audit/activity table; the legacy `audit_events` table + `audit_event_type` enum are DROPPED (mig 0295 migrates existing rows over first: `event_type` → dotted `verb`, `user_id` → human/system actor, `resource_*` → `target_*`, metadata preserved under `{raw}`).

- **The DDD seam is preserved, storage unified.** `AuditRepository` (still implementing `IAuditRepository`) is now an ADAPTER over `activity_log`: `save()` maps an `AuditEvent` → `recordActivity()`, `query()` reads `activity_log` and maps rows back to the `AuditEvent` shape. So its callers (`AuthService` logins/registrations, `AgentService`, `RuntimeService` execution events) and the `/api/audit` endpoint + the `/logs` page keep working unchanged — no route/frontend edits needed. `env` is threaded into `AuditRepository` (index + buildRuntimeService) for cached actor resolution.
- **Readers repointed.** The `audit.list` MCP tool now reads `activity_log` (filters by `verb`/`targetType`); `engagement.ts` counts `activity_log` human/hire actor rows. The 3 hand-rolled `db.insert(auditEvents)` dual-writes in `taskRoutes` are DELETED (the `/next` claim now emits `task.claimed` on the unified stream).
- **Schema.** `activity_log.tenant_id` is now nullable (absorbs the platform-global pre-tenant events `audit_events` allowed); tenant-scoped reads filter on it so a global row is invisible to any one tenant.
- Verified: api typecheck 0 errors, schema-drift + migration-sequence checks pass, api suite **1880 pass** (incl. `RuntimeService.laneChaining` which exercises the audit save path). Also fixed 3 compiler-suggested `as unknown as` casts in concurrent security-ticket WIP that were reddening the whole-program typecheck.

---

## ✅ RESOLVED 2026-07-05 — Platform Admin refactor: consolidation + full localization

The superadmin `/admin` area was refactored to match the rest of the app and then fully localized in all 5 locales.

- **Same UX as other pages.** The 3,566-line monolith became a **98-line thin router** ([app/admin/page.tsx](./frontend/src/app/admin/page.tsx)) wrapped in `PageContainer`; the in-page tab strip was replaced by the shared shell `<SectionTabs>` bar. Each tab body became a **self-fetching panel** under [frontend/src/components/admin/panels/](./frontend/src/components/admin/panels/) (17 panels) sharing one [`adminShared.tsx`](./frontend/src/components/admin/adminShared.tsx) contract (`useAdminData` hook, `AdminPanelHeader`, `AdminError`/`AdminLoading`, `ModelPoolBadges`) + a single [`EmulationLauncher`](./frontend/src/components/admin/EmulationLauncher.tsx) provider owning the emulate flow (no prop-drilling).
- **Consolidated 19 tabs → 10 domain groups** via [lib/adminGroups.ts](./frontend/src/lib/adminGroups.ts) (single source of truth for nav + panel routing): Overview · Users (Directory/Security/Emulation) · Workspaces · Access (Permissions/Modules) · LLM (Usage/Traces) · Content (Personas/Governance) · Compliance (Legal/Privacy) · Growth (Billing/Newsletter) · Logs (Errors/Audit) · Developer (API Keys/Token). URL scheme `?tab=<group>&sub=<view>` with a reusable inner [`AdminGroupNav`](./frontend/src/components/admin/AdminGroupNav.tsx) pill bar; `LEGACY_ADMIN_TAB` keeps every old deep link working. No capability removed.
- **Full localization.** Every admin panel + leaf component (UserDetailDrawer, the 4 Tenant override editors, TenantApiKeysAdminTab, LegalEditorDrawer/Preview, LlmTracesPanel) now routes visible strings through `useTranslations('admin')`. New `admin.*` namespace = **542 keys** (common/emulate/sub + per-panel), added with real translations to ALL 5 catalogs (en/zh/es/fr/de) — 0 missing / 0 extra key parity. ICU plurals + placeholders throughout; the Usage tab's LLM prompt payload was deliberately left literal (not UI). Group + sub-tab nav labels localized too (`nav.tab.admin*`, `admin.sub.*`).
- Verified: `tsc --noEmit` clean, ESLint clean, no residual hardcoded English in the admin tree. Dead `.admin-tabs` / `.admin-content` CSS removed.

## ✅ RESOLVED 2026-07-05 — Cross-surface session/task live-status indicators (api `2026.7.35` · VSIX `2026.7.36`)

Multitasking across concurrent runs now reads at a glance on every surface: a session/ticket shows **actively-executing** (coral/blue pulse) or **needs-your-answer** (amber flag), from ONE server-side signal, so a session's status follows it wherever it's shown — switching chats on the web never stops the agent executing in the background.

- **One canonical signal.** New `GET /api/runtime/attention` ([runtimeRoutes.ts](./api/src/presentation/routes/runtimeRoutes.ts), after `/active`) returns per-task **and** per-Brain-chat state `{ running | awaiting_input }` + counts. `running` = an execution pending/submitted/running; `awaiting_input` = an execution `paused` on `ask_human` (a pending `question`/`feedback` approval) — most-severe wins. Attribution reuses existing joins (`executions.task_id`; chat via `chat_ticket_links`). Uncached live surface (3 bounded, indexed queries, no N+1 — same rationale as `/active`).
- **Web.** `runtimeApi.attention()` + [`useAttention`](./frontend/src/lib/useAttention.ts) (adaptive poll + project-room WS backstop) + shared self-hiding [`<AttentionDot>`](./frontend/src/components/AttentionDot.tsx) (colours mirror `AgentChip`'s `EXECUTION_STATUS_COLOR`). Wired into the BrainPanel chat-list rows + a FloatingBrain launcher "needs you" amber count badge (visible with the drawer closed). The board already surfaced this via `AgentChip` (paused = amber). New `attention.*` namespace, all 5 catalogs.
- **VS Code.** `bfApi.getAttention()` + singleton [`AttentionPoller`](./clients/vscode/src/attention.ts) feeding BOTH the Sessions and Project & Tasks trees (repaints only on state change; re-polls on project switch / platform write / chat change). Rows overlay a live status icon+glyph — `running` → blue `loading~spin`, `awaiting_input` → amber `comment-unresolved` + `❓` prefix (done tasks now render green). First `ThemeColor` usage in the extension; new `bundle.l10n` strings in all 5 locales.
- **Also localized** the previously-hardcoded `FloatingBrain` launcher + `BrainSignInCTA` copy ("Open Brain assistant", "Meet Brain", the value-prop, "Sign in"/"Create account") via a new `brainLauncher.*` namespace in all 5 catalogs — closing the i18n gap this work opened.
- Verified: api `tsc --noEmit`, frontend `tsgo`, and the VS Code host + webview typecheck all clean (0 errors); VSIX packaged. Board `AgentChip` reused, no parallel state.

---

## ✅ RESOLVED 2026-07-05 — Evermind is a first-class IDE sidebar surface: inspect + train (brain-ui `2026.7.10` · VSIX `2026.7.36`)

The per-project self-learning model is now a menu option in the VS Code sidebar (beside Sessions / Project & Tasks / Inbox / Insights) where a user can inspect what it has learned and steer its training — and the SAME surface renders on the web (one component, two hosts). Also resolves the prior gap where `EvermindScreen.tsx` failed typecheck because brain-ui didn't export the console.

- **Shared console (DRY seam).** New presentational `<EvermindConsole>` in [`packages/brain-ui`](./packages/brain-ui/src/evermind/EvermindConsole.tsx) — adapter + label-bundle pattern (like `ChatTicketsPanel`), themed via cascading `--bf-*` vars for light/dark in both hosts. Exposes status stats (version / learned / queued / last-learned), the manager-gated training controls (seed-from-published-model, run-on-Evermind, learning connected/frozen, teacher picker), a **teach-from-transcript** box (paste an exemplar → `learn-text`), a **Learn now** flush, and a **recently-learned** inspection list. Controls disable (never hide) for non-managers.
- **Web host.** [`ProjectEvermindPanel`](./frontend/src/components/ide/ProjectEvermindPanel.tsx) is now a thin wrapper: a `projectEvermindApi` adapter + next-intl label bundle over the shared console (localized in all 5 catalogs, `projectEvermind.*`).
- **VS Code host.** New sidebar **webview view** `builderforce.evermind` ([evermindView.ts](./clients/vscode/src/evermindView.ts) `WebviewViewProvider`) renders the same bundle via `init.view='evermind'` ([EvermindScreen.tsx](./clients/vscode/webview/src/EvermindScreen.tsx) + bearer-fetch adapter), project-scoped (re-pushes init on project switch / auth change), manager-gate from `canManageActiveWorkspace`. Localized via `vscode.l10n` `ev.*` bundle + `view.evermind` in all 5 `package.nls`.
- **Backend (inspection + distill-now).** `ProjectEvermindCoordinatorDO` gained a recent-contributions ring (populated at merge time, since run text is otherwise consumed/dropped), a `GET /recent`, and a `POST /flush` that force-drains the debounce queue via a shared `drain()` (refactored out of `alarm()`). New service `getProjectEvermindContributions` (read-through cached by the per-project version token) + `flushProjectEvermind`; routes `GET …/evermind/contributions` and manager-gated `POST …/evermind/flush`; `lastLearnedAt` added to the head. Teach rides the existing unified `learn-text` producer door.
- Verified: api `tsgo` 0 new errors (lone pre-existing `oauthState.ts KeyUsage` nit), 47 evermind vitest pass, brain-ui + extension + webview typecheck clean, frontend `tsc` 0 errors, VSIX packaged.

---

## ✅ RESOLVED 2026-07-05 — Live video/audio collaboration: meetings, cameras, calendars (api `2026.7.36` · frontend `2026.7.29`)

Teams can now see and hear each other, not just co-edit a board. Managers can turn cameras on for the whole round-table; anyone can start an ad-hoc or direct call, schedule a meeting, and connect their calendar — for standups, planning, retros or ad-hoc.

- **Meetings backend** (mig 0292: `meetings` · `meeting_attendees` · `calendar_connections`). `POST /api/meetings` schedules or starts a meeting (standup/planning/retrospective/adhoc/direct); join/leave stamp presence + flip a scheduled meeting live; RSVP; organizer/manager-gated start/end/cancel/patch ([meetingRoutes.ts](./api/src/presentation/routes/meetingRoutes.ts)). Create + join are open to any member (anyone can start a call).
- **WebRTC media, mesh P2P.** Camera/mic exchange rides the EXISTING `CeremonyRoomDO` fan-out relay, keyed `media:<roomKey>` — SDP offers/answers + ICE candidates flow client→client with zero DO changes; media never touches the server. `GET /api/meetings/ice` serves STUN (+ TURN when configured). Glare-free negotiation (greater peer-id offers). Frontend hook [useMediaRoom.ts](./frontend/src/lib/useMediaRoom.ts) manages `getUserMedia`, per-peer `RTCPeerConnection`, and camera/mic toggle.
- **Cameras in the round-table.** [CeremonyStage](./frontend/src/components/ceremony/CeremonyStage.tsx) gained a "Join with camera" toggle → a live gallery ([VideoGrid](./frontend/src/components/video/VideoGrid.tsx)/[VideoTile](./frontend/src/components/video/VideoTile.tsx)) + [MediaControls](./frontend/src/components/video/MediaControls.tsx) over the standup/planning ceremony (one media room per project).
- **Meetings surface** at `/meetings` (new nav destination): schedule modal, start-now, live/upcoming list, join → full-screen [MeetingRoom](./frontend/src/components/meetings/MeetingRoom.tsx), and a `?join=<id>` deep link from calendar invites.
- **Calendar connections** (Google Calendar + Microsoft Graph). Per-user OAuth ([calendarRoutes.ts](./api/src/presentation/routes/calendarRoutes.ts) + provider adapters/[calendarService.ts](./api/src/application/calendar/calendarService.ts)); scheduled meetings are mirrored as calendar events (invites to attendee emails), upcoming events surface on `/meetings`. OAuth state/token crypto extracted to shared [oauthState.ts](./api/src/infrastructure/auth/oauthState.ts) (DRY — `oauthRoutes` now delegates to it). New env: `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` (optional).
- Fully localized (`meetings.*` + `nav.group.meetings`, all 5 catalogs, 54 keys each) + light/dark + responsive. Verified: api + frontend `tsc --noEmit` 0 errors; all 5 catalogs parse at key parity.

---

## ✅ RESOLVED 2026-07-05 — AI Manager runs are first-class tasks: surfaced, metric-clean, eviction-safe

Closed both residuals logged when the AI Manager "run = a board task" feature shipped, and surfaced the manager's own tasks.

- **Manager tasks surfaced.** The manager overview (`GET /api/manager/:projectId`) now returns `runTasks` — every `source='manager'` "Backlog management pass" the manager kicked off (open / in-progress / done), newest first — rendered as a new **Manager tasks** section on the Manager surface ([ManagerContent.tsx](./frontend/src/components/manager/ManagerContent.tsx)): key, status badge (theme-toned), result summary, owner, updated-time. Fully localized (`manager.runTasks.*` in all 5 catalogs) + light/dark + responsive.
- **Excluded from ALL delivery metrics (no residual).** New shared predicate `notSystemTask` ([application/task/taskScope.ts](./api/src/application/task/taskScope.ts)) — the ONE canonical filter — applied to every task-completion aggregation so system/coordination cards never count: delivery throughput, SPACE, lifecycle + bottleneck (incl. their no-transition fallback), CAPEX/OPEX allocation, workforce/DORA lead-time, engagement, assignee-recommender WIP, project counts (`projectRoutes`), Project 360, ROI, completed-work report, planning spine + `loadTaskCostClassMap`, portfolio rollup, PMO cost-class classify, and the VS Code "my tasks" list. Velocity is clean by construction (points-based; run tasks have no `sprintId`), as are objective/initiative rollups (run tasks have no lineage). The manager's own inline copies were refactored onto the shared predicate too (DRY).
- **Eviction-safe pass.** The grooming pass's per-ticket writes (business-value backfill + `manager_rank` + `score_value` audit rows — 200+ sequential neon-http round-trips on a large backlog, the real Worker-eviction risk) are now collected and flushed via `db.batch` in chunks of 50 (`flushBatched` in [ManagerService.ts](./api/src/application/manager/ManagerService.ts)), collapsing ~700 round-trips into ~14. Scoring/ranking now reliably complete for a 300-ticket backlog in one background pass (the free heuristic fallback already scores every ticket in one pass — the earlier "can't catch up in one click" premise was wrong). The assign/dispatch/audit per-run caps remain BY DESIGN (cost/storm guards), not residuals.
- Verified: api + frontend native typecheck 0 errors (lone pre-existing `builtinMcpService.test.ts` nit, untouched), schema-drift + migration checks pass, all 5 i18n catalogs parse and are in exact key parity.

---

## ✅ RESOLVED 2026-07-05 — Unified activity/audit log: gaps & residuals closed (api + frontend `2026.7.27`)

Closed the gaps logged when the canonical `activity_log` + `recordActivity()` stream (mig 0287) shipped.

- **Cloud-agent AI usage now attributed on the heatmap/leaderboard.** `computeInteractionActivity` (`interactionActivity.ts`) now aggregates `llm_usage_log.cloud_agent_ref` (was ignored — only `user_id`/`agent_host_id` mapped) → `cloudAgentDaysByRef` / `cloudAgentTotalsByRef` / `distinctCloudAgentRefs`. `buildActivityCalendar` (`analyticsRoutes.ts`) synthesises an agent roster entry per used `ide_agents` id (negative-id space, name from `ide_agents`) so a purely-cloud agent shows on the leaderboard; `computeTenantActivityRollup` folds cloud refs into the active-contributor count (`ca:` actor key) + top contributors.
- **Remaining mutation sites now emit.** ONE DRY hook in `callBuiltinTool` (`builtinMcpService.ts`) emits for EVERY `mutates:true` MCP/Brain/agent tool run (OKR objectives/key-results, portfolios, initiatives, brain-created tickets, …) with canonical verbs for the common ones (`MCP_VERB` map) — closing the OKR gap and adding broad agent-driven coverage. Added dedicated `pr.merged` (repoRoutes `/pull-requests/:id/merge`) + `member.invited` / `member.added` (tenantRoutes invite), all best-effort.
- **Workforce ▸ Performance surface fully localized.** `ContributorsView.tsx` + `TenantActivityPanel.tsx` (pre-existing hardcoded English, inline-styled) now route every visible string through `useTranslations('contributors')` — new `contributors.*` namespace (stats, leaderboard, heatmap aria/tile, kind badges, legend, tenant-rollup labels, by-type map) in all 5 catalogs. New `audit.verb.{pr,member,okr}.*` labels added too.
- Verified: api typecheck 0 errors, schema-drift + migration checks pass, api suite 1866 pass; frontend typecheck 0 errors, 306/307 tests pass (the 1 failure is a pre-existing/environmental `AgentExecutionPanel` Monaco-diff test, untouched by this work — logged as a fresh test-health gap).

---

## ✅ RESOLVED 2026-07-05 — BYO close-out: cloud-compute meter + deterministic non-Anthropic on-prem

Closed the two remaining BYO follow-ups end-to-end.

- **Dedicated "Cloud runs" compute meter.** A cloud run executes on our infra even when the tenant brings their own model (BYO tokens are $0 to us; the orchestration isn't), so cloud usage is now metered independently of token volume. Added `cloudRunsMonthly` to `PlanLimits` (Free 25 / Pro 2 000 / Teams ∞) + `resolveCloudRunsMonthly`; new `application/runtime/cloudRunLedger.ts` (`dailyTenantCloudRuns` / `sumTenantCloudRuns` / `enforceCloudRunCap`) counts distinct `execution_id` on `surface='cloud'` usage rows — no new table, reuses the mig-0284 surface tag. Wired as the 5th meter in the consumption framework (`meters.ts`, `MeterKey`/`MeterUnit` gain `cloud_runs`/`runs`) so it shows in the sidebar `UsageMeter` (☁️ icon, `usageMeter.meter.cloud_runs` in all 5 catalogs, Finance deep-link). Enforced at the ONE cloud choke point — `startDispatchedExecution`'s `!delivered` branch in `runtimeRoutes.ts` — so every cloud entry (Run-now, board, CI-autofix) is gated: over the cap fails the run fast with an upgrade message; on-prem/VSIX runs never touch it; superadmin/unlimited pass; fails open on a metering error. "Shown == enforced" (meter total + gate share `sumTenantCloudRuns`).
- **Deterministic non-Anthropic on-prem BYO.** The `/v1/messages` cascade now HARD-PINS (`modelStrict`) a requested model whose vendor the tenant has connected via BYO, so an on-prem Claude-SDK run on `openai/*` or `googleai/*` rides the tenant's own account instead of silently cascading onto our free pool — mirroring the Anthropic passthrough's "runs on the tenant's account, period" guarantee. A bare/mismatched model stays a soft hint (unchanged).
- Verified: frontend typecheck 0 errors; the new api modules are self-contained and isolated (an unrelated concurrent WIP edit to `taskScope`/`toolRoutes`/`index.ts` was breaking the whole-program api typecheck at close-out — not part of this change). ROADMAP BYO section now has no open follow-ups.

---

## ✅ RESOLVED 2026-07-05 — Multi-party chat: invite humans (shared access) + `@agent` actually replies

Closed both remaining residuals of the multi-party-chat gap. Chats are now **global to their project+tenant** (a teammate can see, open and join to collaborate), humans can be **invited by email**, and directing a message to an **`@agent` participant now triggers that agent to answer** as itself.

- **Human-participant + shared-access model (migration `0288`).** New `chat_members` table (active `user_id` **or** pending `invited_email` that auto-converts on first access, mirroring `tenant_invitations`) + `brain_chats.visibility` (`shared` default | `locked`) — the **LOCK primitive**. `BrainService.canAccessChat` replaces the single-owner guard: owner OR (shared → any teammate; auto-recorded as a member on first contribution — the live audience) OR (locked → owner + explicit members). `listChats` surfaces owned + joined + shared; owner-only admin (rename/archive/invite/remove/lock) stays on `user_id`.
- **Invite + delivery.** `POST/GET/DELETE /api/brain/chats/:id/members` (owner-gated invite). Delivery reuses the existing `notify()` (durable in-app `freelancer_notifications` row + optional email webhook) for existing teammates, and a new `sendChatInviteEmail` (Resend, best-effort) for cold emails. Directing a message to a `@human` also notifies them (`chat_mention`). Global **NotificationBell** added to the web `TopBar` (reuses `/api/notifications`) — the first app-wide surface of the in-app inbox; chat notifications deep-link to `/ide/dashboard?chat=`.
- **`@agent` reply is a real tool-executing run.** `POST /api/brain/chats/:id/agent-reply` → `BrainService.agentReply`: resolves the agent's persona + ingested knowledge via the shared `resolveWorkforceModel`, then runs a **bounded server-side tool loop** (≤6 iters) over the curated non-destructive platform allowlist (`CLOUD_AGENT_PLATFORM_TOOLS` — projects/tasks/specs/OKRs/knowledge reads + safe writes, no deletes/control-plane), executed via `callBuiltinTool` with the **triggering user's role + token** so the agent can never exceed the human's own permissions. So an addressed teammate agent can actually DO things (create a follow-up task, update an OKR, read the board), not just chat. The final answer posts as an assistant turn **attributed to the agent** via a new `authoredBy` metadata key (mirrors `addressedTo`; no message-table migration). Wired into the shared `useBrainConversation.send()` (optional `persistence.requestAgentReply`) so all surfaces trigger it after a directed `@agent` turn; `BrainTimeline` renders the agent's avatar/name on its turns. (File-editing stays the BRAIN/host loop's job — tracked by the separate "Unify the agent LOOP" roadmap epic.)
- **Shared UI + both hosts.** `brain-embedded` (`AUTHORED_BY_META_KEY`/`parseMessageAuthor`, `requestAgentReply` adapter method, agent-reply trigger); `brain-ui` (humans in `useChatParticipants`, a **People** section in `ChatTicketsPanel` with email invite + lock toggle); web `BrainPanel`/`ChatTicketsPanel` wrapper + `builderforceApi` (`listChatMembers`/`inviteChatMember`/`removeChatMember`/`requestAgentReply`, `updateChat` visibility); VS Code webview adapters + lock toggle; native SESSIONS tree resolves human names inline (no raw user-ids). All new UI localized in `en/zh/es/fr/de`.
- **Cold-invite join flow.** Inviting a non-tenant email also creates a pending `tenant_invitations` row, so the existing tenant-invite auto-conversion adds them to `tenant_members` on signup; `syncPendingMemberships` then promotes their `chat_members` row to active on first access — one seamless join, no extra step.
- Versions: api `2026.7.25` · frontend `2026.7.25` · brain-embedded `2026.7.11` · brain-ui `2026.7.9` · VS Code VSIX `builderforce-ai-2026.7.33.vsix`. Verified: api type-clean on all changed files (pre-existing `TaskRepository`/`convertWorkItemType`/`interactionActivity` errors are unrelated + tsgo-preview flakiness), frontend `tsc` 0 errors, VS Code webview + host `tsc` clean, brain-embedded + brain-ui + webview rebuilt, VSIX packaged, migration + schema-drift checks pass.

---

## ✅ RESOLVED 2026-07-05 — Chat↔ticket: every planning/project kind is linkable, referenceable & MCP-creatable

Followed the chat↔ticket auto-link work (open an item → the chat is tied to it) by making the FULL set of planning/project kinds first-class across **link + reference + create**. Kinds are now `portfolio | objective | initiative | roadmap | spec | epic | gap | task`.

- **New linkable ticket kinds.** Added `roadmap` (own `roadmap_items` table, status-based health — `shipped`=done), `gap` (a `task_type`, tasks-table leaf), and `spec`/PRD (own table, `complete`=done) to `ChatTicketService` (`TICKET_KINDS` + `resolveTicket` + `ticketHealthBatch`), the shared `@seanhogg/builderforce-brain-ui` (`TicketKind`/labels/`RUNNABLE_KINDS`; +gap runnable), the web `builderforceApi.TicketKind` + `ChatTicketsPanel` adapter (`loadTicketOptions` now fetches roadmap + specs + buckets gaps), the VS Code webview adapter, and all five `brain.tickets.kind.*` locale catalogs. `chat_ticket_links.ticketKind` is `varchar(12)` — **no migration**.
- **Auto-link on open for every page kind.** Roadmap-page rows carry a `roadmap` ticket and PRD-page rows a `spec` ticket through the `seed`+`ticket` intent (`ProjectListAction.ticket` in brain-ui → `projectPagePanel` → webview `linkOpenedTicket`); tree/board/360/backlog task/epic/gap link through `startTaskSession`.
- **Creatable via MCP.** Added `roadmap.list/get/create/update/delete` built-in MCP tools (direct insert + cache invalidation via the shared `trackerCacheKey`, moved to `infrastructure/cache/readThroughCache` so route + MCP writers share one key format), and added `gap` to the `tasks.create` `taskType` enum. `chats.link_ticket`/`chats.list_tickets` enums + descriptions updated for `roadmap`/`spec`/`gap`. Portfolio/objective/initiative/spec create tools already existed.
- Versions: api `2026.7.22` · frontend `2026.7.22` · brain-ui `2026.7.7` · VSIX `builderforce-ai-2026.7.31.vsix`. Verified: api type-clean on all changed files, frontend `tsgo` 0 errors, VS Code host+webview `tsc` clean, brain-ui + webview rebuilt.

---

## ✅ RESOLVED 2026-07-05 — Workforce → Teams: card affordance, card/panel count consistency, full i18n

Fixed the two reported Teams-tab bugs and closed the localization gap the fix exposed.

- **Card affordance.** The team card was a bare `<button>` with no cue it opened the manage panel. Added a persistent pencil/"manage" glyph (`ManageIcon`, always visible so it reads on touch too, coral tint on hover), hover elevation (coral border + shadow + lift) on cards, a row-highlight + trailing action column in the List view, and an `aria-label` on both.
- **"1 member" vs "6 in panel".** Root cause: the team-list read (`GET /api/teams`) was read-through cached while the detail read (`GET /:id`) is uncached/authoritative, so after a membership add the card's count drifted from the panel (cache invalidation is only eventually consistent across isolates — per-isolate L1 + lagging KV delete). Fix: **serve the list strongly consistent (uncached)** — it's a tiny tenant-scoped indexed read (a few team rows + two correlated `COUNT`s over `team_id`-indexed junction tables), no fan-out, so freshness costs microseconds; the hot by-project assignee-picker reads stay cached. Removed the now-dead `teamsCacheKey` + `invalidate()` helper and all seven `await invalidate(...)` call sites. Frontend belt-and-suspenders: `loadDetail` reconciles the opened team's card from the authoritative detail, and `refreshAfterMutation` no longer refetches the whole list.
- **Full localization.** `TeamsView.tsx` migrated off hardcoded English to `useTranslations` under a new `workforce.teams.*` namespace (42 keys, ICU plurals with rich `<b>` for the counts, `common.*` reused for cancel/delete); real zh/es/fr/de added to all five catalogs. Kind labels (Human / Cloud agent / Remote host) localized via dynamic `kind.*` keys.
- Verified: frontend `tsgo --noEmit` 0 errors, `eslint TeamsView.tsx` clean, all five catalogs parse.

---

## ✅ RESOLVED 2026-07-05 — Kanban Templates folded into Projects tab + shared roles-CRUD hook

Consolidated the standalone `/kanban-templates` page into Projects as a **Templates** tab and removed the top-level menu item, then closed the roles-CRUD duplication the move exposed.

- **Consolidation.** Extracted the templates UI into `components/KanbanTemplatesContent.tsx` (a `*Content` component like `CeremoniesContent`), rendered by `app/projects/page.tsx` under `?tab=templates`; added the `templates` tab to the Projects group in `lib/navGroups.ts` and deleted the `kanbanTemplates` nav group. `/kanban-templates` now `redirect()`s to `/projects?tab=templates` (same pattern as `/pmo` + `/ceremonies`). Feature link in `lib/content.ts` repointed; `group.kanbanTemplates` removed and `tab.templates` added across all five i18n catalogs.
- **Shared roles-CRUD hook (`Roster/roles` gap).** `RolesView` (Workforce → Roles) and the templates Roles sub-tab both hand-rolled `listRoles`/`createRole`/`deleteRole` + the discipline list and could drift. New `lib/useRoles.ts` owns the list state, `reloadRoles`/`createRole`/`deleteRole` (optimistic), and the canonical `ROLE_DISCIPLINES` constant; both surfaces consume it. Deleted the duplicated `DISCIPLINES` array and inline CRUD.
- Verified: frontend `tsgo --noEmit` 0 errors; all five message catalogs parse.

---

## ✅ RESOLVED 2026-07-05 — Bring-your-own frontier models (Anthropic + OpenAI + Google), modality-aware BYO billing

Enterprise tenants can now connect their OWN Anthropic, OpenAI, and/or Google accounts; connected providers drive the model choices and the tenant's own account serves the calls. Shipped end-to-end across the gateway, all three modalities, and billing. api `2026.7.19`, frontend `2026.7.19`, VS Code `2026.7.30`. Migration **0284**.

- **Modality-aware BYO metering (the load-bearing fix).** `llm_usage_log` gains `byo` + `surface` (mig 0284). The single ledger writer `usageLedger.recordUsageRow` forces `cost_usd_millicents = 0` for BYO rows (platform pays nothing), and the shared accountant `tokenUsage.ts` (`billableRow` = `notImageRow ∧ NOT (byo ∧ surface ∈ {on_prem,vsix})`) EXEMPTS own-machine BYO usage from the plan token allowance while still counting BYO **cloud** usage. Because `enforceTokenCaps`, `checkTenantTokenGate`, AND the consumption meter all share that one accountant, the rule holds everywhere at once: on-prem/VSIX BYO = free & uncapped; cloud BYO = charged (free tenants must upgrade for volume); non-BYO unchanged. Surface is threaded through every `logUsage`/`recordCloudUsage` site; the VSIX sends `X-Builderforce-Surface: vsix`, on-prem is derived from `agentHostId`, cloud from `recordCloudUsage`.
- **Multi-provider credential layer.** `tenantProviderKeyService` widened `SUPPORTED_PROVIDERS = ['anthropic','openai','google']` with `PROVIDER_VENDOR_MAP`, `resolveTenantVendorKeys` (one-query decrypt of BYO api-keys), and `resolveTenantLlmCredentials` (subscription token + vendor keys in one parallel round-trip). `LlmProxyService.vendorEnv()` overlays tenant keys onto the operator env per request and marks those vendors tenant-funded → `ProxyResult.byoFunded` (stamped in `finalize` via `isTenantFunded`).
- **Connected-providers drive model choice.** `/llm/v1/models` returns `byo:{providers,models}` + `canChooseModel`; `useLlmModels`/`ModelSelect` render a "Connected providers" model group and gate the picker on `canChooseModel` (paid **or** BYO). The free-plan model-choice gates (`pickCloudModel` `canChooseModel`, the `strict_pin_not_allowed` 402) now lift for a model whose vendor the tenant has connected — shared `byoVendorIdSet`/`providersFromCredentials`.
- **All three modalities.** VSIX = zero client change beyond the surface header (gateway resolves BYO). Cloud = both `cloudAgentEngine` proxy sites thread `tenantVendorKeys` + `byoVendors`. On-prem (Claude Agent SDK → `/v1/messages`): BYO-Anthropic passes through to `api.anthropic.com`; a non-Anthropic model rides the cascade branch which now overlays the tenant's OpenAI/Google key, stamped `byo`+`on_prem` (free).
- **Web UI (fully localized).** `ProviderKeysSettings` rewritten as a responsive 3-card grid via one shared DRY `ProviderConnectionCard` (Anthropic keeps subscription OAuth; OpenAI/Google are API-key). Full next-intl coverage across four namespaces with real translations in all 5 catalogs (`en/zh/es/fr/de`): `providerKeys` (the cards, incl. `t.rich` for `<code>`/`<b>`), `modelSelect` (picker group labels), `runAgentControl` (the whole run control — agent/model/repo pickers, PRO gate, run button, no-writable-repo warnings), and `apiKeys` (the entire `/settings/api-keys` page shell — heading, subtitle, create form, key list, table headers, revoke confirm). Theme-token colors + responsive layouts (light/dark, mobile-safe). No hardcoded user-facing English remains on any surface this feature touched.
- Verified: api + frontend + VS Code typecheck 0 errors; 140 affected api tests pass (llmRoutes, LlmProxyService, tokenUsage, tenantTokenAvailability, cloudTelemetry).

---

## ✅ RESOLVED 2026-07-05 — Email verification (OTP) at signup — stop fake / unowned-email accounts

Fake accounts were signing up because password registration issued a live session instantly with **no proof the email was owned** (there was no `emailVerified` concept at all — the existing MFA is opt-in TOTP challenged only at *login*, and magic-link only logs in *existing* users). Added a 6-digit email-ownership gate on password signup. Shipped: api `2026.7.18`, frontend `2026.7.17`.

- **Schema + mig 0285** — `users.email_verified_at` + new `email_verification_codes` table (hashed 6-digit code, `expires_at`, `attempts`, `consumed_at`). Migration **backfills `email_verified_at = created_at` for every existing account** so no current user is ever locked out; the gate only traps NEW password signups. OAuth-created users are stamped verified on insert (the provider vouches).
- **Backend** — `application/auth/EmailVerificationService.ts` (issue/verify: single-use, 15-min TTL, 5-attempt cap, 60s resend cooldown, newest-code-wins; raw code never stored). `/web/register` now creates the account UNVERIFIED, emails a code, and returns `{ verificationRequired, email }` with **no session**. New `/web/register/verify` (exchanges the code for a session; `trustDevice` → 30-day session vs 24h) and `/web/register/resend` (cooldown-guarded, enumeration-safe). `/web/login` gates unverified accounts (403 + re-sends a code). `EmailService.sendVerificationCodeEmail` template added.
- **Frontend** — shared `components/account/EmailVerificationStep.tsx` (DRY: used by BOTH register and login flows) with code entry, "keep me signed in 30 days", resend, and localized error mapping off the server `reason` code. `lib/auth.ts` `login`/`register` now return a discriminated `AuthStepResult` (session **or** `needsVerification`); added `verifyEmailCode` + `resendVerificationCode`; `AuthContext` gained `verifyEmail`. New UI fully localized under `emailVerify.*` in all 5 catalogs.
- Verified: api `tsgo` + schema-drift + migration-sequence checks clean; frontend `tsgo` **and** `tsc --noEmit` clean; `auth.test.ts` updated (17 pass) covering the verification branch + `verifyEmailCode`/`resend`. Also resolves the prior ROADMAP gap "pre-existing type errors in `auth.test.ts`" — the `AuthStepResult` union is now narrowed in the tests. Open follow-ups (ROADMAP): full i18n of the surrounding register/login page copy; optional sweep of pre-existing fake accounts. End-to-end email delivery + the live DB path need the running stack (Resend + Neon) to exercise.

---

## ✅ RESOLVED 2026-07-05 — Multi-party chat parity: recipient routing on the web Brain + true avatars in the sessions tree

Follow-up to the multi-party-chat ship below: brought the "address a message to a participant, not the BRAIN" paradigm to the **web** Brain (the user's "same paradigm across all modalities") and upgraded the SESSIONS-tree participant indicator from initials-text to real coloured avatars. Shipped: brain-embedded `2026.7.10`, brain-ui `2026.7.6`, VS Code `2026.7.29` (`builderforce-ai-2026.7.29.vsix`).

- **Routing logic is now shared (DRY).** Extracted `mentionRecipient`, `resolveRecipient`, and the `RecipientChoice` type into `brain-embedded/src/directedMessage.ts`, and the `useChatParticipants(adapter, chatId, refreshSignal)` hook into `brain-ui` — so both composers derive the recipient identically. The VS Code webview App was refactored to consume the shared versions (its local copies deleted). New `directedMessage.test.ts` (9 tests) locks the metadata round-trip + `@mention`/choice resolution.
- **Web Brain composer recipient picker** — `frontend/src/components/brain/BrainPanel.tsx`: a "To: <avatar> <name>" `<Select>` beside the persona picker (only once the chat has participants), the recipient-aware placeholder, and `handleSend` now passes `{ addressedTo }`. Participants are resolved from the chat's invited agents against the pool BrainPanel already loads — with a new module-level `loadAgentPoolCached()` (`lib/agentPool.ts`) that dedups the pool fan-out across the persona picker, the ticket adapter and the recipient picker (fixing a pre-existing 2× fetch). The web timeline shows the `→ recipient` badge for free (shared `BrainTimeline`). Fully localized (`brain.to`/`brainRecipient`/`recipientPickerTitle`/`messageParticipant` across all 5 catalogs).
- **True avatars in the SESSIONS tree** — `sessionsTree.ts` now renders each session row's participants as a composite `data:` SVG icon (up to two overlapping coloured initial discs; `avatarColor` kept in sync with brain-ui), with initials in the description and full names in the tooltip.
- Verified: frontend `tsc` 0 errors; brain-embedded 60 tests (+9 new) pass; host + webview typecheck clean; VSIX packaged. Remaining (ROADMAP ▸ Brain / chat): inviting humans (participant model + delivery + shared-chat access) and making `@agent` trigger that agent's reply.

---

## ✅ RESOLVED 2026-07-05 — Multi-party chat: address messages to participants, not just the BRAIN (+ dropdown theme fix, session participant indicators)

Collaboration is the purpose of the VSIX chat, but every message ran the BRAIN — there was no way to invite a teammate into a chat and just talk to them, and the agent-invite dropdown rendered with default light colours in a dark editor. Shipped: brain-embedded `2026.7.9`, brain-ui `2026.7.5`, api `2026.7.16`, VS Code `2026.7.28` (`builderforce-ai-2026.7.28.vsix`).

- **Dropdown theme fix** — the shared `ChatTicketsPanel`'s native `<select>`s (invite-agent, run-agent, link pickers) used web-app-only CSS vars (`--bf-ct-*`/`--bg-base`) absent in the webview, so they fell through to `transparent`/`inherit` and Chromium drew them as light controls. Fix = a `V` token map whose fallback chains resolve in BOTH hosts (web `--bf-ct-*` → editor `--vscode-dropdown-*`/`--bf-*` → literal) + `colorScheme:'inherit'` (`packages/brain-ui/src/chatTickets/ChatTicketsPanel.tsx`).
- **Directed-message routing** — `brain-embedded/src/directedMessage.ts` (new): a `user` turn tagged `{addressedTo:{kind,ref,name}}` in metadata is a message FOR that participant, not a BRAIN directive. `useBrainConversation.send(text,{addressedTo})` persists it but skips `startRun`, and the trailing-user auto-reply effect skips directed turns — so the agent loop stays idle. `DirectedRecipient.kind` is `'agent'|'human'` (human-ready).
- **Composer recipient picker + `@mention`** — the VS Code composer gains a "To: <avatar> <name> ▾" selector (only once a chat has participants; solo chats unchanged, everything → BRAIN). Explicit pick or a leading `@name` routes the turn; placeholder switches to "Message {name}…". Participants come from the invited agents resolved against the (now adapter-cached, dedup'd) agent pool.
- **Timeline + avatars** — `brain-ui` `<Avatar>`/`<ParticipantBadge>` (deterministic-colour initials disc, theme-agnostic); the timeline renders a `→ Name` badge on directed user turns.
- **SESSIONS tree participant indicators** — `BrainService.listChats` folds `participants:[{ref,kind}]` via ONE guarded grouped `agent_assignments` query (no N+1, additive — a failure never breaks the list); `bfApi.listAgentPool` resolves refs→names (cached); the native tree appends `· 👥 BK MQ +N` initials to the row description + a full-name tooltip. Refreshes live on invite/remove (`ChatTicketsPanel.onChanged` now fires on invite/remove → `chats.changed` → `tree.refresh()`).
- Verified: brain-embedded 51 tests + api 1851 tests pass; brain-embedded/brain-ui/host/webview typecheck clean; VSIX packaged. Follow-ups (human invite + delivery, `@agent` reply-trigger, web/other-modality composer parity, true tree avatars) logged to ROADMAP ▸ Brain / chat.

---

## ✅ RESOLVED 2026-07-05 — VSIX↔cloud tool-catalog unification finished (container parity + web-Brain manifest retired)

The two follow-ups from the durable-surface parity work below. Shipped: api `2026.7.16`, frontend `2026.7.15`.

- **Container surface reaches parity.** The long-lived Container runs its own image loop (`api/container/server.mjs`) and previously had no platform tools. Now: the Worker-controlled container `llm` op advertises `[...CONTAINER_AGENT_TOOLS, ...cloudAgentPlatformToolSchemas()]`; `server.mjs execTool` relays any `builtin_*` call back via a new `platform_tool` container-op; `handleContainerOp` runs it through the same subset-guarded `callBuiltinTool` (MANAGER role, project-defaulted) and records a tool event. The prompt guidance that makes the agent USE these tools was moved from `runCloudToolLoop` into the shared `prepareCloudRun` so ALL surfaces (Worker/DO durable + container) get it once (DRY) — no duplication.
- **Legacy web-Brain manifest retired.** `frontend/src/lib/brain/platformActions.ts` was a client-side manifest that re-declared ~210 data capabilities also in the server `builtinMcpService.CATALOG`. Verified every one of the 210 was covered by the catalog (0 uncovered), so the whole data layer was dead (already excluded at runtime by `excludeToolKeys`). Removed it — the file now holds ONLY the 3 client-only actions the server structurally can't do (`navigate_to`, `open_project`, `open_migration_panel` — browser navigation + a UI window event). `McpExtensionsBridge` (gateway `/llm/v1/mcp/tools`) is now the SINGLE source of the platform data tools, shared with the VS Code chat. `PlatformActionsBridge` simplified (no more catalog-exclude fetch / route-focus); `index.ts` exports + the test trimmed. Net: platform tools live in exactly TWO shared sources — `core-tools.ts` (dev tools) + `builtinMcpService.CATALOG` (platform tools) — reachable from every surface.
- Tests: api engine + builtin subset tests (27) green; frontend `platformActions.test.ts` rewritten to the client-only surface (13) green. tsgo clean on both packages.

---

## ✅ RESOLVED 2026-07-05 — Cloud agent gets the curated platform toolset (VSIX↔cloud work-management parity)

The cloud coding agent could only edit repo files — it couldn't create a task, update an OKR, or read what's remaining, while the VS Code / web Brain had the full ~245-tool platform catalog. (Developer/file tools were already single-sourced via `packages/agent-tools/core-tools.ts` — no duplication there.) Shipped: api `2026.7.15`.

- **Curated, safe-by-default subset** — `CLOUD_AGENT_PLATFORM_TOOLS` in `api/src/application/llm/builtinMcpService.ts`: projects/tasks/specs/objectives(OKR)/key_results/initiatives/portfolios read+write, `work_items.convert_type`, `pmo.tree/rollup`, `project_facts`, `project_files`, `attachments`, `reviews.record`, `tickets.from_delta`, and **read-only** executions. Explicit allowlist EXCLUDES all admin/destructive surface (no deletes, no `executions.submit/cancel/post_message`, nothing under `api_keys`/`security`/`provider_keys`/`migrations`/`agent_hosts`/…) so an unattended agent can't reach it. New `cloudAgentPlatformToolSchemas()` (memoized `builtin_*` OpenAI schemas) + `resolveCloudAgentPlatformTool()` (subset-only reverse lookup — refuses off-list names even if the model hallucinates one).
- **Wired into the durable/Worker loop** — `cloudAgentEngine.ts runCloudToolLoop` advertises `[...CLOUD_AGENT_TOOLS, ...platformTools]` and dispatches `builtin_*` calls via `callBuiltinTool` in-process (tenant-scoped, `TenantRole.MANAGER`, project defaulted to the run's project so follow-up tasks land correctly). Governance policy gate + tool-event recording apply to platform tools too (they route through the same dispatch branch).
- **Made live in the prompt** — the cloud system prompt now instructs the agent to file a NEW task for any out-of-scope gap it finds (don't silently drop it), update OKR/objective progress its work advances, and base its "what remains" summary on real state (`builtin_tasks_list` + the tasks it created), not a guess.
- Tests: allowlist membership + admin/destructive exclusion + `builtin_*` schema shape + subset-only resolver (`builtinMcpService.test.ts`). tsgo clean; 90 tests pass across the affected files.
- Follow-up (ROADMAP): the long-lived **Container** surface runs its own image loop and doesn't yet advertise these; and the legacy web-Brain `frontend/src/lib/brain/platformActions.ts` manifest should be retired onto the one server catalog.

---

## ✅ RESOLVED 2026-07-05 — Brain agentic turns floored onto a weak non-coder model (root cause of "claimed a write, no changes")

Complement to the same-day attachment/honesty fix below. That fix caught the *symptom* (phantom-save claim); this fixes the *root cause* — the model doing it. The VS Code Brain streams to `POST /llm/v1/chat/completions`, which auto-selected over the general `FREE_MODEL_POOL` and floored onto `GUARANTEED_BACKSTOP_MODEL` = `google/gemini-2.5-flash-lite` — the model the coding path's own comment says "loops on search and ships no edits." The coders-only floor (`CODING_MODEL_POOL` / `CODING_BACKSTOP_MODELS` / `pickCloudModel`) existed **only** on the cloud coding-agent path; the Brain (and every gateway completion) bypassed it, because failover is error-gated, not capability-gated.

- **One shared routing path for all modalities** — new `proxyForCompletion(env, access, body, opts)` in `api/src/presentation/routes/llmRoutes.ts`. When the body carries `tools` (an agentic tool-loop turn — Brain, on-prem, any tool-calling SDK) it passes `{ codingOnly: true, backstopModels: CODING_BACKSTOP_MODELS }`, mirroring `cloudAgentEngine`. Agentic turns now walk free coders → paid coder backstop → funded Anthropic floor, never the lite non-coder. Plain (no-tools) chat keeps the plan-aware general pool.
- **Wired into BOTH** `/v1/chat/completions` and the `/v1/messages` our-models branch (user directive: "same path for all modalities, consolidate"), so the OpenAI-shape and Anthropic-shape (Claude Agent SDK) endpoints can no longer drift onto different model ladders. `/v1/messages` stays as a required protocol shim — it's the path `@anthropic-ai/claude-agent-sdk` (the V2 runner) hard-codes; deleting it would kill the cloud+on-prem coding runtime.
- Tests: 2 new regression tests in `llmRoutes.test.ts` (tools → `codingOnly:true` + `CODING_BACKSTOP_MODELS`; no-tools → general pool). tsgo clean; 28 llmRoutes tests pass.

---

## ✅ RESOLVED 2026-07-05 — Brain roadmap-reconciliation: duplicate items + phantom file "save"

Root-caused from a failed Brain run (attach a ROADMAP.md → "transition outstanding items to OKRs/Epics/Tasks and write the IDs back"): it created duplicate items and claimed it updated the attached file when it could not. Shipped: api `2026.7.13`, frontend `2026.7.13`, brain-embedded `2026.7.7`.

- **Idempotent creates (no more duplicates)** — `tasks.create` / `objectives.create` / `key_results.create` in the gateway builtin catalog (`api/src/application/llm/builtinMcpService.ts`) now dedup by normalized title in-scope (task→project, objective→workspace/segment, KR→objective) and return the existing record as `{ deduped: true, … }` instead of a second row — so a re-run yields the existing id for traceability. Mirrored in the frontend client-manifest fallback via a shared `dedupedCreate` helper (`frontend/src/lib/brain/platformActions.ts`), so the web Brain never duplicates whether it runs the server `builtin_*` tool or the client fallback.
- **Real attachment write-back (no more phantom saves)** — new `attachments.read` (paginated — fixes "file too large to read") and `attachments.write` (overwrites the R2 upload in place, tenant-scoped by key prefix, metadata-preserving) builtin tools. Uploads were previously served read-only by signature with no write path, so a "saved the file" claim was structurally impossible to honor.
- **Honesty guard** — the shared Brain system prompt (`frontend/src/lib/brain/platformPrompt.ts`) now instructs: edit an attachment via read→edit→`attachments.write`, and NEVER claim a save/update/write unless a write tool returned success this turn. Backed by a structural detector `detectUnbackedWriteClaim(events, messages)` in the shared triage module (`brain-embedded/src/brainTriage.ts`) that surfaces a `⚠ UNBACKED WRITE CLAIM` line in every triage capture when an assistant turn claims a file write with no successful write tool call.
- Tests: builtin dedup + attachment read/write/tenant-scope (`builtinMcpService.test.ts`), client-manifest dedup (`platformActions.test.ts`), unbacked-write-claim detector (`brainTriage.test.ts`).

---

## ✅ RESOLVED 2026-07-05 — VS Code extension: 5 "real features" (assignable runtime, workforce/observability card, per-task diff, workforce embed, IDE Brain seed)

The larger VS Code roadmap items, built end-to-end. Shipped: api `2026.7.14`, frontend `2026.7.14`, builderforce-embedded `2026.6.30`, brain-embedded `2026.7.8`, extension VSIX `2026.7.27`.

- **VS Code as an assignable runtime (assigned-task delivery, tracked HITL).** The roadmap framed this as "add `'vscode'` to `agent_type`", but that enum is the LLM-provider axis (`claude|openai|ollama|http`) — the *assignee* axis is host/cloud/**human**. Assigning to a VS Code runtime is correctly modeled as assign-to-human + deliver-to-editor (a bare enum value would be a dead seam). Built the missing delivery loop: `GET /api/vscode/tasks` (open tasks assigned to the signed-in user, tenant-scoped via the project join, bounded 50, uncached like its `/tenants` sibling since it must reflect a just-assigned task) + `bfApi.listAssignedTasks` + an extension poll folded into the existing 5-min heartbeat (`pollAssignedTasks`) that notifies on newly-assigned work (first poll seeds silently so it doesn't announce the backlog) and "Show my tasks" flips the Projects & Tasks tree to its assigned-to-me filter. Status flows back through the existing `PATCH /api/tasks/:id`. Tests: `vscodeRoutes.test.ts` (+2). l10n in all 5 VS Code bundles.
- **Workforce + Observability VS Code presence.** New `vscodeConnections.list()` client + `isVscodeConnectionOnline()` (single liveness source: active + heartbeat < 11 min). Added a `'vscode'` kind to the shared `AgentTypePill`; `WorkforceAgents` now renders VS Code editors as read-only presence cards + table rows (mirroring the remote-host block); `ObservabilityContent` lists them as directory/presence chips (no timeline — VS Code emits no tool-audit telemetry). No new backend route (reused `GET /api/vscode/connections`). New strings under the `workforce.vscode` i18n namespace in all 5 catalogs.
- **First-class per-task diff panel.** Extracted the agent panel's Changes sub-tab into a shared `TaskChangesPanel` (owns the file-change list + Monaco diff detail; self-fetches `runtimeApi.taskFileChanges` when no execution-scoped list is passed). `AgentExecutionPanel` now delegates to it (DRY — removed its local `ChangeRow`/`CHANGE_COLOR`/`openChange`), and a new first-class **Changes** tab in the task drawer (`TaskMgmtContent`) renders it. New `taskChanges` i18n namespace + `taskMgmt.tabChanges` in all 5 catalogs.
- **`workforce` embed view.** Registered in `EMBED_VIEWS` (`builderforce-embedded`, pillar `agile`) + a `case 'workforce'` in `embed/[view]/page.tsx` rendering the existing `WorkforceAgents` grid (auth via the frame session; root layout provides `AuthProvider`). Rebuilt the package dist.
- **Web Project 360 "Improve with Brain" → one-click seed.** `BrainPanel` already had `initialPrompt` + auto-send; threaded a `?prompt=` param from `/ide/[id]` → `IDE` → `IDENew` into the docked `BrainPanel` and (for non-docked modalities) published it through `BrainContext` (new `initialPrompt` field in `brain-embedded`, consumed by `FloatingBrain`). `ProjectHealthPanel` now deep-links the `brain` action's ready-made seed text as `/ide/:id?prompt=`. Tests: FloatingBrain + brain-embedded suites green.

---

## ✅ RESOLVED 2026-07-05 — VS Code extension auth/token residuals

Confirmation pass over the "VS Code extension" roadmap section. Fixed the genuinely-broken items; confirmed the rest already resolved. Shipped: api `2026.7.13`, extension VSIX `2026.7.26`.

- **`/api/auth/agentHost-token` signed a jti it never persisted** (latent auth bug). A machine token's `authTokens.userId` FK cannot resolve to a real user, so the token would be rejected by `authMiddleware`'s jti-revocation check. Fixed by exempting `agentHost:` subjects from that check (`api/src/presentation/middleware/authMiddleware.ts`), mirroring the existing terms-check exemption — machine tokens are short-lived and API-key-gated by design.
- **Key-revoke endpoint implemented** — `POST /api/auth/keys/revoke` (`authRoutes.ts`) + `revokeTenantApiKeyByRawKey()` (`application/llm/tenantApiKeyService.ts`): self-service revoke of a `bfk_*` editor key by presenting the raw key (possession = authorization, no JWT), idempotent, invalidates the auth cache. The VS Code extension now calls it on sign-out (`clients/vscode/src/auth.ts removeSession`) so the server-side key dies with the local session instead of being orphaned. Guard test added.
- **Confirmed already-resolved** (no code change needed): 429 free-plan-cap upsell in the extension (`extension.ts:630-647`, "Upgrade to Pro" → /pricing); superadmin free-plan token-cap bypass (`PlanLimits.ts:199-201`, returns structured 429/402 not 500); VS Code webview l10n bundles fully translated for de/es/fr/zh (`clients/vscode/l10n/`); the "OpenAgentHost" vs "openclaw" acknowledgements copy drift is no longer present anywhere in `clients/vscode`.
- **Confirmed still-open** (left in roadmap): `agent_type` has no `'vscode'` value + no task-poll/dispatch path (assigning tasks to a VS Code runtime is a full feature, not a residual); no dedicated workforce/observability card enumerating `vscode_connections`; no per-task diff panel; no `workforce` embed view; `/ide/:id?prompt=` one-click Brain seed.

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
