---
title: "Multi-Party Team Chat: @-Mention a Human or an Agent in the Same Thread"
date: 2026-07-05
description: Builderforce.ai turns AI chat into real team chat — shared threads scoped to your project, invite humans by email, invite AI agents into the room, and address any message to a specific participant. Talk to a colleague and the agent loop stays idle; @-mention an agent and it actually replies as itself, running a permission-scoped tool loop to act on the board. Works on the web and in VS Code.
tags: [team-chat, collaboration, agents, workforce, real-time, governance]
author: Sean Hogg
---

# Multi-Party Team Chat: @-Mention a Human or an Agent in the Same Thread

On most AI tools, "chat" means one human typing to one model. Every message runs the model; there's no way to bring a teammate into the room and just talk to them, and no way to hand the conversation to a specialist agent that then *acts*. Builderforce.ai rebuilt chat as **multi-party collaboration** — where some participants are people and some are agents, and you choose who a message is for.

> In Builderforce.ai, team chat threads are shared across your project: invite humans by email and invite AI agents into the room, then address a message to a specific participant. A message to a human just talks to them; an `@agent` mention makes that agent reply as itself and run a bounded, permission-scoped tool loop — never exceeding your own access.

![A shared chat thread with a participant rail showing the owner, a teammate invited by email, and an @agent; a message to the teammate is answered by a person, while a message to the agent is answered by the agent creating and linking tasks](/blog/chat-shared-thread.svg)

## Chatbot vs. multi-party team chat

| | Typical AI chat | Builderforce team chat |
| --- | --- | --- |
| **Participants** | One human, one model | Many humans **and** many agents |
| **Who a message runs** | Every message runs the model | You address each message to a person or an `@agent` |
| **Talk to a colleague** | Not possible | Direct it to a human — the agent loop stays idle |
| **Agent acts** | Answers text only | Runs a scoped tool loop (tasks, OKRs, board) as itself |
| **Access** | N/A | Agent uses **your** role + token — never more |
| **Thread visibility** | Private to you | Shared with the project (or explicitly locked) |

## Threads are shared, not private silos

A Builderforce chat is **global to its project and tenant**. A teammate can see it, open it, and join to collaborate — they're auto-recorded as a member the first time they contribute, so the thread's audience is real and live. You can also **lock** a thread to just its owner and explicitly invited members when a conversation should stay private. Owners keep admin control (rename, archive, invite, remove, lock); everyone else collaborates.

## Invite humans by email — even people not on the team yet

Add a colleague to a thread by email. If they're already on your team, they get an in-app notification (with an optional email webhook) and the thread appears in their list. If they're **not** a member yet, the invite creates a pending record so that when they sign up they're added automatically and promoted into the chat on first access — one seamless join, no extra step. A global notification bell in the top bar surfaces chat invites and mentions and deep-links straight to the thread.

## Address a message to the right participant

The key idea: a message has a **recipient**. In the composer you pick "To: <name>" (or just start with `@name`), and Builderforce routes the turn accordingly:

- **To a human** — the message is *for that person*. It's persisted and delivered, but it does **not** run the model. No agent wakes up; it's just people talking.
- **To an `@agent`** — that agent **replies as itself**. It runs a bounded server-side tool loop over a curated, non-destructive allowlist (read the board, create a follow-up task, update an OKR, read specs and knowledge) — executed with **your** role and token, so an agent can never do anything you couldn't. Its answer posts attributed to the agent, with its own name and avatar.

![The composer routes a message down one of two lanes: to a human, where it is delivered person-to-person and the agent loop stays idle; or to an @agent, where it runs a permission-scoped tool loop that creates tasks, updates OKRs, and reads the board](/blog/collab-message-routing.svg)

So a thread can hold a genuine mix: you ask a teammate a question, then `@mention` an agent to go create the tasks you just agreed on.

## Governed by your permissions, not the agent's

Every action an invited agent takes in chat runs with the triggering user's permissions. There are no deletes and no control-plane access on the in-chat allowlist. The result is collaboration you can trust: an agent in the room is powerful enough to be useful and scoped enough to be safe.

## The same experience on the web and in VS Code

Multi-party chat is shared across surfaces. The web Brain and the VS Code webview use the same recipient routing, the same participant list, and the same avatars — and the native Sessions tree shows each thread's participants as coloured avatar discs so you can see who's in a room at a glance. Invite a human on the web, `@mention` an agent from VS Code — it's one conversation.

## Why it matters

Real work is a conversation between several people and, increasingly, several agents. Treating chat as one-human-to-one-model can't represent that. By making threads shared, participants explicit, and `@agent` a real actor bound to your permissions, Builderforce makes chat a place a whole workforce collaborates — not just a prompt box.

## Frequently asked questions

**Can I talk to a teammate in chat without triggering an AI response?** Yes. Address the message to a human (pick them as the recipient or start with `@name`) and it's delivered as a person-to-person message — the agent loop stays idle.

**What can an `@agent` actually do when I mention it?** It runs a bounded tool loop over a safe, read-plus-limited-write allowlist (read the board, create tasks, update OKRs, read specs and knowledge) using your role and token. It can't delete or reach the control plane, and it can never exceed your own permissions.

**Can I invite someone who isn't on my team yet?** Yes. Inviting a cold email creates a pending invitation; when they sign up they're added to the team and promoted into the chat automatically on first access.

**Is a chat private to me?** By default threads are shared with your project so teammates can join. You can lock a thread so only the owner and explicitly invited members have access.

**Does this work in VS Code?** Yes. The VS Code webview shares the same recipient routing, participant model, and avatars as the web Brain — it's one conversation across surfaces.
