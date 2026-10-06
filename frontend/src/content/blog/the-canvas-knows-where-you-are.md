---
title: The canvas knows where you are — and shows you the way to the next phase
date: 2026-10-04
description: Measure used to open on a board with nothing live. Now every canvas reads its own board, opens on the next phase you have not done, and turns a phase you are not ready for into the shortest path there. Two new places come with it, Operate for what is running and Launch for putting it in front of people.
tags: [creation-canvas, methodology, idea-to-real, deployment, product]
author: Sean Hogg
---

# The canvas knows where you are — and shows you the way to the next phase

Measure opened on a board with nothing live.

You could press it any time. The canvas would switch tabs, offer Insights, and wait for numbers from an app that had never been deployed. Reach was the same: a place for launch posts with nowhere to send anyone. The phases along the top of the canvas (Idea, Make, Run, Measure, Reach) were a filter on which tabs you saw, and nothing more. They never checked what was on the board. The phase was also one setting per browser, so moving one canvas to Measure moved every other canvas with it.

A phase picker that cannot tell whether a phase is possible is just a menu. The method behind it says more than that: you cannot measure something that is not running, and you should not build before you have written the idea down. The canvas now knows that too.

## Readiness, read off the board

Every phase now reads the board it sits on. It does not use a setting or a checklist you fill in. It looks at the objects the work has already left behind:

- **an idea card** means Idea is done;
- **an app**, the code cards that run together, means Make is done;
- **a deployment with an address** means Run is done;
- **a metric** means Measure is done.

Each phase in the stepper shows one of three states: a tick when its own output exists, a lock when it needs an earlier phase first, or nothing when it is ready to work in. Each canvas keeps its own phase. When you have not picked one, a canvas opens on the **first phase you have not done yet**, so a board that is already live does not drop you back at Idea.

```bf-figure
{
  "kind": "flow",
  "title": "The arc, read from one board with an idea and an app but nothing deployed",
  "steps": [
    { "label": "Idea", "note": "An idea card is on the board.", "hue": "idea", "tag": "✓ done" },
    { "label": "Make", "note": "The code cards run as an app.", "hue": "make", "tag": "✓ done" },
    { "label": "Run", "note": "No deployment with an address yet. This is where the canvas opens.", "hue": "run", "tag": "now" },
    { "label": "Measure", "note": "Reads what a live app does, so it needs Run first.", "hue": "measure", "tag": "needs Run" },
    { "label": "Reach", "note": "Sends people somewhere live, and recommends a metric before you spend.", "hue": "reach", "tag": "needs Run" }
  ],
  "caption": "Nothing new is stored. Readiness is worked out from the cards already on the board, so adding a deployment turns Run's lock into a tick the moment the card lands, with no reload."
}
```

## A lock that never locks

The lock is a label, not a gate. Press Measure on that board and Measure opens, with every surface working. What changes is what it tells you. At the top of the canvas a path card names what is missing and the shortest way to get it.

```bf-figure
{
  "kind": "screen",
  "frame": "Measure, on a board with nothing live",
  "ratio": 1.62,
  "regions": [
    { "label": "Phase stepper", "note": "Idea ✓ · Make ✓ · Run · Measure (lock) · Reach (lock)", "x": 4, "y": 4, "w": 56, "h": 9, "hue": "accent" },
    { "label": "Measure · 1 step away", "note": "Put the app live before you measure it. Go to Run · Publish the app", "x": 4, "y": 16, "w": 56, "h": 15, "hue": "measure" },
    { "label": "The board", "note": "KPI and experiment cards ringed, everything else faded", "x": 4, "y": 35, "w": 62, "h": 50, "hue": "measure" },
    { "label": "Where the first metric goes", "note": "Not yet · needs Run", "x": 70, "y": 35, "w": 26, "h": 26, "hue": "measure", "style": "ghost" },
    { "label": "Command bar · MEASURE tinted", "x": 4, "y": 89, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "The path card takes the place of an empty screen. 'Go to Run' switches the phase, and 'Publish the app' opens the app's own Publish panel: you choose the address, press Publish, and the deployment lands on the board by itself. Fold it into a chip if you want the room, and it comes back the next time you open the canvas."
}
```

The dashed card on the right is a placeholder, not a card. It marks where the phase's first object will go, and it is never saved, synced or added to undo. When the phase is ready it offers to add that object or have Brain make it. When the phase is not ready it says what the phase is waiting on.

## The board brings the phase forward

The bigger change is how the board itself reads. Each phase has the kinds of object it is about. Idea has ideas, interviews, experiments, personas and risks. Make has specs, pages, prototypes and code. Run has deployments, releases and incidents. Measure has KPIs, dashboards, charts and experiments. Reach has posts, campaigns, audiences and listings. Those cards get a ring in the phase's colour. Everything else fades back.

