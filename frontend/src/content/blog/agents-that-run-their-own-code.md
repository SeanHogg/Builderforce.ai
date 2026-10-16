---
title: The Brain now runs its own code — install, test and build, right in your browser
date: 2026-10-16
description: An agent that writes code but cannot run it hands you unverified work. The Brain on the canvas and in Studio now installs packages, runs tests, builds and type-checks in your own browser, fixes what fails, and shows you a change that has already passed.
tags: [creation-canvas, webcontainers, testing, local-models, app-development, product]
author: Sean Hogg
---

# The Brain now runs its own code — install, test and build, right in your browser

There is a quiet difference between an agent that writes code and an agent that ships it. The first one hands you files. The second one hands you files that compile, whose tests pass, and whose dependencies actually install.

Until today, the Brain on the canvas and in the Studio workspace was the first kind. It could write a backend, a page and a test file, and it wrote them well, but it had no way to run any of them. So the checking fell to you. You opened the preview, found the type error, pasted it back into the chat, waited for a fix, and did it again. The agent was confident; the proof was your job.

That is the gap this closes. The Brain now runs its own code.

## What the Brain can do now

Ask for a change on a build and the Brain can run real commands against it: `npm install` to add a package, `npm test` to run the suite, `npm run build` to bundle it, `tsc` to type-check it. Those are the same commands you would type in a terminal. When one fails, it reads the output, fixes the code it just wrote and runs the command again. By the time it tells you the change is done, the change has passed.

```bf-figure
{
  "kind": "screen",
  "frame": "A build on the canvas, with the Brain checking its own change",
  "ratio": 1.6,
  "regions": [
    { "label": "Files", "note": "The Brain edits them, then proves the edit", "x": 3, "y": 8, "w": 30, "h": 86, "hue": "make" },
    { "label": "Output", "note": "npm install · npm test · npm run build · tsc", "x": 36, "y": 8, "w": 30, "h": 54, "hue": "prove" },
    { "label": "Preview", "note": "The running app stays here, at real widths", "x": 69, "y": 8, "w": 28, "h": 86, "hue": "run" },
    { "label": "Brain", "note": "\"Added the date picker. 14 tests pass, build is clean.\"", "x": 36, "y": 66, "w": 30, "h": 28, "hue": "idea" }
  ],
  "caption": "The change, the proof and the running app on one board. You read a result, not a guess."
}
```

All of it runs in your browser. Builderforce has its own in-browser runtime, [BuilderForce WebContainers](/blog/builderforce-webcontainers-open-source), which already powers the live preview. The Brain's commands run in that same runtime, against the same files, in the same tab. Nothing is sent to a build server and there is no machine to provision. Files a command changes, such as an updated `package.json` or a generated source file, are saved back to your project; installed packages and build output stay where they belong, out of your source.

Because it runs in your own browser, it works before you have an account. Start a guest board, ask for an app, and the Brain proves its own work there too.

```bf-figure
{
  "kind": "flow",
  "title": "How the Brain finishes a change",
  "steps": [
    { "label": "Write", "note": "The Brain edits the build's files for what you asked.", "hue": "make" },
    { "label": "Run", "note": "It installs, tests, builds and type-checks in your browser.", "hue": "prove", "tag": "in your tab" },
    { "label": "Fix", "note": "A failure comes back as real output; it fixes the cause and runs again.", "hue": "build" },
    { "label": "Tell you", "note": "You hear about the change once it has passed, with what it ran.", "hue": "measure", "tag": "verified" }
  ],
  "caption": "The loop a careful engineer runs before asking for a review, run by the Brain before it answers you."
}
```

Two limits are worth knowing up front. Packages that need native addons or system binaries do not run in a browser, and the Brain will tell you when one is the problem rather than pretend. And the app itself keeps running in the live preview, not as a command: a dev server never finishes, so the Brain proves with commands that do and leaves the running to the preview, where you can see it.

## Quick answers on your own machine

The same release makes simple questions faster and more private. If Chrome's built-in model is already on your computer, a plain chat turn, one where the Brain is talking rather than using tools, is answered right there on your device. If that model is not available, or cannot answer, the turn goes to Builderforce's cloud models without you noticing a thing.

```bf-figure
{
  "kind": "compare",
  "title": "Where a Brain turn is answered",
  "columns": [
    { "title": "On your device", "hue": "run", "items": ["Plain conversation, no tools", "Only when Chrome's built-in model is already downloaded", "Private, and costs nothing", "The same tier answers in Rovr, the Builderforce assistant for Chrome"] },
    { "title": "Builderforce cloud", "hue": "make", "items": ["Every turn that uses tools: editing files, running commands", "Any turn where you picked a specific model", "Whenever the on-device model is missing or cannot answer", "Picked up invisibly, before you have seen a word"] }
  ],
  "caption": "Your choice of model always wins. The on-device model only answers turns that never asked for one."
}
```

It is never used when you have chosen a model yourself, and never for a turn that needs tools, so the Brain that writes, runs and fixes your code is always the model you expect.

## Where it sits in the method

Work on Builderforce follows an arc, **Idea → Make → Run → Measure**, and every act has the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). This release puts that loop inside the Brain's own hands, at the point where **Make** turns into **Run**.

- **Read** is where it starts. Before it changes a build, the Brain reads its files and, now, the real output of its commands, so it works from what the code does and not what it hoped the code would do.
- **Prove** is the new part. A change is not done when it is written; it is done when it installs, builds, type-checks and passes its tests. That is the smallest proof there is, the same instinct as a **proof of concept**: isolate the risky part and check it against a bar before you build on it.
- **Build** happens on that proof. The next change starts from a build that is known to work, so a session of ten changes does not end with ten unknowns.
- **Run** stays where you can watch it: the live preview runs the app the Brain just proved, at real device widths.
- **Measure** gets better inputs. Every change that reaches it has already passed its own checks, so what you measure is the idea, not a typo.

## What you can do with it today

- **Ask for a feature and get one that builds.** The Brain runs the build and the type-check before it tells you it is done.
- **Ask it to add tests, and to make them pass.** It writes the tests, runs them, and fixes the code until they do.
- **Add a package by name.** The Brain runs the install and updates `package.json` for you, in the browser.
- **Try it without an account.** Guest boards get the same runtime, because it runs in your browser and nowhere else.
- **Get quick answers locally.** If Chrome's built-in model is on your machine, simple chat is answered there, privately.

Open a board, describe the app you want, and watch the Brain prove its own work before it hands it to you.

---

**Related reading:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers is open source](/blog/builderforce-webcontainers-open-source) · [Meet Rovr](/blog/rovr-your-assistant-in-the-browser) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop)
