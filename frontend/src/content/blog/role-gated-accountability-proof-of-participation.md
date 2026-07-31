---
title: "Proof of Participation: Role-Gated Delivery and the Accountability Report"
date: 2026-07-12
description: Builderforce.ai resolves the roles a ticket requires to the humans and agents capable of each, gates sign-off behind default-deny permissions, and records an immutable Accountability Report of Who, When, Verdict, Comments, and Contribution per role — so a Product Manager is never dispatched to write code and quality is proven at the board.
tags: [accountability, workforce, kanban, governance, roles, agents]
author: Sean Hogg
---

# Proof of Participation: Role-Gated Delivery and the Accountability Report

When a team is humans and AI agents on the same board, "who did what" stops being obvious. A ticket marked Done tells you nothing about whether the right roles touched it — whether a reviewer actually reviewed, whether a security specialist ever saw the security ticket, or whether the agent that shipped the code was even a coder. On a fast agentic board, that ambiguity is where quality quietly leaks.

Builderforce.ai makes participation a first-class, provable thing.

## The right role does the work

The root cause of a lot of bad agent output is mis-assignment: a Product-Manager agent handed a coding ticket, a generalist handed a task that needed a specialist. So assignment is now **role-aware**. Each agent (and human) carries first-class role capability, and a producer stage resolves the role the work requires — from the ticket's action type — and dispatches someone actually capable of it. A role-incapable owner can't be the fallback executor on a producer stage. The exact failure mode where a manager gets sent to write code simply can't happen.

## A participation manifest per ticket

Every ticket derives a **participation manifest** from its board's swimlane requirements: the roles it needs, each resolved to a capable human or agent, each with a state — pending, assigned, in-progress, completed, changes-requested, waived, or unstaffed. It's the ticket's cast list, and you can see at a glance which parts are covered and which aren't.

A **Resource Assessment** control lets a manager add a role the template didn't anticipate — a designer, a security reviewer — and if that role can't be staffed, it surfaces as a blocking **resource gap** rather than a silent omission.

## An immutable Accountability Report

The record itself is append-only. `ticket_role_signoffs` captures, per role: **Who** signed off, **When**, their **Verdict**, their **Comments**, and their actual **Contribution**. Nothing is edited or overwritten — a changed mind is a new entry, not a rewrite. Sign-off is gated by **default-deny permissions**: only a member actually capable of a role may sign off as that role, and every sign-off writes to the unified activity log.

The result is the **Accountability Report** — a per-role Who/When/Verdict/Comments/Contribution view on the ticket, plus its gaps: unstaffed roles, unsigned roles, contributions missing, waivers. It's the answer to "did this really get done properly?" backed by evidence, not vibes.

## Why it matters

Governance frameworks — SOC 2, ISO 27001, and the rest — keep asking the same question: can you *prove* the right people did the right things? On a board where agents move fast, the honest answer used to be "sort of." Role-gated accountability makes it "yes, here's the immutable record" — and because the same manifest that proves it also *drives* assignment, you get the audit trail for free as a byproduct of doing the work correctly in the first place.

Quality is gated at the board, not hoped for after the fact.

[Tour the platform →](/product) · [Read about the agentic workforce Kanban →](/blog/transitioning-to-an-agentic-workforce) · [Start building for free →](/register)
