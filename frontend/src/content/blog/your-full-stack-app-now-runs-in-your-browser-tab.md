---
title: Your full-stack app now runs in the browser tab you built it in
date: 2026-11-18
description: A frontend, an API and a Postgres database used to need a cloud container before you could see them work together. Now Run starts all three inside your browser tab — Node, Python and PHP services (FastAPI, Flask, Django, Laravel, Slim) with Postgres, with no container to boot or provision and no cloud compute — and the Brain reads its logs, restarts it and captures its preview the same way it does for a container.
tags: [app-development, runtime, browser, idea-to-real, product]
author: Sean Hogg
---

# Your full-stack app now runs in the browser tab you built it in

You describe an app: a page, an API behind it, a database under that. The files are right. The blueprint is right. And then you wait — for a container to be scheduled, booted, installed into and wired up — before you can find out whether any of it works together.

That wait is not a detail. It is the gap between *I made something* and *I know it works*, and every minute of it is a minute the idea could have been tested instead of queued.

That gap is gone. **Run now starts your whole app inside the browser tab.**

## What starts when you press Run

Your project's app blueprint lists its services. Node, Python and PHP services — Express or Next.js, FastAPI, Flask, Django, Laravel, Slim — run in the tab, and the database is a real Postgres running in the page. They are wired to each other, and the live preview opens beside the board.

```bf-figure
{
  "kind": "flow",
  "title": "A full-stack app, entirely inside one tab",
  "steps": [
    { "label": "Frontend", "note": "Your page boots in its own runtime and serves the live preview you click through.", "hue": "make", "tag": "in the tab" },
    { "label": "API", "note": "A Node, Python or PHP service answers the page's requests over a virtual connection to the frontend.", "hue": "run", "tag": "in the tab" },
    { "label": "Postgres", "note": "A real Postgres database, held in the page, so queries, schema and seed data behave as they will in production.", "hue": "measure", "tag": "in the tab" }
  ],
  "caption": "Three services, two connections, one browser tab. The app's code, data and requests stay in your tab; only packages download, from their registries."
}
```

There is no container to boot or provision, and the run uses no cloud compute. Installs still happen — npm, pip and composer run in the tab before the first page — and the first Run boots the in-tab runtime.

## Container run against browser run

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to see the same app run",
  "columns": [
    { "title": "Run in a container", "hue": "muted", "items": ["Wait for a machine to be scheduled", "Wait for it to boot and install", "A fresh machine before every first look", "Uses cloud compute for every look", "Right for executions and deploys"] },
    { "title": "Run in the browser", "hue": "run", "items": ["No container to boot or provision", "Frontend, API and database in one tab", "Installs (npm, pip, composer) run in the tab", "Costs no cloud compute", "Right for finding out if it works"] }
  ],
  "caption": "The container is still there, and still the place for executions and deploys. It just stopped being the price of a first look."
}
```

## The Brain works the same either way

Running somewhere new would not help if the assistant could not see in. It can. The same run tools — read the logs, restart a service, capture the preview — work whether the app runs in your tab or in a container. Ask the Brain why the checkout page returns an error and it reads the API's logs, changes the handler, restarts the service and captures the page again. It does not need to know where the app lives.

That matters because a fast run is only half of a fast loop. The other half is an assistant that can look at the result and act on it.

## Where it sits in the method

Idea to Real is an arc — **Idea → Make → Run → Measure** — and a loop inside it: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Reading and proving cost nothing, so the decision to build is a decision. Building is where cost starts.

Run is the stage where the thing you made has to survive contact with itself: does the page reach the API, does the API reach the data, does the whole path do what you described? A proof in the method is only as good as how soon you get its answer. A smoke test, a proof of concept, a pilot: each one is a question, and each is worth asking while the idea is still warm.

```bf-figure
{
  "kind": "stack",
  "title": "The arc, with the Run stage in the tab",
  "bands": [
    { "label": "Idea", "note": "What if? Read it, and choose the cheapest proof worth paying for.", "hue": "idea" },
    { "label": "Make", "note": "Build the one thing the proof asked for — blueprint, services, data.", "hue": "make" },
    { "label": "Run", "note": "See it work end to end, right where you made it, with no container to wait for.", "hue": "run", "tag": "now in the tab" },
    { "label": "Measure", "note": "Grade it against the kill condition and hand the result back to Idea.", "hue": "measure" }
  ],
  "caption": "Running used to be a place you travelled to. It is now a state of the board you are already on."
}
```

## What you can do with it today

- **Press Run and see your full-stack app work in the tab** — frontend, API and database together, with no container to boot or provision.
- **Prove an idea while it is still warm.** The run starts in the tab you are already in, so there is no queue between the question and the answer.
- **Try changes freely.** A run costs no cloud compute, so restarting ten times to chase a bug costs the same as restarting once.
- **Hand the loop to the Brain.** It reads logs, restarts services and captures the preview exactly as it would for a container.
- **Keep containers for what they are good at** — executions and deploys — when the app is ready to leave the tab.

---

**Related reading:** [The App on your canvas is now a real project](/blog/your-canvas-app-is-a-real-project) · [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop)

[Open a canvas](/create), describe an app with a database in it, and press Run.