```bf-figure
{
  "kind": "compare",
  "title": "The same board in Measure, with Phase focus off and on",
  "columns": [
    { "title": "Phase focus off", "hue": "muted", "items": ["Every card at full strength", "The KPI sits between a spec, a landing page and six code cards", "You find the numbers by reading every title", "Good for rearranging the whole board"] },
    { "title": "Phase focus on", "hue": "measure", "items": ["KPI, dashboard and experiment cards ringed", "Specs, pages and code faded back, still clickable", "Lines between faded cards fade too", "A card you select is always at full strength", "No metric yet? A dashed card shows where it goes"] }
  ],
  "caption": "Phase focus is on by default and lives in the board's ••• menu. Nothing moves, so the board you arranged stays the board you arranged."
}
```

The rest of the canvas follows the same phase. The command bar highlights the group for the phase you are in. Starting points lead with three starters for that phase, such as "Define the key metric" in Measure or "Draft a launch post" in Reach, before the full catalogue. In the room, the station for the phase lights up and moves to the top of the list. When the phase is not ready, a sign station stands in the room saying what it needs: *Needs a live app*.

## Two new places: Operate and Launch

Two phases had nowhere of their own.

**Operate** appears from Run. It shows what this canvas has running: every deployment with its environment, version, address and when it went out; the board's releases; and whether the app is live. If you have built an app but not deployed it, Operate says so plainly and opens the app's Publish panel for you. Once the site is live, its deployment, with the address, is recorded on the board, and Run is done.

**Launch** appears at Reach. Proving the idea, publishing the board, listing it for sale and telling people about it used to be four separate doors. Launch lays them out on one page, in that order, because that is the order they should happen in.

**Insights**, from Measure, now opens with *This canvas*: the metrics defined on this board, the ones behind target first, before the numbers pinned from anywhere else. When the board has no metric yet, it offers to have Brain define one.

One thing moved the other way. **App now starts at Make.** In Idea you are testing whether anyone wants the thing. A prototype for that is an experiment card on the board, not an app to build before the idea has been tested.

## Where it sits in the method

The method is [Idea to Real](/blog/idea-to-real-the-operating-methodology): Idea, Make, Run, Measure, then Reach. Each phase now has something the board must hold before the next phase can work, and something that phase leaves behind.

```bf-figure
{
  "kind": "flow",
  "title": "What each phase leaves on the board, and what the next one needs",
  "steps": [
    { "label": "Idea", "note": "Read the idea and prove it cheaply. Leaves an idea card. Surfaces: Chat, Board, Ideas, Room.", "hue": "idea" },
    { "label": "Make", "note": "Build only what the proof earned. Needs an idea; leaves an app. Adds App.", "hue": "make" },
    { "label": "Run", "note": "Put it somewhere real. Needs an app; leaves a deployment with an address. Adds Operate.", "hue": "run" },
    { "label": "Measure", "note": "Grade the proof's number. Needs something live; leaves a metric. Adds Insights.", "hue": "measure", "tag": "the loop closes here" },
    { "label": "Reach", "note": "Take it to people. Needs something live, and warns when nothing is measured. Adds Launch.", "hue": "reach" }
  ],
  "caption": "Each phase keeps every surface the phase before it had and adds its own. A later phase never takes a tool away."
}
```

**Idea** is where [Read and Prove](/blog/read-prove-build-the-inner-loop) happen, and both are free. The canvas offers Ideas and Room here and holds back App, because building is the expensive act and the method wants that to be a decision.

**Make** is Build. It needs an idea on the board, and if there is none, the path card's single step is "Let Brain capture it".

**Run** is where a sketch becomes something with an address. Operate is the place you look at it.

**Measure** is where the loop closes. Every proof carries a number that could stop the project, and that number is [graded here](/blog/grade-the-proof-and-close-the-loop). That is why Measure needs something live. A metric about an app nobody can reach measures nothing.

**Reach** needs something live as well, and it also *recommends* a metric. It will let you launch without one, but it will tell you that reaching people without a measure is spending blind.

None of this blocks you. Every phase opens and every surface works. The difference is that the canvas now knows what the board has, so it can tell you honestly what is missing and offer to do the next step.

## What you can do with it today

- **Open any canvas and land on the next step you have not done**, not wherever the last canvas left off.
- **Press a phase you are not ready for** and get the shortest path there, with one press to have Brain do the first step.
- **Read the board through the phase**: the cards that matter come forward and the rest fade, until you turn Phase focus off.
- **See what is running** in Operate: deployments, releases and whether the app is live, all on the board you built it on.
- **Launch from one place**: prove it, publish it, sell it and tell people, in that order.

The board was always the record of the work. Now it also tells you which phase you are in and what comes next.

---

**Related reading:** [Idea to Real: the operating methodology](/blog/idea-to-real-the-operating-methodology) · [The App on your canvas is now a real project](/blog/your-canvas-app-is-a-real-project) · [Grade the proof and close the loop](/blog/grade-the-proof-and-close-the-loop)

[Open a canvas](/create) and press Measure before anything is live.
