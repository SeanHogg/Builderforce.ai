# Builderforce.ai — Roadmap

> **Outstanding work only.** Finished work moves to [DONE.md](./DONE.md). The detailed technical gaps from the previous roadmap are in [docs/roadmap/GAP-REGISTER.md](./docs/roadmap/GAP-REGISTER.md), word for word. The strategy behind this file is [00-STRATEGY.md](./docs/roadmap/00-STRATEGY.md); it is a proposal that still needs approval, and its allocations, schedule and targets are not forecasts.

## Direction

BuilderForce is an **autonomous creation, execution and hosting platform**. The WebContainer is the foundational execution environment; autonomous execution is its primary consumer.

> BuilderForce enables people and autonomous AI workforces to create, execute, test, secure, deploy and operate applications within portable, intelligent execution environments.

`Idea → Make → Run → Measure → Reach` remains the customer-facing methodology (`ARC_STAGES`, [navGroups.ts](./frontend/src/lib/navGroups.ts)) and is carried on each roadmap entry as its `arc:` tag. Vocabulary is spec data, ratcheted by `frontend/scripts/check-methodology.mjs`. The loop `Read → Prove → Build` and the proof forms (`PROOF_FORMS` in [methodology.ts](./frontend/src/lib/methodology.ts)) are unchanged.

## North-star metrics

