---
title: The In-Browser IDE — Full-Stack Development Without a Local Setup
date: 2026-03-15
description: How Builderforce's in-browser IDE works — WebContainers, Monaco editor, real-time collaboration, AI-pair programming, and how it connects to your CoderClaw agents for seamless human-AI co-authorship.
tags: [ide, webcontainers, collaboration, monaco, ai-coding, browser]
author: Sean Hogg
---

# The In-Browser IDE — Full-Stack Development Without a Local Setup

Setting up a development environment is one of those tasks that takes anywhere from 20 minutes to several days and teaches you very little. Clone the repo, install the right Node version, set the environment variables, fight the native dependencies, realise the README is three years out of date.

Builderforce's in-browser IDE eliminates all of it. Open a browser, open a project, and you are running a real Node.js environment — with a file system, a package manager, a dev server, a terminal, and an AI pair programmer — without installing anything.

---

## How It Works: WebContainers

The IDE is powered by **WebContainers** — a WebAssembly-based Node.js runtime that runs entirely inside the browser tab. WebContainers provides:

- A real, POSIX-compatible file system (in-memory, with persistence to R2)
- A full Node.js runtime with native module support
- The ability to run `npm install`, `npm run dev`, `npm test` — exactly as you would locally
- A localhost network layer that the browser can reach — your dev server's port 3000 is accessible directly in the preview pane

This is not a simulation or a remote VM. The code runs in your browser. The dev server runs in your browser. There is no server-side compute involved in the execution itself.

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

Browse, create, rename, and delete files. The file tree reflects the live WebContainers file system — changes you make in the editor appear immediately, and changes made by agents (via CoderClaw) appear as they are written.

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
| **Preview** | Live iframe connected to the WebContainer's localhost; auto-refreshes when your dev server hot-reloads |
| **Terminal** | Full terminal connected to the WebContainer's shell — run any command |
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

There is no "owner" — every collaborator has equal access to the file system, terminal, and editor. The underlying WebContainer state is consistent for all participants.

Collaboration sessions can include both humans and agents. If a CoderClaw agent is working on the same project, its file edits arrive as live changes in the editor — you watch the agent write code in the same window where you are reviewing it.

---

## Connecting to CoderClaw

The IDE and CoderClaw are two ways to interact with the same project. The IDE is the browser-native interface; CoderClaw is the self-hosted agentic runtime. They share:

- **The same file system** — CoderClaw syncs its workspace to Builderforce; the IDE reads from the synced state
- **The same task board** — tasks created in the IDE's task panel are the same tasks CoderClaw executes
- **The same chat history** — messages you send in the IDE's chat are relayed to the active CoderClaw session; CoderClaw's responses appear in the IDE chat in real time

This means the IDE is not just a code editor — it is a **window into the agent's work**. While CoderClaw executes a workflow on your server, you can watch the files change in the IDE, follow the agent's reasoning in the chat panel, and intervene if something looks wrong — all without leaving the browser.

---

## Project Setup from the IDE

Starting a new project from scratch:

1. Create a project in [/projects](/projects) → **New Project**
2. Choose a template (Next.js, Vite + React, Node + Express, blank)
3. Open the project in the IDE — WebContainers initialises, dependencies install, the dev server starts
4. The preview pane shows your running app

Templates run `npm install` automatically when the container first initialises. Subsequent opens restore the last file system state from R2, so your session picks up exactly where you left off.

---

## Source Control Integration

The IDE has built-in git support for projects with a source control integration configured:

- **Status bar** — shows current branch, uncommitted changes
- **Commit panel** — stage, commit, and push without leaving the IDE
- **PR creation** — open a pull request directly from the IDE when your work is ready
- **Branch switching** — checkout branches, create feature branches, merge

Changes committed in the IDE trigger CoderClaw's directory sync — the claw's local workspace is updated to match, keeping IDE and local agent state in sync.

---

## When to Use the IDE vs. CoderClaw

| Use the IDE | Use CoderClaw |
|---|---|
| Exploring and editing files directly | Running long autonomous workflows |
| Pair programming with AI on a specific problem | Batch task execution across a project |
| Reviewing and approving agent-generated diffs | Processing tasks dispatched from the portal |
| Real-time collaboration with teammates | Unattended overnight work |
| Running quick terminal commands | Persistent background services |

The two are designed to be used together — start a feature in the IDE with AI assistance, hand off the implementation to a CoderClaw workflow, and review the results in the IDE when the agent is done.

---

## Best Practices

**Keep the preview pane open during frontend work.** The instant feedback from the hot-reload preview is one of the biggest workflow improvements in the browser IDE — do not ignore it in favour of the terminal alone.

**Use the terminal for one-off commands, the agent for repeated patterns.** If you are running `npm test` more than three times to debug the same issue, describe the failure to the AI chat and let it run the iteration loop.

**Commit frequently in the IDE.** Small, frequent commits give both you and CoderClaw a clean history to reason about. Large uncommitted changesets confuse agents that read git history for context.

**Assign the IDE project to a CoderClaw instance.** The IDE is more powerful when a claw is attached — the AI chat in the right panel can dispatch to the full agent runtime, not just the in-browser model.

---

## Next Steps

- Open a project in the [IDE](/ide) and explore the three-pane layout
- Invite a teammate to collaborate — share the session URL from the IDE header
- Read [CoderClaw and Agent Integration](/blog/coderclaw-and-agent-integration) to understand how CoderClaw extends what you build in the IDE
- Explore [WebGPU and LoRA Training](/blog/webgpu-lora-explained) if you want to fine-tune models for your specific codebase directly in the browser
