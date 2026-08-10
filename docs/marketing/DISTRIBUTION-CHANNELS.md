# Builderforce distribution channels — marketplace research

Research date: **2026-08-07**. Fees, review SLAs and program names change; re-verify
anything marked ⚠️ before committing engineering time.

> **Status**: the engineering prerequisites below are **built** — see
> [distribution/README.md](../../distribution/README.md) for what ships automatically,
> what is a prepared manual submission, and what is still blocked on a credential.
> Read this document for *why* a channel is worth it; read that one to *do* it.

Goal: get Builderforce listed in as many marketplaces as possible. The constraint is
not "which marketplaces exist" — it is **which Builderforce artifact you list where**.
Most channels only accept one shape of thing. Listing the wrong SKU is the single
biggest cause of rejection.

---

## 1. What we actually have to list (the SKU inventory)

| # | SKU | Artifact | Current state |
| --- | --- | --- | --- |
| S1 | **VS Code extension** | VSIX, `builderforce.builderforce-ai` (`clients/vscode`) | ✅ Published by CI to the VS Marketplace **and** Open VSX |
| S2 | **MCP server (memory)** | `@seanhogg/builderforce-memory-mcp` | ✅ npm + MCP Registry (`io.github.SeanHogg/builderforce-memory`) |
| S3 | **MCP server (gateway/tools)** | `POST https://api.builderforce.ai/mcp` — JSON-RPC 2.0 / Streamable HTTP, stateless | ✅ Built and listed (`server.json`) |
| S4 | **Claude Code plugin** | The `/install` combo as a generated plugin + marketplace | ✅ `builderforce-memory/plugins/` + `.claude-plugin/marketplace.json` |
| S5 | **SaaS web app** | builderforce.ai, Free/Pro, tenant-billed | Live |
| S6 | **B2B AI gateway** | API-key auth, tenant-billed HTTP API | Live |
| S7 | **npm SDKs** | `@seanhogg/builderforce-sdk`, `-brain-embedded`, `-feedback`, `-quality`, `-studio`, `-voice` | Published |
| S8 | **Cloud agent runtime** | Container image (`Dockerfile.api`, agent-runtime) | Built, not published to a registry |
| S9 | **Evermind model** | `hf-export/Evermind` | Exported; push blocked on an HF token |
| S10 | **GitHub Action** | `actions/dispatch-agent` — file a ticket and dispatch an agent from CI | ✅ Usable from this repo; Marketplace listing needs the mirror secret |

The standalone remote MCP endpoint (S3) was the highest-leverage build: it is what
Anthropic's Connectors Directory, AWS's AI Agents & Tools category, Gemini Enterprise's
registry and every MCP registry actually consume. A **published container** (S8) is the
one remaining artifact worth creating, for the AWS container path and Docker Hub.

---

## 2. Tier 0 — free, self-serve, no gatekeeper (do these first)

No review board, no partner agreement, no revenue share. Every one of these is a
same-day listing. This tier alone is ~12 marketplaces.

