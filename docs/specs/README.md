# Specs — status index

A numbered PRD "PRD N" is the file NN-prd-*.md here. Shipped PRDs are recorded in ../../DONE.md and their files removed; git history keeps them.

Every file below is a live contract: it is still read when the area changes. Its outstanding work is
tracked in [ROADMAP.md](../../ROADMAP.md) (the Consolidated Gap Register), under the section named in
the last column. `NNa-*` is the build hand-off for `NN`. Numbers are never reused; a gap in the
sequence is a PRD that shipped. Index last rewritten 2026-10-25.

| # | Title | Status | ROADMAP section |
|---|---|---|---|
| 05 | [Integration, Embed-Back & Identity Federation](./05-integration-embed-and-identity.md) | Partly built | OTHER › Identity and governance |
| 08 | [Agentic Security & Governance (policy packs, governance-auditor, DevSecOps §10)](./08-prd-agentic-governance.md) | Partly built | Run › `[governance]` Security automation |
| 09 | [Cloud Agent Validation & Hardening](./09-prd-cloud-agent-validation.md) | Partly built (gaps need re-audit) | Make › Cloud and IDE agent runs |
| 18 | [hired.video → Builderforce.ai port](./18-prd-hired-video-port.md) | Partly built | Programs; Make › Canvas runtimes and studio |
| 19 | [burnrateos.com → Builderforce.ai consolidation](./19-prd-burnrateos-consolidation.md) | Partly built | Programs |
| 20 | [The Consolidated Data Model](./20-prd-consolidated-data-model.md) | Partly built | OTHER › Data model — PRD 20 |
| 21 | [The Unified Experience](./21-prd-unified-experience.md) — start here for any UI work | Live (design system); partly built | OTHER › Frontend, i18n and code health; Reach › Marketplace and commerce |
| 22 | [Browser Performance, Domain Execution, and Codebase Health](./22-prd-browser-performance-domain-execution-analysis.md) | Partly built | OTHER › Frontend, i18n and code health |
| 23 | [Manager PR Review, Acceptance Evidence, and Ticket Recovery](./23-prd-manager-pr-ticket-recovery.md) | Partly built | Make › Autonomous delivery |
| 25 | [Vertical KPI Dashboards](./25-prd-vertical-kpi-dashboards.md) · hand-off [25a](./25a-vertical-kpi-dashboards-implementation.md) | Partly built (Slice A shipped) | Measure › `[finance]` |
| 26 | [Advisor Platform](./26-prd-advisor-platform.md) | Partly built | Reach › Marketplace and commerce |
| 30 | [Prompt-driven marketing campaign](./30-prd-guided-marketing-campaign.md) | Partly built | Reach › Marketing and campaigns |
| 31 | [Build, run and ship a real app on Builderforce](./31-prd-customer-app-platform.md) | Proposed, not started | Make › Previews, repos and hosting |
| 33 | [Insights: session replay, heatmaps, live visitors](./33-prd-session-replay.md) | Live in code; production provisioning open | Measure › `[growth]` |
| 35 | [One agent, one kernel](./35-prd-one-agent-one-kernel.md) | Partly built (in progress) | Make › Cloud and IDE agent runs (ONE execution core) |
| 37 | [Coordinated Role Participation & Execution Verification](./37-prd-coordinated-role-participation.md) | Mostly built | Make › Autonomous delivery |

Also here:

- [`data-model/`](./data-model/) — the consolidation coverage map read by the `check:burnrate-parity`
  and model-coverage guards.

Design docs live in [`../design/`](../design/): the PRD 35 design
([`one-agent-one-kernel.html`](../design/one-agent-one-kernel.html)), the local-first review
([`vsix-offline-first-architecture-review.md`](../design/vsix-offline-first-architecture-review.md),
including the offline memory scope) and the creation-canvas set. Implementation guides (email,
multi-auth) live in [`../guides/`](../guides/).
