---
title: You stopped reading the agent's code. Now you can see what its run did
date: 2026-11-10
description: People no longer read each line an agent writes, but they still need to know what a run changed. A run delta card now ends each agent run in the VS Code chat and answers, from measured facts, whether security, performance, quality and the -ilities got better or worse, including whether the agent weakened its own tests.
tags: [agents, vscode, security, quality, product]
author: Sean Hogg
---

# You stopped reading the agent's code. Now you can see what its run did

An agent run finishes. Forty files changed, the tests are green, the summary says "Done, all tests pass". Do you open the diff?

Most people don't, any more, and that is the point of having an agent. But not reading the code was never the same as not caring what happened to it. Somewhere in those forty files a route might have lost its auth check. A loop might now wait on the database once per item. A test that was failing might have been marked `.skip`, and "all tests pass" would be true.

The diff can tell you all of that, if you read it, and if you know what to look for. The run's own summary is written by the same agent whose work you are trying to judge. Until now there was nothing in between.

## The run delta card

Each agent run in the VS Code chat now ends with a **run delta** card. It doesn't read the diff and summarise it. It reduces the code before the run and the code after it to facts, compares the two sets, and gives a verdict on four questions.

```bf-figure
{
  "kind": "screen",
  "frame": "VS Code chat · end of a run",
  "ratio": 1.5,
  "regions": [
    { "label": "Headline", "note": "Worse: security (1 × route lost its auth guard); quality (tests weakened)", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "measure" },
    { "label": "Security", "note": "Worse · 1 new", "x": 4, "y": 24, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Performance", "note": "Unchanged · static only", "x": 52, "y": 24, "w": 44, "h": 13, "hue": "run" },
    { "label": "Quality", "note": "Worse · tests weakened", "x": 4, "y": 41, "w": 44, "h": 13, "hue": "measure" },
    { "label": "-ilities", "note": "Compatibility, maintainability, safety; the rest Not measured", "x": 52, "y": 41, "w": 44, "h": 13, "hue": "idea" },
    { "label": "Blast radius: medium", "note": "Ranked against this repository's own past runs", "x": 4, "y": 60, "w": 56, "h": 14, "hue": "accent" },
    { "label": "Open details", "x": 64, "y": 60, "w": 32, "h": 14, "hue": "make" },
    { "label": "Blocks finalizing an autonomous run", "note": "Shown when a guard was removed or tests were weakened", "x": 4, "y": 80, "w": 92, "h": 14, "hue": "measure" }
  ],
  "caption": "One headline, one row per dimension, a blast-radius band and a way into the evidence. Each verdict is a word and an icon, not only a colour."
}
```

**Security.** Did the attack surface change? A route that lost its auth guard, a new entry point, a new system capability such as an import of `child_process`, weak cryptography, a secret added to the code. A secret is shown redacted, not quoted back to you.

**Performance.** Did the run add an awaited I/O call inside a loop, or a blocking I/O call? These are static rules, and the row says "static only" so it doesn't pass for a benchmark.

**Quality.** Did the code get worse, and did the agent **weaken the tests that judge it**? A test skipped or deleted, a `.only` added, fewer assertions, a weaker matcher, a lint or type check suppressed, a timeout raised. When that happens the headline says tests were weakened, in those words.

**The -ilities**, from ISO/IEC 25010. Compatibility: an exported API broke, or a new one appeared. Maintainability: a new dependency cycle, a layer crossed, a group of duplicated code that grew, unused code, an oversized file that got bigger. Safety: a destructive schema change, a force push or a recursive delete in a script. The qualities the card does not measure yet say **Not measured**. They are not shown as zero, because zero would be a claim.

## How a verdict is reached

