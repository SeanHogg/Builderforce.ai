---
title: Your agents join the Room
date: 2026-11-24
description: Each agent you declare now appears in the Room. Its avatar shows what it is really doing, derived from its run events. Open it to see its role, tools and history, steer it or cancel the run, and after a recovery the Room rebuilds from where each agent stopped.
tags: [agents, collaboration, observability, webcontainers, idea-to-real, product]
author: Sean Hogg
---

# Your agents join the Room

[Agents now run inside your app](/blog/agents-that-run-inside-your-app). That is useful only if you can see them. An agent working out of sight is one you find out about when it is done, or when it has gone the wrong way for twenty steps.

So **each agent you declare now appears in the Room, beside the rest of your project, and you can watch it, steer it and stop it there.**

## A state you can trust

An agent's avatar shows one of six states: **idle, thinking, executing, waiting, failed** or **recovering**. The state is derived from the agent's own run events through the same run snapshot the rest of Builderforce reads. Nothing is animated for show. If the avatar says executing, a tool call is running.

```bf-figure
{
  "kind": "flow",
  "title": "Where an avatar's state comes from",
  "steps": [
    { "label": "Run events", "note": "Model calls, tool calls, notes and errors, as the agent's run records them.", "hue": "make" },
    { "label": "Run snapshot", "note": "The one hook every run view reads. No second source of truth.", "hue": "run" },
    { "label": "Avatar state", "note": "Idle, thinking, executing, waiting, failed or recovering.", "hue": "measure" }
  ],
  "caption": "A scripted event stream drives the states in the component tests, so what you see is what the run did."
}
```

## Open an agent

Click an agent and a panel slides out with:

- its **status**;
- its **declaration**: role, workload, instructions and memory;
- the **tools** it may use;
- its **history**, step by step, from model calls and tool calls to notes and errors.

If it is heading the wrong way, type a direction and **steer** it, or **cancel** the run. **Ask Brain about this agent** opens the chat you already use, with the agent's name and role filled in, so you can ask what it is doing and what it needs from you.

## Close the tab, come back

If the tab closes mid-run, the environment recovers when you return, and the Room rebuilds from that restored state. An agent that was recovered says so, and its history shows where it picked up.

The panel works in light and dark mode, on a 360-pixel screen, and in all five languages.
