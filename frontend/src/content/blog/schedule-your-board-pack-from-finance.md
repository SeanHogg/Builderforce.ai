---
title: Schedule the board pack once, and stop rebuilding it every month
date: 2026-10-10
description: Report schedules have run on a cron for a while, but you couldn't see them, change them or make one from a page. Finance now has a Reports tab. Pick a report, a cadence and the people it goes to. A board pack sends a frame from one of your boards, picked board first and then frame. The experiments behind your numbers sit on the same page.
tags: [finance, reporting, board-pack, scheduling, product]
author: Sean Hogg
---

# Schedule the board pack once, and stop rebuilding it every month

The month-end board pack is the same deck every time. Runway, burn, the three numbers your vertical is judged by, a line on hiring and a line on the raise. Someone rebuilds it anyway. They export a chart, paste it into slides, fix the axis that broke, and send it at 11pm on the last working day.

The platform could already do this part. A report schedule could deliver a canvas frame as a board pack every month, and a cron sent it. You just couldn't see that schedule, or change it, or create one from any page in the product. The only schedules anyone could find were the QA run's. Everything else was an API route and a database row.

## The Reports tab

Finance now has a fourth tab, after Runway, Cashflow and Dashboard: **Reports**.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance ▸ Reports",
  "ratio": 1.62,
  "regions": [
    { "label": "Scheduled reports", "note": "Every schedule this workspace delivers: type, cadence, recipients, next send", "x": 4, "y": 8, "w": 58, "h": 74, "hue": "run" },
    { "label": "Validation engagements", "note": "The experiments, dashboards and collectors the numbers rest on", "x": 65, "y": 8, "w": 31, "h": 74, "hue": "measure" },
    { "label": "New schedule", "x": 4, "y": 88, "w": 24, "h": 8, "hue": "accent" },
    { "label": "Edit · pause · delete, per row", "x": 32, "y": 88, "w": 64, "h": 8, "hue": "accent" }
  ],
  "caption": "Two pieces that each load their own data. Neither waits on the runway report that the Runway and Cashflow tabs share."
}
```

Each row says what is sent, how often, at what hour, and to how many people. It also shows when it will next go out. **Pause** stops a schedule without losing it, which is useful for the quarter you report in person. **Delete** asks you to confirm first. **Edit** opens the schedule in a side panel, over the page, so you keep your place in the list.

## A board pack is about something

Five of the six report types are about the whole workspace: the standup, the code review, the project status, the executive summary and the portfolio rollup. The board pack is the first one that is *about something*, a frame on one of your boards. So creating one has a step the others don't.

```bf-figure
{
  "kind": "flow",
  "title": "Scheduling a board pack",
  "steps": [
    { "label": "Pick the board", "note": "Your active boards, the same list the canvas gallery shows.", "hue": "idea" },
    { "label": "Pick the frame", "note": "Only the frames the server will accept, each with its tile count.", "hue": "make" },
    { "label": "Cadence and people", "note": "Daily, weekly or monthly, at the hour you choose, to the people you list.", "hue": "run", "tag": "on Finance" }
  ],
  "caption": "The frame list comes from the same check the save runs. A frame you can pick is a frame that will be accepted, so nothing fails later at 11pm."
}
```

That last part matters. A board pack without a frame would go out as "nothing to send" every month, so the server refuses it. A frame on a board this workspace can't read is refused too. The picker reads its list from the route that does that checking, so it can't offer a frame the save would turn down. The form also won't let you submit a board pack until you've picked a frame.

**Recipients are whatever you paste.** Commas, semicolons, one per line, or `Ann Lee <ann@example.com>` copied out of a mail client all work. Anything that isn't an address is named back to you, so it isn't silently dropped.

**What can change after creation is what the schedule can actually change.** You can edit the hour, the recipients and whether it's on. The report type, cadence and frame are fixed once a schedule exists, and the form says so rather than offering edits that would be thrown away. To send a different frame, make a new schedule. It takes about twenty seconds.

## The evidence, on the same page

Next to the schedules is a small card that had no home until now. It lists the experiments, validation dashboards and feedback collectors your workspace is running. Each one shows what it is and its current status, and collectors show how many responses they've had.

```bf-figure
{
  "kind": "compare",
  "title": "What a board pack says, and what it rests on",
  "columns": [
    { "title": "The pack", "hue": "run", "items": ["Runway and burn", "The vertical's KPI tiles", "Hiring and the raise", "Sent on a cadence, unchanged"] },
    { "title": "The evidence", "hue": "measure", "items": ["Which bets are validated", "Which are still in progress", "Which collectors are listening", "How many people answered"] }
  ],
  "caption": "A number with no experiment behind it is a guess with a decimal point. Putting the two side by side is how you see which numbers you can defend."
}
```

## Where it sits in the method

This is Run, the stage where the company keeps itself going, and the job here is a habit that doesn't depend on someone remembering it.

```bf-figure
{
  "kind": "stack",
  "title": "Reporting, on the arc",
  "bands": [
    { "label": "Idea", "note": "The board where the plan was argued out", "hue": "idea" },
    { "label": "Make", "note": "The frame you draw around the tiles that matter", "hue": "make" },
    { "label": "Run", "note": "Finance ▸ Reports. The frame goes out on a cadence, to the people who need it.", "hue": "run" },
    { "label": "Measure", "note": "Validation engagements: the evidence each number rests on", "hue": "measure" },
    { "label": "Reach", "note": "The board, the investors and the team, reached the same way every month", "hue": "reach" }
  ],
  "caption": "The board pack is made on the canvas and delivered from Run. The frame you edit on Tuesday is what arrives on the first of the month."
}
```

Before this, Run had the numbers (Runway, Cashflow, the vertical's dashboard) and no way to *send* them. Without a schedule, reporting meant rebuilding the deck every month. With one, you build it once. You edit the frame on the board when something changes, and the schedule sends whatever the frame shows on the day it goes out.

## What you can do with it today

- **Schedule any of the six reports** daily, weekly or monthly, at the hour you choose (in UTC), to the people you list.
- **Send a board pack from a canvas frame.** Pick the board, then the frame, and the tiles inside it go out on that cadence.
- **Pause, edit or delete** a schedule from the same list, without opening the API or asking an admin.
- **See the evidence alongside it.** Experiments, validation dashboards and feedback collectors are on the same page as the reports.

Creating and changing schedules needs a manager role. Anyone without one sees the controls disabled, with the role they'd need named next to them, rather than hidden.

---

**Related reading:** [The metrics your vertical actually runs on, installed in one click](/blog/install-your-verticals-kpi-dashboard) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)

[Open Finance ▸ Reports](/finance?tab=reports) and schedule the pack you'd otherwise build at 11pm.
