# COM — Commercialization

**Priority: P1.** Monetize execution and hosting. Begins alongside technical delivery; revenue depends on execution, environments, intelligence and hosting rather than per-user subscriptions alone.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Commercial model

| Product | Model |
|---|---|
| WebContainers | SDK licensing, managed runtime services |
| Autonomous Execution | Subscription and execution allowances |
| Agent Workforces | Workforce subscriptions and usage |
| Application Hosting | Compute, storage and network usage |
| Local AI Runtime | Advanced runtime capabilities |
| Evermind | Knowledge capacity and intelligence services |
| Agent Marketplace | Transaction fees |
| Enterprise | Private deployments, governance and support |

## Entries

### COM-01 — Stripe provisioning and tenant upgrades

```yaml roadmap
id: COM-01
program: commercialization
priority: P0
status: blocked
arc: reach
source: PRD-18
dependencies: []
objective: Stripe provisioning and tenant upgrades.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: Operator action: Stripe webhook registration and secrets.
```

### COM-02 — Execution metering

```yaml roadmap
id: COM-02
program: commercialization
priority: P0
status: planned
arc: reach
source: PRD-18
dependencies:
  - AE-11
objective: Execution metering.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-03 — Cost-per-outcome reporting

```yaml roadmap
id: COM-03
program: commercialization
priority: P0
status: planned
arc: reach
source: PRD-18
dependencies:
  - COM-02
objective: Cost-per-outcome reporting.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-04 — Runtime and hosting entitlements

```yaml roadmap
id: COM-04
program: commercialization
priority: P1
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: Runtime and hosting entitlements.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-05 — WebContainer starter kit marketplace

```yaml roadmap
id: COM-05
program: commercialization
priority: P1
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: WebContainer starter kit marketplace.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-06 — Agent workforce marketplace

```yaml roadmap
id: COM-06
program: commercialization
priority: P1
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: Agent workforce marketplace.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-07 — Enterprise licensing

```yaml roadmap
id: COM-07
program: commercialization
priority: P1
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: Enterprise licensing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-08 — First paying execution customer

```yaml roadmap
id: COM-08
program: commercialization
priority: P1
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: First paying execution customer.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-09 — First measured customer proof

```yaml roadmap
id: COM-09
program: commercialization
priority: P1
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: First measured customer proof.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### COM-10 — Evidence-backed marketing claims

```yaml roadmap
id: COM-10
program: commercialization
priority: P0
status: planned
arc: reach
source: PRD-18
dependencies: []
objective: Evidence-backed marketing claims.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
