---
title: Meet Rovr — a private assistant in your browser that remembers what it did
date: 2026-10-16
description: Your Builderforce agent could code in your editor and build on a canvas, but not help in the tab where most of your day happens. Rovr is a Chrome extension that reads the page, carries out tasks on sites you allow, runs on your own machine first, works offline, and syncs every action and task back to your chat.
tags: [rovr, browser-assistant, local-models, offline, chrome-extension, product]
author: Sean Hogg
---

# Meet Rovr — a private assistant in your browser that remembers what it did

Most of a working day does not happen in an editor or on a canvas. It happens in browser tabs: the expense report, the supplier portal, the booking, the twelve pages you skim to make one decision, the form you fill in for the fourth time this month.

Builderforce's agent could write code in VS Code and build on a board. In the browser it could do nothing at all. You copied text out of a page, pasted it into a chat, read the answer, and went back to do the clicking yourself. The assistant knew a great deal and could not lift a finger where the work actually was.

That is the gap Rovr closes.

## What Rovr is

Rovr is Builderforce's own assistant for the browser — a Chrome extension that opens in a side panel beside the page you are on. You tell it what you need. It reads the page, finds the right fields and buttons, fills things in, moves between tabs and carries out the task step by step, telling you what it did as it goes.

```bf-figure
{
  "kind": "screen",
  "frame": "Chrome with Rovr open beside the page",
  "ratio": 1.6,
  "regions": [
    { "label": "The page you are working on", "note": "Rovr reads it and acts on it — only on sites you allowed", "x": 3, "y": 8, "w": 62, "h": 86, "hue": "run" },
    { "label": "Conversation", "note": "You ask; Rovr answers and acts", "x": 68, "y": 8, "w": 29, "h": 44, "hue": "idea" },
    { "label": "Confirm card", "note": "Submit, buy, send, password: you say yes", "x": 68, "y": 55, "w": 29, "h": 16, "hue": "accent" },
    { "label": "Actions · Tasks · Playbooks", "x": 68, "y": 74, "w": 29, "h": 20, "hue": "measure" }
  ],
  "caption": "One panel, beside the page rather than on top of it. The conversation, the record of what Rovr did, and the tasks it produced live in the same place."
}
```

Three things make it different from a chat window that happens to sit next to a browser.

**It keeps a record of every action.** Each page it reads, each click, each field it fills in and each step you declined is written to an action ledger: what it did, on which page, and how it went. You can scroll back through it at any time, and it travels with the chat, so the record you see in the browser is the record your team sees in Builderforce.

**You can tell it how to do things.** Playbooks are instructions in your own words — *when I say "file my expenses", open the expenses site, add each receipt from my inbox, and stop before submitting.* When a request matches, Rovr follows your steps instead of improvising. They sync through your Chrome profile, so they follow you to every browser you sign in to.

**It asks before anything that matters.** Rovr only works on sites you have allowed, and the first time it needs a new one, it asks. Anything that submits a form, buys something, sends or publishes a message, deletes something, or touches a password or card number waits for you to say yes in the panel. Page content is treated as information, never as instructions: a web page that tells Rovr to ignore you is just a web page saying something odd.

## Private by default, online when it helps

Rovr runs its model on your own computer first. If you have Synapse, Ollama or FreeToken running, that is where your turns go: no account needed, no meter running, nothing leaving your machine. When a turn needs more than your local model can do — a long task with many tools, say — it hands that turn to Builderforce's cloud models, invisibly, before you have seen a word of the answer.

```bf-figure
{
  "kind": "flow",
  "title": "Where a Rovr turn runs",
  "steps": [
    { "label": "On this device", "note": "A capable local model takes the turn first. Private, free, and available offline.", "hue": "run", "tag": "first" },
    { "label": "Builderforce cloud", "note": "If nothing local fits, or the local model fails before answering, the turn moves to the cloud.", "hue": "make" },
    { "label": "Your workspace", "note": "The chat, every recorded action and the tasks it produced sync to Builderforce when you are online.", "hue": "measure", "tag": "later is fine" }
  ],
  "caption": "The decision is made per turn: one task can answer its simple steps on your machine and send only the heavy ones to the cloud."
}
```

And it works offline. Start a chat on a train with no signal and it carries on with your local model; the conversation, its actions and its tasks are saved on your device and queued. When the connection comes back, they sync to your workspace in order, each one exactly once.

## Tasks that land where your team can see them

When you ask Rovr to remember something — *follow up with the landlord on Friday*, *renew the domain before it lapses* — or a task turns up follow-up work, it adds a task to the chat. Pick a project in Settings and each task is created in that project and linked back to the conversation that produced it, so the person who picks it up can see exactly where it came from.

```bf-figure
{
  "kind": "compare",
  "title": "A browser agent in someone else's cloud, and Rovr",
  "columns": [
    { "title": "A remote browser agent", "hue": "muted", "items": ["Runs in a browser on someone else's server", "Your pages and logins travel to it", "Stops when you are offline", "What it did lives in its own history"] },
    { "title": "Rovr", "hue": "run", "items": ["Runs in your own Chrome, with your own sessions", "On your machine first; cloud only when needed", "Keeps working offline and syncs later", "Every action recorded, synced to your chat, tasks in your projects"] }
  ],
  "caption": "Rovr acts in the browser you are already signed in to, on the sites you allow. Nothing about your logins leaves the machine."
}
```

## Where it sits in the method

Work on Builderforce follows an arc, **Idea → Make → Run → Measure**, with the same inner loop inside each act: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Rovr brings that loop to the tab you are already in.

- **Idea** starts where you notice something. Ask Rovr about the page in front of you and the question becomes a chat, with the page as its evidence.
- **Read** is what Rovr does first on every task: it looks at the page before it touches it, and it never guesses at a button it has not seen.
- **Prove** is the confirm card. Before anything with consequences, you see what Rovr is about to do and why it is asking.
- **Run** is the task itself, carried out step by step, on your machine first.
- **Measure** is the action ledger and the tasks. What happened is written down and synced, so the next run — yours or a teammate's — starts from what this one did.

## What you can do with it today

- **Get a task done on a site without doing the clicking** — fill in a form, collect figures from three pages, find the setting buried four menus deep.
- **Write down how you like things done** once, as a playbook, and have Rovr follow it every time.
- **Keep working with no connection** on a model that runs on your own computer, and let the chat sync when you are back online.
- **Turn a conversation into tracked work** — tasks Rovr creates land in your project, linked to the chat that created them.
- **See exactly what happened** — every action, on every page, in order, in the browser and in Builderforce.

Add Rovr to Chrome, sign in with your Builderforce account (or don't, and run entirely on your own machine), allow a site, and ask.

---

**Related reading:** [Local-first AI with WebGPU in the browser](/blog/local-first-ai-webgpu-in-the-browser) · [Open source at Builderforce](/blog/open-source-at-builderforce) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop)
