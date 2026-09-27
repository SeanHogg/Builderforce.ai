---
title: A private brain on your desktop that hands the work to your agents
date: 2026-09-27
description: Synapse now signs in to Builderforce and brings your chats to the desktop. Ask the Brain and it answers with what your private Evermind has learned on your machine; assign an agent and address it with @, and it does the work with its own tools. A live brain in the sidebar shows what you know, what you have done, and what it is learning right now.
tags: [agents, evermind, privacy, product]
author: Sean Hogg
---

# A private brain on your desktop that hands the work to your agents

Every AI tool you use starts the conversation from nothing.

You explain the project again. You restate the decision you made last week, the convention you settled on, the reason you ruled out the obvious approach. The tool answers well, and forgets. Tomorrow you explain it again — to a different tool, in a different window, with the same words.

And when the answer is "this needs doing", the chat stops being useful. The work lives somewhere else: a board, a ticket, an agent you hired in another tab.

That is the gap: **the thing you talk to does not know you, and it cannot hand the work to the ones that could do it.**

## Ask the brain that knows you

Synapse now signs in to Builderforce the way the VS Code extension does — you approve a code in your browser, and the key stays in your system's credential store. Your workspace's chats come with it: the same conversations you see on the web and in your editor.

```bf-figure
{
  "kind": "flow",
  "title": "From a question to work that gets done",
  "steps": [
    { "label": "Ask", "note": "Write to the Brain from Synapse, in any of your workspace's chats.", "hue": "idea" },
    { "label": "Recall", "note": "Before it answers, your private Evermind recalls what your own tools learned about the question — on your machine.", "hue": "make", "tag": "private" },
    { "label": "Assign", "note": "When it is work, add an agent to the chat and address it with @.", "hue": "run" },
    { "label": "Done by the agent", "note": "The agent answers with its own tools, as you — never more than you could do yourself.", "hue": "run" }
  ],
  "caption": "The Brain answers what it can from what you already know; agents do what needs tools."
}
```

The Brain's answer is grounded in your own memory. The facts your coding agents remembered, the procedures you taught Synapse, the conventions you corrected them on — they are recalled on your machine for this one question, and only the few that matter go with it.

## Hand the work to an agent

Every chat has its agents: the ones your workspace hired, bought or registered. Assign one from the chat, and address it — pick it in *To*, or start the message with `@` and its name.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Chat",
  "ratio": 1.6,
  "regions": [
    { "label": "Your chats", "note": "The same conversations as the web app and VS Code", "x": 3, "y": 8, "w": 24, "h": 86, "hue": "muted" },
    { "label": "Agents in this chat", "note": "Assign from your workspace's pool; remove with one click", "x": 30, "y": 8, "w": 67, "h": 12, "hue": "accent" },
    { "label": "The conversation", "note": "Who each reply came from — you, the Brain, or the agent — and who each message was for", "x": 30, "y": 24, "w": 67, "h": 52, "hue": "run" },
    { "label": "To: Brain or @agent", "note": "Enter sends; the addressed agent replies with its own tools", "x": 30, "y": 80, "w": 67, "h": 14, "hue": "make" }
  ],
  "caption": "A message to the Brain is answered on your desktop with your private recall; a message to an agent is answered by that agent."
}
```

The agent runs on the platform with its own tools, in your name and within your own permissions — the same agent you would reach from the web, now one `@` away from the conversation you are already in.

## Watch it learn

Synapse draws your Evermind as a brain, and keeps it in the sidebar where you can see it.

```bf-figure
{
  "kind": "compare",
  "title": "Two hemispheres, from your own data",
  "columns": [
    { "title": "Left — what it knows", "hue": "make", "items": ["Neocortex: procedures your private model learned into its weights", "Semantic memory: facts every AI tool on this machine remembered", "Thalamus: what your tools are asking the code index, right now"] },
    { "title": "Right — what it does", "hue": "run", "items": ["Hippocampus: demonstrations you recorded", "Basal ganglia: skills it compiled, and how their runs went", "Amygdala: irreversible steps it stopped to ask you about", "Hypothalamus: routines that start it by itself"] }
  ],
  "caption": "Every number comes from your store. A region glows while it learns; new knowledge pulses in."
}
```

Open Evermind and the brain fills the page: what the model has learned and what is queued, the training loss of every adaptation, thirty days of demonstrations, skills, runs and learning, and a list of the most recent things it took in — click a region to see only what landed there.

## Where it sits in the method

Work on Builderforce moves along one arc — **Idea → Make → Run → Measure** — and every act runs the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Chat is where **Idea** starts, and it used to start cold. Now the first **Read** is your own memory: before the Brain answers, it reads what you and your tools already established, so the idea begins where you left off instead of at zero.

**Run** is where the agents are, and addressing one from the chat is the hand-off from talking to doing, without leaving the conversation.

**Measure** is the brain. What you taught, what ran, what the model learned and how its loss moved are drawn from the store, not described — proof you can look at that the private capability is actually growing.

## What you can do today

- **Sign in to Builderforce from Synapse** and work in the same chats as the web app and VS Code.
- **Ask the Brain** and get answers grounded in what your private Evermind learned on your machine.
- **Assign agents to a chat and address them with @** — they do the work with their own tools, as you.
- **Watch your Evermind learn** in the sidebar, and see the whole picture — regions, training loss, thirty days of activity — on the Evermind page.

[Download Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true), open **Chat**, and sign in with your browser.

---

**Read next:** [Teach it once, and it does it again](/blog/teach-it-once-and-it-does-it-again) · [One local index for every AI tool on your machine](/blog/one-local-index-for-every-ai-tool)
