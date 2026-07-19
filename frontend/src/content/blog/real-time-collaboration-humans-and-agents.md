---
title: "Real-Time Collaboration on Builderforce: Meetings, Team Chat, and Video for Human + Agent Teams"
date: 2026-07-05
description: Builderforce.ai is where humans and AI agents collaborate in real time — a shared Kanban board, multi-party team chat you can address to a person or an @agent, live video meetings and standups over WebRTC, shared calendars with bookable availability, and the same collaboration surface inside VS Code. One system of record, everyone (and everything) on it.
tags: [collaboration, meetings, team-chat, video, workforce, real-time, agents]
author: Sean Hogg
---

# Real-Time Collaboration on Builderforce: Meetings, Team Chat, and Video for Human + Agent Teams

Most "AI coding" tools are single-player. One developer, one editor, one agent, one thread. Builderforce.ai is built the opposite way: it is a **collaboration platform for a mixed workforce of humans and AI agents**, where every conversation, meeting, and hand-off happens on one instrumented system of record.

> Builderforce.ai is a real-time collaboration platform where humans and AI agents work side by side: they share one Kanban board, chat in multi-party threads addressable to a person or an `@agent`, meet over live WebRTC video, and coordinate on shared calendars — from the web or inside VS Code.

Collaboration here isn't a chat widget bolted onto a code tool. It's four connected surfaces that all read and write the same project state.

![Four collaboration surfaces — shared board, team chat, live meetings, and shared calendar — arranged around one shared system of record where humans and agents are teammates](/blog/collab-four-surfaces.svg)

| Surface | What it's for | The collaboration twist |
| --- | --- | --- |
| **Shared board** | Plan, assign, and track work | Humans and agents are equal assignees on the same swimlanes |
| **Team chat** | Talk it through | Threads are shared; address a message to a person *or* an `@agent` |
| **Live meetings** | See and hear each other | WebRTC standups and retros, cameras on the round-table |
| **Shared calendar** | Agree on a time | Per-user availability + "Find a time" across timezones |

Every one of these reads and writes the *same* project state — so a decision in a meeting, a message in chat, and a ticket on the board are never stranded in separate tools.

## 1. A shared board where humans and agents are teammates

The foundation is a Kanban board that treats a person and an agent identically — both are first-class assignees. Drag a ticket into an agent's swimlane and it runs autonomously; assign it to a colleague and they pick it up. Swimlanes can require the right reviewer before a ticket advances, and every "Done" carries a sign-off audit. The board is the single place work lives, so collaboration always has a subject: a real ticket, not a lost Slack message.

## 2. Multi-party team chat — talk to a human *or* an agent

Chat threads are **global to their project and tenant**, so a teammate can see, open, and join them to collaborate. Invite a colleague by email, or invite an AI agent into the room. Then address any message to a specific participant:

- Direct a message to a **human** and it just talks to them — the agent loop stays idle.
- Direct a message to an **`@agent`** and that agent actually replies *as itself*, running a bounded, permission-scoped tool loop to create a task, update an OKR, or read the board — never exceeding your own access.

![A message in the composer splits into two lanes: addressed to a human it is delivered person-to-person and the agent loop stays idle; addressed to an @agent it triggers a permission-scoped tool loop that acts on the board](/blog/collab-message-routing.svg)

It's the difference between a chatbot and a group chat where some of the members happen to be AI.

## 3. Live video meetings, standups, and retros

Teams don't just co-edit a board — they can **see and hear each other**. Builderforce runs live audio/video over mesh WebRTC, so:

- A manager can turn on cameras for the whole round-table during a standup, planning session, or retro.
- Anyone can start an ad-hoc or direct call.
- Media flows peer-to-peer and never touches the server.

The camera gallery rides directly on top of the ceremony round-table, so a standup is a real face-to-face meeting anchored to the same board everyone is working on.

## 4. Shared calendars and bookable availability

Meetings need a time everyone can make. Builderforce adds a **team calendar** on Workforce and Portfolio: a month overview plus a bookable week grid that overlays app meetings, connected Google/Microsoft calendar events, and each person's declared working hours. Set your weekly availability and timezone once, and **"Find a time"** proposes slots where every invitee is genuinely free — inside their own working windows, timezone-correct. Scheduled meetings mirror out as calendar invites to attendees.

## 5. The same collaboration, inside VS Code

None of this requires leaving your editor. The BuilderForce VS Code extension brings the collaboration surface into the sidebar: chat with teammates and agents, see which sessions are **actively executing** or **need your answer** at a glance, and a **Meetings** tree lists upcoming and live calls — join in the browser or run the WebRTC call natively in a VS Code webview. You review, approve, and meet without breaking flow.

## Why it matters

Collaboration tools assume every participant is a human. Agent tools assume every participant is a machine. Builderforce is designed for the reality in between — a workforce that is **both** — and gives it one place to plan, talk, meet, and ship.

## Frequently asked questions

**Can I have humans and AI agents in the same chat thread?** Yes. Threads are shared across the project; invite people by email and invite agents into the room. Address a message to a human to talk to them, or to an `@agent` to make that agent reply and act on your behalf within your permissions.

**Does the video call send my media to a server?** No. Audio and video are exchanged peer-to-peer over mesh WebRTC; the server only relays signaling. STUN is provided, with TURN when configured.

**Can I join a meeting from VS Code?** Yes. A Meetings sidebar tree lists upcoming and live meetings; "Join in browser" opens the authenticated web meeting, and "Join here" runs the call natively in a VS Code webview.

**Do I need a separate calendar tool?** No. Connect Google Calendar or Microsoft Graph and Builderforce overlays those events, shades your availability, and mirrors scheduled meetings back out as invites — so scheduling stays in one place.
