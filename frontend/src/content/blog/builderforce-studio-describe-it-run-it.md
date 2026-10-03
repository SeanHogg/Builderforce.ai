---
title: Builderforce Studio — describe an app, watch it run, keep every version
date: 2026-10-03
description: studio.builderforce.ai turns a prompt into a running app in one window. Every agent turn becomes a version you can restore, the app's data has its own Database view, and Node, Vue and Svelte projects run right in your browser.
tags: [studio, app-development, preview, versions, database, product]
author: Sean Hogg
---

# Builderforce Studio — describe an app, watch it run, keep every version

You describe a small app: a waitlist page that saves sign-ups and emails you when someone joins. Thirty seconds later there are a dozen files, a server and a form.

What happens next is the part that matters, and until now it went badly in one of three ways. The project needed a server, and the preview could not run one. The agent's next turn broke something that worked a minute ago, and there was no clean way back. Or it all worked, and you had no idea where the sign-ups were going.

**Builderforce Studio** is built around those three moments.

## One window, from prompt to running app

Open [studio.builderforce.ai](https://studio.builderforce.ai), type what you want, and you are in a workspace with the agent on one side and the running app on the other. You don't need an account to start typing. Signing in happens in a pop-up when it is needed, so the prompt you wrote is still there when you come back.

```bf-figure
{
  "kind": "screen",
  "frame": "A Studio project",
  "ratio": 1.62,
  "regions": [
    { "label": "Agent", "note": "Describe the change; each turn becomes a version", "x": 3, "y": 10, "w": 24, "h": 80, "hue": "idea" },
    { "label": "Preview · Code · Database", "note": "The running app, its source, and what it stores", "x": 29, "y": 10, "w": 46, "h": 62, "hue": "make" },
    { "label": "Terminal · Output · Problems", "x": 29, "y": 75, "w": 46, "h": 15, "hue": "run" },
    { "label": "Files · Versions · Publish", "x": 77, "y": 10, "w": 20, "h": 80, "hue": "accent" },
    { "label": "Publish · GitHub · Share", "x": 60, "y": 2, "w": 37, "h": 6, "hue": "accent" }
  ],
  "caption": "Everything a small app needs, in one window: the conversation, the running result, its files and history, and its data."
}
```

## It runs, whatever kind of app it is

Previews used to cover pages, not servers. If the agent wrote an Express API, a Vue app or a Svelte app, the preview had nothing to show.

Now the whole thing runs in your browser on Builderforce's own runtime. The project's dependencies install, its server starts, and the preview shows its real routes. Vue and Svelte projects preview and publish the same way React ones do. The terminal is a real shell: `npm install`, `node server.js`, `ls`, `cat`.

```bf-figure
{
  "kind": "flow",
  "title": "What happens when you press Run",
  "steps": [
    { "label": "Instant preview", "note": "A Vite, React, Vue, Svelte or static project is served straight from memory, with no install step.", "hue": "make" },
    { "label": "Or its own server", "note": "A project with a Node server runs npm install and npm run dev, and the preview follows the port it opens.", "hue": "make" },
    { "label": "Edits land live", "note": "Every change, yours or the agent's, reloads the preview.", "hue": "run", "tag": "in the browser" }
  ],
  "caption": "No metered session, no cloud machine to wait for. The code runs on a separate preview domain, so it never shares your Builderforce sign-in."
}
```

Publish builds the site in the browser too, with hashed assets and a relative base, ready to serve at your subdomain. Check type-checks the project and builds it. Anything that fails goes to the agent along with the error, so a broken build gets fixed rather than sitting there looking finished.

## Every turn is a version

When the agent finishes a turn, the files it touched become a version: *Changed App.tsx, Header.tsx and 2 more*. You can name one yourself before trying something risky. Restoring takes two clicks, and it saves where you are first, so a restore is itself something you can undo.

```bf-figure
{
  "kind": "compare",
  "title": "When the next turn breaks what worked",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Ask the agent to undo it", "Hope it remembers what 'it' was", "Diff files by eye", "Lose the good change along with the bad one"] },
    { "title": "In Studio", "hue": "make", "items": ["Open Versions", "Pick the turn before it went wrong", "Restore — and the current state is saved first", "Carry on from there"] }
  ],
  "caption": "Versions are recorded as the agent works, without you having to remember to save."
}
```

## The app's data has a place to live

A published app keeps what people send it. The **Database** view sits next to Preview and Code:

- **Tables.** Every collection the app writes to, with its rows, its endpoint and its switches: open a ticket for each submission, let signed-in users read back their own rows. Add a table, delete a row, or delete a table.
- **Users.** Everyone who signed in to your app. They sign in with a one-time code by email, so there are no passwords to manage. Suspend someone, which signs them out everywhere, or remove them.
- **Server functions.** The app's backend handlers and the secrets they use. These work before you publish.

Before the first publish, the view tells you so and opens Publish. After it, everything fills in on its own.

## Where it sits in the method

Work on Builderforce follows an arc — **Idea → Make → Run → Measure** — and each act runs through the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Studio is the **Make** act made short. An idea becomes a running app in the window you described it in, and **Build** stops being the step where attention leaks: no terminal elsewhere, no deploy to wait for, no second tab.

Versions keep **Build** honest. When the agent tries something, you see the result in the preview, and if it is wrong you go back one turn. Trying things costs nothing, which is how a loop should feel.

The Database view is where **Run** starts. The moment the app is live, the people using it and what they send are on the same screen as the code that serves them. That is also the first evidence **Measure** has to work with: who signed up, and what they asked for.

## What you can do with it today

- **Go from a prompt to a running app**, server included, without installing anything.
- **Undo any agent turn** with two clicks, and name the versions that matter.
- **See and manage your app's data and users** next to its code.
- **Publish** to your own subdomain, or push to GitHub, from the header.

Next.js, Nuxt and SvelteKit dev servers don't run in the browser yet; for those, Run tells you why rather than failing silently.
