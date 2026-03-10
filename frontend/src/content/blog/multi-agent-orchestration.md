---
title: Multi-Agent Orchestration with the Builderforce Mesh
date: 2026-02-28
description: How to compose multiple specialised AI agents into collaborative workflows using the Builderforce Mesh — routing tasks, sharing context, and coordinating output.
tags: [multi-agent, orchestration, mesh, architecture]
author: Sean Hogg
---

# Multi-Agent Orchestration with the Builderforce Mesh

A single generalist agent can answer questions, write code, and draft emails. But real-world workflows often need **specialist agents working in concert**: a planner, a coder, a reviewer, a deployer. The Builderforce Mesh is the layer that connects them.

## The Mesh Mental Model

Think of the Mesh as a message bus between agents. Each agent is a **node** that:

- Subscribes to a set of **task types** it can handle
- Publishes results back to the bus
- Can invoke other agents as sub-tasks

The orchestrator (which can itself be an agent) decomposes a high-level goal into sub-tasks and routes each one to the most capable node.

```
User prompt
    │
    ▼
Orchestrator Agent
    ├── → Planner Agent      → Plan document
    ├── → Coder Agent        → Implementation
    │       └── → Reviewer Agent → Code review
    └── → Deployer Agent     → Deployment manifest
```

## Registering Agents in the Workforce

Before you can orchestrate, agents need to be **published** to the Workforce Registry. Each agent declares:

- A **name** and **description** visible to other agents
- A set of **skills** (structured capability tags)
- An **endpoint** (the CoderClaw bridge that runs the agent)

Publishing is a one-click operation from the IDE's Publish tab after training.

## Setting Up a Mesh Workflow

### 1. Define Roles

Decide which specialist agents your workflow needs. A software-delivery pipeline might use:

| Role | Responsibility |
|------|---------------|
| `planner` | Breaks the feature request into tasks |
| `coder` | Implements each task in TypeScript |
| `reviewer` | Reviews PRs for correctness and style |
| `tester` | Writes and runs unit tests |

### 2. Assign Skills

From the [Skills](/skills) page, assign the relevant skills to each agent's Claw. Skills inject domain knowledge — a `coder` agent with the `typescript-strict` skill, for example, will enforce stricter type safety in its output.

### 3. Wire Up the Orchestrator

The orchestrator agent receives the initial prompt and fans out sub-tasks. In a Builderforce project, you can define the orchestration logic in a chat-system-prompt:

```
You are an orchestrator. When given a feature request:
1. Use the Planner to generate a task breakdown
2. For each task, invoke the Coder
3. Route each completed task to the Reviewer
4. Aggregate reviewed code and return the final diff
```

The Mesh handles routing — the orchestrator simply calls agent skills by name.

## Context Sharing

Agents share context through **structured handoffs** — JSON payloads that carry task state, prior outputs, and metadata. Builderforce automatically serialises and deserialises these payloads, so each agent receives exactly the context it needs.

Long-running context (conversation history, code artefacts) can be pinned to a shared R2 bucket and referenced by ID, keeping payloads small.

## Observability

The [Observability](/observability) page gives you a real-time view of:

- Message flow between agents
- Latency per node
- Error rates and retries
- Token usage across the mesh

This is invaluable when debugging complex multi-agent workflows — you can see exactly where a task stalled or which agent produced unexpected output.

## Best Practices

**Keep agents small and focused.** A coder agent that only writes Python is easier to evaluate and improve than one that writes code, reviews it, and also deploys it.

**Use AI evaluation on each agent independently.** Fine-tune with targeted datasets rather than one giant corpus. The Workforce Registry's eval scores make it easy to compare agent versions.

**Version your agents.** Publish a new version when you retrain, and pin the orchestrator to specific agent versions during development to avoid regressions.

## Getting Started

Ready to build a mesh? Start by [training two agents](/dashboard) — a planner and a coder — publishing both, then creating an orchestrator project that references them. The [Chats](/chats) interface lets you test the orchestrated workflow interactively before committing to a production pipeline.
