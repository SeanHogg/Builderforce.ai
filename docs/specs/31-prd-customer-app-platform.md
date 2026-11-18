# PRD 31: Build, run and ship a real app on Builderforce

**Status:** Proposed · **Owner:** platform (Delivery + Commerce + Integrations) · **Created:** 2026-09-26
**Reference app:** hired.video (`C:\code\hired\hired.video`). It is the acceptance fixture only. hired.video itself still **ports** under [PRD 18](./18-prd-hired-video-port.md).
**Relaxes:** Operator decision 3 / R5 (2026-08-15), "no choice of host, no choice of database". It is relaxed for **paid** tenants only.

---

## 1. Verdict

Users want to build apps of hired.video's calibre on Builderforce and run them there. hired.video is:

- a Hono Worker with 3 Durable Objects (WebSocket hibernation), R2, KV, Workers AI and a `*/5` cron;
- a Vite SPA with Pages Functions;
- Neon Postgres (428 tables, 262 migrations);
- about 80 secrets, and its own auth (JWT, passkeys, 4 OAuth providers);
- 11 domains.

Builderforce today can take such an app as far as **"the agent opens a PR"**. After that the flow stops:

| Step | Today | Evidence |
|---|---|---|
| Company → project | Companies own projects through `projects.company_id` (mig 1120) and the attach/detach UI in Investor → Companies. **A project cannot be created under a company in one step.** | `investorRoutes.ts`, `companyWorkspace.ts:564 linkProjectToCompany`, `POST /api/projects` has no `companyId` |
| Connect repo | Works (PAT). The GitHub App is not registered. | `resolveRepoCredential.ts`, `githubApp.ts` |
| Agent edits | Works on durable (commit + PR, no shell) and GitHub Actions. The container surface is **built, not live**. | `cloudDispatch.ts`, ROADMAP "cloud-container needs a live image" |
| **Run + see it** | The container, dev-server start, preview proxy (WS/HMR), signed URLs and idle eviction are all coded. **Not live**, plus 5 functional gaps (§4.1). | `AgentContainerDO`, `server.mjs`, `previewDevServer.ts`, `previewIngress.ts` |
| **Build** | No Builderforce build. The generated workflow is `npm run build` at the root. | `ide/deployWorkflow.ts` |
| **Provision** | Nothing. No Cloudflare, Neon, GCP or Azure API writes. No IaC. The only IaC is a generated SAM template. | audit 2026-09-26 |
| **Deploy server code** | Static `dist/` only. `project_sites.mode` is only ever `'static'`. | ROADMAP "A published site cannot run ARBITRARY server code" |
| Secrets | Vault exists (`project_secrets`). Values reach declarative handlers only. The customer copies them into GitHub by hand. | `projectSecrets.ts` |
| Custom domain | Code-complete, not live (Cloudflare for SaaS entitlement). Serves static sites only. | `customDomain.ts` |
| **Marketplace** | Canvas-born sessions only. No project-sourced listing, no mobile kind. `open` renders in a sandboxed iframe, so an own-auth app breaks. | `listings/target.ts`, `creationListings.launch.tsx` |
| End-user accounts | Builderforce `site_users` (email code) only. An own-auth app needs its own server running. | `siteAuth.ts` |

This PRD closes the rows after "Agent edits". It works as **three loops** built on the seams that already exist, not a second platform:

1. **Run loop:** clone → install → dev server → live preview in the Builderforce UI → agent edits → HMR reload → verify → commit/PR. This is the "cloud loop" the operator asked for.
2. **Ship loop:** blueprint → provision → build → migrate → deploy → domain. It targets the **customer's own cloud** (connected account) or **Builderforce's own infrastructure** (paid).
3. **Sell loop:** list a repo-connected project (web or mobile) → launch on its own domain, or install it on a phone → end users sign up in the app's own auth.

Everything an agent can do in these loops is also an **MCP tool** (§4.7), so the Brain and cloud agents drive the same path a human clicks through.

---

## 2. Operator decisions (2026-09-26, binding)

1. hired.video still ports (PRD 18 is unchanged). It is the reference app for finding gaps, not a hosting tenant.
2. **Paid tenants may choose host and database.** Free tenants keep collections plus static hosting. Gate this with `planFeatures`, never with a hard-coded refusal.
3. A customer can **connect their own Cloudflare / GCP / Azure / AWS account**, and Builderforce provisions into it.
4. The marketplace lists **mobile apps (Expo)** and repo-connected apps.
5. Build this out as MCP tools plus self-contained components, so agents can drive every step.

