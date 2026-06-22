# @builderforce/qa-e2e — Agentic Tester runner

The **execution surface** (browser runner) for the Agentic Tester agent. The
product — config, scheduling, results — lives in the platform; this image is the
managed Cloudflare Container the platform dispatches to drain the queue:

```
capture (frontend) → heatmap + schedule (api: /api/qa/*) → dispatch (QaRunnerContainerDO) → THIS RUNNER → findings (api → Observability ▸ Agentic QA)
```

## Two modes

The harness always logs in as an **operator** account (`BF_QA_EMAIL` /
`BF_QA_PASSWORD`) to read QA config + secrets from the API. What it then tests
depends on `BF_PROJECT_ID`:

### Self-test (no `BF_PROJECT_ID`) — test the Builderforce app itself

1. **`global-setup.ts`** logs into the auth API and writes `.auth/state.json`
   with the operator tokens in both `localStorage` and cookies. Every spec runs
   already-authenticated.
2. **`pull-tests.ts`** fetches `status=active` specs and writes them to
   `tests/generated/<slug>.spec.ts`.
3. **`playwright test`** runs `tests/smoke.spec.ts` (baseline) + the generated
   specs against `BF_BASE_URL`.
4. **`report.ts`** POSTs one run per spec to `/api/qa/runs`.

### Project (`BF_PROJECT_ID=<id>`) — test a customer project's site

1. **`pull-tests.ts`** calls `GET /api/qa/projects/:id/runner-bundle` → the
   project's **target URL**, its **active per-persona tests**, and the redacted
   **credential library**. It writes the target URL to `.auth/config.json`.
2. For each persona a test needs, it fetches the decrypted secret
   (`GET /api/qa/credentials/:id/secret`) and **`persona-login.ts`** drives the
   site's own login form, saving one `storageState` per persona
   (`.auth/cred-<id>.json`).
3. Each generated spec gets a `test.use({ storageState })` injected so it runs
   **as its assigned persona**. (The static `smoke.spec.ts` is skipped.)
4. **`report.ts`** attributes each run to its project + persona via
   `.auth/tests.json` and POSTs to `/api/qa/runs`.

> Configure targets + personas in the app: **Observability ▸ Agentic QA**, pick
> the project, add a Target (root URL) and Credentials (logins). Passwords are
> AES-GCM encrypted at rest; the harness retrieves them over TLS only to type
> into the site's login form (arbitrary sites have no token API to inject).

## Local run

```bash
cp .env.example .env   # fill in BF_QA_EMAIL / BF_QA_PASSWORD (+ BF_PROJECT_ID for project mode)
npm install
npx playwright install chromium
npm run ci             # pull → test → report
```

Or step by step: `npm run pull`, `npm test`, `npm run report`.

## Configuration

See `.env.example`. The **operator** account (`BF_QA_EMAIL`/`BF_QA_PASSWORD`)
must be a dedicated, **non-MFA** Builderforce user — never a real customer
account. In project mode, the site logins are the project's **Credentials**
(personas), managed in-app, not env vars.

## How it's run in production (no CI)

This is **not** a GitHub Action. The platform owns the lifecycle:

- **Schedule** — a per-project `qa_schedules` row (configured in Observability ▸
  Agentic QA) is swept by the API's `*/5` cron (`runQaExplorationSweep`), which
  enqueues a `qa_explorations` row.
- **Dispatch** — the sweep (and the "Run" button) call `dispatchQaRunner`, which
  mints a short-lived tenant token and proxies `POST /run` to
  `QaRunnerContainerDO` — a managed Cloudflare Container. Its image is the
  self-contained **`api/qa-container/`** (a no-build-step Node port of this
  explorer, wired in `api/wrangler.toml` exactly like `api/container`). No human
  credentials, no CI runner.
- **Drain** — the container claims the exploration, drives the browser, and posts
  findings back to `/api/qa/*`.

This package is the **local-dev mirror**: `npm run explore` runs the same
exploration on your machine (set `BF_AGENT_TOKEN`, or operator
`BF_QA_EMAIL`/`BF_QA_PASSWORD`, in `.env`). Keep its capture logic in sync with
`api/qa-container/server.mjs`.
