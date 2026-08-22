---
title: The four questions an enterprise AI purchase actually turns on
date: 2026-08-18
description: Not "which model". Can it read our data, will it leak across tenants, what did that answer cost, and how do we know it is getting better — and what an honest answer to each looks like.
tags: [enterprise, evermind, security, procurement, rag]
author: Sean Hogg
---

# The four questions an enterprise AI purchase actually turns on

Every enterprise AI evaluation starts as a conversation about models and ends as a conversation about four things that have nothing to do with models.

Customers were not asking us for a better model. They were asking these:

```bf-figure
{
  "kind": "stack",
  "title": "The four, in the order they get asked",
  "bands": [
    { "label": "Can it read our data?", "note": "Not a demo corpus. Our exports, our documents, our tickets, our policies — in the formats they are actually in.", "hue": "idea" },
    { "label": "Will it leak across tenants?", "note": "Not \"we filter by customer id\". What happens when the filter is missing?", "hue": "run" },
    { "label": "What did that answer cost?", "note": "Per answer, attributable, not a monthly invoice with one number on it.", "hue": "measure" },
    { "label": "How do we know it is getting better?", "note": "A gate a change has to pass, not a changelog that says it improved.", "hue": "prove" }
  ],
  "caption": "A vendor who answers three of these well and waves at the fourth is asking you to take the fourth on faith — and the fourth is the one that decides whether the thing is still good in a year."
}
```

Here is what each answer looks like when it is real.

## 1 · Ingestion is one path, not one demo

The failure mode is a system that reads Markdown beautifully and treats everything else as an attachment. Real corpora are mixed: policy documents, exported tickets, spreadsheets, HTML pages, a CSV somebody produced from a report six years ago.

One pipeline handles all of them, and the difference between them is which parser ran — not which product you had to buy. Structured rows and unstructured prose land in the same index through the same path, which is what lets a question be answered from both at once.

Details that turn out to matter in practice: keeping a document's heading breadcrumb so a retrieved chunk knows where it came from, and recovering numbers and booleans from spreadsheets **without** mangling identifier-shaped strings — an ID of `007` is not the number seven, and a system that decides otherwise silently corrupts every reference to it.

## 2 · Tenancy is compiled in, and fails closed

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to keep one customer out of another's data",
  "columns": [
    { "title": "A filter added at the call site", "hue": "bad", "items": ["Correct in every code path somebody remembered", "A new code path is a new chance to forget", "The failure is silent and looks like a good answer", "You find out from the customer"] },
    { "title": "Compiled into retrieval, failing closed", "hue": "good", "items": ["A query with no tenant scope returns nothing", "Filters are DATA the adapter must honour", "Cross-tenant reads are DECLARED, never incidental", "The absence of a scope is an error, not a wildcard"] }
  ],
  "caption": "The property to insist on in a demo: ask what happens when the tenant scope is missing. \"Everything\" and \"nothing\" are very different products."
}
```

## 3 · Cost and trace on every answer

An AI system whose cost arrives as one monthly figure cannot be managed. You cannot tell which workflow is expensive, which team is driving it, or whether the answer was worth the tokens.

Per-answer telemetry — what was retrieved, what was called, what it cost — is what turns that into something a finance function can hold and an engineering team can improve. It is also what makes the fourth question answerable, because you cannot show a change was an improvement without a baseline you were already recording.

## 4 · An evaluation gate, not a changelog

The honest version of "it is getting better" is a set of cases the system has to pass before a change ships, run on every change, with the failures visible. Not a benchmark score in a launch post — a gate in the pipeline that can say *no*.

This is the question most vendors handle worst, because it is the only one that constrains them. A gate that can block a release is a gate that will eventually block a release somebody wanted.

## And the boring one: how people sign in

Enterprise single sign-on is live over OpenID Connect, pointed at whichever identity provider a customer already runs.

We deliberately do not terminate SAML ourselves. The hard part of SAML is verifying a signed response — canonicalisation, digest validation, signature check, with claims read from the subtree that was actually verified — and a mistake anywhere in that sequence is a signature-wrapping authentication bypass whose defining property is that it looks exactly like a working login until somebody forges an assertion. Customers point their existing IdP at an SSO gateway of their choosing; nothing in our schema names a vendor.

Being clear about what you have chosen *not* to implement is part of answering question two.

---

**Related reading:** [Evermind — the self-updating model](/blog/evermind-self-updating-model) · [Inside the Evermind architecture](/blog/inside-evermind-architecture) · [Security and multi-tenant architecture](/blog/security-and-multi-tenant-architecture)

Read the [Evermind overview](/evermind), or bring the questions to a [conversation](/book-demo).
