# @builderforce/qa-e2e — Agentic QA harness

Runs the **authenticated** browser smoke suite for the Builderforce web app and
reports results back to the API. It is the execution surface of the Agentic QA
pipeline:

```
capture (frontend)  →  aggregate + generate (api: /api/qa/*)  →  THIS HARNESS (CI)  →  results (api → Observability ▸ Agentic QA)
```

## How it works

1. **`global-setup.ts`** logs into the auth API as the QA user, selects a
   workspace, and writes `.auth/state.json` with the tokens in both
   `localStorage` (the SPA) and cookies (Next.js middleware). Every spec then
   runs already-authenticated — no spec ever scripts the login form.
2. **`src/pull-tests.ts`** fetches `status=active` specs from `/api/qa/tests`
   and writes them to `tests/generated/<slug>.spec.ts`.
3. **`playwright test`** runs `tests/smoke.spec.ts` (static baseline) plus every
   generated spec, against `BF_BASE_URL`.
4. **`src/report.ts`** parses `results.json` and POSTs one run per spec to
   `/api/qa/runs`, attributing each to its `qa_tests` row by slug.

## Local run

```bash
cp .env.example .env   # fill in BF_QA_EMAIL / BF_QA_PASSWORD
npm install
npx playwright install chromium
npm run ci             # pull → test → report
```

Or step by step: `npm run pull`, `npm test`, `npm run report`.

## Configuration

See `.env.example`. The QA account must be a dedicated, **non-MFA** user in a QA
workspace with seeded data — never a real customer account.

## CI

`.github/workflows/qa.yml` runs this on a schedule and on demand. Provide
`BF_QA_EMAIL`, `BF_QA_PASSWORD` (and optionally `BF_BASE_URL`, `BF_API_URL`,
`BF_QA_TENANT_ID`) as repository secrets.
