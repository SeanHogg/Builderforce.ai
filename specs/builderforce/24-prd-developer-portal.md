# PRD 24 — Developer Portal & Extension Marketplace

**Date:** 2026-08-15
**Status:** Draft (assessment + program)
**Scope:** api worker · frontend · docs-site · marketplace/commerce rails
**Depends on:** PRD 20 (consolidated data model), 0410 connector platform, marketplace v2, `providerOAuthConnect`, `oauthTokenVault`

---

## 1. The problem, stated precisely

We do not have an integration problem. We have a **publishing** problem.

Everything a third party could build for BuilderForce today lands in exactly one
of two buckets:

| Bucket | Examples | Who can see it |
|---|---|---|
| **Tenant-private** | `tenant_mcp_extensions`, tenant-authored connector manifests, connector connections, tenant API keys | Only the tenant that authored it |
| **Code-owned** | 40 built-in connector manifests, `BOARD_PROVIDERS`, `dataProviderCatalog`, drive/mailbox/payout/ledger ports, `builtinMcpService` catalog, canvas kinds | Only us, via a PR + deploy |

There is no third bucket — **published by a vendor, installable by any tenant**.
So a vendor who wants to integrate has two options: ask us to merge their adapter
(we are the bottleneck, and we are the only ones who can co-market it), or build
something only their own workspace can use (no distribution, so no reason to
build it).

The primitives are already there. The connector manifest is pure DATA validated
at parse time, run by one SSRF-guarded executor. Canvas kinds are spec DATA.
`catalog_items` + Stripe + payouts already sell a creation and pay a seller.
`providerOAuthConnect` is one door for OAuth. What is missing is a **publisher
identity, a publishable artifact, a review gate, and an install**.

The whole of the third-party API surface today is four read-only endpoints
(`GET /api/v1/agents`, `/agents/:id`, `/skills`, `/personas`) behind a
user-scoped `developer_api_keys` row with no scopes and no rate tier. That is a
listings-embed API, not a platform.

---

## 2. What the comparables actually do

Assessed: Lovable, Replit, Builder.io, Vercel Marketplace, monday.com/Square/
Atlassian rev-share, and the MCP registry ecosystem. Sources in §10.

### 2.1 Lovable — two programs, and distribution is the payment

Lovable runs **two distinct partner tracks**, and the split is the interesting part:

- **Integration Partners** (Supabase, Stripe, Sinch, Cerebras, Google Cloud).
  The pitch to the partner is explicitly *"drives new sign-ups and subscriptions
  to your platform through our user base."* The process is a gated funnel: intro
  call → joint architecture design → build with Lovable eng support → coordinated
  launch with joint marketing.
- **Solutions Partners** (agencies/consultancies). Revenue share + **enterprise
  lead matchmaking**. Perficient is the first enterprise implementation partner.

**The lesson:** they are not selling API quality. They are selling *access to
their users* and *co-marketing*, and they pay engineering attention to make the
first integrations land. The agency track is separate because agencies want
leads, not an SDK.

### 2.2 Replit — an in-product surface, but growth comes from elsewhere

Replit Extensions gave developers an in-IDE surface with monetization on the
roadmap. But Replit's actual acquisition engine is viral loops, community,
programmatic SEO, and classroom adoption — plus **cloud-marketplace distribution
via Azure and GCP**, which matters because enterprises buy through procurement
they already have. 500k+ business users, 85% of the Fortune 500.

**The lesson:** an extension surface alone does not create adoption. It retains
and deepens users you acquired another way. Budget accordingly — do not expect
the portal to be a top-of-funnel.

### 2.3 Builder.io — the integration is a component, not a snippet

Builder's integrations are API-first and **drag-and-droppable by a
non-developer** into any content. They shipped app templates *with named launch
partners*. Referral commission is 20% year 1 / 15% year 2 / 10% thereafter. They
joined the MACH Alliance for joint RFPs and co-marketing.

**The lesson:** the unit of integration should be something the *end user*
places, not something a developer wires. That is a direct analogue to our canvas
kinds and connector actions-as-tools.

### 2.4 Vercel Marketplace — the sharpest model, and the one to copy

Vercel's **native integrations** remove the two frictions that kill marketplace
conversion:

1. The customer **does not create an account on the vendor's site**.
2. The customer **picks a plan and is billed through Vercel**, on their existing
   invoice.

The vendor implements an *integration server* against Vercel's Marketplace REST
API and applies to the program to be approved. Vercel owns the account creation,
the plan selection, and the invoice.

**The lesson:** every extra signup and every extra credit card is a conversion
cliff. Platform-owned billing is the single highest-leverage feature in a
marketplace, and we already own Stripe + payouts, so it is cheap for us.