### Decisions still owed (each blocks only its own workstream)

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| D1 | Buy **Workers for Platforms** (dispatch namespace) on the builderforce.ai account? | W5 hosted tier | Yes. It is the sanctioned "platform hosting customer Workers" product and fits the Startup Program's "no reselling" test better than per-tenant accounts. |
| D2 | Do we need a separate **Enterprise** `TenantPlan`, or is PRO/TEAMS plus `premium_override` enough? | pricing only | No new tier yet. Two new `PlanLimits` booleans, `ownInfrastructure` and `hostedCompute`, true on PRO/TEAMS. |
| D3 | Neon for hosted apps: a **Neon project per app** under a Builderforce Neon org (Neon API), or a branch per app? | W5 | A project per app, because branches share compute and quota. Billed to the tenant through the consumption meter. |
| D4 | Enable the **Cloudflare for SaaS** entitlement plus `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_SAAS_API_TOKEN` | domains (already an open ROADMAP item) | Yes. It is also needed for W5 custom domains. |
| D5 | Register the **GitHub App** | smoother repo connect + secret push | Yes. The code is complete. |
| D6 | A **container instance type** for run loops (the default is the smallest) | W1 | `standard` at least, since `npm install` + Vite + Miniflare on the smallest instance will OOM. Budget it per the `containerRuntime` entitlement. |
| D7 | Is the **browser run tier (W9) the free-plan run loop**, with the container tier paid? | W9 Phase 5 gating | Yes. The browser tier costs Builderforce nothing per run, and the container tier keeps its `containerRuntime` entitlement. |
| D8 | ✅ **Decided 2026-11-17:** W9 commits to **Python, PHP, Rust and .NET**. Python also runs **LLM training on WebGPU** (§W9 "Python training on WebGPU"). | W9 Phases 6–7 | Decided. |

---

## 3. Principles (from the existing architecture; do not relax)

- **Ports, not branches.** Each new axis is a port with adapters, shaped like `hostingStrategy.ts` and `gameTarget.ts`. A new cloud is an adapter. A new framework is a detector entry. A new listing delivery is contract data.
- **One blueprint, many targets.** What the app *is* (services, bindings, database, secrets, domains, build/dev commands) is detected once into an `AppBlueprint`. Run, provision, deploy and list all read it. No surface re-derives it.
- **A plan before an apply.** Provisioning is `plan` (a diff shown to the human) and then `apply` (idempotent, recorded). Destructive operations are confirm-gated, like `campaign.send`.
- **The ledger is the truth.** Every resource Builderforce creates is one row in one table, holding the external id and never the secret. Destroy, drift and cost read the ledger.
- **Secrets have no read path.** The `project_secrets` invariant holds. Values leave the vault only toward a runtime (container env, Worker secret, GitHub sealed box), never toward a UI or model.
- **The customer's cloud stays theirs.** Connected-account deploys must be reproducible without Builderforce. The generated workflow and IaC files stay committed in their repo, as `github-worker` does today.

---

## 4. Workstreams

### W1: Run loop (container + live preview + agent), **highest leverage**

Most of it exists. This makes it real.

1. **Ship the image.** `wrangler deploy` builds `api/container/Dockerfile`. Verify Docker on the `release.yml deploy-api` runner, set `instance_type` (D6), and pass `/health`. Closes ROADMAP "cloud-container needs a live image" and "Deploy + live-validation".
2. **Image contents.** `corepack enable` as root (pnpm/yarn), bun, python3 + build-essential for native modules, `wrangler`, `expo` CLI caching. **No Docker-in-Docker** on Cloudflare Containers: a `docker compose` repo runs on the on-prem runner or a BYO-cloud container host (W4), never here. Say so in the UI, don't fail silently.
3. **Install step before the dev server.** It comes from the blueprint's `packageManager` + `install` (lockfile → npm ci / pnpm i --frozen-lockfile / yarn / bun), per workspace root when the repo has no workspace tool (hired installs 4 folders). This is the biggest gap today: nothing installs.
4. **Fix candidate selection.** `buildPreviewDevServerStep` marks Vite with the *generated* `vite.config.builderforce-preview.mjs`, which always exists, so every repo with a `dev` script runs `npx vite` and the Next candidate is unreachable. Candidates come from the blueprint's `devCommands` (W2), not a hard-coded list.
5. **Multi-process dev.** hired needs `wrangler dev` (API + DOs + R2/KV emulated by Miniflare) **and** `vite dev`, with the SPA's `VITE_API_URL` pointed at the local Worker. The preview proxy exposes N named ports (`/__preview__/<service>/…`), not one fixed `PREVIEW_PORT`. The port map is chosen per run, not at container boot.
6. **Secrets and env into the run.** `loadProjectSecretValues` → the `/run` spec's `env` (the container only, never the model transcript; `redactSecretValues` on all tool output). Non-secret `vars` come from the blueprint. The dev database is a **Neon branch per run** when the project has a connected Neon (W4), so the agent never touches production data.
7. **Preview in the UI.** `LivePreviewPanel` (self-contained: client + hook + presentational). It is mounted in the execution drawer and the project/app panel, uses `GET /executions/:id/preview-url` and `/projects/:id/preview-url`, and shows service tabs, a reload/restart control, a device frame (via [[canvas-device-frame-rule]]), and a QR for Expo (`exp://` URL per ROADMAP L274/L440). Gated by `livePreview` (402 → visible-disabled upsell). Five locales, both themes, 360px.
8. **The loop closes.** Agent tools `preview_status`, `preview_restart`, `preview_logs` (tail of the dev-server output) and `preview_screenshot` (Browser Rendering against the preview URL, reusing `webScreenshot.ts`). This lets the agent *see* its change, not just compile it. The finish gate gains "the declared `verify` commands ran green". The image already drives the shared kernel loop (`agentLoop.mjs`, no step cap, failure-streak breaker; 2026-10-16); the LEGACY `CONTAINER_MAX_STEPS = 40` the launcher still sends goes away once that image is rebuilt and deployed.
9. **Human in the loop.** A human edit or steering message during a live preview lands in the same container (the steering splice exists), so "user changes with the AI agent → sees it in Builderforce → continues" is one session.

