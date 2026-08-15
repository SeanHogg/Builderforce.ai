---
title: Source 50 Candidates in 5 Minutes: The AI Recruiter Agent v2 Playbook
date: 2026-05-25
description: Use Builderforce's AI Recruiter Agent to convert a plain-English brief into a ranked shortlist with personalized outreach drafts and scheduled follow-ups — without touching Boolean search.
tags: [recruiting, hiring, agents, recruiter-agent, semantic-sourcing, ai-recruiter-agent]
author: Sean Hogg
---

# Source 50 Candidates in 5 Minutes: The AI Recruiter Agent v2 Playbook

## The Old Workflow vs the Agent Workflow

**The old workflow.** You write a Boolean search by hand. You scroll through 200 profiles. You shortlist 15. You manually draft an outreach to each. You set a calendar reminder to follow up in three days, another in seven. You forget the second one. Half your candidates never hear back. The whole process is two hours for one role.

**The Agent workflow.** You paste a plain-English brief — "hiring a senior staff infrastructure engineer with deep Go and Kubernetes experience for a Series C fintech in NYC, 7+ years" — and the agent returns a ranked candidate list, a personalised outreach for each, and a scheduled follow-up sequence. Five minutes, one role.

The AI Recruiter Agent doesn't replace your judgment — it removes the keystrokes between your judgment and the sent message.

## Step 1: Intake (Brief → Structured Criteria)

Hit `POST /api/recruiter/agent/intake` with `{ briefText: "…" }`. The agent parses the brief and returns structured criteria:

```json
{
  "jobTitle": "Senior Staff Infrastructure Engineer",
  "skills": ["go", "kubernetes", "terraform"],
  "location": "New York, NY",
  "experienceYears": 7,
  "maxCandidates": 20,
  "source": "brief"
}
```

Or if you already have a job posting, pass `{ jobId: "<uuid>" }` and the agent derives the same shape from the job row — title, skills, location, with experience inferred from the description.

This intake step is what LinkedIn markets as Semantic Sourcing: instead of typing `(go OR golang) AND kubernetes AND "New York"` you describe the role in English. The agent runs in heuristic-only mode when no LLM key is configured, so the surface always returns a usable criteria shape — useful for local dev and for graceful degradation when the model provider is down.

## Step 2: Source (Criteria → Ranked Candidates + Outreach Drafts)

Pipe the intake response into `POST /api/recruiter/agent/source`. The agent does three things in one round-trip:

1. **Sources** — keyword-matches candidates from the resumes database against the criteria's skills.
2. **Scores** — runs each candidate through the LLM with the role context, returning a 0–100 fit score and a one-sentence reason.
3. **Drafts outreach** — for each candidate, generates a three-sentence personalised LinkedIn / email outreach that references the candidate's actual background, not a generic template.

The run is persisted to `recruiter_agent_runs` so you can revisit it later via `GET /api/recruiter/agent/runs/:id`. The results are sorted by score descending — review the top 10, dismiss the ones that aren't right, and proceed to step 3 for the rest.

## Step 3: Schedule Follow-ups (Persistent Cadence)

Manual follow-ups are where 90% of recruiting workflows leak candidates. The agent's third superpower is persisting them.

For each candidate you want to follow up on, call `POST /api/recruiter/agent/followups/schedule` with `{ runId, candidateId, dayOffset, body }`. The defaults are 3 days for the first follow-up, 7 for the second, 14 for the final. Customise the body or use the AI-generated draft.

A cron worker (`recruiter-agent-followup`, runs every 5 minutes) flips due rows from `pending` to `sent`, materialising the reminder into your `candidate_interactions` feed so you see it in your dashboard the moment the slot arrives. Cancel any scheduled follow-up with `POST /api/recruiter/agent/followups/:id/cancel` if the candidate has already replied.

This is the part LinkedIn Hiring Assistant charges thousands of dollars per seat for. On Builderforce it's part of the Pro plan with no per-seat upcharge — the [pricing page](/pricing) carries the current rate.

## ROI Math: What 5 Minutes Saves Per Role

Conservative estimates for a recruiter sourcing one role per day, 20 working days per month:

- **Manual workflow:** ~2 hours per role × 20 roles = **40 hours / month** on sourcing + outreach + follow-up.
- **Agent workflow:** ~5 minutes per role × 20 roles = **100 minutes / month** on the same workflow.
- **Time recovered: ~38 hours / month** to spend on interviewing, closing, and team management instead of keystrokes.

LinkedIn Charter customers using Hiring Assistant report 62% fewer profiles reviewed, 4+ hours saved per role, and 69% higher InMail acceptance. Builderforce's agent runs the same loop inside the Pro plan, with no Hiring Assistant add-on fee.

The hidden ROI is the follow-up cadence. Most recruiters drop more candidates from forgetting to follow up than from candidates declining. Scheduled follow-ups effectively give you a +30% top-of-funnel without sending a single extra outreach.

## Frequently Asked Questions

### Does the AI Recruiter Agent auto-send the outreach?

Not yet — the agent currently materialises the message as a draft in your candidate-interactions feed and you dispatch via your chosen channel (email, LinkedIn, SMS). Auto-send via the Comm Hub is on the roadmap (Gap Register #1206); the current architecture is deliberately recruiter-in-the-loop so an LLM hallucination can't ping a candidate without review.

### What happens when the LLM provider is down?

The intake endpoint falls back to a deterministic heuristic that extracts the role, skills (from a dictionary match), location, and experience years from the brief. The source endpoint falls back to a baseline-score-plus-template-outreach for each candidate. The surface degrades, never errors.

### How is this different from a Boolean search?

A Boolean search returns everyone who matches the keywords. The agent ranks them by LLM-derived fit, drafts a personalised outreach for each one, and schedules follow-ups — the three steps that turn a search into a hire. You can still write Boolean searches; the agent layers on top.

---

**Try it:** [AI Recruiter Agent](/hires) on Builderforce.
