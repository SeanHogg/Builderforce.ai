---
title: Open source at Builderforce — four projects you can run, read and fork
date: 2026-10-16
description: Builderforce stands on four MIT projects anyone can use without us. An in-browser dev runtime, browser-trainable agent memory, a local inference engine with its desktop app, and a Roblox game builder. What each one does, and what it is worth to you.
tags: [open-source, developer-tools, webcontainers, evermind, local-models, roblox]
author: Sean Hogg
---

# Open source at Builderforce — four projects you can run, read and fork

The parts of Builderforce that run on your machine or in your browser are the parts you should be able to read. They touch your files, your keys, your models and your users' sessions. "Trust us" is a poor answer for any of that, and the better answer is the source.

So the runtimes Builderforce is built on are open source under MIT. There are four of them, and each one is what the product actually runs, not a demo cut from it. The two libraries need no account at all; the two desktop apps sign in to Builderforce for the parts that live in the cloud. You can find all four at [builderforce.ai/open-source](/open-source).

```bf-figure
{
  "kind": "stack",
  "title": "Four projects, one platform on top",
  "bands": [
    { "label": "BuilderForce WebContainers", "note": "An in-browser dev runtime: preview, build, type-check, Node, npm and a shell, without requiring COOP/COEP, and with no session caps.", "hue": "make", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Memory", "note": "Persistent, browser-trainable SSM memory for any agent, a semantic cache that cuts token spend, and an MCP server.", "hue": "idea", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Inference", "note": "Synapse, the desktop app, and bfi, a native engine that runs models on your own machine.", "hue": "run", "tag": "Rust" },
    { "label": "BuilderForce Spawn", "note": "Build Roblox games by talking: a desktop app and a Roblox Studio bridge.", "hue": "reach", "tag": "Rust" }
  ],
  "caption": "All four are MIT. The libraries need no account; the desktop apps sign in for the cloud parts."
}
```

## BuilderForce WebContainers — the runtime under every preview

**What it is.** An open, forkable in-browser dev runtime. Hand it a project as files and it serves a live preview: Vite with React, Vue or Svelte, Create React App and static sites. It builds for deployment (`runtime.build()`) and type-checks (`createChecker()`) in the page, and runs Node programs, `npm install` from the real registry and an interactive shell, one Web Worker per process.

**What it is worth.** It needs a secure context and a service worker, and nothing else. Because it does not require COOP/COEP, it adds no isolation headers of its own, so the sign-in popups, payment frames and embeds in your app keep working. No session caps means a preview costs nothing to open. Pluggable ports mean you can swap the compiler or the package CDN without forking the core. It replaced StackBlitz WebContainers under every Builderforce canvas preview, Publish and Check.

**Be clear about the limits.** Native addons, install scripts, and the Next.js, Nuxt, SvelteKit, Remix and Astro dev servers do not run; the runtime detects those projects and says why. WebSockets and streaming responses are on the roadmap.