**Acceptance:** a fork of hired.video connected to a PRO project runs `wrangler dev` + `vite dev` in a container. The SPA renders in `LivePreviewPanel` with login working against the local Worker and a Neon branch. An agent's edit to a React component hot-reloads in the panel. The agent calls `preview_screenshot` to confirm it, and opens a PR whose `verify` (tsc for api + frontend) ran green in the container.

### W2: `AppBlueprint`, one detection of what the app is

- **Contract:** `packages/creation-canvas-contract/src/appBlueprint.ts` (shared by the API, web, container and VSIX). It declares:
  - `services[]`: each has kind (`worker` / `spa` / `node` / `container` / `mobile-expo` / `mobile-capacitor`), root dir, package manager, install/dev/build/start/verify commands, output dir and ports;
  - `bindings[]`: `durableObject` (class names + migrations), `r2`, `kv`, `d1`, `queue`, `cron`, `ai`, `vectorize`, `browser`;
  - `database`: engine, migration command(s), seed command;
  - `secrets[]`: names only; `vars`; `domains[]`.
- **Detectors are a registry** (`application/apps/blueprint/detectors/*`), each a pure function over a repo file listing plus a few file reads (via the repo provider port, cached by commit SHA with `getOrSetCached`). The first set:
  - `wrangler.toml` / `wrangler.jsonc` (needs a TOML parser dependency: `smol-toml`, zero-dep);
  - `package.json` scripts + lockfile;
  - `vite.config.*`, `next.config.*`;
  - `app.json` / `eas.json` (Expo), `capacitor.config.*`;
  - `drizzle.config.*` / `prisma/schema.prisma` / a `migrations/` dir;
  - `Dockerfile` / `docker-compose.yml`;
  - `.env.example` for secret names;
  - `.github/workflows/*` for existing deploy intent.
- **An optional repo override:** `builderforce.json` at the root, with the same shape. It is merged over detection, never a second source of truth. The agent can write it when detection is ambiguous.
- **Stored per project + commit:** `project_app_blueprints (project_id, commit_sha, blueprint jsonb, detected_at)`, with a unique `(project_id, commit_sha)`. This is a cache of a derivation, so it is written only by the detector use case.
- **UI:** a blueprint card on the project page showing services, bindings and the database, plus "N secrets missing" (names from the blueprint minus names in `project_secrets`).

**Acceptance:** hired.video is detected as 2 services, the bindings in its `wrangler.toml` (3 DOs, R2, KV, AI, cron `*/5`), Neon Postgres with `drizzle push` + `run-sql-migrations.mjs` + seed, and the secret names from `wrangler.toml` comments + `.env.example`, with no `builderforce.json`.

### W3: Cloud connections (the customer's own account)

- **Reuse:** `connector_connections` (sealed) plus `providerOAuthConnect.ts` for the OAuth-capable providers. Extend the existing `cloudflare` manifest; don't add a sibling.
- **Providers:**
  - **Cloudflare**: scoped API token with Workers Scripts, R2, KV, D1, Queues, Zone DNS and Workers Routes edit, validated with `/user/tokens/verify` plus a scope probe. Cloudflare OAuth when it's available to third parties.
  - **Neon**: API key.
  - **GCP**: OAuth `cloud-platform`, or Workload Identity Federation for the GitHub path that already exists.
  - **Azure**: ARM OAuth `management.azure.com`, or a service principal.
  - **AWS**: an IAM role with an external id, assumed through STS. No long-lived keys stored.
  - **GitHub**: the App (D5) for repo-secret writes.
- Each connection records **verified capabilities** (what the token can actually do). The provision planner refuses up front with the missing scope named, never halfway through an apply.
- **UI:** extend the existing integrations surface (a "Cloud accounts" group), not a new page.

### W4: Provisioning, the `InfraProvider` port + ledger

- **Port** (`application/infra/infraProvider.ts`): `capabilities()`, `plan(blueprint, target, ledger) → ProvisionPlan`, `apply(plan) → ledger rows`, `destroy(resource)`, `drift(ledger)`.
- **Adapters:**
  - `cloudflare` (REST): Workers script upload (multipart ESM + bindings metadata incl. DO migrations), R2 bucket, KV namespace, D1, Queue, cron triggers, custom domain / route, secrets (`PUT /workers/scripts/:name/secrets`).
  - `neon` (API): project, branch, role, database, connection string. The connection string goes into the secret vault, never the ledger.
  - `gcp-cloudrun`, `azure-functions` and `aws-lambda` reuse the existing generated-workflow adapters as their *deploy* half. Provisioning calls the cloud APIs for the database (Cloud SQL / Azure Postgres / RDS or Neon).
