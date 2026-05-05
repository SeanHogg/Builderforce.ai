---
title: Pricing
description: Free / Pro / Enterprise tiers, LLM add-ons, self-hosting, and FAQ
---

# coderClaw.ai Pricing

**TL;DR** — The orchestration platform is MIT-licensed and **free to self-host forever**. Managed cloud pricing starts at $0 and scales with your team.

---

## Plans at a Glance

| Feature | **Free** | **Pro** | **Enterprise** |
|---------|----------|---------|----------------|
| **Monthly price** | $0 | $29 / seat | Custom |
| **Claws (AI agents)** | 1 | Unlimited | Unlimited |
| **Projects** | 3 | Unlimited | Unlimited |
| **Tasks** | 50 | Unlimited | Unlimited |
| **Team members** | 1 | Up to 25 | Unlimited |
| **coderClawLLM compute** | Free model pool (rate-limited) | Pro model pool (priority) | Dedicated capacity |
| **LLM requests / month** | 1,000 | 50,000 | Unlimited / SLA |
| **Chat history** | 7 days | 90 days | Unlimited |
| **Audit log retention** | 30 days | 1 year | Unlimited |
| **Approval gates** | ✅ | ✅ | ✅ |
| **Specs & Workflows** | ✅ | ✅ | ✅ |
| **Marketplace skills** | Install only | Publish + install | Private registry |
| **Full RBAC (4 roles)** | ❌ (owner only) | ✅ | ✅ |
| **MFA (TOTP)** | ✅ | ✅ | ✅ + hardware keys |
| **GDPR / CCPA tooling** | ✅ | ✅ | ✅ + DPA |
| **SSO / SAML** | ❌ | ❌ | ✅ |
| **Private skill registry** | ❌ | ❌ | ✅ |
| **Self-hosted** | ✅ MIT | ✅ MIT | ✅ + air-gap |
| **SLA** | Community (best-effort) | Business hours response | 99.9% uptime SLA |
| **Support** | Discord | Email + Discord | Dedicated CSM |

---

## Plan Details

### Free — $0 forever

The Free plan is designed for individuals, hobbyists, and teams evaluating the platform.

**What you get:**
- 1 registered Claw (AI agent)
- 3 projects, 50 tasks
- 1,000 LLM requests / month via the free model pool
- Full access to the Builderforce portal: specs, workflows, approvals, chat history (7-day window), audit log (30-day window)
- Install skills from the marketplace
- TOTP MFA and GDPR/CCPA self-service tools

**Limits reset** on the 1st of each calendar month (UTC).

---

### Pro — $29 / seat / month

Pro is designed for professional developers and small-to-medium teams that need unlimited agent scale and higher LLM throughput.

**Everything in Free, plus:**
- Unlimited Claws, projects, and tasks
- Up to 25 team members with full 4-role RBAC (VIEWER → DEVELOPER → MANAGER → OWNER)
- 50,000 LLM requests / month via the priority Pro model pool with automatic failover
- 90-day chat history and 1-year audit log retention
- Publish skills to the public marketplace
- Email support + Discord priority channel

**Billing note:** seats are per named user in any tenant on your account. Adding a member to a tenant counts as 1 seat.

---

### Enterprise — Custom pricing

Enterprise is designed for large engineering organisations that need compliance tooling, SSO, dedicated capacity, and contractual SLAs.

**Everything in Pro, plus:**
- Unlimited seats
- SSO / SAML integration
- Private skill registry (share skills within your org without publishing publicly)
- Dedicated coderClawLLM compute capacity with reserved throughput
- Unlimited audit log and chat history retention
- GDPR Data Processing Agreement (DPA)
- Air-gapped / on-premises deployment support
- 99.9% uptime SLA with financial penalties
- Dedicated Customer Success Manager and Slack Connect channel

Contact **sales@coderclaw.ai** to discuss Enterprise pricing.

---

## coderClawLLM Add-ons

The coderClawLLM proxy is billed separately from seat licences on the managed cloud:

| Add-on | Price | Description |
|--------|-------|-------------|
| **Extra LLM requests** (Free) | $5 / 10k requests | Top up when you hit the 1,000 req/month limit |
| **Extra LLM requests** (Pro) | $3 / 10k requests | Top up when you hit the 50,000 req/month limit |
| **Bring Your Own Key (BYOK)** | Free | Route calls through your own Anthropic / OpenAI API key; no proxy cost |

Track usage at `GET /llm/v1/usage?days=30` or in the portal under **Settings → Usage**.

---

## Self-Hosted Deployments

**Builderforce is MIT-licensed.** You can run the full platform — portal, API, relay, and database — on your own infrastructure at zero licensing cost.

Self-hosted users are responsible for:
- Cloudflare Workers account and compute costs
- Postgres database (Neon, Supabase, or self-managed)
- Any LLM API keys used by agents

The `Dockerfile` and `docker-compose.yml` in the repo support `dev`, `deploy`, and `migrate` profiles for Docker-based self-hosted deployments. See [Getting Started](/link/getting-started/) for full setup instructions.

---

## Upgrading and Downgrading

```http
# Upgrade to Pro (requires billing details in the request body)
POST /api/tenants/:id/subscription/pro

# Downgrade to Free (effective end of current billing period)
POST /api/tenants/:id/subscription/free

# Check current plan and usage
GET /api/tenants/:id/subscription
```

Downgrades take effect at the **end of the current billing period** and are non-refundable for the remainder of that period. All data is retained for 30 days after downgrade before applying Free-tier retention limits.

---

## FAQ

**Can I try Pro before paying?**
Yes — new accounts get a **14-day Pro trial** with no credit card required. Trial limits match the Pro plan.

**What happens when I hit LLM request limits?**
Requests beyond the monthly limit are queued (not dropped). You will receive a warning email at 80% usage. You can purchase add-on blocks or enable BYOK to avoid interruption.

**Do I pay per Claw or per user?**
Pro billing is **per seat (user)**, not per Claw. You can register unlimited Claws on Pro without additional seat charges.

**Is my data private if I use the managed cloud?**
Yes. All data is tenant-isolated in Postgres. coderClaw.ai staff cannot access your data without an explicit impersonation record in the audit log. See the [Privacy Policy](https://coderclaw.ai/privacy) for full details.

**Can I switch between self-hosted and managed cloud?**
Yes. Export your data at any time via the API. Migration tooling is available in the [CoderClaw CLI](https://github.com/SeanHogg/coderClaw).

**Where can I ask questions?**
[Discord](https://discord.gg/qkhbAGHRBT) · **sales@coderclaw.ai** for Enterprise · **support@coderclaw.ai** for billing issues.
