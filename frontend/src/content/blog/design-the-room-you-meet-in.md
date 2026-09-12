---
title: Design the room you meet in — then walk it
date: 2026-09-12
description: The room on your board used to be one room. Now it is a boardroom, an office kitchen or an open floor of desks — or a room you lay out piece by piece, walk through like a game, sell in the marketplace, and play your Roblox place inside.
tags: [creation-canvas, collaboration, 3d, marketplace, product]
author: Sean Hogg
---

# Design the room you meet in — then walk it

Teams do not meet in one room.

The board review happens round a long table with a screen at the end. The Friday retro happens in the kitchen, perched on stools round the island. The sprint happens on the open floor, a desk each, a whiteboard on the far wall. The room is part of what the meeting *is* — who sits across from whom, what is on the wall, whether you are standing or leaning.

The room on your board was one room: a round table, a ring of people, a back wall. It was the right first room. It was also the only one, you could only look at it from above, and a game your canvas made was played somewhere else entirely.

## Pick the room

Press **Design** in the room and the first thing offered is where this session meets.

```bf-figure
{
  "kind": "screen",
  "frame": "The room, in Design",
  "ratio": 1.62,
  "regions": [
    { "label": "The room", "note": "Drag any piece to move it. R turns it, Delete removes it. Everyone in the session sees each move as it lands.", "x": 4, "y": 8, "w": 64, "h": 76, "hue": "make" },
    { "label": "This room", "note": "Seats, pieces and floor area first — because 'will we all fit' is the first question about any room", "x": 71, "y": 8, "w": 25, "h": 14, "hue": "accent" },
    { "label": "Start from", "note": "Standup room · Boardroom · Office kitchen · Open floor plan", "x": 71, "y": 25, "w": 25, "h": 14, "hue": "idea" },
    { "label": "Add furniture", "note": "Tables, desks, chairs, sofas, partitions, screens, plants — or upload your own model", "x": 71, "y": 42, "w": 25, "h": 22, "hue": "make" },
    { "label": "Share this room", "note": "Sell it, download it, or upload one somebody sent you", "x": 71, "y": 67, "w": 25, "h": 17, "hue": "measure" },
    { "label": "Look · Walk · Design", "x": 4, "y": 88, "w": 40, "h": 8, "hue": "accent" }
  ],
  "caption": "The designer replaces the roster while you design and gives it back when you stop. It only appears for people who can edit the board — everyone else simply sees the room change."
}
```

A **boardroom** is a long table with five chairs down each side, a screen on the end wall and a whiteboard on the side. An **office kitchen** is a counter and a fridge along the back, an island with six stools, and a sofa in the corner where the real conversation happens. An **open floor plan** is nine desk pods — a desk, a chair, a partition — in three rows, with a whiteboard at the front.

Every one of them is a starting point, not a template you are stuck with. Move one chair and it is your room.

## Lay it out yourself

The furniture is real furniture, in the sense that matters: it has a footprint, it has a height, and **chairs seat people.** The first person on the session takes the first chair you placed, the second the next, and everyone past the last chair stands in a ring round the room rather than inside a table. A sofa seats two.

Things that hang on a wall behave like it. Drag a screen across the floor and it slides from wall to wall, turning to face into the room; it never ends up lying on the carpet. Screens, whiteboards and posters take a picture — upload one, or paste a link — so the boardroom screen shows this quarter's chart and the kitchen poster shows whatever your team's kitchen poster shows.

And when the furniture you want is not in the list, **upload it.** STL, OBJ, glTF, GLB or STEP: the same formats a 3D print on the canvas already reads. It stands in the room at a sensible size, and you stretch it from there.

A room design is an object on your board, like everything else on it. That means it autosaves, it undoes, collaborators see it change, and Brain can change it in a sentence — *"make the room a kitchen"* is one edit to one object. A board can hold several rooms; **Meet here** decides which one the session is in.

## Walk it

**Look** is the room as it always was: orbit, zoom, move what is on the table. **Walk** puts you in it.

```bf-figure
{
  "kind": "flow",
  "title": "Three ways to be in the room",
  "steps": [
    { "label": "Look", "note": "Orbit the room from above and move what stands in it — the diorama, the creations, the stations.", "hue": "idea" },
    { "label": "Walk", "note": "WASD or the arrows to move, Space to jump, drag to look, V for first or third person. Every wall and every piece of furniture is solid.", "hue": "make", "tag": "like Roblox" },
    { "label": "Play", "note": "Step up to a Roblox place on its plinth and press Play: its level loads right here, and one button brings you back.", "hue": "run", "tag": "inside the room" }
  ],
  "caption": "On a phone the walker gets an on-screen pad and a finger to look with. Everyone else in the session is drawn where they really are, walking with you."
}
```

