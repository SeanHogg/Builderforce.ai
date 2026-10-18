---
title: Kimi K3 as your coder or your planner — from your own Kimi account
date: 2026-10-18
description: A Kimi subscription used to be reachable only through a separate runtime relaying for it. Now you pick Kimi K3 in VS Code or Rovr, sign in once when the first turn needs it, and your own machine calls Kimi directly.
tags: [models, kimi, byo, vscode, rovr, product]
author: Sean Hogg
---

# Kimi K3 as your coder or your planner — from your own Kimi account

You pay for Kimi. Kimi K3 is a strong coder with a million-token window. You want it on the work in front of you: planning a change, writing it, or both.

Until now that took more setup than it should have. Kimi's edge refuses traffic from hosted cloud platforms before it even reads a credential. A Kimi subscription connected to your workspace could therefore only run while a separate Builderforce runtime was online to relay for it. In the editor, Kimi showed up only if you had also installed the Kimi Code CLI and signed in there. In Rovr it did not show up at all.

## Pick Kimi, and the sign-in comes to you

Now the order is the one you would expect. You choose the model first, and Builderforce asks for the account only if it does not have one.

```bf-figure
{
  "kind": "flow",
  "title": "The first Kimi turn, start to finish",
  "steps": [
    { "label": "Pick", "note": "Choose Kimi K3 in the VS Code model picker or in Rovr's Settings → Model.", "hue": "idea" },
    { "label": "Sign in", "note": "No Kimi account in the workspace yet? Kimi's own sign-in page opens with the code already filled in. Approve it and you are done; there is nothing to paste.", "hue": "make" },
    { "label": "Keep", "note": "The connection is saved in your workspace's integrations, so the web app, the editor and Rovr all see the same account.", "hue": "make" },
    { "label": "Run", "note": "Your machine holds a short-lived token and calls Kimi directly. The editor and the browser are the personal client the subscription is licensed for.", "hue": "make", "tag": "on your machine" }
  ],
  "caption": "The account lives with the workspace and the token lives on the machine. Builderforce stays the only place that renews the connection, so a second laptop never ends up holding a retired login."
}
```

Two details make this hold up in daily use.

**The token is short-lived on purpose.** Your machine stores only a fifteen-minute access token, never the long-lived refresh credential. Kimi rotates that credential every time it is used, so two places renewing it means one of them is always holding a dead one. Builderforce renews it, and every device asks Builderforce for a fresh token when it needs one. The editor and Rovr reuse a stored token across restarts while it is still valid, so most turns make no extra round trip.

**K3 is your call, not a guess.** Kimi K3 comes with some Kimi plans and not others. Builderforce does not quietly route every Kimi turn to a model your plan might refuse. If your plan includes K3, open Settings → Bring your own models → Kimi and move K3 to the top. The editor, Rovr and cloud runs then all lead with it, and fall back down your list if they have to.

```bf-figure
{
  "kind": "compare",
  "title": "Using your Kimi subscription",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Connect Kimi on the web", "Install and run a separate agent runtime so it can relay", "Or install the Kimi Code CLI and sign in there for the editor", "Nothing in Rovr"] },
    { "title": "Now", "hue": "make", "items": ["Pick Kimi K3 wherever you are working", "Approve one sign-in when the first turn asks", "The editor and Rovr call Kimi themselves", "One connection, shared across the workspace"] }
  ],
  "caption": "If the Kimi Code CLI is already signed in on your machine, the editor still uses that login first. The workspace connection is what lets everything else work without it."
}
```

## Where it sits in the method

Most of the time this is about the **Build** act. Build is the expensive step of [Read, Prove, Build](/blog/read-prove-build-the-inner-loop), and it is where the model's coding strength decides how many passes a change takes. Builderforce already gives every turn a role. A run plans first, then hands the first code change to the strongest coder you have connected. Kimi K3 can now fill either role, or both: plan with something cheap and code with K3, plan with K3 and hand off to Claude, or keep everything on K3.

It matters for **Read and Prove** as well. Those two cost nothing so that the decision to build is a real decision, and a million-token window means a whole repository can be read in one pass before anyone commits to a change.

## What you can do with it today

- **Pick Kimi K3 in VS Code** without installing anything else. The picker offers "Connect Kimi" and, once you have connected, lets you choose which Kimi model new turns use.
- **Run Kimi in Rovr**, the browser assistant. Settings → Model lists your Kimi models. If a Kimi turn finds no account, the chat shows a Connect card instead of an error.
- **Connect once for the whole workspace.** An account connected from the editor shows up on the web and in Rovr, and the reverse is also true.
- **Put K3 first** if your plan includes it, and every surface leads with it.

---

**Related reading:** [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop)

Open the model picker in VS Code, choose **Connect Kimi**, and try your next change on K3.