### 2.5 Rev-share norms

monday.com: 85/15 in the developer's favour **after $200k lifetime revenue** —
free until it is material. Square and Atlassian run comparable threshold models.

**The lesson:** take 0% early. The scarce resource in year one is listings, not
margin.

### 2.6 MCP — the protocol is solved; discovery is not

10,000+ public MCP servers; the official registry counted ~9,652 latest server
records / ~28,959 server-version records as of May 2026, maintained as a
metaregistry with GitHub, Microsoft and PulseMCP. Claude's own directory carries
75+ connectors. The registry is *intentionally minimal* — no polished search, no
categories, no browse UI.

**The lesson, and it is the big one for us:** the bottleneck in the agent
ecosystem is **discovery and trust**, not protocol. We already relay MCP
server-to-server with encrypted secrets and SSRF guarding — that is the trust
half nobody else is doing well. A curated, reviewed, *installable-in-one-click*
MCP surface is a differentiated position, not a me-too one.

### 2.7 The pattern, compressed

Seven behaviours recur across every platform that grew an ecosystem:

1. **Distribution is the currency.** Vendors integrate to reach your users.
2. **Kill the second signup and the second invoice.** (Vercel)
3. **Make the extension DATA the end user places**, not code a developer wires. (Builder.io)
4. **A gated funnel with a human at the top:** apply → sign → build with support → review → publish → co-market. (Lovable)
5. **Rev-share with a threshold.** Free until it is material. (monday.com)
6. **Be where procurement already is.** Hyperscaler marketplaces. (Replit)
7. **Curation and trust beat protocol.** (MCP)

---

## 3. What we already have (do not rebuild)

| Asset | Where | Reuse as |
|---|---|---|
| Connector manifest — pure DATA, parse-time validated, SSRF-guarded, OpenAPI import | `application/connectors/connectorManifest.ts`, `openapiImport.ts` | The **`connector` package kind**. A vendor authors one, no hosting required. |
| One connector executor (credentials, redaction, rate limiting, logging written once) | `connectorRuntime.ts` | Runtime for every published connector. |
| Tenant MCP extension relay — encrypted secret, server-to-server, tool-list cache | `llm/mcpExtensionService.ts` | The **`mcp_server` package kind**. |
| One tool catalog fed by three sources (builtin + MCP + connectors) | `llm/builtinMcpService.ts` | Published packages become a fourth source — not a second tool system. |
| Public integration catalog projected from 7 ports | `integrations/integrationCatalog.ts` → `GET /api/integrations/catalog` | Add published packages as an 8th source so `/integrations` shows the ecosystem. |
| Commerce: `catalog_items`, orders, Stripe, payouts, seller earnings | `application/marketplace/*`, `payouts/*` | Package listings are `catalog_items` rows. **No second commerce store.** |
| Spec-object primitive — kinds are DATA, `derive` for computed fields | canvas spec kernel | The **`canvas_kind` package kind**. |
| One OAuth connect door + encrypted token vault | `providerOAuthConnect.ts`, `oauthTokenVault.ts` | Vendor-app OAuth (§5.3). |
| Tenant API keys with scopes + origin allowlist | `identity.ts:tenantApiKeys` | The scope model to extend, rather than inventing one. |
| Docs site (Astro) | `docs-site/` | The reference half of the portal. |
| SDKs | `sdk/`, `browser-sdk/`, `feedback-sdk/`, `builderforce-embedded/` | Already-published client surface to point developers at. |

**Consequence:** this program is mostly *seams and a funnel*, not new runtime.

---

## 4. Goals

| # | Goal | Success metric |
|---|---|---|
| G1 | A vendor can register as a Developer without being our customer | Developer org created + verified, self-serve, < 10 min |
| G2 | One publishable artifact covering every extension plane | `extension_packages` with `kind` as DATA; ≥ 4 kinds live |
| G3 | A tenant installs a third-party extension in one click, no second signup | Install → the extension's tools appear in the agent catalog on next open |
| G4 | Billing is ours (Vercel model) | Paid package charged on the tenant's existing invoice; vendor paid via existing payouts |
| G5 | Review is a gate, not a bottleneck | Automated checks (SSRF, scope diff, secret scan) + governance/security agent pass; human only on exception |
| G6 | Discovery works | `/developers`, `/integrations` and in-product install all read ONE catalog |
| G7 | Rev-share that is free until material | 0% below the threshold; 85/15 above |

