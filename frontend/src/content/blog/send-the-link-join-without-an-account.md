---
title: Send someone the link — and let them join without an account
date: 2026-09-07
description: Sharing a canvas used to get worse the moment you signed up. Any saved board can now produce a link that grants view, comment or edit access, and whoever opens it can join by typing a name — no signup, no password, a real collaborator.
tags: [creation-canvas, collaboration, sharing, guest, product]
author: Sean Hogg
---

# Send someone the link — and let them join without an account

Open Builderforce.ai signed out and share a board, and it works the way sharing works everywhere else: a link, a Copy button, send it to whoever you want. They open it, they are on your board, you are both editing.

Sign up, and that stopped.

The same panel, on a board you had bothered to save, became an address field. Type an email. We mail a one-time token. The recipient must sign in **as that exact address** before they see a thing — so they need an account, they need to have checked the right inbox, and if they signed up with their personal address rather than the work one you typed, the link tells them to go away.

The product's sharing model got worse on the exact transition it spends everything to cause.

## Any saved canvas can produce a link now

```bf-figure
{
  "kind": "flow",
  "title": "From a board to somebody else on it",
  "steps": [
    { "label": "Create", "note": "Open the invite panel on any saved canvas, pick view, comment or edit, and get a URL.", "hue": "idea" },
    { "label": "Send", "note": "However you already send things. It is a link — a chat window, a message, a calendar invite.", "hue": "make" },
    { "label": "Join", "note": "They are told what board it is and what they can do on it, then choose: join by name, sign in, or make an account.", "hue": "run", "tag": "no signup required" }
  ],
  "caption": "The email invite did not go anywhere. Both motions live in the same panel, because which one fits depends on whether you know the person's email or only have a chat window open."
}
```

The address field is still there, and still right for the case it was built for: somebody you are adding to the team, whose inbox you know. A link is for the other case, which is most of them — the person in the call right now, the client in a chat thread, the friend you want a second opinion from before lunch.

```bf-figure
{
  "kind": "screen",
  "frame": "The invite panel on a saved canvas",
  "ratio": 1.5,
  "regions": [
    { "label": "Invite by link", "note": "Pick the access, create the link, copy it. Shown once — only its hash is stored.", "x": 6, "y": 10, "w": 88, "h": 30, "hue": "idea" },
    { "label": "Invite by email", "note": "Unchanged. For the person whose inbox you know.", "x": 6, "y": 44, "w": 88, "h": 20, "hue": "make" },
    { "label": "Members and pending invitations", "x": 6, "y": 68, "w": 88, "h": 16, "hue": "run" },
    { "label": "Active links · revoke", "note": "Every link you have made, what it grants, how often it has been taken", "x": 6, "y": 86, "w": 88, "h": 10, "hue": "accent" }
  ],
  "caption": "One sheet, both motions. The list of live links carries no URLs on purpose: only a hash is stored, so a leaked link is revoked and re-minted rather than re-read."
}
```

## The person who opens it does not need an account

This is the part that matters, and the part the old flow could not do at all.

Open the link and you are told which board you have been invited to and exactly what you can do on it — view, comment, or edit — before anything is claimed. Then you get three answers, and the first one is *join without an account*. Type a name. You are on the board.

Not a preview of the board. **The board.** Your cursor is on it, your edits are saved, your comments have your name on them, and the person who invited you sees you arrive like any other collaborator. Nothing is withheld and nothing is a demo.

```bf-figure
{
  "kind": "compare",
  "title": "What it takes to look at somebody's board",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Ask them for your email address", "Wait for the mail", "Find it", "Create an account", "Verify the address", "Sign in as that exact address", "Finally see the board"] },
    { "title": "Now", "hue": "run", "items": ["Open the link", "Type a name", "You are on the board"] }
  ],
  "caption": "Both columns end with the same access. One of them ends with it in about four seconds."
}
```

A few things follow from that being a real identity rather than a viewing pass:

- **It costs the workspace nothing billable.** A canvas collaborator has never been a paid seat, and a link guest is one of those. What governs them is the collaborator limit the plan already advertises.
- **A link carries view, comment or edit and nothing more.** It can never grant the two roles that would be dangerous to forward: running agents (which spends the workspace's tokens) and ownership (which can give the board away). Those are not options a URL is allowed to express.
- **The access you gave the board is the ceiling on everything else.** Someone invited to comment cannot edit the workspace around it.
- **You can make an account later.** Open the same link signed in and it seats the account you just made, on the same board, with the same access.

And it is revocable the way a link should be: every link you have created is listed in the same panel, with what it grants, how many people have taken it, and one button to kill it.

## Where it sits in the method

**Read** and **Prove** are the first two acts, and they are the cheap ones — deliberately, so that the decision to build is a decision rather than a default. But both of them are things you do *with other people*. Reading the landscape means someone who knows it looks at what you found. Proving means putting the sharpest version of the idea in front of the person most likely to tell you it is wrong.

The friction that kills that is not the reading and it is not the proving. It is the invitation.

```bf-figure
{
  "kind": "compare",
  "title": "Who actually sees the board",
  "columns": [
    { "title": "When the invite needs an account", "hue": "muted", "items": ["The two people already in the workspace", "Whoever will make an account to do you a favour", "Nobody in a hurry", "Nobody you met ten minutes ago"] },
    { "title": "When it is a link", "hue": "idea", "items": ["The person on the call", "The client in the chat thread", "The domain expert who owes you twenty minutes", "The customer you are proving it to"] }
  ],
  "caption": "The Prove step is only worth as much as the person you show it to. An invitation that costs a signup filters for patience, not for judgement."
}
```

Every signup you put in front of a reviewer is a filter, and it filters for the wrong thing: it keeps the people who already like you and loses the people whose opinion would have changed the idea. The board is where an idea becomes something people can argue with. It should be reachable by anyone you can send a link to.

## What you can do with it today

- **Share any saved canvas with a URL** — pick view, comment or edit, copy, send.
- **Let someone join by typing a name** — no signup, no password, a real collaborator on your board.
- **Invite by email as before** when you know the address and want them on the team.
- **Revoke any link** from the same panel, at any time, without touching anybody who already joined.
- **Turn a guest into an account later** — create one and open the same link to carry the access across.

---

**Related reading:** [Create before you sign up](/blog/create-before-you-sign-up) · [Multiplayer on the canvas, in the browser and in VS Code](/blog/multiplayer-creation-canvas-web-vscode) · [The Creation Canvas is not a chat window](/blog/creation-canvas-beyond-chat)

[Open a canvas](/create) and send the link to somebody.
