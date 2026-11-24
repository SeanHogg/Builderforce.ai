---
title: Agents that run inside your app
date: 2026-11-24
description: Declare agents by role, give each one an allowlist of tools, and they now run inside your app's own environment in the browser tab. They edit files, run the tests and check your services from the inside, and a tool off the list is refused and reported to the Security Shield.
tags: [agents, mcp, webcontainers, open-source, runtime, security, idea-to-real, product]
author: Sean Hogg
---

# Agents that run inside your app

An AI agent that helps you build an app has always worked from the outside. It edits files somewhere, and you find out whether they work when you press Run. If the tests fail, you paste the output back. If the API returns a 500, you describe it.

That gap is closed. **The agents you declare now run inside your app's own environment, in the browser tab, next to the code they change.**

## Declare a team, not a model

You describe the agents an app needs by the job they do. A coordinator plans the work, a developer writes it, and a tester runs the tests and reports back. You declare them in the project's `.builderforce/builderforce.json`, or with the define-agents form in the canvas, which writes the same file:

```json
{
  "capabilities": {
    "agents": {
      "maxAgents": 3,
      "tools": ["env.fs.read", "env.fs.write", "env.fs.list", "env.run", "env.services.status"]
    }
  },
  "agents": {
    "tester": {
      "role": "tester",
      "instructions": "agents/tester.md",
      "tools": ["env.fs.read", "env.run"]
    }
  }
}
```

An agent names a **role**, never a model. Builderforce's model routing picks the model for that role, so a declaration keeps working when better models arrive. Put a model id in a declaration and it is refused with a reason that says so.

The `capabilities.agents` block is the ceiling for the whole environment. Each agent can only narrow it. An agent that asks for a tool, a budget or a depth above the ceiling is refused. It is never quietly trimmed to fit.

## One door into the environment

Inside the environment, every agent reaches the app through one tool port. It reads, writes and lists the project's files, runs a command such as the test script, fetches a page from one of the app's own services, and reads those services' status.

```bf-figure
{
  "kind": "flow",
  "title": "Every agent call goes through the same checks",
  "steps": [
    { "label": "On the allowlist?", "note": "The tool must be one the agent declared. Anything else is refused.", "hue": "make" },
    { "label": "Idempotency key", "note": "A call that changes something carries the run, step and tool-call id, so a replay cannot repeat it.", "hue": "make" },
    { "label": "Inside the project", "note": "No absolute paths and no `..`. A fetch names one of the app's own services, never a host or port.", "hue": "run" },
    { "label": "Run, or refuse with a reason", "note": "A refusal is typed and reported to the Security Shield. Nothing throws on an agent's input.", "hue": "measure" }
  ],
  "caption": "The checks run in this order on every call, for every agent."
}
```

So the tester can run `npm test` and read the failures itself, but it cannot write a file unless you gave it `env.fs.write`. And no agent can make a request to an arbitrary host.

## Drive it from Brain

Brain has five new tools for the agents in a project: **list** them, **start** one on a task, **steer** a running agent with new direction, check its **status**, and **cancel** it. Before an agent starts, each tool on its list is checked against the one MCP catalog your workspace already uses, so an agent can be given MCP tools you have approved and nothing else.

## Start from a working example

```
/starter-kit react-node --with agents
```

This scaffolds a React and Node app with a coordinator, a developer and a tester already declared, each with a brief in `agents/` and a tool list inside the kit's ceiling. Edit the briefs, narrow the tools, and start one.

## Open source, underneath

The tool port, the allowlist checks and the agent contract ship in **BuilderForce WebContainers 2026.11.24**, the MIT-licensed runtime behind Run and the canvas preview. If you embed it in your own product, your agents get the same environment and the same refusals.

Next: [your agents join the Room](/blog/your-agents-join-the-room), where you can watch each one work and step in.
