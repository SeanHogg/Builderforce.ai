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

8. **[07 — PRD (Phase 2): Security, Governance & Compliance + DevSecOps Agents](./07-prd-security-compliance-phase2.md)**
   Ships **after** Phase 1. Moves the full CISO Governance & Compliance program to BuilderForce
   *except identity* (SOC 2, vendor register, incidents, PII inventory, DPA, training, compliance
   calendar, per-Segment DSR + suppression) plus build-new Access Reviews + Vulnerability Scans,
   and adds DevSecOps agents (auto-scan + security-review gate on agent PRs, auto SOC 2 evidence).
   RBAC/SSO/multi-tenant accounts stay in BurnRateOS (it's the IdP).

9. **[08 — PRD: Agentic Security & Governance (Policy Packs + Governance-Auditor Agent)](./08-prd-agentic-governance.md)**
   The "agents **enforce** the rules" moat. doc 07 made BuilderForce a security *tracker*; doc 08
   makes it *enforce*: DB-backed policy packs + rules (PM-editable, with optional in-repo
   `.builderforce/policies/*.yaml` overrides), a `governance-auditor` agent + `governance_audit` tool
   that audits any connected repo against the resolved ruleset, and `governance_audit_runs` /
   `governance_findings` under `/api/governance`. BLOCKER findings gate auto-merge; CRITICALs
   auto-open incidents; clean runs auto-collect SOC 2 evidence. Closes the gap-register item
   "governance/security/audit AGENTS that check repos against rules are not built."

10. **[09 — PRD: Cloud Agent Validation & Hardening](./09-prd-cloud-agent-validation.md)**
    The **validation gate** for cloud agents. Summarizes the three as-built execution paths (V1 pi
    loop, V2 Claude Agent SDK, cloud-Worker fallback) and the dispatch→clone→work→steer→PR→telemetry
    lifecycle, then enumerates **50 falsifiable gaps** (dispatch/engine, workspace/PR, parity,
    steering/cancel, telemetry integrity, billing/BYO-key, security/isolation) plus a repeatable
    `pnpm qa:cloud-agents` golden-path E2E. P0-first phasing (9a telemetry/billing → 9b isolation →
    9c lifecycle → 9d parity+harness) so the operator can prove cloud agents deliver a merged PR
    with no self-hosted host online before GA.

11. **[10 — PRD: PI Framework Cutover](./10-prd-pi-cutover.md)**
    The **on-prem runtime de-framework**: remove `@mariozechner/pi-*` (138 files) and run the
    On-Prem agent on the native, surface-agnostic `LocalAgentEngine`. Records what's **done +
    verified** (Stage 1 — all ~40 tools native; Stage 2 foundations — native LLM client +
    streaming + native model types) and the **remaining staged plan** (2a type repoint → 2b
    completion/auth→gateway → 3 agent-loop swap → 4 TUI → 5 delete + flip default), each with
    tasks + falsifiable acceptance checks. Multi-session by design; nothing is deleted before its
    replacement is wired + verified.

12. **[11 — PRD: Agent Engine Consolidation](./11-prd-engine-consolidation.md)**
    The **umbrella** PRD for the whole "one tool contract + one swappable engine seam, four
    surfaces" program (cloud Worker/DO, cloud Container, on-prem Node). Records the three pillars
    (shared `@builderforce/agent-tools` contract, the `resolveEngine` DI seam, capability-gated
    providers), what's **done** (cloud fully derived from the shared registry + model cascade;
    shared contract built; on-prem Stage 1/2 per doc 10), and the **full remaining-capability
    catalog**: the pi-removal tail (doc 10), parity gaps (`ask_human` on Node + Container,
    `web.search` backend, local-engine streaming), and the cloud concretions of the Node-only
    tools (orchestrate / memory / message / media), with a surfaces × capabilities target matrix.
    Read this for the feature-level picture; doc 10 for the pi-removal staging detail.

13. **[13 — PRD: Learned Model Routing](./13-prd-learned-model-routing.md)**
    Closes the model-selection feedback loop: label each task with an **action type** (free-model
    classifier, cached on the task), score each terminal cloud run's **outcome** (composite of PR
    merged + green CI + no-degradation + efficiency) into a `run_model_outcomes` fact table, and feed
    it back into `pickCloudModel`'s soft-seed so a run prefers the empirically-best reachable model per
    action type (project→tenant→global scope). **Cost model (§4.1, load-bearing):** the routing
    *decision* must work headless, so it's a **server-side O(1) read of a tiny incrementally-maintained
    `routing:<scope>` KV blob** (no SQL/aggregation on the hot path); the heavy **SSM/Samba recall runs
    on the client GPU** (WebGPU/builderforce-memory, IndexedDB) and only *biases* interactive runs — zero server
    CPU/DB. 3 phases (Capture → Analyze+Route → client-SSM recall); degrades to today's static cascade
    under cold-start/error/headless/kill-switch. Builds on existing `llm_usage_log` capture + the curated
    coding pool — see [[claude-direct-coding-floor]].

