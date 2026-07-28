# Contributing to Builderforce.ai

## Quick Links

- **GitHub:** https://github.com/SeanHogg/Builderforce.ai
- **Documentation:** [builderforce.ai/docs](https://builderforce.ai/docs) — Builderforce.ai core docs. For the orchestration/API layer (auth, tenants, projects, tasks, agents, runtime, marketplace) that Builderforce.ai’s API follows, see [builderforce.ai/docs/link/](https://builderforce.ai/docs/link/) (getting started, architecture, API reference, multi-agent, pricing).
- **Cloudflare Workers documentation:** https://developers.cloudflare.com/workers/
- **Discord:** https://discord.gg/qkhbAGHRBT (use #setup-help for questions)

---

## Prerequisites

Before diving in you should have the following installed and configured:

- **Node.js 18+** (the runtime used by the worker and the frontend)
- **pnpm 8+** (or npm/yarn; the examples below use pnpm)
- **[Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)** authenticated (`wrangler login` or `wrangler whoami`) – this repo is built around two Cloudflare workers and most workflows run `wrangler dev`/`wrangler deploy`.
- A **Cloudflare account** with R2, Workers AI, and Durable Objects enabled.
- A **Neon (or other Postgres)** project – the database connection string will be stored as a Wrangler secret.

> ⚠️ many of the tasks below assume you have the worker CLI available; if `wrangler` is not on your path the local development commands will fail.

---

## Development setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/SeanHogg/Builderforce.ai
cd Builderforce.ai

# frontend
cd frontend && npm install

# worker
cd ../worker && npm install
```

Local development involves two processes (run them in separate terminals):

```bash
# 1. Worker (http://localhost:8787)
cd worker && npm run dev          # invokes `wrangler dev`

# 2. Frontend (http://localhost:3000)
cd frontend && npm run dev
```

You can also deploy the worker at any time with:

```bash
cd worker && npm run deploy      # this runs migrations then wrangler deploy
```

and build the frontend for production with `cd frontend && npm run build`.


### Wizard checklist for markdown releases / PRs

Before opening a pull request make sure:

- [ ] Tests still pass (`pnpm test` at the root, or run the appropriate script).
- [ ] The worker builds cleanly (`pnpm --filter worker build` or `wrangler dev` doesn’t throw).
- [ ] You have run the migration script locally if you changed schema.
- [ ] Wrangler is logged in (`wrangler whoami`).

More generally, keep PRs focused on a single concern, describe what changed and why, and do not mix unrelated cleanup.

---

## Releasing / Deploying

Versions are simple date‑based strings (e.g. `2026.3.7`). Before deploying bump `version` in both `frontend/package.json` and `worker/package.json`.

1. Make sure `worker/.env` (never committed) contains a valid `DATABASE_URL` – migrations run automatically when you deploy the worker.  You can set it with:

    ```bash
    wrangler secret put NEON_DATABASE_URL
    wrangler secret put NEON_TRANSACTIONAL_DATABASE_URL
    ```

2. Authenticate Wrangler (`wrangler whoami` should return your account).

3. Deploy the worker:

    ```bash
    cd worker && pnpm run deploy   # migrations + wrangler deploy
    ```

4. Build & deploy the frontend as SSR (Cloudflare Workers):
     - **SSR Next.js requires Cloudflare Workers, not Pages.**
     - **Next.js version must be <= 15.5.2 for Cloudflare compatibility.**
    - Production domains should be assigned explicitly: `builderforce.ai` and `www.builderforce.ai` → frontend, `api.builderforce.ai` → API, `worker.builderforce.ai` → worker.
     - Use the provided Dockerfile to build and deploy from a Linux container:
         ```bash
         docker build -t builderforce-frontend .
         docker run -it --rm -v ~/.wrangler:/root/.wrangler builderforce-frontend
         ```
     - If you see build errors about `generateStaticParams()`, you must add it to all dynamic routes (e.g., `/projects/[id]`) or refactor for SSR.
     - For SSR deployment, ensure your API endpoints and environment variables are set correctly.

     **Frontend build instructions:**
     - Always run the build from the `frontend` directory:
         ```bash
         cd frontend
         npx next build
         ```
     - If you see workspace root warnings from Next.js, add this to `next.config.js`:
         ```js
         module.exports = {
             turbopack: {
                 root: __dirname,
             },
             // ...existing config
         }
         ```
     - Make sure your `src/app/` directory exists and contains your main app files.
    - After building, deploy the output with Wrangler so the custom domain stays attached to the frontend worker.

     **Troubleshooting:**
     - If Next.js reports missing `pages` or `app` directory, check that you are in the correct directory and that `src/app/` exists.
     - Remove any unnecessary lockfiles from the workspace root if you encounter root confusion.


## Cross-component contracts

Read this before adding a test. It is the most expensive lesson this codebase has learned, and it was learned eight times.

Every serious production defect here — an empty sign-off ledger (0 rows against 1,030 reviewer runs), 405 stalled tickets, then 447, a billable-run cap that spent 7 against 3, a per-tenant ceiling that allowed 43 against 25 — has been the **same shape**: a contract between two components, where every existing test asserted one component in isolation. At the time of the last one there were 3,956 passing tests and not one of them crossed a seam. Coverage was never the problem.

### 1. When two components answer the same question, one of them must not exist

A GUARD that validates an action and a SELECTOR that chooses one are answering the same question from opposite ends. If both derive the answer, they will diverge — not might. The three role-capability instances were each "fixed" by widening whichever side was narrower, which closes the instance and leaves the seam, so it reopened twice.

Extract ONE function, make both sides call it, and delete the other implementation. `roleCandidatesFrom` in `api/src/application/kanban/roleCapability.ts` is the worked example: the guard asks whether one ref is in its answer, the selector takes the head of it, and narrowing one necessarily narrows the other.

If you genuinely cannot merge them, write a test that asserts they **agree over the whole domain** — every role in the catalog, every remedy in the set — not over a chosen handful. The handful is how the eighth case slips through while the other seven are checked individually.

### 2. A shared parameter that can be omitted will be omitted

`LaneAuthorityInputs.roster` is required rather than optional, and callers that deliberately do not bind pass `EMPTY_ROLE_ROSTER` with a comment saying why. An optional parameter lets a new call site silently inherit the old narrow behaviour: the omission is invisible at the call site and surfaces weeks later as a stalled board. Make the compiler ask the question.

### 3. Push a refusal DOWN into the thing that spends; never assert about it afterwards

The triage stage decided `coordinate` "costs no run" and passed `mayStartRun: false`, and `coordinate` started a run anyway because nothing carried the refusal into `coordinateTicket`. Likewise the manager sweep reconciled its spend against the tenant ceiling *after* the pass, discarding every refusal because the runs had already happened.

If a caller decides something may not happen, that decision must reach the code that would do it — as a parameter it cannot ignore, or as a primitive whose only spending verb enforces the order (`DispatchReserver.spend` reserves before it dispatches, by construction). A rule that must be remembered at each of N sites is forgotten at the N+1th. Enforced by `api/scripts/check-dispatch-budget.mjs`.

### 4. Classify by what code DOES, not by what it is meant to cost

`coordinate` was categorised as non-dispatching because that was its intent. Nothing checked. Before you put a function in a bucket, follow it to its leaves.

### 5. Pin a defect you are not fixing — never park it

`it.fails` states the invariant, keeps the suite green while the defect is open, and turns it RED the moment someone fixes it. That is strictly better than deleting the test or writing a comment. It is also a failing assertion that CI reports as success, so: every `it.fails` must be named in ROADMAP.md's Consolidated Gap Register, and fixing it flips the test to a plain `it` and moves the entry to `DONE.md`. Both directions are enforced by `api/scripts/check-pinned-defects.mjs`.

### 6. Verify a new test by breaking the code

A test that passes tells you nothing until you have seen it fail for the reason you intended. Revert the fix (or mutate the condition), confirm the failure message names *your* assertion rather than an earlier line, then restore. Several tests here passed for years while asserting the wrong half of the behaviour — `applied` when the invariant was about `attempted`.

### 7. Keep the counter-example executable

`tickDispatchBudget.contract.test.ts` still contains the broken accounting pattern and asserts that it produces exactly 43 and 38 against a ceiling of 25. "We fixed it" should be a measurement, not a claim, and the next person to read the module learns what the rule is *for*.

## How to contribute

1. **Bugs / small fixes** – open a PR directly.
2. **New features or architecture changes** – start a GitHub Discussion or ask on Discord first.
3. **Questions** – ask in Discord `#setup-help`.

Thanks for helping make Builderforce.ai better!  Your contributions are welcome regardless of size or skill level; just be sure to read this document and run the tests before submitting a PR.