**Non-goals (v1):** hosted vendor compute; a vendor-authored *UI surface* running
third-party JS in our shell (canvas kinds are spec DATA, which is the safe
version of this); hyperscaler marketplace listings (§9, later phase).

---

## 5. Design

### 5.1 Developer identity — **a developer is a tenant**

> **Superseded (migration 0472).** This section originally proposed a *developer
> org* as a first-class party distinct from a tenant, on the argument that "a
> vendor is not necessarily our customer". That was overruled by the owner: **a
> developer is a tenant, and only the tenant survives.** What follows is the
> shipped design; the original proposal is kept above the line only so the
> decision is legible to a reader who finds `developer_orgs` in an old migration.

Publishing is something a **workspace does**, not a second kind of party. A
publisher is a `tenants` row with `publisher_state <> 'none'`:

```
tenants  … publisher_state (none|unverified|domain_verified|identity_verified),
           publisher_website, publisher_support_email, publisher_domain,
           publisher_verification_token, publisher_verified_at,
           publisher_payout_connection_id,
           publisher_suspended_at, publisher_suspended_reason
```

Nine nullable columns, every one functionally dependent on `tenants.id` and 1:1
with the row — 3NF as columns, and never a separate entity. It is also how this
platform already says "this party is also an X": `users.available_for_hire`,
`field_jobs.discipline`, `ide_agents.builtin_kind`. A kind is a value; a facet is
a column.

`publisher_state` carries both facts on one ordered scale, so the combination
nobody wants — not a publisher, yet identity-verified — is unrepresentable rather
than merely unlikely. A package's badge and its eligibility to charge money are
functions of this state; that is the trust half MCP registries do not have.

**Membership and credentials come for free, which is the point:**

- A publisher's staff are `tenant_members`. There is no second membership table
  to keep in sync, no second role ladder to disagree with the first, and no way
  for a vendor's engineer to be inside the company but outside the publisher.
  Authority is `application/tenant/tenantRoles.ts`: at least `developer` to ship
  a version, at least `manager` to list, delist or claim a domain.
- A publisher's API key is a `tenant_api_keys` row with `read:catalog`,
  `read:installs` or `write:packages` in the SAME scope list every other tenant
  key uses. Minting, listing and revoking happen where every other tenant key is
  managed. Issued `bfai_*` keys were copied across with their hash intact and
  still authenticate; the prefix is simply never minted again.

The case the original design was built for — a publisher who is not a customer —
is still expressible. It is a free workspace that publishes. It is not a
different KIND of thing, and that distinction is the whole of the change.

### 5.2 One publishable artifact

```
extension_packages    id, tenant_id (the PUBLISHER's workspace), slug, kind,
                      name, tagline,
                      categories[], listing_state, current_version_id,
                      catalog_item_id → catalog_items(id)
extension_versions    id, package_id, semver, spec (jsonb), requested_scopes[],
                      review_state, review_notes, published_at
tenant_extension_installs  tenant_id, package_id, version_id, granted_scopes[],
                      connection_id, installed_by, installed_at, disabled_at
```

`kind` is a **column value, not a table** (3NF rule; same argument as canvas
kinds and `builtin_kind`):

| kind | `spec` payload | Runs on | Ships day one |
|---|---|---|---|
| `connector` | A `ConnectorManifest` | Our `connectorRuntime` — vendor hosts nothing | ✅ |
| `mcp_server` | server URL + auth shape + declared tools | Vendor's MCP server, relayed server-to-server | ✅ |
| `canvas_kind` | A spec-object kind definition | Our canvas kernel | ✅ |
| `agent` / `skill` / `template` | Existing marketplace shapes | Existing rails | ✅ (re-parented) |
| `seat_pack` | A `/seat/<domain>` bundle | PRD 20 kernel | Phase 3 |

Pricing, orders, entitlement and payout are **`catalog_items` + the existing
commerce rails**. A package listing does not get its own price column, its own
order table, or its own payout path.

### 5.3 Scopes, install and the vendor app

An install is a **grant**, and the grant is the security boundary:

- A version declares `requested_scopes[]` from the **same scope vocabulary
  `tenant_api_keys` already uses**, extended — not a parallel one.
- Install shows the diff and requires an admin. A version bump that widens scopes
  **re-prompts**; one that does not, auto-updates.
- Vendor-side calls back into us use OAuth via `providerOAuthConnect`, issuing a
  tenant-scoped, install-scoped token from `oauthTokenVault`. API keys stay for
  server-to-server; OAuth is for "this vendor acting for this tenant."
- Every published package's tools enter the **existing** merged tool catalog
  (`builtinMcpService`) as a fourth source, so they are advertised, named and
  logged exactly like built-ins — no second tool system.

