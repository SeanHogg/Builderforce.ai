---
title: Choose who answers, not just who you ask
date: 2026-09-12
description: A chat with teammates and agents asks two things on every turn — who you are talking to, and who is answering. The editor could only set the first. Now “Acting as” is in VS Code too, so you can run the Brain as a persona or as one of your agents, and a question put to a whole board shows everyone it went to.
tags: [team-chat, agents, collaboration, workforce, vs-code, product]
author: Sean Hogg
---

# Choose who answers, not just who you ask

A conversation with a team of agents asks two questions on every turn. **Who am I talking to?** And **who is answering me?**

The first has had a control for a while. "To" in the composer, or an @-mention, sends a message to an invited agent or a teammate instead of the Brain. The second lived only on the web. There, "Acting as" let you run the Brain as the Website builder, the Mobile coder or the Evermind teacher, or as one of the agents assigned to your workspace. In VS Code, where most of the building happens, you got the default assistant every time.

That gap is closed.

## Acting as, in your editor

The editor's composer now carries the same two controls as the web, side by side.

```bf-figure
{
  "kind": "screen",
  "frame": "The chat composer in VS Code",
  "ratio": 2.2,
  "regions": [
    { "label": "Your message", "note": "Typed as before; an @-mention still routes it", "x": 3, "y": 8, "w": 94, "h": 46, "hue": "muted" },
    { "label": "Acting as", "note": "Default Brain · a persona · an assigned agent", "x": 3, "y": 62, "w": 30, "h": 30, "hue": "idea" },
    { "label": "To", "note": "The Brain · an invited agent · a teammate", "x": 36, "y": 62, "w": 26, "h": 30, "hue": "make" },
    { "label": "+ · / · Send", "x": 65, "y": 62, "w": 32, "h": 30, "hue": "accent" }
  ],
  "caption": "The same two pickers the web composer shows, so both surfaces offer the same choices and word them the same way."
}
```

"Acting as" offers three kinds of answer:

- **The default Brain** — your coding assistant, grounded on the workspace you have open.
- **A persona** — Website, Mobile, Web + Mobile, Evermind, Fine-tune or Voice. These are the personas the web Builder runs on, so the Mobile persona writes React Native with 44-point tap targets and safe areas, and the Evermind persona teaches rather than trains.
- **An agent assigned to the Brain** — any of them. The Brain answers in that agent's role and voice, and runs on the agent's own model unless you have pinned a model in the `/` menu.

## The persona sits on top of your workspace

One thing works differently in the editor, on purpose. On the web a persona *is* the Brain's instructions, because there is nothing else to describe. In the editor the Brain already knows real things: which folder is open, which file you are looking at, which tools can touch your repository. A Website persona that promises "Preview is live" must not overwrite any of that.

So in VS Code the persona is added on top.

```bf-figure
{
  "kind": "compare",
  "title": "What a persona changes, and what it leaves alone",
  "columns": [
    { "title": "On the web", "hue": "muted", "items": ["The persona is the whole instruction", "Its world is the browser Builder: Preview, Publish, the dev server", "Pick Mobile and it builds for the device simulator"] },
    { "title": "In your editor", "hue": "make", "items": ["The persona is added to what the editor already knows", "Your open folder, your file and your repository stay its world", "Pick Mobile and it builds React Native, in your files"] }
  ],
  "caption": "A persona changes how the Brain builds. It never changes where the Brain thinks your code lives."
}
```

## A question to the whole board shows who it went to

Ask a canvas something without @-mentioning anyone and every agent on the board answers. The answers always carried their authors. The question did not: opened on the chat page, it read as if it had been put to nobody in particular.

```bf-figure
{
  "kind": "flow",
  "title": "One question, put to the whole board",
  "steps": [
    { "label": "Ask", "note": "No @-mention, so the question goes to every agent on the canvas", "hue": "idea" },
    { "label": "Addressed", "note": "The question records each agent it was put to, by name", "hue": "make" },
    { "label": "Answered", "note": "Each agent replies as itself; the Brain stays out of it", "hue": "make", "tag": "web and editor" }
  ],
  "caption": "A question with three recipients now shows all three, and it is theirs to answer — the Brain never picks it up, even if one of them fails to reply."
}
```

## Where it sits in the method

[Read, Prove, Build](/blog/read-prove-build-the-inner-loop) is a loop about *who does the work*, not only what the work is. Reading a market is a different job from proving a price, and both are different from building the screen that sells it. Until now the editor let you choose who you asked. It did not let you choose who answered, so every act of the loop ran through the same generalist.

Choosing who answers matters most in **Make**, the stage of the [arc](/blog/idea-to-real-the-operating-methodology) where Build is the expensive act. That is where the difference between "an assistant" and "the mobile coder" shows up as rework: tap targets that were never 44 points, a layout that assumed a hover. Picking the persona before the first line is written is cheaper than correcting it after. Earlier in the arc, running the Brain as the agent you assigned to strategy lets the Read and the Prove come from the role you would have asked anyway.

## What you can do with it today

- **Run a turn as a specialist, in your editor** — Website, Mobile, Web + Mobile, Evermind, Fine-tune or Voice — without leaving your files.
- **Answer as one of your agents**, on that agent's own model, from the same composer you already type in.
- **Route a message to a teammate or an invited agent** with the same "To" control on the web and in VS Code.
- **See everyone a question went to** when you ask the whole board at once.

---

**Related reading:** [Multi-party team chat](/blog/multi-party-team-chat-humans-and-agents) · [Psychometric personas for agents](/blog/ai-agent-personality-psychometric-personas) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop)

[Open Brain Storm](/brainstorm) and pick who answers.