- **Ledger:** `infra_resources (id, tenant_id, project_id, connection_id NULL for BF-hosted, provider, kind, external_id, name, state, created_by_run, created_at, destroyed_at)`, unique `(provider, connection_id, kind, external_id)`. 3NF, one row per real resource.
- **Plan/apply is a human confirm** by default (the plan shows creates/updates/destroys and estimated cost). A board lane can pre-authorize non-destructive applies, with the same governance shape as `allowAutoStaffLanes`.
- **Secrets push:** `pushSecrets(target)` sends to Cloudflare (REST), GitHub (sealed box via libsodium; `tweetnacl` + `blakejs`, zero-dep in Workers), GCP Secret Manager or Azure Key Vault. It is recorded as a ledger event with **names only**.

### W5: Builderforce-hosted compute (paid)

- **Workers for Platforms (D1):** one dispatch namespace. Each app's Worker is uploaded as a user worker with its bindings. R2/KV are created in the Builderforce account and namespaced per app. DOs are supported on user workers (**verify cron + DO WebSocket hibernation support against current Cloudflare docs before committing; this is the single largest technical risk**). The dispatch Worker routes `<sub>.builderforce.ai` and custom hostnames (D4) to the right user worker.
- `project_sites.mode` gains the value **`'worker'`** (a column value, not a new table). Static-only apps keep `'static'`.
- **Neon per app (D3)** under the Builderforce org, metered by `consumption meter`. Collections stay the default for free apps.
- **Replace Operator decision 3** in `ProjectAppPanel.tsx` / `AppStatement.tsx` (and update `ProjectAppPanel.test.tsx:62`) with a host/database picker that decides its own visibility from `ownInfrastructure` / `hostedCompute`. Free tenants see it visible-disabled with the plan named.
- Isolation: user workers get **no** service bindings to Builderforce internals, have outbound limits set on the namespace, and CPU limits per plan.

### W6: Build + deploy pipeline

- **Where builds run:** in the W1 container (same image, `build` + `verify` from the blueprint), or in the customer's GitHub Actions for their own cloud. The generated workflow is rewritten from the blueprint (per-service working-directory, the right package manager, `NODE_OPTIONS` heap from the blueprint). The current npm-at-root template is retired, and every consumer migrates.
- **Order (load-bearing):** provision (idempotent) → push secrets → build → **migrate** (the blueprint's migration command against the target database, with the run's output kept) → deploy worker(s) → publish SPA → attach domains → health check (`MonitoringService.watchDeployedBackend`, reused) → release row. A failed migration stops the deploy, and the previous release keeps serving.
- **Releases and rollback** extend `site_releases` to carry the worker version id (Cloudflare keeps versions; rollback = redeploy that version). The SPA rollback already exists.
- **Preview environments:** each PR gets a preview deployment + Neon branch, torn down on merge/close. This reuses ledger `destroy`.

### W7: Marketplace (repo-connected, own-auth, mobile)

- **Project-sourced listings.** `resolveListingTarget` accepts `source: { projectId }` as well as `{ sessionId, objectId }`. The snapshot for a project listing is its **release** (the immutable, deployed version), which keeps the "editing never changes what a buyer paid for" invariant. An existing project can be attached as a board's `app` link (`link_kind='app'`); `convertSessionToApp` gains an "adopt project" path instead of always creating one.
- **Launch `external`:** a new `LISTING_LAUNCH_MODES` value. It opens the app's own origin in a new tab (never the sandboxed frame), for apps with their own auth. The sandboxed `open` stays the default for Builderforce-hosted `site_users` apps. Entitlement for a paid external app goes through a signed launch token that the app verifies (a tiny SDK), or listing access with no gate for free apps.
- **Mobile kind:** `mobile-app`, from `['project', 'build']`, launch `install`. It adds deliveries `app-store`, `play-store`, `testflight`, `apk`, `expo-update` (an `exp://u.expo.dev/…` QR) and `pwa`. It is fed by:
  - **EAS**: a generated `eas.json` + GitHub Action (`eas build` / `eas update`, `EXPO_TOKEN` pushed by W4 secrets) that reports artifact URLs back through the existing OIDC deploy callback;
  - **Capacitor**: the existing `capacitorWorkflows.ts` outputs.
- The contract stays data-driven: a new kind is one registry entry plus `marketplaceCreations.kind.mobileApp` in 5 locales, plus one `LaunchStage` branch per *new launch verb* (`external`, `install` for mobile).

### W8: Company → project in one step

`POST /api/projects` accepts an optional `companyId`, validated in the same use case as `linkProjectToCompany` (both sides in the tenant). The company workspace gets "New project" alongside "Attach". An MCP `projects.create` gains `companyId`. This is one path, not a second writer of `company_id`.

### W9: Browser run tier (full-stack apps on our WebContainers runtime)

*Added 2026-11-17, from the "Full-Stack Multi-Service Architecture" design review. W1 runs the app in a cloud container. W9 runs the **same blueprint** in the user's browser on `@seanhogg/builderforce-webcontainers`: frontend, API and a Postgres database, with no container, no server and no per-hour cost.*