- **Engineering:** the percentage of eligible autonomous objectives completed, independently verified and delivered within their authorized budget. A run that merely finishes, writes a ticket or generates code does not count.
- **Business:** the share of ideas reaching a graded proof. Contract: [measure.md › Creation outcome metrics](./docs/specs/measure.md#design--creation-outcome-metrics).

Enabling work never outranks a broken execution or Idea→Real journey.

## Programs

Capacity groups are the proposed 90-day allocation from the strategy, not existing staffing commitments. "Open P0" counts P0 entries not yet `done`.

| Program | Priority | Capacity group | Open P0 | Done / total | File |
|---|---|---|---|---|---|
| WC — WebContainers | P0 | WebContainers and execution infrastructure: 35% | 13 | 0 / 20 | [01](./docs/roadmap/01-WEBCONTAINERS.md) |
| AE — Autonomous Execution | P0 | Autonomous agents and delivery: 30% (with AVR) | 17 | 0 / 22 | [02](./docs/roadmap/02-AUTONOMOUS-EXECUTION.md) |
| AVR — Agent Virtualization | P0 | Autonomous agents and delivery: 30% (with AE) | 9 | 0 / 17 | [03](./docs/roadmap/03-AGENT-VIRTUALIZATION.md) |
| SEC — Security Shield | P0 | Security, reliability and release: 15% (with REL) | 11 | 0 / 15 | [04](./docs/roadmap/04-SECURITY-SHIELD.md) |
| REL — Reliability and Release | P0 | Security, reliability and release: 15% (with SEC) | 14 | 0 / 16 | [05](./docs/roadmap/05-RELIABILITY-RELEASE.md) |
| HOST — Application Hosting | P1 | Hosting, billing and commercialization: 7% (with COM) | 2 | 0 / 13 | [06](./docs/roadmap/06-APPLICATION-HOSTING.md) |
| AI — Local AI Runtime | P1 | Local AI, Evermind and knowledge: 10% (with MEM) | 3 | 0 / 14 | [07](./docs/roadmap/07-LOCAL-AI-RUNTIME.md) |
| MEM — Evermind and Knowledge | P1 | Local AI, Evermind and knowledge: 10% (with AI) | 3 | 0 / 14 | [08](./docs/roadmap/08-EVERMIND-KNOWLEDGE.md) |
| UX — Execution Experience | P1 | Other product capabilities: 3% | 5 | 0 / 11 | [09](./docs/roadmap/09-EXECUTION-EXPERIENCE.md) |
| COM — Commercialization | P1 | Hosting, billing and commercialization: 7% (with HOST) | 4 | 0 / 10 | [10](./docs/roadmap/10-COMMERCIALIZATION.md) |

Everything else is in [MAINTENANCE.md](./docs/roadmap/MAINTENANCE.md), [DEFERRED.md](./docs/roadmap/DEFERRED.md) or [RETIREMENT.md](./docs/roadmap/RETIREMENT.md). Other capabilities get no primary engineering time unless they enable execution, satisfy a contractual obligation or fix a critical security issue.

## Immediate execution order

The first 20 items. Stripe provisioning and other operator-only actions proceed in parallel rather than waiting for rank 20 ([OPERATOR-DECISIONS.md](./docs/roadmap/OPERATOR-DECISIONS.md)).

| Rank | Work item | Entries |
|---|---|---|
| 1 | Capture current benchmarks and complete the regression baseline | `REL-01` |
| 2 | Resolve Worker bundle and deployment failures | `REL-05` |
| 3 | Make CI and release gates fail closed | `REL-03`, `REL-04` |
| 4 | Fix critical tenant and runtime isolation gaps | `SEC-02`, `SEC-09` |
| 5 | Finalize Application Manifest v1 | `WC-02` |
| 6 | Enable secure live application preview | `WC-06`, `HOST-02` |
| 7 | Complete Security Shield enforcement | `SEC-01`, `SEC-03` |
| 8 | Validate full-stack WebContainer reference applications | `WC-04`, `WC-05` |
| 9 | Consolidate autonomous execution engines | `AE-02` |
| 10 | Fix autonomous trigger and dispatch failures | `AE-04`, `AE-05` |
| 11 | Implement deterministic progress and blocker reporting | `AE-07`, `AE-08` |
| 12 | Implement independent review and completion gates | `AE-09`, `AE-10` |
| 13 | Establish golden-path autonomous execution E2E | `AE-06` |
| 14 | Implement durable execution checkpoints and redispatch | `AE-12`, `WC-13` |
| 15 | Implement portable Brain execution host | `AVR-01`, `AVR-02` |
| 16 | Implement virtualized agent environments | `AVR-03`, `AVR-04` |
| 17 | Integrate agent memory and knowledge retrieval | `MEM-01`, `MEM-02` |
| 18 | Prove local browser AI execution | `AI-01` |
| 19 | Implement persistent hosting and resource metering | `HOST-06`, `COM-02` |
| 20 | Enable paid execution and tenant upgrades | `COM-01` |

## Delivery phases

Progression depends on exit gates, not calendar dates. Weeks are indicative. Security, reliability and commercialization continue throughout.

| Phase | Weeks | Scope | Exit gate |
|---|---|---|---|
| 0 — Baseline and stabilize | 1–2 | Inventory runtimes, run every suite, capture benchmarks, recompute autonomous rates, fix release gates and Worker size | A reproducible baseline exists, critical CI checks run, and changes can be measured against it |
| 1 — Universal WebContainer foundation | 3–6 | Manifest v1, orchestration, ingress, detection, Node/Python/PHP, live preview, identity, Security Shield enforcement | A reference full-stack application runs in the browser and IDE from one manifest with frontend, API, database, logs and security controls |
| 2 — Reliable autonomous execution | 5–10 | Converge engines, fix triggers, durable dispatch, independent review, completion gates, budgets, recovery | An agent takes a ticket to a pull request on the approved reference workload with no manual intervention |
| 3 — Virtualized agent workforces | 9–14 | Portable Brain host, VSIX adapters, agent manifests, MCP scoping, shared memory, checkpoints, starter kits | Multiple agents collaborate in one WebContainer and recover from a terminated environment |
| 4 — Persistent application hosting | 13–18 | Persistent cloud environments, routing, jobs, metering, custom domains, versioning, rollback | A customer application stays available without the browser session, with verified tenant isolation and measured cost |
| 5 — Agent Factory and intelligent execution | 17–22 | Agent-generated agents, bounded nested runtimes, local routing, knowledge packs, outcome learning | A parent workforce provisions a child, delegates, verifies and releases the resources |
| 6 — Scale and commercialization | 21–24 | Multi-tenant load, adversarial and failure-injection testing, cost optimization, billing validation | Commercially viable, secure, repeatable autonomous execution and hosting |

Phase 0 status: `REL-04` is done; `REL-03` awaits its first green `qa-e2e` run on `main`; `REL-05` is in progress (server/edge side-effect-free fix landed 2026-11-25, size not yet re-measured; last measured 10.82 MiB); `AE-01` and `REL-10` are blocked on operator actions.

## Key targets

Proposed engineering targets, not forecasts. The historical baselines are **not re-measured**; see [BASELINES.md](./docs/roadmap/BASELINES.md).

| Metric | Historical baseline | 90-day | 180-day |
|---|---|---|---|
| Fully autonomous ticket completion | 0.78% | ≥50% | ≥80% |
| Run failure rate | 69% | ≤20% | ≤10% |
| Autonomous trigger success | Re-baseline | ≥99% | ≥99.9% |
| Crash recovery success | Re-baseline | ≥95% | ≥99% |
| Verified completion evidence | Re-baseline | 100% | 100% |
| Cost per successful task | Re-baseline | −30% | −60% |
| Critical security fixture pass rate | Re-baseline | 100% | 100% |
| Cross-tenant isolation violations | Re-baseline | 0 | 0 |
| Frontend Worker bundle utilization | 108.2% recorded | ≤90% | ≤80% |
| Release gate compliance | Incomplete | 100% | 100% |

The full target list and the WebContainer scale targets (10,000 registered environments, warm provisioning ≤2 s, recovery ≤30 s, 0 lost acknowledged durable writes) are in [00-STRATEGY.md](./docs/roadmap/00-STRATEGY.md).

## Claim-to-Proof

Public copy states today's evidence. **Available** = shipped and repeatably verified · **Beta** = named limitation · **Planned** = never presented as current. These are the statuses in `MARKETING_CLAIMS` ([product.ts](./frontend/src/lib/content/product.ts)), which holds the reviewed wording; this table holds what each promise still needs and the entry that delivers it.

| P | Promise | Status | Proof still missing | Entry |
|---|---|---|---|---|
| P0 | One canvas from idea to real | Beta | A release check per marketed artifact. `qa-e2e` runs after deploy as an advisory check: a failure shows on the run and in its summary but does not fail the release. Its first green run needs the QA secrets | `REL-03` |
| P0 | People control agent work | Beta | Wired, failing closed and guarded in CI (2026-11-08). Still missing: a release that ships it on green CI | `AE-19` |
| P0 | Complete agent auditability | Beta | The `mutationAudit` envelope exists and covers the governance and security writes. Still missing: coverage at every other mutation entry point | `AE-20` |
| P0 | Private, local AI work | Planned | A boundary manifest per action, shown before execution | `SEC-04` |
| P1 | Evermind stays current | Beta | Freshness budgets, stale-recall evals, contradiction detection beyond docs | `MEM-11` |
| P1 | Same work in VS Code | Beta | A web↔extension parity matrix; contract tests are partial | `UX-11` |
| P1 | Connected delivery, no sprawl | Beta | Health and recovery in `connectorManifest.ts`; board sync has them | `AE-16` |
| P1 | Costs connect to outcomes | Beta | Unattributed-spend coverage and reconciliation | `COM-03` |
| P2 | Create "anything" | Beta | Limits, exports and owner in `creationObjectRegistry` | `WC-17` |
| P2 | Model/provider freedom | Planned | Provider copy from the live catalog; "30+ providers" is hardcoded | `AI-02` |
| P2 | Fair comparisons | Planned | Sourced, dated, expiring vendor facts | `COM-10` |
| P2 | Value for CEOs/revenue leaders | Beta | Measured production values and one customer proof | `COM-09` |

## Absorption programs

No longer drive the main roadmap. Contractual obligations, security issues, data preservation and redirect requirements are still completed.

- **hired.video absorption** ([PRD 18](./docs/specs/platform.md#prd-18--hiredvideo--builderforceai-port-cutover-and-retirement)): maintenance and cutover to a redirect shell. See [MAINTENANCE.md](./docs/roadmap/MAINTENANCE.md).
- **burnrateos.com shutdown** ([PRD 19](./docs/specs/run.md)): retirement. Held by `check:burnrate-parity`, `check:no-burnrate-runtime`, `check:burnrate-policy`. See [RETIREMENT.md](./docs/roadmap/RETIREMENT.md).

## Files

| File | Holds |
|---|---|
| [DONE.md](./DONE.md) | Completed work with evidence |
| [docs/roadmap/00-STRATEGY.md](./docs/roadmap/00-STRATEGY.md) | Vision, principles, architecture, entry format, governance |
| `docs/roadmap/01`–`10` | One file per program, one `yaml roadmap` block per entry |
| [GAP-REGISTER.md](./docs/roadmap/GAP-REGISTER.md) | Detailed outstanding technical work, each line with a program ID |
| [BASELINES.md](./docs/roadmap/BASELINES.md), [ACCEPTANCE-GATES.md](./docs/roadmap/ACCEPTANCE-GATES.md), [DEPENDENCIES.md](./docs/roadmap/DEPENDENCIES.md), [OPERATOR-DECISIONS.md](./docs/roadmap/OPERATOR-DECISIONS.md) | Measurements, release gates, prerequisites, operator actions |
| [MAINTENANCE.md](./docs/roadmap/MAINTENANCE.md), [DEFERRED.md](./docs/roadmap/DEFERRED.md), [RETIREMENT.md](./docs/roadmap/RETIREMENT.md) | Everything outside the ten programs |

`scripts/check-roadmap-entries.mjs` (part of `npm test` in `api/`) checks ids, dependencies, blockers, the execution order and the gap-register prefixes.
