---
title: Stand up inside your board
date: 2026-09-07
description: A standup is about the work in front of you, and until now it happened somewhere else. The room surface puts your team in a circle on the board itself, with the session's work on the wall behind you.
tags: [creation-canvas, collaboration, ceremonies, 3d, product]
author: Sean Hogg
---

# Stand up inside your board

Every morning a team leaves the thing they are discussing in order to discuss it.

The board is on one screen. The standup is on another — a meeting room, a round table, a grid of faces — and somebody shares their screen so that everyone can see the board they all just left. Fifteen minutes later everyone navigates back to where they already were.

That is not a video-conferencing problem. It is a shape problem: the ceremony whose entire subject is the work in front of you was the one ceremony that had no home on the work.

## The room

There is now a fifth way to read a board, alongside the conversation, the graph, the 3D space and the app: **the room**.

```bf-figure
{
  "kind": "screen",
  "frame": "A board, read as a room",
  "ratio": 1.62,
  "regions": [
    { "label": "The circle", "note": "Everyone in the session, standing around a table. Your own body is drawn with everybody else's.", "x": 4, "y": 8, "w": 66, "h": 62, "hue": "make" },
    { "label": "The wall", "note": "The session's newest objects, with the real picture each one produced", "x": 12, "y": 12, "w": 50, "h": 22, "hue": "idea" },
    { "label": "Who is here", "note": "Lit for people in the room, dimmed for people on the board", "x": 73, "y": 8, "w": 23, "h": 74, "hue": "accent" },
    { "label": "Surface switcher", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "N of M here", "x": 38, "y": 88, "w": 32, "h": 8, "hue": "accent" }
  ],
  "caption": "Board-scoped, like the app and insights surfaces: the room's subject is the whole session, so there is no card to enter it from and pressing it with nothing selected has an answer."
}
```

Press Room and the board becomes a place. Your team stands in a circle around a table. Behind them, on the wall, are the session's own objects — not icons of them, the actual rendered preview each one produced. Click one and it selects the card it stands for.

## Everyone gets a chair

The design decision that mattered most was about absence.

A room where people appear only once they move is a room where you cannot tell "nobody joined" from "nobody has spoken yet". So the room seats **the whole roster** and marks who is actually there: a lit body with a bright name plate for somebody in the room right now, a dimmed one for a colleague who is on the board rather than in it.

```bf-figure
{
  "kind": "compare",
  "title": "Two answers to \"who is here\"",
  "columns": [
    {
      "title": "A room with its own membership",
      "hue": "bad",
      "items": [
        "The room keeps its own record of who joined",
        "A closed laptop leaves that record set",
        "The roster and the room can disagree",
        "Attendance becomes a thing to reconcile"
      ]
    },
    {
      "title": "One presence record, two readings",
      "hue": "good",
      "items": [
        "The room owns no membership at all",
        "A pointer and a body ride the same relay frame",
        "Leaving retracts your body immediately",
        "The board and the room cannot disagree"
      ]
    }
  ],
  "caption": "A cursor on the board and a body in the room are the same question — where is this person right now — asked by two surfaces. So they share one channel rather than each growing their own."
}
```

That choice is why the room needed no new table, no new membership, and no new record. It reads the roster the session already has and the live presence the board already carries.

There is one wrinkle worth naming, because it is the opposite of how a cursor behaves. A still pointer is a stale pointer, so the board forgets one after half a minute. Sitting still is what a standup *is* — so being in the room is re-asserted on a quiet heartbeat, and the moment you leave, your body goes with you.

## Pictures on walls

The same change gave 3D spaces something they never had: a face you can put something on.

A prop could say what colour it was and nothing else, which is why nothing could ever be *put on* one. Now any flat-faced prop takes an image — a photograph of a whiteboard, a diagram, a rendering — and it hangs there at real scale, readable in shadow as well as in sun.

```bf-figure
{
  "kind": "flow",
  "title": "One way to paint a face, three places it shows up",
  "steps": [
    { "label": "Author", "note": "Paste an image URL onto a wall, a platform or a goal zone in the 3D space", "hue": "make" },
    { "label": "Hang", "note": "The room's wall uses the same primitive for the session's own objects, loading and failing identically", "hue": "make" },
    { "label": "Degrade", "note": "An image that cannot load falls back to the prop's own colour, rather than a black square or a blank surface", "hue": "run", "tag": "authored URLs break" }
  ],
  "caption": "A picture on a wall in a world and a card on a wall in the room are drawn by one component, so they cannot look different, load differently or fail differently."
}
```

And a room you cannot enter is worse than a flat one: where WebGL will not start, the same session opens as a legible circle of names instead of refusing.

## Where it sits in the method

The room is the first surface whose subject is the **people** rather than the objects, and that places it oddly on the arc — because it earns its keep in different ways at different stages, and is never useless at any of them.

It is offered from **Idea** onward, which is a deliberate break from how Insights is gated. Insights withholds itself until Measure because a dashboard with nothing pinned can show a reader nothing at all. A room with one person in it is a room with one person in it: correct, legible, and exactly what a workshop looks like ten seconds before the second person arrives. Gating a *meeting* by which stage a board says it is in would be the wrong shape of rule — two people wanting to talk about an idea is the case for the room, not an argument against it.

Where it changes the most:

- **Idea** — the workshop. Standing back from a wall and seeing how things are grouped is a spatial act that software flattened; this is where that comes back.
- **Make** — the daily standup, and the one stage where the room is the whole answer. Nobody wants to write code from inside a room. They do want fifteen minutes with every face visible and the sprint's work on the wall behind them.
- **Measure** — the retrospective, which is the *most* spatial ceremony there is: a wall, a timeline, and people standing at the point where it went wrong.

Read → Prove → Build says the two acts that decide whether the expensive one is worth doing are both free. A standup is one of them. It costs nothing, it changes what gets built, and it should never have required leaving the board to have one.

Press **Room**.