14. **[14 — PRD: BuilderForce VS Code Extension](./14-prd-vscode-extension.md)**
    The first **editor-native client**, built by **reuse, not rebuild**. A sidebar webview renders the
    **exact same `BrainPanel` chat the web app uses** — by extracting the Brain UI into the shared
    `@seanhogg/builderforce-brain-embedded` package (new `/ui` subpath, app couplings made injectable),
    repointing the frontend, and deleting the app-resident copies (one source, two hosts; no fork). The
    agent runs **in-process** (`agentLoop()`) against **whatever folder is open** (sandboxed via the
    existing `wrapToolWorkspaceRootGuard`), LLM traffic on the unchanged gateway, with the **gateway key
    held only in the extension host** (`SecretStorage`) and webview LLM calls **proxied through the host**
    (brain-embedded's injectable `transport`) so the secret never enters the webview. **Codebase-aware so
    it doesn't misfire:** on first open of a folder it runs a **scan + knowledge summary** (the
    PRD-initialization flow — `initializeBuilderForceAgentsProject` + a net-new `architecture.md`
    auto-fill + seeded `SsmMemoryService`, cached by a git-HEAD/tree version token) and keeps learning via
    `KnowledgeLoopService`. **Consumes [13 — Learned Model Routing](./13-prd-learned-model-routing.md):**
    the Node extension host is PRD 13's SSM client — it classifies the action type, reads the cached
    `routing:<scope>` table, computes a local SSM `routingBias` over this repo's memory, seeds the
    best reachable model via `rankModelsForAction`, and writes each run's outcome back into the **same
    `run_model_outcomes` brain** as cloud runs (`source='vscode'`, table extended with two nullable
    columns). **Auth:** browser **device-code login** (RFC 8628) → scoped gateway key
    (`generateApiKey('clu')`) in the OS keychain, reused across restarts, no gateway-auth change. The
    only server work is the device-authorization grant (3 endpoints + `device_authorizations` table +
    verify page) + a `run-outcome` write endpoint. 4 phases (shared-UI extract+auth → chat+agent →
    codebase scan/knowledge → learned routing). Out of scope: Visual Studio (C#/VSIX) and JetBrains —
    same backend, separate clients.

15. **[17 — PRD: Stakeholder Alignment Diagnostic (Category 6, Epic #155)](./17-prd-stakeholder-alignment-diagnostic.md)**
    Category 6 of the Diagnostic Question Engine. Defines the **5 canonical questions** (priorities
    clear & agreed; competing P0s reconciled; approvers current; conflicts >48h without sign-off;
    plan reflects agreed priorities), the **branching logic** (Q1/Q4 → conflict scan + Q2; active
    conflict → force sign-off `Blocked`; stale approvers → stakeholder-map remediation), and the
    data models: a versioned **HealthProfile** attached to the project, a **StakeholderMap** with P0
    submissions + 30-day approver-staleness rule, the **competing-P0 conflict rule** (two active
    stakeholders, different P0s, same team, within the review window) with five falsifiable cases, an
    8-state **sign-off state machine** (Draft → PendingReview → Approved/ApprovedWithComment/Blocked →
    Escalated → Resolved/Expired), the **escalation path** (L1/L2/L3, 3-day-per-level SLA, reminders at
    24h/4h before deadline), and a **reporting dashboard + weekly digest** (6 metrics, digest template,
    email/Slack delivery). First-pass spec; sub-tasks #504–#508 carry the implementation next turn.

> **Decision log.** PM + Agile = Phase 1 (BuilderForce owns data, autonomous dev agents, thin
> embed shells, Tenant→Segment isolation with BurnRateOS as IdP). Security/Governance = Phase 2
> (doc 07), same model. DSR/suppression re-home per-Segment; BurnRateOS keeps its own
> platform-global shared-contact-graph DSR.

## Source-of-truth provenance

Every entity and route in these docs was reverse-engineered from the live BurnRateOS codebase
(`product/api/prisma/schema.prisma`, `product/api/src/worker/routes/*`,
`product/frontend/src/domains/{productManagement,agileSurvival}/*`) as of **2026-05-31**.
Where the catalog/marketing copy promised a flow that the code did not yet implement (e.g.
auto feedback→backlog, auto runway→cost), the PRDs treat it as a **requirement to build**, not
an existing behavior, and flag it explicitly.