```bf-figure
{
  "kind": "flow",
  "title": "From a finished run to a verdict",
  "steps": [
    { "label": "Run", "note": "The agent finishes. The code before the run and the code after it are the two sides.", "hue": "run" },
    { "label": "Facts", "note": "Each side is reduced to facts and findings by fixed extractors and rules, the same ones on both sides.", "hue": "make" },
    { "label": "Delta", "note": "The two sets are compared. Each finding is new in this run, resolved by it, changed by it, or already there.", "hue": "idea" },
    { "label": "Verdict", "note": "Better, Worse, Unchanged, Not comparable or Not measured, per dimension, with a headline built from a fixed sentence.", "hue": "measure", "tag": "end of the run" }
  ],
  "caption": "Facts are compared, not text. The same before and after give the same digest on any machine, and no model writes the verdict."
}
```

A few rules keep the card honest:

- **Five verdicts, not two.** Better, Worse, Unchanged, Not comparable and Not measured. If the two sides can't be compared fairly, say because the branch changed during the run, the card says Not comparable and why, instead of guessing.
- **≈ marks a heuristic.** A finding that comes from a heuristic rather than an exact rule carries a ≈, so you know which counts are estimates.
- **Blast radius is relative.** Low, medium or high is ranked against your own repository's past runs, so "high" means high for this codebase, not compared with somebody else's.
- **It stays out of the way.** The card is computed on your machine, offline and signed out, and it doesn't fail or slow down the run it describes.

## Open details

**Open details** opens a side panel over the chat. Findings are grouped by dimension, then by lineage: new in this run, resolved by this run, changed by this run, already there. Each one has its evidence and an **Open code** link to the line it is about.

```bf-figure
{
  "kind": "compare",
  "title": "The same run, before and after the card",
  "columns": [
    { "title": "What you had", "hue": "muted", "items": ["\"Done, all tests pass\"", "A diff of forty files", "Your own guess about what matters in it"] },
    { "title": "What the card says", "hue": "measure", "items": ["Security: Worse · route lost its auth guard", "Performance: Unchanged · static only", "Quality: Worse · test skipped, fewer assertions", "Reliability: Not measured", "Blast radius: medium"] }
  ],
  "caption": "\"All tests pass\" was true. It was true because one of them no longer ran."
}
```

For autonomous runs, where nobody is watching the chat, a removed auth guard and weakened tests are flagged as **blocking**. Those are the two things an agent can do to make its own work look finished.

The card, the panel and every finding are in English, Chinese, Spanish, French and German.

## Where it sits in the method

Idea to Real runs **Idea, Make, Run, Measure**. The inner loop, [Read, Prove, Build](/blog/read-prove-build-the-inner-loop), gets you from Idea into Make: understand what is there, prove the claim cheaply, then spend on building. The loop closes in Measure, which asks one question: is it working?

An agent run is a build, and until now its Measure was the agent's own word. Tests passing proved that the remaining tests passed. The run delta is the Measure for the run: proof that it made things **better**, not just different. It reads the same way a proof does. It names what it checked, says what it could not, and shows the evidence behind each verdict.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, applied to a run",
  "columns": [
    { "title": "Read", "hue": "read", "items": ["The code before the run, reduced to facts", "The same extractors on both sides"] },
    { "title": "Prove", "hue": "prove", "items": ["A verdict per dimension, from rules, not a model", "Not measured when there is no rule yet", "Tests the agent weakened, named as such"] },
    { "title": "Build", "hue": "build", "items": ["What the run changed, and whether that was an improvement", "Blocking for autonomous runs when guards or tests were weakened"] }
  ],
  "caption": "The three questions we ask before building anything, asked of the run that did the building."
}
```

## What you can do with it today

- **Know what a run did without reading its diff:** four verdicts and one headline, at the end of the run that produced them.
- **Catch an agent grading its own homework:** skipped, deleted and loosened tests are named in the headline.
- **See a lost auth guard or a new `child_process` import** the moment the run ends, not in a later review.
- **Go from a verdict to the line of code** through Open details and Open code.
- **Use it on a plane:** it works offline and signed out.

Next, the same card comes to runs on the web and the canvas, along with a trend view of verdicts across a project's runs.

---

**Related reading:** [The agent run "worked". Now you can see what went wrong in it](/blog/see-what-went-wrong-in-an-agent-run) · [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop) · [One agent, one kernel](/blog/one-agent-one-kernel)

Run an agent in the VS Code chat and read the card at the end before you read anything else.
