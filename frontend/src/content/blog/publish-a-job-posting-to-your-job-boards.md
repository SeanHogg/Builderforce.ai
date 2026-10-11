---
title: Publish a job posting to your job boards — and know where it is actually live
date: 2026-10-10
description: A job posting on the canvas could be written, counted and shortlisted against, and could not be put in front of a single candidate. It now goes out to your connected job boards from the card, and the card only says "live" where a board confirmed it.
tags: [hiring, recruiting, job-boards, connectors, creation-canvas, run]
author: Sean Hogg
---

# Publish a job posting to your job boards — and know where it is actually live

Every search starts with the same act: put the role in front of people. On the canvas, that was the one act a job posting could not do.

You could draft the requisition with Brain, give it a real record in the workspace, rank a stack of CVs against it and count the applications it had received. The card even had a field for where it was published — `distribution`, one row per board, with a status, a date and a link. Nothing wrote to it. The workspace already shipped job-board connectors for Greenhouse, Lever, Ashby, Indeed, LinkedIn Jobs and a careers-site feed, each able to create a posting, and nothing called them for a real requisition. So "post this role" ended in a document, and applicant volume was zero because nobody had been told the job existed.

## Distribute, from the card

A job posting card now has a **Distribute** control. It lists the boards your workspace has connected, you tick the ones you want, and you press the button.

```bf-figure
{
  "kind": "flow",
  "title": "What one press of Distribute does",
  "steps": [
    { "label": "Pick boards", "note": "Only boards you have connected, and only ones the posting is not already live on.", "hue": "run" },
    { "label": "Publish", "note": "Each board gets the same posting: the record's title, description and requirements, plus the location and seniority on your card.", "hue": "run" },
    { "label": "Read the answer", "note": "The board's reply is read for its own id for the posting, and for its public link when it gives one.", "hue": "run" },
    { "label": "Record it", "note": "One row per board in the workspace: Live with the board's id, or Failed with the board's reason.", "hue": "measure", "tag": "the card reads this" }
  ],
  "caption": "Every call goes through the same connector runtime as every other integration: your credentials per workspace, checked, logged and audited."
}
```

You can also just ask. Tell Brain to post the role and it reads where the posting is already live and which boards are connected, asks you which to use, and only then publishes. Publishing puts your company's name on a public board, so it goes through the same approval rule as sending a campaign.

```bf-figure
{
  "kind": "screen",
  "frame": "A job posting card",
  "ratio": 1.3,
  "regions": [
    { "label": "The requisition", "note": "Role, level, location, must-haves, the applicant count", "x": 4, "y": 6, "w": 92, "h": 34, "hue": "idea" },
    { "label": "Published to", "note": "Lever: Live, since 9 Oct, View posting · Indeed: Failed, Unauthorized", "x": 4, "y": 44, "w": 92, "h": 22, "hue": "run" },
    { "label": "Publish to", "note": "Greenhouse · Ashby · Careers feed", "x": 4, "y": 70, "w": 60, "h": 14, "hue": "accent" },
    { "label": "Distribute to 2 boards", "x": 4, "y": 87, "w": 44, "h": 8, "hue": "accent" }
  ],
  "caption": "The list of where it is live is read from the workspace every time the card opens, not kept on the card."
}
```

## "Live" means the board said so

The hard part was not calling six APIs. It was deciding what counts as published.

An HTTP 200 is not a publication. Ashby answers every request with 200 and puts a refusal inside the body. GraphQL APIs like Indeed's do the same. LinkedIn's job posting endpoint is a batch call whose per-job failures sit inside a successful response. A system that trusted the status code would tell a recruiter a role was live on three boards where it was live on one, and the candidates who went looking would find nothing.

So a board is shown as **Live** only when its answer carried its own id for the posting. Anything else is shown as **Failed**, with the reason the board gave. The rule is enforced by the database as well: a confirmed row without the board's id cannot be written.

```bf-figure
{
  "kind": "compare",
  "title": "What a board's answer can mean",
  "columns": [
    { "title": "Recorded as Live", "hue": "run", "items": ["The board answered with its id for the posting", "Its public link is shown when it returned one", "Pressing Distribute again skips it, so the job is never posted twice"] },
    { "title": "Recorded as Failed", "hue": "muted", "items": ["The board refused the request", "It answered 200 but reported an error inside", "It answered 200 with no id for the posting", "A credential or a required field was missing"] }
  ],
  "caption": "A failed board can be retried. A live one is left alone, because a second create on most boards is a second posting."
}
```

That decision is also why every board is handled by the same code. Each connector already says, as data, where every input goes on the request. It now also says where the posting id and the link come back on the response: `data.id` and `data.urls.show` for Lever, `results.id` for Ashby, the first element's id for LinkedIn, with a header as the fallback. Adding a board is a new entry in the catalog, not a new branch in the publisher, and a board that cannot tell us its id is never offered as a target.

## Applicants, by board

A posting's applications already broke down by source. Now every board the posting went out on appears in that breakdown under its own name, with its real count. That includes zero, because "Indeed: 0 after two weeks" is exactly the number that tells you a board is not working. Leaving it out would read as "never posted there". The board rows on the card carry the same count.

The match is exact. An application recorded as coming from a board carries that board's key, and the posting's own id travels to every board so the board can name it back. A free-text source like "LinkedIn" typed on an application is left as it is rather than guessed onto the LinkedIn Jobs board, because a misattributed applicant gives the wrong answer to the only question this breakdown exists for.

## Where it sits in the method

Run. Idea and Make produced the requisition: the role, the bar, the record behind it. Run is where it starts working in the world, and a hiring search starts working only once candidates can see it.

```bf-figure
{
  "kind": "flow",
  "title": "A requisition across the method",
  "steps": [
    { "label": "Idea", "note": "Draft the role with Brain on the canvas", "hue": "idea" },
    { "label": "Make", "note": "Give it a real record; rank CVs against it", "hue": "make" },
    { "label": "Run", "note": "Distribute it to the boards and see where it is live", "hue": "run", "tag": "new" },
    { "label": "Measure", "note": "Applicants per board; which boards are quiet", "hue": "measure" },
    { "label": "Reach", "note": "The careers feed puts it on every aggregator without a partner API", "hue": "reach" }
  ],
  "caption": "The card stays a handle on the record at every step: the counts, the boards and the links are read from the workspace, never typed."
}
```

## What you can do with it today

- **Post a role to several boards at once** from the job posting card, or by asking Brain.
- **See where it is actually live**, with a link to each board's listing when the board gives one.
- **Retry a board that failed** after fixing the reason it gave, without posting twice anywhere it already worked.
- **Compare boards by applicants**, including the ones that have produced nobody yet.
- **Reach the long tail** with the careers-site feed, which every aggregator without a partner API reads.

---

**Related reading:** [Delegate the search, not the decision](/blog/delegate-the-search-not-the-decision) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)

[Open a canvas](/create), add a job posting and connect a job board under Integrations.
