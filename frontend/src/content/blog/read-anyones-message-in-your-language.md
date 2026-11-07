---
title: Read anyone's message in your own language — translated on your own device
date: 2026-11-06
description: A teammate writes in Spanish, you read in English, and the text never leaves your computer. Translation now runs on-device first, falls back to a cloud translator that is free within daily limits, and always keeps the original one click away.
tags: [translation, on-device-ai, collaboration, privacy, product]
author: Sean Hogg
---

# Read anyone's message in your own language — translated on your own device

A team that does not share one language loses context at every handoff. The decision made in a thread you could only half read. The comment on a card that you skipped because it was not worth the detour. The imported document that nobody opened.

The usual fix is to paste it into a translator. That sends your conversation, your plans and your customers' names to a cloud service, one message at a time, and if the volume is real, it costs real money.

## One click, in your language

Messages and comments written in another language translate automatically as they scroll into view, right where you are reading them. Show original is one click away. An imported document gets an offer to translate it, and one click makes a translated copy beside it. No copy and paste, no second tab.

```bf-figure
{
  "kind": "screen",
  "frame": "A message from a teammate",
  "ratio": 1.62,
  "regions": [
    { "label": "Translated from Spanish · Show original", "note": "Always labelled, always reversible", "x": 4, "y": 6, "w": 92, "h": 12, "hue": "accent" },
    { "label": "The message, in your language", "note": "Read it, quote it, reply to it", "x": 4, "y": 22, "w": 92, "h": 46, "hue": "make" },
    { "label": "Reply", "note": "Write in yours; they read in theirs", "x": 4, "y": 74, "w": 92, "h": 20, "hue": "idea" }
  ],
  "caption": "The translation says what it is and where it came from. The original is one click behind the label, so nobody ever has to take a translation on trust."
}
```

## Your device first, a free fallback second

Chrome ships a translator inside the browser. Builderforce uses it first: the text is translated on your own device, so it does not travel anywhere to be understood. If your browser does not have one, as in Edge today, a cloud translation takes over. It is free within daily limits, so the feature is never missing, only less private.

Summaries and rewrites follow the same order. When the browser can, they run on the device first (Gemini Nano in Chrome, Phi-4-mini in Edge), and only go to the cloud models when it cannot.

```bf-figure
{
  "kind": "devices",
  "title": "The same translation, wherever you work",
  "devices": [
    { "label": "Web", "width": 1280, "hue": "make", "note": "Translate a message or a card comment in place" },
    { "label": "Rovr", "width": 834, "hue": "run", "note": "Read a page or a thread in your language from the browser side panel" },
    { "label": "VS Code", "width": 390, "hue": "measure", "note": "Read a teammate's note beside the code it is about" }
  ],
  "caption": "One behaviour on every surface: the device first, a free cloud translator second, the original always one click away."
}
```

```bf-figure
{
  "kind": "compare",
  "title": "On your device or in the cloud",
  "columns": [
    { "title": "Cloud translator", "hue": "muted", "items": ["Your text is sent to a third party", "Paid per character at volume", "Needs a connection every time", "Another tab and a paste step"] },
    { "title": "On your device first", "hue": "make", "items": ["The text stays on your computer", "Free on the device, however much you read", "Works offline once the language is installed", "Translated in place, original one click away"] }
  ],
  "caption": "The cloud fallback exists so nobody is left without a translation. It is free within daily limits, and it is the second choice, not the default."
}
```

## Where it sits in the method

Builderforce works as an arc: [Idea, Make, Run, Measure, Reach](/blog/read-prove-build-the-inner-loop), with Read, Prove and Build as the inner loop that carries you from Idea into Make. Translation lives in the first act of the loop, **Read**, in Idea, and it opens that act to the whole team.

Read is the cheap act that decides whether anything gets built, and it only works if you can actually read what the evidence says. A customer interview in Portuguese, a spec from a contractor in Berlin, a comment from a teammate in Madrid: until now each of those was either skipped or sent out to a service. Now they are readable at once, so the decision to Make is made on everything the team knows, not on the part written in your language.

## What you can do with it today

- **Read a teammate's message in your language** as it scrolls into view, and reply in yours.
- **Translate an imported document** written in another language into a new document beside it, without leaving the page.
- **Keep your conversations on your computer** when your browser has a translator (Chrome's built-in translator today).
- **Check the source** at any moment: every translation shows where it came from and keeps the original one click away.

---

**Related reading:** [Local-first AI: WebGPU in the browser](/blog/local-first-ai-webgpu-in-the-browser) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)

[Open a canvas](/create) and invite someone who writes in another language.