[Read the project page](/open-source/builderforce-webcontainers) · [Read the announcement](/blog/builderforce-webcontainers-open-source) · [GitHub](https://github.com/SeanHogg/builderforce-webcontainers)

## BuilderForce Memory — memory any agent can keep

**What it is.** A framework for giving any AI agent persistent memory that can be trained in the browser. Three packages: an engine of WebGPU Mamba state-space kernels with a trainer and tokenizer (`@seanhogg/builderforce-memory-engine`); a runtime with Anthropic, OpenAI and Fetch bridges, an inference router, online distillation and the memory store (`@seanhogg/builderforce-memory`); and an MCP server with an installer that registers it into Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Cline, Gemini CLI and Codex CLI (`@seanhogg/builderforce-memory-mcp`).

**What it is worth.** Lower token bills and knowledge that stays current. A semantic cache reuses an answer when a new prompt is a paraphrase of one already answered, so the frontier model is not called at all. Write-through cognition replaces a stale fact when a newer one is backed by evidence, instead of piling both up for someone to reconcile. It is the memory layer of Evermind on Builderforce, and it is provider-neutral, so it is just as useful under an agent that has never heard of us.

[Read the project page](/open-source/builderforce-memory) · [GitHub](https://github.com/SeanHogg/builderforce-memory)

## BuilderForce Inference — models on your own machine

**What it is.** Synapse, the Builderforce desktop app, and the local AI runtime under it. `bfi` is a native engine written in Rust that reads GGUF models, serves OpenAI-, Anthropic- and Ollama-compatible HTTP APIs, and runs on your hardware. Synapse supervises it, so Ollama is not required. The same workspace holds a code index, an MCP host for connectors, an Evermind memory client and secrets kept in the operating system's credential store.

**What it is worth.** Private work stays private. Local models answer your editor and your scripts without a network call, and what Evermind learns on your machine stays there unless you publish it. The CPU path ships today; we have not claimed GPU parity with llama.cpp, and the README says so.

[Read the project page](/open-source/builderforce-inference) · [GitHub](https://github.com/SeanHogg/builderforce-inference)

## BuilderForce Spawn — Roblox games by talking

**What it is.** Spawn, a desktop app for Roblox creators, and the bridge that connects it to Roblox Studio. Describe the game, and it builds the parts, the Luau and the UI inside Studio. It signs in to Builderforce through the shared client from BuilderForce Inference.

**What it is worth.** One thing to install instead of an app, a plugin, a local server and a sync tool. And because it is open, the parents, schools and creators who want to know exactly what a builder for young creators does can read it.

[Read the project page](/open-source/builderforce-spawn) · [GitHub](https://github.com/SeanHogg/builderforce-spawn)

## Standalone or on Builderforce

```bf-figure
{
  "kind": "compare",
  "title": "The same code, two ways to use it",
  "columns": [
    { "title": "On its own", "hue": "muted", "items": ["Install from npm or cargo, or clone from GitHub", "MIT: fork it, ship it, sell it", "Read every line that runs on your side", "Host it yourself and own the result"] },
    { "title": "On Builderforce", "hue": "make", "items": ["Already wired into the canvas, Studio, the Brain and the desktop app", "Agents, boards, approvals and the marketplace on top", "Memory shared across your web app, your agents and your machine", "Publish to your own address in one step"] }
  ],
  "caption": "Open source is not a trial edition here. The code on GitHub is the code the product runs."
}
```

## Where it sits in the method

Work on Builderforce follows an arc, **Idea → Make → Run → Measure**, and each act runs through the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Each project carries a different part of it.

- **Make** runs on BuilderForce WebContainers. An idea becomes a running app in the tab, and **Prove** stays free because a prototype costs nothing to start.
- **Run** reaches your machine with BuilderForce Inference. A model you run locally answers without a meter, so leaving an agent running is a choice about time, not money.
- **Measure** feeds BuilderForce Memory. What worked is remembered, a repeat question is answered from memory, and the next **Idea** starts from what the last one taught.
- **Make** for games is Spawn: the same loop, inside Roblox Studio.

Being open source does not change the method. It changes who can check the work: every act that runs on your side runs code you can read.

## How to start

- Browse the four at [builderforce.ai/open-source](/open-source).
- Embed the runtime: `npm install @seanhogg/builderforce-webcontainers`.
- Give your agent memory: `npm install @seanhogg/builderforce-memory`, or install the MCP server into the tools you already use.
- Run models locally: `cargo install --git https://github.com/SeanHogg/builderforce-inference bfi`.
- File an issue or send a pull request. Each repository keeps a roadmap of what is next.

---

**Related reading:** [BuilderForce WebContainers is open source](/blog/builderforce-webcontainers-open-source) · [Synapse now runs models itself](/blog/synapse-runs-models-itself) · [Spawn — build Roblox games by talking](/blog/build-roblox-games-by-talking)

[Open a canvas](/create) and see the runtime at work.
