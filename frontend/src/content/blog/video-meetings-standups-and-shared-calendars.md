---
title: "Video Meetings, Standups, and Shared Calendars on Your Agentic Board"
date: 2026-07-05
description: Builderforce.ai adds live video and audio to your agentic workspace — WebRTC standups with cameras on the ceremony round-table, ad-hoc and direct calls, a bookable team calendar with availability windows and "Find a time", Google and Microsoft calendar sync, and one-click join from the web or VS Code. Media flows peer-to-peer and never touches the server.
tags: [meetings, video, collaboration, ceremonies, calendar, webrtc, workforce]
author: Sean Hogg
---

# Video Meetings, Standups, and Shared Calendars on Your Agentic Board

A Kanban board tells you *what* is happening. A face-to-face conversation tells you *why*, quickly. Builderforce.ai now puts both in one place: live video and audio meetings that sit directly on top of the board your team — humans and agents — already works on.

> Builderforce.ai runs live video meetings over mesh WebRTC directly on your project board: cameras in standups and retros, ad-hoc and direct calls, a bookable team calendar with per-user availability, and Google/Microsoft calendar sync — joinable from the web or inside VS Code, with media flowing peer-to-peer and never through the server.

![Three peers connected in a WebRTC mesh exchanging audio and video directly; the server relays only signaling and STUN, so media never passes through it](/blog/meetings-webrtc-mesh.svg)

## Meeting types at a glance

| Type | When you use it | Who can start it |
| --- | --- | --- |
| **Standup / Planning / Retro** | Recurring ceremonies, with cameras on the round-table | Manager turns on cameras; any member joins |
| **Ad-hoc** | A quick, unplanned sync | Anyone |
| **Direct** | A one-to-one call | Anyone |
| **Scheduled** | Booked ahead, mirrored to calendars as invites | Organizer |

## Cameras on the round-table

Builderforce already runs ceremonies — standups, planning, retrospectives — as a structured round-table anchored to the project. Now those ceremonies can turn on **cameras and microphones**. A manager can start video for the whole team, or anyone can flip on "Join with camera" to add themselves to a live gallery over the standup. Because the meeting lives on the ceremony, everyone is looking at the same board while they talk.

You also get plain calls: start an **ad-hoc** meeting for a quick sync, or a **direct** call with one teammate. There's a dedicated `/meetings` surface with a schedule modal, start-now, and a live/upcoming list.

## Peer-to-peer by design

Media in Builderforce is exchanged **client-to-client over mesh WebRTC**. Camera and mic streams, SDP offers/answers, and ICE candidates flow between browsers directly; the server only relays signaling and serves STUN (with TURN when you configure it). Your video never lands on our infrastructure. Negotiation is glare-free, so two people connecting at the same instant don't collide.

## A calendar that knows when everyone is free

Meetings are only useful at a time people can actually make. Builderforce adds a **shared team calendar** to both Workforce and the project Portfolio:

- A **month overview** and a **bookable week grid** in one component.
- Overlays your app meetings *and* your connected Google/Microsoft calendar events.
- Shades your declared **availability** hours so open slots are obvious.
- Click an open slot to book, click a meeting to join.

Set your **weekly working-hours windows and timezone** once, and the **"Find a time"** solver proposes slots where *every* invitee is free — no conflicting meeting, and inside each person's own working windows, computed timezone-correct. No more email ping-pong to find a slot.

![A week grid across timezones showing three people's working-hour windows and busy blocks, with the solver highlighting the one slot where everyone is free](/blog/meetings-find-a-time.svg)

## Bring your own calendar

Connect **Google Calendar** or **Microsoft Graph** per user with a single OAuth flow. Scheduled Builderforce meetings are mirrored out as real calendar events with invites to attendee emails, and your upcoming external events surface right on `/meetings`. One place to see everything, no double-entry.

## Join from anywhere — including your editor

Invites are login-gated deep links (`/meetings?join=<id>`) and joining is **authorization-scoped**: only the organizer, listed attendees, managers, or members of the meeting's project can join — cross-tenant access is blocked. And you don't have to be in a browser. The VS Code extension adds a **Meetings** sidebar tree of upcoming and live calls:

- **Join in browser** opens the authenticated web meeting.
- **Join here** runs the WebRTC call natively in a VS Code webview — so you never leave your editor for a standup.

## The point

Standups, planning, and retros are where a team aligns. By running them as live video *on the board itself* — with a calendar that respects everyone's real availability and a join button inside VS Code — Builderforce removes the gap between "meeting tool" and "the work." The conversation and the tickets it's about are finally in the same place.

## Frequently asked questions

**Does Builderforce use a third-party video service?** No. Video and audio run over mesh WebRTC directly between participants. The server relays only signaling and provides STUN (plus optional TURN); your media is peer-to-peer.

**How does "Find a time" work?** Each user declares weekly working-hour windows and a timezone. The availability solver proposes meeting slots where every invitee has no conflicting meeting and the time falls inside their windows, computed correctly across timezones.

**Can I sync my existing calendar?** Yes — connect Google Calendar or Microsoft Graph per user. Your external events overlay the team calendar, and scheduled meetings are mirrored back out as invites.

**Who can join a meeting from an invite link?** Only authorized people: the organizer, listed attendees, managers, or members of the meeting's project (for a project meeting) or tenant (for a tenant-wide meeting). The link is login-gated and cross-tenant joins are blocked.

**Can I join a meeting without opening a browser?** Yes. The VS Code Meetings tree lets you join in the browser or run the call natively in a VS Code webview.
