---
title: Run a 30-Minute Live Screening Block and Replace Two Weeks of Phone Calls
date: 2026-05-25
description: ZipIntro-style back-to-back video screening blocks for any role on Builderforce. Set a window, schedule matched candidates, and run 6+ interviews in one sitting.
tags: [recruiting, hiring, agents, live-screening, zipintro-alternative, live-video-screening]
author: Sean Hogg
---

# Run a 30-Minute Live Screening Block and Replace Two Weeks of Phone Calls

## Why Back-to-Back Beats Async

Async video resumes have a place — they let you screen 100 candidates in an evening. But for the candidates already on your shortlist, async screening loses three things sync screening keeps:

1. **Real-time follow-up questions.** You can't ask a recorded answer to clarify.
2. **Read on energy and culture fit.** Async edits out the moments that tell you whether you'd actually want to work with someone.
3. **Speed to decision.** Async-only loops add 3–5 days per round; back-to-back blocks let you make a same-day call.

ZipRecruiter's ZipIntro is the canonical product here. Builderforce's Live Screening Sessions are the same workflow at a fraction of the cost — and they integrate with the AI Recruiter Agent v2 results from the previous article.

## Step 1: Declare Your Window

Hit `POST /api/recruiter/live-screen/sessions` with the window:

```json
{
  "title": "Staff Backend Engineer first-rounds",
  "jobId": "<uuid>",
  "startTime": "2026-06-03T13:00:00Z",
  "endTime": "2026-06-03T15:00:00Z",
  "slotMinutes": 15,
  "meetingUrl": "https://meet.google.com/abc-defg-hij"
}
```

The session is persisted in `live_screening_sessions` with status `scheduled`. The window is 2 hours; with 15-minute slots, that's a capacity of 8 candidates. You can pick any slot length between 3 and 60 minutes — most recruiters land at 8 minutes for screening and 15 for deeper first-rounds.

## Step 2: Schedule Your Candidates

POST your candidate list to `/sessions/:id/schedule`:

```json
{
  "candidates": [
    { "candidateId": "…", "candidateName": "Alice Chen", "candidateEmail": "alice@example.com" },
    { "candidateId": "…", "candidateName": "Bob Park", "candidateEmail": "bob@example.com" }
  ]
}
```

The pure `buildBackToBackSchedule` function partitions your window into back-to-back slots and pairs the first N candidates with them. The response tells you the capacity, how many got scheduled, and which ones (if any) overflowed — useful when you've shortlisted more candidates than your window holds.

Each invite gets a 32-byte unguessable `invite_token`. Email or SMS the candidate the link to `https://Builderforce/live-screen/invite/{token}` — they don't need a Builderforce account to respond.

## Step 3: Candidate Accepts (or Declines)

When the candidate visits their invite URL, they see the slot time and the session title. They can accept or decline with one click. The public endpoints — `GET /api/live-screen/invites/:token` and `POST /api/live-screen/invites/:token/respond` — require no authentication, so the link works from any inbox.

The meeting URL is **only revealed after the candidate accepts**. This prevents URL-sharing leaks and gives you a clean accept-rate metric: declined candidates never saw the meeting link.

On your dashboard, watch the invite list shift from `pending` → `accepted` / `declined` as candidates respond. Most invites are answered within 24 hours; the few that aren't can be re-pinged or replaced before the window starts.

## Day-Of Workflow

**T-30 minutes.** Open the session's detail view. Confirm the accepted-invite count matches your expectations. Re-message no-responders one final time.

**T-0.** Open the meeting URL. Candidate 1 joins for 15 minutes. You ask 2–3 questions, take notes in your dashboard. At T+15, candidate 1 leaves and candidate 2 joins — same room, same URL, back-to-back.

**T+session.** After the last candidate leaves, flip the session's status to `completed`. Optionally mark `no_show` on any invite that didn't show. Promote the strongest 2–3 to your next round through the normal pipeline.

A 2-hour block lets you interview 8 candidates at 15 minutes each. That used to be two weeks of "let's find a time that works." Now it's one Tuesday afternoon.

## ROI Compared to Phone-Tag Scheduling

**The phone-tag workflow:** 8 candidates × (3 emails + 1 reschedule + 30-min call + 5-min wrap-up) = ~4.5 hours of recruiter time + 14 calendar days from "interested" to "decision".

**The live-screen workflow:** 8 candidates × (1 invite + 15-min slot) = ~2.5 hours of recruiter time + 3 calendar days.

Time saved per 8 candidates: **2 hours of recruiter labor + 11 days of cycle time**. Cycle time matters more than recruiter hours — the candidate with three offers in flight will accept the company that moves fastest. Live-screen blocks turn cycle-time into your competitive edge.

## Frequently Asked Questions

### Do candidates need a Builderforce account to accept an invite?

No. The accept / decline flow is fully tokenised — the invite URL contains a 32-byte unguessable token, and the public endpoints don't require authentication. The candidate can respond from any device, any inbox, with one click.

### Does Builderforce provide the video room?

Not in this release. You provide the meeting URL (Zoom, Meet, Whereby) and Builderforce handles matching, scheduling, invites, accept-flow, and reminders. A native WebRTC room is on the roadmap (Gap Register #1210) but external rooms work well today and let you reuse your existing tooling.

### Can I auto-match candidates from a prior Agent run?

Auto-match into a session from a saved agent run is on the roadmap (Gap Register #1208). Today you POST the candidate list explicitly. The most common pattern is: run the AI Recruiter Agent (top 8 by score), copy those IDs into the `/schedule` body, send. Two minutes end-to-end.

---

**Try it:** [Live Screening Sessions](/hires) on Builderforce.
