---
title: Teach it once, and it does it again
date: 2026-09-27
description: Synapse can now learn a task by watching you do it once in any Windows program, turn it into a skill that asks for new values each time, run it on request or on a schedule, stop for your OK before anything irreversible — and teach your private Evermind the procedure. Opt-in, local, and forgettable.
tags: [agents, evermind, privacy, product]
author: Sean Hogg
---

# Teach it once, and it does it again

Every week there is a task that is not worth automating and not worth doing.

Copy the supplier's invoice total into the ledger app. Pull the month's figure out of one program and type it into another. Fill the same six fields in a form that has no API, no export and no integration — just a window you have to click through. It is ten minutes, it is always the same ten minutes, and the only way to get it done is for a person to sit there and do it.

AI tools talk about doing this for you. Most of them need an API, a browser extension, or a screen-reading model guessing at pixels every time. None of them keep what they learned about how *you* do the task.

That is the gap: **the work that lives inside desktop programs has had no way to be taught, and nothing that learned it kept the lesson.**

## Show it once

Switch on Self-Directed Agents in Synapse — it is off until you do — and pick a program. Synapse launches it and watches only that program while you do the task once, the way you always do.

```bf-figure
{
  "kind": "flow",
  "title": "From one demonstration to a skill",
  "steps": [
    { "label": "Record", "note": "Synapse launches the program and records the controls you used and the values you set — not a keystroke log. Password fields are never captured.", "hue": "idea" },
    { "label": "Review", "note": "Every step, with its screenshot. Drop stray clicks, choose which values it asks for each run, and where it must ask you first.", "hue": "idea" },
    { "label": "Train Once", "note": "The demonstration becomes a skill: typed values become named inputs, secrets become vault entries, sends and deletes become approval gates.", "hue": "make", "tag": "one demo" },
    { "label": "Run", "note": "On request with new values, or on a routine while Synapse sits in the tray. Esc takes the mouse back at any moment.", "hue": "run" }
  ],
  "caption": "Nothing becomes a skill until you have reviewed it. The recording covers one program and only while you record."
}
```

What gets recorded is *meaning*, not keystrokes: "set Amount to 250.00 in Invoices", "click Send invoice". That is what lets the skill run again next month, when the window is somewhere else on the screen and the amount is different.

## It asks before anything it cannot undo

A skill that clicks **Send**, **Pay**, **Delete** or **Submit** stops at that step and asks. The window comes forward, says exactly what it is about to do, and waits. Nobody answers within fifteen minutes, the run stops.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Runs",
  "ratio": 1.5,
  "regions": [
    { "label": "“Monthly invoice” needs your OK", "note": "The next step can’t be undone: Click “Send invoice” in “Invoices”", "x": 20, "y": 14, "w": 60, "h": 34, "hue": "accent" },
    { "label": "Audit trail", "note": "Every step of every run: done, done by position, approved, declined, failed", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "run" }
  ],
  "caption": "Approval gates are set by Train Once from what the button says, in all five product languages — and you can add or remove one in review."
}
```

Every run keeps its audit trail — each step, how it was done, what you decided — so "did the routine actually file it?" has an answer you can read.

## Your Evermind learns the procedure

Here is the part no other tool does. Each skill you save is also written as the procedure a person would write down — the task, then numbered steps, with the values as placeholders — and your **private Evermind** learns from it, once, on your machine.

```bf-figure
{
  "kind": "compare",
  "title": "What happens to what you taught",
  "columns": [
    { "title": "Automation tools", "hue": "muted", "items": ["A script that replays clicks", "Knows nothing about why", "Lives in one app's settings", "Gone when you switch tools"] },
    { "title": "Synapse", "hue": "make", "items": ["A skill that asks for new values", "A procedure your own model learned", "Stored with your memories, shared by every AI tool you connect", "Forget any of it, or all of it, any time"] }
  ],
  "caption": "Demonstrations, skills, runs and facts live in the same local Evermind store your coding agents already use. Secrets stay in Windows Credential Manager and never enter it."
}
```

It is the same store your coding agents already remember facts in, so everything you teach sits beside everything they learned — on your computer, in files you can see, with a Forget button on each.

## Where it sits in the method

Builderforce work moves along one arc — **Idea → Make → Run → Measure** — and each act runs the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Self-Directed Agents are a **Run** feature. Run is where recurring work either happens reliably or quietly stops happening, and the work inside desktop programs has had no way into it at all. Teaching a task once puts that work on the arc.

Inside the loop, the review step is **Prove**: before the expensive act — letting a program drive your mouse and keyboard on its own — you see every step, what it will ask for and where it will stop. Build only happens after that, and the approval gate keeps Prove going at the one step where being wrong cannot be undone. Then **Measure** is the audit trail: every run, every step, every decision, written down.

## What you can do with it today

- **Teach a repetitive task in any Windows program** by doing it once, and run it again with new values.
- **Put it on a routine** — every few minutes or every day at nine — and let Synapse do it from the tray.
- **Keep the irreversible steps yours**: sends, payments and deletes wait for your approval.
- **Teach your own model** the procedures you have shown it, on your machine, and forget any of it whenever you like.

Recording and replay work on Windows first; macOS and Linux follow. [Download Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) and switch on Self-Directed Agents from the Teach page.

---

**Related reading:** [One local index for every AI tool on your machine](/blog/one-local-index-for-every-ai-tool) · [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop)
