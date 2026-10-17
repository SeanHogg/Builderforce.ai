---
title: Your app now talks back — its console, live connections and a copy you can take with you
date: 2026-10-17
description: The app you build on a Builderforce canvas now shows you what it logs, keeps its live connections and logins working in the preview, comes back without reinstalling on your next visit, and downloads as a project you own.
tags: [creation-canvas, app-development, preview, runtime, product]
author: Sean Hogg
---

# Your app now talks back — its console, live connections and a copy you can take with you

An app that runs in front of you but cannot tell you what it is doing is a screenshot that moves.

That was closer to the truth than we liked. A Builderforce app ran in your browser, but the moment it did something interesting — logged a warning, opened a live connection, set a login cookie — the preview went quiet. The Brain saw crashes and nothing else. A chat app built with WebSockets connected to nothing. A login worked once and forgot you on the next click. And every time you came back, the project started with a full `npm install`, as if it had never met you.

This release closes those gaps. They all sit in the same place: the loop between making a change and seeing what it did.

## What the app tells you now

```bf-figure
{
  "kind": "screen",
  "frame": "The Studio workspace, Console tab open",
  "ratio": 1.62,
  "regions": [
    { "label": "Your running app", "note": "The preview, at the width you chose", "x": 4, "y": 6, "w": 58, "h": 56, "hue": "make" },
    { "label": "Brain", "note": "Reads the same console you do", "x": 66, "y": 6, "w": 30, "h": 56, "hue": "idea" },
    { "label": "Console", "note": "Every log, warning and error the app writes, filtered by level, repeats counted", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run", "tag": "new" }
  ],
  "caption": "The Console tab sits beside Terminal, Output and Problems. What the app writes appears here as it runs, from every page it serves."
}
```

- **A Console tab.** Everything your app writes with `console.log`, `warn` or `error` shows up beside the terminal, as it happens. You can filter by level, repeated lines are counted instead of piling up, and every run starts with a clean console.
- **The Brain reads it too.** Ask "why is the cart empty?" and the Brain can look at what the app actually logged, not just whether it crashed. After a fix, it can read the console again to see whether the warning went away.
- **Every page, not just the first.** Errors and logs come from the dev server's pages and also from pages a Node server returns. An Express app with five routes reports from all five.

## Apps that stay connected

Plenty of what people build is live: chat, dashboards that update, multiplayer boards, progress bars for long jobs. Those depend on three things a browser preview usually can't do, and now all three work.

```bf-figure
{
  "kind": "compare",
  "title": "Inside the preview",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Responses arrived all at once, when the server finished", "WebSockets had nowhere to connect", "A login cookie was dropped on the next request", "Shell scripts with if, for or while failed"] },
    { "title": "Now", "hue": "run", "items": ["Server-Sent Events and progress stream in as they are written", "WebSockets connect to the app's own server and carry its pushes back", "Logins stick: the cookies the server sets come back on every request", "Shell scripts with if, for, while, case and functions run as written"] }
  ],
  "caption": "All of it runs in your browser tab, with no server of ours in the middle and no special headers on your site."
}
```

The same goes for the commands in a project's README. `pnpm install`, `yarn dev` and `pnpm dlx` work as written, next to npm.

## Come back to where you left off

```bf-figure
{
  "kind": "flow",
  "title": "Your second visit",
  "steps": [
    { "label": "Open the project", "note": "The same package.json as last time", "hue": "make" },
    { "label": "Restore", "note": "The packages installed on your last visit come back from this browser's storage", "hue": "run", "tag": "seconds, not minutes" },
    { "label": "Run", "note": "The dev server starts straight away. A changed package.json installs as usual", "hue": "run" }
  ],
  "caption": "Installed packages are kept on your device, for your most recent projects. Change a dependency and the next run installs fresh, then keeps that instead."
}
```

The first run of a project installs its packages as it always has. After that, they're kept in your browser. Your next visit restores them and goes straight to running, and the Brain's own installs use the same store.

## Take it with you

**Download project** is in the Studio's More menu and in the canvas app's panel bar. You get a zip of your app's source, without `node_modules` or build output, ready to open in any editor, push to any host or hand to anyone. What you build on Builderforce was always yours. Now it's also one click away.

## Where it sits in the method

Building is the third act of [Read, Prove, Build](/blog/read-prove-build-the-inner-loop), and the expensive one. Once you're in it, the whole experience comes down to how short the trip is from *change something* to *know what it did*.

Each gap above was a place where that trip broke. Either the app did something you couldn't see, or it couldn't do what the real app would do, or coming back cost you the first few minutes. Closing them keeps the Build act honest: what you see in the preview is what the app will do. Then the Download button takes your work out of Make and into Run, on whatever you choose to run it on.

## What you can do today

- **Open the Console tab** while your app runs, or ask the Brain what the app is logging.
- **Build something live:** a chat, a dashboard that updates, an upload with a progress bar. Then use it in the preview.
- **Sign in to your own app** and stay signed in.
- **Come back tomorrow** and skip the reinstall.
- **Download the project** and take it anywhere.

---

**Related reading:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers is open source](/blog/builderforce-webcontainers-open-source)

[Open a canvas](/create) and build something that needs to stay connected.
