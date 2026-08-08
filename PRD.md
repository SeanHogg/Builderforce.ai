> **PRD** — drafted by Ada (Sr. Product Mgr) · task #892
> _Each agent that updates this PRD signs its change below._

# PRD: Complete Spec/Design/Test Artifacts for Backlog Features

## Problem & Goal
The current WIP PRD contains empty sections for **Requirements**, **Design**, **Implementation Notes**, **Review**, and **Test Evidence**. These sections are not authored, leaving no authoritative guidance on how backlog features are specified, designed, implemented, reviewed, or verified. Downstream agents (developers, testers, reviewers) lack the necessary context to execute their tasks consistently or to trust feature completion.

**Goal:** Author all five empty sections with concrete, actionable content so the PRD serves as the single source of truth for feature specification, design, implementation approach, review criteria, and test strategy.

## Target Users / ICP Roles
- **Developers:** Need clear requirements, design decisions, and implementation notes to build the feature.
- **QA / Testers:** Need test plans and acceptance evidence to verify feature correctness.
- **Reviewers (code, design, product):** Need defined review gates and expected outcomes.
- **Product Manager / Architect:** Need traceable justification for design choices and completeness proof.

## Scope
- Populate the five currently empty sections of the PRD:
  1. Requirements
  2. Design
  3. Implementation Notes
  4. Review
  5. Test Evidence
- Define content guidelines and mandatory elements for each section.
- Ensure all content aligns with the overarching product vision and backlog items already described in the PRD.

## Functional Requirements

### 1. Requirements Section
- Must contain a prioritized, numbered list of feature requirements (functional and non-functional).
- Each requirement must include:
  - A unique ID (e.g., REQ-001)
  - A clear, testable description
  - Acceptance criteria (if not captured elsewhere)
- Dependencies and assumptions must be listed at the end of the section.

### 2. Design Section
- Must include a high-level architectural overview (diagram or description) showing component interactions.
- Document key design decisions with rationales (e.g., selection of data model, API contracts, third-party libraries).
- Include data flow sequences or state transitions if applicable.
- Reference any external design documents or diagrams (with links or inline).

### 3. Implementation Notes
- Provide step-by-step implementation guidance or important warnings for developers.
- Highlight areas of complexity, technical debt avoidance, or performance considerations.
- Suggest file/module organization and naming conventions that maintain consistency.
- Include code snippets or pseudocode only if they clarify a non-obvious approach.

### 4. Review Section
- Define the required review checkpoints: design review, code review, product sign-off, security review (if relevant).
- List specific criteria that must pass before approval (e.g., “All tests pass”, “Design doc approved by architect”).
- Identify responsible roles for each review gate.

### 5. Test Evidence Section
- Outline the test strategy: unit, integration, end-to-end, performance, etc.
- Provide a test plan or link to test cases that map back to requirements.
- State the expected evidence of passing tests (e.g., CI test reports, manual test logs, screenshots).
- Define exit criteria: what does “done” look like from a testing perspective (e.g., 100% requirement coverage, zero known critical bugs).

## Acceptance Criteria
- All five sections (**Requirements, Design, Implementation Notes, Review, Test Evidence**) are present and contain substantive content (i.e., not placeholder text, not empty).
- The Requirements section lists at least one requirement per backlog feature covered by the PRD.
- The Design section includes at least one architectural diagram or clear descriptive text of component interaction.
- The Implementation Notes contain actionable guidance, not just generics.
- The Review section enumerates at least one mandatory review checkpoint with responsible party.
- The Test Evidence section defines a clear mapping from requirements to test cases and states how evidence will be provided.
- All sections are reviewed by a product architect for coherence and completeness before the PRD is considered ready for implementation.

## Out of Scope
- Restructuring the PRD template or adding new sections beyond the five currently empty ones.
- Writing the actual test cases, implementation code, or design documents themselves (only ensuring their specification is documented in the PRD).
- Retroactively filling artifacts for features that are already completed and closed.
- Modifying the PRD's overall problem statement, goal, or user personas.

---

## Requirements

### Context: The Backlog

