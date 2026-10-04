---
title: Describe a story, get a movie — video on the canvas
date: 2026-10-04
description: The canvas now turns a sentence into a real video clip, and a story into a planned, rendered and edited short movie. Studio can put generated clips straight into the apps it builds.
tags: [creation-canvas, video, ai-video, studio, product]
author: Sean Hogg
---

# Describe a story, get a movie — video on the canvas

The canvas could already make the still parts of a launch: the page, the copy, the images, the deck. It could not make the part people actually watch.

Ask for "a 30-second ad for the bakery" and you got a storyboard: a neat table of shots, each with a description of a clip that didn't exist. Turning it into video meant leaving with the table, finding a video tool, generating the shots one by one, downloading them, and editing them together somewhere else. Most ideas died at that point, and most stayed as storyboards.

Now the storyboard renders.

## A clip, a scene, a movie

The smallest unit is a **clip**. Describe a shot, such as *steam rising off a loaf on a cooling rack, slow push-in, morning light*, and a few minutes later a real video clip is on the board, in landscape, vertical or square.

The bigger unit is a **scene**. Describe a story, and the canvas plans it the way a director would: who is in it, what happens, and how the camera sees it, split into shots. Every shot then renders as its own clip, side by side.

```bf-figure
{
  "kind": "flow",
  "title": "From one sentence to a cut",
  "steps": [
    { "label": "Plan", "note": "The story becomes a shot list: action, camera and length for each shot, with the characters kept consistent across all of them.", "hue": "idea" },
    { "label": "Render", "note": "Each shot is rendered as a real video clip, several at once. A shot that fails says why, and the rest carry on.", "hue": "make" },
    { "label": "Cut", "note": "The rendered shots are put in order on a video timeline, ready for music, narration and captions.", "hue": "make", "tag": "on the board" },
    { "label": "Export", "note": "Download the movie from your browser, or on Pro and Teams render it on our servers and close the tab.", "hue": "run" }
  ],
  "caption": "One request takes you from idea to edit. Brain does every step from a single sentence, and you can step in at any of them."
}
```

The shot list stays on the board as an object of its own, which matters the first time something is slightly wrong. If the third shot has the dog facing the wrong way, rewrite that shot and render it again. Only that shot is regenerated, and the other shots keep the clips you already liked.

```bf-figure
{
  "kind": "screen",
  "frame": "A scene on the canvas",
  "ratio": 1.62,
  "regions": [
    { "label": "The story", "note": "One prompt, a shape and a running time", "x": 4, "y": 8, "w": 34, "h": 40, "hue": "idea" },
    { "label": "Plan · Render · Make movie", "x": 4, "y": 52, "w": 34, "h": 12, "hue": "accent" },
    { "label": "Shot list", "note": "Each shot's prompt, length and clip; rewrite one and render just that one", "x": 42, "y": 8, "w": 54, "h": 74, "hue": "make" },
    { "label": "Cloud or this device", "x": 4, "y": 88, "w": 34, "h": 8, "hue": "muted" }
  ],
  "caption": "Cloud video uses hosted models and your daily video allowance. The on-device engine still works too, and runs free and private in your browser."
}
```

## The cut is an ordinary video

Making a movie doesn't lock it inside a generator. The cut lands on the board as a normal video object, in the same timeline editor you use for screen recordings and imported footage. Add a music bed, record a voiceover, write captions, trim a shot, move the chapters around. Then export it, or publish it straight to YouTube from the same card.

Export runs in your browser on every plan. On Pro and Teams you can also **render on the server**. The movie renders on our machines, so you can close the tab, and the finished MP4 is waiting on the card when you come back.

## Video in the apps Studio builds

The same generator now works inside Studio. Ask for "a landing page with a looping video hero" and the agent makes the clip, saves it to your workspace and writes its permanent link into the `<video>` tag. You get a real background loop, not a sample-video link that stops working when you publish.

```bf-figure
{
  "kind": "compare",
  "title": "Asking for video, before and after",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["A storyboard table of shots that don't exist", "A sample-video link in the hero that breaks on publish", "Five tools and an afternoon to turn a script into a cut"] },
    { "title": "Now", "hue": "make", "items": ["Real clips for every shot, rendered on the board", "A generated hero loop stored with the app", "One sentence to a movie you can edit, export or publish"] }
  ],
  "caption": "The difference isn't a better description of a video. You get the video."
}
```

## Where it sits in the method

Work on Builderforce follows an arc, **Idea → Make → Run → Measure**, and each act runs through the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Video belongs to **Make**, but it pays off at **Prove**. Many ideas are only believable once they move: an ad, a product walkthrough, a pitch's opening thirty seconds, a vertical teaser for launch week. A storyboard asks the people you're proving it to to imagine the film. A rough cut lets them react to it. "Would you click this?" is a question you can now ask with the actual video in front of someone, on the same day the idea came up.

It also keeps **Build** honest. Each shot is a separate, re-renderable object, and the cut is an ordinary timeline, so iterating means changing one shot or one trim, not starting over. When the cut is done it goes on to **Run** as a page's hero loop, a YouTube upload or a campaign asset, without leaving the board.

## What you can do with it today

- **Make a clip from a sentence**, in landscape, vertical or square.
- **Turn a story into a short movie**: planned into shots, every shot rendered, cut together on a timeline.
- **Fix one shot without redoing the rest**: rewrite it and render only that shot again.
- **Finish it like any video**: music, narration, captions and trims, then export, render on the server (Pro and Teams), or publish to YouTube.
- **Ask Brain for the whole thing in one line**, or ask Studio for a video hero in the app it's building.

---

**Related reading:** [Studio makes the images your app needs](/blog/studio-makes-the-images-your-app-needs) · [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [The Creation Canvas is not a chat window](/blog/creation-canvas-beyond-chat)

[Open a canvas](/create) and ask for a thirty-second ad.
