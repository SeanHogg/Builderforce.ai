# @builderforce/qa-e2e — Agentic QA harness

Runs the **authenticated** browser smoke suite for the Builderforce web app and
reports results back to the API. It is the execution surface of the Agentic QA
pipeline:

```
capture (frontend)  →  aggregate + generate (api: /api/qa/*)  →  THIS HARNESS (CI)  →  results (api → Observability ▸ Agentic QA)
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

## CI

`.github/workflows/qa.yml` runs this on a schedule and on demand. Provide
`BF_QA_EMAIL`, `BF_QA_PASSWORD` (and optionally `BF_BASE_URL`, `BF_API_URL`,
`BF_QA_TENANT_ID`) as repository secrets.
