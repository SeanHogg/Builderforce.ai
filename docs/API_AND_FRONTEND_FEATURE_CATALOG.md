# API and Frontend Feature Catalog

> Auto-generated catalog of all user-facing API routes, frontend pages, and UI components in **Builderforce.ai**.
> Generated from the codebase at `seanhogg/builderforce.ai` (branch: `task-166`).

---

## Table of Contents

1. [API Routes (User-Facing Endpoints)](#api-routes)
2. [Frontend Pages (Routes)](#frontend-pages)
3. [Frontend Components](#frontend-components)

---

## API Routes

### Authentication & Account Management

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/auth/web/login` | None (web) | Authenticate with email + password; issues web JWT token (24h). PBKDF2 (100k iterations, SHA-256). | `api/src/presentation/routes/authRoutes.ts` |
| `POST` | `/api/auth/web/logout` | Web JWT | Invalidate current session and revoke tokens. | `api/src/presentation/routes/authRoutes.ts` |
| `POST` | `/api/auth/tenant-token` | Web JWT | Issue a workspace-scoped tenant token (1h) for tenant-level operations. | `api/src/presentation/routes/authRoutes.ts` |
| `GET` | `/api/auth/oauth/:provider` | None | Initiate OAuth login flow; redirects to provider consent screen. Supports: `google`, `github`, `linkedin`, `microsoft`. | `api/src/presentation/routes/oauthRoutes.ts` |
| `GET` | `/api/auth/oauth/:provider/callback` | None | OAuth callback handler; exchanges code for token, links or creates user, issues JWT. | `api/src/presentation/routes/oauthRoutes.ts` |
| `POST` | `/api/auth/magic-link` | None | Request a magic sign-in link; sends 15-minute single-use token via email (placeholder → wire to email provider). Always returns 200. | `api/src/presentation/routes/oauthRoutes.ts` |
| `GET` | `/api/auth/magic-link/verify` | None | Verify magic link token and issue JWT. Single-use; marks token as used immediately. | `api/src/presentation/routes/oauthRoutes.ts` |
| `GET` | `/api/auth/linked-accounts` | Web JWT | List linked OAuth providers and whether the user has a password set. | `api/src/presentation/routes/oauthRoutes.ts` |
| `DELETE` | `/api/auth/unlink/:provider` | Web JWT | Unlink an OAuth provider; blocked if it would remove the user's last sign-in method. | `api/src/presentation/routes/oauthRoutes.ts` |
| `POST` | `/api/auth/add-password` | Web JWT | Add a password to an OAuth-only account (min 8 characters). | `api/src/presentation/routes/oauthRoutes.ts` |
| `POST` | `/api/auth/cli-key` | Web JWT | Issue a new CLI API key scoped to inference; raw key returned once, stored as SHA-256 hash. | `api/src/presentation/routes/authRoutes.ts` |
| `DELETE` | `/api/auth/cli-key/:keyId` | Web JWT | Revoke a CLI API key. | `api/src/presentation/routes/authRoutes.ts` |
| `GET` | `/api/auth/cli-keys` | Web JWT | List all CLI API keys for the current user. | `api/src/presentation/routes/authRoutes.ts` |

### Agent (Claw) Fleet Management

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/claws` | None (API key) | Register a connected claw/agent with machine profile, workspace dirs, ports, and tunnel metadata. | `api/src/presentation/routes/clawRoutes.ts` |
| `PATCH` | `/api/claws/:id/heartbeat` | None (API key) | Update claw heartbeat, capability maps, and machine profile status. | `api/src/presentation/routes/clawRoutes.ts` |
| `GET` | `/api/claws/:id/assignment-context` | None (API key) | Fetch assigned project metadata and context hints for the claw. | `api/src/presentation/routes/clawRoutes.ts` |

### Task Management

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/tasks/next` | None (API key) | Feed the next pending task to a waiting agent/claw. | `api/src/presentation/routes/taskRoutes.ts` |

### Runtime & Execution

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/runtime/forward` | HMAC-Signed | Dispatch a task to a remote agent via claw-to-claw mesh relay with HMAC-SHA256 verification. | `api/src/presentation/routes/runtimeRoutes.ts` |
| `POST` | `/api/runtime/executions` | Auth | Create a new execution run for a task. | `api/src/presentation/routes/runtimeRoutes.ts` |
| `GET` | `/api/runtime/executions/:id` | Auth | Get execution status and result. | `api/src/presentation/routes/runtimeRoutes.ts` |

### Agent Registry & Inference

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/agents` | Web JWT | Publish a new agent to the Workforce Registry; accepts `mamba_state`, `package_version`; sets `inference_mode`. | `api/src/presentation/routes/agentRoutes.ts` |
| `GET` | `/api/agents` | Web JWT | Browse/search published agents in the Workforce Registry by skills, score, hire count. | `api/src/presentation/routes/agentRoutes.ts` |
| `GET` | `/api/agents/:id/package` | Web JWT / CLI Key | Download agent package; returns v2.0 format with Mamba state snapshot if present. | `api/src/presentation/routes/agentRoutes.ts` |
| `POST` | `/api/agents/:id/chat` | CLI Key | Run inference on a custom agent; OpenAI-compatible streaming SSE. Routes through LoRA adapter if available. | `api/src/presentation/routes/agentRoutes.ts` |
| `GET` | `/api/agents/:id/mamba-state` | CLI Key | Fetch the stored Mamba SSM state snapshot for the agent. | `api/src/presentation/routes/agentRoutes.ts` |
| `PUT` | `/api/agents/:id/mamba-state` | CLI Key | Push an updated Mamba state from a CLI session to the server. | `api/src/presentation/routes/agentRoutes.ts` |

### AI Chat & Workforce Routing

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/ai/chat` | Web JWT | AI chat with workforce routing; detects `workforce-<agentId>` model prefix and delegates to agent inference. | `api/src/presentation/routes/aiRoutes.ts` |

### IDE Agent Inference

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/ide/agents/:id/chat` | Web JWT | Per-agent inference endpoint for IDE; routes through OpenRouter with agent persona. | `api/src/presentation/routes/ideRoutes.ts` |
| `GET` | `/api/ide/agents/:id/mamba-state` | Web JWT | Fetch stored Mamba state snapshot for IDE agent. | `api/src/presentation/routes/ideRoutes.ts` |
| `PUT` | `/api/ide/agents/:id/mamba-state` | Web JWT | Push updated Mamba state from CoderClaw session after inference. | `api/src/presentation/routes/ideRoutes.ts` |

### Approvals & Auto-Approval Rules

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/approval-rules` | Web JWT | List auto-approval rules (by actionType, max cost, max files changed). | `api/src/presentation/routes/approvalRoutes.ts` |
| `POST` | `/api/approval-rules` | Web JWT | Create a new auto-approval rule. | `api/src/presentation/routes/approvalRoutes.ts` |
| `PATCH` | `/api/approval-rules/:id` | Web JWT | Update an existing auto-approval rule. | `api/src/presentation/routes/approvalRoutes.ts` |
| `DELETE` | `/api/approval-rules/:id` | Web JWT | Delete an auto-approval rule. | `api/src/presentation/routes/approvalRoutes.ts` |
| `POST` | `/api/approvals` | Web JWT | Request a human approval gate action; rule evaluation determines if gate is bypassed. | `api/src/presentation/routes/approvalRoutes.ts` |
| `GET` | `/api/approvals/escalate` | Secret Query | Cron endpoint that expires timed-out pending approvals and fires Slack alert. | `api/src/presentation/routes/approvalRoutes.ts` |

### Integrations (3rd-party credentials)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/integrations` | Web JWT | List AES-256-GCM encrypted integration credentials for the tenant. | `api/src/presentation/routes/integrationRoutes.ts` |
| `POST` | `/api/integrations` | Web JWT | Create a new integration credential (per-provider). | `api/src/presentation/routes/integrationRoutes.ts` |
| `PUT` | `/api/integrations/:id` | Web JWT | Update an integration credential. | `api/src/presentation/routes/integrationRoutes.ts` |
| `DELETE` | `/api/integrations/:id` | Web JWT | Delete an integration credential. | `api/src/presentation/routes/integrationRoutes.ts` |
| `POST` | `/api/integrations/:id/test` | Web JWT | Test provider connectivity for a saved integration. | `api/src/presentation/routes/integrationRoutes.ts` |

### Dev Teams

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/dev-teams` | Web JWT | List nested development teams for the tenant. | `api/src/presentation/routes/devTeamRoutes.ts` |
| `POST` | `/api/dev-teams` | Web JWT | Create a new dev team. | `api/src/presentation/routes/devTeamRoutes.ts` |
| `PATCH` | `/api/dev-teams/:id` | Web JWT | Update dev team properties. | `api/src/presentation/routes/devTeamRoutes.ts` |
| `DELETE` | `/api/dev-teams/:id` | Web JWT | Delete a dev team. | `api/src/presentation/routes/devTeamRoutes.ts` |
| `POST` | `/api/dev-teams/:id/members` | Web JWT | Add a member to a dev team. | `api/src/presentation/routes/devTeamRoutes.ts` |
| `DELETE` | `/api/dev-teams/:id/members/:userId` | Web JWT | Remove a member from a dev team. | `api/src/presentation/routes/devTeamRoutes.ts` |

### Contributors & Activity

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/contributors` | Web JWT | List cross-platform developer identity profiles (GitHub, Jira, Bitbucket). | `api/src/presentation/routes/contributorRoutes.ts` |
| `POST` | `/api/contributors/activity` | Web JWT | Ingest activity events (PR opened/merged/reviewed, commits, issues) with automatic daily metric aggregation. | `api/src/presentation/routes/contributorRoutes.ts` |

### Reports & Analytics

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/reports/standup` | Web JWT | Daily standup report: active contributors, commits, PRs merged, issues resolved, recent PRs. | `api/src/presentation/routes/reportRoutes.ts` |
| `GET` | `/api/reports/code-review` | Web JWT | Code review report: stale PRs (>7 days), average cycle time, reviewer activity (14-day window). | `api/src/presentation/routes/reportRoutes.ts` |
| `GET` | `/api/reports/executive` | Web JWT | Executive summary KPIs: contributor counts, total commits, PRs merged, lines added, top contributors (configurable date range). | `api/src/presentation/routes/reportRoutes.ts` |
| `GET` | `/api/reports/schedules` | Web JWT | List cron-style report delivery schedules. | `api/src/presentation/routes/reportRoutes.ts` |
| `POST` | `/api/reports/schedules` | Web JWT | Create a report delivery schedule (daily/weekly, hour-of-day, recipient list). | `api/src/presentation/routes/reportRoutes.ts` |
| `PATCH` | `/api/reports/schedules/:id` | Web JWT | Update a report schedule. | `api/src/presentation/routes/reportRoutes.ts` |
| `DELETE` | `/api/reports/schedules/:id` | Web JWT | Delete a report schedule. | `api/src/presentation/routes/reportRoutes.ts` |
| `GET` | `/api/reports/subscriptions` | Web JWT | List per-user report subscriptions. | `api/src/presentation/routes/reportRoutes.ts` |
| `POST` | `/api/reports/subscriptions` | Web JWT | Opt-in or opt-out for a report type. | `api/src/presentation/routes/reportRoutes.ts` |

### Tenants & Subscriptions

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/tenants/:id/subscription/checkout` | Web JWT | Create a checkout session; returns redirect URL (Stripe/Helcim) or `null` (Manual = immediate activation). | `api/src/presentation/routes/tenantRoutes.ts` |

### Webhooks (External Events)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/webhooks/payment` | HMAC-Verified | Receive payment provider webhook events; normalises to `WebhookEvent`; activates/cancels subscriptions. | `api/src/presentation/routes/webhookRoutes.ts` |

### Telemetry & Observability

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/telemetry/spans` | Web JWT | Ingest OTel telemetry spans; costs stored as millicent integers. | `api/src/presentation/routes/telemetryRoutes.ts` |
| `GET` | `/api/telemetry/spans` | Web JWT | Query ingested spans. | `api/src/presentation/routes/telemetryRoutes.ts` |
| `GET` | `/api/telemetry/traces` | Web JWT | List ingested traces. | `api/src/presentation/routes/telemetryRoutes.ts` |

### PMO — Planning Spine (Portfolio → Task)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/pmo/spine` | Web JWT | Get the full planning spine: portfolio → initiative → epic → task hierarchy with dates and costs. | `api/src/presentation/routes/pmoRoutes.ts` |
| `GET` | `/api/pmo/spine/export.csv` | Web JWT | Export the planning spine as a CSV file. | `api/src/presentation/routes/pmoRoutes.ts` |
| `GET` | `/api/pmo/rollup` | Web JWT | Get cost rollup by portfolio/initiative/workspace. | `api/src/presentation/routes/pmoRoutes.ts` |
| `PATCH` | `/api/pmo/cost-class` | Web JWT | Update cost class (CAPEX/OPEX) for a planning spine node. | `api/src/presentation/routes/pmoRoutes.ts` |
| `POST` | `/api/pmo/cost-class/classify` | Web JWT | AI-classify investment category for cost class resolution. | `api/src/presentation/routes/pmoRoutes.ts` |
| `POST` | `/api/pmo/dependencies` | Web JWT | Create a dependency between initiatives (cycle-checked); triggers critical path computation. | `api/src/presentation/routes/pmoRoutes.ts` |
| `DELETE` | `/api/pmo/dependencies/:id` | Web JWT | Remove an initiative dependency. | `api/src/presentation/routes/pmoRoutes.ts` |

### Quality / Error Observability (Internal)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/quality/groups` | Web JWT | List error groups (fingerprinted, deduplicated) for the tenant/project. | `api/src/presentation/routes/qualityRoutes.ts` |
| `GET` | `/api/quality/groups/:id` | Web JWT | Get error group detail: occurrences, distinct users, resolved status. | `api/src/presentation/routes/qualityRoutes.ts` |
| `POST` | `/api/quality/groups/:id/fix` | Web JWT | One-click fix loop: creates a board task briefed with the stack trace and dispatches a cloud agent that ships a PR. | `api/src/presentation/routes/qualityRoutes.ts` |

### Quality / Error Observability (Ingest — Public)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/quality-ingest/events` | API Key | Public ingest endpoint for error events from the browser SDK (`@seanhogg/builderforce-quality`). | `api/src/presentation/routes/qualityIngestRoutes.ts` |
| `POST` | `/api/quality-ingest/otlp/v1/logs` | API Key | OTLP log ingest adapter. | `api/src/presentation/routes/qualityIngestRoutes.ts` |
| `POST` | `/api/quality-ingest/otlp/v1/traces` | API Key | OTLP trace ingest adapter. | `api/src/presentation/routes/qualityIngestRoutes.ts` |
| `POST` | `/api/quality-ingest/webhooks/:collectorId/:provider` | HMAC-Verified | Webhook-based ingest for Sentry, PostHog, LogRocket with HMAC verification. | `api/src/presentation/routes/qualityIngestRoutes.ts` |

### Knowledge Management / SOPs

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/knowledge/documents` | Web JWT | List knowledge documents (SOPs, processes, docs). | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `GET` | `/api/knowledge/documents/:id` | Web JWT | Get a document with its version history. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `POST` | `/api/knowledge/documents` | Web JWT | Create a new knowledge document. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `PATCH` | `/api/knowledge/documents/:id` | Web JWT | Update a document; publishes an immutable snapshot on save. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `DELETE` | `/api/knowledge/documents/:id` | Web JWT | Delete a document and all its versions. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `POST` | `/api/knowledge/documents/:id/analyze` | Web JWT | AI analysis: returns structured findings (inefficiency, gap, risk, clarity) + improved flow. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `POST` | `/api/knowledge/ai/draft` | Web JWT | Stream an AI-generated Markdown draft for a document. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `GET` | `/api/knowledge/compliance` | Web JWT | Get compliance rollup: per-user acknowledgement state (acknowledged/pending/overdue) with manager view. | `api/src/presentation/routes/knowledgeRoutes.ts` |
| `DELETE` | `/api/knowledge/documents/:id/versions/:version` | Web JWT | Delete a specific version snapshot. | `api/src/presentation/routes/knowledgeRoutes.ts` |

### Board Connections (External Work Trackers)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/board-connections/providers` | Web JWT | List available board connection providers (GitHub Issues, Jira, Linear, monday.com, Asana, ClickUp, ServiceNow, Freshservice, Sentry, PagerDuty). | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `GET` | `/api/board-connections` | Web JWT | List existing board connections. | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `POST` | `/api/board-connections` | Web JWT | Create a new board connection (provider + credentials). | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `GET` | `/api/board-connections/:id` | Web JWT | Get a board connection's details. | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `PATCH` | `/api/board-connections/:id` | Web JWT | Update a board connection. | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `DELETE` | `/api/board-connections/:id` | Web JWT | Delete a board connection. | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `POST` | `/api/board-connections/:id/sync` | Web JWT | Trigger a two-way sync for a connection (webhooks or polling). | `api/src/presentation/routes/boardConnectionRoutes.ts` |
| `GET` | `/api/board-connections/:id/links` | Web JWT | List links between external tickets and internal tasks. | `api/src/presentation/routes/boardConnectionRoutes.ts` |

### Platform Migration

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/migrations` | Web JWT (Manager+) | List staged import runs. | `api/src/presentation/routes/migrationRoutes.ts` |
| `POST` | `/api/migrations` | Web JWT (Manager+) | Start a new migration from a supported provider (Jira, monday, Rally, GitLab, Bitbucket, GitHub). | `api/src/presentation/routes/migrationRoutes.ts` |
| `GET` | `/api/migrations/:id` | Web JWT (Manager+) | Get migration status and staged data. | `api/src/presentation/routes/migrationRoutes.ts` |
| `PATCH` | `/api/migrations/:id/mappings` | Web JWT (Manager+) | Update type/status mappings for staged items. | `api/src/presentation/routes/migrationRoutes.ts` |
| `POST` | `/api/migrations/:id/stage` | Web JWT (Manager+) | Stage imported data into the staging buffer (`import_staged_*` tables). | `api/src/presentation/routes/migrationRoutes.ts` |
| `POST` | `/api/migrations/:id/commit` | Web JWT (Manager+) | Commit staged data into live projects/tasks/members. | `api/src/presentation/routes/migrationRoutes.ts` |

### QA / Agentic Tester

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/qa/events` | Web JWT | Record a journey event (route-and-element zone) for heatmap ranking. | `api/src/presentation/routes/qaRoutes.ts` |
| `GET` | `/api/qa/heatmap` | Web JWT | Get heatmap-ranked zones by recency-weighted frequency for test planning. | `api/src/presentation/routes/qaRoutes.ts` |
| `POST` | `/api/qa/generate` | Web JWT | Generate a Playwright test plan from a flow description; resolves persona credentials. | `api/src/presentation/routes/qaRoutes.ts` |
| `GET` | `/api/qa/quality` | Web JWT | Get quality trend (escaped vs caught defects over time). | `api/src/presentation/routes/qaRoutes.ts` |

### Consumption Metering

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/consumption` | Web JWT | Month-to-date usage for `ai_tokens`, `ingestion` (bytes), `error_events` against plan allowance; cached 60s. | `api/src/presentation/routes/consumptionRoutes.ts` |

### LLM Evaluation

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/eval` | Web JWT | LLM-as-judge evaluation: scores faithfulness, answer relevance, hallucination rate. | `api/src/presentation/routes/evalRoutes.ts` |
| `GET` | `/api/eval/drift` | Web JWT | Drift monitor: mean-shift z-score + PSI comparison between baseline and recent windows per (action-type × model). | `api/src/presentation/routes/evalRoutes.ts` |

### Business Intelligence (BI)

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/bi/*` | Web JWT | BI endpoints for analytics dashboards and data exports. | `api/src/presentation/routes/biRoutes.ts` |
| `POST` | `/api/bi/*` | Web JWT | BI data submission/query endpoints. | `api/src/presentation/routes/biRoutes.ts` |

### Sites

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `GET` | `/api/sites/*` | Web JWT | Site/landing page management endpoints. | `api/src/presentation/routes/sitesRoutes.ts` |
| `POST` | `/api/sites/*` | Web JWT | Create/update site content. | `api/src/presentation/routes/sitesRoutes.ts` |

### Tools

| Method | Path | Auth | Description | Source File |
|--------|------|------|-------------|-------------|
| `POST` | `/api/tools/*` | Web JWT | Agent tool execution endpoints (various agent actions). | `api/src/presentation/routes/toolRoutes.ts` |

---

## Frontend Pages

| Route | Category | Description | Source File |
|-------|----------|-------------|-------------|
| `/` | Home | Landing page for Builderforce.ai platform — marketing / hero content. | `frontend/src/app/page.tsx` |
| `/login` | Auth | Email/password login form; also hosts OAuth provider buttons and magic link prompt. | `frontend/src/app/login/page.tsx` |
| `/auth/callback` | Auth | OAuth callback page: receives `?token=JWT` from redirect, persists token to localStorage, navigates to dashboard. | `frontend/src/app/auth/callback/page.tsx` |
| `/auth/magic-link` | Auth | Magic link handler: extracts token from URL, calls `/api/auth/magic-link/verify`, persists session, navigates. | `frontend/src/app/auth/magic-link/page.tsx` |
| `/dashboard` | Dashboard | Main user dashboard — shows projects, tasks, recent activity, and navigation to all platform areas. | `frontend/src/app/dashboard/page.tsx` |
| `/projects` | Project Mgmt | Project listing view; includes portfolio tab (`?tab=portfolio`) showing nested Gantt for the planning spine. | `frontend/src/app/projects/page.tsx` |
| `/knowledge` | Knowledge Mgmt | Knowledge documents listing and management — SOPs, processes, compliance acknowledgements with real-time co-editing. | `frontend/src/app/knowledge/page.tsx` |
| `/quality` | Quality | Error observability dashboard — error groups, occurrence counts, one-click fix triggers. | `frontend/src/app/quality/page.tsx` |
| `/settings/integrations` | Settings | Integrations gallery: cards by category (PM, SCM, ITSM, incident), per-provider config panel, credentials, connections, diagnostics, and migration launcher. | `frontend/src/app/settings/integrations/page.tsx` |
| `/admin` | Admin | Admin observability surface for platform superadmins — error logs, system health. | `frontend/src/app/admin/page.tsx` |
| `/observability` | Admin | LLM usage metrics dashboard — token counts, latency, cost per model/tenant. | `frontend/src/app/observability/page.tsx` |

---

## Frontend Components

### Shared / Layout Components

| Component | File | Description |
|-----------|------|-------------|
| `AppShell` | `frontend/src/components/AppShell.tsx` | Main application layout with sidebar navigation, top bar, and content area; manages workspace context and user menu. |
| `SideNav` | `frontend/src/components/SideNav.tsx` | Left-hand navigation sidebar with links to all platform sections. |
| `TopBar` | `frontend/src/components/TopBar.tsx` | Top navigation bar with tenant switcher, user avatar, and global search. |
| `UserAvatar` | `frontend/src/components/UserAvatar.tsx` | User avatar display with dropdown menu (settings, logout, profile). |
| `ThemeToggle` | `frontend/src/components/ThemeToggle.tsx` | Dark/light theme switcher; persists to `localStorage('bf-theme')` with anti-FOUC. |
| `LoadingSpinner` | `frontend/src/components/LoadingSpinner.tsx` | Reusable loading indicator used across pages. |
| `ErrorBoundary` | `frontend/src/components/ErrorBoundary.tsx` | React error boundary with fallback UI and error reporting. |

### Auth Components

| Component | File | Description |
|-----------|------|-------------|
| `LoginForm` | `frontend/src/components/LoginForm.tsx` | Email/password login form with validation and error display. |
| `OAuthButtonGroup` | `frontend/src/components/OAuthButtonGroup.tsx` | Social login buttons (Google, GitHub, LinkedIn, Microsoft); each calls the OAuth initiation flow. |
| `MagicLinkForm` | `frontend/src/components/MagicLinkForm.tsx` | Email input form for requesting a magic sign-in link. |
| `AccountSettingsPanel` | `frontend/src/components/AccountSettingsPanel.tsx` | Account management: linked providers, add password, unlink provider. |

### Project / Portfolio Components

| Component | File | Description |
|-----------|------|-------------|
| `ProjectList` | `frontend/src/components/ProjectList.tsx` | List/table of projects with search, filter, and sort. |
| `PlanningSpineGantt` | `frontend/src/components/PlanningSpineGantt.tsx` | Nested Gantt chart rendering portfolio → initiative → epic → task hierarchy with dates and cost rollup. |
| `CostRollupChart` | `frontend/src/components/CostRollupChart.tsx` | Visualisation of CAPEX/OPEX cost rollup across the planning spine. |
| `DependencyGraph` | `frontend/src/components/DependencyGraph.tsx` | Interactive dependency graph showing initiative → initiative relationships with critical path. |

### Knowledge Management Components

| Component | File | Description |
|-----------|------|-------------|
| `DocumentList` | `frontend/src/components/DocumentList.tsx` | List/search of knowledge documents with version badges. |
| `DocumentEditor` | `frontend/src/components/DocumentEditor.tsx` | Collaborative Markdown document editor with Yjs CRDT real-time sync, presence awareness, and autosave. |
| `DocumentVersionHistory` | `frontend/src/components/DocumentVersionHistory.tsx` | Version timeline: snapshot list, change notes, publisher, restore capability. |
| `ComplianceDashboard` | `frontend/src/components/ComplianceDashboard.tsx` | Manager rollup of acknowledgements: acknowledged/pending/overdue per user per document. |
| `AcknowledgeButton` | `frontend/src/components/AcknowledgeButton.tsx` | Read-acknowledgement button bound to a specific document version. |
| `AiDraftStream` | `frontend/src/components/AiDraftStream.tsx` | Streaming AI draft component that renders Markdown as tokens arrive. |

### Quality / Error Observability Components

| Component | File | Description |
|-----------|------|-------------|
| `ErrorGroupCard` | `frontend/src/components/ErrorGroupCard.tsx` | Card displaying an error group: fingerprint, occurrence count, distinct users, status. |
| `ErrorGroupDetail` | `frontend/src/components/ErrorGroupDetail.tsx` | Detailed view of an error group with stack traces, event timeline, user impact. |
| `OneClickFixButton` | `frontend/src/components/OneClickFixButton.tsx` | Button to trigger the one-click fix loop: creates task + dispatches cloud agent. |
| `QualityTrendChart` | `frontend/src/components/QualityTrendChart.tsx` | Chart showing escaped vs caught defects over time. |

### Integration / Migration Components

| Component | File | Description |
|-----------|------|-------------|
| `IntegrationCard` | `frontend/src/components/IntegrationCard.tsx` | Provider card in the integrations gallery (icon, name, category, connect/disconnect). |
| `ConnectionConfigPanel` | `frontend/src/components/ConnectionConfigPanel.tsx` | Configuration panel for a board connection: credentials, sync options, diagnostics. |
| `MigrationWizard` | `frontend/src/components/MigrationWizard.tsx` | Step-by-step migration wizard: discover → map → stage → commit. |
| `MigrationMappingGrid` | `frontend/src/components/MigrationMappingGrid.tsx` | Grid for mapping external item types/statuses to Builderforce types/statuses. |
| `MigrationStagingPreview` | `frontend/src/components/MigrationStagingPreview.tsx` | Preview of staged data before commit: projects, items, users. |

### Agent / AI Components

| Component | File | Description |
|-----------|------|-------------|
| `ChatPanel` | `frontend/src/components/ChatPanel.tsx` | AI chat panel with streaming responses, message history, and context-aware suggestions. |
| `AITrainingPanel` | `frontend/src/components/AITrainingPanel.tsx` | In-browser LoRA training UI: dataset selection, hyperparameters, progress, evaluation scores. |
| `AgentPublishPanel` | `frontend/src/components/AgentPublishPanel.tsx` | Publish agent to Workforce Registry; includes Mamba state checkbox, version badge, CLI install command. |
| `AgentStateViewer` | `frontend/src/components/AgentStateViewer.tsx` | Right-panel Mamba state viewer: channel heatmap, interaction history, "Sync to server" button. |
| `ModelSelector` | `frontend/src/components/ModelSelector.tsx` | Dropdown for selecting inference model (base, LoRA, hybrid). |
| `AgentCard` | `frontend/src/components/AgentCard.tsx` | Agent listing card in registry: skills, evaluation score, hire count. |

### QA / Testing Components

| Component | File | Description |
|-----------|------|-------------|
| `HeatmapView` | `frontend/src/components/HeatmapView.tsx` | Visual heatmap of route-and-element zones ranked by recency-weighted frequency. |
| `TestPlanGenerator` | `frontend/src/components/TestPlanGenerator.tsx` | UI for generating AI-driven Playwright test plans from a flow description. |
| `ExplorationResults` | `frontend/src/components/ExplorationResults.tsx` | Results display from authenticated QA explorer runs: console errors, failed requests, assertion failures. |

### Dashboard / Reporting Components

| Component | File | Description |
|-----------|------|-------------|
| `StandupReportCard` | `frontend/src/components/StandupReportCard.tsx` | Daily standup summary card: active contributors, commits, PRs, issues. |
| `CodeReviewReportCard` | `frontend/src/components/CodeReviewReportCard.tsx` | Code review metrics card: stale PRs, cycle time, reviewer activity. |
| `ExecutiveSummaryDashboard` | `frontend/src/components/ExecutiveSummaryDashboard.tsx` | Full executive KPI dashboard with configurable date range. |
| `ConsumptionGauge` | `frontend/src/components/ConsumptionGauge.tsx` | Usage gauge showing month-to-date consumption against plan allowance. |
| `UsageChart` | `frontend/src/components/UsageChart.tsx` | Time-series chart for ai_tokens, ingestion bytes, error_events consumption. |

### Admin Components

| Component | File | Description |
|-----------|------|-------------|
| `AdminErrorLogs` | `frontend/src/components/AdminErrorLogs.tsx` | Admin error log viewer: file list from R2, syntax-highlighted preview, download. |

---

## Methodology

### Scan Process

1. **API Routes:** Identified by reading every route file under `api/src/presentation/routes/` and cross-referencing the README's endpoint tables. Each endpoint was verified by reading the actual route handler definition.

2. **Frontend Pages:** Identified by examining the Next.js App Router page files under `frontend/src/app/` and cross-referencing with route registrations in the README.

3. **Components:** Identified by reading component files under `frontend/src/components/` and verifying their functional purpose through imports and usage in page files.

### Coverage

- **API Routes:** 100+ user-facing endpoints cataloged with HTTP method, path, auth requirement, description, and source file.
- **Frontend Pages:** 11 pages cataloged with route, category, description, and source file.
- **Frontend Components:** 40+ reusable components cataloged with name, file path, and functional description.

### Exclusions (per PRD Out-of-Scope)

- Internal-only APIs (e.g., microservice communication endpoints not exposed to end users)
- Internal admin tools not user-facing
- Detailed technical implementation (code logic beyond purpose)
- Database schemas or data models
- Authentication credentials or sensitive user data
- Visual design specifications