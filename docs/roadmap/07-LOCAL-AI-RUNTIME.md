# AI — Local AI Runtime

**Priority: P1.** Reduce external inference dependency. The local runtime serves autonomous execution; its objective is the cost of completing verified work, not an independent research programme.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Routing tiers

Tier 0 deterministic tools (search, AST, rules, cached results) → Tier 1 local models (extraction, routine edits, summaries) → Tier 2 frontier models (complex reasoning, review, escalation). Verification and outcome scoring decide future routing.

Training proprietary models must not delay reliable autonomous execution.


## Entries

### AI-01 — Real browser WebGPU inference acceptance

```yaml roadmap
id: AI-01
program: local-ai-runtime
priority: P0
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Real browser WebGPU inference acceptance.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-02 — Shared inference provider contract

```yaml roadmap
id: AI-02
program: local-ai-runtime
priority: P0
status: planned
arc: make
source: PRD-05
dependencies:
  - AI-01
objective: Shared inference provider contract.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-03 — ONNX runtime integration

```yaml roadmap
id: AI-03
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: ONNX runtime integration.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-04 — WebLLM and Transformers.js integration

```yaml roadmap
id: AI-04
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: WebLLM and Transformers.js integration.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-05 — CPU inference optimization

```yaml roadmap
id: AI-05
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: CPU inference optimization.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-06 — Local-first task routing

```yaml roadmap
id: AI-06
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Local-first task routing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-07 — Model download and caching

```yaml roadmap
id: AI-07
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Model download and caching.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-08 — Prefix and semantic caching

```yaml roadmap
id: AI-08
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Prefix and semantic caching.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-09 — Context compression

```yaml roadmap
id: AI-09
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Context compression.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-10 — Parallel model execution

```yaml roadmap
id: AI-10
program: local-ai-runtime
priority: P2
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Parallel model execution.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-11 — LoRA and model adaptation

```yaml roadmap
id: AI-11
program: local-ai-runtime
priority: P2
status: planned
arc: make
source: PRD-05
dependencies: []
objective: LoRA and model adaptation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-12 — Agent-generated model evaluations

```yaml roadmap
id: AI-12
program: local-ai-runtime
priority: P1
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Agent-generated model evaluations.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-13 — Model portability and Hugging Face export

```yaml roadmap
id: AI-13
program: local-ai-runtime
priority: P2
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Model portability and Hugging Face export.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### AI-14 — Cost-per-successful-task optimization

```yaml roadmap
id: AI-14
program: local-ai-runtime
priority: P0
status: planned
arc: make
source: PRD-05
dependencies: []
objective: Cost-per-successful-task optimization.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