**Why.** The run loop is the highest-leverage workstream, but the container tier has a live image blocker, a per-tenant cap of 2, and a cost per preview-hour (§6). Most apps users build on the canvas are JS/TS frontends with a Node API and Postgres. The browser runtime already runs those pieces separately:
- one Web Worker per process;
- `runtime.run()` / `RuntimeProcess`;
- virtual HTTP ports with in-runtime localhost routing;
- streaming responses, WebSockets and cookies;
- relay-origin isolation;
- `npm`/`pnpm`/`yarn` installs, Next.js and SvelteKit dev servers, and WASI.

What is missing is *the application*: starting several services as one app, connecting them, and giving them a database. W9 adds that.

**One flow, two targets.** The run loop gets a `RunTarget` port with adapters `browser` (W9) and `container` (W1). Both read the same `AppBlueprint`, feed the same `LivePreviewPanel`, and back the same `runtime.*` MCP tools. The target is chosen from the blueprint, never a user branch:
- **Browser:** every service's runtime accepts the project, and the database engine is Postgres-compatible.
- **Container:** anything the browser runtime declines with a reason (`wrangler dev` / Miniflare, Docker, native-only addons, Nuxt). The decline reason is shown, never a half-broken preview.

**Free tenants get the browser tier.** It costs Builderforce nothing to run. It is the free-plan answer to "run + see it". The container tier stays `containerRuntime`-entitled (D7).

**Design decisions** (review outcome; ✅ = adopted as proposed, ✏️ = changed):

