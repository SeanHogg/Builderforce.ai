---
title: The In-Browser IDE — Full-Stack Development Without a Local Setup
date: 2026-03-15
description: How Builderforce's in-browser IDE works — BuilderForce WebContainers (our open-source runtime), Monaco editor, real-time collaboration, AI-pair programming, and how it connects to your BuilderForce Agents agents for seamless human-AI co-authorship.
tags: [ide, webcontainers, collaboration, monaco, ai-coding, browser]
author: Sean Hogg
---

# The In-Browser IDE — Full-Stack Development Without a Local Setup

Setting up a development environment is one of those tasks that takes anywhere from 20 minutes to several days and teaches you very little. Clone the repo, install the right Node version, set the environment variables, fight the native dependencies, realise the README is three years out of date.

Builderforce's in-browser IDE eliminates all of it. Open a browser, open a project, and you are working in a real development environment — with a file system, a package manager, a dev server, a terminal, and an AI pair programmer — without installing anything.

![Three-pane browser IDE mock showing a file explorer, the Monaco code editor, and a right panel toggling between Preview, Terminal, and AI Chat](/blog/in-browser-ide.svg)

---

## How It Works: BuilderForce WebContainers

The IDE runs on **BuilderForce WebContainers** — our own in-browser dev runtime, open source under MIT ([source on GitHub](https://github.com/SeanHogg/builderforce-webcontainers) · [what it is](/open-source/builderforce-webcontainers)). It gives the IDE:

- **A dev server in the tab.** Each file is compiled on request with esbuild-wasm and served as a native ES module, the way Vite's dev server works, so startup is immediate and an edit recompiles one file. Vite projects (React, Vue, Svelte), Create React App and static sites all preview.
- **Packages without a wait.** Imports resolve to esm.sh, pinned to the versions in your `package.json` and deduped, so the preview never waits for an install.
- **Node when you need it.** The terminal runs Node programs, `npm install` from the real npm registry and an interactive shell, one Web Worker per process, so a busy loop never freezes the editor. A server listening on a port is previewed like any other page.
- **Check and Publish in the browser.** Type-checking and the production build run on the files themselves, with no install and no server.
- **Isolation from your account.** Previews and processes are served from `preview.builderforce.ai`, a separate origin, so code you or an agent run never shares your Builderforce session.
- **No special browser setup.** It needs a secure context and a service worker. No cross-origin isolation headers, so embeds and third-party scripts keep working.

What it does not do, plainly: native addons and package install scripts cannot run in a browser, and the Next.js, Nuxt, SvelteKit, Remix and Astro dev servers need native binaries. The runtime recognises those projects and tells you why rather than showing a broken preview. WebSockets and streaming responses from an in-browser server are not supported yet.

This is not a simulation or a remote VM. The code runs in your browser. The dev server runs in your browser. Your files are saved to Builderforce, so a project opens where you left it.

---

## Opening the IDE

Navigate to [/ide](/ide) and select a project, or open the IDE directly from a project's detail page.

The IDE has a three-pane layout:

```
┌─────────────┬──────────────────────────────┬──────────────┐
│ File        │                              │              │
│ Explorer    │  Code Editor (Monaco)        │  Preview /   │
│             │                              │  Terminal /  │
│  src/       │  // Your code here           │  AI Chat     │
│  ├ app/     │                              │              │
│  ├ api/     │                              │              │
│  └ tests/   │                              │              │
└─────────────┴──────────────────────────────┴──────────────┘
```

### Left Panel — File Explorer

Browse, create, rename, and delete files. The file tree reflects the runtime's live file system — changes you make in the editor appear immediately, and changes made by agents (via BuilderForce Agents) appear as they are written.

### Centre Panel — Monaco Editor

Full Monaco editor — the same engine that powers VS Code. You get:

- Syntax highlighting for all major languages
- TypeScript language server (type checking, autocompletion, go-to-definition)
- Inline error and warning markers
- Multi-file tabs with unsaved change indicators
- Find/replace across the project

### Right Panel — Context-Dependent

The right panel switches between three views using the toggle at the top:

| View | Content |
|---|---|
| **Preview** | Live iframe served by the in-browser dev server; every open preview reloads when a file changes |
| **Terminal** | A `bfsh` shell in the runtime — `npm`, `npx`, `node`, pipes and the usual file commands |
| **AI Chat** | The AI pair programmer (see below) |

---

## The AI Pair Programmer

The AI Chat panel is a conversational interface with full awareness of your current project context:

- **Open files** — the AI knows what you are looking at
- **File tree** — it understands the project structure
- **Terminal output** — it can see errors from your dev server or test runner
- **Git history** — it has access to recent commits

Ask it anything in the context of your work:

> "This component re-renders too often. Can you identify why and suggest a fix?"

> "Write a test for the `parseDate` utility that covers edge cases."

> "The API is returning a 500. The error in the terminal is above — what is wrong?"

The AI can make edits directly to your files (with your approval), run commands in the terminal, and explain what it is doing as it goes.

---

## Real-Time Collaboration

Invite a teammate to your IDE session and you are in the same environment at the same time.

Collaboration is powered by **Yjs** — a CRDT-based real-time sync library — over a Builderforce Durable Object WebSocket relay:

- **Cursor presence** — see where each collaborator's cursor is
- **Live edits** — changes appear in real time, conflict-free
- **Chat** — a sidebar chat channel within the IDE session
- **Shared terminal** — commands run by one user are visible to all

There is no "owner" — every collaborator has equal access to the file system, terminal, and editor. The project's files are the same for all participants.

Collaboration sessions can include both humans and agents. If a BuilderForce Agents agent is working on the same project, its file edits arrive as live changes in the editor — you watch the agent write code in the same window where you are reviewing it.

---

## Connecting to BuilderForce Agents

The IDE and BuilderForce Agents are two ways to interact with the same project. The IDE is the browser-native interface; BuilderForce Agents is the self-hosted agentic runtime. They share:

- **The same file system** — BuilderForce Agents syncs its workspace to Builderforce; the IDE reads from the synced state
- **The same task board** — tasks created in the IDE's task panel are the same tasks BuilderForce Agents executes
- **The same chat history** — messages you send in the IDE's chat are relayed to the active BuilderForce Agents session; BuilderForce Agents's responses appear in the IDE chat in real time

This means the IDE is not just a code editor — it is a **window into the agent's work**. While BuilderForce Agents executes a workflow on your server, you can watch the files change in the IDE, follow the agent's reasoning in the chat panel, and intervene if something looks wrong — all without leaving the browser.

---

## Project Setup from the IDE

Starting a new project from scratch:

1. Create a project in [/projects](/projects) → **New Project**
2. Choose a template (Web: Vite + React; Web + Mobile: one React Native for Web codebase on Vite)
3. Open the project in the IDE — the runtime boots in the tab and the dev server starts
4. The preview pane shows your running app

The preview needs no install step: packages load from esm.sh at the versions your `package.json` asks for. Run `npm install` in the terminal when a Node program needs a real `node_modules`. Files are saved to R2, so subsequent opens restore the project exactly where you left off.

---

## Source Control Integration

The IDE has built-in git support for projects with a source control integration configured:

- **Status bar** — shows current branch, uncommitted changes
- **Commit panel** — stage, commit, and push without leaving the IDE
- **PR creation** — open a pull request directly from the IDE when your work is ready
- **Branch switching** — checkout branches, create feature branches, merge

Changes committed in the IDE trigger BuilderForce Agents's directory sync — the agentHost's local workspace is updated to match, keeping IDE and local agent state in sync.

---

## When to Use the IDE vs. BuilderForce Agents

| Use the IDE | Use BuilderForce Agents |
|---|---|
| Exploring and editing files directly | Running long autonomous workflows |
| Pair programming with AI on a specific problem | Batch task execution across a project |
| Reviewing and approving agent-generated diffs | Processing tasks dispatched from the portal |
| Real-time collaboration with teammates | Unattended overnight work |
| Running quick terminal commands | Persistent background services |

The two are designed to be used together — start a feature in the IDE with AI assistance, hand off the implementation to a BuilderForce Agents workflow, and review the results in the IDE when the agent is done.

---

## Best Practices

**Keep the preview pane open during frontend work.** The instant feedback from the hot-reload preview is one of the biggest workflow improvements in the browser IDE — do not ignore it in favour of the terminal alone.

**Use the terminal for one-off commands, the agent for repeated patterns.** If you are running `npm test` more than three times to debug the same issue, describe the failure to the AI chat and let it run the iteration loop.

**Commit frequently in the IDE.** Small, frequent commits give both you and BuilderForce Agents a clean history to reason about. Large uncommitted changesets confuse agents that read git history for context.

**Assign the IDE project to a BuilderForce Agents instance.** The IDE is more powerful when a agentHost is attached — the AI chat in the right panel can dispatch to the full agent runtime, not just the in-browser model.

---

## Next Steps

- Open a project in the [IDE](/ide) and explore the three-pane layout
- Read [BuilderForce WebContainers is open source](/blog/builderforce-webcontainers-open-source) for what the runtime under the IDE can do on its own
- Invite a teammate to collaborate — share the session URL from the IDE header
- Read [BuilderForce Agents and Agent Integration](/blog/agents-and-agent-integration) to understand how BuilderForce Agents extends what you build in the IDE
- Explore [WebGPU and LoRA Training](/blog/webgpu-lora-explained) if you want to fine-tune models for your specific codebase directly in the browser
