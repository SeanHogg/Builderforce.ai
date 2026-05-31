# BuilderForce.ai — Product Management & Agile Survival Extraction

> **Purpose of this folder.** These are the domain + PRD design documents for **extracting
> the Product Management and Agile Survival domains out of BurnRateOS** and rebuilding them
> inside **BuilderForce.ai** — an agentic AI platform for software development and product
> management — which is then **re-embedded back into BurnRateOS** as a tenant.
>
> Hand these documents to the agentic build solution that will construct BuilderForce. Each
> document is self-contained and written to be implementable without reading the BurnRateOS
> source, while staying faithful to the real schema and routes that exist today.

## The four locked decisions (these shape everything below)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **System of record** | **BuilderForce owns the data.** Ideas, MVPs, roadmaps, backlog, work items, sprints, planning poker, retros, validation, feature ROI, business-value config all live in BuilderForce. BurnRateOS reads via embed + API. |
| 2 | **Agentic depth** | **Full autonomous dev agents.** Port every PM/Agile feature *and* add agentic software-development: repo/PR integration, agents that turn backlog items into code/PRs, autonomous sprint execution, code-review agents. Built on the existing `api.builderforce.ai` gateway. |
| 3 | **BurnRateOS side** | **Thin embed shells.** `/product/*` and `/agile/*` nav entries stay, but each page renders an embedded BuilderForce surface via the existing embed rail. Dogfooding + cross-domain links preserved. |
| 4 | **Identity & tenancy** | **BurnRateOS is the IdP; BuilderForce is multi-tenant.** BurnRateOS is **one tenant** in BuilderForce. Because BurnRateOS is itself multi-tenant, a **Segment** carries the client's `(accountId, companyId)` so no customer's data bleeds. Isolation hierarchy: **Tenant → Segment → Entity.** |

## Reading order

1. **[00 — Extraction Strategy & Two-App Architecture](./00-extraction-strategy.md)**
   Why, the extraction boundary (what moves vs. what stays), the two-app topology, the
   migration plan, rollout/cutover, and risks.

2. **[01 — Domain Model & Tenancy](./01-domain-model.md)**
   The complete BuilderForce data model: the Tenant→Segment→Entity isolation model, every
   ported entity with full field unions, the new agentic entities, enums, and indexes.

3. **[02 — PRD: Product Management Pillar](./02-prd-product-management.md)**
   Discovery, MVP Scaffolding, AI Roadmap, Validation Lab, Strategic Backlog, Custom
   Business-Value Models, Feature ROI Portfolio. User stories, flows, acceptance criteria, API.

4. **[03 — PRD: Agile Survival Pillar](./03-prd-agile-survival.md)**
   Planning Poker, Retrospectives, Kanban, Sprint Forecasting, Velocity, Feature Scoring &
   Capacity, Cost/Runway. Real-time collaboration, financial integration, API.

5. **[04 — PRD: Agentic Software-Development Layer](./04-prd-agentic-dev-layer.md)**
   The net-new BuilderForce value: autonomous dev agents, repo/PR automation, the agent
   orchestrator, code-review agents, and how they consume the PM/Agile graph.

6. **[05 — PRD: Integration, Embed-Back & Identity Federation](./05-integration-embed-and-identity.md)**
   The contract between the two apps: SSO/JWT federation, the Segment provisioning handshake,
   the embed rail extension, the BurnRateOS thin-shell migration, and the cross-domain API.

7. **[06 — Marketing-Parity Additions & Traceability](./06-marketing-parity-additions.md)**
   Every capability the BurnRateOS marketing copy promises, mapped to where it's specced — plus
   the net-new scope it surfaced (Jira/Linear import, EMP/DORA + PR analytics, git activity sync,
   Slack, kanban swim lanes + gamified budget economics, cross-sprint retro sentiment, Product
   Analytics / Release Planning / Changelog / Feature-Flag surfaces, investor-milestone seams,
   validation experiment templates). **Read this with docs 02–05 — it extends them.**

## Source-of-truth provenance

Every entity and route in these docs was reverse-engineered from the live BurnRateOS codebase
(`product/api/prisma/schema.prisma`, `product/api/src/worker/routes/*`,
`product/frontend/src/domains/{productManagement,agileSurvival}/*`) as of **2026-05-31**.
Where the catalog/marketing copy promised a flow that the code did not yet implement (e.g.
auto feedback→backlog, auto runway→cost), the PRDs treat it as a **requirement to build**, not
an existing behavior, and flag it explicitly.