### 5.4 Native billing — the Vercel move

For a paid package, the tenant **never leaves BuilderForce and never creates a
vendor account**:

1. Tenant picks a plan on the listing.
2. We create the order against `catalog_items` and charge the tenant's existing
   Stripe customer.
3. We notify the vendor's integration server (`installation.created`) with a
   tenant-opaque install id and the chosen plan.
4. Metered usage is reported back to us; we bill it on the tenant's invoice.
5. We pay the vendor through the existing payouts port on the normal cycle.

This is the single highest-leverage item in the program and the cheapest for us,
because steps 2 and 5 already exist.

### 5.5 Review pipeline

Automated first, human on exception:

1. **Static** — manifest parse (already SSRF-checks `baseUrl` at author time),
   secret scan, scope diff vs. previous version, declared-vs-actual tool list.
2. **Dynamic** — install into a **sandbox tenant** with seeded data; call every
   declared action; assert no unexpected egress and no scope use outside the grant.
3. **Agentic** — the existing governance/security agent reviews the diff against
   the policy packs (PRD 08 / 0290).
4. **Human** — only when 1–3 flag, or when the package is `identity_verified`
   applying for a Featured slot.

### 5.6 Portal surfaces

| Surface | Role |
|---|---|
| `/developers` (frontend) | Apply, manage org, packages, versions, install analytics, earnings |
| `docs-site/developers/*` | Reference: manifest schema, MCP contract, scope list, webhooks, billing API, review checklist |
| `/integrations` | Public catalog — code-owned ports **and** published packages, one projection |
| In-product install | From the agent tool picker, the connector catalog, and the canvas kind picker — the same catalog, three entry points |
| Sandbox tenant | Free, seeded, resettable; issued at developer registration |

### 5.7 Architecture guardrails

- `application/developer/` owns developer orgs, packages, versions, review.
  Routes take a port; they never touch a table.
- The published-package catalog is a **projection** into `integrationCatalog`,
  not a copy — same rule that stopped the marketing page from restating the port
  registries.
- Catalog reads go through `getOrSetCached` with a version-token key (the
  keyspace is unbounded once search lands), invalidated on publish.
- Install state feeds the tool catalog through the **existing** merged-tool cache
  key, so a new install invalidates one key rather than adding a second cache.

---

## 6. Go-to-market — copy the funnel, not just the API

The portal is the *floor*. Adoption comes from the funnel Lovable runs:

**Phase A — Design partners (before the portal is public).**
Pick 8–12 vendors that our own Gap Register already says we are missing:
payroll (Gusto/Rippling/Deel), e-signature (DocuSign/Dropbox Sign), banking
(Mercury/Brex/Plaid), cap-table (Carta), sales tax (Stripe Tax/Avalara), plus the
ledger vendors (QuickBooks/Xero/NetSuite) currently blocked on credentials. Build
the first ones **with** them, with our engineers on the call. Their integrations
are the portal's launch content, and their sandbox credentials unblock the ledger
adapters we cannot verify today.

**Phase B — Self-serve.** Open registration. 0% rev-share. Ship a
`create-builderforce-extension` scaffold and a manifest linter so time-to-first-
tool-call is minutes.

**Phase C — Two tracks, like Lovable.**
- *Technology partners* → distribution + co-marketing + Featured placement.
- *Solutions partners* (agencies) → **lead matchmaking + rev-share**, tied to the
  existing freelance/engagement rails (`account_type='freelancer'`, engagements,
  `project_role_assignments`). We already have the marketplace an agency track
  needs; it is not currently pointed at agencies.

**Phase D — Procurement.** AWS/GCP/Azure marketplace listings. The
hosting-strategy port already treats the hyperscalers as adapters.

**Incentives ledger:** Featured placement · joint launch post + changelog ·
co-marketing on `/integrations` (which already ranks) · install analytics the
vendor cannot get elsewhere · 0% → 85/15 above $200k lifetime · free sandbox
tenant · engineering hours for design partners.

---

## 7. Phasing

| Phase | Ships | Proves |
|---|---|---|
| **1 — Publisher identity + the connector kind** | the publisher facet on `tenants`, tenant keys with publisher scopes, `extension_packages`/`versions`/`installs`, `kind='connector'` end-to-end, sandbox tenant, static review, `/developers` shell, docs | A vendor publishes with **zero hosting** and a tenant installs it |
| **2 — MCP kind + native billing** | `kind='mcp_server'`, install-scoped OAuth, paid plans on `catalog_items`, vendor webhooks, metered usage → invoice, payouts | The Vercel model works end-to-end |
| **3 — Discovery + trust** | Published packages in `integrationCatalog`, search/categories/ranking, verification badges, install analytics, dynamic + agentic review | Discovery — the thing the MCP registry does not solve |
| **4 — Programs** | Technology + Solutions tracks, rev-share threshold, co-marketing, hyperscaler listings | Adoption, not just capability |

