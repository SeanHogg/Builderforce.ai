---
title: The founder back office — money in, ownership, and the paperwork before all the other paperwork
date: 2026-08-19
description: Invoices you can issue and chase, ageing computed rather than typed, a cap table recorded as events instead of a percentage column, and the four founding documents as templates you can actually send for signature.
tags: [founder-ops, finance, cap-table, equity, legal, invoicing]
author: Sean Hogg
---

# The founder back office — money in, ownership, and the paperwork before all the other paperwork

Three things a company needs in its first year, none of which are the product: getting paid, knowing who owns what, and having the documents that make the first two mean anything.

They are usually three tools, three exports and one spreadsheet that everybody has stopped trusting. Here is what changed when they became objects on the same board as the work.

## 1 · The money coming in

The finance seat used to be one-directional by construction. Money could go out — payouts, bills, payroll — and nothing could bring any in. Invoice actions were advertised, gated, approved… and had nothing behind them.

```bf-figure
{
  "kind": "flow",
  "title": "An invoice, end to end",
  "steps": [
    { "label": "Issue", "note": "Against a real customer account — not a name matched by spelling.", "hue": "run" },
    { "label": "Age", "note": "Days overdue computed from the due date. Never typed, because a stale ageing is worse than none.", "hue": "run", "tag": "computed" },
    { "label": "Chase", "note": "One rung of a collections ladder, recorded once per step — so the same customer is never chased twice for the same thing.", "hue": "growth" },
    { "label": "Record payment", "note": "What actually arrived, against what was owed.", "hue": "measure" }
  ],
  "caption": "Collections work with no record is collections work that gets done twice or not at all. The ladder is unique per invoice and step for exactly that reason."
}
```

The counterparty change underneath is the quiet one. `invoice.customer`, `bill.vendor`, `contract.counterparty` and `placement.client` were all free text with an instruction to "match it to a company on the board by name". Three near-identical instructions, three chances for a trailing "Ltd" to produce a second Acme. They now resolve through one shared account lookup — a live join, not a copied id, so renaming an account does not leave four stale copies of its old name scattered across your invoices.

## 2 · A cap table that survives its second event

Here is the shape almost every founder spreadsheet has, and why it always breaks.

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to record ownership",
  "columns": [
    { "title": "A holders table", "hue": "bad", "items": ["Holder, instrument, shares, percent", "Every event is a RE-TYPE of the whole table", "A pool top-up breaks it", "A departure breaks it", "A buy-back breaks it", "Percentages that do not total 100, with a note explaining why"] },
    { "title": "Authorised, granted, and events", "hue": "good", "items": ["Share classes = what the board authorised", "Grants = the TERMS of an award", "SAFEs and notes as separate instruments — only one of them accrues", "An append-only history of issues, transfers, exercises, cancellations", "Percentages are arithmetic over that history"] }
  ],
  "caption": "The option pool is a CLASS, not a flag: \"what is unallocated\" is authorised minus granted WITHIN it, which a boolean cannot express."
}
```

A funding round is a record of what is being *negotiated* — the instrument, the amount sought, the valuation asked for, the lead, the intended close date. What has actually closed is derived from the allocations, so the round header and the money in it can never disagree. A stored "amount raised" column would be a total the rows underneath it can contradict, and the day they do, nobody knows which one is true.

## 3 · The paperwork before the other paperwork

Two founders can find each other, agree, shake hands — and have nowhere to record it. So the founding documents are templates, filled in and sent for signature:

- **Founders' agreement**
- **Founder IP assignment**
- **Founder vesting schedule**
- **Mutual NDA**

A missing required field is refused *by name*, with the list of what is missing. That sounds pedantic until you consider the alternative: rendering an em-dash into a founders' agreement and letting somebody sign it. An error is recoverable; a signed document with a blank in the ownership clause is not.

Beyond the four, any legal document can be held encrypted, shared by link and signed, with the text frozen exactly as it was at signature. And a data room can hold the actual files a diligence request asks for, rather than only the checklist that names them — which was the state of it until recently, and is the most quietly embarrassing gap on this list.

## Why this is on the same board as the product

Because the alternative is what everyone does: a finance tool that does not know what you are building, a cap table tool that does not know who is working on it, and a signing tool that does not know either.

```bf-figure
{
  "kind": "stack",
  "title": "One board, four distances from the work",
  "bands": [
    { "label": "The work", "note": "Cards, code, tickets, the thing being built.", "hue": "make" },
    { "label": "The deal", "note": "Quotes, trials, mutual action plans — what is being sold, connected to what it sells.", "hue": "growth" },
    { "label": "The money", "note": "Invoices, bills, collections, pay runs — computed from the rows, not typed on a card.", "hue": "run" },
    { "label": "The company", "note": "Ownership, instruments, the founding documents everything else assumes exists.", "hue": "measure" }
  ],
  "caption": "Run is a whole stage of the arc — \"run it as a company\" — and it is the stage most build tools hand you back to a spreadsheet for."
}
```

---

**Related reading:** [Close the deal on the board you built it on](/blog/close-the-deal-on-the-board-you-built-it-on) · [Fixed-price milestones and escrow](/blog/fixed-price-milestones-and-escrow) · [Idea to Real — the operating methodology](/blog/idea-to-real-the-operating-methodology)

[Open a canvas](/create) and put the invoice next to the work it is for.
