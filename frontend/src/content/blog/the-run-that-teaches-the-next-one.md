---
title: The run that teaches the next one
date: 2026-09-07
description: An agent that finishes verified work has just executed a procedure that works — and it used to vanish into a transcript. Agents now propose what they learned as a skill, your team approves it, and every later run follows it.
tags: [agents, skills, governance, observability, mcp, product]
author: Sean Hogg
---

# The run that teaches the next one

An agent picks up a ticket, works out that a schema change here needs a declaration in one module, a hand-written migration, and two guards run in a particular order, gets it merged, and finishes.

Tomorrow another agent picks up the next schema ticket and works all of that out again.

That is the shape of the thing this release closes. Not "the agent was not smart enough" — it was smart enough, twice. The problem was that everything it figured out lived in a transcript nobody reads, and there was no object in the product for "a procedure that worked here."

## A skill is a procedure, and now an agent can write one

Skills already existed: fifty-four of them bundled with the runtime, plus a marketplace. Every write path went through a person. So the only procedures agents could follow were the ones a human had sat down and written.

An agent can now propose one. The bar is deliberately high — a verified result, meaning merged work or a graded run that actually produced something — and the invitation says so plainly, because a reflection step that fires on every run produces a catalogue of confident nonsense.

```bf-figure
{
  "kind": "flow",
  "title": "How a procedure becomes something every agent follows",
  "steps": [
    { "label": "Run", "note": "An agent does the work and reaches a verified result — merged, or committed with its checks passing.", "hue": "make" },
    { "label": "Reflect", "note": "Before finishing, it distils the repeatable part: the steps, the exact commands, and how to tell it worked.", "hue": "idea" },
    { "label": "Review", "note": "The proposal lands as a draft with the run that wrote it and the evidence it offered. Nobody's prompt has changed yet.", "hue": "accent", "tag": "a person decides" },
    { "label": "Follow", "note": "Once approved, every agent on the workspace carries it from their next run.", "hue": "make" }
  ],
  "caption": "Three gates, and the middle one is a person. An agent that could publish a skill directly would be an agent that rewrites what every other agent is told to do, on its own say-so, from inside a single run."
}
```

What you review is the whole procedure, not a summary of it — the body, the run that proposed it, and what that run offered as proof. Approving is the moment it becomes binding, so it is the moment you get to read it.

## Three other doors that were locked

The same pass opened three things that were built and unreachable.

**Bring your own tool server.** A complete Model Context Protocol client had been sitting in the codebase — three-legged OAuth, per-tool consent, encrypted secrets, a relay so the credential never touches a browser — with nothing in the product calling it. A tenant could register an external server only by hitting the API by hand. There is now a panel under Settings › Integrations and a command in the VS Code extension, both driving the same routes.

**Governance in the editor.** Policy packs were enforced on cloud and self-hosted runs. The editor had the enforcement code and was never handed any gates, so a rule that blocked a tool in the cloud silently allowed it in VS Code. Both editor surfaces now resolve the same compiled gates at the start of every run, and refuse to start a turn if the policy cannot be read.

**Steering a self-hosted run.** A follow-up direction sent to a running on-premise execution was accepted, saved, and dropped — delivered to a chat session the current engine no longer runs in. It now reaches the live run and is applied as its next turn.

```bf-figure
{
  "kind": "compare",
  "title": "Built versus reachable",
  "columns": [
    { "title": "Before", "hue": "idea", "items": ["An MCP client with no caller", "Editor policy plumbing with no gates", "Steers accepted and dropped", "Runs visible only in our timeline"] },
    { "title": "Now", "hue": "make", "items": ["Register a server from settings or the editor", "The same gate holds in all three modalities", "A steer lands as the run's next turn", "Spans in the collector you already run"] }
  ],
  "caption": "Four capabilities that existed in the codebase and did not exist for anyone using it. The distance between those two states is the whole story of this release."
}
```

## Measuring whether any of it worked

Two things also changed about seeing what agents do.

Runs now export to your own OpenTelemetry collector, so agent work sits beside the rest of your system instead of only in ours — with the health of that export shown next to it, because a collector that has started refusing spans should say so rather than quietly dropping them.

And agent quality is now a series rather than an anecdote. The existing quality signals all scored whatever traffic arrived, so a month-over-month move could be the agents or could be this month's tickets. A benchmark is a fixed set of cases, scored the same way every day, plotted as score and expectation coverage over time.

## Where it sits in the method

The Idea-to-Real arc runs Idea → Make → Run → Measure, and each step of the method asks a question: **Read** what is already true, **Prove** it cheaply, then **Build**.

Everything above lands on the far end of that loop — the half teams reliably skip.

**Read** got a memory that can actually find things. Recall on the cloud path was a keyword match, or worse, an embedding re-rank of ten rows chosen by something other than the question; a relevant memory outside that window was unreachable. It is now a real semantic search fused with the keyword arm, on the same ranking the self-hosted store has always used. A run that reads what earlier runs learned is the first step of the method working as described.

**Measure** got two of them. The benchmark is what makes "are the agents getting better" a question with an answer, and the export is what lets that answer live where your team already looks.

And the skill loop is the arc closing on itself. A run that produced graded proof has completed one full pass of Idea → Make → Run → Measure. Distilling that into a procedure the next run follows is what turns a loop into a spiral: the next Read starts from what the last Measure established, instead of from nothing.

That was always the claim. It is now a thing the product does.