---

## 8. Known drift this PRD resolves

- **`/api/v1` is a listings-embed API wearing a platform's name.** ✅ RESOLVED
  (0472). Four read-only endpoints, keys parented to a **user** while the rest of
  the platform is tenant-scoped, no `scopes`, no `allowed_origins`, no rate tier —
  while `tenant_api_keys` next to it had all three. The endpoints now authenticate
  with a tenant key through the shared resolver, require `read:catalog`, and
  enforce the origin allowlist that path already had.
- **Two key models, one concept.** ✅ RESOLVED (0472). `developer_api_keys` and
  `tenant_api_keys` both meant "a credential calling us from outside", with
  different columns and different middleware. 0467's answer was to keep them apart
  by REMOVING a column until `check-signature-duplication` stopped scoring them as
  one table — which dodges a threshold rather than answering it. There is now one
  table, one vocabulary and one resolver.
- **`tenant_mcp_extensions` is a dead-end for vendors.** A vendor can stand up an
  MCP server and reach exactly one tenant. `kind='mcp_server'` gives that same
  artifact distribution.

---

## 9. Open decisions (need an operator call)

1. **Rev-share threshold** — $200k lifetime (monday.com parity) or lower?
2. **Verification required to charge?** Recommended: yes, `identity_verified`.
3. **Does a published `canvas_kind` get to declare `derive` expressions?** It is
   spec DATA, so it is safe by construction — but it widens the review surface.
4. **Sandbox tenant cost** — free forever, or expiring, given the Neon-under-$5
   constraint? Recommended: free, reset weekly, dispatch-capped.
5. **Design-partner list** — the §6 Phase A names, confirmed and sequenced.

---

## 10. Sources

- Lovable: [Partner with Lovable](https://lovable.dev/partners) · [Integration partners](https://lovable.dev/partners/integration) · [Solution partners](https://lovable.dev/partners/solution) · [Solutions Partner Program launch](https://www.createwith.com/tool/lovable/updates/lovable-launches-solutions-partner-program-for-agencies-and-consultancies) · [Cerebras partnership](https://www.cerebras.ai/press-release/cerebras-and-lovable) · [Perficient enterprise implementation partner](https://www.perficient.com/about/newsroom/news-releases/perficient-and-lovable-partner-to-accelerate-ai-native-innovation-and-enterprise-transformation)
- Replit: [Announcing Replit Extensions](https://replit.com/blog/extensions) · [Microsoft partnership](https://replit.com/news/microsoft-partnership) · [Sacra company profile](https://sacra.com/c/replit/) · [Customer acquisition strategy, deconstructed](https://www.productgrowth.blog/p/how-replit-hacked-its-growth)
- Builder.io: [App Templates and integration launch partners](https://www.builder.io/blog/ecommerce-integrations-app-templates) · [Integrations](https://www.builder.io/m/integrations) · [Partner program listing](https://directory.partnerprograms.io/listings/builder-io) · [MACH Alliance member](https://machalliance.org/members/builderio)
- Vercel: [Marketplace Program](https://vercel.com/marketplace/program) · [Native integration concepts](https://vercel.com/docs/integrations/create-integration/native-integration) · [Create a Native Integration](https://vercel.com/docs/integrations/create-integration/marketplace-product) · [Integrations REST API](https://vercel.com/docs/integrations/create-integration/marketplace-api)
- Rev-share: [monday.com app developers](https://monday.com/w/app-developers) · [Square App Marketplace revenue sharing](https://developer.squareup.com/docs/app-marketplace/rev-share) · [Atlassian Platform Marketplace](https://developer.atlassian.com/platform/marketplace/)
- Portal practice: [21 must-haves for a high-impact app marketplace](https://www.partnerfleet.io/blog/must-haves-for-a-high-impact-app-marketplace) · [Marketplace developer portal](https://www.digitalapi.ai/blogs/marketplace-developer-portal) · [MuleSoft: five best practices](https://www.mulesoft.com/api/five-best-practices-building-effective-api-marketplace)
- MCP ecosystem: [Anthropic — donating MCP / Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation) · [MCP adoption statistics 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) · [Best MCP registries in 2026](https://www.truefoundry.com/blog/best-mcp-registries) · [What is an MCP registry?](https://konghq.com/blog/learning-center/what-is-an-mcp-registry)