| # | Proposal | Decision |
|---|---|---|
| 1 | ✅ Build orchestration **on top of** the existing process manager; don't replace the runtime, and don't emulate Docker or Linux. | Adopted. The goal is the developer experience: services, discovery, HTTP, a database, logs, persistence, coordinated start and stop. |
| 2 | ✏️ A new `builderforce.app.json` manifest. | **Rejected as a second source of truth.** The manifest *is* `AppBlueprint` (W2), with the repo-root `builderforce.json` override that already exists. W9 adds what the blueprint lacks: per-service `dependsOn`, `readiness`, `restartPolicy`, and a database `provider` (`pglite` in the browser, a Neon branch in the container). The webcontainers package stays independent of Builderforce: it takes a plain `ApplicationSpec` input. The Builderforce adapter maps blueprint → spec. A standalone user passes the spec, or the runtime reads the `services` section of `builderforce.json`. |
| 3 | ✏️ Project discovery in the runtime (package.json, csproj, Cargo.toml…). | **Not a second detector.** Detection is the W2 registry. The runtime only *accepts or declines* a service (`RuntimeProvider.accepts(service) → ok \| reason`). The existing core `detectProject.ts` becomes the browser runtime's accept check for frontends. |
| 4 | ✅ Hybrid networking: ordinary HTTP frontend→API through virtual ports, and a project-scoped service map injected as env (`API_URL=http://localhost:8000`). | Adopted. It extends the existing in-runtime localhost routing. The dev-server proxy (`/api/*` → the API's virtual port) comes from the blueprint's ports. App code never sees worker ids or preview URLs. |
| 5 | ✏️ The database is reached through a custom `bfdb://` RPC client and per-language adapter packages; Postgres wire compatibility comes later. | **Reordered for Node.** An app that has to import a Builderforce client is not the user's app. PGlite runs in its own Worker behind a MessagePort RPC; that internal transport is adopted as proposed. The *app-facing* contract is a real `DATABASE_URL=postgres://…@localhost:5432/…`. Node's `net` module gains a client `createConnection` to virtual TCP ports (today it only reserves ports for get-port/detect-port), and a Postgres wire gateway (`execProtocolRaw`) sits on that port. That makes unmodified `pg`, `postgres`, Drizzle and Prisma (driver adapters) work, and it is one piece of work, not one adapter per language. The `bfdb://` client stays as a fallback only if the wire gateway fails its gate. |
| 6 | ✅ PGlite in a dedicated Worker, serialized queries with transaction-aware scheduling, and storage outside the project VFS (IndexedDB, per project + database id) with export, import, reset and restore. Not in source ZIP exports. | Adopted. The database outlives API and frontend restarts and closes only with the app. Multi-tab: one leader-elected owner per project database, other tabs proxy to it. The Worker starts in the relay frame, like process workers since 2026.10.3, so data never splits across origins. Preview code can reach only HTTP, never the database port. |
| 7 | ✅ Shared, copy-on-read VFS with a change journal before more processes. | Adopted, and moved **first**. Every process gets a full filesystem snapshot today (webcontainers ROADMAP item 18), and Next's first page takes about 20–35 s. A three-service app multiplies that cost. |
| 8 | ✅ Python, PHP, Rust and .NET runtimes. | **Committed (D8).** They come after the Node path is proven (phases 1–4), because they reuse its pieces: the service graph, the virtual TCP sockets and the Postgres wire gateway. Each runtime is a `RuntimeProvider` adapter: one registry entry, not a branch in the orchestrator. Each declares the project profiles it supports and declines the rest with a reason. |
| 9 | ✅ Lifecycle state machine (discovered → preparing → starting → ready → running → stopping/stopped, failed), readiness before dependents start, and restart policy per service. A failed API does not kill the frontend. | Adopted. Readiness means: database = accepts a query; API = health URL answers; frontend = port open. |
| 10 | ✏️ Module layout of `application-manager.ts`, `startup-manager.ts`, `health-manager.ts`… | **Use cases, not managers** (no-god-class rule): `startApplication`, `stopApplication`, `restartService`, `serviceGraph`, `readiness`, `serviceEnv`, `databaseHost`, `pgGateway`. They live in the existing `core` / `browser` packages, exposed as a new `./app` subpath (like `./ml`) so preview-only consumers never load them. `startPreviewRuntime()` is unchanged. `startApplicationRuntime(spec)` is the new entry. |

**Public contract** (`@seanhogg/builderforce-webcontainers/app`):
- `startApplicationRuntime(spec)` returns an app object:
  - `start()`, `stop()` and `restart(serviceId)`;
  - `getService(id)` and `getUrl(serviceId)`;
  - `logs(serviceId?)`, a `ReadableStream`;
  - `onStateChange(cb)` and `onError(cb)`;
  - `database(id)`, which returns `export()`, `import(blob)` and `reset()`.
- Builderforce's `lib/browserRuntime/factory.ts` gains the browser `RunTarget` adapter. It maps `AppBlueprint` → `ApplicationSpec` and runs the blueprint's `migrationCommand` / `seedCommand` against the browser database before the API starts.

**Phases** (each ships on its own, and each has an automated exit test, not a demo):

| Phase | Contents | Exit condition |
|---|---|---|
| 0 | Baseline: reuse the webcontainers Phase-0 harness. Measure process start-up and snapshot cost, virtual HTTP and WebSocket latency, and concurrent Node processes. | Numbers recorded. The existing suite is the regression gate. |
| 1 | Shared copy-on-read VFS with a change journal. Process start-up no longer copies the project. | Spawn cost is flat in project size. Next first-page time is measured against Phase 0. |
| 2 | `ApplicationSpec`, the service graph, the lifecycle, readiness, per-service env and logs, `startApplicationRuntime`. | A Node frontend and a Node API start, stop and restart as independent services. |
| 3 | Service networking: the project-scoped service map, the dev-server `/api` proxy, and connection cleanup when a service stops. | The frontend calls the API with relative `fetch('/api/…')`. Streaming and WebSocket regression tests pass. |
| 4 | Database: the PGlite Worker, IndexedDB persistence, `net.createConnection` to virtual TCP ports, the Postgres wire gateway, blueprint migrations, export/import/reset, and the multi-tab leader. | An **unmodified** Express + `pg` (and Drizzle) API does CRUD with transactions and rollback. Data survives API restart, frontend restart and page reload. Two projects stay isolated. |
| 5 | Builderforce wiring: the `RunTarget` port, the blueprint → spec mapping, `LivePreviewPanel` reading either target, and the `runtime.*` tools routed by target. | A canvas app with a Vite frontend, an Express API and Postgres runs in the panel on a free tenant. An agent edit hot-reloads it. The agent's `preview_screenshot` sees it. |
| 6a | **Python** (Pyodide in a process Worker): ASGI/WSGI apps such as FastAPI or Flask, served request-driven from the API's virtual port (no real socket bind). `micropip` installs pure-Python and Pyodide-built wheels. Python's `socket` maps to virtual TCP, so pure-Python `pg8000` reaches the wire gateway. | A FastAPI app does CRUD against the shared database, and the frontend calls it through `/api`. |
| 6b | **PHP** (php-wasm): request-driven server adapter. PDO `pgsql` is built into the PHP Wasm image, with PHP's socket layer bridged to virtual TCP. Composer installs pure-PHP packages. | A Slim or Laravel-lite app does CRUD against the shared database. |
| 6c | **.NET** (the Mono `browser-wasm` runtime, with Roslyn compiled to Wasm for in-browser builds): ASP.NET Core minimal APIs hosted through an in-memory server adapter, because Kestrel can't bind sockets. `Npgsql`'s stream is bridged to virtual TCP. | A minimal-API service builds in the browser and does CRUD against the shared database. |
| 6d | **Rust**: `wasm32-wasip1` / `wasip2` binaries run on the existing WASI host. HTTP goes through a `wasi:http`-style request handler; database access uses `tokio-postgres` over a WASI socket bridge to virtual TCP. Compiling in the browser is a separate gate. Until it passes, Rust services arrive prebuilt from the container/CI build (W6). | A prebuilt axum-on-WASI service does CRUD. A gate result is recorded for in-browser `rustc`. |
| 7 | **Python training on WebGPU** (see below). | A LoRA fine-tune written in PyTorch-style Python runs in the WebContainer with its math on WebGPU, writes an adapter, and the adapter loads in the existing inference path. |

**Python training on WebGPU (phase 7).** The goal is training code a user writes in Python, in PyTorch style, that runs inside the WebContainer while the heavy math runs on the GPU.

*Constraints that shape the design:*
- PyTorch itself has no WebAssembly build and cannot run in Pyodide.
- WebGPU runs in dedicated workers.
- The runtime refuses to require SharedArrayBuffer.

*The design:*
- **ONE WebGPU tensor engine.** `@webdit/torch`, the PyTorch-style TypeScript tensor library (CPU-only today), gains a WebGPU backend and reverse-mode autograd. The WGSL kernels that already exist in `frontend/src/lib/webgpu-trainer.ts` move into it: LoRA forward, the chain-rule backward and AdamW. **They are not copied.** The engine owns:
  - GPU-resident tensors and the kernel registry (matmul, softmax, layernorm, the attention blocks, cross-entropy and AdamW, each a WGSL kernel entry);
  - buffer pooling;
  - mixed fp16/fp32 where `shader-f16` is available.
- **A `torch` module for Python.** It is a Pyodide package whose objects are thin handles to engine tensors, through Pyodide's JS FFI in the same Worker. Tensor data never crosses into the Python heap: Python orchestrates and the GPU computes.
  - **Supported surface:** `torch.tensor` / `zeros` / `randn`, the ops above, `.backward()`, `torch.no_grad()`, `nn.Linear` / `Embedding` / `LayerNorm` / `Module`, `optim.AdamW`, `save` / `load` (safetensors) and a `peft`-style `LoraConfig`.
  - **Outside that surface:** a clear error naming the op, never a silent CPU fallback.
- **Async readback without SharedArrayBuffer.** Kernel enqueues are synchronous WebGPU calls. Only readback (`.item()`, `.numpy()`, `.tolist()`) waits on `mapAsync`. That wait is bridged with JSPI where the browser has it, or otherwise with an awaitable `item_async()` in an `asyncio` training loop. Losses are logged every N steps so the loop isn't stalled reading back every step.
- **Scope that fits a browser:** LoRA / QLoRA fine-tunes of small causal LMs.
  - **Weights:** the frozen base loads quantized (4/8-bit) through the `./ml` model cache. Only the adapter weights and their optimizer state are trainable and in fp32.
  - **VRAM budget:** set by `createMemoryManager` (the same budget primitive Studio uses), so a run that cannot fit declines before it starts.
  - **Out of scope:** full-parameter training of multi-billion-parameter models, which goes to the container or cloud tier.
- **Training is a service kind.** A blueprint service `kind: 'training'` runs a Python entry point under the application runtime:
  - logs, loss and step metrics stream through `logs()`;
  - checkpoints go to project storage outside the VFS, like the database;
  - stopping the app checkpoints first, then stops.
  - The output adapter is the artifact that the existing local-inference path loads (`BrowserLoRAArtifact`).
- **This closes PRD 22 §3.2.** `AITrainingPanel`'s `WebGPUTrainer` migrates onto the same engine, running in a worker instead of on the interaction thread. There are then two front ends (the panel, and Python) and one engine.

*Phase 7 exit tests:*
- Gradients match a CPU reference (`@webdit/torch`'s CPU backend) within tolerance for every kernel.
- A LoRA run on a small model reduces loss on a fixed dataset, deterministically under a fixed seed.
- The run's VRAM stays within the manager's budget.
- Interaction-thread long tasks stay at zero during training.
- The adapter round-trips: train in Python, then generate with the adapter loaded.

**Acceptance (W9).** A developer opens one project and presses Run, and:
1. The blueprint resolves to the browser target.
2. PGlite starts and the migrations apply.
3. The API starts once the database is ready.
4. The frontend starts and calls the API through relative URLs.
5. The app renders in `LivePreviewPanel`.

Then they edit a component, edit API logic and restart the API. The database rows are intact, nothing reinstalls, and a page reload restores the data.

**Engineering targets (to be re-based on Phase 0 numbers):**
- Each added service starts in under 500 ms beyond its own boot.
- A warm database starts in under 1 s.
- A small API→database query round trip takes under 10 ms.
- Cooperative shutdown takes under 1 s.
- No database or runtime work runs on the main thread.
- There are zero regressions in the existing suite: `run()`, `bfsh`, installs, Vite/React/Vue/Svelte/Next, HTTP/WS/streaming, cookies, relay mode, ZIP export/import and WASI.
- Durability defaults to normal flush. Relaxed durability is opt-in, and its data-loss trade-off is documented.

### MCP tool surface (§4.7, spans W1–W8)

Each tool below is added to `builtinMcpService.ts` catalogs, grouped as data, not a new catalog file per tool:

| Group | Tools |
|---|---|
| `app_blueprint.*` | `detect`, `get` (overrides: repo-root `builderforce.json`, applied on detect) |
| `runtime.*` | `start_preview`, `preview_status`, `preview_url`, `preview_logs`, `preview_restart`, `preview_screenshot`, `run_verify`. The same tools serve both run targets (W9). `preview_status` reports which target ran and why. |
| `cloud_accounts.*` | `list`, `capabilities` (connect stays a human OAuth/token step) |
| `infra.*` | `plan`, `apply` (confirm-gated), `destroy` (confirm-gated), `list_resources`, `drift` |
| `secrets.*` | `list_names`, `missing`, `set` (value in, never out), `push` |
| `deploy.*` | `build`, `migrate`, `release`, `rollback`, `status` |
| `domains.*` | `claim`, `verify`, `status` |
| `marketplace.*` | `publish_project`, `publish_mobile`, `unpublish` |
| `projects.create` | + `companyId` |

---

## 5. Sequencing and blockers

| Phase | Contents | Real blocker |
|---|---|---|
| **1** | W1 (run loop) + W2 (blueprint) + W8 | Container image deploy + D6. Everything else is code. |
| **1b** | W9 phases 0–4 (browser runtime: shared VFS, application runtime, service networking, PGlite + wire gateway). They run in parallel with Phase 1 because they live in the webcontainers repo. | None. All of it is code in `builderforce-webcontainers`. |
| **1c** | W9 phase 5 (the `RunTarget` port, so the browser and container targets share one panel and one tool set) | W2 blueprint landed. D7 for plan gating. |
| **1d** | W9 phase 6a–6d (Python, PHP, .NET, Rust) after phase 4. Phase 7 (Python training on WebGPU) starts with the engine work in `@webdit/torch` in parallel, because it needs only phase 6a's Pyodide host to finish. | None. It is code. Phase 7 also closes PRD 22 §3.2. |
| **2** | W3 Cloudflare + Neon connections, W4 Cloudflare + Neon adapters, W6 against the **customer's** account | None beyond a test Cloudflare account and Neon key. |
| **3** | W7 project listings + `external` launch + mobile kind (EAS) | Stripe secrets for *paid* listings (existing ROADMAP item). Free listings are not blocked. |
| **4** | W5 Builderforce-hosted (WfP + Neon per app) | D1, D3, D4. |
| **5** | W3/W4 GCP, Azure, AWS adapters | Test accounts per cloud. |

**Program acceptance, measured against hired.video (a fork, never production):**

1. Create a company, then a project under it, then connect the fork.
2. The blueprint matches the hired.video acceptance in W2.
3. The run loop works: an agent change is seen in `LivePreviewPanel`, and the PR is verified.
4. With the customer's Cloudflare + Neon connected: `infra.plan` shows 1 Worker, 3 DOs, 1 R2, 1 KV, 1 cron and 1 Neon project; `apply` succeeds; migrations run; the deploy serves on a custom domain.
5. A user signs up in hired's own auth (passkey + Google OAuth work, because it is hired's own origin).
6. The project is listed in the marketplace and launches in a new tab. An Expo sample app is listed with an `expo-update` QR that opens in Expo Go.
7. The same flow runs on Builderforce-hosted compute for a PRO tenant.

---

## 6. Risks

- **Workers for Platforms feature parity with the DO + cron + WebSocket hibernation hired needs.** Verify first (Phase 4 gate).
- **Browser tier limits (W9):**
  - **PGlite is single-connection:** queries are serialized, and transactions are scheduled per connection.
  - **IndexedDB flushes add latency:** benchmark both durability modes.
  - **Browser memory caps:** each service's memory is watched, and result sets are bounded.
  - **The Worker boundary is not a security boundary** against same-origin code: relay-origin isolation and preview code that can reach HTTP only carry that.
  - **Mitigation:** an app that exceeds these limits falls back to the container target, with the reason shown.
- **Browser training limits (W9 phase 7):**
  - **Size:** VRAM caps model size, so training is limited to LoRA/QLoRA on small bases.
  - **Kernel coverage:** the `torch` surface is a subset; unsupported ops error by name.
  - **Platform support:** JSPI and `shader-f16` are not universal, so both readback bridges and an fp32 path are tested.
  - **Device loss:** a mid-run `device.lost` resumes from the last checkpoint.
- **Language runtime maturity (W9 phase 6):**
  - **Python:** Pyodide covers only pure-Python and Pyodide-built wheels; native-only packages are declined by name.
  - **PHP:** extensions must be built into the PHP Wasm image.
  - **.NET:** Kestrel can't bind sockets in `browser-wasm`, hence the in-memory host.
  - **Rust:** in-browser compilation is unproven, so services arrive prebuilt until its gate passes.
- **Container cost:** a live preview holds an instance. The existing per-tenant cap (2) and global budget (15) hold, the instance type raises cost per hour, and a run loop is `containerRuntime`-entitled.
- **Neon quota:** Builderforce's own Free-tier pressure (ROADMAP 🔴) must not absorb customer databases. Per-app Neon lives in a separate Neon org/project set, never the core/apps endpoints.
- **Secret blast radius:** the container gets secrets as env. The agent's `run_command` output is redacted, and the clone token issue (ROADMAP L242) is fixed in the same image pass (scoped git proxy).
- **Security finding in the reference app:** hired.video reflects any `Origin` with credentials (`api/src/app.ts:246`). The blueprint's security checks should flag reflected-origin CORS in customer apps, as a free diagnostic (see [[project-diagnostics-scoring]]).
