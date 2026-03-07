# Contributing to Builderforce.ai

## Quick Links

- **GitHub:** https://github.com/SeanHogg/Builderforce.ai
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
    ```

2. Authenticate Wrangler (`wrangler whoami` should return your account).

3. Deploy the worker:

    ```bash
    cd worker && pnpm run deploy   # migrations + wrangler deploy
    ```

4. Build & deploy the frontend as SSR (Cloudflare Workers):
     - **SSR Next.js requires Cloudflare Workers, not Pages.**
     - **Next.js version must be <= 15.5.2 for Cloudflare compatibility.**
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
     - After building, deploy the output to your hosting provider (Cloudflare Pages, Vercel, etc.).

     **Troubleshooting:**
     - If Next.js reports missing `pages` or `app` directory, check that you are in the correct directory and that `src/app/` exists.
     - Remove any unnecessary lockfiles from the workspace root if you encounter root confusion.


## How to contribute

1. **Bugs / small fixes** – open a PR directly.
2. **New features or architecture changes** – start a GitHub Discussion or ask on Discord first.
3. **Questions** – ask in Discord `#setup-help`.

Thanks for helping make Builderforce.ai better!  Your contributions are welcome regardless of size or skill level; just be sure to read this document and run the tests before submitting a PR.
