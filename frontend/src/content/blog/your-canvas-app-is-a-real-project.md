---
title: The App on your canvas is now a real project
date: 2026-10-04
description: Press App on any canvas and you get the full Studio workspace in place, with real files, a runtime that can run a server, a terminal, a database and publishing. No account is needed to start, and "Keep your work" carries the app into one.
tags: [creation-canvas, studio, app-development, preview, no-code, product]
author: Sean Hogg
---

# The App on your canvas is now a real project

You sketch an idea on the canvas, ask Brain for a marketing site, and press **App**.

Until today, what you saw there was a preview. The canvas took the code cards on the board, stitched the page and its stylesheets into one document and showed it in a frame. That was useful for looking at things. It could not run the server half of anything, could not install a package and had no database. Once the idea needed any of that, you left the canvas for Studio and started again in a second window, with a second conversation.

Now the App tab **is** Studio. It's the same workspace, inside the canvas you were already on.

## What App opens now

```bf-figure
{
  "kind": "screen",
  "frame": "A canvas, reading as its app",
  "ratio": 1.62,
  "regions": [
    { "label": "The running app", "note": "Real files on a real dev server, with hot reload", "x": 4, "y": 10, "w": 46, "h": 56, "hue": "make" },
    { "label": "Files", "note": "Open from the bar, search across the project", "x": 51, "y": 10, "w": 16, "h": 56, "hue": "accent" },
    { "label": "Terminal · Output · Problems", "x": 4, "y": 68, "w": 63, "h": 14, "hue": "run" },
    { "label": "Brain", "note": "The canvas's own Brain, now able to edit the app's files", "x": 70, "y": 10, "w": 26, "h": 72, "hue": "idea" },
    { "label": "Run · Preview · Code · Database · Publish", "x": 4, "y": 88, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "The canvas keeps its own chrome: one session bar, one Brain, one stage arc. The workspace adds its controls to the bar rather than drawing a second toolbar."
}
```

- **A real project behind it.** It has the files the agent wrote, an in-browser runtime that installs packages and runs a dev server (and a Node server, if your app has one), plus a terminal, checks and a problems list.
- **One Brain.** The Brain panel on the right is the canvas's Brain, the one you were already talking to. It can now list, read, search and edit the app's files, so "make the header sticky" changes the code and the preview updates.
- **Your code cards become files.** If you had been building with code cards on the board, App brings them into the project the first time it opens, and again whenever a card changes. Nothing is asked and nothing is lost.
- **Database and Publish when you need them.** The same Database view and Publish panel Studio has, one click from the session bar.
- **Open in Studio** when you want the whole screen. It's the same project, so nothing needs to be copied.

## Start without an account

```bf-figure
{
  "kind": "flow",
  "title": "From a guest canvas to a durable app",
  "steps": [
    { "label": "Press App", "note": "Pick Website, Mobile or Web + Mobile — or just ask Brain", "hue": "idea" },
    { "label": "It runs here", "note": "The project lives in your browser and runs on the same runtime as Studio", "hue": "make", "tag": "no account" },
    { "label": "Keep your work", "note": "Your board is saved to an account and the app's files go with it into a real project", "hue": "run" },
    { "label": "Publish", "note": "History, a database and a live address switch on", "hue": "accent" }
  ],
  "caption": "Nothing is rebuilt at the hand-off. The files you had in the browser are the files the project starts with."
}
```

You don't need to sign up to find out whether the idea works. A canvas without an account runs its app over files kept in your browser, on the same runtime Studio uses. When it is worth keeping, press **Keep your work**. The board moves to your account, and the app moves with it into a durable project with version history, a database and publishing.

## More than one app on a board

A board can hold several builds: a marketing site and an admin tool, or a web app and its phone twin. App runs one at a time, and a switcher appears in the session bar as soon as there is a second one. Opening any build card on the board takes you straight to it.

## Where it sits in the method

Make is the act where an idea becomes something you can use. It was also the act that split across two products. Read and [Prove](/blog/read-prove-build-the-inner-loop) happened on the canvas, and serious building happened in a separate IDE. The distance between them was a context switch, a copy-paste of the idea and a Brain that started from nothing.

```bf-figure
{
  "kind": "compare",
  "title": "From proven idea to running app",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Prove the idea on the canvas", "Open Studio in another window", "Re-explain the idea to a new chat", "Build there", "Come back to the canvas to measure"] },
    { "title": "Now", "hue": "make", "items": ["Prove the idea on the canvas", "Press App", "Keep talking to the same Brain", "Run it, then Measure on the same board"] }
  ],
  "caption": "Idea → Make → Run → Measure now happens on one surface, with one conversation carried through every stage."
}
```

Because the app lives on the same board as the research, the proof and the metrics, **Run** and **Measure** follow without a hand-off. The thing you measure is the thing the board built, and the Brain that reads the numbers is the one that wrote the code.

## What you can do with it today

- **Open App on any canvas** and build with real files, packages and a server, without leaving the board.
- **Keep building with Brain**, which now edits your app's code directly.
- **Turn existing code cards into a running project** just by opening App.
- **Try it with no account**, and keep it when it's worth keeping.
- **Switch between apps** on the same board, or open any of them full-screen in Studio.

---

**Related reading:** [Builderforce Studio — describe an app, watch it run, keep every version](/blog/builderforce-studio-describe-it-run-it) · [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Create before you sign up](/blog/create-before-you-sign-up)

[Open a canvas](/create), press **App**, and ask for something with a backend in it.