The Builderforce.ai backlog is tracked in [ROADMAP.md](./ROADMAP.md) as a consolidated gap register of ~199 open items across 15 groups. Features span the full platform surface: cloud agent runtime, on-prem SDK, LLM gateway, Evermind/SSM, Brain & Chat, workforce/kanban, insights, reliability, integrations, marketplace, studio, VS Code extension, governance, frontend, and platform infra. Each backlog item represents a _gap_ — a missing capability, a broken path, or incomplete surface parity — that must be specified, designed, built, reviewed, and verified before it is "done."

The requirements below define the _meta-standard_: the mandatory artifacts and quality gates every backlog feature must satisfy from specification through verification. They are written as a reusable checklist; a task agent executing a specific backlog item (e.g., "wire per-seat spend cap into Run-now pre-block") maps these requirements onto the concrete feature.

### REQ-001 — Feature Specification (PRD)

**Priority:** P0 (blocking — no work starts without it)

Every backlog feature MUST have an authored PRD or spec doc before implementation begins. The PRD must contain:

| Element | Requirement |
|---------|------------|
| Problem statement | One paragraph describing what is broken or missing, with a concrete user-visible symptom |
| Goal | One sentence stating the desired end state |
| Scope | Explicit list of what IS and IS NOT included; cross-reference the ROADMAP gap item |
| Functional requirements | Numbered, testable requirements (FR1, FR2, …) with acceptance criteria |
| Non-functional requirements | Performance, security, cost, or reliability constraints (NFR1, NFR2, …) where applicable |
| Dependencies | List of other backlog items, migrations, external services, or provider APIs gating this feature |
| Assumptions | Explicit assumptions made during scoping (e.g., "tenant has a connected GitHub repo") |

**Acceptance criteria:** A downstream agent reading the PRD can answer "what must I build?" and "how do I know when I'm done?" without consulting another source.

**Traceability:** Each FR in the PRD maps to at least one test case (see REQ-005). The PRD itself links back to the ROADMAP gap item it resolves.

### REQ-002 — Architectural Design Document

**Priority:** P0

Every feature that touches more than one surface (api, agent-runtime, frontend, VS Code extension) or introduces a new data model MUST have a design document. At minimum:

- **System-context diagram or description:** Show the feature's place in the Builderforce stack — which surfaces it touches, which services it calls, which DB tables it reads/writes.
- **Data model changes:** List every new or altered table/column/migration; reference the canonical domain model in `specs/builderforce/01-domain-model.md`.
- **API contract:** Every new or changed endpoint with request/response shapes, auth requirements, and error codes.
- **Key design decisions:** At least one decision with its rationale (e.g., "chose Durable Object over cron sweep because the feature needs per-project state with ≤5s staleness").
- **Failure modes:** What happens when a dependency is unavailable, a rate limit is hit, or an upstream call times out.

**Acceptance criteria:** The architect role can review the design and approve it without a follow-up session to clarify intent. The design references real repo paths and table names.

### REQ-003 — Implementation Guidance

**Priority:** P1

Every feature MUST ship with Implementation Notes (see that section below) that give the developer:

- The recommended file/module layout within the monorepo (`api/src/application/<bounded-context>/`, `frontend/src/…`, `agent-runtime/src/…`)
- Any non-obvious integration points (e.g., "this feature MUST call `resolveTenantLlmCredentials` before dispatching, not `getTenantTokenAvailability`")
- Warnings about footguns discovered during earlier passes or noted in the ROADMAP gap register

### REQ-004 — Review Gates

**Priority:** P1

Every feature MUST pass the review checkpoints defined in the Review section below before its PR is merged. At minimum:

- One code review by a peer (or architect for platform-critical paths)
- One product/design sign-off that the delivered behaviour matches the PRD's FRs
- A security review for any feature that touches auth, tokens, tenant isolation, or the LLM gateway

### REQ-005 — Test Evidence

**Priority:** P1

Every feature MUST produce test evidence per the Test Evidence section below. The evidence package must demonstrate:

- Coverage of every functional requirement (FR) in the PRD by at least one test case
- Unit tests for pure-logic paths
- Integration tests for any path that crosses a module boundary (DB read/write, HTTP call, KV access)
- A test-results artifact (CI output, screenshot, or manual test log) linked from the PR

**Acceptance criteria:** A reviewer can trace from requirement → test case → test result without guessing. A feature with zero test evidence is not mergeable.

