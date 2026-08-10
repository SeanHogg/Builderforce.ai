---
title: One Multiplayer Creation Session Across the Web and VS Code
date: 2026-08-01
description: See how product, design, data, and engineering collaborate with AI in the same Builderforce Creation Session across the browser and a native VS Code editor surface.
tags: [creation-canvas, vscode, realtime-collaboration, developers, ai-agents]
author: Sean Hogg
---

# One Multiplayer Creation Session Across the Web and VS Code

Cross-functional work usually breaks into tool-shaped fragments. Product context lives in a ticket. Customer evidence lives in a dashboard. The prototype lives in a design tool. Implementation context lives in VS Code. The conversation about all four lives somewhere else.

Builderforce Creation Sessions give those artifacts a shared spatial home without forcing every collaborator into the same editor.

![A high-fidelity shared Creation Session connecting a visual browser canvas and a native code editor through one prototype, shared objects, comments, cursors, presence, and implementation context](/blog/multiplayer-canvas-hero.webp)

## One server session, two native surfaces

On the web, Creation Canvas is the default visual workspace for chat, workflows, websites, data, models, people, agents, and optional projects. In the BuilderForce VS Code extension, the same session opens in a full editor tab—not an iframe and not a narrow sidebar.

Both surfaces use the same session graph, object identities, permissions, revisioned command contract, presence, and comments. The complete activity timeline and specialized inspectors remain available in the browser. A web user and an editor user are collaborators in one session, not users of synchronized copies.

The native VS Code surface can add development context without leaving the editor:

- current files or selections;
- repository and branch context;
- diagnostics and Problems;
- pasted terminal output with a secret warning;
- local services and browser previews;
- any shared Canvas object kind from the native palette.

A product manager can connect customer evidence and a mockup on the web while a developer connects the failing diagnostic, relevant source selection, and local preview from VS Code.

![The web Creation Canvas contributes customer evidence, prototypes, project lenses, activity, and inspectors while the native VS Code tab contributes files, repository context, diagnostics, terminal output, local services, and previews; both use one session graph with shared object identities, permissions, presence, comments, activity, and revisioned commands](/blog/multiplayer-canvas-shared-session.svg)

## Collaboration without viewport fights

Every member has a personal viewport. Moving or zooming your canvas does not move anyone else’s. In the browser, presence shows cursors, selections, typing state, and the client surface being used. The VS Code panel reports its current selection through the same durable presence contract.

When someone is presenting, collaborators can deliberately follow that person’s viewport. Leaving follow mode returns control to the individual. This makes walkthroughs useful without turning ordinary collaboration into remote-control screen sharing.

Comments attach to objects. Mentions and activity identify who asked Brain to act, who reviewed a proposal, and which canonical resource changed. Roles distinguish Viewer, Commenter, Editor, Runner, and Owner access. Underlying resource permissions still apply—a session invitation is not a shortcut into a project, dataset, agent, or repository the member cannot access.

## A practical design-to-code handoff

Imagine a team reviewing a new onboarding flow:

1. Product adds a Project object and expands customer-feedback and delivery lenses.
2. Design places a WYSIWYG Prototype and its mobile variant beside the evidence.
3. Brain evaluates the prototype against requested features and creates a reviewable change set.
4. The team approves a Mockup and delivers it into a project Task assigned to an implementation Agent.
5. A developer opens the same Session in VS Code and adds the relevant repository, component selection, diagnostics, and local preview.
6. The Agent executes through the project’s approval policy. Build status and output appear back in the Session.

No one has to reconstruct why the task exists. The evidence, decision, artifact, implementation context, and execution history remain connected.

## Safe exploration with branches and checkpoints

Named checkpoints preserve meaningful review states. A session branch supports a more independent experiment—for example, a different information architecture or model pipeline. When the branch returns, Builderforce presents an explicit object-by-object merge review. The reviewer can use the branch version or preserve the parent version for every matching object.

Freehand drawings, notes, and reusable Frames support the messy spatial work around formal artifacts. Marketplace packs provide more structured starting points for campaigns, product discovery, data stories, stand-ups, model builds, and executive reviews.

## The handoff becomes a shared operating picture

“Handoff” implies one team finishes and another starts. A multiplayer Creation Session supports a better model: contributors add the context native to their work while the shared canvas preserves relationships and Brain helps reason across them.

The browser remains the most accessible place to gather business context. VS Code remains the right place for detailed implementation. Builderforce connects them without reducing either to a transcript.

[Start a shared Creation Session →](/create/new)
