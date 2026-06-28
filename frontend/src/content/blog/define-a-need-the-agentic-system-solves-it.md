---
title: "Define a Need, the Agentic System Solves It — One Spine Under Every Agent"
date: 2026-06-28
description: Any human defines a need in plain language, a dataset, a process chart, or a persona — and Builderforce.ai compiles it into an agent that runs in the IDE, on the desktop, or in the cloud. The compile primitive that unifies the platform is now live, end to end.
tags: [vision, compile-primitive, agent-spec, orchestration, workflows, on-device]
author: Sean Hogg
---

# Define a Need, the Agentic System Solves It — One Spine Under Every Agent

There is a single sentence underneath everything Builderforce.ai builds:

> **Any human defines a need, and the agentic system solves it.**

That sentence sounds simple until you notice how many shapes a "need" comes in. A team lead wants their SOPs reviewed and a leaner process flow proposed. A developer wants to train an agent on the company's proprietary data and stand up a custom agent that handles support calls. An engineer wants the same agent to run in the IDE, on the desktop, or in the cloud — their choice, not the platform's. A manager wants to draw a workflow, a set of process charts, and embed those steps into an agent that executes them.

Four different people, four different needs, four different *modalities* — prose, a dataset, a process chart, a persona. And yet the verb is identical every single time: **turn this need into an agent that runs on the right surface.**

That shared verb is the whole product. We call it the **compile primitive** — and as of this release it is no longer a diagram on a wall. It is a running pipeline you can call.

![The compile primitive: a need in any modality is compiled into one AgentSpec and deployed to any surface](/blog/compile-primitive-spine.svg)

## The shape of a need

Look closely at the four examples and the only thing that actually changes is the *input modality* and the *output surface*:

| The human says… | Modality | Becomes… | Surface |
|---|---|---|---|
| "Review our SOPs and propose a leaner flow." | Diagnostic finding | A runnable improvement process | Workflow |
| "Train on our docs and answer support calls." | Dataset / proprietary data | A grounded custom agent | Cloud / desktop |
| "Run my agent right here in my editor." | (existing agent) | The same agent, relocated | IDE |
| "Here's the process chart — execute these steps." | Process chart | An agent that runs the steps | Cloud / on-prem |

Everything in the middle — the identity of the agent, the model it uses, the persona that shapes how it behaves, the knowledge it recalls, the policy that governs it, the steps it follows — is *the same kind of thing every time*. It is a specification of an agent. So the platform has exactly one of those: an **AgentSpec**.

## The compile primitive

Two pure functions, one canonical thing between them:

```
   NEED  ──▶  compile(need, modality)  ──▶  AgentSpec  ──▶  deploy(AgentSpec, surface)  ──▶  running agent
```

- **`compile`** is a registry of *modality compilers* — one each for plain prose, a dataset (plus your proprietary docs), a process chart, a persona, a diagnostic's findings, and a policy pack. Each one lowers its own kind of need into the same `AgentSpec`. This is the only place in the platform that has to know prose from charts from datasets.
- **`deploy`** is a registry of *surfaces* — IDE, desktop, cloud-durable, cloud-container, and workflow-step. It takes a finished `AgentSpec`, resolves the right engine through one shared DI registry and the right transport for the surface, and hands back a ready-to-dispatch plan.

Between them sits the `AgentSpec`: identity, model, compiled persona, recalled memory, policy gates, and (when the need is a process) the ordered steps. Compile many shapes *in*; deploy to many surfaces *out*; one spec in the middle. Both functions are real code — `compile()` and `deploy()` live in the API, the `AgentSpec` and its single canonical lowering live in the shared `agent-tools` package, and a thin HTTP front door (`POST /api/compile`, `POST /api/compile/run`) exposes the whole pipeline.

The power of the primitive is that the four needs stop being four products.

![Four existing front doors rehomed as compile() adapters that merge into one AgentSpec](/blog/compile-four-doors.svg)

"Train on our data" and "draw a process chart" are two **compile** adapters that merge into the same spec — so you can have a process chart *with* a trained model *with* a persona *with* a governance policy, and it is still one agent. The merge is literal: each adapter emits the slice of the spec it knows about, and the platform folds them into one. "Run it in my IDE" and "run it in the cloud" are two **deploy** targets — so the agent you trained is the agent that runs in your editor, with no second build.

## The plain-language front door

The modality the platform was missing is the most human one: **plain language.** "An agent that triages billing tickets and answers refund questions from our help-center docs" used to have nowhere to go. Now it has a front door at [`/compile`](/compile): you type the need in prose, an extractor lowers it into an `AgentSpec` (identity, skills, an auto-routed model), `deploy()` resolves where it will run, and — if you press *Compile & run* — the platform drives a real first turn through the gateway with the compiled system prompt. Define a need; watch the agent answer. The same `POST /api/compile/run` call is available to any client, so this front door is an endpoint, not just a page.

## Why one spine matters

When persona, memory, and policy live *on the spec* instead of inside one front door, they reach every surface for free.

![Persona, memory, and policy live on the AgentSpec and reach every surface identically](/blog/compile-governance-everywhere.svg)

A persona's temperature changes how the agent behaves whether it runs as a workflow step or a cloud agent. The proprietary documents you trained on are recalled at inference no matter where the agent executes. And a governance gate that requires human approval — or blocks a tool outright — applies in the IDE exactly as it does in the cloud, because the gate is a property of the agent, not of the place it happens to be running. Policy gates render into the system prompt through the shared lowering on every surface, and the *same* gates resolve through one shared `evaluatePolicyGate` decision (block / require-approval / allow) — the single point an engine consults at its tool seam, rather than each surface re-implementing enforcement.

That is the difference between a platform and a pile of features. A pile of features has a training tool, a workflow builder, a persona editor, and a runtime, each with its own private idea of what an agent is. A platform has one idea of what an agent is, and lets you arrive at it from any direction and leave it onto any surface.

## What you can do today

This is not a clean-sheet vision and it is no longer a partial one — the spine is connected end to end:

- **Define a need in plain language** and get a running agent — `/compile` and `POST /api/compile/run`.
- **Compile any modality into one `AgentSpec`** — prose, a dataset with your ingested proprietary docs, a hand-drawn process chart, a compiled persona, a diagnostic's findings, or a policy pack — and **stack them** into a single agent.
- **Deploy that one spec to any surface** — `deploy()` resolves the engine, transport, and lowered run input for IDE, desktop, cloud-durable, cloud-container, or a workflow node.
- **Turn a diagnostic into action** — a maturity finding compiles into an ordered, runnable improvement process instead of a static report.
- **Govern from the spec** — author a policy once and it binds on every surface.

The compile primitive is the spine, and what already stood now stands on it. "Define a need, the agentic system solves it" is no longer four separate doors — it is one door that fits whatever shape your need arrived in, and opens onto whatever surface your work lives on.

You describe the outcome, in the language most natural to you, and a workforce of agents — governed, grounded, and on the surface you choose — goes and gets it. That is what the platform does now.