### Dependencies & Assumptions

**Dependencies:**
- The ROADMAP.md gap register is the authoritative source of backlog items; feature PRDs must reference the gap they resolve.
- The `specs/builderforce/01-domain-model.md` canonical schema must be updated whenever a feature adds or alters a table.
- CI/CD infrastructure (GitHub Actions, `pnpm test`, `pnpm typecheck`) must be operational for test evidence to be produced automatically.

**Assumptions:**
- Every feature is implemented on a task branch off `main` and reviewed via pull request.
- The monorepo structure (`api/`, `frontend/`, `agent-runtime/`) is stable; new bounded contexts follow the existing convention of `api/src/application/<context>/`.
- The Drizzle schema barrel (`api/src/infrastructure/database/schema.ts` → `schema/*.ts`) is the single source of truth for DB shape; no feature bypasses it with raw SQL.
- Vitest (`*.test.ts` co-located with source) is the test runner for `api/`; features that need a different runner must justify it in Implementation Notes.

---

## Design

### Architectural Context

Builderforce.ai is a three-surface monorepo:

```
                    ┌──────────────────────────────┐
                    │       Builderforce.ai         │
                    │       (Cloudflare Workers)    │
                    │                              │
                    │  ┌──────────────────────┐    │
                    │  │   Hono API Gateway    │    │
                    │  │  (api/src/index.ts)   │    │
                    │  └─────────┬────────────┘    │
                    │            │                  │
                    │  ┌─────────▼────────────┐    │
                    │  │  Application Layer    │    │
                    │  │  api/src/application/ │    │
                    │  │  ├── agent/           │    │
                    │  │  ├── boardsync/       │    │
                    │  │  ├── brain/           │    │
                    │  │  ├── ci/              │    │
                    │  │  ├── compile/         │    │
                    │  │  ├── deploy/          │    │
                    │  │  ├── insights/        │    │
                    │  │  ├── kanban/          │    │
                    │  │  ├── llm/  (gateway)  │    │
                    │  │  ├── manager/         │    │
                    │  │  └── …               │    │
                    │  └─────────┬────────────┘    │
                    │            │                  │
                    │  ┌─────────▼────────────┐    │
                    │  │  Infrastructure       │    │
                    │  │  └── database/        │    │
                    │  │     ├── schema/       │    │
                    │  │     └── connection.ts │    │
                    │  └──────────────────────┘    │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     ┌────────▼───────┐  ┌────────▼───────┐  ┌─────────▼──────────┐
     │   Frontend      │  │ Agent Runtime  │  │  VS Code Extension │
     │  (Next.js)      │  │ (Node.js SDK)  │  │  (local agent)     │
     │                 │  │                │  │                    │
     │ frontend/src/   │  │ agent-runtime/ │  │ .builderforce/     │
     │ └── app/        │  │ └── src/       │  │ └── extension/     │
     │ └── components/ │  │    ├── infra/  │  │                    │
     │                 │  │    ├── tui/    │  │                    │
     └─────────────────┘  │    └── tools/  │  └────────────────────┘
                          └────────────────┘
```

**Surface responsibilities:**

| Surface | Runtime | Language | Test runner | Key concern |
|---------|---------|----------|-------------|-------------|
| `api/` | Cloudflare Workers (workerd) | TypeScript | Vitest (`.test.ts` co-located) | Multi-tenant gateway, DB access, LLM routing, cron sweeps |
| `frontend/` | Browser (Next.js, React) | TypeScript/TSX | — | Dashboard, Brain chat, project settings, manager panel |
| `agent-runtime/` | Node.js (on-prem / self-hosted) | TypeScript | — | Local agent loop, file tools, MCP, relay to cloud |

### Design Decision: The Compile Primitive as Feature Spine

The platform's unifying abstraction is the `compile()` primitive: every feature that introduces new agent behaviour follows the pattern `compile(need, modality) → AgentSpec → deploy(AgentSpec, surface)`. Features that _don't_ produce an agent (e.g., a UI dashboard, a cron sweep) still follow a similar pipeline: define the input, process it through the relevant application service, and produce an output artifact.

**Rationale:** This spine has been proven by the existing six modality adapters (prose, dataset/docs, process-chart, persona, diagnostic, policy) and avoids every new feature reinventing how it turns a spec into running code.

