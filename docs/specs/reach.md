# 📣 Reach — sell, be found, grow

> **Domain PRD — open work only.** Consolidated 2026-11-17 from the per-PRD specs that used to live in
> `docs/specs/NN-*.md`; every section was verified against the code that day. This file holds only
> what is left to build. Finished sections are archived word for word in `DONE.md` ("✅ RESOLVED 2026-11-17 — PRD NN:
> finished sections archived on consolidation"), with their § numbers kept, so a citation such as
> `PRD 38 §4.3` resolves to the `## PRD 38` section here (open) or to DONE.md (shipped).
> A gap in a PRD's numbering is a shipped section. Outstanding work is tracked in `ROADMAP.md` under **📣 Reach**.

**Holds:** Billing and commerce, the company directory and marketplace, marketing and campaigns, SEO and the blog, distribution.

## Contents

- [PRD 30 — Prompt-driven marketing campaign (compose Growth, do not clone HubSpot)](#prd-30--prompt-driven-marketing-campaign-compose-growth-do-not-clone-hubspot)
- [Design — Blog capability gap register](#design--blog-capability-gap-register)
- [PRD 21 (part) — The Unified Experience: the company directory and claim](#prd-21-part--the-unified-experience-the-company-directory-and-claim)
- [PRD 18 — hired.video → Builderforce.ai port (marketing, content and affiliates)](#prd-18--hiredvideo--builderforceai-port-marketing-content-and-affiliates)
- [Design — Marketing claims review process](#design--marketing-claims-review-process)

---

## PRD 30 — Prompt-driven marketing campaign (compose Growth, do not clone HubSpot)

> Consolidated 2026-11-17 from `docs/specs/30-prd-guided-marketing-campaign.md`. Verified against code 2026-11-17: Partly built — C0 (journey prompt) shipped; C1–C4 open.
> Finished sections are archived in DONE.md ("PRD 30: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

**Board:** epic #2547 · spec `57b8d17d-6269-40aa-840d-440170cbc26b` · roadmap `e5697b23-1f76-4b5b-9d3a-76f7129bc6f1`

### §2.2 What we will not build (working rules for C1–C4)

- A HubSpot clone: CRM-as-campaign, visual nurture builder, heatmaps, A/B as a v1 dependency.
- A second campaign product next to `/growth`.
- Autonomous `campaign.send`, `social_campaign.publish`, ads `launch`, or `marketing.generate_logo` on the cloud-agent path (`cloudAgentToolset.ts` already forbids them).
- Guest mailbox OAuth (anonymous boards have no tenant).
- Wiring `icpId` onto `campaign.create` as a hidden FK before there is a frontend ICP picker.
- Treating `/api/roi/rollup` (feature/portfolio ROI) or `marketingApi.ts` visitor diagnostics as campaign ROI.

### §4 Sequence (open tracks)

| Track | What ships | Proof form | Kill condition |
|---|---|---|---|
| **C1 · Connect mailbox** | Guest-gated `canvas_connect_mailbox` mirroring social (open OAuth / composer; never ask for a password in chat) | clickable-prototype | "Connect my email" still dumps the user at a prose "go to Growth" with nothing on the board |
| **C2 · Catalog** | New executive use-case (do not overwrite `marketing.campaigns.list`) whose objects include `emailCampaign` / `audience` / `brandKit`; bump the use-case id contract | smoke-test | The C-suite starting point still only emits `table` |
| **C3 · ICP on canvas** | Read `ri_icps` onto an audience / document; still no hidden FK on `campaign.create` until a picker exists | poc | Campaign rows gain `icpId` with no UI |
| **C4 · Campaign ROI** | Attribute spend → pipeline, not opens/clicks. Explicit CMO-review gap. | live-system | A dashboard labelled ROI that is only opens/clicks |

Do not send from cloud agents in any track.

**Remaining (verified 2026-11-17):**
- C1: no `canvas_connect_mailbox` in `api/src` or `frontend/src/lib`; the prompt still tells the model "There is no canvas_connect_mailbox" (`frontend/src/lib/canvasAiSystemPrompt.ts:121`). Inbox stays account-required under `persistence === 'server'` (`:126-128`). When C1 lands, rule 3 of `api/scripts/check-canvas-tool-contract.mjs` must still hold.
- C2: `executiveMarketing.objects` is still `table, dashboard, report, chart, evaluation` (`frontend/src/lib/templates/promptUseCases.ts:26`); the only campaign use-case is `marketing.campaigns.list` (`:137,268`).
- C3: the ICP API exists (`GET/POST /api/revenue-intel/icps`, `revenueIntelRoutes` header :19-21) but no frontend client calls `revenue-intel` (grep of `frontend/src/lib` empty). `intake.icp` is free text today (`frontend/src/lib/canvasMarketing.ts:183`; contract `packages/creation-canvas-contract/src/guidedCampaign.ts:61`).
- C4: no campaign ROI / ROAS writer in `api/src/application/marketing`.

### §4.1 C3 · the ICP picker contract

1. **The picker never blocks.** It is an optional section inside the intake, not a numbered step. Continue, Save draft, Generate and Send are never disabled by ICP absence, an empty list, a load error or a cleared selection. The primary CTA stays the intake's own Continue, never "Select ICP".
2. **`intake.icp` is an id or null.** No selection, skipped or cleared means omitted or `null`; a selected or newly created ICP is its `ri_icps` id. Never `""`, `0`, `"none"`, `"pending"`, a placeholder UUID or any synthetic id. A persisted id that no longer resolves (deleted / 404) is cleared with a non-blocking notice.
3. **Create in flow, never automatically.** "Create ICP" opens a modal inside the intake (never abandons it), prefilled from the brand kit and workspace profile (audience, industry, company size, geography, value proposition, tone) and editable. Prefill is assistive only: an empty source gives an empty form, and nothing is auto-created or auto-selected. A failed create keeps the modal open with an inline error; cancel leaves the prior selection unchanged.
4. **The selection lives only on intake state** (`intake.icp`, through the existing `canvasMarketing.ts` channel). No new store, route, column or permission: list and create use the existing `ri_icps` API, and Growth send passes `intake.icp` through only when it is set.

**Remaining (verified 2026-11-17):**
- Nothing of the picker is built; `intakeFrom` (`canvasMarketing.ts:178-188`) accepts any string for `icp`, so rule 2 (id or null) is not enforced yet.

### §7 Claim-to-proof

Public copy may say we **compose email, social and ads campaigns on the canvas from a prompt**. It may not say we are a HubSpot alternative, that cloud agents send campaigns, or that we report campaign ROI until C4 has run against production data.

---

## Design — Blog capability gap register

> Consolidated 2026-11-17 from `docs/specs/blog-capability-gap-register.md` (an audit register, not a numbered PRD; last audit 2026-08-05 over 59 posts — `frontend/src/content/blog/` now holds 194 English posts). Verified against code 2026-11-17: Partly built. The "Implemented in this slice" list is archived in DONE.md.

The articles remain published. This register treats their product statements as acceptance criteria. A claim is **evidenced** only when a production path and a regression test exist; UI copy or a mock is not evidence.

### Open implementation gaps

| Gap | Articles affected | Acceptance evidence still required |
| --- | --- | --- |
| Full-GPU base-model autograd and large named models | `webgpu-lora-explained`, `local-first-ai-webgpu-in-the-browser`, `ai-dataset-generation-best-practices` | The base LM loss/autograd is still CPU. Full-GPU end-to-end training and the historic ~2B/device-speed table require measured hardware fixtures before those exact limits are considered evidenced. |
| Every Canvas action is live | `forty-eight-live-objects-one-creation-canvas`, `creation-canvas-beyond-chat`, `design-build-debug-one-spatial-workspace`, `customer-feedback-to-ten-mockups`, `live-data-stories-on-the-creation-canvas`, `creation-canvas-templates-frames-branches-checkpoints`, `create-before-you-sign-up`, `product-ideation-with-builderforce` | Remaining declared registry actions (notably Sales, MCP, Voice, Chart, Dashboard, Task, and Agent operations) need the same deliverable-manifest integration tests. The registry has more kinds than the historic "48" snapshot. |
| Cross-client destructive/branch parity | `multiplayer-creation-canvas-web-vscode`, `vs-code-command-center-for-your-agentic-workforce`, `in-browser-ide-and-collaboration`, `builderforce-vs-cursor-windsurf`, `builderforce-vs-claude-code` | A two-process permission/conflict fixture to exercise the deployed transport end to end. |
| Media-path evidence across every surface | `real-time-collaboration-humans-and-agents`, `video-meetings-standups-and-shared-calendars`, `visual-team-rituals-humans-and-agents`, `multi-party-team-chat-humans-and-agents` | The VS Code meeting surface needs the same selected-pair disclosure as web. |
| Connector parity and migrations | `single-pane-board-connectors`, `migrate-and-integrate-jira-monday-rally-gitlab-bitbucket`, `builderforce-agents-and-agent-integration`, `skills-assignment-and-the-marketplace` | Attachment/comment/history round-trip fixtures per vendor API that supports them. |
| Autonomous delivery proof | `autonomous-swimlane-execution`, `multi-agent-orchestration`, `fleet-management-and-agent-routing`, `define-a-need-the-agentic-system-solves-it`, `everything-an-agentic-employee-can-do`, `getting-started-with-ai-agents` | End-to-end execution fixtures covering dispatch through artifact/PR delivery, cancellation, stale-host recovery, budget enforcement, approval interruption, and audit replay. |
| QA and observability closure | `agentic-tester-autonomous-qa`, `quality-error-observability-one-click-fix`, `task-execution-and-observability` | Browser/device test runner evidence, issue deduplication, reproduction artifacts, error-to-fix-to-PR trace, deployment verification, and failure/rollback tests. |
| Governance, tenancy, and compliance assurance | `security-and-multi-tenant-architecture`, `approval-gates-and-human-oversight`, `cobit-governance-readiness-for-agentic-it`, `knowledge-management-sops-and-compliance`, `role-gated-accountability-proof-of-participation`, `system-of-record-for-agentic-work` | Tenant-isolation adversarial suite, authorization matrix, immutable audit retention/verification, approval-bypass tests, evidence exports, restore drills, and externally scoped compliance evidence. |
| Planning and executive evidence | `planning-spine-cost-bearing-delivery`, `compare-projects-and-build-an-executive-roadmap`, `specs-and-planning-with-ai`, `automated-rfp-response-from-your-codebase`, `every-role-operating-picture`, `ai-development-maturity-diagnostic` | Source freshness indicators, provenance to canonical records, cost/date rollups, permission-filtered role views, deterministic regeneration, and export reconciliation tests. |
| Agent/persona effectiveness | `ai-agent-personality-psychometric-personas`, `skills-assignment-and-the-marketplace` | Versioned persona/skill manifests in execution traces, before/after task evaluation, conflict resolution, and marketplace package integrity tests. |
| Incident learning loop | `incident-management-on-call-and-war-rooms` | Monitor breach → incident → escalation → war room → RCA → Knowledge → Evermind contribution integration test, including notification failures and retry evidence. |
| Cache correctness and savings | `semantic-response-cache` | A shared embedding-version key across web/agent releases and measured token/cost deltas from production telemetry. |
| Competitive and platform-wide assertions | `agent-tech-stack-all-seven-layers`, `best-ai-coding-agents-compared`, `builderforce-vs-devin`, `builderforce-vs-github-copilot`, `introduction-and-overview` | A dated evidence snapshot for Builderforce and each compared product; all current feature assertions must point to the relevant capability tests above. |

**Remaining (verified 2026-11-17):**
- Canvas actions: `frontend/src/lib/creationDeliverables.ts:197-302` produces deliverables only for image, comic, animation, game, cad, model3d, resume, podcast, template; no chart/dashboard/task/agent/voice/mcp/sales branch.
- Media path: `clients/vscode/src/meetings.ts` has no candidate/relay disclosure (web has it in `frontend/src/lib/useMediaRoom.ts`, `components/meetings/MeetingRoom.tsx`).
- Cache: no `embeddingVersion` / `EMBEDDING_VERSION` key in `api/src` or `frontend/src/lib`.
- The register covers 59 of 194 posts; the 135 newer posts were never audited.
- Other rows are evidence-suite requirements; not re-audited in depth this pass.

### CI policy to add

Each material blog claim should receive a stable capability ID in frontmatter. CI should fail when an ID has no passing evidence test, when its test is skipped, or when evidence is older than the product/version named in a comparison. The gap table above is the migration backlog; new articles should not merge without IDs from day one.

**Remaining (verified 2026-11-17):**
- Not started: no `capabilit*` frontmatter key in `frontend/src/content/blog/*.md`; no claim/capability guard in `scripts/`, `api/scripts/` or `frontend/scripts/` (blog scripts there: `gen-blog-og.mjs`, `i18n-patch-*.mjs`, `publish-blog-content.mjs`).

---

## PRD 21 (part) — The Unified Experience: the company directory and claim

> Consolidated 2026-11-17 from `docs/specs/21-prd-unified-experience.md` §11.5.1–11.5.3, §11.7 M4 (second half), §11.8.7, §11.9.4–5. Verified against code 2026-11-17: Not built.
> The rest of PRD 21 lives in the platform domain file. Finished sections (marketplace families §11.5, cart §11.5.4) are archived in DONE.md ("PRD 21: finished sections archived on consolidation").

**Correction from the code:** the marketplace `company` family's CTA runs `listing`, not `claim` (since 2026-09-15, `frontend/src/lib/marketplaceFamilies.ts:217-221`): a founder lists the company they run from the investor panel's Listing tab. **Claiming a company somebody else registered is company-graph work, not a marketplace verb.** The text below keeps the claim design for that graph.

### §11.5.1 A company listing is not a new concept

It is `companies` + `account_company_relationships(kind='OWNER')` — the company-graph v1 BurnRateOS
shipped in April 2026 and PRD 19 §3.2 already adopted. Nothing here needs designing; it needs
**surfacing**:

- **`Company.accountId` is deliberately NULLABLE** — NULL is an unclaimed row in the global business
  graph, enriched from a data provider. That one nullable column is what lets a single table be both
  *the business you operate* and *a company in someone's CRM*.
- **The claim flow exists** — `claimedByUserId`, `claimVerificationMethod ∈ DOMAIN_DNS_TXT |
  EMAIL_AT_DOMAIN | MANUAL_REVIEW`, a DNS TXT token, verification stamps.
- **The relationship kinds exist** — `OWNER | CUSTOMER | PROSPECT | INVESTOR_TARGET |
  PORTFOLIO_COMPANY | PARTNER | COMPETITOR | VENDOR | OTHER`.

So one directory row feeds five consumers with no duplication:

```
                       ┌─→ OWNER             → the Run stack scopes to it
  companies row  ──────┼─→ CUSTOMER/PROSPECT → CRO's CRM pipeline
  (accountId NULL      ├─→ INVESTOR_TARGET   → CEO's fundraising pipeline
   until claimed)      ├─→ PORTFOLIO_COMPANY → an investor persona's portfolio
                       └─→ VENDOR            → Security's vendor + DPA register
```

hired.video's `companies` (employer profiles a candidate browses) arrive as rows **with no OWNER
relationship** — PRD 19 §2 row 19 already made that call. The three-way "company" collision
therefore resolves to one table: the directory a jobseeker browses is the directory a founder claims
their business in.


**Remaining (verified 2026-11-17):**
- `companies` (`api/src/infrastructure/database/schema/investor.ts:45`) has `tenantId notNull`, no nullable owner, no `claimedByUserId` / `claimVerificationMethod` / DNS-TXT token, and no `account_company_relationships` (grep = 0). The listing facet (`isPubliclyListed`, `listedAt`, same table) is built.

### §11.5.2 Claiming is the rung that turns the business on

```
  browse the directory → "this is my business" → verify (DNS TXT / email@domain)
        │                                                  │
        │                                                  ▼
        │                                      accountId = your tenant
        │                                      OWNER relationship written
        └────── or: the CEO agent forms a new company ─────┤
                                                           ▼
                              RUN activates · eight seats go live · the company
                              chip appears in the session bar
```

**The unlock is the claim, not the plan.** Plan gating stays exactly where PRD 19 §2 row 14 put it
(`planFeatures` + `featureGate`, one evaluator, miss = 402) and decides *depth* — how many
scenarios, how many seats, whether Monte Carlo runs. It does not decide whether the Finance row
exists. Someone who claimed a bakery sees Finance on the free plan with their real numbers in it.


**Remaining (verified 2026-11-17):**
- No claim/verify flow; no OWNER relationship; RUN rows sit at the signed-in rung (`frontend/src/components/Sidebar.tsx:176-179`, `destinationReachable`). The "claimed a company" rung is the platform domain's PRD 21 §11.4.4 work, and it is blocked on this.

### §11.5.3 What a claimed company gets

The Run group in full is PRD 18 + PRD 19 pointed at one company:

| Row | Behind it | From |
|---|---|---|
| Finance | runway · burn · break-even · forecast + sensitivity + Monte Carlo · ARR · cohort retention · CAC/LTV/payback · expenses + AI classification · bank sync · invoicing · TCO | PRD 19 B1 |
| Revenue | contacts + provenance · deals · pipelines · quota · sequences · enrichment · dedup · business phone | PRD 19 B3 |
| Growth | campaigns (one engine) · landing pages · lead forms · nurture flows · A/B tests · NPS · referrals · SEO · brand kit · content calendar · heatmaps | PRD 19 B4 |
| People | employees · goals · reviews · 1:1s · check-ins · pulse · scorecards · org design · headcount plan · HRMS connectors | PRD 18 T3 + PRD 19 B7 |
| Hiring | jobs · pipelines · screening · interviews · scorecards · résumé tailoring · candidate packets | PRD 18 T1/T2 |
| Investors | pitch decks + slide analytics · investor updates + approvals · data room · due diligence · funding rounds · portfolio health · deal flow | PRD 19 B2 |
| Governance | SOC 2 controls + evidence · vendors · DPAs · PII assets · security training · compliance calendar · DSR | PRD 19 B8 |
| Support | tickets · knowledge base · live chat · CSAT | PRD 19 §2 row 7 |
| Commerce | plans · invoices · cart/orders · payouts · affiliates · AI credits | PRD 18 T6 + PRD 19 B9 |

Nine rows. Each is one seat, one panel, one index column, N leaves. **That is how 549 destinations
become a menu you can read.**


### §11.7 M4 (remaining half)
| # | Work | Gate |
|---|---|---|
| **M4** | The company graph with a nullable owner, the claim-and-verify flow, the OWNER relationship. | Browse → claim → verify → RUN activates |

### §11.8 Acceptance criterion 7
7. A company can be browsed unclaimed, claimed with verification, and the claim activates the RUN group and the eight business seats for that tenant.

### §11.9 Open decisions — operator, not engineering
4. **Does the directory list a company that never opted in?** Browsing unclaimed rows is what makes the directory useful on day one, and it is how hired.video's employer profiles arrive. It also means publishing profiles of businesses that did not ask. A data-protection call, not a schema question. *Blocks M4.*
5. **Whose custom domain does a claimed company's storefront use** — the site-backend work (0412) or the whitelabel table PRD 18 T6 ports? Both exist; PRD 19 §2's one-owner rule applies and neither PRD has claimed the row. *Blocks M4's publish path.* (`company:storefront` is visible and inert: `frontend/src/lib/marketplaceFamilies.ts:162-165`.)

**Remaining (verified 2026-11-17):** both still undecided (ROADMAP.md:356-357).

---

## PRD 18 — hired.video → Builderforce.ai port (marketing, content and affiliates)

> Consolidated 2026-11-17 from `docs/specs/18-prd-hired-video-port.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 18: finished sections archived on consolidation"); section numbers are kept, so a gap in numbering is a shipped section.
> **Split across domains:**
> - **reach** (this file): T5 and the T6 affiliates row.
> - **run:** hiring, résumé and the HR/Recruiter agents.
> - **make:** canvas runtimes.
> - **platform:** cutover and whitelabel.
>
> §1.5 (campaigns merged into `campaignEngine.ts`) is shipped.

### T5 · Marketing, campaigns, content, social
Campaigns live in `api/src/application/marketing/campaignEngine.ts` (built). Advertising, social publishing, articles, blog, SEO, events, community resources, feed and `og`/`sitemap`/`structured-data` port onto the existing marketing lib. Marketing pages follow the shell-routing rule and the marketing-page localization rule. Public surfaces that carry SEO keep their hired.video slugs 1:1 (`/jobs/*`, `/companies/*`, `/articles/*`, `/tools/*`), and their prefixes join the public shell prefixes.

**Remaining (verified 2026-11-17):**
- `frontend/src/app` has no `/jobs` or `/articles` route. `companies`, `tools`, `career`, `salary` and `talent` exist. Without these routes the cutover 301 map (platform §3) has no target for the two largest SEO groups.
- Events, the feed and community resources were not found as built surfaces. Before porting, confirm whether each is retired in favour of the blog under `frontend/src/content/blog`.
- The hired.video Pages-Functions SSR/OG entities (jobs, companies, résumés, people, courses, creators, events, articles, voice) need Next edge routes plus `opengraph-image` without changing URL shapes. Only the existing routes have them.

### T6 · Affiliates (from the T6 verdict table and §5a.1)
hired.video's six affiliate tables (`affiliate_profiles/_referrals/_conversions/_payouts/_tiers/_link_clicks`) reconcile onto the Associate program (`sales_associate_settings`, `sales_referrals`, `sales_commission_rules`) and `ledger_entries`. They do not become a second referral economy, and `affiliate_referrals` in `growth.ts` is retired, not populated.

**Remaining (verified 2026-11-17):**
- No affiliate application path exists. `sales_referrals` is read in `api/src/application/llm/builtinMcpService.ts:705`. *Blocker: operator decision (ROADMAP.md:355). PRD 18 says port; PRD 19 §2 and `burnrateCutoverPolicy.json` say retire.*

---

## Design — Marketing claims review process

> Consolidated 2026-11-18 from `docs/marketing/CLAIMS-PROCESS.md`. Verified against code 2026-11-18: reference (a standing process); it matches the code, with no open work and no drift.

The code-owned registries are the source of truth for public capability, integration, workflow-proof, and high-risk marketing claims:

- `frontend/src/lib/content/product.ts` — capability proof, the integration matrix, workflow proof, and `MARKETING_CLAIMS` (the Claim-to-Proof register).
- `frontend/src/lib/content/compare.ts` — the comparison arenas and vendor leaf registry, and `COMPARE_VENDOR_FACT_SOURCES` (the sourced vendor facts; empty while comparison copy states none).

### Release gate

Before public copy ships:

1. Use an existing claim ID or add a scoped claim with an owner, status, data boundary, repository evidence, review date, and compliance-review requirement.
2. Describe only `available` or `beta` capabilities as current. `planned` work belongs in `ROADMAP.md`.
3. For privacy, security, deployment, audit, cost, pricing, regulated-industry, or competitive claims, state the tested boundary and obtain the indicated compliance review.
4. Add or update all five locale catalogs in the same change.
5. Generate pricing and entitlement availability from the public API pricing contract; do not duplicate values in marketing components or structured data.
6. Comparison content must be criteria-first. Any vendor-specific fact needs a primary source, observation date, reviewer, and a review deadline no later than 30 days after observation.
7. Avoid absolutes (every, always, never, zero, entire, guarantee/guarantees/guaranteed, unlimited, 100%) in public copy unless the register backs them; scope the sentence to what is true.

### What is enforced, and where

Release workflow job `Verify frontend`, which gates the deploy:

| Check (matrix entry) | Enforces |
| --- | --- |
| `marketing claims` — `capabilityProof.test.ts`, `blogLocale.test.ts`, `messages.test.ts`, `localizePack.test.ts` | Every capability, integration, workflow-proof and `MARKETING_CLAIMS` record declares boundaries, prerequisites and an ISO date; its evidence paths exist in the repository and are not URLs; a `planned` capability is not exposed as current; each `MARKETING_CLAIMS.reviewBy` is still in the future (CI fails after that date). `blogLocale.test.ts` covers blog catalog and translated-body localization. `src/i18n/messages.test.ts` asserts locale parity of the five catalogs, and `src/lib/templates/localizePack.test.ts` covers template-pack localization. |
| `guards + brain-ui + knowledge-graph-view` — runs `pnpm run check` | `check:public-copy-absolutes` (rule 7) and `check:compare-vendor-facts` (rule 6), below. The same manifest also runs `check:i18n-keys` (every key a component asks for exists in `en.json`), the methodology mirror and the other frontend guards. |

`pnpm run check` also runs locally as part of `npm test`.

- **`check:public-copy-absolutes`** (`frontend/scripts/check-public-copy-absolutes.mjs`) is a ratchet over `en.json` for the public marketing namespaces listed in the script. It matches exactly: every, always, never, zero, entire, guarantee, guarantees, guaranteed, unlimited, and 100% (also written `100 %`). A new absolute in those namespaces fails; each baseline entry records the matched words (`{ "words": [...], "why": "..." }`) and fails if the sentence now matches a different set of words; a baseline entry that no longer matches fails; and `public-copy-absolutes.baseline.json` can only shrink. A public route (the roots listed in the script) that reads a catalog namespace missing from `PUBLIC_NAMESPACES` (and from the explicit no-claim-copy list) also fails, so the scanned list cannot fall behind the routes. Entries whose `why` starts `claim-review-pending` are known-unreviewed claims that still need a rewrite or a justification; they are debt, not approval. There are currently none.
- **`check:compare-vendor-facts`** (`frontend/scripts/check-compare-vendor-facts.mjs`) scans every `compare.competitors.<vendor>.*` leaf string and every vendor cell in `compare.arenas.*` (not the Builderforce column) in all five locales for a price, currency amount, percentage, user count, or version number. Any hit fails unless `COMPARE_VENDOR_FACT_SOURCES` holds a record for that key with a source URL, an observed date, a reviewer, and a `reviewBy` at most 30 days after the observation; an expired `reviewBy` fails.

### Not automated

These are review steps, not CI checks:

- Compliance review of records marked `complianceReview: required`.
- Whether a claim's wording is accurate beyond the patterns above (the absolutes check catches the words, not the meaning).
- Locale parity of the five catalogs (rule 4) is asserted by `frontend/src/i18n/messages.test.ts` in the frontend vitest suite, which the `marketing claims` release entry runs (`pnpm run check` does not). The absolutes and vendor-fact checks read `en.json` (absolutes) and all five locales (vendor facts); whether a rewrite was carried into every locale is a review step. The quality of a translation is a marketing review.
- Capability and integration `lastVerified` dates are reviewed at least quarterly by the owner; CI checks that the date is valid, not that it is recent.

### Freshness

- High-risk first-party claims expire on `reviewBy`; CI fails after that date.
- Competitor pricing and packaging are not stored as evergreen cells. Link readers to current vendor information and date any observed fact.

### Review responsibility

- The named product owner verifies behavior and evidence.
- Security or legal reviews records marked `complianceReview: required`.
- Marketing owns approved wording and localization.
- Revenue owns conversion measurement, but may not broaden a claim beyond its registry scope.

### Incident correction

When a public claim is found inaccurate, scope or remove it immediately, update every locale and indexed article, record the product gap in `ROADMAP.md`, and add a regression assertion to the claim contract tests.

*Verified 2026-11-18:*
- **Registries:** `MARKETING_CLAIMS` is at `frontend/src/lib/content/product.ts:343`. `COMPARE_VENDOR_FACT_SOURCES` is at `frontend/src/lib/content/compare.ts:220`, loaded from `compareVendorFactSources.json`.
- **Release job:** `verify-frontend` is named `Verify frontend (${{ matrix.name }})` (`.github/workflows/release.yml:967-968`). Its `marketing claims` entry runs the four test files (`release.yml:1031-1035`); its `guards + brain-ui + knowledge-graph-view` entry runs `pnpm run check`.
- **Guards:** both are registered in `frontend/scripts/checks.manifest.mjs:34-37`. `PUBLIC_NAMESPACES` is at `check-public-copy-absolutes.mjs:39`, and `MAX_REVIEW_DAYS = 30` at `check-compare-vendor-facts.mjs:33`. `frontend/scripts/public-copy-absolutes.baseline.json` has 0 `claim-review-pending` entries.
- **Local run:** frontend `npm test` runs `npm run check` first (`frontend/package.json:28`).