| Channel | List | Cost | Turnaround | Notes |
| --- | --- | --- | --- | --- |
| **VS Code Marketplace** | S1 | Free | Instant | Publisher `builderforce` already configured. 224M downloads on popular extensions vs Open VSX's 51M — this is still the volume channel. |
| **Open VSX (Eclipse)** | S1 | Free | Instant | Hit 1.0.0 in June 2026. **Required** to reach Cursor, Windsurf, VSCodium, Gitpod — MS's marketplace licence bars non-Microsoft editors, so this is not a duplicate listing, it is a different audience. Same VSIX, no code changes. |
| **npm** | S2, S7 | Free | Instant | Already done. Improve discovery: keywords, README badges, `repository` links. |
| **Official MCP Registry** (`registry.modelcontextprotocol.io`) | S2, S3 | Free | Instant | `mcp-publisher init` → `server.json` → publish. Launched preview Sept 2025; it is the upstream feed that several other directories mirror. Do this before the third-party ones. |
| **Docker MCP Catalog** | S2, S3 | Free | ~24h after PR merge | PR to `github.com/docker/mcp-registry`. Choose *Docker-built* — Docker builds, signs and hosts the image at `mcp/builderforce-*`, which also gets us a Docker Hub presence for free. |
| **Smithery.ai** | S2, S3 | Free | Self-register | Best CLI installer story; strong install-conversion. |
| **Glama.ai/mcp** | S2, S3 | Free | Self-register | Scores servers on quality — worth passing their lint. |
| **mcp.so** | S2, S3 | Free | Self-register | Largest raw index (20k+ servers). Low signal, high SEO. |
| **PulseMCP** | S2, S3 | Free | Curated | ~1,200 servers, quality-curated — being *in* it is a signal. |
| **LobeHub MCP** | S2, S3 | Free | Self-register | 56k+ servers listed. |
| **Cline MCP Marketplace** | S2, S3 | Free | Days | GitHub issue on `cline/mcp-marketplace` + a 400×400 PNG logo. Reaches Cline's install base directly. |
| **`punkpeye/awesome-mcp-servers`** | S2, S3 | Free | PR | Not a marketplace but the most-cited list; feeds the others. |
| **Claude Code plugin directories** (`claudemarketplaces.com`, `ananddtyagi/cc-marketplace`) | S4 | Free | PR/self-serve | Requires wrapping the `/install` combo as a proper `plugin.json`. Low effort, and it makes S4 installable via `/plugin install`. |
| **GitHub Marketplace — Actions** | New: a "Builderforce agent" action | Free | Instant, no review | Public repo + single `action.yml` at root. Actions are published without review. A CI action that dispatches a Builderforce cloud agent is a cheap, high-visibility listing. |
| **Hugging Face** | S9 (Evermind) | Free | Instant | Model + a Space demo. Different audience (ML/research) than every other channel here, and it is the natural home for the SSM work. |

**Effort estimate for all of Tier 0: ~1 week.** Most of it is writing one good README,
one logo set, and a `server.json`.

---

## 3. Tier 1 — free but reviewed (start early, the queues are long)

| Channel | List | Cost | Review SLA | Gate |
| --- | --- | --- | --- | --- |
| **Anthropic Connectors Directory** | S3 (remote MCP) | Free | ⚠️ weeks | Requires: service available in **all** Anthropic-supported regions (or documented restrictions), a **test account pre-populated with sample data**, ≥3 working example prompts naming our tool domain, and end-to-end setup instructions with every credential — the reviewer must never need to email us. Separate forms for remote MCP vs desktop `.mcpb` extensions. **No payment rails** — Anthropic has no connector commerce, so this is distribution, not revenue. |
| **Slack Marketplace** | New Slack app (agent notifications, `ask_human`, ceremony digests) | Free | ⚠️ **preliminary ~1 week + functional review up to 7 weeks** | The longest queue on this list. If Slack matters, submit it in week 1 and let it bake while everything else ships. We already have Slack in the `ask_human` path, so the app surface partly exists. |
| **Atlassian Marketplace** | Jira/Confluence app (board + ITSM connectors already exist via `providerCatalog`) | Free to list | **10–15 business days** | Host UI must remain intact; no Basic auth in production; must accept the Marketplace Partner Agreement. Strong fit — we already ship board connectors. |
| **JetBrains Marketplace** | IntelliJ plugin (port of S1) | Free | **3–4 working days**, manual review | Licence file mandatory, 400MB cap, must not touch licensing/trial flows. Real engineering cost: the VS Code webview UI has to be rebuilt on the IntelliJ platform. Defer unless there's demand. |
| **GitHub Marketplace — Apps** | GitHub App (PR review, pre-merge build feedback) | Free listing | Verification req'd for paid | Publisher verification needs verified domain + org 2FA + confirmed email. Free apps skip verification. |
| **Product Hunt** | S5 | Free | Launch day | Top-5 finish ≈ 500–2,000 signups plus a high-authority dofollow link. One-shot — do it *after* Tier 0 so the launch has proof points. |
| **G2 / Capterra / GetApp / SourceForge / TrustRadius / Clutch / GoodFirms** | S5 | Free basic listing | Days | SourceForge is the highest-traffic of these (~2.4M users/mo). Directory listings now feed **AI Overviews and ChatGPT answers**, which is why 23.6% of B2B SaaS budget touched directories in 2026 — roughly 3× the prior year. Cheap, and increasingly the citation surface. |
| **There's An AI For That** | S5 | Free | Days | DR 77, dofollow, listings don't expire. Best free AI-directory ROI. |