### Data Model Design Conventions

All feature data models follow the conventions established in `specs/builderforce/01-domain-model.md`:

1. **IDs are UUIDs** — preserve source UUIDs on migration.
2. **Every business entity carries `tenantId` + `segmentId`** — the composite index `@@index([tenantId, segmentId, …])` leads on both.
3. **`createdAt @default(now())`, `updatedAt @updatedAt`** on every table unless noted.
4. **Foreign keys to identity** (`userId`, `assigneeId`, `teamId`) are string IDs referencing federated identity (the `IdentityCache`), not local FKs.
5. **Schema organization:** Each bounded context gets its own file in `api/src/infrastructure/database/schema/<context>.ts`. The barrel `schema.ts` re-exports all of them. A new feature that adds tables adds them to the relevant context file (or creates one if it's a new context).
6. **Migrations** live in `api/migrations/` with sequential four-digit numbering. Run `drizzle-kit generate` after modifying the schema.

### API Design Conventions

| Convention | Detail |
|-----------|--------|
| Framework | Hono on Cloudflare Workers (`api/src/index.ts` wires routes) |
| Auth middleware | `webAuthMiddleware` (JWT validation against `auth_tokens` table) |
| Route files | `api/src/presentation/routes/<context>Routes.ts` |
| Request validation | Zod schemas, typically co-located in the route file |
| Error responses | Consistent `{ error: string, code?: string }` shape |
| Tenant scoping | Every route extracts `tenantId` from the JWT and threads it into the application service |

### Data Flow: Feature Implementation Lifecycle

```
ROADMAP gap identified
        │
        ▼
  ┌─────────────┐
  │  PRD written │ ◄── Business Analyst or Product Manager
  │  (this doc)  │
  └──────┬──────┘
         │
         ▼
  ┌─────────────────┐
  │ Design doc       │ ◄── Architect
  │ (if multi-surface│     References 01-domain-model.md
  │  or new schema)  │     API contract, data model, failure modes
  └──────┬──────────┘
         │
         ▼
  ┌─────────────────┐
  │ Implementation   │ ◄── Developer
  │ Notes authored   │     File layout, footguns, integration points
  └──────┬──────────┘
         │
         ▼
  ┌─────────────────────────┐
  │ Code written on branch   │ ◄── Developer
  │ Co-located tests (.test) │     Vitest for api/; surface-appropriate
  └──────┬──────────────────┘     runner for others
         │
         ▼
  ┌─────────────────┐
  │ Review gates     │ ◄── Code Reviewer, Architect, PM
  │ (see Review      │     Security review if auth/gateway
  │  section)        │
  └──────┬──────────┘
         │
         ▼
  ┌─────────────────┐
  │ Test evidence     │ ◄── QA / Tester
  │ produced & linked │     CI results, manual logs, screenshots
  └──────┬──────────┘
         │
         ▼
  ┌─────────────────┐
  │ PR merged → main │ ◄── All gates passed
  │ ROADMAP gap      │     Gap moved to DONE.md
  │ closed           │
  └─────────────────┘
```

### State Transitions: Feature Lifecycle

```
[ROADMAP gap] ──► [PRD drafted] ──► [Design approved] ──► [In implementation]
                                                                   │
                                                                   ▼
                        [Done] ◄── [PR merged] ◄── [Review passed] ◄── [Tests passing]
```

A feature is **blocked** at any stage if a dependency is unresolved. Blocked features remain on the ROADMAP with an explicit blocker note.

### Design-Review Checklist

Before a design is approved, the architect verifies:

- [ ] The feature's data model changes are reflected in (or compatible with) `specs/builderforce/01-domain-model.md`
- [ ] Every new API endpoint follows Hono conventions and has a Zod validation schema
- [ ] Tenant isolation is preserved: every DB query is scoped to `tenantId` (and `segmentId` where applicable)
- [ ] The feature does not duplicate an existing application service; if it extends one, the extension is justified in the design doc
- [ ] Failure modes are addressed: what happens when the DB is unavailable, when a provider returns 429, when a KV read misses
- [ ] The design references real repo paths — no hand-wavy "add a service" without naming where

---

## Implementation Notes

### Repository Layout & Conventions

The monorepo is structured so every bounded context has a predictable home. When implementing a new feature, place code in the correct location:

```
api/
├── src/
│   ├── application/<context>/   ← Business logic, services, domain types
│   │   ├── <Service>.ts         ← Public API of the service
│   │   ├── <Service>.test.ts    ← Co-located vitest tests
│   │   └── types.ts             ← Context-specific types (optional)
│   ├── infrastructure/
│   │   └── database/
│   │       ├── schema.ts        ← Barrel re-export (DO NOT add tables here)
│   │       ├── schema/<ctx>.ts  ← One Drizzle schema file per context
│   │       └── connection.ts    ← buildDatabase(env) factory
│   └── presentation/
│       └── routes/<context>Routes.ts  ← Hono route handlers
├── migrations/                   ← Drizzle migrations (sequential 4-digit)
└── package.json                  ← Deps: hono, drizzle-orm, zod, vitest

frontend/
└── src/
    └── app/                      ← Next.js App Router pages

agent-runtime/
└── src/
    ├── infra/                    ← Infrastructure adapters (builderforce API, git, etc.)
    ├── tools/                    ← Agent tool implementations
    └── tui/                      ← Terminal UI components
```

### Step-by-Step Implementation Workflow

1. **Read the PRD and design doc.** Do not start coding until you understand the problem, the design decisions, and the acceptance criteria.

2. **Check for existing services.** Search `api/src/application/` for services that already do something adjacent. Prefer extending an existing service over creating a duplicate. The LLM gateway (`api/src/application/llm/LlmProxyService.ts`) and the kanban participation manifest (`api/src/application/kanban/`) are especially rich — many features extend them rather than bypassing them.

3. **Schema first.** If the feature needs new or altered tables:
   - Add Drizzle definitions to the relevant `schema/<context>.ts` file (create one if it's a genuinely new context).
   - Run `drizzle-kit generate` to produce the migration in `api/migrations/`.
   - Update `specs/builderforce/01-domain-model.md` to reflect the new model.
   - **Warning:** Do NOT add table definitions directly to `schema.ts` — it is a barrel re-export. Add to `schema/<context>.ts` and re-export.

4. **Application service.** Implement the business logic in `api/src/application/<context>/<Service>.ts`. Follow these patterns:
   - Services accept `env: AppEnv` (the Cloudflare Worker bindings) and `db: ReturnType<typeof buildDatabase>`.
   - Tenant isolation is mandatory: every query scoped by `tenantId`.
   - Use `ctx.waitUntil()` for fire-and-forget work in Worker request handlers.
   - Prefer Durable Objects for stateful per-entity work (see `CloudRunnerDO`, `AgentContainerDO` patterns).

5. **Route handler.** Wire the service into a Hono route in `api/src/presentation/routes/<context>Routes.ts`:
   - Use `webAuthMiddleware` for authenticated routes.
   - Validate request bodies with Zod.
   - Return consistent `{ error: string }` shape on failure.

6. **Frontend changes.** If the feature touches the UI:
   - Next.js App Router pages go in `frontend/src/app/`.
   - Shared components in `frontend/src/components/`.
   - API calls use the existing `builderforceApi` client or add to it.

7. **Agent runtime changes.** If the feature affects on-prem agents:
   - Tool implementations in `agent-runtime/src/tools/`.
   - Infrastructure adapters in `agent-runtime/src/infra/`.
   - Keep the three surfaces (cloud Worker, on-prem Node, VS Code) in sync — check for duplicated logic.

### Critical Warnings & Footguns

| # | Warning | Context |
|---|---------|---------|
| W1 | **Do not add tables to `schema.ts` directly.** It is a barrel re-export of `schema/*.ts`. Adding a table there creates merge conflicts and breaks the split-module convention. | Schema changes |
| W2 | **Never call `buildDatabase(undefined)`.** The DB connection is constructed from `env` (Cloudflare Worker bindings). A null `env` produces a runtime error that is hard to trace. | DB access |
| W3 | **Tenant isolation is not optional.** Every query that touches tenant data MUST filter by `tenantId`. A query missing this filter silently leaks data across tenants. The code review gate (REV-002) specifically checks for this. | Multi-tenancy |
| W4 | **The autonomy failure breaker cannot distinguish infra failures from ticket failures.** If your feature dispatches work through `maybeAutoRunOnLaneEntry`, be aware that a 429 or 503 counts toward the 3-consecutive-failure breaker. Where possible, classify the failure (`auth` vs `capacity` vs `logic`) before letting it reach the breaker. | Autonomy |
| W5 | **BYO keys and platform billing.** `recordProxyUsage` now threads `byo` attribution, but historical rows are mis-billed. When writing new LLM-calling code, always thread `tenantId` + credential context through `completeForTenant` so future attribution is correct from day one. | LLM gateway |
| W6 | **Migrations are sequential 4-digit numbers.** Check `api/migrations/` for the latest number before generating. A duplicate number breaks the migration chain. | DB |
| W7 | **The three surfaces share logic that has diverged.** Context assembly is implemented 3× (cloud `prepareCloudRun`, on-prem `buildEmbeddedSystemPrompt`, VS Code `prompt.ts`). If your feature changes how context is built, check all three. The long-term fix (shared `ContextSource` + `ContextReconciler`) is tracked on the ROADMAP but not yet shipped. | Cross-surface |
| W8 | **Co-located tests are mandatory for `api/`.** Every new application service file must have a corresponding `.test.ts` in the same directory. Features merged without tests will be flagged in review (REV-004). | Testing |

### Non-Obvious Integration Points

- **LLM dispatch:** Any feature that calls an LLM must go through `LlmProxyService` (the gateway), never directly to a vendor. The gateway handles routing, failover, cooldowns, BYO credential resolution, and usage logging.
- **Autonomous execution:** Features that create work items that should auto-run must thread through `maybeAutoRunOnLaneEntry` or `SwimlaneCoordinator`, not spawn runs directly.
- **PR/Repo loop:** Features that write code must use the shared `commitFileToRepo` / `createPullRequest` helpers, which handle GitHub/Bitbucket/GitLab provider abstraction.
- **Evermind / project memory:** Features that store durable facts should use `memory_remember` / `memory_recall` (the Evermind layer), not ad-hoc KV or DB writes for facts that should survive across runs.
- **Kanban sign-off:** Features that produce a deliverable on a ticket MUST call `kanban_signoff` with the appropriate `roleKey` and `laneKey` so the accountability manifest advances.

---

## Review

### Review Checkpoints

Every feature MUST pass these gates before its PR is merged. Gates are ordered: a feature blocked at an earlier gate does not proceed to later ones.

#### REV-001 — Design Review (Architect)

**When:** Before implementation begins (or for small features, before the PR is opened).

**Who:** Architect role (or senior developer for non-platform-critical features).

**Criteria:**
- [ ] The design document (or PRD, for features that don't require a separate design doc) clearly describes what is being built and why.
- [ ] Data model changes are compatible with `specs/builderforce/01-domain-model.md` and the Drizzle schema conventions.
- [ ] API contract is defined: endpoint paths, request/response shapes, auth requirements, error codes.
- [ ] The design does not duplicate an existing service or capability; if it extends one, the extension is justified.
- [ ] Tenant isolation is preserved in every code path.
- [ ] Failure modes are explicitly addressed.

**Artifact:** Approved design document or PRD with architect sign-off annotation.

#### REV-002 — Code Review (Peer / Architect)

**When:** PR is opened on the feature branch.

**Who:** At least one peer developer. Architect required for changes to `api/src/application/llm/`, `api/src/infrastructure/database/schema/`, or any auth/security path.

**Criteria:**
- [ ] Code follows the monorepo conventions (file placement, naming, imports).
- [ ] Every DB query is scoped to `tenantId` (and `segmentId` where applicable).
- [ ] No raw SQL bypassing the Drizzle schema; no direct table access that skips the application service layer.
- [ ] Error handling is present on every async boundary (DB calls, HTTP calls, KV reads).
- [ ] No commented-out code, no console.log debugging, no TODO markers without a linked task ID.
- [ ] The PR description references the ROADMAP gap item and the PRD.
- [ ] The branch is up to date with `main` (no stale fork-point).

**Artifact:** Approved PR review with at least one approving review on GitHub.

#### REV-003 — Product Sign-Off (Product Manager)

**When:** After code review passes, before merge.

**Who:** Product Manager (or delegate).

**Criteria:**
- [ ] The delivered behaviour matches every functional requirement in the PRD.
- [ ] Out-of-scope items from the PRD have NOT crept in.
- [ ] Acceptance criteria from the PRD are demonstrably satisfied.
- [ ] The feature is manually exercisable on the preview deployment (or a reasoned exception is documented — e.g., "this feature requires a connected GitHub repo which the preview environment lacks").

**Artifact:** Product Manager sign-off comment on the PR or task.

#### REV-004 — Security Review (if applicable)

**When:** Required for features that touch: authentication, authorization, token handling, tenant isolation, the LLM gateway, payment/billing, credential storage, or any endpoint that accepts user-controlled input that reaches a shell, DB query, or file system.

**Who:** Security reviewer (or architect with security domain knowledge).

**Criteria:**
- [ ] No tenant data leakage: every query path filters by `tenantId`.
- [ ] Auth middleware is present on every new endpoint that requires authentication.
- [ ] Secrets are never logged, returned in error messages, or committed to source.
- [ ] Rate limiting or abuse prevention is considered for new public-facing endpoints.
- [ ] User-controlled input is validated (Zod schema) before reaching business logic.
- [ ] OAuth flows preserve CSRF protection (`state` parameter HMAC-signed).

**Artifact:** Security review approval on the PR.

#### REV-005 — Test Evidence Review (QA)

**When:** After code review passes, before merge.

**Who:** QA / Tester.

**Criteria:**
- [ ] Test evidence is produced and linked per the Test Evidence section (TST-001 through TST-005).
- [ ] Every functional requirement in the PRD is covered by at least one test case with a passing result.
- [ ] CI test results (or manual test log) are linked from the PR.
- [ ] No known critical or high-severity bugs are open against this feature.

**Artifact:** QA sign-off comment on the PR with the test evidence summary.

### Review-Gate Summary

```
Feature PR opened
      │
      ▼
  REV-001: Design Review ──► blocked ──► revise design
      │ (passed)
      ▼
  REV-002: Code Review ────► changes requested ──► revise code
      │ (passed)
      ▼
  REV-004: Security Review (if applicable)
      │
      ▼
  REV-003: Product Sign-Off
      │
      ▼
  REV-005: Test Evidence Review
      │
      ▼
  PR MERGED → ROADMAP gap closed → DONE.md
```

### Responsible Roles

| Checkpoint | Primary | Backup / Escalation |
|-----------|---------|---------------------|
| REV-001 (Design) | Architect | Senior Developer |
| REV-002 (Code) | Peer Developer | Architect |
| REV-003 (Product) | Product Manager | Task Author |
| REV-004 (Security) | Security Reviewer | Architect |
| REV-005 (Test Evidence) | QA / Tester | Developer (self-review with documented evidence) |

---

## Test Evidence

### Test Strategy

Builderforce.ai employs a layered test strategy aligned to the monorepo surfaces:

| Layer | Surface | Scope | Runner | Location |
|-------|---------|-------|--------|----------|
| **Unit** | `api/` | Pure-logic functions, service methods with mocked DB/external calls | Vitest | `api/src/application/<context>/*.test.ts` (co-located) |
| **Integration** | `api/` | Paths that cross module boundaries: DB reads/writes, KV access, HTTP handlers via `app.request()` | Vitest | Co-located with unit tests |
| **Contract** | `api/` | API endpoint shape validation: request validation, response shape, auth middleware behaviour | Vitest | `api/src/presentation/routes/*.test.ts` |
| **E2E** | Full stack | Golden-path workflows: "create project → dispatch agent → PR opened → merge" | Manual or CI workflow | `qa/` directory (to be established) |
| **On-prem** | `agent-runtime/` | Agent loop correctness, tool execution, file-system safety | Node.js test runner | `agent-runtime/src/**/*.test.ts` |
| **Performance** | `api/` LLM gateway | Failover latency, cascade depth, cooldown behaviour | Vitest (timed) | `api/src/application/llm/LlmProxyService.*.test.ts` |

### Test-Requirement Mapping

Every functional requirement (FR) in the feature's PRD MUST map to at least one test case. The mapping is documented in a **traceability table** in the PR or in a `TEST-PLAN.md` co-located with the feature:

```
| REQ ID  | Test Case                | Layer       | Status |
|---------|--------------------------|-------------|--------|
| REQ-001 | PRD authored and reviewed | Manual      | PASS   |
| REQ-002 | Design doc approved       | Manual      | PASS   |
| REQ-003 | Implementation Notes exist| Manual      | PASS   |
| REQ-004 | Review gates defined      | Manual      | PASS   |
| REQ-005 | Test evidence produced    | Integration | PASS   |
| FR1     | featureService.test.ts:42 | Unit        | PASS   |
| FR2     | routes.test.ts:108        | Contract    | PASS   |
| NFR1    | LlmProxyService.*.test.ts | Performance | PASS   |
```

### Test Evidence Package

The evidence that tests passed is attached to the PR as:

1. **CI test output** (preferred): A link to the GitHub Actions run showing `pnpm test` passing with the test file names and counts. This is the gold standard — it is reproducible and timestamped.

2. **Manual test log** (acceptable when CI cannot exercise the feature): A markdown table in the PR description documenting:
   - The test case ID
   - Steps executed
   - Expected result
   - Actual result
   - Environment (preview deploy, local dev, etc.)
   - Date and tester

3. **Screenshots / recordings** (required for UI features): Annotated screenshots or a short screen recording showing the feature working end-to-end. For the Brain/Chat surface, show a complete interaction: prompt → streaming response → result rendered.

4. **Provider-contract evidence** (required for external integrations): For features that call a third-party API (GitHub, GitLab, Bitbucket, OpenRouter, Stripe, Google Calendar, etc.), the test evidence must include either:
   - A successful "Test connection" click against the live API (screenshot the result), OR
   - A stubbed/mocked contract test that validates the adapter against the provider's documented response shape

### Exit Criteria

A feature is **done** from a testing perspective when:

- [ ] **TST-001:** Every functional requirement (FR) in the PRD has at least one passing test case.
- [ ] **TST-002:** Every non-functional requirement (NFR) has at least one passing test or a documented rationale for why it cannot be tested (e.g., "performance SLO requires production traffic").
- [ ] **TST-003:** The test evidence package (CI run, manual log, or screenshots) is linked from the PR and verifiable by a reviewer.
- [ ] **TST-004:** Zero known critical or high-severity bugs are open against the feature. Medium-severity bugs are documented in the PR description with a plan (fix now, fix in follow-up, or deferred with a gap task).
- [ ] **TST-005:** The traceability table covers every FR and NFR; no requirement is untested.

### Anti-Patterns (Do NOT Ship)

| Anti-pattern | Why it's rejected |
|-------------|-------------------|
| "Tests pass locally" with no CI link | Not reproducible; the reviewer cannot verify |
| Placeholder test files (`it('works')`) | Counts as untested; stubs are indistinguishable from real tests |
| Traceability table with rows all pointing to the same test | Each FR needs its own test case; one test covering "everything" is too coarse to diagnose a regression |
| No test evidence at all | Feature is not mergeable (REV-005 blocks) |
| Screenshots of a different feature | Evidence must match the feature under review |

### Existing Test Infrastructure

The `api/` surface already has extensive test coverage (hundreds of `.test.ts` files). A feature adding new tests follows the existing patterns:

- **Unit tests** use `describe`/`it` from vitest with inline mocks.
- **Integration tests** construct a test DB via `buildDatabase(mockEnv)` and exercise service methods.
- **Route tests** use Hono's `app.request()` to simulate HTTP calls without a running server.

For examples of well-tested features, see:
- `api/src/application/llm/LlmProxyService.*.test.ts` (comprehensive gateway testing with failover, routing, and cooldown scenarios)
- `api/src/application/kanban/signoffContract.test.ts` (kanban workflow contract tests)
- `api/src/application/boardsync/SyncEngine.test.ts` (integration test with DB)

---

## Verification & Sign-Off

| Role | Status | Date | Notes |
|------|--------|------|-------|
| Business Analyst | ✅ Authored | — | All five sections drafted |
| Developer | ✅ Approved | 2026-08-03 | Content meets acceptance criteria |

_Last updated: task #892 (Business Analyst pass) — all five sections authored._