That last line is the one that changes what the room is for. When you walk, everybody else sees you walk — to the whiteboard, round the island, over to the screen. A room where people move is a room where you can go and stand next to the thing you want to talk about.

## Roblox, inside the room

A Roblox place your canvas generated used to be something you downloaded and opened in Roblox Studio. It now stands in the room on a plinth, with a miniature of its level on top — and pressing **Play** drops you into that level, on the room's own stage, with the same walker and the same camera. Its collectibles count, its hazards hurt, its goal ends the run.

Everyone in the session who presses Play on the same place is in the same level together, and nobody still standing in the room is. One button takes you back to the room, exactly where you left it.

We should be precise about what runs. The level's parts, its pickups, hazards and goal are all read from the place file and played here. Its **Luau scripts** run on Roblox's own servers and nowhere else, and the strip above the level says so rather than letting a scripted door look broken.

## Share it

A room you designed is something another team would use, so it is something you can sell.

```bf-figure
{
  "kind": "flow",
  "title": "From a room you made to a room another team meets in",
  "steps": [
    { "label": "Design", "note": "Lay out the room on your own board, or start from a preset and make it yours.", "hue": "make" },
    { "label": "Stage", "note": "Walked before it is listed: every piece inside the walls, every seat counted, somewhere to stand if it seats nobody.", "hue": "measure", "tag": "checked" },
    { "label": "List", "note": "A Room listing in the marketplace, free or paid, with a preview a buyer can look round first.", "hue": "run" },
    { "label": "Install", "note": "The buyer gets a copy of the room on their board and meets in it the next time they open the Room.", "hue": "run" }
  ],
  "caption": "An unchanged preset can be listed, but Stage says so: every session already has the boardroom. A listing is worth more once it is a room of its own."
}
```

If you would rather hand it over directly, **Download design** gives you the room as a file, and **Upload design** turns somebody else's file into your room — pictures and models included, by link.

## Where it sits in the method

Read → Prove → Build says the first two acts are free precisely so that the third, expensive one is a decision rather than a habit. The room already made one of those free acts spatial: the standup, the workshop, the retro, held on the work instead of beside it. Designing it widens *which* free act you can hold there.

```bf-figure
{
  "kind": "compare",
  "title": "The same session, in the room it needed",
  "columns": [
    { "title": "One room for everything", "hue": "muted", "items": ["A round table for the board review", "A round table for the retro", "A round table for sprint planning", "Look at the room from above", "Play the game somewhere else"] },
    { "title": "The room the meeting is", "hue": "make", "items": ["A boardroom with the quarter on the screen", "A kitchen for the retro", "An open floor for the sprint", "Walk to the thing you want to talk about", "Play-test the level together, inside the room"] }
  ],
  "caption": "The room is still offered from Idea onward. What changes is that it can be shaped like the conversation you are about to have."
}
```

Where it moves the most:

- **Idea** — the workshop gets a room shaped for a workshop: a long wall, a whiteboard, space to stand back.
- **Make** — for a game, **Prove** used to mean shipping a build and asking people to try it later. Now the people who asked for the level walk it with you, in the same room, while it is being made. That is the cheapest proof a game can get, and the most honest one.
- **Run** — a designed room is a thing you made that runs somewhere else: installed on another team's board, held to Stage's checks on the way out. A room is now something you can sell, not just somewhere you stand.

## What you can do with it today

- **Choose where your session meets** — a boardroom, an office kitchen or an open floor of desks — with one press.
- **Lay out a room of your own**: drag, turn and stretch furniture, hang pictures on the walls, upload your own 3D models.
- **Walk the room like a game**, keyboard or touch, with everyone else in the session walking it too.
- **Play your Roblox place inside the room**, together, and step back out without leaving the board.
- **Sell the room in the marketplace**, or send it to someone as a file.

Open a session, press **Room**, then **Design**.

---

**Related reading:** [Stand up inside your board](/blog/stand-up-inside-your-board) · [Build a 3D world in the browser](/blog/build-a-3d-world-in-the-browser) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)