---

## 4. Tier 2 — cloud & enterprise marketplaces (revenue, but real overhead)

These are where B2B deals actually close, because buyers spend committed cloud budget.
All three require legal entity + partner-program enrollment before a single listing.

### AWS Marketplace — **highest priority of this tier**

- Has a dedicated **AI Agents & Tools** category (created late 2025), aligned to Bedrock
  AgentCore, which is exactly what Builderforce is.
- **Fees: 3% on SaaS public offers; 1.5–3% on private offers by contract value; 20% on
  AMI/container/ML listings.** ⚠️ Some guides quote 20–30% platform fees — that's the
  server/container path, not SaaS. **List as SaaS, not as a container**, and the take rate
  drops by an order of magnitude.
- MCP servers listed here have hard technical requirements: container listens on
  `0.0.0.0` (not localhost), **port 8000**, endpoint at **`/mcp`**, **stateless streamable
  HTTP**. Our MCP transport must be checked against this.
- Dominant 2026 pricing shape: base contract + metered overage. That maps cleanly onto
  the existing consumption-meter framework.

### Microsoft Marketplace (Azure Marketplace / AppSource)

- Enroll in the **Microsoft AI Cloud Partner Program**, publish via **Partner Center**.
- Technical gate: SaaS offers must **activate the customer's subscription after purchase**
  and **stand up a webhook endpoint** for Microsoft's usage/lifecycle events. That's a real
  integration, not just a form — budget for it.
- Supports license-based (per-user/per-unit) and usage-based metering, plus free trials
  and free tiers — matches Free/Pro.
- Microsoft Marketplace already carries 4,000+ AI apps and agents; the agent category is
  actively merchandised.

### Google Cloud Marketplace

- Requires **Partner Advantage** enrollment at **Build** status plus the Marketplace Vendor
  Agreement. From Q1 2026 the tiers are **Select / Premier / Diamond**, gated on certified
  headcount and demonstrated wins — this is the **slowest to qualify for** of the three.
- Fee moved off a flat 3% (May 2025) to a variable structure: ~3% net-new, **1.5% on large
  private offers and renewals**.
- Google's **Gemini Enterprise Agent Platform** includes a registry for agents, tools and
  **MCP servers** — the agent-native path here is worth tracking. ⚠️ Verify current
  submission mechanics; the Agentspace → Gemini Enterprise rename has churned the docs.

### Enterprise ISV stores

| Channel | Verdict |
| --- | --- |
| **Salesforce AppExchange** | AgentExchange launched standalone (Oct 2024) then **merged back into AppExchange** — do not build for a separate AgentExchange listing. 200+ agent partners. Worth it only with Salesforce-native customers. |
| **ServiceNow Store** | Real fit given the ITSM connectors, but a heavy partner program. Defer to demand. |
| **Oracle Fusion AI Agent Marketplace** | Launched Oct 2025. Skip unless an Oracle customer asks. |

---

## 5. Tier 3 — paid placements (buy only after Tier 0/1 prove conversion)

