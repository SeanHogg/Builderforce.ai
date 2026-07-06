---
title: "The VS Code Command Center: Run Your Whole Agentic Workforce Without Leaving the Editor"
date: 2026-07-05
description: The BuilderForce VS Code extension is a full command center for a workforce of humans and AI agents — multi-party team chat, live at-a-glance status showing which sessions are executing or need your answer, a Meetings tree you can join natively, an Evermind sidebar to inspect and train your project's self-updating model, project and task trees, and human-in-the-loop approvals. Everything, in your editor.
tags: [vs-code, collaboration, workforce, agents, evermind, meetings, real-time]
author: Sean Hogg
---

# The VS Code Command Center: Run Your Whole Agentic Workforce Without Leaving the Editor

Developers live in their editor. So instead of asking you to leave it, Builderforce.ai brings the entire platform *into* VS Code. The extension is no longer just a chat panel — it's a **command center** for running a mixed workforce of humans and AI agents, with collaboration, meetings, live status, and model training all in the sidebar.

> The BuilderForce VS Code extension runs the whole platform in your editor: multi-party team chat, live session status, native video meetings, an Evermind training console, project and task trees, and human-in-the-loop approvals — so you manage an entire agentic workforce without leaving VS Code.

![The BuilderForce VS Code sidebar showing its surfaces — Sessions team chat, Project & Tasks with live status, Meetings, Evermind, Inbox approvals, and Insights — beside an editor pane listing the governance guarantees](/blog/vscode-command-center.svg)

Here's what each sidebar surface gives you.

| Sidebar surface | What it does |
| --- | --- |
| **Sessions** | Multi-party team chat — humans + `@agents`, directed messages, avatars |
| **Project & Tasks** | Your board and assigned work, with a live status overlay per row |
| **Meetings** | Upcoming and live calls — join in browser or natively in a webview |
| **Evermind** | Inspect and train your project's self-updating model |
| **Inbox** | Human-in-the-loop approvals and decisions |
| **Insights & Diagnostics** | The operating picture and one-click scans |

## See what needs you — at a glance

When you're running several agents at once, the hardest question is "which one needs me right now?" A single server-side signal answers it on every surface. In VS Code, both the **Sessions** and **Project & Tasks** trees overlay a live status icon on each row:

- **Executing** — a blue spinner: the agent is actively working (and it keeps working even when you switch chats).
- **Needs your answer** — an amber marker with a `❓`: the run paused on a question and is waiting for you.
- **Done** — a green check.

![Three live-status rows — a blue spinner for executing, an amber question mark for needs-your-answer, and a green check for done — the one signal that follows a session across every surface](/blog/vscode-live-status.svg)

The status follows a session wherever it's shown, so multitasking across concurrent runs reads instantly.

## Multi-party team chat in the sidebar

The Sessions panel is real team chat, not a solo prompt box. Threads are shared across your project, you can invite humans and AI agents into a room, and you address each message to a specific participant — talk to a teammate, or `@mention` an agent to make it reply and act on the board within your permissions. Participants render as coloured avatars right in the tree, so you can see who's in each room.

## Join meetings natively

A **Meetings** tree lists your upcoming and live calls. **Join in browser** opens the authenticated web meeting; **Join here** runs the mesh WebRTC video call *natively in a VS Code webview*. Standups, planning, and retros happen without ever tabbing away from your code.

## Inspect and train Evermind

Each project has its own **Evermind** — a self-updating model that learns from your team's work. Now it's a first-class sidebar view. Open the Evermind console to see what it has learned (version, learned/queued counts, last-learned time), steer its training (seed from a published model, connect or freeze learning, pick a teacher model), **teach it from a transcript** by pasting an exemplar, and flush the learning queue on demand. Managers get the controls; everyone can inspect. The same console renders on the web — one component, two hosts.

## The trees that run the work

The extension carries the rest of the platform too:

- **Project & Tasks** — your board and assigned work, with the same live status overlay.
- **Inbox** — approvals and items that need a decision.
- **Insights** and **Diagnostics** — the operating picture and scans.
- **Run and review** — dispatch tasks to agents, review and validate their output, and approve human-in-the-loop actions where you code.

## Governed, and yours

Every action still passes through the platform's governance: approval gates, audit trail, and per-tenant isolation. Bring your own frontier model (Anthropic, OpenAI, or Google) and on-prem runs bill against your own account. The extension is a window onto the same instrumented system of record as the web app — nothing is a second-class copy.

## Why it matters

Context-switching is the tax on managing agents. Every time you leave the editor to check a run, answer a question, join a standup, or tune a model, you lose the thread. The VS Code command center removes that tax: the whole workforce — its chats, its meetings, its status, and its learning model — lives one panel away from your code.

## Frequently asked questions

**Can I tell which agent needs me without opening each one?** Yes. The Sessions and Project & Tasks trees overlay a live status per row — blue spinner for executing, amber `❓` for awaiting your answer, green check for done — from one server-side signal.

**Is the VS Code chat just me and a model?** No. It's multi-party: threads are shared across your project, you can invite humans and agents, and you address messages to specific participants — including `@agent` mentions that make an agent reply and act within your permissions.

**Can I join video meetings inside VS Code?** Yes. The Meetings tree lets you join in the browser or run the WebRTC call natively in a VS Code webview.

**Can I train my project's model from the editor?** Yes. The Evermind sidebar view lets managers inspect what the model learned, steer training, teach it from a pasted transcript, and flush the learning queue — the same console that appears on the web.

**Do agent actions in VS Code bypass governance?** No. Every action runs through the platform's approval gates, audit trail, and tenant isolation, exactly as on the web.
