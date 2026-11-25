# WC — WebContainers

**Priority: P0.** The universal execution environment. The WebContainer evolves from an in-browser development runtime into a portable application and agent execution environment, and the common substrate for applications, agents, AI models and workforces.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Universal application manifest

WC-02 expands PRD 31 W11 into the canonical infrastructure-as-code contract (`builderforce.json`). An environment declares: applications and services, runtime and language requirements, databases, queues and storage, agents and agent factories, AI models and inference providers, MCP servers and tool permissions, ingress and external API access, scheduled and event-driven jobs, security policies, resource budgets, state persistence policies and deployment targets.

The agent-facing `ai` resource, `app_manifest.schema` and `.validate` already shipped (see [DONE.md](../../DONE.md), 2026-11-25). The `agents`, `security` and `state` sections of the strategy sketch are **proposed extensions, not the supported schema**.

## State management

State is configurable per resource, never a whole-VM snapshot. A terminated environment must be recoverable from its manifest, persisted resources and execution checkpoints.

| State | Persistence strategy |
|---|---|
| Application source | VFS snapshot and journal |
| Agent conversations | Durable transcript |
| Agent execution | Checkpoint and event journal |
| Agent memory | Evermind / builderforce-memory |
| Database | Database-native persistence |
| Scheduled jobs | Durable scheduler records |
| Queue | Durable message storage |
| Running processes | Recreate from manifest |
| Secrets | Secure references, never raw snapshots |
| Temporary files | Ephemeral by default |
| AI model weights | Content-addressed cache |
| Network connections | Re-establish on restart |

## Execution tiers

| Capability | Browser | Desktop / IDE | Cloud | On-prem |
|---|---|---|---|---|
| Interactive execution | Yes | Yes | Yes | Yes |
| Local AI inference | Yes | Yes | Host-dependent | Yes |
| Offline execution | Supported target | Supported target | No | Supported target |
| Persistent jobs | Session-bound | Host-dependent | Yes | Yes |
| Public hosting | Requires gateway | Requires gateway | Yes | Configurable |
| Native processes | Restricted | Yes | Host-dependent | Yes |
| Agent workforce | Yes | Yes | Yes | Yes |

These are target capabilities. Browser execution cannot guarantee operation after the browser closes, and Cloudflare Workers cannot execute arbitrary native binaries. The runtime exposes the constraint through capability detection.

## Definition of done

- All supported application types use the same manifest parser.
- Browser and IDE execute the same reference application.
- Frontend, API and database communicate through the service graph.
- Environment recovery passes forced-termination tests.
- Every runtime exposes resource usage and security events.
- Unsupported runtime capabilities fail explicitly rather than silently.

## Entries

### WC-01 — Current performance and regression baseline

```yaml roadmap
id: WC-01
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies: []
objective: Current performance and regression baseline.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-02 — Application Manifest v1

```yaml roadmap
id: WC-02
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-01
objective: Application Manifest v1.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-03 — Shared application detection

```yaml roadmap
id: WC-03
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-02
objective: Shared application detection.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-04 — Multi-service orchestration

```yaml roadmap
id: WC-04
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-02
  - WC-03
objective: Multi-service orchestration.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-05 — Virtual networking and ingress

```yaml roadmap
id: WC-05
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-04
objective: Virtual networking and ingress.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-06 — Live application preview

```yaml roadmap
id: WC-06
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-05
  - SEC-03
objective: Live application preview.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-07 — Python and PHP runtime completion

```yaml roadmap
id: WC-07
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-02
objective: Python and PHP runtime completion.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-08 — .NET and Rust runtimes

```yaml roadmap
id: WC-08
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: .NET and Rust runtimes.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-09 — Database and storage providers

```yaml roadmap
id: WC-09
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-04
objective: Database and storage providers.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-10 — Redis and queue providers

```yaml roadmap
id: WC-10
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: Redis and queue providers.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-11 — Scheduled jobs and background workers

```yaml roadmap
id: WC-11
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-04
objective: Scheduled jobs and background workers.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-12 — Environment lifecycle management

```yaml roadmap
id: WC-12
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-02
objective: Environment lifecycle management.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-13 — State persistence and recovery

```yaml roadmap
id: WC-13
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-12
objective: State persistence and recovery.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-14 — Nested execution environments

```yaml roadmap
id: WC-14
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: Nested execution environments.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-15 — Runtime observability

```yaml roadmap
id: WC-15
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-04
objective: Runtime observability.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-16 — Cross-host execution portability

```yaml roadmap
id: WC-16
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: Cross-host execution portability.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-17 — Starter kit registry

```yaml roadmap
id: WC-17
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: Starter kit registry.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-18 — Resource scheduling and quotas

```yaml roadmap
id: WC-18
program: webcontainers
priority: P0
status: planned
arc: make
source: PRD-31
dependencies:
  - WC-12
objective: Resource scheduling and quotas.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-19 — Multi-tenant runtime virtualization

```yaml roadmap
id: WC-19
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: Multi-tenant runtime virtualization.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### WC-20 — AI training and inference services

```yaml roadmap
id: WC-20
program: webcontainers
priority: P1
status: planned
arc: make
source: PRD-31
dependencies: []
objective: AI training and inference services.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