| Channel | Price | Verdict |
| --- | --- | --- |
| **Toolify.ai** | Free (2–4 week queue) or ~$100 express (24–72h) | Take the free queue first; pay only if the free listing converts. |
| **Futurepedia** | **$497** one-time "verified" | The only major AI directory demanding payment up front. Skip on the first pass. |
| **AppSumo** | Rev-share, lifetime deals | ⚠️ Actively harmful for a tenant-billed B2B product — LTD buyers are the wrong ICP and permanently distort the consumption meters. **Recommend against.** |
| **RapidAPI** (now Nokia-owned) | **25% of revenue + 2.9% + $0.30/txn** | Bad economics for S6. If we want an API-marketplace presence, use **Postman API Network** (free, huge developer reach) and optionally **Zyla API Hub** / **Kong Konnect** instead. |

---

## 6. Recommended sequencing

**Wave 1 (week 1) — submit the long queues, then bank the free wins.**
Day 1: submit the **Slack** app (7-week functional review) and the **Anthropic Connectors
Directory** entry. Then ship all of Tier 0: VS Code Marketplace + Open VSX, official MCP
registry, Docker MCP Catalog, Smithery, Glama, mcp.so, PulseMCP, LobeHub, Cline,
awesome-mcp-servers, Claude Code plugin dirs, GitHub Action, Hugging Face.
→ **~15 listings live.**

**Wave 2 (weeks 2–4) — the free-but-reviewed set.**
Atlassian Marketplace app; GitHub App listing; G2 / Capterra / GetApp / SourceForge /
TrustRadius / Clutch / GoodFirms; There's An AI For That. Product Hunt launch at the end
of the wave, once Wave 1 gives it substance.
→ **~25 listings live.**

**Wave 3 (weeks 4–10) — AWS first, then Microsoft.**
AWS Marketplace as a **SaaS** listing (3%, not 20%) in the AI Agents & Tools category;
verify the MCP transport meets `0.0.0.0`/`:8000`/`/mcp`/stateless-HTTP. Then Microsoft
Partner Center, including the subscription-activation + lifecycle-webhook work.

**Wave 4 (opportunistic) — GCP, ServiceNow, Salesforce, JetBrains.**
All are demand-driven. Don't build for them speculatively.

## 7. Prerequisites that block multiple channels at once

Fix these once and several listings unblock together:

1. ✅ **A shared listing source** — `distribution/listing.json` holds the copy every
   channel asks for and is stamped into each payload. Still to produce: 400×400 and
   1024×1024 logos, 5 screenshots, a demo video.
2. ⛔ **A reviewer test tenant** — pre-populated with realistic sample data. Hard
   requirement for Anthropic, Slack, Atlassian, AWS and Microsoft. Needs a live
   environment; build it once.
3. ⛔ **Domain verification + org 2FA on GitHub** — gates GitHub Marketplace paid listings
   and the verified badge.
4. ✅ **A standalone remote MCP endpoint (S3)** — shipped as `POST /mcp`; unlocks
   Anthropic's directory, AWS's AI Agents category, Gemini Enterprise's registry, and every
   MCP-registry listing.
5. ⛔ **A published container (S8)** — required for the AWS container path and Docker Hub.

## 8. Sources

Fees and SLAs above are drawn from: AWS Marketplace seller guides and the AI Agents &
Tools category docs; Microsoft Learn "Publish and release your AI app or agent on
Microsoft Marketplace" and Partner Center transacting docs; Google Cloud Marketplace ISV
seller guides (2026); Atlassian "Submit for review" and app approval guidelines; Slack
Marketplace review guide and FAQ; JetBrains Marketplace approval guidelines v1.3
(effective 2026-03-31); GitHub Docs on Marketplace listing requirements and publisher
verification; `modelcontextprotocol/registry` publishing guide; `docker/mcp-registry`;
`cline/mcp-marketplace`; Anthropic Connectors Directory FAQ; Eclipse Open VSX 1.0.0
announcement; and 2026 SaaS/AI directory surveys.
