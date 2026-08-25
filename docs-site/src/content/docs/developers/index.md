---
summary: "Publish an extension on Builderforce.ai — become a publisher, ship a reviewed version, and have any workspace install it in one click"
read_when:
  - Deciding whether to build an integration for Builderforce.ai
  - Registering a workspace as a publisher
  - Understanding what a published package is and what review it passes
title: "Publishing an extension"
---

# Publishing an extension

Everything a third party builds for Builderforce.ai used to land in one of two
buckets: private to one workspace, or merged into our codebase by us. Neither
reaches another customer. **A published extension is the third bucket** — authored
by you, reviewed by us, installable by any workspace.

## A publisher is a workspace

There is no separate developer account, no second membership list and no second
set of API keys. A publisher is a Builderforce.ai **workspace** with publishing
turned on:

* Your colleagues are the workspace's members, managed where they always were.
* At least the `developer` role ships a version. At least `manager` lists,
  delists, or sets a price.
* Your credential is a normal tenant API key with publisher scopes on it.

Register at `/developers` → **Publish** → *Register this workspace*. It takes one
click and no application.

## What you can publish

| Kind | What the `spec` is | Where it runs |
|---|---|---|
| `connector` | A connector manifest — auth fields, base URL, and actions | **Our** runtime. You host nothing. |
| `mcp_server` | A server URL, an auth shape and a declared tool list | Your MCP server, relayed server-to-server |

A `connector` is the fastest route to a working integration, because there is
nothing to deploy: the manifest is data, and our executor handles credentials,
rate limiting, redaction, SSRF protection and logging.

## Versions are immutable

A submission is a version, and a version never changes after it is submitted. An
edit is a new version, reviewed again. This is not bureaucracy — a workspace's
install points at a specific version and stores the scopes its admin approved, so
a publisher who could edit a published version in place would be able to widen
what a customer consented to without asking.

Submitting runs the whole review pipeline **synchronously**, so you get the
verdict while you are still looking at the form:

1. **Static** — the manifest parses, no credential-shaped strings in the spec, no
   reserved connector key, every action described, scopes in the vocabulary.
2. **Dynamic** — your candidate version is installed into a sandbox workspace and
   its declared actions are actually called. What was exercised, against what URL,
   with what status, is recorded — including what was *not* invoked and why.
3. **Agentic** — our governance agent reads the diff against the policy packs.

A rejected submission is kept, with its findings. Your third attempt can see the
first two.

## Scopes

An install is a **grant**. Your version declares what it needs; the installing
workspace's admin approves exactly that, and nothing else is available to you.

| Scope | What it permits |
|---|---|
| `tools:call` | Your actions are advertised to agents and may be invoked |
| `read:projects` | Read project and ticket metadata |
| `write:tickets` | Create and update tickets |
| `read:canvas` | Read boards and the objects on them |
| `write:canvas` | Add or update canvas objects |
| `read:insights` | Read aggregate metrics — never per-person rows |
| `notify:members` | Send a notification to workspace members |

Ask for the fewest that make your integration work. A version that **widens**
scopes re-prompts every existing install rather than updating silently; one that
does not, auto-updates. Fetch the live list from
`GET /api/developer/contract` rather than hard-coding it.

## Verification

`unverified` → `domain_verified` → `identity_verified`.

Domain verification is self-serve: claim a domain, publish the TXT record we give
you, and press *Check now*. Identity verification is a decision a person makes,
and it is what lets you **charge money** — see [Selling an extension](./billing).

## Next

* [Selling an extension](./billing) — plans, metered usage, and how you get paid.
* [The vendor API](./vendor-api) — acting on a customer's behalf, and reporting usage.
