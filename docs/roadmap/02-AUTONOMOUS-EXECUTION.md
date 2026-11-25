# AE — Autonomous Execution

**Priority: P0.** Reliable, independent task completion: from conversational coding agents to autonomous, verifiable software delivery. Consolidates PRDs 09, 23, 37, 41, 45, 49 and 50.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## One autonomous execution engine

1. **Receive objective** — human, ticket, API, schedule or event.
2. **Read and understand** — repository, memory, dependencies, requirements.
3. **Plan and prove** — acceptance criteria, budget, risks and kill conditions.
4. **Provision environment** — WebContainer, services, tools, scoped credentials.
5. **Execute** — agents perform work and emit structured events.
6. **Verify independently** — build, tests, security, QA and independent review.
7. **Deliver** — commit, pull request, artifact or deployment.
8. **Measure and learn** — outcome, cost, evidence, reusable knowledge.

Failed verification returns to execution within a bounded retry and cost budget. Unrecoverable failures produce a typed blocker.

## Autonomous maturity model

| Level | Name | Meaning |
|---|---|---|
| L0 | Assist | Answers questions and recommends changes |
| L1 | Execute | Performs an explicitly requested task |
| L2 | Deliver | Completes, tests and prepares work for review |
| L3 | Autonomous delivery | Plans, implements, verifies and delivers within policy |
| L4 | Autonomous workforce | Coordinates agents, delegates and recovers independently |
| L5 | Autonomous operations | Continuously operates and improves applications within approved boundaries |

The first commercial milestone is reliable **L3**. Autonomy never bypasses security policy, financial limits or mandatory approval boundaries.


## Entries

### AE-01 — Re-baseline autonomous execution metrics

```yaml roadmap
id: AE-01
program: autonomous-execution
priority: P0
status: blocked
arc: make
source: PRD-37
dependencies: []
objective: Re-baseline autonomous execution metrics.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: Needs read access to production run data to recompute the autonomous delivery and failure rates.
```

### AE-02 — Converge `SwimlaneCoordinator` and `ticket_runs`

```yaml roadmap
id: AE-02
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-01
objective: Converge `SwimlaneCoordinator` and `ticket_runs`.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-03 — Canonical execution manifest and lifecycle

```yaml roadmap
id: AE-03
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-02
objective: Canonical execution manifest and lifecycle.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-04 — Fix autonomous trigger errors

```yaml roadmap
id: AE-04
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-01
objective: Fix autonomous trigger errors.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-05 — Dispatch admission and retry recovery

```yaml roadmap
id: AE-05
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-02
objective: Dispatch admission and retry recovery.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-06 — Golden-path cloud-agent E2E

```yaml roadmap
id: AE-06
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - WC-02
  - SEC-03
  - REL-03
objective: Golden-path cloud-agent E2E.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-07 — Deterministic progress detection

```yaml roadmap
id: AE-07
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-03
objective: Deterministic progress detection.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-08 — Typed blocker reporting

```yaml roadmap
id: AE-08
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-07
objective: Typed blocker reporting.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-09 — Independent agent review

```yaml roadmap
id: AE-09
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-03
objective: Independent agent review.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-10 — Deterministic completion gates

```yaml roadmap
id: AE-10
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-07
  - AE-09
objective: Deterministic completion gates.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-11 — Budget and resource enforcement

```yaml roadmap
id: AE-11
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-03
objective: Budget and resource enforcement.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-12 — Crash recovery and fleet redispatch

```yaml roadmap
id: AE-12
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-05
  - WC-13
objective: Crash recovery and fleet redispatch.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-13 — Multi-repository execution

```yaml roadmap
id: AE-13
program: autonomous-execution
priority: P1
status: planned
arc: make
source: PRD-37
dependencies: []
objective: Multi-repository execution.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-14 — Agent-to-agent handoffs

```yaml roadmap
id: AE-14
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AVR-04
objective: Agent-to-agent handoffs.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-15 — Parallel task execution

```yaml roadmap
id: AE-15
program: autonomous-execution
priority: P1
status: planned
arc: make
source: PRD-37
dependencies: []
objective: Parallel task execution.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-16 — Event-driven autonomous execution

```yaml roadmap
id: AE-16
program: autonomous-execution
priority: P1
status: planned
arc: make
source: PRD-37
dependencies: []
objective: Event-driven autonomous execution.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-17 — Continuous application maintenance

```yaml roadmap
id: AE-17
program: autonomous-execution
priority: P1
status: planned
arc: make
source: PRD-37
dependencies: []
objective: Continuous application maintenance.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-18 — Autonomous incident remediation

```yaml roadmap
id: AE-18
program: autonomous-execution
priority: P1
status: planned
arc: make
source: PRD-37
dependencies: []
objective: Autonomous incident remediation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-19 — Human approval and steering

```yaml roadmap
id: AE-19
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-08
objective: Human approval and steering.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-20 — Execution evidence and audit trail

```yaml roadmap
id: AE-20
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-10
objective: Execution evidence and audit trail.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-21 — Autonomous QA and browser testing

```yaml roadmap
id: AE-21
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies:
  - AE-06
objective: Autonomous QA and browser testing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AE-22 — Model failover and learned routing

```yaml roadmap
id: AE-22
program: autonomous-execution
priority: P0
status: planned
arc: make
source: PRD-37
dependencies: []
objective: Model failover and learned routing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
