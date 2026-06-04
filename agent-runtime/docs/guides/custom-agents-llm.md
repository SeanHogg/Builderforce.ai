# Custom BuilderForce Agentss with a Custom LLM

> **See also:** [Architecture](../ARCHITECTURE.md) · [Agent Personas](agent-personas.md) · [Business Roadmap](../BUSINESS_ROADMAP.md)  
> **IDE spec reference:** `ide-architecture (1).md` in the repository root — the Builderforce.ai IDE
> architecture document (v2.0, March 2026). The filename with `(1)` is the verbatim filename as
> it exists in the repo root.

This guide describes how BuilderForce Agents is extended to support **custom builderforces** — AI
coding agents that have been **fine-tuned in the Builderforce IDE** and published to the
**Workforce Registry** — and how each such agent brings its own custom LLM that BuilderForce Agents
uses automatically.

---

## Table of Contents

1. [Overview](#1-overview)
2. [What the IDE Spec Introduces](#2-what-the-ide-spec-introduces)
3. [Agent Package Format](#3-agent-package-format)
4. [Changes to BuilderForce Agents](#4-changes-to-builderforce)
   - 4.1 [New TypeScript Types](#41-new-typescript-types)
   - 4.2 [New CLI Commands](#42-new-cli-commands)
   - 4.3 [Init Wizard Extension](#43-init-wizard-extension)
   - 4.4 [Session Banner Extension](#44-session-banner-extension)
   - 4.5 [Inference Routing](#45-inference-routing)
   - 4.6 [Mamba State Engine Integration](#46-mamba-state-engine-integration)
5. [Workforce Agent Installation Walkthrough](#5-workforce-agent-installation-walkthrough)
6. [Per-Agent LLM Configuration Reference](#6-per-agent-llm-configuration-reference)
7. [Hybrid Local Brain Inference Flow](#7-hybrid-local-brain-inference-flow)
8. [Persona YAML Extension for Fine-Tuned Agents](#8-persona-yaml-extension-for-fine-tuned-agents)
9. [Future Work](#9-future-work)

---

## 1. Overview

The **Builderforce.ai IDE** allows developers to:

1. Generate instruction-tuning datasets from a capability prompt.
2. Fine-tune a base model (e.g. CodeParrot 350M, StarCoder 1B) in-browser using WebGPU
   LoRA training.
3. Evaluate the trained agent (code correctness, hallucination rate).
4. Publish the agent — with its LoRA adapter and optional Mamba memory state — to the
   **Workforce Registry**.

Once an agent is published it can be **installed into any BuilderForce Agents project** using the new
`builderforce agent install` command. After installation the agent's custom LLM is used
automatically for all inference in that project — no extra configuration required.

---

## 2. What the IDE Spec Introduces

### LoRA Fine-Tuning Pipeline

Models up to 2 B parameters train in-browser via WebGPU LoRA. The adapter (`adapter.bin`)
is stored in Cloudflare R2 and referenced by an `r2_artifact_key` in the agent record.

### Mamba State Engine (v2.0 agents)

Agents trained with Memory or Hybrid mode carry a compact State Space Model (SSM) state
vector alongside the LoRA adapter. This vector encodes the agent's learned interaction
history and is re-injected as context on every inference call, giving the agent persistent
"memory" without re-training.

```
MambaStateSnapshot {
  data:     Float32[]   // channels × order values
  dim:      number      // input embedding dimension (default 64)
  order:    number      // SSM hidden states per channel (default 4)
  channels: number      // parallel channels (default 16)
  step:     number      // monotonic interaction counter
}
```

### Agent Runtime SDK

The `createAgentRuntime()` SDK wraps:

1. The Mamba state engine (`engine.step()`)
2. Local LLM inference via the Builderforce Workers AI proxy
3. Confidence scoring → optional cloud escalation

### Workforce Registry API

| Method | Endpoint                  | Description                          |
| ------ | ------------------------- | ------------------------------------ |
| `GET`  | `/api/agents`             | List all published agents            |
| `GET`  | `/api/agents/:id`         | Agent metadata                       |
| `GET`  | `/api/agents/:id/package` | Download portable agent package JSON |
| `POST` | `/api/agents/:id/hire`    | Increment hire count                 |

---

## 3. Agent Package Format

### v1.0 — LoRA Only

```jsonc
{
  "version": "1.0",
  "platform": "builderforce.ai",
  "name": "PythonExpert",
  "title": "Python Error Explanation Specialist",
  "bio": "Explains Python tracebacks in plain English",
  "skills": ["python", "debugging", "error-analysis"],
  "base_model": "codeparrot-350m",
  "lora_config": {
    "rank": 8,
    "alpha": 16,
    "target_modules": ["q_proj", "v_proj"],
  },
  "training_job_id": "job_abc123",
  "r2_artifact_key": "artifacts/proj_xyz/job_abc123/adapter.bin",
  "resume_md": "# PythonExpert\n\nSpecialises in ...",
  "created_at": "2026-03-18T07:00:00.000Z",
}
```

### v2.0 — LoRA + Mamba State

```jsonc
{
  "version": "2.0",
  "platform": "builderforce.ai",
  "name": "PythonExpert",
  "title": "Python Error Explanation Specialist",
  "bio": "Explains Python tracebacks in plain English",
  "skills": ["python", "debugging", "error-analysis"],
  "base_model": "codeparrot-350m",
  "lora_config": {
    "rank": 8,
    "alpha": 16,
    "target_modules": ["q_proj", "v_proj"],
  },
  "mamba_state": {
    "data": [0.12, -0.05, 0.31 /* ... 64 floats */],
    "dim": 64,
    "order": 4,
    "channels": 16,
    "step": 142,
  },
  "training_job_id": "job_abc123",
  "r2_artifact_key": "artifacts/proj_xyz/job_abc123/adapter.bin",
  "created_at": "2026-03-18T07:00:00.000Z",
}
```

---

## 4. Changes to BuilderForce Agents

### 4.1 New TypeScript Types

**File:** `src/builderforce/types.ts`

Three new types are added:

#### `AgentPackage` (union of v1.0 / v2.0)

```typescript
export type AgentPackageV1 = {
  version: "1.0";
  platform: "builderforce.ai";
  name: string;
  title: string;
  // ...
  lora_config: LoraConfig;
  r2_artifact_key?: string;
  created_at: string;
};

export type AgentPackageV2 = {
  version: "2.0";
  // same as v1.0 plus:
  mamba_state?: MambaStateSnapshot;
  // ...
};

export type AgentPackage = AgentPackageV1 | AgentPackageV2;
```

#### `MambaStateSnapshot`

Mirrors the IDE's in-browser type so the snapshot can be embedded in
`context.yaml` and restored by a future Mamba runtime integration.

#### `InstalledWorkforceAgent`

Stored under `customAgent` in `.builderforce/context.yaml` after `builderforce agent install`:

```typescript
export type InstalledWorkforceAgent = {
  agentId: string; // Workforce Registry UUID
  name: string; // Display name
  title?: string; // Short title
  baseModel: string; // e.g. "codeparrot-350m"
  modelRef: string; // BuilderForce Agents model reference used at runtime
  loraArtifactKey?: string; // R2 key for the LoRA adapter
  packageVersion: "1.0" | "2.0";
  hasMambaState: boolean;
  installedAt: string; // ISO 8601
  registryUrl: string; // Which registry it came from
};
```

#### `ProjectContext` extension

```typescript
export type ProjectContext = {
  // ... existing fields ...
  llm?: { provider: string; model: string };
  /**
   * Workforce agent installed via `builderforce agent install`.
   * When present, the agent's custom LLM is used by default.
   */
  customAgent?: InstalledWorkforceAgent;
  // ...
};
```

---

### 4.2 New CLI Commands

**File:** `src/commands/workforce-agent.ts`  
**Registered in:** `src/cli/program/command-registry.ts` → `src/commands/builderforce.ts`

#### `builderforce agent install <agentId>`

Downloads the agent package from the Builderforce Workforce Registry and writes
`InstalledWorkforceAgent` metadata into `.builderforce/context.yaml`. Also sets the project's
default `llm.model` to the Workforce model reference.

```bash
# Install by agent UUID
builderforce agent install 550e8400-e29b-41d4-a716-446655440000

# Install from a self-hosted registry
builderforce agent install PythonExpert --registry https://my.builderforce.ai

# Install into a non-CWD project
builderforce agent install PythonExpert --path /home/user/my-project
```

**Internal flow:**

```
1. fetchAgentPackage(agentId, registryUrl)
   └── GET /api/agents/:id/package   (Bearer: BUILDERFORCE_AGENTS_LINK_API_KEY if set)
2. resolveWorkforceModelRef(agentId, pkg)
   ├── if BUILDERFORCE_AGENTS_LINK_API_KEY set  → "builderforcellm/workforce-<agentId>"
   └── else                           → pkg.base_model (requires local server)
3. updateProjectContextFields(projectRoot, { customAgent, llm })
4. Print summary
```

#### `builderforce agent info`

Shows the metadata of the currently installed Workforce agent.

```bash
builderforce agent info
```

**Output example:**

```
┌─────────────────────────────────────────────┐
│ Installed Agent                               │
│  ID:           550e8400-e29b-41d4-a716-…    │
│  Name:         PythonExpert — Python Error…  │
│  Base model:   codeparrot-350m               │
│  Model ref:    builderforcellm/workforce-550e… │
│  Package:      v2.0                          │
│  Mamba state:  yes (persistent memory)       │
│  Installed:    2026-03-18T09:00:00.000Z      │
│  Registry:     https://api.builderforce.ai   │
└─────────────────────────────────────────────┘
```

#### `builderforce agent remove`

Removes the installed agent and reverts the project's default LLM to
`builderforcellm/auto`.

```bash
builderforce agent remove
```

---

### 4.3 Init Wizard Extension

**File:** `src/commands/builderforce.ts`

A new provider option **"Builderforce Workforce Agent (custom trained LLM)"** is added to
the `builderforce init` LLM provider wizard (`promptLlmProvider`).

```
? LLM provider to use for AI agents:
  ○ BuilderForce AgentsLLM (recommended) — BuilderForce.AI (free pool)
  ○ Anthropic (Claude)
  ○ OpenAI (GPT-4o)
  ○ OpenRouter
  ○ Google Gemini
  ○ Ollama (local)
  ○ vLLM / llama.cpp / LiteLLM (local)
  ● Builderforce Workforce Agent (custom trained LLM)   ← NEW
  ○ Skip — configure later
```

When selected, the wizard:

1. Prompts for the Builderforce registry URL (default: `https://api.builderforce.ai`)
2. Prompts for the Workforce agent ID
3. Calls `installWorkforceAgent()` inline
4. Falls back gracefully if the registry is unreachable (shows retry instructions)

---

### 4.4 Session Banner Extension

**File:** `src/commands/builderforce.ts` → `runBuilderForce AgentsSession()`

The session banner already shows `context.llm.provider · context.llm.model`. Because
`installWorkforceAgent()` writes the `llm` field as part of installation, the banner
automatically reflects the custom agent without any further changes.

**Example banner after install:**

```
BuilderForce Agents v2026.3.18
  builderforcellm · builderforcellm/workforce-550e8400-e29b-41d4-a716-446655440000
  🔗 Builderforce · my-project
  /home/user/my-project
  type a message, /help for commands, Ctrl+C to exit
```

For richer feedback, the banner can optionally read `context.customAgent` and display the
agent name:

```diff
- lines.push(theme.muted(`  ${context.llm.provider} · ${context.llm.model}`));
+ const agentLabel = context.customAgent
+   ? `${context.customAgent.name} (${context.llm.model})`
+   : context.llm.model;
+ lines.push(theme.muted(`  ${context.llm.provider} · ${agentLabel}`));
```

---

### 4.5 Inference Routing

The `resolveWorkforceModelRef()` function in `src/commands/workforce-agent.ts` determines
how BuilderForce Agents routes inference for a Workforce agent:

| Scenario                   | Model reference                         | Notes                                                                                                        |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **BuilderForce AgentsLLM connected** | `builderforcellm/workforce-<agentId>`      | Managed proxy loads the LoRA adapter on the Builderforce inference cluster                                   |
| **No BuilderForce AgentsLLM key**    | `<base_model>` (e.g. `codeparrot-350m`) | Falls back to the base model; the user must provide a local server (Ollama / vLLM) that serves this model ID |

For the managed proxy route, no additional configuration is required — the
`BUILDERFORCE_AGENTS_LINK_API_KEY` (set during `builderforce init --reconnect`) is used to authenticate
and the Builderforce gateway fetches the LoRA artifact from R2 and mounts it for the
request.

#### Required provider configuration (managed route)

`src/agents/models-config.providers.ts` already defines the `builderforcellm` provider.
A future update should add a `workforce-` model pattern to the provider's model list so it
can be auto-discovered at runtime:

```typescript
// In buildBuilderForceAgentsllmProvider():
models: [
  { id: "auto", name: "BuilderForce AgentsLLM Auto", ... },
  // Workforce agents are resolved dynamically by the proxy
  // using the "workforce-<agentId>" suffix pattern.
  // No static registration needed — the proxy accepts any "workforce-*" ID.
]
```

---

### 4.6 Mamba State Engine Integration

The IDE spec describes a WebGPU + WGSL Mamba State Engine with a JavaScript fallback.
For the **BuilderForce Agents CLI runtime** (Node.js), the integration path is:

#### Short term (v1) — Context injection only

The `MambaStateSnapshot` is serialised into `.builderforce/context.yaml` as part of the agent
package. The session start code reads `context.customAgent.mamba_state` (when present) and
injects a compact memory context string into the system prompt before every inference call:

```
[Memory: step=142 signal=0.73 context="prior session → last task completed"]
```

This mirrors the IDE's `engine.step()` output format and requires no WebGPU.

#### Medium term (v2) — JS SSM recurrence

A new `src/agents/mamba-state-engine.ts` module implements the SSM recurrence in pure
JavaScript for the Node.js path:

```typescript
// SSM recurrence: h_{t+1} = A_disc · h_t + B_disc · x_t
export function jsSelectiveScan(params: {
  state: MambaStateSnapshot;
  inputEmbedding: Float32Array;
}): { nextState: MambaStateSnapshot; output: Float32Array } { ... }
```

The state is persisted to `.builderforce/memory/mamba-state.json` after every session and
loaded on startup.

#### Long term (v3) — Native WASM/addon

Bundle the Mamba WGSL kernel as a WASM module for CPU-only environments (no WebGPU in
Node.js), matching the IDE's `mamba_scan.wgsl` exactly.

---

## 5. Workforce Agent Installation Walkthrough

### Step 1 — Train and publish in the Builderforce IDE

1. Open the **🧠 Train** panel.
2. Enter a capability prompt, e.g. _"Explain Python tracebacks in plain English"_.
3. Click **✨ Generate** → 50 instruction examples stream from the LLM.
4. Select **CodeParrot 350M** as the base model.
5. Click **▶ Start Training** — WebGPU LoRA training runs in-browser.
6. Click **🧪 Evaluate** to score the model (aim for > 80 %).
7. Switch to **🚀 Publish**, fill the agent profile, and click **🌐 Publish**.
8. Note your agent's UUID from the success screen.

### Step 2 — Install in BuilderForce Agents

```bash
# From your project root (must be a BuilderForce Agents project: run init first)
builderforce agent install 550e8400-e29b-41d4-a716-446655440000
```

Output:

```
◆  BuilderForce Agents agent install
◇  Package downloaded: PythonExpert (v2.0)

Workforce agent installed: PythonExpert (550e8400-…)
  Base model:   codeparrot-350m
  Package:      v2.0
  Mamba state:  yes (persistent memory)
  Model ref:    builderforcellm/workforce-550e8400-…
```

### Step 3 — Start a session

```bash
builderforce .
```

The session banner now shows your custom agent:

```
BuilderForce Agents v2026.3.18
  builderforcellm · builderforcellm/workforce-550e8400-…
  /home/user/my-python-project
```

All inference in this session is routed through the fine-tuned model.

---

## 6. Per-Agent LLM Configuration Reference

### `.builderforce/context.yaml` after install

```yaml
version: 1
projectName: my-python-project
# ... other fields ...
llm:
  provider: builderforcellm
  model: builderforcellm/workforce-550e8400-e29b-41d4-a716-446655440000
customAgent:
  agentId: 550e8400-e29b-41d4-a716-446655440000
  name: PythonExpert
  title: Python Error Explanation Specialist
  baseModel: codeparrot-350m
  modelRef: builderforcellm/workforce-550e8400-e29b-41d4-a716-446655440000
  loraArtifactKey: artifacts/proj_xyz/job_abc123/adapter.bin
  packageVersion: "2.0"
  hasMambaState: true
  installedAt: "2026-03-18T09:00:00.000Z"
  registryUrl: https://api.builderforce.ai
```

### Overriding per-session

A custom agent set via `context.yaml` is the project default. You can still override the
model for a single session using the `/model` TUI command or the `--model` flag:

```bash
# Use default (custom trained) agent
builderforce .

# Override to a different model for this session only
builderforce . --model anthropic/claude-opus-4-6
```

### Per-agent-role override

You can give a workflow role a different model than the installed Workforce agent by setting
`model` in the persona YAML:

```yaml
# .builderforce/personas/security-reviewer.yaml
name: security-reviewer
model: anthropic/claude-opus-4-6 # use Claude for security passes
```

The orchestrator merges per-role model overrides on top of the project default.

---

## 7. Hybrid Local Brain Inference Flow

The IDE spec's **Hybrid Local Brain** pattern maps onto BuilderForce Agents as follows:

```
User message
     │
     ▼
1. Mamba step (if hasMambaState)
   └── advanceMambaState(message) → memoryContext string
     │
     ▼
2. Assemble system prompt
   └── [file context] + [project context] + [Mamba memory context]
     │
     ▼
3. Primary inference
   └── POST /v1/chat/completions
         model: builderforcellm/workforce-<agentId>
         (Builderforce proxy loads LoRA adapter from R2)
     │
     ▼
4. Confidence scoring (optional, default disabled in CLI)
   └── if score < 0.4 → escalate to cloud provider
     │
     ▼
5. Persist Mamba state
   └── writeFile(.builderforce/memory/mamba-state.json)
```

For step 4, confidence scoring is opt-in via a config flag (future work):

```yaml
# builderforce.json5 (global config)
agents:
  defaults:
    hybridInference:
      enabled: true
      confidenceThreshold: 0.4
      escalationProvider: anthropic/claude-sonnet-4-6
```

---

## 8. Persona YAML Extension for Fine-Tuned Agents

Custom personas (`.builderforce/personas/*.yaml`) gain two new optional fields to reference a
Workforce agent:

```yaml
name: python-expert
description: "Python error explanation and debugging"

# NEW — link this persona to a Workforce agent
workforceAgentId: 550e8400-e29b-41d4-a716-446655440000
# If set, the persona's model resolves to builderforcellm/workforce-<id>
# (overrides any model: field in this file)

# Standard persona fields
capabilities:
  - Python traceback analysis
  - Stack trace root cause identification
  - Plain-English error explanation

tools: [view, grep, bash]
persona:
  voice: "patient and educational"
  perspective: "every error is a learning opportunity"
  decisionStyle: "explain first, then fix"
```

When `workforceAgentId` is set, `spawnSubagentDirect()` passes `model: resolveWorkforceModelRef(workforceAgentId)` to the sub-agent, overriding any other model selection.

**Required code change:**

`src/builderforce/types.ts` → `AgentRole`:

```typescript
export type AgentRole = {
  // ... existing fields ...
  model?: string;
  /** Workforce Registry agent ID — overrides model when set */
  workforceAgentId?: string;
  // ...
};
```

`src/builderforce/orchestrator.ts` → `spawnSubagentDirect()`:

```typescript
// Resolve model — Workforce agent takes precedence
const model = role.workforceAgentId
  ? resolveWorkforceModelRef({ agentId: role.workforceAgentId, pkg: ctx.agentPackage })
  : (role.model ?? cfg.agents?.defaults?.model);
```

---

## 9. Future Work

| Area                           | Description                                                                                              | Priority |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | -------- |
| **CLI key auto-issuance**      | `builderforce init` calls `POST /api/auth/cli-key` after Builderforce login and saves the key automatically | High     |
| **Mamba JS engine**            | `src/agents/mamba-state-engine.ts` — pure JS SSM for Node.js                                             | Medium   |
| **Mamba state persistence**    | Auto-load/save `.builderforce/memory/mamba-state.json`                                                      | Medium   |
| **Mamba state sync**           | After each session push updated state to `PUT /api/agents/:id/mamba-state`                               | Medium   |
| **Confidence scoring**         | Opt-in hybrid inference escalation                                                                       | Low      |
| **`builderforce agent list`**     | Browse and search the Workforce Registry from the CLI                                                    | Medium   |
| **`builderforce agent update`**   | Re-download an updated package version                                                                   | Low      |
| **Persona `workforceAgentId`** | Per-role Workforce agent model binding                                                                   | High     |
| **Provider model entry**       | Add `workforce-*` pattern to `buildBuilderForceAgentsllmProvider()` model list                                    | High     |
| **`/model workforce`**         | TUI shortcut to switch to the installed Workforce agent                                                  | Low      |
| **Agent State Viewer TUI**     | `/state` command to inspect Mamba memory (mirrors IDE's 🔬 State tab)                                    | Low      |

> **See also:** [Builderforce.ai Custom LLM Changes](builderforce-custom-llm.md) — the
> required backend / IDE changes that enable the Builderforce side of this integration.

---

_Last updated: March 2026_
