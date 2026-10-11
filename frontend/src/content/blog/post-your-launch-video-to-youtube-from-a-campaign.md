---
title: Post your launch video to YouTube — from the same campaign as everything else
date: 2026-10-10
description: YouTube was the one network a campaign could read but never post to, because a video does not fit in one request. It now goes up in the background, a confirmed piece at a time, with progress on the campaign beside every other network.
tags: [social, campaigns, youtube, video, launch, reach]
author: Sean Hogg
---

# Post your launch video to YouTube — from the same campaign as everything else

You render the launch video on the board. You write the announcement once. You tick X, LinkedIn, Instagram, TikTok — and YouTube.

Until now, YouTube was the box that said no.

Every other network accepts a post as a single request: some text, maybe a link, maybe a picture the network fetches for itself. YouTube does not. Posting to YouTube means *sending it the video*, every byte of it, and a three-minute launch film is far more than one request has time to carry. So the honest answer was to mark YouTube "read and measure only": the board could show your channel's views, and the upload itself was a trip to YouTube Studio, a download, a re-upload, and a copy of the description pasted from somewhere else.

That made the most important asset of a launch the only one that could not go out with the launch.

## An upload that outlives the request that started it

The fix is not a longer request. It is to stop treating the upload as a request at all.

```bf-figure
{
  "kind": "flow",
  "title": "What happens when a campaign reaches YouTube",
  "steps": [
    { "label": "Hand off", "note": "The YouTube post becomes an upload job with its own record: which video, which channel, how much YouTube has confirmed.", "hue": "reach" },
    { "label": "Send a piece", "note": "A few megabytes at a time, each one labelled with exactly where it sits in the file.", "hue": "reach" },
    { "label": "Ask, don't assume", "note": "Before sending more, the job asks YouTube how far it actually got, and continues from there.", "hue": "measure" },
    { "label": "Land", "note": "YouTube returns the video. The campaign post turns into a link.", "hue": "reach", "tag": "on the campaign" }
  ],
  "caption": "A short clip finishes in one piece. A long film takes as many as it needs. It is the same path either way, so the five-second teaser and the forty-minute keynote cannot behave differently."
}
```

The part that matters is the third step. A cloud worker can be stopped at any moment. If it is stopped halfway through sending a piece, the job does not trust its own idea of how much went out. It asks YouTube, and YouTube says exactly how much it has. The next attempt starts from that point. The worst a dropped connection can cost is one piece, never the whole video.

The same goes for a bad minute on YouTube's side. A temporary error waits and tries again, a little longer each time. An error that waiting cannot fix, like a daily quota that has run out or a connection that needs reconnecting, stops straight away and says why. It does not retry in a loop.

## What you see

```bf-figure
{
  "kind": "screen",
  "frame": "A launch campaign on the board",
  "ratio": 1.62,
  "regions": [
    { "label": "Published · X", "note": "Links to the post", "x": 4, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Published · LinkedIn", "x": 52, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Published · Instagram", "x": 4, "y": 32, "w": 44, "h": 16, "hue": "good" },
    { "label": "Uploading · 62% · YouTube", "note": "Confirmed by YouTube, not estimated", "x": 52, "y": 32, "w": 44, "h": 16, "hue": "reach" },
    { "label": "Copy · link · the video", "x": 4, "y": 56, "w": 92, "h": 36, "hue": "muted" }
  ],
  "caption": "YouTube sits in the same list as every other network. Its status reads Queued, then Uploading with a percentage, then Published with a link, or Failed with the reason."
}
```

The percentage is the share of the video YouTube has **confirmed**, not the share we have sent. Those two numbers can differ, and when they do, the confirmed one is the true one. The campaign also stays in progress while the video is still going up. It does not call itself published while YouTube has only part of the file.

The same uploader is behind **Publish to YouTube** on a video in the canvas editor. A short render still finishes before the button stops spinning. A long one now shows how much has landed, keeps going after you close the tab, and the link appears on the video the next time anyone opens it. Long renders used to fail just for being long. That no longer happens.

## What it needs

Two things, both one-time:

- **A YouTube account on the campaign.** Connect it with the other social accounts, and it shows up as a target.
- **A YouTube upload connection.** Connect YouTube once from a video on the canvas. This lets uploads go to your channel. If the person who connected the campaign's YouTube account has done this, their channel is used. If nobody has, or two people have and it is unclear whose channel is meant, the post says so instead of guessing. A launch video on the wrong channel cannot be quietly taken back.

The campaign's video is attached the same way an Instagram or TikTok video is. Use a video from the board, or paste a public link. The campaign name becomes the video title. The post text and the campaign link become the description.

## Where it sits in the method

Every board runs the same arc: **Idea → Make → Run → Measure → Reach**. Reach is the last step, and it is the one most likely to happen somewhere else: in a scheduling tool, a studio tab, a folder of exports. Once it moves away from the board, the record of what went out moves away with it.

```bf-figure
{
  "kind": "compare",
  "title": "Getting a launch video out",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Render on the board", "Download the file", "Open YouTube Studio", "Upload it again", "Paste the description in", "Post the link back by hand", "Nothing on the board knows it went out"] },
    { "title": "Now", "hue": "reach", "items": ["Render on the board", "Tick YouTube on the campaign", "Watch it upload next to the other networks", "The link lands on the campaign"] }
  ],
  "caption": "The video goes out with the campaign it belongs to, so its outcome sits beside X, LinkedIn and Instagram. You can see which posts are live, and where, without asking."
}
```

Measure and Reach share a loop. The channel's views were already on the board, through the YouTube feed tile. Now the video that earns those views goes out from the board too, so the next step, watching how it does, starts in the same place the launch did.

---

**Related reading:** [Make video scenes and movies on the canvas](/blog/make-video-scenes-and-movies-on-the-canvas) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)

[Open a canvas](/create), render the video, and send it out with the rest of the launch.
