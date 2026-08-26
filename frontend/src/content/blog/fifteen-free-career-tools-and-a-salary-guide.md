---
title: Fifteen career tools that compute an answer — and a salary guide that names your city
date: 2026-08-18
description: Score a résumé, match it to a posting, tailor it, plan a route to a target role, prepare interview questions, check your market salary. Free, no account, and every number shows its working.
tags: [career, resume, salary, job-search, tools]
author: Sean Hogg
---

# Fifteen career tools that compute an answer

Most "AI résumé" tools do one of two things. They rewrite your document and hand it back, or they give you a score out of 100 with no way to tell what moved it. Both are unfalsifiable: you cannot check the rewrite against the job, and you cannot argue with the score.

The fifteen tools now live at [/tools](/tools) take the other approach. Each one is a **reading** — a computation over your document and, where relevant, a real job posting — and each one shows what it counted.

```bf-figure
{
  "kind": "stack",
  "title": "What the fifteen actually do",
  "bands": [
    { "label": "Score against an ATS", "note": "What a screening system can and cannot extract from your file, and which sections it loses.", "hue": "growth" },
    { "label": "Match to one posting", "note": "Your evidence against the requirements THIS employer wrote, not a generic rubric.", "hue": "growth" },
    { "label": "Tailor for an application", "note": "An anchored plan against that posting — what to lead with, what to cut, what you have no evidence for.", "hue": "make" },
    { "label": "Plan a route to a target role", "note": "The gap between where you are and the job you want, with the projection behind it.", "hue": "idea" },
    { "label": "Prepare for the interview", "note": "A question set built from the posting, with the rubric each answer is scored against.", "hue": "prove" },
    { "label": "Check your market salary", "note": "By role and city, from a bounded catalogue rather than a vibe.", "hue": "measure" }
  ],
  "caption": "Fifteen tools, one runner. They arrive as registry data, which is why the hub and the tool page did not have to learn anything about careers to serve them."
}
```

## Why "shows its working" is the whole product

A number you cannot interrogate is advice you cannot act on.

If a tool says your résumé scores 62, the only available response is to try a different résumé and see whether the number goes up — a slot machine, not a method. If it says *the posting names five requirements, your document carries evidence for three, and the two it does not are the ones in the first paragraph of the ad*, you know exactly what to do next and whether you agree.

That is also why the tailoring tool is anchored to one posting rather than producing a generically "stronger" document. A résumé is not good or bad in the abstract. It is aimed or unaimed.

## The salary guide

```bf-figure
{
  "kind": "bars",
  "title": "A bounded catalogue, not an open-ended query",
  "max": 240,
  "rows": [
    { "label": "Roles covered", "value": 16, "note": "16", "hue": "measure" },
    { "label": "Cities", "value": 14, "note": "14", "hue": "run" },
    { "label": "Addresses in the guide", "value": 240, "note": "240", "hue": "growth" }
  ],
  "caption": "Role × city pages, each one a real reading rather than a template with two words swapped. Bounded on purpose: a guide that can answer anything answers most things badly."
}
```

Start at [/salary](/salary), or go straight to a role and a city. The same reading powers the salary calculator in the tools hub, so the guide you browse and the number the tool gives you cannot drift apart — one catalogue, two surfaces.

There is also [/references](/references): a reference list that stays private until you mint a link, which is the correct default for a document containing other people's contact details.

## Your job search, as objects rather than prose

Everything these tools produce used to land as text in a document — which is fine to read once and useless the next turn, because nothing downstream can reason over a paragraph.

They now land as objects: the posting, the application, the interview, the tailored variant. Connect them, filter them, ask what is stalled. And saved job alerts finally *run*: on a schedule, telling you what matched, using exactly the rules of the search you were looking at when you saved it.

That last detail matters more than it sounds. An alert that quietly disagrees with the board it was created from is an alert you learn to ignore inside two weeks.

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to hold a job search",
  "columns": [
    { "title": "A document per answer", "hue": "muted", "items": ["Readable once", "Nothing can be counted", "Nothing can be compared", "The pipeline lives in your head"] },
    { "title": "Objects on a board", "hue": "growth", "items": ["Applications, postings, interviews, variants", "Connected to each other", "Countable — how many are waiting on me?", "Alerts that use the same rules as the search"] }
  ],
  "caption": "The same argument that made the founder seat work, applied to the seat with the most visitors and the least company behind them."
}
```

---

**Related reading:** [How to score your résumé for ATS](/blog/how-to-score-your-resume-for-ats) · [How to research your market salary](/blog/how-to-research-your-market-salary) · [Tailor your résumé for every application](/blog/tailor-your-resume-for-every-application) · [Build a career roadmap with AI](/blog/build-a-career-roadmap-with-ai)

Run one now — the [tools hub](/tools) needs no account.
