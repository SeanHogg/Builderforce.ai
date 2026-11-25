# HOST — Application Hosting

**Priority: P1.** Persistent, commercially hosted applications: thousands of logically isolated applications managed through shared Cloudflare infrastructure, without an individually managed Worker per application.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Shape

A shared Worker is the gateway and control plane (domain mapping, authentication, WAF, routing) in front of an application registry and runtime scheduler (tenant identity, manifest, placement, quotas). Arbitrary customer code needs an isolated execution tier: dispatch namespaces, sandboxed runtimes or container infrastructure. Thousands of registered applications do not imply thousands of processes in one Worker isolate.


## Entries

### HOST-01 — Shared application gateway

```yaml roadmap
id: HOST-01
program: application-hosting
priority: P0
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Shared application gateway.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-02 — Enable live preview

```yaml roadmap
id: HOST-02
program: application-hosting
priority: P0
status: planned
arc: run
source: PRD-31
dependencies:
  - WC-06
  - SEC-03
objective: Enable live preview.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-03 — Application registry

```yaml roadmap
id: HOST-03
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies:
  - HOST-01
objective: Application registry.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-04 — Custom domain mapping

```yaml roadmap
id: HOST-04
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Custom domain mapping.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-05 — TLS certificate automation

```yaml roadmap
id: HOST-05
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: TLS certificate automation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-06 — Persistent cloud execution

```yaml roadmap
id: HOST-06
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies:
  - HOST-03
  - WC-13
objective: Persistent cloud execution.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-07 — Scale-to-zero lifecycle

```yaml roadmap
id: HOST-07
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Scale-to-zero lifecycle.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-08 — Per-application resource metering

```yaml roadmap
id: HOST-08
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Per-application resource metering.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-09 — Development, staging and production

```yaml roadmap
id: HOST-09
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Development, staging and production.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-10 — Deployment versioning and rollback

```yaml roadmap
id: HOST-10
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Deployment versioning and rollback.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-11 — Scheduled and background workloads

```yaml roadmap
id: HOST-11
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Scheduled and background workloads.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-12 — Customer infrastructure providers

```yaml roadmap
id: HOST-12
program: application-hosting
priority: P2
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Customer infrastructure providers.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### HOST-13 — Multi-tenant scale validation

```yaml roadmap
id: HOST-13
program: application-hosting
priority: P1
status: planned
arc: run
source: PRD-31
dependencies: []
objective: Multi-tenant scale validation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
