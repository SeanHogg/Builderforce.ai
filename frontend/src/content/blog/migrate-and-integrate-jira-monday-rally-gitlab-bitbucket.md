---
title: "Migrate Without Fear: Jira, Monday, Rally, GitLab, Bitbucket and GitHub into BuilderForce"
date: 2026-06-29
description: Every external system BuilderForce connects to, and the staged migration importer that moves you off Jira, Monday or Rally — combine projects, map item types and users, review everything, then import. Or never leave your tracker and just sync. The Brain can run the whole thing.
tags: [integrations, migration, jira, monday, rally, gitlab, bitbucket, github, connectors]
author: Sean Hogg
---

# Migrate Without Fear: Jira, Monday, Rally, GitLab, Bitbucket and GitHub into BuilderForce

The single biggest reason teams stay on a tool they've outgrown is the move itself. Years of tickets, a project taxonomy everyone has memorized, assignees, sprints, story points — the fear isn't the new tool, it's losing the old one's history in the switch. So BuilderForce treats migration as a first-class, reversible-until-you-commit workflow, not a one-shot import button you cross your fingers on.

![Funnel diagram: migration-badge providers Jira, monday, Rally, GitLab, Bitbucket and GitHub plus sync-only sources feed a staged seven-step migration wizard that outputs one BuilderForce board and a live sync connection](/blog/migrate-integrate.svg)

## Two ways to adopt: migrate, sync, or both

Not every team wants to leave. Some want to move wholesale; some never want to leave Jira and just want the data flowing into BuilderForce so their agents and dashboards can act on it. Every integration supports both, chosen per run:

- **Migrate** — a one-time import of your historical items into BuilderForce tasks.
- **Sync** — an ongoing connection that keeps polling, so changes flow in continuously. You never leave your tracker.
- **Both** — import the history *and* set up the live connection.

## Everything we connect

The Integrations gallery (under **Settings → Integrations**) is the workspace home for every external system. Each provider is a card you connect, configure, and watch — with credentials, live connections, and an activity/diagnostics tab showing every sync run.

**Work & project management:** Jira, monday.com, Rally (CA Agile Central), Linear, Asana, ClickUp.

**Source control & issues:** GitHub, GitLab, Bitbucket — *both* their issue trackers (migrated like any board) **and** their repositories (connected for code, branches, and pull requests).

**IT service management:** ServiceNow, Freshservice — incidents and tickets flow into the Quality lens.

**Monitoring & on-call:** Sentry, PagerDuty — alerts and incidents become actionable work.

Providers that support the migration wizard carry a **Migration** badge: Jira, monday, Rally, GitLab, Bitbucket and GitHub today. The rest connect for ongoing sync.

## The migration wizard: stage before it lands

Nothing touches your real projects, tasks, or members until you press import. Everything before that lives in a staging buffer you can review, adjust, and walk away from:

1. **Connect** — pick the credential and the mode (migrate / sync / both).
2. **Discover** — BuilderForce reads the external system and stages its projects, item types, and users. No writes yet.
3. **Map & combine projects** — assign each external project to a new BuilderForce project, or map several onto *one* project to combine them. The classic "we have five Jira projects that are really one product" problem is just five rows pointing at the same target.
4. **Map item types** — turn `Story`, `Bug`, `Epic`, `Defect`, `incident` into the right BuilderForce task type and starting status. This mapping is also saved for ongoing sync, so synced tasks land in the right lane instead of a generic backlog.
5. **Map users** — invite the external assignees you want, or map them to existing members. Imported items keep their assignee when the person maps to a member.
6. **Review** — see the staged items, uncheck anything you want to leave behind.
7. **Import** — projects are created (or combined), tasks are imported with their type, status, story points and assignee, users are invited, and — if you chose sync — live connections are created so the board keeps itself current.

Because imported items are linked back to their source, the first sync after a migration is a clean no-op, not a duplicate storm.

## Let the Brain do it

The whole flow is available to the Brain as tools. You can simply say:

> "Connect Bitbucket — here's the access token and workspace. Test it, then start a migration."

The Brain stores the credential (encrypted), validates the connection, starts the run, and opens the migration panel on the **left** of your screen — right where it can work alongside the Brain, which lives on the right. You map, review, and import; it handles the plumbing. Connect, validate, reconcile, import — conversationally.

## Why this matters

Migration fear is a tax on every good decision a team could make. By staging everything, letting you combine and remap on the way in, preserving people and history, and offering "just sync, don't move" as a first-class option, BuilderForce removes the tax. You evaluate on your real data, in your real structure, with nothing destroyed — and you can change your mind right up until the moment you commit.
