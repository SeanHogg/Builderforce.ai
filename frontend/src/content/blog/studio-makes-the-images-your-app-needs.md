---
title: Studio makes the images your app needs
date: 2026-10-04
description: Builderforce Studio now generates the hero art, illustrations and product shots in the apps it builds, stores them in your workspace, and writes permanent links into the code, so a first draft looks like the real thing.
tags: [studio, images, ai-images, app-development, product]
author: Sean Hogg
---

# Studio makes the images your app needs

You ask for a landing page for a neighbourhood bakery. The layout is right, the copy is right and the menu section works. The hero is a grey box with "1200 × 600" in the middle of it.

Or it's worse: the agent didn't want to leave a gap, so it wrote a stock-photo link from memory. It loads today, perhaps. Then it doesn't, and the first thing anyone sees on your site is a broken-image icon.

Until now, every app Studio built had this gap. The agent could write code but couldn't make a picture, so the most visible part of a first draft was always the least finished.

## The agent makes the picture

Studio's agent now has an image tool. When the page needs a hero image, an illustration, a product shot or a background, the agent describes the picture it wants and gets one back. That description covers the subject, style, palette and composition. It picks the shape too: square, wide for a banner or tall for a phone screen. Then it puts the image where it belongs: in an `<img>`, a CSS background or the social-preview tag.

```bf-figure
{
  "kind": "flow",
  "title": "From \"needs a hero image\" to a picture in the page",
  "steps": [
    { "label": "Agent describes it", "note": "\"Warm bakery storefront at dawn, soft light, wide banner.\"", "hue": "idea" },
    { "label": "Image is made", "note": "Generated to match the description, in the shape the layout needs.", "hue": "make" },
    { "label": "Stored in your workspace", "note": "Saved once, with a permanent link: nothing expires, and nothing points at someone else's server.", "hue": "make", "tag": "permanent link" },
    { "label": "Written into the code", "note": "The link goes into the img tag or the stylesheet, and the preview shows it.", "hue": "run" }
  ],
  "caption": "The agent uses the tool on its own whenever a layout needs a picture; you can also ask for one by name."
}
```

The image is saved to your workspace before the agent uses it. You never get a link to a vendor's temporary file, which can disappear in an hour, or an inline blob that inflates your source files. The preview shows the image straight away, and it stays put after you publish.

## What changes in a first draft

```bf-figure
{
  "kind": "compare",
  "title": "The bakery landing page, first draft",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Grey placeholder boxes with pixel sizes in them", "Stock-photo links guessed from memory, some broken", "\"Replace with your image\" comments in the code", "A draft that looks unfinished, so nobody judges the layout"] },
    { "title": "Now", "hue": "make", "items": ["A hero image that matches the brief", "Product shots in the menu section, in one consistent style", "Permanent links in the code, stored in your workspace", "A draft that looks like the real thing"] }
  ],
  "caption": "Same prompt, same layout. The difference is whether the page can be judged as it will actually look."
}
```

Changing an image works like changing anything else in Studio. Say "make the hero an evening shot with the lights on" and the agent makes a new image and swaps the link. The turn is saved as a version, so the old picture is one restore away.

## Where it sits in the method

Work on Builderforce follows an arc — **Idea → Make → Run → Measure** — and each act runs through the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Images belong to the **Make** act, and they matter most at **Prove**. You prove a draft by showing it to someone: a co-founder, a customer, the bakery owner. People react to what a page looks like before they react to how it works. A layout full of placeholders asks them to imagine the finished page, and most people judge the boxes instead. With real images in it, a first draft gets the reactions you need to hear.

It also keeps **Build** in one place. Before, finishing a page meant leaving Studio to search, download, upload and paste links. Now the pictures come from the same conversation as the code, and they're stored where the app can always reach them.

## What you can do with it today

- **Ask for a page and get its pictures**: hero art, illustrations, product shots and backgrounds, made to fit the layout.
- **Change a picture by describing the change**, and restore the previous one from Versions if you liked it better.
- **Publish without fixing image links**: every generated image is stored in your workspace with a permanent link.

Generated images use your daily image credits, the same allowance as images made on the canvas.
