---
title: Your private Evermind, on your machine — with local models, connectors and approvals from your phone
date: 2026-10-10
description: Synapse now runs local models sized to your computer and serves them to Claude Code and your scripts, hosts MCP connectors the Brain can use, lets you approve an agent's step from your phone, and gives you a private model to start from. Everything it learns stays on your machine unless you publish it.
tags: [evermind, privacy, agents, local-models, mcp, product]
author: Sean Hogg
---

# Your private Evermind, on your machine

Every assistant you use is learning something about you. Which projects you care about, how you name things, which steps of a monthly task you always do by hand. And almost every one of them keeps that knowledge on someone else's server, in a model you will never own, that forgets you the moment you switch tools.

That is the gap: **what your AI learns about your work does not belong to you.**

Synapse was built to close it. It is the Builderforce desktop app, and it is where your own Evermind lives: the facts, demonstrations and skills your tools pick up are stored and trained on your computer, in a `.evermind` model that is yours. Until now it still leaned on the cloud for three things — the model that answered you, the tools it could reach, and you being at the desk when an agent needed a yes. All three now stay with you.

```bf-figure
{
  "kind": "flow",
  "title": "What lives on your machine now",
  "steps": [
    { "label": "Your Evermind", "note": "Facts, demonstrations and skills, trained into a model you own. Start from one of your workspace's models.", "hue": "idea" },
    { "label": "Local models", "note": "Installed and sized for your memory; the Brain can answer with one, and so can Claude Code.", "hue": "make" },
    { "label": "Connectors", "note": "GitHub, Slack, Playwright, your files — MCP servers the Brain uses, run here.", "hue": "make" },
    { "label": "Approvals anywhere", "note": "An agent's step that needs a yes reaches your phone through your own account.", "hue": "run", "tag": "opt-in" }
  ],
  "caption": "Nothing in this list leaves the computer unless you choose it — the phone approvals included."
}
```

## A model that fits the machine you have

Picking a local model is a small exam in arithmetic: parameter counts, quantization formats, how much memory is left once the browser and the editor are open. Most people guess, download eleven gigabytes, and find out it does not fit.

Synapse does the arithmetic. It manages Ollama for you and reads how much memory the computer has. For every model in its hub it works out which quantization leaves room for everything else — full precision where it fits, eight-bit where it does not, four-bit for the largest — and it marks one model as the best general choice for this machine. Install is one click, with progress; removing is another.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Local models",
  "ratio": 1.4,
  "regions": [
    { "label": "The Brain answers with", "note": "Builderforce by default, or any installed model", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "idea" },
    { "label": "Models for this machine", "note": "Each size with the quantization that fits; one marked Recommended", "x": 4, "y": 24, "w": 92, "h": 44, "hue": "make" },
    { "label": "Use them from other tools", "note": "OpenAI and Anthropic formats on a local port, with a key", "x": 4, "y": 72, "w": 92, "h": 22, "hue": "run" }
  ],
  "caption": "Too large for this machine says so before the download, not after."
}
```

Then the models are yours everywhere. Switch on **Use them from other tools** and Synapse serves them on your computer in both formats AI tools speak — the OpenAI one and Anthropic's, which is what Claude Code uses. Two environment variables and Claude Code runs on a model that never leaves the room. Only programs on the machine holding the key get in, and web pages are refused outright.

## Tools for the Brain, without handing over the keys

The Brain in Synapse already used the platform's tools — tickets, boards, specs. Now it also uses **connectors**: MCP servers that run on your computer. Pick GitHub, Slack, Brave Search, Playwright, Context7 or a folder of files from the catalog and install it in one click, or add any MCP server by its command line.

Tokens go into your system's credential store, never into a settings file. A tool that only reads runs straight away; one that changes something — opening an issue, posting a message, writing a file — shows up in the chat with Approve and Decline, the same as the platform's own.

```bf-figure
{
  "kind": "compare",
  "title": "Where the tool runs",
  "columns": [
    { "title": "A hosted assistant", "hue": "muted", "items": ["Your tokens stored on its servers", "Tools reach only what the cloud can reach", "Your local files are out of bounds"] },
    { "title": "Synapse connectors", "hue": "make", "items": ["Tokens in your OS credential store", "Servers run on your machine, next to your files", "Anything that changes something asks first"] }
  ],
  "caption": "The same MCP servers, in the place your work already is."
}
```

## Say yes from your phone

Agents you teach once — record a task in any desktop app, let Synapse do it again — pause at the steps that matter and wait for your approval. That used to mean waiting for you at the desk. Switch on **Approve steps from your phone** and the request also goes to your Builderforce account, where the approvals queue shows it on any phone. The first answer wins, on either side; the other side is told.

It is built so that nothing gets in that should not. Synapse never opens a port to the internet: the request travels up through your own signed-in account, and Synapse asks for the answer. Only you can see or answer it — not a teammate, not a manager, not an auto-approval rule, and not another AI tool. And the step's description leaves your computer only while that switch is on.

## A model to start from

Your Evermind learns from what your tools experience, but it needs a model to learn into, and most people do not have a `.evermind` file lying around. Synapse now offers one: pick any Evermind model your workspace already has and **Use as my model**. It downloads to your computer, with its tokenizer, and from then on learns there — the workspace never sees what it learns unless you publish it.

## Where it sits in the method

Builderforce runs every idea along one arc — [Idea, Make, Run, Measure](/blog/read-prove-build-the-inner-loop) — and every act inside it on the loop of Read, Prove, Build.

This release is about **Run**. Run is where work keeps happening when you are not watching it, and it is where a private setup used to break: the agent stopped at its first gate because you were away from the desk, the model behind the answer was someone else's, and the tools it could use were the ones the cloud could reach. Approvals on your phone keep a run moving. Local models and connectors let it run where your work and your data already are.

It also feeds **Read** for next time. What a run teaches your Evermind stays in a model you own, so the next time you or any of your tools read your work, they read it with everything you have done before.

## What you can do with it today

- **Install a local model in one click** that fits your computer, and let the Brain answer with it.
- **Point Claude Code at your own machine** with the two lines Synapse shows you.
- **Give the Brain GitHub, Slack or your files** as tools, with every change waiting for your Approve.
- **Approve an agent's step from your phone** instead of coming back to the desk.
- **Start your private Evermind** from a model your workspace already has.

[Download Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) for Windows, macOS or Linux.

---

**Related reading:** [A private brain on your desktop that hands the work to your agents](/blog/a-private-brain-on-your-desktop-that-hands-work-to-agents) · [Teach it once and it does it again](/blog/teach-it-once-and-it-does-it-again) · [One local index for every AI tool](/blog/one-local-index-for-every-ai-tool)
