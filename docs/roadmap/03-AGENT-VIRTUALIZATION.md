# AVR — Agent Virtualization Runtime

**Priority: P0.** Self-contained agent workforces. An environment hosts an entire autonomous workforce, including an Agent Factory that creates further agents and child environments.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Architecture decision

Do not virtualize the whole of VS Code. Extract the Brain execution engine and provide compatible adapters for the VS Code APIs it needs, so one agent implementation is portable across WebContainers, desktop, cloud and the VSIX.

Nested runtimes inherit parent restrictions: maximum depth, execution budgets, permissions and resource quotas. A child runtime never acquires a privilege its parent lacks.


## Entries

### AVR-01 — Portable Brain execution host

```yaml roadmap
id: AVR-01
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Portable Brain execution host.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-02 — Virtualized VSIX-compatible host APIs

```yaml roadmap
id: AVR-02
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-01
objective: Virtualized VSIX-compatible host APIs.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-03 — Agent lifecycle management

```yaml roadmap
id: AVR-03
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-01
objective: Agent lifecycle management.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-04 — Agent manifests and role contracts

```yaml roadmap
id: AVR-04
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-03
objective: Agent manifests and role contracts.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-05 — Agent-specific LLM configuration

```yaml roadmap
id: AVR-05
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Agent-specific LLM configuration.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-06 — Scoped MCP tool registry

```yaml roadmap
id: AVR-06
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-04
objective: Scoped MCP tool registry.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-07 — Agent-to-agent communication

```yaml roadmap
id: AVR-07
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-04
objective: Agent-to-agent communication.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-08 — Shared and private agent memory

```yaml roadmap
id: AVR-08
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - MEM-02
objective: Shared and private agent memory.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-09 — Agent checkpoint and restart

```yaml roadmap
id: AVR-09
program: agent-virtualization
priority: P0
status: planned
arc: make
source: PRD-49
dependencies:
  - WC-13
objective: Agent checkpoint and restart.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-10 — Agent Factory

```yaml roadmap
id: AVR-10
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-04
  - SEC-08
objective: Agent Factory.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-11 — Runtime-within-runtime

```yaml roadmap
id: AVR-11
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies:
  - AVR-10
objective: Runtime-within-runtime.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-12 — Agent-generated agent code

```yaml roadmap
id: AVR-12
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Agent-generated agent code.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-13 — Specialized knowledge pack generation

```yaml roadmap
id: AVR-13
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Specialized knowledge pack generation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-14 — Agent evaluation and promotion

```yaml roadmap
id: AVR-14
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Agent evaluation and promotion.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-15 — Model training and adaptation

```yaml roadmap
id: AVR-15
program: agent-virtualization
priority: P2
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Model training and adaptation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-16 — Workforce starter kits

```yaml roadmap
id: AVR-16
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies: []
objective: Workforce starter kits.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AVR-17 — 3D workforce visualization

```yaml roadmap
id: AVR-17
program: agent-virtualization
priority: P1
status: planned
arc: make
source: PRD-49
dependencies: []
objective: 3D workforce visualization.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
