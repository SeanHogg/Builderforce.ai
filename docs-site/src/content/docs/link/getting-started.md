---
title: Getting Started
description: Set up Builderforce locally and deploy to Cloudflare in ~20 minutes
---

# Getting Started with Builderforce

**Builderforce** is the AI-native orchestration portal for [CoderClaw](https://coderclaw.ai). This guide walks you from zero to a running local dev environment — including the API, frontend, and database.

**Time to complete:** ~20 minutes

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and Install](#2-clone-and-install)
3. [Provision a Postgres Database](#3-provision-a-postgres-database)
4. [Configure Cloudflare Workers](#4-configure-cloudflare-workers)
5. [Run Database Migrations](#5-run-database-migrations)
6. [Start Local Development](#6-start-local-development)
7. [Register Your First User](#7-register-your-first-user)
8. [Register Your First Claw](#8-register-your-first-claw)
9. [Deploy to Production](#9-deploy-to-production)
10. [Self-Hosted with Docker](#10-self-hosted-with-docker)
11. [Next Steps](#next-steps)

---

## 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Wrangler CLI | ≥ 3 | `npm i -g wrangler` |
| Git | any | [git-scm.com](https://git-scm.com) |

You also need:
- A **Cloudflare account** (free tier works)
- A **Postgres database** accessible from the internet (we recommend [Neon](https://neon.tech) — generous free tier, serverless)

---

## 2. Clone and Install

```bash
git clone https://github.com/SeanHogg/builderforce.ai.git
cd builderforce.ai
pnpm install
```

This installs both the `api` and `app` packages in the pnpm workspace.

---

## 3. Provision a Postgres Database

### Option A — Neon (recommended)

```bash
# Install the Neon CLI
npm install -g neonctl

# Authenticate
neonctl auth

# Create a project
neonctl projects create --name builderforce.ai

# Get your connection string
neonctl connection-string --project-id <your-project-id>
```

Copy the connection string — you'll use it in the next two steps.

### Option B — Supabase

Create a project at [supabase.com](https://supabase.com), navigate to **Settings → Database**, and copy the **Connection string (URI)** under the "Transaction mode" pooler (port 6543).

### Option C — Any Postgres

Any internet-accessible Postgres 14+ instance works. Ensure your connection string looks like:

```
postgresql://user:password@host:5432/dbname?sslmode=require
```

---

## 4. Configure Cloudflare Workers

### Authenticate Wrangler

```bash
wrangler login
```

### Create a Hyperdrive binding (Cloudflare-managed connection pool)

```bash
wrangler hyperdrive create builderforce.ai-db \
  --connection-string="postgresql://user:password@host/db"
```

Copy the `id` from the output and paste it into `api/wrangler.toml`:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<your-hyperdrive-id>"
```

### Set secrets

```bash
# JWT signing key — generate a strong random string
wrangler secret put JWT_SECRET

# Comma-separated list of allowed CORS origins
wrangler secret put CORS_ORIGINS
# e.g.: https://builderforce.ai,http://localhost:5173
```

### Copy the environment example

```bash
cp api/.env.example api/.env
# Edit api/.env and set DATABASE_URL to your Postgres connection string
```

---

## 5. Run Database Migrations

Migrations are tracked in a `_migrations` table and applied automatically on deploy. To run them manually:

```bash
DATABASE_URL=postgresql://... pnpm db:migrate
```

Or, if you have `DATABASE_URL` set in `api/.env`:

```bash
pnpm db:migrate
```

---

## 6. Start Local Development

Run each of these in a separate terminal:

```bash
# Terminal 1 — API Worker (http://localhost:8787)
pnpm dev:api

# Terminal 2 — App Worker (http://localhost:8788)
pnpm dev:app

# Terminal 3 — Vite dev server with hot-reload (http://localhost:5173)
pnpm --filter app dev:ui
```

> For most UI work you only need terminals 1 and 3. The Vite dev server proxies `/api` requests to port 8787.

Open **http://localhost:5173** in your browser to see the portal.

---

## 7. Register Your First User

```bash
curl -s -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}' | jq .
```

The response contains a one-time `apiKey`. Exchange it for a JWT:

```bash
curl -s -X POST http://localhost:8787/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"<your-api-key>"}' | jq .
```

Store the `token` — include it in all subsequent requests as `Authorization: Bearer <token>`.

---

## 8. Register Your First Claw

A **Claw** is a registered coderClaw agent instance. First, create a tenant:

```bash
curl -s -X POST http://localhost:8787/api/tenants \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Team"}' | jq .
```

Then register a Claw within that tenant:

```bash
curl -s -X POST http://localhost:8787/api/claws \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-claw","tenantId":<tenant-id>}' | jq .
```

The response includes a `apiKey` for the Claw — configure your coderClaw runtime with:

```bash
# In your coderClaw project
coderclaw config set portal.url http://localhost:8787
coderclaw config set portal.clawId <claw-id>
coderclaw config set portal.apiKey <claw-api-key>
```

---

## 9. Deploy to Production

### Bump the version

Update `"version"` in the root, `api/`, and `app/` `package.json` files to today's date (`YYYY.M.D`).

### Deploy the API

```bash
# Runs pending migrations, then deploys the Worker
pnpm --filter api run deploy
```

### Deploy the App

```bash
# Builds the Vite SPA, then deploys the static asset Worker
pnpm --filter app run deploy
```

### Deployment checklist

- [ ] Version bumped in root, `api/`, and `app/` `package.json`
- [ ] `pnpm --filter app build` passes with no errors
- [ ] `api/.env` has a valid `DATABASE_URL` (for migration runner)
- [ ] `wrangler whoami` shows the correct account
- [ ] Hyperdrive binding ID is set in `api/wrangler.toml`
- [ ] `JWT_SECRET` and `CORS_ORIGINS` secrets are set in Cloudflare

---

## 10. Self-Hosted with Docker

For environments that cannot use Cloudflare Workers (air-gapped, on-premises), use the included Docker setup:

```bash
# Copy and edit the environment file
cp api/.env.example api/.env
# Set DATABASE_URL in api/.env

# Start the API in development mode
docker-compose --profile dev up

# Run migrations only
docker-compose --profile migrate up

# Deploy (build + start)
docker-compose --profile deploy up
```

The `docker-compose.yml` supports three profiles: `dev`, `deploy`, and `migrate`. The `Dockerfile` is multi-stage (`base → dev / deploy / migrate`).

---

## Next Steps

| Topic | Document |
|-------|----------|
| Full API endpoint reference | [API Reference](/link/api-reference/) |
| Architecture deep-dive | [Architecture](/link/architecture/) |
| Skills Marketplace | [Marketplace](/link/marketplace/) |
| Multi-agent orchestration | [Multi-Agent Orchestration](/link/multi-agent-orchestration/) |
| Pricing and plans | [Pricing](/link/pricing/) |
| Go-to-market strategy | [Go-to-Market](/link/go-to-market/) |
| CoderClaw core agent | [github.com/SeanHogg/coderClaw](https://github.com/SeanHogg/coderClaw) |
| Discord community | [discord.gg/qkhbAGHRBT](https://discord.gg/qkhbAGHRBT)
